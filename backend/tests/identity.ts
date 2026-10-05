import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { transitValueSql } from '../src/services/metrics/queries';

/**
 * Contrôle d'identité comptable (§4) :
 *
 *   caisse + stock + créances − passifs = K + (CA − COGS − dépenses − versements − retraits)
 *
 * Lecture en `RepeatableRead` pour obtenir un instantané cohérent de toute
 * la base, quelle que soit la phase en cours.
 */
export interface IdentitySnapshot {
  cash: number;
  stock: number;
  recv: number;
  liab: number;
  k: number;
  ca: number;
  cogs: number;
  expense: number;
  versement: number;
  retrait: number;
  lots: number;
}

export async function accountingIdentity(): Promise<IdentitySnapshot> {
  return prisma.$transaction(
    async (tx) => {
      const [cash, stock, debts, capital, flows] = await Promise.all([
        tx.ledgerEntry.aggregate({ _sum: { cashDelta: true } }),
        tx.stockLot.aggregate({
          where: { status: { not: 'CANCELLED' } },
          _sum: { remainingQty: true },
        }),
        tx.debt.findMany({ where: { status: { not: 'CANCELLED' } } }),
        tx.ledgerEntry.findMany({ where: { kind: { in: ['PERSONAL_CAPITAL_IN', 'PERSONAL_CAPITAL_OUT'] } } }),
        tx.ledgerEntry.findMany({
          where: { kind: { in: ['SALE', 'COGS', 'EXPENSE', 'VERSEMENT', 'PROFIT_DRAWING'] } },
        }),
      ]);

      // Lots + cartons dont les pointures sont inconnues : même terme que le
      // dashboard, un arrivage ayant bougé caisse et dette dès l'enregistrement.
      // `lots` reste le compteur de pièces en lot (les cartons à ventiler n'y
      // figurent pas) — il sert de contrôle « du stock réel existe ».
      const stockValue = (
        await tx.$queryRaw<{ value: number | bigint }[]>`
          SELECT COALESCE(SUM("remainingQty" * "unitCost"), 0)::bigint
               + ${transitValueSql} AS value
          FROM "StockLot" WHERE status <> 'CANCELLED'`
      )[0]!.value;

      const recv = debts
        .filter((d) => d.type === 'CUSTOMER' || d.type === 'ONLINE_SELLER')
        .reduce((s, d) => s + d.remainingAmount, 0);
      const liab = debts
        .filter((d) => d.type === 'SUPPLIER' || d.type === 'TROSA_SINOA')
        .reduce((s, d) => s + d.remainingAmount, 0);

      const k = capital.reduce((s, e) => s + (e.kind === 'PERSONAL_CAPITAL_IN' ? e.amount : -e.amount), 0);
      const sum = (kind: string) =>
        flows.filter((f) => f.kind === kind).reduce((s, f) => s + f.amount, 0);

      return {
        cash: cash._sum.cashDelta ?? 0,
        stock: typeof stockValue === 'bigint' ? Number(stockValue) : stockValue,
        recv,
        liab,
        k,
        ca: sum('SALE'),
        cogs: sum('COGS'),
        expense: sum('EXPENSE'),
        versement: sum('VERSEMENT'),
        retrait: sum('PROFIT_DRAWING'),
        lots: stock._sum.remainingQty ?? 0,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

export function identityBalance(s: IdentitySnapshot) {
  const lhs = s.cash + s.stock + s.recv - s.liab;
  const rhs = s.k + (s.ca - s.cogs - s.expense - s.versement - s.retrait);
  return { lhs, rhs, delta: lhs - rhs };
}
