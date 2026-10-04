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
 * C'est l'**unique** porte d'entrée d'une contre-passation : annulation de
 * vente, d'arrivage, de dette, de dépense, de versement et de capital passent
 * toutes par ici, avec le même mécanisme.
 *
 * @returns le nombre d'écritures de contre-passation créées.
 */
export async function reverseEntries(
  tx: Db,
  refType: string,
  refId: string,
  label: string,
  userId: string | null,
  options: { reference?: string | null } = {},
): Promise<number> {
  const entries = await tx.ledgerEntry.findMany({ where: { refType, refId } });
  if (entries.length === 0) return 0;

  /** Agrège par `kind` en conservant les rattachements (`debtId`, `paymentId`). */
  const groups = new Map<
    string,
    {
      amount: number;
      cashDelta: number;
      debtIds: Set<string>;
      paymentIds: Set<string>;
    }
  >();
  for (const e of entries) {
    let g = groups.get(e.kind);
    if (!g) {
      g = { amount: 0, cashDelta: 0, debtIds: new Set(), paymentIds: new Set() };
      groups.set(e.kind, g);
    }
    g.amount += e.amount;
    g.cashDelta += e.cashDelta;
    if (e.debtId) g.debtIds.add(e.debtId);
    if (e.paymentId) g.paymentIds.add(e.paymentId);
  }

  /** Un rattachement n'est repris que s'il est sans équivoque. */
  const sole = (ids: Set<string>): string | null => (ids.size === 1 ? [...ids][0]! : null);

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
        reference: options.reference ?? null,
        refType,
        refId,
        saleId: refType === 'SALE' ? refId : null,
        arrivalId: refType === 'ARRIVAL' ? refId : null,
        expenseId: refType === 'EXPENSE' ? refId : null,
        versementId: refType === 'VERSEMENT' ? refId : null,
        debtId: refType === 'DEBT' ? refId : sole(g.debtIds),
        paymentId: sole(g.paymentIds),
        userId,
      },
    });
    created += 1;
  }

  return created;
}
