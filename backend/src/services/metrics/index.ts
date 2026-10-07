import { Prisma } from '@prisma/client';

import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import {
  computeDerived,
  type DerivedMetrics,
  type FinanceConfig,
} from './core';
import {
  debtDrillEntries,
  ledgerEntriesForKinds,
  loadActivity,
  loadBalance,
  loadUnrealizedMargin,
  stockDrillEntries,
  unrealizedMarginDrillEntries,
  type DrillRow,
} from './queries';
import { resolvePeriod, cumulativeUntil, type PeriodKey, type PeriodRange } from '../period.service';

export * from './core';
export type { DrillRow } from './queries';

export interface DashboardPeriod {
  key: PeriodKey;
  from: string;
  to: string;
  label: string;
}

export interface DashboardResult {
  period: DashboardPeriod;
  activity: {
    salesCount: number;
    ca: number;
    receipts: number;
    collectedAtSale: number;
    cogs: number;
    grossProfit: number;
    expenses: number;
    versementCharges: number;
    netProfit: number;
    cashOutflow: number;
  };
  money: {
    cash: number;
    cashAtStart: number;
    cashDelta: number;
    receivables: number;
    payables: number;
    volaMiodina: number;
    personalCapitalEngaged: number;
    personalCapitalIn: number;
    personalCapitalOut: number;
    profitDrawings: number;
    /** Bénéfice encaissé cumulé — total, retraits compris (§45) */
    netProfitAccumulated: number;
    /** Bénéfice encaissé non sorti = total − retraits */
    netProfitNotWithdrawn: number;
    disposableProfit: number;
    /** Marge des ventes non encore entièrement réglées (§41) */
    unrealizedMargin: number;
  };
  debts: {
    customer: number;
    onlineSeller: number;
    supplier: number;
    trosaSinoa: number;
    total: number;
  };
  stock: { quantity: number; value: number };
  /** Contrôle d'intégrité — doit être 0. Non nul = un flux n'a pas été journalisé. */
  integrity: { identityDelta: number; ok: boolean };
}

export function financeConfig(): FinanceConfig {
  return {
    openingCashBalance: env.OPENING_CASH_BALANCE,
  };
}

/** État du bénéfice à un instant — lecture unique consommée par les retraits. */
export interface ProfitState {
  /** Bénéfice encaissé cumulé (retraits compris, §41/§45). */
  total: number;
  /** Retraits déjà effectués. */
  withdrawn: number;
  /** Bénéfice encaissé non sorti, plancher 0 — plafond d'un retrait (§9). */
  disposable: number;
}

/**
 * Bénéfice disponible **à l'instant `now`**, calculé avec exactement
 * l'arithmétique de `GET /dashboard` : le plafond qu'on applique à un retrait
 * est celui que l'application affiche, relu dans la transaction qui écrit.
 */
export async function loadProfitState(
  db: Prisma.TransactionClient | typeof prisma = prisma,
  now: Date = new Date(),
): Promise<ProfitState> {
  const config = financeConfig();
  const activity = await loadActivity(EPOCH, now, db);
  const balance = await loadBalance(EPOCH, now, config.openingCashBalance, db);
  const d = computeDerived(activity, balance, activity);
  return {
    total: d.netProfitAccumulated,
    withdrawn: d.profitDrawingsCumulated,
    disposable: d.disposableProfit,
  };
}

export async function getDashboard(
  key: PeriodKey,
  custom?: { from?: string; to?: string },
  now: Date = new Date(),
): Promise<DashboardResult> {
  const range = resolvePeriod(key, now, custom);
  return buildDashboard(range);
}

export async function buildDashboard(range: PeriodRange): Promise<DashboardResult> {
  const config = financeConfig();
  const cumulative = cumulativeUntil(range);

  /**
   * Instantané cohérent (§4) : l'identité compare des STOCKS à des FLUX lus en
   * parallèle. Sans `RepeatableRead`, une écriture concurrente entre deux
   * lectures se traduirait par un écart d'intégrité purement apparent.
   */
  const [activity, balance, allTime, unrealizedAtStart] = await prisma.$transaction(
    async (tx) =>
      Promise.all([
        loadActivity(range.from, range.to, tx),
        loadBalance(range.from, range.to, config.openingCashBalance, tx),
        loadActivity(cumulative.from, cumulative.to, tx),
        loadUnrealizedMargin(range.from, tx),
      ]),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  // L'intégrité compare des STOCKS (caisse, stock, dettes à `to`) à des
  // FLUX cumulés : on utilise donc l'activité depuis l'origine, quel que
  // soit le filtre d'affichage de la période.
  const d: DerivedMetrics = computeDerived(activity, balance, allTime);

  return {
    period: {
      key: range.key,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      label: range.label,
    },
    activity: {
      salesCount: d.salesCount,
      ca: d.ca,
      receipts: d.receipts,
      collectedAtSale: d.collectedAtSale,
      cogs: d.cogs,
      grossProfit: d.grossProfit,
      expenses: d.expenses,
      versementCharges: d.versementCharges,
      // Bénéfice de la période (§41) = accrual − variation de la marge à
      // recevoir : la marge d'une vente créditée n'est reconnue que dans la
      // période où la vente est réglée.
      netProfit: d.netProfit - (d.unrealizedMargin - unrealizedAtStart),
      cashOutflow: d.cashOutflow,
    },
    money: {
      cash: d.cash,
      cashAtStart: d.cashAtStart,
      cashDelta: d.cashDelta,
      receivables: d.receivables,
      payables: d.payables,
      volaMiodina: d.volaMiodina,
      personalCapitalEngaged: d.personalCapitalEngaged,
      personalCapitalIn: d.personalCapitalIn,
      personalCapitalOut: d.personalCapitalOut,
      profitDrawings: d.profitDrawingsCumulated,
      netProfitAccumulated: d.netProfitAccumulated,
      netProfitNotWithdrawn: d.netProfitNotWithdrawn,
      disposableProfit: d.disposableProfit,
      unrealizedMargin: d.unrealizedMargin,
    },
    debts: {
      customer: d.customerDebts,
      onlineSeller: d.onlineSellerDebts,
      supplier: d.supplierDebts,
      trosaSinoa: d.trosaSinoaDebts,
      total: d.receivables + d.payables,
    },
    stock: { quantity: d.stockQuantity, value: d.stockValue },
    integrity: { identityDelta: d.identityDelta, ok: d.identityDelta === 0 },
  };
}

// ───────────────────────── drill-down (§62) ─────────────────────────

const ALL_CASH_KINDS = [
  'SALE',
  'CUSTOMER_PAYMENT',
  'ONLINE_SELLER_PAYMENT',
  'SUPPLIER_PAYMENT',
  'EXPENSE',
  'VERSEMENT',
  'PERSONAL_CAPITAL_IN',
  'PERSONAL_CAPITAL_OUT',
  'PROFIT_DRAWING',
  'TROSA_BORROW',
  'TROSA_REPAY',
  'OTHER',
  'REVERSAL',
];

export type IndicatorKey =
  | 'ca'
  | 'cogs'
  | 'grossProfit'
  | 'netProfit'
  | 'receipts'
  | 'expenses'
  | 'versements'
  | 'cash'
  | 'cashBalance'
  | 'capital'
  | 'profitDrawings'
  | 'receivables'
  | 'payables'
  | 'debtsCustomer'
  | 'debtsOnlineSeller'
  | 'debtsSupplier'
  | 'debtsTrosa'
  | 'debtsTotal'
  | 'stockValue'
  | 'vola'
  | 'disposableProfit'
  | 'netProfitAccumulated'
  | 'unrealizedMargin';

/** Date basse des sources cumulées : `date < to` sans borne inférieure. */
const EPOCH = new Date(0);

/** Lignes maximales rendues par une source cumulée (réponse bornée). */
const CUMUL_LIMIT = 2000;

const RECEIVABLE_DEBT_TYPES = ['CUSTOMER', 'ONLINE_SELLER'];
const PAYABLE_DEBT_TYPES = ['SUPPLIER', 'TROSA_SINOA'];
const ALL_DEBT_TYPES = [...RECEIVABLE_DEBT_TYPES, ...PAYABLE_DEBT_TYPES];

/**
 * D'où viennent les lignes d'un indicateur :
 *
 * - `ledger`     écritures du journal sur la **période** (from → to) ;
 * - `ledgerTo`   écritures du journal **depuis l'origine jusqu'à `to`**
 *                (caisse, argent propre, retraits : des ÉTATS, pas des flux) ;
 * - `debts`      dettes encore ouvertes à `to`, avec le reste reconstitué ;
 * - `stock`      lots encore garnis à `to` ;
 * - `vola`       composite caisse + stock + créances − passifs (§10) ;
 * - `disposable` bénéfice encaissé non sorti = vola − argent propre − marge
 *                à recevoir, plancher à 0 (§9, §41) ;
 * - `accumulatedProfit` bénéfice encaissé cumulé = vola − argent propre +
 *                retraits − marge à recevoir (§45) — les retraits sont retirés
 *                de la caisse pour ne pas les compter deux fois ;
 * - `netProfit`  bénéfice de la période = journal + écart de marge à recevoir
 *                (§41) : `−(u(to) − u(from))` sous forme d'une ligne
 *                `MARGIN_DELAY` ;
 * - `unrealizedMargin` marge des ventes non réglées à `to` — une ligne par
 *                vente ouverte (§41).
 */
export type DrillSource =
  | 'ledger'
  | 'ledgerTo'
  | 'debts'
  | 'stock'
  | 'vola'
  | 'disposable'
  | 'accumulatedProfit'
  | 'netProfit'
  | 'unrealizedMargin';

/** `period` = écritures de la période · `toDate` = état cumulé à la date de fin. */
export type DrillScope = 'period' | 'toDate';

interface IndicatorDef {
  label: string;
  /** Source des lignes — défaut `ledger`. */
  source?: DrillSource;
  /** Source `ledger`/`ledgerTo` : kinds du journal. */
  kinds?: string[];
  /** Source `debts` : types de dettes retenus. */
  debtTypes?: string[];
  /** Ne retourne que les écritures à cashDelta > 0 */
  positiveCashOnly?: boolean;
  /**
   * Total de l'indicateur. Par défaut : `Σ amount`.
   * Les indicateurs dérivés (bénéfice) et l'argent propre ont besoin de signes
   * par `kind` : sans cela, `GET /dashboard/:indicator/transactions` ne
   * retomberait pas sur la valeur affichée au dashboard (§62, contrôle §16).
   */
  total?: (entries: DrillRow[]) => number;
}

const sumAmount = (entries: DrillRow[], kind?: string): number =>
  entries.reduce((acc, e) => (kind === undefined || e.kind === kind ? acc + e.amount : acc), 0);

const sumCashDelta = (entries: DrillRow[]): number =>
  entries.reduce((acc, e) => acc + e.cashDelta, 0);

/** Ligne fabriquée (solde initial, argent propre, règle) — mêmes champs qu'une écriture. */
function syntheticRow(
  date: Date,
  id: string,
  kind: string,
  amount: number,
  description: string,
  cashDelta = 0,
): DrillRow {
  return {
    id,
    seq: 0n,
    date,
    kind,
    amount,
    cashDelta,
    description,
    reference: null,
    refType: null,
    refId: null,
  };
}

/** Les passifs entrent en négatif dans les composites : la vola les SOUSTRAIT. */
const negateRows = (rows: DrillRow[]): DrillRow[] =>
  rows.map((e) => ({
    ...e,
    amount: -e.amount,
    cashDelta: -e.cashDelta,
    description: `− ${e.description}`,
  }));

const openingRows = (date: Date, openingCashBalance: number): DrillRow[] =>
  openingCashBalance === 0
    ? []
    : [
        syntheticRow(
          date,
          'OPENING',
          'OPENING',
          openingCashBalance,
          'Solde initial de caisse',
          openingCashBalance,
        ),
      ];

/**
 * Total des indicateurs composites : le journal est signé par `cashDelta` (une
 * vente créditée n'a pas débité la caisse de son montant), les dettes et les
 * lots par leur `amount`. Exporté pour que les tests branchent exactement la
 * même arithmétique que `GET /dashboard/:indicator/transactions`.
 */
export const sumBalance = (entries: DrillRow[]): number =>
  entries.reduce((acc, e) => acc + (ALL_CASH_KINDS.includes(e.kind) ? e.cashDelta : e.amount), 0);

/** Lignes déjà chargées d'une source composite (caisse, stock, dettes). */
export interface CompositeParts {
  /** Écritures de caisse **avec le solde initial en tête**. */
  cashRows: DrillRow[];
  stockRows: DrillRow[];
  receivableRows: DrillRow[];
  payableRows: DrillRow[];
}

/** VOLA MIODINA = caisse + stock + créances − passifs (§10). */
export function volaDrillRows(parts: CompositeParts): DrillRow[] {
  return [
    ...parts.cashRows,
    ...parts.stockRows,
    ...parts.receivableRows,
    ...negateRows(parts.payableRows),
  ];
}

/**
 * BÉNÉFICE DISPONIBLE (§9, révision A3) = bénéfice encaissé **non sorti**
 * = caisse + stock + créances − passifs − argent propre − marge à recevoir,
 * plancher à 0 (§41).
 *
 * Les lignes somment exactement cette identité : même instantané, même total
 * que la carte (§62, contrôle §16). Les retraits de bénéfice sont comptés
 * **dans** la caisse — leur `cashDelta` négatif fait précisément descendre le
 * disponible quand on sort du bénéfice.
 */
export function disposableDrillRows(
  money: Pick<DashboardResult['money'], 'disposableProfit' | 'personalCapitalEngaged'>,
  date: Date,
  parts: CompositeParts,
  unrealizedRows: DrillRow[],
): DrillRow[] {
  if (money.disposableProfit <= 0) {
    return [
      syntheticRow(
        date,
        'RULE',
        'RULE',
        0,
        'Plancher à 0 : le bénéfice encaissé non sorti ne peut pas être négatif',
      ),
    ];
  }

  const capitalRows =
    money.personalCapitalEngaged === 0
      ? []
      : [
          syntheticRow(
            date,
            'CAPITAL',
            'CAPITAL',
            -money.personalCapitalEngaged,
            'Argent propre engagé',
          ),
        ];

  return [...volaDrillRows(parts), ...capitalRows, ...negateRows(unrealizedRows)];
}

/**
 * BÉNÉFICE TOTAL (§45) = bénéfice encaissé cumulé = vola − argent propre
 * + retraits − marge à recevoir (§41). Les retraits sont déjà déduits DANS la
 * caisse : on retire leur ligne du journal pour ne pas les compter une seconde
 * fois — reste l'invariant `total = sorti + non sorti`.
 */
export function accumulatedProfitDrillRows(
  money: Pick<DashboardResult['money'], 'personalCapitalEngaged'>,
  date: Date,
  parts: CompositeParts,
  unrealizedRows: DrillRow[],
): DrillRow[] {
  const capitalRows =
    money.personalCapitalEngaged === 0
      ? []
      : [
          syntheticRow(
            date,
            'CAPITAL',
            'CAPITAL',
            -money.personalCapitalEngaged,
            'Argent propre engagé',
          ),
        ];

  return [
    ...parts.cashRows.filter((e) => e.kind !== 'PROFIT_DRAWING'),
    ...parts.stockRows,
    ...parts.receivableRows,
    ...negateRows(parts.payableRows),
    ...capitalRows,
    ...negateRows(unrealizedRows),
  ];
}


export const INDICATORS: Record<IndicatorKey, IndicatorDef> = {
  ca: { label: "Chiffre d'affaires", kinds: ['SALE'] },
  cogs: { label: 'Coût des marchandises vendues', kinds: ['COGS'] },
  grossProfit: {
    label: 'Bénéfice brut',
    kinds: ['SALE', 'COGS'],
    total: (es) => sumAmount(es, 'SALE') - sumAmount(es, 'COGS'),
  },
  netProfit: {
    label: 'Bénéfice net',
    source: 'netProfit',
    kinds: ['SALE', 'COGS', 'EXPENSE', 'VERSEMENT'],
    total: (es) =>
      sumAmount(es, 'SALE') -
      sumAmount(es, 'COGS') -
      sumAmount(es, 'EXPENSE') -
      sumAmount(es, 'VERSEMENT') +
      sumAmount(es, 'MARGIN_DELAY'),
  },
  receipts: {
    label: 'Recettes encaissées',
    kinds: ['SALE', 'CUSTOMER_PAYMENT', 'ONLINE_SELLER_PAYMENT'],
    positiveCashOnly: true,
    total: sumCashDelta,
  },
  expenses: { label: 'Dépenses', kinds: ['EXPENSE'] },
  versements: { label: 'Versements (charges)', kinds: ['VERSEMENT'] },
  cash: { label: 'Variation de caisse', kinds: ALL_CASH_KINDS, total: sumCashDelta },
  /**
   * Solde de caisse (état) : `Σ cashDelta` depuis l'origine + solde initial,
   * soit exactement `money.cash` affiché sur la carte « Caisse ».
   */
  cashBalance: {
    label: 'Caisse (solde)',
    source: 'ledgerTo',
    kinds: ALL_CASH_KINDS,
    total: sumCashDelta,
  },
  // Exclusivement cumulés au dashboard : le dérillage doit l'être aussi,
  // sinon le total du drill-down ne retombe pas sur la carte (§16).
  capital: {
    label: 'Argent propre',
    source: 'ledgerTo',
    kinds: ['PERSONAL_CAPITAL_IN', 'PERSONAL_CAPITAL_OUT'],
    // Une sortie d'argent propre est stockée avec un `amount` positif : le total
    // est la variation nette (injections − récupérations).
    total: (es) => sumAmount(es, 'PERSONAL_CAPITAL_IN') - sumAmount(es, 'PERSONAL_CAPITAL_OUT'),
  },
  profitDrawings: { label: 'Bénéfice sorti', source: 'ledgerTo', kinds: ['PROFIT_DRAWING'] },

  receivables: {
    label: 'Créances (à recevoir)',
    source: 'debts',
    debtTypes: RECEIVABLE_DEBT_TYPES,
  },
  payables: { label: 'Dettes à payer', source: 'debts', debtTypes: PAYABLE_DEBT_TYPES },
  debtsCustomer: { label: 'Dettes clients (à recevoir)', source: 'debts', debtTypes: ['CUSTOMER'] },
  debtsOnlineSeller: {
    label: 'Dettes vendeurs en ligne (à recevoir)',
    source: 'debts',
    debtTypes: ['ONLINE_SELLER'],
  },
  debtsSupplier: {
    label: 'Dettes fournisseurs (à payer)',
    source: 'debts',
    debtTypes: ['SUPPLIER'],
  },
  debtsTrosa: {
    label: 'Trosa sinoa (à payer au fournisseur)',
    source: 'debts',
    debtTypes: ['TROSA_SINOA'],
  },
  debtsTotal: {
    label: 'Dettes totales (à recevoir + à payer)',
    source: 'debts',
    debtTypes: ALL_DEBT_TYPES,
  },
  stockValue: { label: 'Valeur du stock', source: 'stock' },
  vola: { label: 'Vola miodina', source: 'vola', total: sumBalance },
  disposableProfit: { label: 'Bénéfice disponible', source: 'disposable', total: sumBalance },
  netProfitAccumulated: {
    label: 'Bénéfice total',
    source: 'accumulatedProfit',
    total: sumBalance,
  },
  // Total par défaut : Σ amount — les lignes sont déjà positives (§41).
  unrealizedMargin: { label: 'Marge à recevoir', source: 'unrealizedMargin' },
};

export const INDICATOR_KEYS = Object.keys(INDICATORS) as IndicatorKey[];

export interface DrilldownResult {
  indicator: IndicatorKey;
  label: string;
  scope: DrillScope;
  period: DashboardPeriod;
  count: number;
  total: number;
  entries: DrillRow[];
}

/** Assemble les lignes d'un indicateur selon sa source. */
async function assembleRows(
  def: IndicatorDef,
  range: PeriodRange,
  config: FinanceConfig,
): Promise<{ rows: DrillRow[]; scope: DrillScope }> {
  const source = def.source ?? 'ledger';

  if (source === 'ledger') {
    return {
      rows: await ledgerEntriesForKinds(def.kinds ?? [], range.from, range.to),
      scope: 'period',
    };
  }
  if (source === 'ledgerTo') {
    return {
      rows: await ledgerEntriesForKinds(def.kinds ?? [], EPOCH, range.to, CUMUL_LIMIT),
      scope: 'toDate',
    };
  }
  if (source === 'debts') {
    return { rows: await debtDrillEntries(range.to, def.debtTypes ?? []), scope: 'toDate' };
  }
  if (source === 'stock') {
    return { rows: await stockDrillEntries(range.to), scope: 'toDate' };
  }
  if (source === 'unrealizedMargin') {
    return { rows: await unrealizedMarginDrillEntries(range.to), scope: 'toDate' };
  }
  if (source === 'netProfit') {
    // Bénéfice de la période (§41) : journal + écart de marge à recevoir.
    // La ligne MARGIN_DELAY vaut `u(from) − u(to)` : elle convertit l'accrual
    // du journal en bénéfice encaissé, exactement comme l'affiche la carte.
    const [ledgerRows, uFrom, uTo] = await Promise.all([
      ledgerEntriesForKinds(def.kinds ?? [], range.from, range.to),
      loadUnrealizedMargin(range.from),
      loadUnrealizedMargin(range.to),
    ]);
    const delay = syntheticRow(
      range.to,
      'MARGIN_DELAY',
      'MARGIN_DELAY',
      uFrom - uTo,
      'Marge à recevoir — écart sur la période (−variation)',
    );
    return { rows: [...ledgerRows, delay], scope: 'period' };
  }

  // Sources composites : les valeurs affichées viennent du dashboard lui-même,
  // les lignes ci-dessous sont ses composantes — même instantané, même total.
  const dash = await buildDashboard(range);
  const [cashRows, stockRows, receivableRows, payableRows, unrealizedRows] = await Promise.all([
    ledgerEntriesForKinds(ALL_CASH_KINDS, EPOCH, range.to, CUMUL_LIMIT),
    stockDrillEntries(range.to),
    debtDrillEntries(range.to, RECEIVABLE_DEBT_TYPES),
    debtDrillEntries(range.to, PAYABLE_DEBT_TYPES),
    unrealizedMarginDrillEntries(range.to),
  ]);
  const parts: CompositeParts = {
    cashRows: [...openingRows(range.to, config.openingCashBalance), ...cashRows],
    stockRows,
    receivableRows,
    payableRows,
  };

  if (source === 'vola') return { rows: volaDrillRows(parts), scope: 'toDate' };
  if (source === 'accumulatedProfit') {
    return {
      rows: accumulatedProfitDrillRows(dash.money, range.to, parts, unrealizedRows),
      scope: 'toDate',
    };
  }
  return {
    rows: disposableDrillRows(dash.money, range.to, parts, unrealizedRows),
    scope: 'toDate',
  };
}

export async function getIndicatorDrilldown(
  indicator: IndicatorKey,
  key: PeriodKey,
  custom?: { from?: string; to?: string },
  now: Date = new Date(),
): Promise<DrilldownResult> {
  const def = INDICATORS[indicator];
  const range = resolvePeriod(key, now, custom);
  const { rows: all, scope } = await assembleRows(def, range, financeConfig());

  const entries = def.positiveCashOnly ? all.filter((e) => e.cashDelta > 0) : all;
  const total = def.total ? def.total(entries) : entries.reduce((acc, e) => acc + e.amount, 0);

  return {
    indicator,
    label: def.label,
    scope,
    period: {
      key: range.key,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      label: range.label,
    },
    count: entries.length,
    total,
    entries,
  };
}

