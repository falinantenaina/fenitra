import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { conflict, notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { ilike, offset, pageMeta } from '../../lib/pagination';
import { reverseEntries } from '../../services/ledger';
import { loadProfitState } from '../../services/metrics';
import type { CreateProfitDrawingInput, ProfitDrawingListQuery } from './profit-drawings.schemas';

type Db = Prisma.TransactionClient | typeof prisma;

const drawingRow = (d: {
  id: string;
  amount: number;
  date: Date;
  method: string | null;
  notes: string | null;
  user?: { id: string; name: string } | null;
}) => ({
  id: d.id,
  amount: money(d.amount),
  date: d.date,
  method: d.method,
  notes: d.notes,
  user: d.user ?? undefined,
});

/**
 * A5 — `PROFIT_DRAWING`, `cashDelta = −montant` : le retrait sort de la caisse,
 * laisse l'argent propre (K) intact et ne crée aucun revenu (§45 : il ne fait
 * que sortir le bénéfice déjà réalisé).
 */
async function writeEntry(
  tx: Db,
  drawingId: string,
  amount: number,
  date: Date,
  notes: string | null,
  userId: string | null,
) {
  await tx.ledgerEntry.create({
    data: {
      date,
      kind: 'PROFIT_DRAWING',
      amount,
      cashDelta: -amount,
      description: `Retrait de bénéfice${notes ? ` — ${notes}` : ''}`,
      reference: null,
      refType: 'PROFIT_DRAWING',
      refId: drawingId,
      userId,
    },
  });
}

/**
 * POST /profit-drawings — plafond = bénéfice net non sorti (`disposableProfit`,
 * §9 révisé) relu **dans la transaction** : rien n'est écrit au-delà du bénéfice
 * net cumulé non sorti, l'identité comptable (§8.3) reste vérifiée.
 */
export async function createProfitDrawing(input: CreateProfitDrawingInput, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const state = await loadProfitState(tx);
    if (input.amount > state.disposable) {
      throw conflict(
        `Bénéfice disponible ${money(state.disposable)} — retrait de ${money(input.amount)} refusé`,
        { available: money(state.disposable) },
      );
    }

    const date = input.date ?? new Date();
    const row = await tx.profitDrawing.create({
      data: {
        amount: input.amount,
        date,
        method: input.method ?? null,
        notes: input.notes ?? null,
        userId,
      },
    });

    await writeEntry(tx, row.id, input.amount, date, input.notes ?? null, userId);

    return loadDrawing(tx, row.id);
  });
}

export async function loadDrawing(db: Db, id: string) {
  const d = await db.profitDrawing.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!d) throw notFound('Retrait introuvable');
  return drawingRow(d);
}

export async function listProfitDrawings(query: ProfitDrawingListQuery) {
  const where: Prisma.ProfitDrawingWhereInput = {
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(ilike(query.q) ? { notes: ilike(query.q) } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.profitDrawing.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: offset(query),
      take: query.limit,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.profitDrawing.count({ where }),
  ]);

  return { items: items.map(drawingRow), ...pageMeta(total, query.page, query.limit) };
}

/** DELETE /profit-drawings/:id — contre-passation : le bénéfice redevient disponible. */
export async function deleteProfitDrawing(id: string, reason: string, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.profitDrawing.findUnique({ where: { id } });
    if (!existing) throw notFound('Retrait introuvable');

    await reverseEntries(tx, 'PROFIT_DRAWING', id, `Annulation retrait de bénéfice — ${reason}`, userId);
    await tx.profitDrawing.delete({ where: { id } });

    return { id, deleted: true, refundedAmount: money(existing.amount), reason };
  });
}
