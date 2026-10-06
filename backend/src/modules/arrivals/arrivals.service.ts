import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { businessRule, conflict, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { ilike, offset, pageMeta } from '../../lib/pagination';
import { nextReference, peekReference } from '../../services/sequences';
import { reverseEntries } from '../../services/ledger';
import type {
  ArrivalListQuery,
  CreateArrivalInput,
  UpdateArrivalInput,
  VentilateInput,
} from './arrivals.schemas';

type Db = Prisma.TransactionClient | typeof prisma;

const includeDetail = {
  supplier: { select: { id: true, name: true, phone: true } },
  cartons: {
    orderBy: { reference: 'asc' as const },
    include: {
      product: { select: { id: true, name: true } },
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

  const cancelled = arrival.status === 'CANCELLED';

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
    cartons: arrival.cartons.map((c) => {
      const linedQty = c.items.reduce((sum, i) => sum + i.quantity, 0);
      const linedCost = c.items.reduce((sum, i) => sum + i.lineTotal, 0);
      return {
        id: c.id,
        reference: c.reference,
        date: c.date,
        notes: c.notes,
        productId: c.productId,
        product: c.product,
        totalCost: money(c.totalCost),
        totalQty: c.totalQty,
        sellingPrice: c.sellingPrice === null ? null : money(c.sellingPrice),
        ventilatedAt: c.ventilatedAt,
        ventilated: c.ventilatedAt !== null,
        /**
         * Part encore inconnue des pointures — entre dans la valorisation.
         * Un arrivage annulé ne pèse plus : ses cartons ne sont plus à ventiler.
         */
        transitValue: cancelled ? money(0) : money(c.totalCost - linedCost),
        transitQty: cancelled ? 0 : c.totalQty - linedQty,
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
      };
    }),
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

/** Résultat des contrôles communs : fournisseur, modèles, pointures, totaux. */
interface ArrivalPlan {
  supplierId: string;
  supplierName: string;
  references: string[];
  totalQty: number;
  totalCost: number;
  paid: number;
  date: Date;
  /**
   * Un par entrée `input.cartons`, dans l'ordre : modèle, quantité, montant et
   * `unitCost` **déduit** — `floor(totalCost / totalQty)`, jamais saisi.
   */
  cartons: PlanCarton[];
}

interface PlanCarton {
  productId: string;
  totalQty: number;
  totalCost: number;
  unitCost: number;
  sellingPrice: number | null;
  /** Pointures listées à la saisie — vide = carton « à ventiler ». */
  sizes: { sizeId: string; quantity: number }[];
}

/** Contrôles partagés : fournisseur, modèle, pointures, références, totaux. */
async function planArrival(tx: Db, input: CreateArrivalInput): Promise<ArrivalPlan> {
  const supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
  if (!supplier) throw notFound('Fournisseur introuvable');
  if (!supplier.active) throw businessRule('Ce fournisseur est désactivé');

  const cartons: PlanCarton[] = input.cartons.map((carton) => {
    const unitCost = Math.floor(carton.totalCost / carton.totalQty);
    if (unitCost < 1) {
      throw businessRule(`Le carton ${carton.reference ?? carton.productId} : montant trop faible pour en dériver un prix unitaire`);
    }
    return {
      productId: carton.productId,
      totalQty: carton.totalQty,
      totalCost: carton.totalCost,
      unitCost,
      sellingPrice: carton.sellingPrice ?? null,
      sizes: carton.sizes ?? [],
    };
  });

  const productIds = [...new Set(cartons.map((carton) => carton.productId))];
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, active: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));
  const missingProduct = productIds.find((id) => !productById.has(id));
  if (missingProduct) throw notFound(`Modèle introuvable : ${missingProduct}`);
  const inactiveProduct = products.find((p) => !p.active);
  if (inactiveProduct) throw businessRule(`Le modèle ${inactiveProduct.name} est désactivé`);

  const sizeIds = [...new Set(cartons.flatMap((carton) => carton.sizes.map((line) => line.sizeId)))];
  const sizes = await tx.size.findMany({ where: { id: { in: sizeIds } }, select: { id: true } });
  const knownSizes = new Set(sizes.map((size) => size.id));
  const unknownSize = sizeIds.find((sizeId) => !knownSizes.has(sizeId));
  if (unknownSize) throw notFound(`Pointure inconnue : ${unknownSize}`);

  const references = input.cartons.map((c, i) => c.reference ?? `C${i + 1}`);
  if (new Set(references).size !== references.length) {
    throw businessRule('Références de cartons en doublon dans cet arrivage');
  }

  const totalQty = cartons.reduce((sum, carton) => sum + carton.totalQty, 0);
  const totalCost = cartons.reduce((sum, carton) => sum + carton.totalCost, 0);
  const paid = input.payment?.amount ?? 0;

  if (paid > totalCost) {
    throw businessRule(
      `Le paiement (${money(paid)}) dépasse le montant de l'arrivage (${money(totalCost)})`,
    );
  }

  const date = input.date ?? new Date();
  return {
    supplierId: supplier.id,
    supplierName: supplier.name,
    references,
    totalQty,
    totalCost,
    paid,
    date,
    cartons,
  };
}

/** Variante `productId_sizeId` : créée ou réactivée, prix par défaut non écrasé. */
async function ensureVariant(
  tx: Db,
  productId: string,
  sizeId: string,
  sellingPrice: number | null,
): Promise<string> {
  const variant = await tx.productVariant.upsert({
    where: { productId_sizeId: { productId, sizeId } },
    create: {
      productId,
      sizeId,
      sellingPrice: sellingPrice ?? 0,
      active: true,
    },
    update: { active: true },
  });

  if (sellingPrice && variant.sellingPrice === 0) {
    await tx.productVariant.update({
      where: { id: variant.id },
      data: { sellingPrice },
    });
  }
  return variant.id;
}

/**
 * Une ligne de carton → `ArrivalItem` → `StockLot` (`unitCost` figé) →
 * mouvement `IN`. Zéro écriture comptable — la caisse et la dette datent de
 * l'enregistrement (ou de la modification) de l'arrivage.
 */
async function createCartonLine(
  tx: Db,
  ctx: {
    arrival: { id: string; supplierId: string };
    carton: { id: string; date: Date };
    unitCost: number;
    userId: string | null;
  },
  line: { variantId: string; sizeId: string; quantity: number },
) {
  const lineTotal = line.quantity * ctx.unitCost;

  const arrivalItem = await tx.arrivalItem.create({
    data: {
      cartonId: ctx.carton.id,
      variantId: line.variantId,
      quantity: line.quantity,
      unitCost: ctx.unitCost,
      lineTotal,
    },
  });

  const lot = await tx.stockLot.create({
    data: {
      code: await nextReference(tx, 'lot'),
      arrivalId: ctx.arrival.id,
      cartonId: ctx.carton.id,
      arrivalItemId: arrivalItem.id,
      supplierId: ctx.arrival.supplierId,
      variantId: line.variantId,
      sizeId: line.sizeId,
      initialQty: line.quantity,
      remainingQty: line.quantity,
      unitCost: ctx.unitCost,
      totalCost: lineTotal,
      entryDate: ctx.carton.date,
      status: 'OPEN',
    },
  });

  await tx.stockMovement.create({
    data: {
      lotId: lot.id,
      variantId: line.variantId,
      type: 'IN',
      delta: line.quantity,
      unitCost: ctx.unitCost,
      refType: 'ARRIVAL',
      refId: ctx.arrival.id,
      date: ctx.carton.date,
      userId: ctx.userId,
    },
  });
}

/**
 * Pointures d'un carton → variante (`productId_sizeId`, créée ou réactivée)
 * → `ArrivalItem` → `StockLot` → mouvement `IN`. Prix unitaire **imposé** :
 * celui du carton, dérivé de `montant / quantité`.
 */
async function writeCartonLines(
  tx: Db,
  ctx: {
    arrival: { id: string; supplierId: string };
    carton: { id: string; productId: string; date: Date };
    unitCost: number;
    sellingPrice: number | null;
    userId: string | null;
  },
  lines: { sizeId: string; quantity: number }[],
) {
  for (const line of lines) {
    const variantId = await ensureVariant(tx, ctx.carton.productId, line.sizeId, ctx.sellingPrice);
    await createCartonLine(tx, ctx, { variantId, sizeId: line.sizeId, quantity: line.quantity });
  }
}

/**
 * Dette fournisseur → paiement → écriture de journal, **posés à blanc** :
 * l'appelant efface au préalable le paiement et la dette de l'arrivage
 * (création : rien n'existe encore ; modification : le paiement a été
 * contre-passé puis supprimé). Aucun financement ici — il est propre à la
 * création.
 */
async function writeSettlement(
  tx: Db,
  arrival: { id: string; reference: string },
  plan: ArrivalPlan,
  input: { payment?: CreateArrivalInput['payment'] },
  userId: string | null,
) {
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
}

/** Cartons → lignes → lots → mouvements → dette → paiement → journal → financement. */
async function fillArrival(
  tx: Db,
  arrival: { id: string; reference: string; supplierId: string },
  plan: ArrivalPlan,
  input: CreateArrivalInput,
  userId: string | null,
) {
  for (const [index, carton] of input.cartons.entries()) {
    const planCarton = plan.cartons[index]!;

    const created = await tx.arrivalCarton.create({
      data: {
        reference: plan.references[index]!,
        arrivalId: arrival.id,
        productId: planCarton.productId,
        date: carton.date ?? plan.date,
        notes: carton.notes ?? null,
        totalCost: planCarton.totalCost,
        totalQty: planCarton.totalQty,
        sellingPrice: planCarton.sellingPrice,
        // Pointures listées à la saisie → ventilé d'office ; sinon « à ventiler ».
        ventilatedAt: planCarton.sizes.length > 0 ? new Date() : null,
      },
    });

    if (planCarton.sizes.length > 0) {
      await writeCartonLines(
        tx,
        {
          arrival,
          carton: { id: created.id, productId: planCarton.productId, date: created.date },
          unitCost: planCarton.unitCost,
          sellingPrice: planCarton.sellingPrice,
          userId,
        },
        planCarton.sizes,
      );
    }
  }

  await writeSettlement(tx, arrival, plan, input, userId);

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

/** Suppression d'un carton : mouvements `IN` → lots → lignes → carton. */
async function deleteCarton(tx: Db, cartonId: string) {
  const lots = await tx.stockLot.findMany({ where: { cartonId }, select: { id: true } });
  const items = await tx.arrivalItem.findMany({ where: { cartonId }, select: { id: true } });

  if (lots.length > 0) {
    const lotIds = lots.map((lot) => lot.id);
    await tx.stockMovement.deleteMany({ where: { lotId: { in: lotIds } } });
    await tx.stockLot.deleteMany({ where: { id: { in: lotIds } } });
  }
  if (items.length > 0) {
    await tx.arrivalItem.deleteMany({ where: { id: { in: items.map((item) => item.id) } } });
  }
  await tx.arrivalCarton.delete({ where: { id: cartonId } });
}

/**
 * Réconciliation des pointures d'un carton : les lignes conservées sont mises
 * à jour (`unitCost` compris — l'arrivage n'a pas encore bougé), les pointures
 * retirées suppriment leur lot et leur mouvement `IN`, les nouvelles sont
 * créées comme à la création.
 */
async function syncCartonLines(
  tx: Db,
  ctx: {
    arrival: { id: string; supplierId: string };
    carton: { id: string; productId: string; date: Date };
    unitCost: number;
    sellingPrice: number | null;
    userId: string | null;
  },
  lines: { sizeId: string; quantity: number }[],
) {
  const resolved: { variantId: string; sizeId: string; quantity: number }[] = [];
  for (const line of lines) {
    const variantId = await ensureVariant(tx, ctx.carton.productId, line.sizeId, ctx.sellingPrice);
    resolved.push({ variantId, sizeId: line.sizeId, quantity: line.quantity });
  }

  const items = await tx.arrivalItem.findMany({
    where: { cartonId: ctx.carton.id },
    include: { stockLots: true },
  });
  const kept = new Set(resolved.map((line) => line.variantId));
  const byVariant = new Map(items.map((item) => [item.variantId, item]));

  for (const item of items) {
    if (kept.has(item.variantId)) continue;
    const lot = item.stockLots[0];
    if (lot) {
      await tx.stockMovement.deleteMany({ where: { lotId: lot.id } });
      await tx.stockLot.delete({ where: { id: lot.id } });
    }
    await tx.arrivalItem.delete({ where: { id: item.id } });
  }

  for (const line of resolved) {
    const existing = byVariant.get(line.variantId);
    const lot = existing?.stockLots[0];
    if (!existing || !lot) {
      if (existing) await tx.arrivalItem.delete({ where: { id: existing.id } });
      await createCartonLine(tx, ctx, line);
      continue;
    }

    const lineTotal = line.quantity * ctx.unitCost;
    await tx.arrivalItem.update({
      where: { id: existing.id },
      data: { quantity: line.quantity, unitCost: ctx.unitCost, lineTotal },
    });
    await tx.stockLot.update({
      where: { id: lot.id },
      data: {
        initialQty: line.quantity,
        remainingQty: line.quantity,
        unitCost: ctx.unitCost,
        totalCost: lineTotal,
        sizeId: line.sizeId,
        entryDate: ctx.carton.date,
        supplierId: ctx.arrival.supplierId,
      },
    });

    const movement = await tx.stockMovement.findFirst({
      where: { lotId: lot.id, type: 'IN', refType: 'ARRIVAL', refId: ctx.arrival.id },
    });
    if (movement) {
      await tx.stockMovement.update({
        where: { id: movement.id },
        data: { delta: line.quantity, unitCost: ctx.unitCost, date: ctx.carton.date },
      });
    } else {
      await tx.stockMovement.create({
        data: {
          lotId: lot.id,
          variantId: line.variantId,
          type: 'IN',
          delta: line.quantity,
          unitCost: ctx.unitCost,
          refType: 'ARRIVAL',
          refId: ctx.arrival.id,
          date: ctx.carton.date,
          userId: ctx.userId,
        },
      });
    }
  }
}

/**
 * `PATCH /arrivals/:id` — correction complète d'un arrivage **avant qu'il ne
 * bouge** : fournisseur, date, notes, cartons (ajout / modification /
 * suppression), pointures et paiement.
 *
 * Refus (409) : arrivage annulé, stock déjà mouvementé (vente, ajustement ou
 * retour), versement ou règlement tardif sur la dette, financement posé avec
 * un changement de montant. Les cartons sont remplacés **en entier** : un
 * carton envoyé avec `id` est modifié, sans `id` il est ajouté, et un carton
 * existant absent de la liste est supprimé (lignes, lots et mouvements `IN`
 * compris).
 *
 * Le journal de caisse est contre-passé (`reverseEntries`) puis réécrit à
 * partir du nouveau paiement — la dette est supprimée et recréée, jamais
 * corrigée sur place.
 */
export async function updateArrival(id: string, input: UpdateArrivalInput, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.arrival.findUnique({
      where: { id },
      include: {
        cartons: true,
        lots: { select: { id: true } },
        debt: {
          include: { versements: { select: { id: true, date: true, personName: true, motif: true } } },
        },
        payments: { select: { id: true } },
        fundings: true,
      },
    });
    if (!current) throw notFound('Arrivage introuvable');
    if (current.status === 'CANCELLED') {
      throw conflict("Cet arrivage est annulé — impossible de le modifier");
    }

    // 1. Aucun mouvement de stock ne doit être venu toucher ses lots.
    const moved = await tx.stockMovement.count({
      where: {
        lotId: { in: current.lots.map((lot) => lot.id) },
        type: { in: ['OUT', 'ADJUSTMENT', 'RETURN'] },
      },
    });
    if (moved > 0) {
      throw conflict(
        "Impossible de modifier : le stock de cet arrivage a déjà bougé (vente, ajustement ou retour)",
      );
    }

    // 2. La dette est intacte : ni versement, ni règlement après la création.
    if (current.debt && current.debt.versements.length > 0) {
      const versement = current.debt.versements[0]!;
      throw conflict(
        `Un versement du ${versement.date.toISOString().slice(0, 10)} règle la dette de cet arrivage — annulez d'abord le versement`,
      );
    }
    if (current.payments.length > (current.paidAmount > 0 ? 1 : 0)) {
      throw conflict(
        'Un règlement a été enregistré après la création de cet arrivage — annulez-le avant de le modifier',
      );
    }

    // 3. Cartons : identifiants reconnus, jamais listés deux fois.
    const existingById = new Map(current.cartons.map((carton) => [carton.id, carton]));
    const sentIds = input.cartons
      .map((carton) => carton.id)
      .filter((cartonId): cartonId is string => Boolean(cartonId));
    if (new Set(sentIds).size !== sentIds.length) {
      throw businessRule('Un carton est listé deux fois dans cet arrivage');
    }
    for (const cartonId of sentIds) {
      if (!existingById.has(cartonId)) throw notFound(`Carton introuvable : ${cartonId}`);
    }

    const newTotalCost = input.cartons.reduce((sum, carton) => sum + carton.totalCost, 0);
    if (current.fundings.length > 0 && newTotalCost !== current.totalCost) {
      throw conflict("Cet arrivage est financé : son montant ne peut plus changer");
    }

    const plan = await planArrival(tx, input);

    await tx.arrival.update({
      where: { id },
      data: {
        supplierId: plan.supplierId,
        date: plan.date,
        notes: input.notes ?? null,
        totalQty: plan.totalQty,
        totalCost: plan.totalCost,
        paidAmount: plan.paid,
        unpaidAmount: plan.totalCost - plan.paid,
      },
    });
    await tx.stockLot.updateMany({ where: { arrivalId: id }, data: { supplierId: plan.supplierId } });

    const keptIds = new Set(sentIds);
    for (const carton of current.cartons) {
      if (!keptIds.has(carton.id)) await deleteCarton(tx, carton.id);
    }

    // Les références sont uniques par arrivage : on libère d'abord celles des
    // cartons conservés pour que deux cartons puissent s'échanger de référence.
    for (const carton of current.cartons) {
      if (!keptIds.has(carton.id)) continue;
      await tx.arrivalCarton.update({
        where: { id: carton.id },
        data: { reference: `#${carton.id}` },
      });
    }

    for (const [index, carton] of input.cartons.entries()) {
      const planCarton = plan.cartons[index]!;
      const date = carton.date ?? plan.date;
      const existing = carton.id ? existingById.get(carton.id) : undefined;

      const row = existing
        ? await tx.arrivalCarton.update({
            where: { id: existing.id },
            data: {
              reference: plan.references[index]!,
              productId: planCarton.productId,
              date,
              notes: carton.notes ?? null,
              totalCost: planCarton.totalCost,
              totalQty: planCarton.totalQty,
              sellingPrice: planCarton.sellingPrice,
              ventilatedAt:
                planCarton.sizes.length > 0 ? existing.ventilatedAt ?? new Date() : null,
            },
          })
        : await tx.arrivalCarton.create({
            data: {
              reference: plan.references[index]!,
              arrivalId: id,
              productId: planCarton.productId,
              date,
              notes: carton.notes ?? null,
              totalCost: planCarton.totalCost,
              totalQty: planCarton.totalQty,
              sellingPrice: planCarton.sellingPrice,
              ventilatedAt: planCarton.sizes.length > 0 ? new Date() : null,
            },
          });

      await syncCartonLines(
        tx,
        {
          arrival: { id, supplierId: plan.supplierId },
          carton: { id: row.id, productId: planCarton.productId, date: row.date },
          unitCost: planCarton.unitCost,
          sellingPrice: planCarton.sellingPrice,
          userId,
        },
        planCarton.sizes,
      );
    }

    // 4. Caisse et dette réécrites à blanc : journal contre-passé, paiement
    //    et dette supprimés, puis posés comme à la création.
    await reverseEntries(tx, 'ARRIVAL', id, `Modification arrivage ${current.reference}`, userId, {
      reference: `MODIFICATION ${current.reference}`,
    });
    await tx.payment.deleteMany({ where: { arrivalId: id } });
    if (current.debt) await tx.debt.delete({ where: { id: current.debt.id } });
    await writeSettlement(tx, { id, reference: current.reference }, plan, input, userId);

    return loadArrival(tx, id);
  });
}

/**
 * `POST /arrivals/:id/ventilate` — répartition des pointures d'un carton déjà
 * enregistré **sans pointures** (modèle, quantité et montant connus).
 *
 * Aucune écriture comptable : caisse, dette et journal ont été posés à
 * l'enregistrement de l'arrivage. Seul le stock se déplace, du « carton à
 * ventiler » vers des lots par pointure — la valorisation totale ne bouge pas.
 *
 * Prix d'achat unitaire **imposé** : `floor(montant du carton / quantité)` —
 * exactement la règle de la création. La somme des quantités doit être
 * exactement celle du carton, sinon rien n'est écrit (transaction).
 */
export async function ventilateArrival(id: string, input: VentilateInput, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const arrival = await tx.arrival.findUnique({ where: { id }, include: { cartons: true } });
    if (!arrival) throw notFound('Arrivage introuvable');
    if (arrival.status === 'CANCELLED') throw businessRule('Cet arrivage est annulé');

    const cartonById = new Map(arrival.cartons.map((carton) => [carton.id, carton]));
    const seen = new Set<string>();
    const sizeIds = new Set<string>();

    for (const entry of input.cartons) {
      const carton = cartonById.get(entry.cartonId);
      if (!carton) throw notFound(`Carton introuvable : ${entry.cartonId}`);
      if (seen.has(entry.cartonId)) {
        throw businessRule(`Le carton ${carton.reference} est listé deux fois`);
      }
      seen.add(entry.cartonId);
      if (carton.ventilatedAt) throw businessRule(`Le carton ${carton.reference} est déjà ventilé`);

      const quantity = entry.lines.reduce((sum, line) => sum + line.quantity, 0);
      if (quantity !== carton.totalQty) {
        throw businessRule(
          `Le carton ${carton.reference} : ${quantity} paires ventilées pour ${carton.totalQty} annoncées`,
        );
      }
      const lineSizes = entry.lines.map((line) => line.sizeId);
      if (new Set(lineSizes).size !== lineSizes.length) {
        throw businessRule(`Le carton ${carton.reference} : une pointure est listée deux fois`);
      }
      if (Math.floor(carton.totalCost / carton.totalQty) < 1) {
        throw businessRule(
          `Le carton ${carton.reference} : montant trop faible pour en dériver un prix unitaire`,
        );
      }
      lineSizes.forEach((sizeId) => sizeIds.add(sizeId));
    }

    const sizes = await tx.size.findMany({
      where: { id: { in: [...sizeIds] } },
      select: { id: true },
    });
    const knownSizes = new Set(sizes.map((size) => size.id));
    const unknownSize = [...sizeIds].find((sizeId) => !knownSizes.has(sizeId));
    if (unknownSize) throw notFound(`Pointure inconnue : ${unknownSize}`);

    for (const entry of input.cartons) {
      const carton = cartonById.get(entry.cartonId)!;

      await writeCartonLines(
        tx,
        {
          arrival: { id: arrival.id, supplierId: arrival.supplierId },
          carton: { id: carton.id, productId: carton.productId, date: carton.date },
          unitCost: Math.floor(carton.totalCost / carton.totalQty),
          sellingPrice: carton.sellingPrice,
          userId,
        },
        entry.lines,
      );

      await tx.arrivalCarton.update({
        where: { id: carton.id },
        data: { ventilatedAt: new Date() },
      });
    }

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
  /** Cartons encore sans pointures — `> 0` → arrivage à ventiler. */
  toVentilate: number;
  supplier: { id: string; name: string; phone: string | null };
}

export async function listArrivals(query: ArrivalListQuery) {
  const where = {
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.status ? { status: query.status } : {}),
    // `unventilated=true` → arrivages ayant encore des pointures à répartir
    // (les cartons annulés n'ont rien à ventiler).
    ...(query.unventilated === 'true'
      ? {
          cartons: { some: { ventilatedAt: null } },
          ...(query.status ? {} : { status: 'RECEIVED' as const }),
        }
      : {}),
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
      include: {
        supplier: { select: { id: true, name: true, phone: true } },
        cartons: { where: { ventilatedAt: null }, select: { id: true } },
      },
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
      toVentilate: a.cartons.length,
      supplier: a.supplier,
    })),
    ...pageMeta(total, query.page, query.limit),
  };
}

export async function previewArrivalReference(): Promise<string> {
  return peekReference(prisma, 'arrival');
}
