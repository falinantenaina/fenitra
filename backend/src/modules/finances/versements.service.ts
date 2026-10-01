import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { businessRule, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { ilike, offset, pageMeta } from '../../lib/pagination';
import { PAYMENT_KIND } from '../debts/debts.schemas';
import { reverseEntries } from '../../services/ledger';
import type {
  CreateVersementInput,
  SummaryQuery,
  UpdateVersementInput,
  VersementListQuery,
} from './versements.schemas';

const versementRow = (v: {
  id: string;
  personName: string;
  amount: number;
  date: Date;
  motif: string;
  method: string | null;
  comment: string | null;
  treatment: string;
  debtId: string | null;
  user?: { id: string; name: string } | null;
}) => ({
  id: v.id,
  personName: v.personName,
  amount: money(v.amount),
  date: v.date,
  motif: v.motif,
  method: v.method,
  comment: v.comment,
  treatment: v.treatment,
  debtId: v.debtId,
  user: v.user ?? undefined,
});

type Db = Prisma.TransactionClient | typeof prisma;

/** Dette payable encore ouverte pour cette personne (A2 — détection automatique). */
async function findOpenPayableDebt(tx: Db, personName: string) {
  return tx.debt.findFirst({
    where: {
      type: 'TROSA_SINOA',
      status: { in: ['OPEN', 'PARTIAL'] },
      remainingAmount: { gt: 0 },
      partyName: { equals: personName, mode: 'insensitive' },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
}

/**
 * POST /versements — §37-§38, décision **A2** :
 * `treatment` absent → `DEBT_SETTLEMENT` si une dette TROSA ouverte existe pour
 * cette personne, sinon `CHARGE`.
 *
 *   CHARGE          → écriture `VERSEMENT`   (réduit le bénéfice net)
 *   DEBT_SETTLEMENT → écriture `TROSA_REPAY` (n'affecte pas le bénéfice, règle la dette)
 */
export async function createVersement(input: CreateVersementInput, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const date = input.date ?? new Date();
    let debt =
      input.debtId != null
        ? await tx.debt.findUnique({ where: { id: input.debtId } })
        : await findOpenPayableDebt(tx, input.personName);

    if (input.treatment === 'CHARGE' && !input.debtId) debt = null;

    if (input.debtId && !debt) throw notFound('Dette introuvable');

    const treatment =
      input.treatment ?? (debt && debt.status !== 'CANCELLED' ? 'DEBT_SETTLEMENT' : 'CHARGE');

    if (treatment === 'DEBT_SETTLEMENT') {
      if (!debt) {
        throw businessRule('Aucune dette TROSA ouverte pour cette personne — versement traité en charge');
      }
      if (debt.direction !== 'PAYABLE') throw businessRule('Seule une dette à payer peut être réglée ici');
      if (debt.status === 'CANCELLED') throw businessRule('Cette dette est annulée');
      if (input.amount > debt.remainingAmount) {
        throw businessRule(
          `Le versement (${money(input.amount)}) dépasse la dette restante (${money(debt.remainingAmount)})`,
        );
      }
    } else {
      debt = null;
    }

    const versement = await tx.versement.create({
      data: {
        personName: input.personName,
        amount: input.amount,
        date,
        motif: input.motif,
        method: input.method ?? null,
        comment: input.comment ?? null,
        treatment,
        debtId: debt?.id ?? null,
        userId,
      },
    });

    if (debt) {
      const remainingAmount = debt.remainingAmount - input.amount;
      await tx.debt.update({
        where: { id: debt.id },
        data: {
          paidAmount: debt.paidAmount + input.amount,
          remainingAmount,
          status: remainingAmount === 0 ? 'PAID' : 'PARTIAL',
        },
      });
    }

    const kind = debt ? PAYMENT_KIND[debt.type] : 'VERSEMENT';

    await tx.ledgerEntry.create({
      data: {
        date,
        kind,
        amount: input.amount,
        cashDelta: -input.amount,
        description: `Versement ${input.personName} — ${input.motif}`,
        reference: null,
        refType: 'VERSEMENT',
        refId: versement.id,
        versementId: versement.id,
        debtId: debt?.id ?? null,
        userId,
      },
    });

    return loadVersement(tx, versement.id);
  });
}

export async function loadVersement(db: Prisma.TransactionClient | typeof prisma, id: string) {
  const v = await db.versement.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true } }, debt: { select: { id: true, reason: true } } },
  });
  if (!v) throw notFound('Versement introuvable');
  return { ...versementRow(v), debt: v.debt };
}

export async function listVersements(query: VersementListQuery) {
  const where: Prisma.VersementWhereInput = {
    ...(query.personName
      ? { personName: { contains: query.personName, mode: 'insensitive' } }
      : {}),
    ...(query.treatment ? { treatment: query.treatment } : {}),
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(ilike(query.q) ? { motif: ilike(query.q) } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.versement.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: offset(query),
      take: query.limit,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.versement.count({ where }),
  ]);

  return { items: items.map(versementRow), ...pageMeta(total, query.page, query.limit) };
}

/** PUT /versements/:id — uniquement les métadonnées (montant et traitement sont figés). */
export async function updateVersement(id: string, input: UpdateVersementInput) {
  const existing = await prisma.versement.findUnique({ where: { id } });
  if (!existing) throw notFound('Versement introuvable');

  await prisma.versement.update({
    where: { id },
    data: {
      motif: input.motif,
      method: input.method ?? null,
      comment: input.comment ?? null,
      ...(input.date ? { date: input.date } : {}),
    },
  });

  return loadVersement(prisma, id);
}

/**
 * DELETE /versements/:id — contre-passation du solde net + annulation de
 * l'effet sur la dette liée éventuelle.
 */
export async function deleteVersement(id: string, reason: string, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const v = await tx.versement.findUnique({ where: { id } });
    if (!v) throw notFound('Versement introuvable');

    await reverseEntries(tx, 'VERSEMENT', id, `Annulation versement — ${reason}`, userId);

    if (v.debtId) {
      const debt = await tx.debt.findUnique({ where: { id: v.debtId } });
      if (debt) {
        const paidAmount = debt.paidAmount - v.amount;
        const remainingAmount = debt.remainingAmount + v.amount;
        await tx.debt.update({
          where: { id: debt.id },
          data: {
            paidAmount,
            remainingAmount,
            status: remainingAmount === 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'OPEN',
          },
        });
      }
    }

    await tx.versement.delete({ where: { id } });

    return { id, deleted: true, refundedAmount: money(v.amount), reason };
  });
}

/** §38 — historique par personne. */
export async function versementsSummary(query: SummaryQuery) {
  const where: Prisma.VersementWhereInput = {
    ...(query.personName
      ? { personName: { contains: query.personName, mode: 'insensitive' } }
      : {}),
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };

  const groups = await prisma.versement.groupBy({
    by: ['personName', 'treatment'],
    where,
    _count: { _all: true },
    _sum: { amount: true },
    _max: { date: true },
  });

  const byPerson = new Map<
    string,
    { personName: string; count: number; amount: number; charge: number; debtSettlement: number; lastDate: Date }
  >();

  for (const g of groups) {
    const row =
      byPerson.get(g.personName) ??
      { personName: g.personName, count: 0, amount: 0, charge: 0, debtSettlement: 0, lastDate: new Date(0) };
    row.count += g._count._all;
    row.amount += g._sum.amount ?? 0;
    if (g.treatment === 'CHARGE') row.charge += g._sum.amount ?? 0;
    else row.debtSettlement += g._sum.amount ?? 0;
    if (g._max.date && g._max.date > row.lastDate) row.lastDate = g._max.date;
    byPerson.set(g.personName, row);
  }

  const items = [...byPerson.values()]
    .map((r) => ({
      personName: r.personName,
      count: r.count,
      amount: money(r.amount),
      charge: money(r.charge),
      debtSettlement: money(r.debtSettlement),
      lastDate: r.lastDate,
    }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));

  return {
    items,
    totalAmount: money(items.reduce((s, i) => s + Number(i.amount), 0)),
    totalCount: items.reduce((s, i) => s + i.count, 0),
  };
}
