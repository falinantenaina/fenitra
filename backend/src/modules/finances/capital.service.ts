import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notFound } from '../../lib/errors';
import { money } from '../../lib/money';
import { ilike, offset, pageMeta } from '../../lib/pagination';
import { reverseEntries } from '../../services/ledger';
import type { CapitalListQuery, CreateCapitalInput, UpdateCapitalInput } from './capital.schemas';

type Db = Prisma.TransactionClient | typeof prisma;

const capitalRow = (m: {
  id: string;
  type: string;
  amount: number;
  date: Date;
  motif: string;
  destinationType: string | null;
  destinationId: string | null;
  reference: string | null;
  comment: string | null;
  user?: { id: string; name: string } | null;
}) => ({
  id: m.id,
  type: m.type,
  amount: money(m.amount),
  date: m.date,
  motif: m.motif,
  destinationType: m.destinationType,
  destinationId: m.destinationId,
  reference: m.reference,
  comment: m.comment,
  user: m.user ?? undefined,
});

async function writeEntry(
  tx: Db,
  movementId: string,
  type: 'IN' | 'OUT',
  amount: number,
  date: Date,
  motif: string,
  userId: string | null,
) {
  await tx.ledgerEntry.create({
    data: {
      date,
      kind: type === 'IN' ? 'PERSONAL_CAPITAL_IN' : 'PERSONAL_CAPITAL_OUT',
      amount,
      cashDelta: type === 'IN' ? amount : -amount,
      description: `${type === 'IN' ? 'Injection' : 'Récupération'} d'argent propre — ${motif}`,
      reference: null,
      refType: 'CAPITAL',
      refId: movementId,
      userId,
    },
  });
}

/** POST /personal-capital — injection ou récupération de capital (§34). */
export async function createCapital(input: CreateCapitalInput, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const date = input.date ?? new Date();
    const movement = await tx.personalCapitalMovement.create({
      data: {
        type: input.type,
        amount: input.amount,
        date,
        motif: input.motif,
        destinationType: input.destinationType ?? null,
        destinationId: input.destinationId ?? null,
        reference: input.reference ?? null,
        comment: input.comment ?? null,
        userId,
      },
    });

    await writeEntry(tx, movement.id, input.type, input.amount, date, input.motif, userId);

    return loadCapital(tx, movement.id);
  });
}

/** PUT /personal-capital/:id — le type est figé, le montant se corrige par contre-passation. */
export async function updateCapital(id: string, input: UpdateCapitalInput, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.personalCapitalMovement.findUnique({ where: { id } });
    if (!existing) throw notFound('Mouvement introuvable');

    const date = input.date ?? existing.date;

    await tx.personalCapitalMovement.update({
      where: { id },
      data: {
        amount: input.amount,
        date,
        motif: input.motif,
        destinationType: input.destinationType ?? null,
        destinationId: input.destinationId ?? null,
        reference: input.reference ?? null,
        comment: input.comment ?? null,
      },
    });

    await reverseEntries(tx, 'CAPITAL', id, `Correction argent propre — ${input.motif}`, userId);
    await writeEntry(tx, id, existing.type, input.amount, date, input.motif, userId);

    return loadCapital(tx, id);
  });
}

/** DELETE /personal-capital/:id — contre-passation, K revient à sa valeur antérieure. */
export async function deleteCapital(id: string, reason: string, userId: string | null) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.personalCapitalMovement.findUnique({ where: { id } });
    if (!existing) throw notFound('Mouvement introuvable');

    await reverseEntries(tx, 'CAPITAL', id, `Annulation argent propre — ${reason}`, userId);
    await tx.personalCapitalMovement.delete({ where: { id } });

    return { id, deleted: true, refundedAmount: money(existing.amount), reason };
  });
}

export async function loadCapital(db: Db, id: string) {
  const m = await db.personalCapitalMovement.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!m) throw notFound('Mouvement introuvable');
  return capitalRow(m);
}

export async function listCapital(query: CapitalListQuery) {
  const where: Prisma.PersonalCapitalMovementWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(ilike(query.q) ? { motif: ilike(query.q) } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.personalCapitalMovement.findMany({
      where,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      skip: offset(query),
      take: query.limit,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.personalCapitalMovement.count({ where }),
  ]);

  return { items: items.map(capitalRow), ...pageMeta(total, query.page, query.limit) };
}

/** Résolution d'une destination (§33) : où est allé l'argent. */
async function resolveDestination(destinationType: string | null, destinationId: string | null) {
  if (!destinationType || !destinationId) return [];

  if (destinationType === 'ARRIVAL') {
    const a = await prisma.arrival.findUnique({ where: { id: destinationId } });
    return [{ type: destinationType, id: destinationId, label: a?.reference ?? 'Arrivage inconnu', found: !!a }];
  }
  if (destinationType === 'SALE') {
    const s = await prisma.sale.findUnique({ where: { id: destinationId } });
    return [{ type: destinationType, id: destinationId, label: s?.reference ?? 'Vente inconnue', found: !!s }];
  }
  if (destinationType === 'EXPENSE') {
    const e = await prisma.expense.findUnique({ where: { id: destinationId } });
    return [{ type: destinationType, id: destinationId, label: e?.description ?? 'Dépense inconnue', found: !!e }];
  }
  if (destinationType === 'SUPPLIER') {
    const s = await prisma.supplier.findUnique({ where: { id: destinationId } });
    return [{ type: destinationType, id: destinationId, label: s?.name ?? 'Fournisseur inconnu', found: !!s }];
  }
  if (destinationType === 'CUSTOMER') {
    const c = await prisma.customer.findUnique({ where: { id: destinationId } });
    return [{ type: destinationType, id: destinationId, label: c?.name ?? 'Client inconnu', found: !!c }];
  }
  if (destinationType === 'ONLINE_SELLER') {
    const o = await prisma.onlineSeller.findUnique({ where: { id: destinationId } });
    return [{ type: destinationType, id: destinationId, label: o?.name ?? 'Vendeur inconnu', found: !!o }];
  }

  return [{ type: destinationType, id: destinationId, label: destinationId, found: false }];
}

/** GET /personal-capital/:id/destinations — traçabilité §33 (A7). */
export async function capitalDestinations(id: string) {
  const movement = await prisma.personalCapitalMovement.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!movement) throw notFound('Mouvement introuvable');

  const destinations = await resolveDestination(movement.destinationType, movement.destinationId);
  const entries = await prisma.ledgerEntry.findMany({
    where: { refType: 'CAPITAL', refId: id },
    orderBy: { seq: 'asc' },
  });

  return {
    ...capitalRow(movement),
    destinations,
    history: entries.map((e) => ({
      id: e.id,
      date: e.date,
      kind: e.kind,
      amount: money(e.amount),
      cashDelta: money(e.cashDelta),
      description: e.description,
    })),
  };
}
