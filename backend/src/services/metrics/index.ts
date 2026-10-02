import { env } from '../../config/env';
import {
  computeDerived,
  DEFAULT_FINANCE_CONFIG,
  type DerivedMetrics,
  type FinanceConfig,
} from './core';
import { ledgerEntriesForKinds, loadActivity, loadBalance } from './queries';
import { resolvePeriod, cumulativeUntil, type PeriodKey, type PeriodRange } from '../period.service';

export * from './core';

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

  const [activity, balance, allTime] = await Promise.all([
    loadActivity(range.from, range.to),
    loadBalance(range.from, range.to, config.openingCashBalance),
    loadActivity(cumulative.from, cumulative.to),
  ]);

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
  | 'capital'
  | 'profitDrawings';

interface IndicatorDef {
  label: string;
  kinds: string[];
  /** Ne retourne que les écritures à cashDelta > 0 */
  positiveCashOnly?: boolean;
}

export const INDICATORS: Record<IndicatorKey, IndicatorDef> = {
  ca: { label: "Chiffre d'affaires", kinds: ['SALE'] },
  cogs: { label: 'Coût des marchandises vendues', kinds: ['COGS'] },
  grossProfit: { label: 'Bénéfice brut', kinds: ['SALE', 'COGS'] },
  netProfit: { label: 'Bénéfice net', kinds: ['SALE', 'COGS', 'EXPENSE', 'VERSEMENT'] },
  receipts: {
    label: 'Recettes encaissées',
    kinds: ['SALE', 'CUSTOMER_PAYMENT', 'ONLINE_SELLER_PAYMENT'],
    positiveCashOnly: true,
  },
  expenses: { label: 'Dépenses', kinds: ['EXPENSE'] },
  versements: { label: 'Versements (charges)', kinds: ['VERSEMENT'] },
  cash: { label: 'Caisse', kinds: ALL_CASH_KINDS },
  capital: { label: 'Argent propre', kinds: ['PERSONAL_CAPITAL_IN', 'PERSONAL_CAPITAL_OUT'] },
  profitDrawings: { label: 'Bénéfice sorti', kinds: ['PROFIT_DRAWING'] },
};

export const INDICATOR_KEYS = Object.keys(INDICATORS) as IndicatorKey[];

export interface DrilldownResult {
  indicator: IndicatorKey;
  label: string;
  period: DashboardPeriod;
  count: number;
  total: number;
  entries: Awaited<ReturnType<typeof ledgerEntriesForKinds>>;
}

export async function getIndicatorDrilldown(
  indicator: IndicatorKey,
  key: PeriodKey,
  custom?: { from?: string; to?: string },
  now: Date = new Date(),
): Promise<DrilldownResult> {
  const def = INDICATORS[indicator];
  const range = resolvePeriod(key, now, custom);
  let entries = await ledgerEntriesForKinds(def.kinds, range.from, range.to);
  if (def.positiveCashOnly) entries = entries.filter((e) => e.cashDelta > 0);

  return {
    indicator,
    label: def.label,
    period: {
      key: range.key,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      label: range.label,
    },
    count: entries.length,
    total: entries.reduce((acc, e) => acc + (def.positiveCashOnly ? e.cashDelta : e.amount), 0),
    entries,
  };
}

export { DEFAULT_FINANCE_CONFIG };
