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

/**
 * Ligne de dérillage (§62) — journal financier, dette ou lot de stock.
 * Toutes les sources sont normalisées dans ce format unique pour que
 * `GET /dashboard/:indicator/transactions` puisse les mélanger (vola,
 * bénéfice disponible) sans casse de contrat.
 */
export interface DrillRow {
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
}

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

/** Indicateurs de flux découpables en jours pour un graphique (§3). */
export type SeriesMetric = 'ca' | 'receipts' | 'outflow';

/**
 * Valeurs journalières d'un indicateur de flux, une ligne par jour **non vide**.
 *
 * Mêmes prédicats que `loadActivity` : CA = `Σ amount(kind = 'SALE')` signé,
 * recettes = cash entrant des ventes et règlements, sorties = -cash sortant —
 * le total d'une série est donc exactement la valeur affichée au dashboard.
 *
 * Le découpage en jour se fait dans la timezone du business (A13) : `date`
 * est stocké en UTC (`timestamp` sans fuseau), on le convertit en instant puis
 * en heure murale locale avant `date_trunc`, donc indépendamment du fuseau de
 * session PostgreSQL.
 */
export async function loadSeries(
  from: Date,
  to: Date,
  metric: SeriesMetric,
  timeZone: string,
  db: Db = prisma,
): Promise<{ day: string; value: number }[]> {
  const value =
    metric === 'ca'
      ? Prisma.sql`COALESCE(SUM("amount") FILTER (WHERE kind = 'SALE'), 0)`
      : metric === 'receipts'
        ? Prisma.sql`COALESCE(SUM("cashDelta") FILTER (
            WHERE "cashDelta" > 0
              AND kind IN ('SALE', 'CUSTOMER_PAYMENT', 'ONLINE_SELLER_PAYMENT')
          ), 0)`
        : Prisma.sql`COALESCE(-SUM("cashDelta") FILTER (WHERE "cashDelta" < 0), 0)`;

  const rows = await db.$queryRaw<{ day: string; value: Num }[]>`
    SELECT
      to_char(date_trunc('day', ("date" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS day,
      ${value} AS value
    FROM "LedgerEntry"
    WHERE "date" >= ${utc(from)}::timestamp AND "date" < ${utc(to)}::timestamp
    GROUP BY 1
    ORDER BY 1`;

  return rows.map((r) => ({ day: r.day, value: n(r.value) }));
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
 * Part des cartons dont les pointures sont inconnues : `montant − Σ lignes`.
 * Nul dès que le carton est ventilé — un carton a des lots s'il a des lignes,
 * donc ce terme et celui des lots ne se doublonnent jamais. Les cartons d'un
 * arrivage annulé sont exclus (leurs lots aussi, par `status <> 'CANCELLED'`).
 */
export const transitValueSql = Prisma.sql`
  (SELECT COALESCE(SUM(c."totalCost" - COALESCE(lx.cost, 0)), 0)::bigint
     FROM "ArrivalCarton" c
     JOIN "Arrival" a ON a."id" = c."arrivalId"
     LEFT JOIN (
       SELECT "cartonId", SUM("lineTotal") AS cost FROM "ArrivalItem" GROUP BY "cartonId"
     ) lx ON lx."cartonId" = c."id"
    WHERE a."status" <> 'CANCELLED')`;

/** Même terme, en quantité : `quantité annoncée − paires déjà réparties`. */
export const transitQtySql = Prisma.sql`
  (SELECT COALESCE(SUM(c."totalQty" - COALESCE(lq.qty, 0)), 0)::bigint
     FROM "ArrivalCarton" c
     JOIN "Arrival" a ON a."id" = c."arrivalId"
     LEFT JOIN (
       SELECT "cartonId", SUM("quantity") AS qty FROM "ArrivalItem" GROUP BY "cartonId"
     ) lq ON lq."cartonId" = c."id"
    WHERE a."status" <> 'CANCELLED')`;

/**
 * Valorisation du stock à une date (§17) :
 *   valeur = Σ (quantité restante à T × prix d'achat du lot)
 *          + Σ (cartons à ventiler : montant − lignes déjà réparties)
 * Jamais `quantité totale × prix d'achat actuel`.
 *
 * Le second terme couvre les cartons dont les pointures sont inconnues — le
 * modèle, la quantité et le montant sont déjà comptabilisés à l'enregistrement.
 * `montant − Σ lignes` est nul dès que le carton est ventilé, donc les deux
 * termes ne se chevauchent jamais (un carton a des lots s'il a des lignes).
 */
export async function loadStockAt(
  date: Date,
  db: Db = prisma,
): Promise<{ value: number; quantity: number }> {
  const rows = await db.$queryRaw<
    { value: Num; quantity: Num; transit_value: Num; transit_qty: Num }[]
  >`
    SELECT
      COALESCE(SUM(GREATEST(qty, 0) * l."unitCost"), 0)::bigint AS value,
      COALESCE(SUM(GREATEST(qty, 0)), 0)::bigint                AS quantity,
      ${transitValueSql} AS transit_value,
      ${transitQtySql}   AS transit_qty
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

  const row = rows[0];
  return {
    value: n(row?.value) + n(row?.transit_value),
    quantity: n(row?.quantity) + n(row?.transit_qty),
  };
}

/** Écritures d'un indicateur, pour le drill-down du dashboard (§62). */
export async function ledgerEntriesForKinds(
  kinds: string[],
  from: Date,
  to: Date,
  limit = 500,
): Promise<DrillRow[]> {
  if (kinds.length === 0) return [];
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

/**
 * Dettes encore ouvertes à une date, avec le reste à payer **reconstitué à
 * cette date** (même formule que `loadBalance` : initial − règlements −
 * versements, hors `CANCELLED`).
 *
 * Les lignes à 0 (dette soldée) sont écartées : elles n'apportent rien au
 * total et noieraient la liste.
 */
export async function debtDrillEntries(
  to: Date,
  types: string[],
  limit = 2000,
): Promise<DrillRow[]> {
  if (types.length === 0) return [];
  const rows = await prisma.$queryRaw<
    {
      id: string;
      date: Date;
      kind: string;
      reason: string;
      party: string | null;
      amount: Num;
    }[]
  >`
    SELECT
      d.id,
      d.date,
      d.type::text AS kind,
      d.reason,
      COALESCE(c.name, os.name, s.name, d."partyName") AS party,
      d."initialAmount" - COALESCE(pa.paid, 0) - COALESCE(ve.paid, 0) AS amount
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
    LEFT JOIN "Customer" c ON c.id = d."customerId"
    LEFT JOIN "OnlineSeller" os ON os.id = d."onlineSellerId"
    LEFT JOIN "Supplier" s ON s.id = d."supplierId"
    WHERE d."date" < ${utc(to)}::timestamp
      AND d.status <> 'CANCELLED'
      AND d.type::text = ANY(${types}::text[])
      AND d."initialAmount" - COALESCE(pa.paid, 0) - COALESCE(ve.paid, 0) <> 0
    ORDER BY d.date DESC, d.id DESC
    LIMIT ${limit}`;

  return rows.map((r) => ({
    id: r.id,
    seq: 0n,
    date: r.date,
    kind: r.kind,
    amount: n(r.amount),
    cashDelta: 0,
    description: r.party ? `${r.reason} — ${r.party}` : r.reason,
    reference: null,
    refType: 'DEBT',
    refId: r.id,
  }));
}

/**
 * Lots encore garnis à une date : même reconstitution de la quantité que
 * `loadStockAt` (initial + Σ mouvements hors `IN` < date), donc
 * `Σ amount` retombe exactement sur `stock.value` du dashboard.
 */
export async function stockDrillEntries(to: Date, limit = 2000): Promise<DrillRow[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      code: string;
      entryDate: Date;
      unitCost: Num;
      qty: Num;
      product: string;
      size: string;
    }[]
  >`
    SELECT
      l.id,
      l.code,
      l."entryDate",
      l."unitCost",
      l.qty,
      p.name AS product,
      COALESCE(sz.label, sz.value::text) AS size
    FROM (
      SELECT
        l.id, l.code, l."entryDate", l."unitCost", l."variantId",
        l."initialQty" + COALESCE((
          SELECT SUM(m.delta)
          FROM "StockMovement" m
          WHERE m."lotId" = l.id AND m."date" < ${utc(to)}::timestamp AND m.type <> 'IN'
        ), 0) AS qty
      FROM "StockLot" l
      WHERE l.status <> 'CANCELLED'
    ) l
    JOIN "ProductVariant" v ON v.id = l."variantId"
    JOIN "Product" p ON p.id = v."productId"
    JOIN "Size" sz ON sz.id = v."sizeId"
    WHERE GREATEST(l.qty, 0) > 0
    ORDER BY l."entryDate" DESC, l.code DESC
    LIMIT ${limit}`;

  const lotRows = rows.map((r) => ({
    id: r.id,
    seq: 0n,
    date: r.entryDate,
    kind: 'LOT',
    amount: Math.max(n(r.qty), 0) * n(r.unitCost),
    cashDelta: 0,
    description: `${r.product} · taille ${r.size} · ${n(r.qty)} p. restantes`,
    reference: r.code,
    refType: 'STOCK_LOT',
    refId: r.id,
  }));

  // Cartons dont les pointures sont inconnues — même terme que `loadStockAt`,
  // pour que `Σ amount` retombe sur `stock.value` (§62).
  const cartons = await prisma.$queryRaw<
    { id: string; reference: string; date: Date; product: string; value: Num; qty: Num }[]
  >`
    SELECT
      c.id, c.reference, c.date, p.name AS product,
      c."totalCost" - COALESCE(lx.cost, 0) AS value,
      c."totalQty" - COALESCE(lq.qty, 0)   AS qty
    FROM "ArrivalCarton" c
    JOIN "Arrival" a ON a."id" = c."arrivalId"
    JOIN "Product" p ON p.id = c."productId"
    LEFT JOIN (
      SELECT "cartonId", SUM("lineTotal") AS cost FROM "ArrivalItem" GROUP BY "cartonId"
    ) lx ON lx."cartonId" = c."id"
    LEFT JOIN (
      SELECT "cartonId", SUM("quantity") AS qty FROM "ArrivalItem" GROUP BY "cartonId"
    ) lq ON lq."cartonId" = c."id"
    WHERE a."status" <> 'CANCELLED'
      AND c."totalCost" - COALESCE(lx.cost, 0) <> 0
    ORDER BY c."date" DESC, c."reference" DESC
    LIMIT ${limit}`;

  const cartonRows = cartons.map((c) => ({
    id: c.id,
    seq: 0n,
    date: c.date,
    kind: 'CARTON',
    amount: n(c.value),
    cashDelta: 0,
    description: `${c.product} · carton ${c.reference} · ${n(c.qty)} p. à ventiler`,
    reference: c.reference,
    refType: 'ARRIVAL_CARTON',
    refId: c.id,
  }));

  return [...lotRows, ...cartonRows];
}


export { Prisma };
