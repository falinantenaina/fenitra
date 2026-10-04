import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { badRequest, businessRule, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { ilike, offset, pageMeta } from '../../lib/pagination';
import { reverseEntries } from '../../services/ledger';
import type { CreateExpenseInput, ExpenseListQuery, UpdateExpenseInput } from './expenses.schemas';

type Db = Prisma.TransactionClient | typeof prisma;

const expenseRow = (e: {
  id: string;
  amount: number;
  date: Date;
  description: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  categoryId: string;
  category?: { id: string; name: string; icon: string | null } | null;
  user?: { id: string; name: string } | null;
}) => ({
  id: e.id,
  amount: money(e.amount),
  date: e.date,
  description: e.description,
  method: e.method,
  reference: e.reference,
  notes: e.notes,
  categoryId: e.categoryId,
  category: e.category ?? undefined,
  user: e.user ?? undefined,
});

async function assertCategory(tx: Db, categoryId: string) {
  const category = await tx.expenseCategory.findUnique({ where: { id: categoryId } });
  if (!category) throw notFound('Catégorie de dépense introuvable');
  if (!category.active) throw businessRule('Cette catégorie est désactivée');
  return category;
}

async function createEntry(
  tx: Db,
  expenseId: string,
  amount: number,
  date: Date,
  description: string,
  userId: string | null,
) {
  return tx.ledgerEntry.create({
    data: {
      date,
      kind: 'EXPENSE',
      amount,
      cashDelta: -amount,
      description,
      reference: null,
      refType: 'EXPENSE',
      refId: expenseId,
      expenseId,
      userId,
    },
  });
}

/** POST /expenses — sortie de caisse + écriture `EXPENSE` (A8 : toujours réglée). */
export async function createExpense(input: CreateExpenseInput, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    await assertCategory(tx, input.categoryId);
    const date = input.date ?? new Date();

    const expense = await tx.expense.create({
      data: {
        categoryId: input.categoryId,
        amount: input.amount,
        date,
        description: input.description,
        method: input.method ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        userId,
      },
    });

    await createEntry(tx, expense.id, input.amount, date, `Dépense — ${input.description}`, userId);

    return loadExpense(tx, expense.id);
  });
}

/**
 * PUT /expenses/:id — correction : l'écriture d'origine est contre-passée,
 * une nouvelle écriture porte le montant corrigé (le journal n'est jamais édité).
 */
export async function updateExpense(id: string, input: UpdateExpenseInput, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.expense.findUnique({ where: { id } });
    if (!existing) throw notFound('Dépense introuvable');
    await assertCategory(tx, input.categoryId);

    const date = input.date ?? existing.date;

    await tx.expense.update({
      where: { id },
      data: {
        categoryId: input.categoryId,
        amount: input.amount,
        date,
        description: input.description,
        method: input.method ?? null,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
      },
    });

    await reverseEntries(tx, 'EXPENSE', id, `Correction dépense — ${input.description}`, userId);
    await createEntry(tx, id, input.amount, date, `Dépense — ${input.description}`, userId);

    return loadExpense(tx, id);
  });
}

/** DELETE /expenses/:id — suppression + contre-passation (le journal garde la trace). */
export async function deleteExpense(id: string, reason: string, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findUnique({ where: { id } });
    if (!expense) throw notFound('Dépense introuvable');

    await reverseEntries(tx, 'EXPENSE', id, `Annulation dépense — ${reason}`, userId);
    await tx.expense.delete({ where: { id } });

    return { id, deleted: true, refundedAmount: money(expense.amount), reason };
  });
}

export async function loadExpense(db: Db, id: string) {
  const expense = await db.expense.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true, icon: true } },
      user: { select: { id: true, name: true } },
    },
  });
  if (!expense) throw notFound('Dépense introuvable');
  return expenseRow(expense);
}

export async function listExpenses(query: ExpenseListQuery) {
  const where: Prisma.ExpenseWhereInput = {
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(ilike(query.q) ? { description: ilike(query.q) } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: offset(query),
      take: query.limit,
      include: {
        category: { select: { id: true, name: true, icon: true } },
        user: { select: { id: true, name: true } },
      },
    }),
    prisma.expense.count({ where }),
  ]);

  return { items: items.map(expenseRow), ...pageMeta(total, query.page, query.limit) };
}

/** Synthèse des dépenses par catégorie (rapport mensuel, dashboard). */
export async function expensesSummary(query: ExpenseListQuery) {
  const where: Prisma.ExpenseWhereInput = {
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };

  const groups = await prisma.expense.groupBy({
    by: ['categoryId'],
    where,
    _count: { _all: true },
    _sum: { amount: true },
  });

  const categories = await prisma.expenseCategory.findMany({
    where: { id: { in: groups.map((g) => g.categoryId) } },
    select: { id: true, name: true, icon: true },
  });
  const byId = new Map(categories.map((c) => [c.id, c]));

  const items = groups
    .map((g) => ({
      category: byId.get(g.categoryId) ?? { id: g.categoryId, name: 'Inconnue', icon: null },
      count: g._count._all,
      amount: money(g._sum.amount ?? 0),
    }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));

  const total = groups.reduce((s, g) => s + (g._sum.amount ?? 0), 0);

  return { items, totalAmount: money(total) };
}
