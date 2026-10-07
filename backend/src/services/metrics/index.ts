import { Prisma } from '@prisma/client';

import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import {
  computeDerived,
  DEFAULT_FINANCE_CONFIG,
  type DerivedMetrics,
  type FinanceConfig,
} from './core';
import {
  debtDrillEntries,
  ledgerEntriesForKinds,
  loadActivity,
  loadBalance,
  stockDrillEntries,
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
    /** Bénéfice net cumulé **réalisé** — total, retraits compris (§45) */
    netProfitAccumulated: number;
    /** Bénéfice net cumulé **non sorti** = total − retraits */
    netProfitNotWithdrawn: number;
    disposableProfit: number;
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
    workingReserve: env.WORKING_RESERVE,
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
  const [activity, balance, allTime] = await prisma.$transaction(
    async (tx) =>
      Promise.all([
        loadActivity(range.from, range.to, tx),
        loadBalance(range.from, range.to, config.openingCashBalance, tx),
        loadActivity(cumulative.from, cumulative.to, tx),
      ]),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  // L'intégrité compare des STOCKS (caisse, stock, dettes à `to`) à des
  // FLUX cumulés : on utilise donc l'activité depuis l'origine, quel que
  // soit le filtre d'affichage de la période.
  const d: DerivedMetrics = computeDerived(activity, balance, config, allTime);

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
      netProfit: d.netProfit,
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
  | 'disposableProfit';

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
 * - `disposable` bénéfice mangeable, décomposé selon la contrainte qui le
 *                borne entre le bénéfice net cumulé et l'excédent de caisse (§9).
 */
export type DrillSource = 'ledger' | 'ledgerTo' | 'debts' | 'stock' | 'vola' | 'disposable';

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
 * BÉNÉFICE DISPONIBLE (§9) = max(0, min(bénéfice net cumulé, excédent de caisse)).
 *
 * Les deux bornes ne sont pas interchangeables : on construit les lignes de la
 * contrainte qui produit réellement la valeur affichée, sinon le total du
 * dérillage ne retombe pas sur la carte (§62, contrôle §16).
 *
 * `cashSurplus ≤ netProfitAccumulated` dans la pratique (stock, créances,
 * retraits et réserve sont tous ≥ 0) : la première branche est la courante, la
 * seconde n'est atteinte que si des retraits de bénéfice ont été contre-passés.
 */
export function disposableDrillRows(
  money: Pick<
    DashboardResult['money'],
    'cash' | 'payables' | 'personalCapitalEngaged' | 'disposableProfit'
  >,
  config: FinanceConfig,
  date: Date,
  parts: CompositeParts,
): DrillRow[] {
  if (money.disposableProfit <= 0) {
    return [
      syntheticRow(
        date,
        'RULE',
        'RULE',
        0,
        'Plancher à 0 : un bénéfice mangeable ne peut pas être négatif',
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
  const reserveRows =
    config.workingReserve === 0
      ? []
      : [syntheticRow(date, 'RESERVE', 'RESERVE', -config.workingReserve, 'Réserve de rotation')];

  const cashSurplus =
    money.cash - money.payables - money.personalCapitalEngaged - config.workingReserve;

  if (Math.abs(money.disposableProfit - cashSurplus) < 0.01) {
    return [...parts.cashRows, ...negateRows(parts.payableRows), ...capitalRows, ...reserveRows];
  }

  // Bénéfice net cumulé = vola − argent propre + retraits. Les retraits de
  // bénéfice sont déjà déduits DANS la caisse : on les retire de la ligne de
  // caisse pour ne pas les compter une seconde fois.
  return [
    ...parts.cashRows.filter((e) => e.kind !== 'PROFIT_DRAWING'),
    ...parts.stockRows,
    ...parts.receivableRows,
    ...negateRows(parts.payableRows),
    ...capitalRows,
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
    kinds: ['SALE', 'COGS', 'EXPENSE', 'VERSEMENT'],
    total: (es) =>
      sumAmount(es, 'SALE') -
      sumAmount(es, 'COGS') -
      sumAmount(es, 'EXPENSE') -
      sumAmount(es, 'VERSEMENT'),
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

  // Sources composites : les valeurs affichées viennent du dashboard lui-même,
  // les lignes ci-dessous sont ses composantes — même instantané, même total.
  const dash = await buildDashboard(range);
  const [cashRows, stockRows, receivableRows, payableRows] = await Promise.all([
    ledgerEntriesForKinds(ALL_CASH_KINDS, EPOCH, range.to, CUMUL_LIMIT),
    stockDrillEntries(range.to),
    debtDrillEntries(range.to, RECEIVABLE_DEBT_TYPES),
    debtDrillEntries(range.to, PAYABLE_DEBT_TYPES),
  ]);
  const parts: CompositeParts = {
    cashRows: [...openingRows(range.to, config.openingCashBalance), ...cashRows],
    stockRows,
    receivableRows,
    payableRows,
  };

  if (source === 'vola') return { rows: volaDrillRows(parts), scope: 'toDate' };
  return { rows: disposableDrillRows(dash.money, config, range.to, parts), scope: 'toDate' };
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


export { DEFAULT_FINANCE_CONFIG };
