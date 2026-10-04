import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { businessRule, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { ilike, offset, pageMeta } from '../../lib/pagination';
import { nextReference, peekReference } from '../../services/sequences';
import { reverseEntries } from '../../services/ledger';
import type { ArrivalListQuery, CreateArrivalDraftInput, CreateArrivalInput } from './arrivals.schemas';

type Db = Prisma.TransactionClient | typeof prisma;

const includeDetail = {
  supplier: { select: { id: true, name: true, phone: true } },
  cartons: {
    orderBy: { reference: 'asc' as const },
    include: {
      items: {
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              product: { select: { id: true, name: true } },
              size: { select: { id: true, value: true, label: true } },
            },
          },
        },
      },
    },
  },
  lots: {
    orderBy: { code: 'asc' as const },
    include: {
      variant: {
        select: {
          id: true,
          product: { select: { id: true, name: true } },
          size: { select: { id: true, value: true, label: true } },
        },
      },
    },
  },
  debt: true,
  payments: { orderBy: { date: 'asc' as const } },
  fundings: true,
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ArrivalInclude;

export async function loadArrival(db: Db, id: string) {
  const arrival = await db.arrival.findUnique({ where: { id }, include: includeDetail });
  if (!arrival) throw notFound('Arrivage introuvable');

  return {
    id: arrival.id,
    reference: arrival.reference,
    date: arrival.date,
    status: arrival.status,
    notes: arrival.notes,
    totalCost: money(arrival.totalCost),
    totalQty: arrival.totalQty,
    paidAmount: money(arrival.paidAmount),
    unpaidAmount: money(arrival.unpaidAmount),
    cancelledAt: arrival.cancelledAt,
    cancelReason: arrival.cancelReason,
    supplier: arrival.supplier,
    cartons: arrival.cartons.map((c) => ({
      id: c.id,
      reference: c.reference,
      date: c.date,
      notes: c.notes,
      totalCost: money(c.totalCost),
      totalQty: c.totalQty,
      items: c.items.map((i) => ({
        id: i.id,
        variantId: i.variantId,
        quantity: i.quantity,
        unitCost: money(i.unitCost),
        lineTotal: money(i.lineTotal),
        product: i.variant.product,
        size: i.variant.size,
        sku: i.variant.sku,
      })),
    })),
    lots: arrival.lots.map((l) => ({
      id: l.id,
      code: l.code,
      variantId: l.variantId,
      product: l.variant.product,
      size: l.variant.size,
      initialQty: l.initialQty,
      remainingQty: l.remainingQty,
      unitCost: money(l.unitCost),
      totalCost: money(l.totalCost),
      value: money(l.remainingQty * l.unitCost),
      entryDate: l.entryDate,
      status: l.status,
    })),
    debt: arrival.debt
      ? {
          id: arrival.debt.id,
          reason: arrival.debt.reason,
          initialAmount: money(arrival.debt.initialAmount),
          paidAmount: money(arrival.debt.paidAmount),
          remainingAmount: money(arrival.debt.remainingAmount),
          status: arrival.debt.status,
          direction: arrival.debt.direction,
        }
      : null,
    payments: arrival.payments.map((p) => ({
      id: p.id,
      reference: p.reference,
      date: p.date,
      amount: money(p.amount),
      direction: p.direction,
      method: p.method,
      notes: p.notes,
    })),
    fundings: arrival.fundings.map((f) => ({
      id: f.id,
      source: f.source,
      amount: money(f.amount),
      notes: f.notes,
    })),
    createdBy: arrival.createdBy,
    createdAt: arrival.createdAt,
    updatedAt: arrival.updatedAt,
  };
}

/** Résultat des contrôles communs : fournisseur, variantes, références, totaux. */
interface ArrivalPlan {
  supplierId: string;
  supplierName: string;
  references: string[];
  totalQty: number;
  totalCost: number;
  paid: number;
  date: Date;
  variantById: Map<string, { id: string; sizeId: string }>;
}

/** Contrôles partagés par la création directe et la réception d'un brouillon. */
async function planArrival(
  tx: Db,
  input: CreateArrivalInput,
  fallbackDate?: Date,
): Promise<ArrivalPlan> {
  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw notFound('Fournisseur introuvable');
  if (!supplier.active) throw businessRule('Ce fournisseur est désactivé');

  const variantIds = [...new Set(input.cartons.flatMap((c) => c.items.map((i) => i.variantId)))];
  const variants = await tx.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, sizeId: true, active: true, product: { select: { id: true, name: true } } },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const unknown = variantIds.find((id) => !variantById.has(id));
  if (unknown) throw notFound(`Variante inconnue : ${unknown}`);
  const inactive = variants.find((v) => !v.active);
  if (inactive) throw businessRule(`La variante ${inactive.id} est désactivée`);

  const references = input.cartons.map((c, i) => c.reference ?? `C${i + 1}`);
  if (new Set(references).size !== references.length) {
    throw businessRule('Références de cartons en doublon dans cet arrivage');
  }

  const totalQty = input.cartons.reduce((s, c) => s + c.items.reduce((a, i) => a + i.quantity, 0), 0);
  const totalCost = input.cartons.reduce(
    (s, c) => s + c.items.reduce((a, i) => a + i.quantity * i.unitCost, 0),
    0,
  );
  const paid = input.payment?.amount ?? 0;

  if (paid > totalCost) {
    throw businessRule(
      `Le paiement (${money(paid)}) dépasse le montant de l'arrivage (${money(totalCost)})`,
    );
  }

  const date = input.date ?? fallbackDate ?? new Date();
  return {
    supplierId: supplier.id,
    supplierName: supplier.name,
    references,
    totalQty,
    totalCost,
    paid,
    date,
    variantById: new Map(variants.map((v) => [v.id, { id: v.id, sizeId: v.sizeId }])),
  };
}

/** Cartons → lignes → lots → mouvements → dette → paiement → journal → financement. */
async function fillArrival(
  tx: Db,
  arrival: { id: string; reference: string },
  plan: ArrivalPlan,
  input: CreateArrivalInput,
  userId: string | null,
) {
  for (const [index, carton] of input.cartons.entries()) {
    const cartonQty = carton.items.reduce((a, i) => a + i.quantity, 0);
    const cartonCost = carton.items.reduce((a, i) => a + i.quantity * i.unitCost, 0);

    const created = await tx.arrivalCarton.create({
      data: {
        reference: plan.references[index]!,
        arrivalId: arrival.id,
        date: carton.date ?? plan.date,
        notes: carton.notes ?? null,
        totalCost: cartonCost,
        totalQty: cartonQty,
      },
    });

    for (const item of carton.items) {
      const variant = plan.variantById.get(item.variantId)!;
      const lineTotal = item.quantity * item.unitCost;

      const arrivalItem = await tx.arrivalItem.create({
        data: {
          cartonId: created.id,
          variantId: variant.id,
          quantity: item.quantity,
          unitCost: item.unitCost,
          lineTotal,
        },
      });

      const lot = await tx.stockLot.create({
        data: {
          code: await nextReference(tx, 'lot'),
          arrivalId: arrival.id,
          cartonId: created.id,
          arrivalItemId: arrivalItem.id,
          supplierId: plan.supplierId,
          variantId: variant.id,
          sizeId: variant.sizeId,
          initialQty: item.quantity,
          remainingQty: item.quantity,
          unitCost: item.unitCost,
          totalCost: lineTotal,
          entryDate: plan.date,
          status: 'OPEN',
        },
      });

      await tx.stockMovement.create({
        data: {
          lotId: lot.id,
          variantId: variant.id,
          type: 'IN',
          delta: item.quantity,
          unitCost: item.unitCost,
          refType: 'ARRIVAL',
          refId: arrival.id,
          date: plan.date,
          userId,
        },
      });
    }
  }

  let debtId: string | null = null;
  if (plan.paid < plan.totalCost) {
    const debt = await tx.debt.create({
      data: {
        type: 'SUPPLIER',
        direction: 'PAYABLE',
        origin: 'ARRIVAL',
        arrivalId: arrival.id,
        supplierId: plan.supplierId,
        reason:
          plan.paid > 0
            ? `Arrivage ${arrival.reference} — paiement partiel`
            : `Arrivage ${arrival.reference} — non payé`,
        initialAmount: plan.totalCost,
        paidAmount: plan.paid,
        remainingAmount: plan.totalCost - plan.paid,
        date: plan.date,
        status: plan.paid > 0 ? 'PARTIAL' : 'OPEN',
      },
    });
    debtId = debt.id;
  }

  if (plan.paid > 0) {
    const paymentRef = await nextReference(tx, 'payment');
    const paymentDate = input.payment?.date ?? plan.date;
    const payment = await tx.payment.create({
      data: {
        reference: paymentRef,
        date: paymentDate,
        amount: plan.paid,
        direction: 'OUT',
        partyType: 'SUPPLIER',
        partyId: plan.supplierId,
        arrivalId: arrival.id,
        debtId,
        method: input.payment?.method ?? null,
        notes: input.payment?.notes ?? null,
        userId,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        date: paymentDate,
        kind: 'SUPPLIER_PAYMENT',
        amount: plan.paid,
        cashDelta: -plan.paid,
        description: `Paiement fournisseur ${plan.supplierName} — arrivage ${arrival.reference}`,
        reference: paymentRef,
        refType: 'ARRIVAL',
        refId: arrival.id,
        arrivalId: arrival.id,
        debtId,
        paymentId: payment.id,
        userId,
      },
    });
  }

  if (input.funding) {
    await tx.fundingAllocation.create({
      data: {
        arrivalId: arrival.id,
        source: input.funding.source,
        amount: input.funding.amount,
        notes: input.funding.notes ?? null,
      },
    });
  }
}

/**
 * Enregistrement complet d'un arrivage — **une seule transaction** (§55) :
 * arrivage → cartons → lignes → lots (`unitCost` figé) → mouvements `IN`
 * → dette fournisseur → paiement → écriture de journal → financement.
 */
export async function createArrival(input: CreateArrivalInput, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const plan = await planArrival(tx, input);
    const reference = await nextReference(tx, 'arrival');

    const arrival = await tx.arrival.create({
      data: {
        reference,
        supplierId: plan.supplierId,
        date: plan.date,
        notes: input.notes ?? null,
        status: 'RECEIVED',
        totalCost: plan.totalCost,
        totalQty: plan.totalQty,
        paidAmount: plan.paid,
        unpaidAmount: plan.totalCost - plan.paid,
        createdById: userId,
      },
    });

    await fillArrival(tx, arrival, plan, input, userId);
    return loadArrival(tx, arrival.id);
  });
}

/**
 * POST /arrivals/drafts — **brouillon à ventiler** : le montant du carton est
 * déclaré sans ventilation par pointure. Aucun lot, aucune dette, aucune
 * écriture de journal : l'arrivage n'existe comptablement qu'après réception.
 */
export async function createArrivalDraft(input: CreateArrivalDraftInput, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
    if (!supplier) throw notFound('Fournisseur introuvable');
    if (!supplier.active) throw businessRule('Ce fournisseur est désactivé');

    const references = input.cartons.map((c, i) => c.reference ?? `C${i + 1}`);
    if (new Set(references).size !== references.length) {
      throw businessRule('Références de cartons en doublon dans cet arrivage');
    }

    const totalCost = input.cartons.reduce((sum, carton) => sum + carton.totalCost, 0);
    const date = input.date ?? new Date();
    const reference = await nextReference(tx, 'arrival');

    const arrival = await tx.arrival.create({
      data: {
        reference,
        supplierId: supplier.id,
        date,
        notes: input.notes ?? null,
        status: 'DRAFT',
        totalCost,
        totalQty: 0,
        paidAmount: 0,
        unpaidAmount: 0,
        createdById: userId,
      },
    });

    for (const [index, carton] of input.cartons.entries()) {
      await tx.arrivalCarton.create({
        data: {
          reference: references[index]!,
          arrivalId: arrival.id,
          date: carton.date ?? date,
          notes: carton.notes ?? null,
          totalCost: carton.totalCost,
          totalQty: 0,
        },
      });
    }

    return loadArrival(tx, arrival.id);
  });
}

/**
 * POST /arrivals/:id/receive — **ventilation** d'un brouillon : les cartons
 * déclarés sont remplacés par la grille ventilée, puis le chemin est celui de
 * l'arrivage complet (lignes → lots → dette → paiement → journal).
 */
export async function receiveArrival(
  id: string,
  input: CreateArrivalInput,
  userId: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.arrival.findUnique({ where: { id } });
    if (!draft) throw notFound('Arrivage introuvable');
    if (draft.status === 'CANCELLED') throw businessRule('Cet arrivage est annulé');
    if (draft.status !== 'DRAFT') throw businessRule('Cet arrivage est déjà réceptionné');

    const plan = await planArrival(tx, input, draft.date);

    // Les cartons du brouillon n'ont ni ligne ni lot : leur remplacement est anodin.
    await tx.arrivalCarton.deleteMany({ where: { arrivalId: id } });

    const arrival = await tx.arrival.update({
      where: { id },
      data: {
        supplierId: plan.supplierId,
        date: plan.date,
        notes: input.notes ?? draft.notes,
        status: 'RECEIVED',
        totalCost: plan.totalCost,
        totalQty: plan.totalQty,
        paidAmount: plan.paid,
        unpaidAmount: plan.totalCost - plan.paid,
      },
    });

    await fillArrival(tx, arrival, plan, input, userId);
    return loadArrival(tx, id);
  });
}

/**
 * Annulation d'un arrivage (§6) — **uniquement si le stock est intact**.
 * Toute correction passe par une contre-passation (`reverseEntries`) : lots
 * annulés (`REVERSAL`), dette annulée, solde net des écritures de paiement
 * contre-passé — y compris les règlements tardifs passés par `refType = 'DEBT'`.
 */
export async function cancelArrival(id: string, reason: string, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const arrival = await tx.arrival.findUnique({
      where: { id },
      include: {
        lots: true,
        debt: { include: { versements: { select: { id: true, personName: true, motif: true, date: true } } } },
        supplier: true,
      },
    });
    if (!arrival) throw notFound('Arrivage introuvable');
    if (arrival.status === 'CANCELLED') throw businessRule('Cet arrivage est déjà annulé');

    const moved = arrival.lots.filter((l) => l.remainingQty !== l.initialQty);
    if (moved.length > 0) {
      throw businessRule("Impossible d'annuler : le stock de cet arrivage a déjà bougé");
    }
    if (arrival.debt && arrival.debt.versements.length > 0) {
      const v = arrival.debt.versements[0]!;
      throw businessRule(
        `Un versement du ${v.date.toISOString().slice(0, 10)} règle la dette de cet arrivage — annulez d'abord le versement`,
      );
    }

    const now = new Date();

    for (const lot of arrival.lots) {
      await tx.stockMovement.create({
        data: {
          lotId: lot.id,
          variantId: lot.variantId,
          type: 'REVERSAL',
          delta: -lot.remainingQty,
          unitCost: lot.unitCost,
          refType: 'ARRIVAL',
          refId: arrival.id,
          date: now,
          notes: `Annulation ${arrival.reference} — ${reason}`,
          userId,
        },
      });
      await tx.stockLot.update({ where: { id: lot.id }, data: { remainingQty: 0, status: 'CANCELLED' } });
    }

    if (arrival.debt) {
      await tx.debt.update({
        where: { id: arrival.debt.id },
        data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason },
      });
    }

    // Solde net par kind : paiement initial (refType ARRIVAL) + règlements
    // tardifs de la dette (refType DEBT). `Arrival.paidAmount` n'est jamais
    // mis à jour après la création — ne jamais recalculer depuis lui.
    await reverseEntries(tx, 'ARRIVAL', arrival.id, `Annulation arrivage ${arrival.reference}`, userId, {
      reference: `ANNULATION ${arrival.reference}`,
    });
    if (arrival.debt) {
      await reverseEntries(
        tx,
        'DEBT',
        arrival.debt.id,
        `Annulation arrivage ${arrival.reference} — ${arrival.supplier.name}`,
        userId,
        { reference: `ANNULATION ${arrival.reference}` },
      );
    }

    await tx.arrival.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason },
    });

    return loadArrival(tx, id);
  });
}

export interface ArrivalRow {
  id: string;
  reference: string;
  date: Date;
  status: string;
  totalCost: string;
  totalQty: number;
  paidAmount: string;
  unpaidAmount: string;
  supplier: { id: string; name: string; phone: string | null };
}

export async function listArrivals(query: ArrivalListQuery) {
  const where = {
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
    ...(ilike(query.q) ? { reference: ilike(query.q) } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.arrival.findMany({
      where,
      orderBy: [{ date: 'desc' }, { reference: 'desc' }],
      skip: offset(query),
      take: query.limit,
      include: { supplier: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.arrival.count({ where }),
  ]);

  return {
    items: items.map<ArrivalRow>((a) => ({
      id: a.id,
      reference: a.reference,
      date: a.date,
      status: a.status,
      totalCost: money(a.totalCost),
      totalQty: a.totalQty,
      paidAmount: money(a.paidAmount),
      unpaidAmount: money(a.unpaidAmount),
      supplier: a.supplier,
    })),
    ...pageMeta(total, query.page, query.limit),
  };
}

export async function previewArrivalReference(): Promise<string> {
  return peekReference(prisma, 'arrival');
}
