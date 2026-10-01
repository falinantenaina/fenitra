import type { LedgerKind, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Contre-passation du **solde net par `kind`** des écritures rattachées à un
 * document (`refType`/`refId`).
 *
 * On annule le net — et non les seules écritures positives — pour rester exact
 * après plusieurs corrections ou annulations intermédiaires (cf. `docs/FORMULES.md` §0).
 * Une écriture est créée par `kind` dont le net est non nul, avec les signes
 * inversés ; `LedgerEntry_amount_nonzero` reste respecté.
 *
 * @returns le nombre d'écritures de contre-passation créées.
 */
export async function reverseEntries(
  tx: Db,
  refType: string,
  refId: string,
  label: string,
  userId: string | null,
): Promise<number> {
  const entries = await tx.ledgerEntry.findMany({ where: { refType, refId } });
  if (entries.length === 0) return 0;

  const groups = new Map<string, { amount: number; cashDelta: number }>();
  for (const e of entries) {
    const g = groups.get(e.kind) ?? { amount: 0, cashDelta: 0 };
    g.amount += e.amount;
    g.cashDelta += e.cashDelta;
    groups.set(e.kind, g);
  }

  let created = 0;
  for (const [kind, g] of groups) {
    if (g.amount === 0) continue;
    await tx.ledgerEntry.create({
      data: {
        date: new Date(),
        kind: kind as LedgerKind,
        amount: -g.amount,
        cashDelta: -g.cashDelta,
        description: label,
        reference: null,
        refType,
        refId,
        expenseId: refType === 'EXPENSE' ? refId : null,
        versementId: refType === 'VERSEMENT' ? refId : null,
        debtId: refType === 'DEBT' ? refId : null,
        userId,
      },
    });
    created += 1;
  }

  return created;
}
