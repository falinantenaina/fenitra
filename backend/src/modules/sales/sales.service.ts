import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { businessRule, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { ilike, offset, pageMeta } from '../../lib/pagination';
import { allocateFIFO } from '../../services/fifo';
import { nextReference, peekReference } from '../../services/sequences';
import type { CreateSaleInput, SaleListQuery } from './sales.schemas';

type Db = Prisma.TransactionClient | typeof prisma;

const includeDetail = {
  customer: { select: { id: true, name: true, phone: true } },
  onlineSeller: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { id: true, name: true } },
  debt: true,
  payments: { orderBy: { date: 'asc' as const } },
  items: {
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          product: { select: { id: true, name: true, slug: true } },
          size: { select: { id: true, value: true, label: true } },
        },
      },
      lots: { include: { lot: { select: { id: true, code: true, entryDate: true, status: true } } } },
    },
  },
} satisfies Prisma.SaleInclude;

export async function loadSale(db: Db, id: string) {
  const sale = await db.sale.findUnique({ where: { id }, include: includeDetail });
  if (!sale) throw notFound('Vente introuvable');

  return {
    id: sale.id,
    reference: sale.reference,
    date: sale.date,
    status: sale.status,
    notes: sale.notes,
    paymentMethod: sale.paymentMethod,
    totalAmount: money(sale.totalAmount),
    paidAmount: money(sale.paidAmount),
    remainingAmount: money(sale.remainingAmount),
    cogs: money(sale.cogs),
    margin: money(sale.margin),
    customer: sale.customer,
    onlineSeller: sale.onlineSeller,
    createdBy: sale.createdBy,
    cancelledAt: sale.cancelledAt,
    cancelReason: sale.cancelReason,
    items: sale.items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      quantity: i.quantity,
      unitPrice: money(i.unitPrice),
      lineTotal: money(i.lineTotal),
      cogs: money(i.cogs),
      margin: money(i.lineTotal - i.cogs),
      product: i.variant.product,
      size: i.variant.size,
      sku: i.variant.sku,
      lots: i.lots.map((l) => ({
        lotId: l.lotId,
        code: l.lot.code,
        quantity: l.quantity,
        unitCost: money(l.unitCost),
        cost: money(l.quantity * l.unitCost),
        entryDate: l.lot.entryDate,
        status: l.lot.status,
      })),
    })),
    debt: sale.debt
      ? {
          id: sale.debt.id,
          type: sale.debt.type,
          direction: sale.debt.direction,
          origin: sale.debt.origin,
          reason: sale.debt.reason,
          status: sale.debt.status,
          initialAmount: money(sale.debt.initialAmount),
          paidAmount: money(sale.debt.paidAmount),
          remainingAmount: money(sale.debt.remainingAmount),
        }
      : null,
    payments: sale.payments.map((p) => ({
      id: p.id,
      reference: p.reference,
      date: p.date,
      amount: money(p.amount),
      direction: p.direction,
      method: p.method,
      notes: p.notes,
    })),
    createdAt: sale.createdAt,
    updatedAt: sale.updatedAt,
  };
}

function partyOf(input: CreateSaleInput): {
  partyType: 'CUSTOMER' | 'ONLINE_SELLER';
  partyId: string;
} | null {
  if (input.customerId) return { partyType: 'CUSTOMER', partyId: input.customerId };
  if (input.onlineSellerId) return { partyType: 'ONLINE_SELLER', partyId: input.onlineSellerId };
  return null;
}

/**
 * Enregistrement complet d'une vente — **une seule transaction** (§55) :
 * sortie FIFO (`SaleItemLot` figé au lot), COGS, marge, statut, dette
 * client / vendeur en ligne, paiement et écritures de journal.
 */
export async function createSale(input: CreateSaleInput, userId: string | null, idempotencyKey?: string | null) {
  return prisma.$transaction(async (tx) => {
    const party = partyOf(input);

    if (input.customerId) {
      const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw notFound('Client introuvable');
      if (!customer.active) throw businessRule('Ce client est désactivé');
    }
    if (input.onlineSellerId) {
      const seller = await tx.onlineSeller.findUnique({ where: { id: input.onlineSellerId } });
      if (!seller) throw notFound('Vendeur en ligne introuvable');
      if (!seller.active) throw businessRule('Ce vendeur en ligne est désactivé');
    }

    const variantIds = [...new Set(input.items.map((i) => i.variantId))];
    const variants = await tx.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, sizeId: true, active: true, product: { select: { id: true, name: true } } },
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const unknown = variantIds.find((id) => !variantById.has(id));
    if (unknown) throw notFound(`Article introuvable : ${unknown}`);
    const inactive = variants.find((v) => !v.active);
    if (inactive) throw businessRule(`L'article ${inactive.product.name} est désactivé`);

    const totalAmount = input.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    const paid = input.payment?.amount ?? 0;

    if (paid > totalAmount) {
      throw businessRule(`Le paiement (${money(paid)}) dépasse le montant de la vente (${money(totalAmount)})`);
    }

    const date = input.date ?? new Date();
    const reference = await nextReference(tx, 'sale');

    const sale = await tx.sale.create({
      data: {
        reference,
        date,
        customerId: input.customerId ?? null,
        onlineSellerId: input.onlineSellerId ?? null,
        totalAmount,
        paidAmount: paid,
        remainingAmount: totalAmount - paid,
        paymentMethod: input.paymentMethod ?? input.payment?.method ?? null,
        notes: input.notes ?? null,
        createdById: userId,
        idempotencyKey: idempotencyKey ?? null,
      },
    });

    let saleCogs = 0;
    for (const item of input.items) {
      const variant = variantById.get(item.variantId)!;

      const { allocations, totalCost } = await allocateFIFO(tx, item.variantId, item.quantity, {
        type: 'OUT',
        refType: 'SALE',
        refId: sale.id,
        date,
        userId,
      });

      const lineTotal = item.quantity * item.unitPrice;
      const saleItem = await tx.saleItem.create({
        data: {
          saleId: sale.id,
          variantId: variant.id,
          sizeId: variant.sizeId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal,
          cogs: totalCost,
        },
      });

      for (const a of allocations) {
        await tx.saleItemLot.create({
          data: { saleItemId: saleItem.id, lotId: a.lotId, quantity: a.quantity, unitCost: a.unitCost },
        });
      }

      saleCogs += totalCost;
    }

    const remaining = totalAmount - paid;
    const status = remaining === 0 ? ('PAID' as const) : paid > 0 ? ('PARTIAL' as const) : ('UNPAID' as const);

    await tx.sale.update({
      where: { id: sale.id },
      data: { cogs: saleCogs, margin: totalAmount - saleCogs, remainingAmount: remaining, status },
    });

    let debtId: string | null = null;
    if (remaining > 0) {
      const label =
        input.items.length === 1
          ? variantById.get(input.items[0]!.variantId)!.product.name
          : `${input.items.length} articles`;

      const debt = await tx.debt.create({
        data: {
          type: party?.partyType === 'CUSTOMER' ? 'CUSTOMER' : 'ONLINE_SELLER',
          direction: 'RECEIVABLE',
          origin: 'SALE',
          saleId: sale.id,
          customerId: input.customerId ?? null,
          onlineSellerId: input.onlineSellerId ?? null,
          reason: `Achat de ${label} — ${paid > 0 ? 'paiement partiel' : 'non payé'}`,
          initialAmount: totalAmount,
          paidAmount: paid,
          remainingAmount: remaining,
          date,
          status: paid > 0 ? 'PARTIAL' : 'OPEN',
        },
      });
      debtId = debt.id;
    }

    let paymentId: string | null = null;
    if (paid > 0) {
      const payment = await tx.payment.create({
        data: {
          reference: await nextReference(tx, 'payment'),
          date: input.payment?.date ?? date,
          amount: paid,
          direction: 'IN',
          partyType: party?.partyType ?? 'OTHER',
          partyId: party?.partyId ?? null,
          saleId: sale.id,
          debtId,
          method: input.payment?.method ?? input.paymentMethod ?? null,
          notes: input.payment?.notes ?? null,
          userId,
        },
      });
      paymentId = payment.id;
    }

    await tx.ledgerEntry.create({
      data: {
        date,
        kind: 'SALE',
        amount: totalAmount,
        cashDelta: paid,
        description: `Vente ${reference}${party ? ` — ${party.partyType === 'CUSTOMER' ? 'client' : 'vendeur en ligne'}` : ''}`,
        reference,
        refType: 'SALE',
        refId: sale.id,
        saleId: sale.id,
        debtId,
        paymentId,
        userId,
      },
    });

    if (saleCogs > 0) {
      await tx.ledgerEntry.create({
        data: {
          date,
          kind: 'COGS',
          amount: saleCogs,
          cashDelta: 0,
          description: `Coût des articles vendus — vente ${reference}`,
          reference,
          refType: 'SALE',
          refId: sale.id,
          saleId: sale.id,
          userId,
        },
      });
    }

    return loadSale(tx, sale.id);
  });
}

/** Règlement partiel ou total d'une vente déjà enregistrée. */
export async function addSalePayment(saleId: string, input: { amount: number; method?: string | null; date?: Date; notes?: string | null }, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { debt: true } });
    if (!sale) throw notFound('Vente introuvable');
    if (sale.status === 'CANCELLED') throw businessRule('Cette vente est annulée');
    if (sale.remainingAmount <= 0) throw businessRule('Cette vente est déjà réglée');
    if (input.amount > sale.remainingAmount) {
      throw businessRule(
        `Le paiement (${money(input.amount)}) dépasse le reste à payer (${money(sale.remainingAmount)})`,
      );
    }

    const partyType =
      sale.customerId ? 'CUSTOMER' : sale.onlineSellerId ? 'ONLINE_SELLER' : ('OTHER' as const);
    const date = input.date ?? new Date();

    const payment = await tx.payment.create({
      data: {
        reference: await nextReference(tx, 'payment'),
        date,
        amount: input.amount,
        direction: 'IN',
        partyType,
        partyId: sale.customerId ?? sale.onlineSellerId,
        saleId: sale.id,
        debtId: sale.debt?.id ?? null,
        method: input.method ?? sale.paymentMethod,
        notes: input.notes ?? null,
        userId,
      },
    });

    const paidAmount = sale.paidAmount + input.amount;
    const remainingAmount = sale.remainingAmount - input.amount;

    await tx.sale.update({
      where: { id: sale.id },
      data: {
        paidAmount,
        remainingAmount,
        status: remainingAmount === 0 ? 'PAID' : 'PARTIAL',
      },
    });

    if (sale.debt) {
      const debtPaid = sale.debt.paidAmount + input.amount;
      await tx.debt.update({
        where: { id: sale.debt.id },
        data: {
          paidAmount: debtPaid,
          remainingAmount: sale.debt.remainingAmount - input.amount,
          status: sale.debt.remainingAmount - input.amount === 0 ? 'PAID' : 'PARTIAL',
        },
      });
    }

    const kind = sale.customerId ? 'CUSTOMER_PAYMENT' : 'ONLINE_SELLER_PAYMENT';
    await tx.ledgerEntry.create({
      data: {
        date,
        kind,
        amount: input.amount,
        cashDelta: input.amount,
        description: `Règlement vente ${sale.reference}`,
        reference: payment.reference,
        refType: 'SALE',
        refId: sale.id,
        saleId: sale.id,
        debtId: sale.debt?.id ?? null,
        paymentId: payment.id,
        userId,
      },
    });

    return loadSale(tx, sale.id);
  });
}

/**
 * Annulation d'une vente : les quantités reviennent **dans les mêmes lots**
 * (`SaleItemLot`, §7), les dettes sont annulées et **chaque écriture de
 * journal positive de la vente est contre-passée** (kind identique, montants
 * négatifs) — `Σ amount WHERE kind='SALE'` reste exact.
 */
export async function cancelSale(saleId: string, reason: string, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { lots: true } }, debt: true },
    });
    if (!sale) throw notFound('Vente introuvable');
    if (sale.status === 'CANCELLED') throw businessRule('Cette vente est déjà annulée');

    const now = new Date();

    for (const item of sale.items) {
      for (const alloc of item.lots) {
        const lot = await tx.stockLot.findUnique({ where: { id: alloc.lotId } });
        if (!lot) throw notFound('Lot introuvable lors de la restitution');
        if (lot.status === 'CANCELLED') {
          throw businessRule('Un lot d\'origine est annulé — annulation impossible');
        }

        await tx.stockLot.update({
          where: { id: lot.id },
          data: { remainingQty: { increment: alloc.quantity } },
        });

        await tx.stockMovement.create({
          data: {
            lotId: lot.id,
            variantId: item.variantId,
            type: 'RETURN',
            delta: alloc.quantity,
            unitCost: alloc.unitCost,
            refType: 'SALE',
            refId: sale.id,
            date: now,
            notes: `Annulation ${sale.reference} — ${reason}`,
            userId,
          },
        });
      }
    }

    if (sale.debt) {
      await tx.debt.update({
        where: { id: sale.debt.id },
        data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason },
      });
    }

    const entries = await tx.ledgerEntry.findMany({
      where: { refType: 'SALE', refId: sale.id, amount: { gt: 0 } },
    });
    for (const e of entries) {
      await tx.ledgerEntry.create({
        data: {
          date: now,
          kind: e.kind,
          amount: -e.amount,
          cashDelta: -e.cashDelta,
          description: `Annulation ${sale.reference} — ${reason}`,
          reference: `ANNULATION ${sale.reference}`,
          refType: 'SALE',
          refId: sale.id,
          saleId: e.saleId,
          debtId: e.debtId,
          paymentId: e.paymentId,
          arrivalId: e.arrivalId,
          expenseId: e.expenseId,
          versementId: e.versementId,
          userId,
        },
      });
    }

    await tx.sale.update({
      where: { id: sale.id },
      data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason },
    });

    return loadSale(tx, sale.id);
  });
}

const saleToRow = (s: {
  id: string;
  reference: string;
  date: Date;
  status: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  cogs: number;
  margin: number;
  customer: { id: string; name: string; phone: string | null } | null;
  onlineSeller: { id: string; name: string; phone: string | null } | null;
}) => ({
  id: s.id,
  reference: s.reference,
  date: s.date,
  status: s.status,
  totalAmount: money(s.totalAmount),
  paidAmount: money(s.paidAmount),
  remainingAmount: money(s.remainingAmount),
  cogs: money(s.cogs),
  margin: money(s.margin),
  customer: s.customer,
  onlineSeller: s.onlineSeller,
});

export async function listSales(query: SaleListQuery) {
  const where = {
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.onlineSellerId ? { onlineSellerId: query.onlineSellerId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.variantId ? { items: { some: { variantId: query.variantId } } } : {}),
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(ilike(query.q) ? { reference: ilike(query.q) } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      orderBy: [{ date: 'desc' }, { reference: 'desc' }],
      skip: offset(query),
      take: query.limit,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        onlineSeller: { select: { id: true, name: true, phone: true } },
      },
    }),
    prisma.sale.count({ where }),
  ]);

  return { items: items.map(saleToRow), ...pageMeta(total, query.page, query.limit) };
}

export async function previewSaleReference(): Promise<string> {
  return peekReference(prisma, 'sale');
}
