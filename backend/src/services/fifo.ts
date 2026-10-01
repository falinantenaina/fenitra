import type { Prisma } from '@prisma/client';
import { insufficientStock } from '../lib/errors';

export interface Allocation {
  lotId: string;
  quantity: number;
  unitCost: number;
}

export interface FifoContext {
  /** Type de mouvement écrit pour chaque lot consommé (OUT, ADJUSTMENT, RETURN…). */
  type: 'OUT' | 'ADJUSTMENT' | 'RETURN' | 'REVERSAL';
  refType?: string | null;
  refId?: string | null;
  date?: Date;
  userId?: string | null;
  notes?: string | null;
}

/**
 * Sortie FIFO (§16, §7 de docs/ANALYSE.md) :
 *   lots triés par `entryDate`, `createdAt`, `id` — verrou `FOR UPDATE`
 *   pour empêcher deux ventes simultanées de puiser dans le même lot.
 *
 * Chaque lot consommé fait décroître `remainingQty` et génère un
 * `StockMovement` au `delta` signé (toujours négatif ici).
 */
export async function allocateFIFO(
  tx: Prisma.TransactionClient,
  variantId: string,
  qtyRequested: number,
  ctx: FifoContext,
): Promise<{ allocations: Allocation[]; totalCost: number }> {
  const rows = await tx.$queryRaw<{ id: string; remainingQty: number; unitCost: number }[]>`
    SELECT id, "remainingQty", "unitCost"
    FROM "StockLot"
    WHERE "variantId" = ${variantId}
      AND "remainingQty" > 0
      AND status = 'OPEN'
    ORDER BY "entryDate" ASC, "createdAt" ASC, id ASC
    FOR UPDATE`;

  let remaining = qtyRequested;
  const picked: { id: string; take: number; unitCost: number }[] = [];

  for (const lot of rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lot.remainingQty);
    if (take <= 0) continue;
    picked.push({ id: lot.id, take, unitCost: lot.unitCost });
    remaining -= take;
  }

  if (remaining > 0) {
    throw insufficientStock(`Stock insuffisant : ${remaining} unité(s) manquante(s)`);
  }

  const date = ctx.date ?? new Date();
  const allocations: Allocation[] = [];
  let totalCost = 0;

  for (const { id, take, unitCost } of picked) {
    await tx.stockLot.update({ where: { id }, data: { remainingQty: { decrement: take } } });
    await tx.stockMovement.create({
      data: {
        lotId: id,
        variantId,
        type: ctx.type,
        delta: -take,
        unitCost,
        refType: ctx.refType ?? null,
        refId: ctx.refId ?? null,
        date,
        notes: ctx.notes ?? null,
        userId: ctx.userId ?? null,
      },
    });
    allocations.push({ lotId: id, quantity: take, unitCost });
    totalCost += take * unitCost;
  }

  return { allocations, totalCost };
}
