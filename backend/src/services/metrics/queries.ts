import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { utc } from '../../lib/sql';
import type { RawActivity, RawBalance } from './core';

/**
 * Agrégations SQL du journal financier, des dettes et des lots.
 *
 * Convention d'écriture (cf. docs/FORMULES.md) :
 *   • `amount` et `cashDelta` sont SIGNÉS pour les contre-passations
 *     (annulation d'une vente → une écriture SALE de même nature, montant négatif).
 *     Du coup `Σ amount WHERE kind='SALE'` est toujours juste.
 *   • `StockLot.remainingQty` est un dénormalisé ; la vérité historique est
 *     `initialQty + Σ StockMovement.delta (date < T, type <> 'IN')`.
 */

type Num = number | bigint | string | null | undefined;

/** Client de lecture : `prisma` seul, ou un `tx` d'instantané (dashboard). */
type Db = Prisma.TransactionClient | typeof prisma;

export function n(v: Num): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadActivity(from: Date, to: Date, db: Db = prisma): Promise<RawActivity> {
  const rows = await db.$queryRaw<
    {
      ca: Num;
      cogs: Num;
      receipts: Num;
      collected_at_sale: Num;
      expenses: Num;
      versement_charges: Num;
      profit_drawings: Num;
      cash_outflow: Num;
      sales_count: Num;
    }[]
  >`
    WITH le AS (
      SELECT
        COALESCE(SUM("amount") FILTER (WHERE kind = 'SALE'), 0)                     AS ca,
        COALESCE(SUM("amount") FILTER (WHERE kind = 'COGS'), 0)                     AS cogs,
        COALESCE(SUM("cashDelta") FILTER (
          WHERE "cashDelta" > 0
            AND kind IN ('SALE', 'CUSTOMER_PAYMENT', 'ONLINE_SELLER_PAYMENT')
        ), 0)                                                                       AS receipts,
        COALESCE(SUM("cashDelta") FILTER (
          WHERE "cashDelta" > 0 AND kind = 'SALE'
        ), 0)                                                                       AS collected_at_sale,
        COALESCE(SUM("amount") FILTER (WHERE kind = 'EXPENSE'), 0)                  AS expenses,
        COALESCE(SUM("amount") FILTER (WHERE kind = 'VERSEMENT'), 0)                AS versement_charges,
        COALESCE(SUM("amount") FILTER (WHERE kind = 'PROFIT_DRAWING'), 0)           AS profit_drawings,
        COALESCE(-SUM("cashDelta") FILTER (WHERE "cashDelta" < 0), 0)               AS cash_outflow
      FROM "LedgerEntry"
      WHERE "date" >= ${utc(from)}::timestamp AND "date" < ${utc(to)}::timestamp
    ),
    s AS (
      SELECT COUNT(*)::bigint AS sales_count
      FROM "Sale"
      WHERE "date" >= ${utc(from)}::timestamp AND "date" < ${utc(to)}::timestamp AND status <> 'CANCELLED'
    )
    SELECT le.*, s.sales_count
    FROM le CROSS JOIN s`;

  const row = rows[0];
  return {
    salesCount: n(row?.sales_count),
    ca: n(row?.ca),
    cogs: n(row?.cogs),
    receipts: n(row?.receipts),
    collectedAtSale: n(row?.collected_at_sale),
    expenses: n(row?.expenses),
    versementCharges: n(row?.versement_charges),
    profitDrawings: n(row?.profit_drawings),
    cashOutflow: n(row?.cash_outflow),
  };
}

export async function loadBalance(
  from: Date,
  to: Date,
  openingCashBalance: number,
  db: Db = prisma,
): Promise<RawBalance> {
  const cashRows = await db.$queryRaw<{ cash_before: Num; cash_to: Num }[]>`
    SELECT
      COALESCE(SUM("cashDelta") FILTER (WHERE "date" < ${utc(from)}::timestamp), 0) AS cash_before,
      COALESCE(SUM("cashDelta") FILTER (WHERE "date" < ${utc(to)}::timestamp), 0)   AS cash_to
    FROM "LedgerEntry"`;

  const cashBefore = n(cashRows[0]?.cash_before);
  const cashTo = n(cashRows[0]?.cash_to);

  /**
   * Reste à payer / à recevoir **à la date `to`**.
   *
   * On reconstitue `initial − règlements (< to)` plutôt que de lire
   * `Debt.remainingAmount` (qui reflète l'instant présent) : les règlements
   * viennent de `Payment` **et** de `Versement` (A2 — un versement de dette
   * trosa met à jour le solde de la dette sans créer de `Payment`, cf.
   * `versements.service`).
   */
  const debtRows = await db.$queryRaw<{ type: string; initial: Num; paid: Num }[]>`
    SELECT
      d.type::text AS type,
      COALESCE(SUM(d."initialAmount"), 0)::bigint AS initial,
      COALESCE(SUM(COALESCE(pa.paid, 0) + COALESCE(ve.paid, 0)), 0)::bigint AS paid
    FROM "Debt" d
    LEFT JOIN (
      SELECT "debtId", SUM("amount")::bigint AS paid
      FROM "Payment"
      WHERE "debtId" IS NOT NULL AND "date" < ${utc(to)}::timestamp
      GROUP BY "debtId"
    ) pa ON pa."debtId" = d.id
    LEFT JOIN (
      SELECT "debtId", SUM("amount")::bigint AS paid
      FROM "Versement"
      WHERE "debtId" IS NOT NULL AND "date" < ${utc(to)}::timestamp
      GROUP BY "debtId"
    ) ve ON ve."debtId" = d.id
    WHERE d."date" < ${utc(to)}::timestamp AND d.status <> 'CANCELLED'
    GROUP BY d.type`;

  const byType: Record<string, number> = {};
  for (const r of debtRows) byType[r.type] = n(r.initial) - n(r.paid);

  const stock = await loadStockAt(to, db);

  const capitalRows = await db.$queryRaw<{ cin: Num; cout: Num }[]>`
    SELECT
      COALESCE(SUM("amount") FILTER (WHERE type = 'IN' AND "date" < ${utc(to)}::timestamp), 0)  AS cin,
      COALESCE(SUM("amount") FILTER (WHERE type = 'OUT' AND "date" < ${utc(to)}::timestamp), 0) AS cout
    FROM "PersonalCapitalMovement"`;

  const drawingRows = await db.$queryRaw<{ drawings: Num }[]>`
    SELECT COALESCE(SUM("amount"), 0)::bigint AS drawings
    FROM "LedgerEntry"
    WHERE kind = 'PROFIT_DRAWING' AND "date" < ${utc(to)}::timestamp`;

  return {
    cashAtStart: openingCashBalance + cashBefore,
    cashAtEnd: openingCashBalance + cashTo,
    stockValue: stock.value,
    stockQuantity: stock.quantity,
    customerDebts: byType.CUSTOMER ?? 0,
    onlineSellerDebts: byType.ONLINE_SELLER ?? 0,
    supplierDebts: byType.SUPPLIER ?? 0,
    trosaSinoaDebts: byType.TROSA_SINOA ?? 0,
    personalCapitalIn: n(capitalRows[0]?.cin),
    personalCapitalOut: n(capitalRows[0]?.cout),
    profitDrawingsCumulated: n(drawingRows[0]?.drawings),
  };
}

/**
 * Valorisation du stock à une date (§17) :
 *   valeur = Σ (quantité restante à T × prix d'achat du lot)
 * Jamais `quantité totale × prix d'achat actuel`.
 */
export async function loadStockAt(
  date: Date,
  db: Db = prisma,
): Promise<{ value: number; quantity: number }> {
  const rows = await db.$queryRaw<{ value: Num; quantity: Num }[]>`
    SELECT
      COALESCE(SUM(GREATEST(qty, 0) * l."unitCost"), 0)::bigint AS value,
      COALESCE(SUM(GREATEST(qty, 0)), 0)::bigint                AS quantity
    FROM (
      SELECT
        l.id,
        l."unitCost",
        l."initialQty" + COALESCE((
          SELECT SUM(m.delta)
          FROM "StockMovement" m
          WHERE m."lotId" = l.id AND m."date" < ${utc(date)}::timestamp AND m.type <> 'IN'
        ), 0) AS qty
      FROM "StockLot" l
      WHERE l.status <> 'CANCELLED'
    ) l`;

  return { value: n(rows[0]?.value), quantity: n(rows[0]?.quantity) };
}

/**
 * Quantité restante d'un lot à une date — utilisée par les rapports
 * et par le contrôle de cohérence avec `StockLot.remainingQty`.
 */
export async function lotQuantityAt(lotId: string, date: Date): Promise<number> {
  const rows = await prisma.$queryRaw<{ qty: Num }[]>`
    SELECT l."initialQty" + COALESCE((
      SELECT SUM(m.delta)
      FROM "StockMovement" m
      WHERE m."lotId" = l.id AND m."date" < ${utc(date)}::timestamp AND m.type <> 'IN'
    ), 0) AS qty
    FROM "StockLot" l
    WHERE l.id = ${lotId}`;
  return n(rows[0]?.qty);
}

/** Somme de `LedgerEntry.amount` sur une période, pour un ensemble de kinds. */
export async function sumLedgerAmount(
  kinds: string[],
  from: Date,
  to: Date,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: Num }[]>`
    SELECT COALESCE(SUM("amount"), 0)::bigint AS total
    FROM "LedgerEntry"
    WHERE kind::text = ANY(${kinds}::text[]) AND "date" >= ${utc(from)}::timestamp AND "date" < ${utc(to)}::timestamp`;
  return n(rows[0]?.total);
}

/** Écritures d'un indicateur, pour le drill-down du dashboard (§62). */
export async function ledgerEntriesForKinds(
  kinds: string[],
  from: Date,
  to: Date,
  limit = 500,
): Promise<
  {
    id: string;
    seq: bigint;
    date: Date;
    kind: string;
    amount: number;
    cashDelta: number;
    description: string;
    reference: string | null;
    refType: string | null;
    refId: string | null;
  }[]
> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      seq: bigint;
      date: Date;
      kind: string;
      amount: Num;
      cashDelta: Num;
      description: string;
      reference: string | null;
      refType: string | null;
      refId: string | null;
    }[]
  >`
    SELECT id, seq, date, kind::text AS kind, amount, "cashDelta", description,
           reference, "refType" AS "refType", "refId" AS "refId"
    FROM "LedgerEntry"
    WHERE kind::text = ANY(${kinds}::text[]) AND "date" >= ${utc(from)}::timestamp AND "date" < ${utc(to)}::timestamp
    ORDER BY "date" DESC, seq DESC
    LIMIT ${limit}`;

  return rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    date: r.date,
    kind: r.kind,
    amount: n(r.amount),
    cashDelta: n(r.cashDelta),
    description: r.description,
    reference: r.reference,
    refType: r.refType,
    refId: r.refId,
  }));
}

export { Prisma };
