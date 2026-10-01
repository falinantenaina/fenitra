import type { Prisma } from '@prisma/client';
import { DebtDirection, DebtStatus, DebtType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest, businessRule, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { ilike, offset, pageMeta } from '../../lib/pagination';
import { nextReference } from '../../services/sequences';
import {
  PARTY_TYPE,
  PAYMENT_KIND,
  type CreateDebtInput,
  type DebtListQuery,
  type DebtPaymentInput,
  type PaymentListQuery,
} from './debts.schemas';

type Db = Prisma.TransactionClient | typeof prisma;

const partySelect = {
  customer: { select: { id: true, name: true, phone: true } },
  onlineSeller: { select: { id: true, name: true, phone: true } },
  supplier: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.DebtInclude;

function directionOf(type: DebtType): DebtDirection {
  // A1 : une dette TROSA SINOA est toujours une dette que JE DOIS (payable).
  return type === 'TROSA_SINOA' || type === 'SUPPLIER' ? 'PAYABLE' : 'RECEIVABLE';
}

function partyLabel(type: DebtType): string {
  return type === 'CUSTOMER'
    ? 'client'
    : type === 'ONLINE_SELLER'
      ? 'vendeur en ligne'
      : type === 'SUPPLIER'
        ? 'fournisseur'
        : 'trosa sinoa';
}

export function debtRow(d: {
  id: string;
  type: DebtType;
  direction: DebtDirection;
  origin: string;
  status: DebtStatus;
  partyName: string | null;
  reason: string;
  initialAmount: number;
  paidAmount: number;
  remainingAmount: number;
  date: Date;
  dueDate: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  saleId: string | null;
  arrivalId: string | null;
  customer?: { id: string; name: string; phone: string | null } | null;
  onlineSeller?: { id: string; name: string; phone: string | null } | null;
  supplier?: { id: string; name: string; phone: string | null } | null;
}) {
  const party =
    d.type === 'TROSA_SINOA'
      ? { name: d.partyName }
      : (d.customer ?? d.onlineSeller ?? d.supplier ?? null);

  return {
    id: d.id,
    type: d.type,
    direction: d.direction,
    origin: d.origin,
    status: d.status,
    party,
    reason: d.reason,
    initialAmount: money(d.initialAmount),
    paidAmount: money(d.paidAmount),
    remainingAmount: money(d.remainingAmount),
    date: d.date,
    dueDate: d.dueDate,
    cancelledAt: d.cancelledAt,
    cancelReason: d.cancelReason,
    saleId: d.saleId,
    arrivalId: d.arrivalId,
  };
}

export async function loadDebt(db: Db, id: string) {
  const debt = await db.debt.findUnique({
    where: { id },
    include: {
      ...partySelect,
      payments: { orderBy: { date: 'asc' }, include: { user: { select: { id: true, name: true } } } },
      versements: { select: { id: true, personName: true, motif: true, amount: true, date: true } },
    },
  });
  if (!debt) throw notFound('Dette introuvable');

  const history = await db.ledgerEntry.findMany({
    where: { debtId: debt.id },
    orderBy: { seq: 'asc' },
  });

  return {
    ...debtRow(debt),
    payments: debt.payments.map(paymentRow),
    history: history.map((e) => ({
      id: e.id,
      date: e.date,
      kind: e.kind,
      amount: money(e.amount),
      cashDelta: money(e.cashDelta),
      description: e.description,
      reference: e.reference,
    })),
    versements: debt.versements,
  };
}

const paymentRow = (p: {
  id: string;
  reference: string;
  date: Date;
  amount: number;
  direction: string;
  partyType: string;
  debtId: string | null;
  saleId: string | null;
  arrivalId: string | null;
  method: string | null;
  notes: string | null;
  user?: { id: string; name: string } | null;
}) => ({
  id: p.id,
  reference: p.reference,
  date: p.date,
  amount: money(p.amount),
  direction: p.direction,
  partyType: p.partyType,
  debtId: p.debtId,
  saleId: p.saleId,
  arrivalId: p.arrivalId,
  method: p.method,
  notes: p.notes,
  user: p.user ?? undefined,
});

/**
 * Création manuelle d'une dette (§30 — motif obligatoire, généré si absent).
 *
 * **Équilibre comptable** : une dette déclarée doit s'accompagner d'un
 * contreparti de trésorerie, sinon l'identité
 * `caisse + stock + créances − passifs = K + (CA − COGS − charges …)` est
 * rompue. Le contreparti est une écriture `OTHER` sans impact sur les
 * indicateurs de flux :
 *   - créance (client / vendeur) : `cashDelta = −X` → l'argent a été avancé ;
 *   - dette fournisseur : `cashDelta = +X` → le crédit a été encaissé ;
 *   - TROSA SINOA (A1) : écriture `TROSA_BORROW` `cashDelta = +X`.
 */
export async function createDebt(input: CreateDebtInput, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    let customer = null;
    let onlineSeller = null;
    let supplier = null;
    let autoReason = '';

    if (input.type === 'TROSA_SINOA') {
      if (!input.partyName) throw badRequest('Le nom de la personne est requis pour une trosa sinoa');
      if (input.customerId || input.onlineSellerId || input.supplierId) {
        throw badRequest('Une trosa sinoa ne peut pas être liée à un tiers enregistré');
      }
      autoReason = `Trosa sinoa — ${input.partyName}`;
    } else if (input.partyName) {
      throw badRequest(`Le champ partyName n'est pas autorisé pour une dette ${partyLabel(input.type)}`);
    }

    if (input.type === 'CUSTOMER') {
      if (!input.customerId) throw badRequest('Un client est requis pour une dette client');
      customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw notFound('Client introuvable');
      if (!customer.active) throw businessRule('Ce client est désactivé');
      autoReason = `Dette client déclarée — ${customer.name}`;
    } else if (input.type === 'ONLINE_SELLER') {
      if (!input.onlineSellerId) throw badRequest('Un vendeur en ligne est requis pour ce type de dette');
      onlineSeller = await tx.onlineSeller.findUnique({ where: { id: input.onlineSellerId } });
      if (!onlineSeller) throw notFound('Vendeur en ligne introuvable');
      if (!onlineSeller.active) throw businessRule('Ce vendeur en ligne est désactivé');
      autoReason = `Dette vendeur en ligne déclarée — ${onlineSeller.name}`;
    } else if (input.type === 'SUPPLIER') {
      if (!input.supplierId) throw badRequest('Un fournisseur est requis pour une dette fournisseur');
      supplier = await tx.supplier.findUnique({ where: { id: input.supplierId } });
      if (!supplier) throw notFound('Fournisseur introuvable');
      if (!supplier.active) throw businessRule('Ce fournisseur est désactivé');
      autoReason = `Dette fournisseur déclarée — ${supplier.name}`;
    }

    if (input.paidAmount > input.amount) {
      throw businessRule('Le règlement initial dépasse le montant de la dette');
    }

    const date = input.date ?? new Date();
    const direction = directionOf(input.type);
    const remaining = input.amount - input.paidAmount;

    const debt = await tx.debt.create({
      data: {
        type: input.type,
        direction,
        origin: 'MANUAL',
        customerId: input.customerId ?? null,
        onlineSellerId: input.onlineSellerId ?? null,
        supplierId: input.supplierId ?? null,
        partyName: input.partyName ?? null,
        reason: input.reason ?? autoReason,
        initialAmount: input.amount,
        paidAmount: input.paidAmount,
        remainingAmount: remaining,
        date,
        dueDate: input.dueDate ?? null,
        status: remaining === 0 ? 'PAID' : input.paidAmount > 0 ? 'PARTIAL' : 'OPEN',
      },
    });

    const entry = await tx.ledgerEntry.create({
      data: {
        date,
        kind: input.type === 'TROSA_SINOA' ? 'TROSA_BORROW' : 'OTHER',
        amount: input.amount,
        cashDelta: input.type === 'TROSA_SINOA' ? input.amount : direction === 'PAYABLE' ? input.amount : -input.amount,
        description:
          input.type === 'TROSA_SINOA'
            ? `Trosa sinoa — ${input.partyName} (${debt.reason})`
            : `Dette ${partyLabel(input.type)} déclarée — ${debt.reason}`,
        reference: null,
        refType: 'DEBT',
        refId: debt.id,
        debtId: debt.id,
        userId,
      },
    });

    if (input.paidAmount > 0) {
      await applyPayment(tx, {
        debt,
        amount: input.paidAmount,
        method: input.method ?? null,
        date,
        notes: null,
        userId,
        reference: 'Règlement initial',
      });
      await tx.debt.update({
        where: { id: debt.id },
        data: {
          paidAmount: input.paidAmount,
          remainingAmount: remaining,
          status: remaining === 0 ? 'PAID' : 'PARTIAL',
        },
      });
    }

    return loadDebt(tx, debt.id).then((d) => ({ ...d, creationEntryId: entry.id }));
  });
}

interface ApplyPaymentArgs {
  debt: {
    id: string;
    type: DebtType;
    direction: DebtDirection;
    origin: string;
    status: DebtStatus;
    reason: string;
    initialAmount: number;
    paidAmount: number;
    remainingAmount: number;
    saleId: string | null;
    arrivalId: string | null;
    customerId: string | null;
    onlineSellerId: string | null;
    supplierId: string | null;
  };
  amount: number;
  method: string | null;
  date: Date;
  notes: string | null;
  userId: string | null;
  reference?: string;
}

/** Écriture partagée d'un règlement : `Payment` + mise à jour de la dette + journal. */
async function applyPayment(tx: Db, args: ApplyPaymentArgs) {
  const { debt, amount, method, date, notes, userId } = args;

  const payment = await tx.payment.create({
    data: {
      reference: await nextReference(tx, 'payment'),
      date,
      amount,
      direction: debt.direction === 'RECEIVABLE' ? 'IN' : 'OUT',
      partyType: PARTY_TYPE[debt.type],
      partyId: debt.customerId ?? debt.onlineSellerId ?? debt.supplierId,
      debtId: debt.id,
      saleId: debt.saleId,
      arrivalId: debt.arrivalId,
      method,
      notes,
      userId,
    },
  });

  await tx.ledgerEntry.create({
    data: {
      date,
      kind: PAYMENT_KIND[debt.type],
      amount,
      cashDelta: debt.direction === 'RECEIVABLE' ? amount : -amount,
      description: `Règlement ${debt.reason}${args.reference ? ` — ${args.reference}` : ''}`,
      reference: payment.reference,
      refType: 'DEBT',
      refId: debt.id,
      debtId: debt.id,
      saleId: debt.saleId,
      arrivalId: debt.arrivalId,
      paymentId: payment.id,
      userId,
    },
  });

  return payment;
}

/** Règlement partiel ou total d'une dette (§7 — paiements multiples). */
export async function payDebt(debtId: string, input: DebtPaymentInput, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const debt = await tx.debt.findUnique({ where: { id: debtId } });
    if (!debt) throw notFound('Dette introuvable');
    if (debt.status === 'CANCELLED') throw businessRule('Cette dette est annulée');
    if (debt.remainingAmount <= 0) throw businessRule('Cette dette est déjà réglée');
    if (input.amount > debt.remainingAmount) {
      throw businessRule(
        `Le règlement (${money(input.amount)}) dépasse le reste à payer (${money(debt.remainingAmount)})`,
      );
    }

    const date = input.date ?? new Date();
    await applyPayment(tx, { debt, amount: input.amount, method: input.method ?? null, date, notes: input.notes ?? null, userId });

    const paidAmount = debt.paidAmount + input.amount;
    const remainingAmount = debt.remainingAmount - input.amount;

    await tx.debt.update({
      where: { id: debt.id },
      data: {
        paidAmount,
        remainingAmount,
        status: remainingAmount === 0 ? 'PAID' : 'PARTIAL',
      },
    });

    return loadDebt(tx, debt.id);
  });
}

/**
 * Annulation d'une dette manuelle : contre-passation de **toutes** les
 * écritures positives liées à la dette (création + règlements).
 * Une dette née d'une vente ou d'un arrivage ne peut pas être annulée seule —
 * il faut annuler le document d'origine.
 */
export async function cancelDebt(debtId: string, reason: string, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const debt = await tx.debt.findUnique({
      where: { id: debtId },
      include: { versements: { select: { id: true, personName: true, motif: true, date: true } } },
    });
    if (!debt) throw notFound('Dette introuvable');
    if (debt.status === 'CANCELLED') throw businessRule('Cette dette est déjà annulée');
    if (debt.origin !== 'MANUAL') {
      throw businessRule(
        debt.origin === 'SALE'
          ? 'Dette née d\'une vente : annulez la vente correspondante'
          : 'Dette née d\'un arrivage : annulez l\'arrivage correspondant',
      );
    }
    if (debt.versements.length > 0) {
      const v = debt.versements[0]!;
      throw businessRule(
        `Cette dette est liée au versement du ${v.date.toISOString().slice(0, 10)} (${v.motif}) — annulez d'abord le versement`,
      );
    }

    const now = new Date();
    const entries = await tx.ledgerEntry.findMany({
      where: { debtId: debt.id, amount: { gt: 0 } },
    });

    for (const e of entries) {
      await tx.ledgerEntry.create({
        data: {
          date: now,
          kind: e.kind,
          amount: -e.amount,
          cashDelta: -e.cashDelta,
          description: `Annulation dette — ${reason}`,
          reference: e.reference ? `ANNULATION ${e.reference}` : null,
          refType: 'DEBT',
          refId: debt.id,
          debtId: debt.id,
          paymentId: e.paymentId,
          saleId: e.saleId,
          arrivalId: e.arrivalId,
          userId,
        },
      });
    }

    await tx.debt.update({
      where: { id: debt.id },
      data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason },
    });

    return loadDebt(tx, debt.id);
  });
}

export async function listDebts(query: DebtListQuery) {
  const where: Prisma.DebtWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : { status: { not: 'CANCELLED' } }),
    ...(query.partyId
      ? {
          OR: [
            { customerId: query.partyId },
            { onlineSellerId: query.partyId },
            { supplierId: query.partyId },
          ],
        }
      : {}),
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(ilike(query.q) ? { reason: ilike(query.q) } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.debt.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: offset(query),
      take: query.limit,
      include: partySelect,
    }),
    prisma.debt.count({ where }),
  ]);

  return { items: items.map(debtRow), ...pageMeta(total, query.page, query.limit) };
}

/** Synthèse des dettes par type (§30) — destinée au tableau de bord. */
export async function debtsSummary() {
  const groups = await prisma.debt.groupBy({
    by: ['type'],
    where: { status: { not: 'CANCELLED' } },
    _count: { _all: true },
    _sum: { initialAmount: true, paidAmount: true, remainingAmount: true },
  });

  const bucket = (type: DebtType) => {
    const g = groups.find((x) => x.type === type);
    return {
      count: g?._count._all ?? 0,
      initialAmount: money(g?._sum.initialAmount ?? 0),
      paidAmount: money(g?._sum.paidAmount ?? 0),
      remainingAmount: money(g?._sum.remainingAmount ?? 0),
    };
  };

  const customer = bucket('CUSTOMER');
  const onlineSeller = bucket('ONLINE_SELLER');
  const supplier = bucket('SUPPLIER');
  const trosaSinoa = bucket('TROSA_SINOA');

  const receivable =
    (groups.find((x) => x.type === 'CUSTOMER')?._sum.remainingAmount ?? 0) +
    (groups.find((x) => x.type === 'ONLINE_SELLER')?._sum.remainingAmount ?? 0);
  const payable =
    (groups.find((x) => x.type === 'SUPPLIER')?._sum.remainingAmount ?? 0) +
    (groups.find((x) => x.type === 'TROSA_SINOA')?._sum.remainingAmount ?? 0);

  return {
    customer,
    onlineSeller,
    supplier,
    trosaSinoa,
    totals: {
      receivable: money(receivable),
      payable: money(payable),
      net: money(receivable - payable),
    },
  };
}

export async function listPayments(query: PaymentListQuery) {
  const where: Prisma.PaymentWhereInput = {
    ...(query.direction ? { direction: query.direction } : {}),
    ...(query.partyType ? { partyType: query.partyType } : {}),
    ...(query.debtId ? { debtId: query.debtId } : {}),
    ...(query.saleId ? { saleId: query.saleId } : {}),
    ...(query.arrivalId ? { arrivalId: query.arrivalId } : {}),
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(ilike(query.q) ? { reference: ilike(query.q) } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: [{ date: 'desc' }, { reference: 'desc' }],
      skip: offset(query),
      take: query.limit,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.payment.count({ where }),
  ]);

  return { items: items.map(paymentRow), ...pageMeta(total, query.page, query.limit) };
}
