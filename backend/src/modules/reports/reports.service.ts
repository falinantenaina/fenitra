import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { money } from '../../lib/money';
import { badRequest } from '../../lib/errors';
import { ilike, offset, pageMeta } from '../../lib/pagination';
import { env } from '../../config/env';
import {
  buildDashboard,
  type DashboardResult,
} from '../../services/metrics';
import { loadSeries } from '../../services/metrics/queries';
import {
  resolvePeriod,
  toZonedParts,
  zonedToUtc,
  type PeriodRange,
} from '../../services/period.service';
import { expensesSummary } from '../finances/expenses.service';
import type {
  DailyReportQuery,
  LedgerQuery,
  MonthlyReportQuery,
  SeriesMetric,
  SeriesQuery,
} from './reports.schemas';

/* ════════════════════ JOURNAL (§39) ════════════════════ */

const entryRow = (e: {
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
  user?: { id: string; name: string } | null;
}) => ({
  id: e.id,
  seq: Number(e.seq),
  date: e.date,
  kind: e.kind,
  amount: money(e.amount),
  cashDelta: money(e.cashDelta),
  description: e.description,
  reference: e.reference,
  refType: e.refType,
  refId: e.refId,
  user: e.user ?? undefined,
});

function ledgerWhere(query: LedgerQuery): Prisma.LedgerEntryWhereInput {
  return {
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.refType ? { refType: query.refType } : {}),
    ...(query.cash === 'true' ? { cashDelta: { not: 0 } } : {}),
    ...(query.from || query.to
      ? { date: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(ilike(query.q) ? { description: ilike(query.q) } : {}),
  };
}

export async function listLedger(query: LedgerQuery) {
  const where = ledgerWhere(query);

  const [items, total] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where,
      orderBy: [{ date: 'desc' }, { seq: 'desc' }],
      skip: offset(query),
      take: query.limit,
      include: { user: { select: { id: true, name: true } } },
    }),
    prisma.ledgerEntry.count({ where }),
  ]);

  return { items: items.map(entryRow), ...pageMeta(total, query.page, query.limit) };
}

/** Agrégats du journal : total d'impact caisse + détail par `kind`. */
export async function ledgerSummary(query: LedgerQuery) {
  const where = ledgerWhere(query);
  const groups = await prisma.ledgerEntry.groupBy({
    by: ['kind'],
    where,
    _count: { _all: true },
    _sum: { amount: true, cashDelta: true },
  });

  const byKind = groups
    .map((g) => ({
      kind: g.kind,
      count: g._count._all,
      amount: money(g._sum.amount ?? 0),
      cashDelta: money(g._sum.cashDelta ?? 0),
    }))
    .sort((a, b) => b.count - a.count);

  const totals = groups.reduce(
    (acc, g) => ({
      count: acc.count + g._count._all,
      amount: acc.amount + (g._sum.amount ?? 0),
      cashDelta: acc.cashDelta + (g._sum.cashDelta ?? 0),
    }),
    { count: 0, amount: 0, cashDelta: 0 },
  );

  return {
    byKind,
    totals: {
      count: totals.count,
      amount: money(totals.amount),
      cashDelta: money(totals.cashDelta),
    },
  };
}

/* ════════════════════ PÉRIODES DE RAPPORT ════════════════════ */

export function dayRange(dateStr: string | undefined): { range: PeriodRange; label: string; date: string } {
  const now = new Date();
  const p = dateStr ? parseDay(dateStr) : toZonedParts(now);
  const from = zonedToUtc(p.year, p.month, p.day);
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  const label = `${pad(p.day)}/${pad(p.month)}/${p.year}`;
  return {
    range: { key: 'custom', from, to, label: `Rapport du ${label}` },
    label,
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
  };
}

export function monthRange(year?: number, month?: number): { range: PeriodRange; label: string; year: number; month: number } {
  const p = toZonedParts(new Date());
  const y = year ?? p.year;
  const m = month ?? p.month;
  const from = zonedToUtc(y, m, 1);
  const to = m === 12 ? zonedToUtc(y + 1, 1, 1) : zonedToUtc(y, m + 1, 1);
  const label = `${pad(m)}/${y}`;
  return {
    range: { key: 'custom', from, to, label: `Rapport de ${label}` },
    label,
    year: y,
    month: m,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

function parseDay(value: string) {
  const [y, m, d] = value.split('-').map(Number);
  return { year: y!, month: m!, day: d! };
}

/* ════════════════════ RAPPORTS (§— / §63) ════════════════════ */

/** Activité présentée — §11 : montants en string décimale, compteurs en nombre. */
export interface PresentedActivity {
  salesCount: number;
  ca: string;
  receipts: string;
  collectedAtSale: string;
  cogs: string;
  grossProfit: string;
  expenses: string;
  versementCharges: string;
  netProfit: string;
  cashOutflow: string;
}

/** Trésorerie présentée — mêmes libellés que `GET /dashboard`. */
export interface PresentedMoney {
  cash: string;
  cashAtStart: string;
  cashDelta: string;
  receivables: string;
  payable: string;
  workingCapital: string;
  volaMiodina: string;
  personalCapitalEngaged: string;
  personalCapitalIn: string;
  personalCapitalOut: string;
  profitDrawings: string;
  netProfitAccumulated: string;
  netProfitNotWithdrawn: string;
  disposableProfit: string;
  /** Marge des ventes non encore entièrement réglées (§41) */
  unrealizedMargin: string;
}

export function presentActivity(a: DashboardResult['activity']): PresentedActivity {
  return {
    salesCount: a.salesCount,
    ca: money(a.ca),
    receipts: money(a.receipts),
    collectedAtSale: money(a.collectedAtSale),
    cogs: money(a.cogs),
    grossProfit: money(a.grossProfit),
    expenses: money(a.expenses),
    versementCharges: money(a.versementCharges),
    netProfit: money(a.netProfit),
    cashOutflow: money(a.cashOutflow),
  };
}

export function presentMoney(m: DashboardResult['money']): PresentedMoney {
  return {
    cash: money(m.cash),
    cashAtStart: money(m.cashAtStart),
    cashDelta: money(m.cashDelta),
    receivables: money(m.receivables),
    payable: money(m.payables),
    workingCapital: money(m.volaMiodina),
    volaMiodina: money(m.volaMiodina),
    personalCapitalEngaged: money(m.personalCapitalEngaged),
    personalCapitalIn: money(m.personalCapitalIn),
    personalCapitalOut: money(m.personalCapitalOut),
    profitDrawings: money(m.profitDrawings),
    netProfitAccumulated: money(m.netProfitAccumulated),
    netProfitNotWithdrawn: money(m.netProfitNotWithdrawn),
    disposableProfit: money(m.disposableProfit),
    unrealizedMargin: money(m.unrealizedMargin),
  };
}

/** Ligne de vente du rapport — §48 (journalier et mensuel). */
export interface ReportSaleLine {
  id: string;
  reference: string;
  date: Date;
  status: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  cogs: string;
  margin: string;
  party: string | null;
  items: {
    product: { id: string; name: string };
      size: { value: number; label: string | null } | null;
      sku: string | null;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    cogs: string;
    margin: string;
  }[];
}

/** Article du rapport — `margin` = bénéfice apporté par le produit (§48). */
export interface ReportTopProduct {
  variantId: string;
  sku: string | null;
  product: { id: string; name: string } | null;
  size: { value: number; label: string | null } | null;
  quantity: number;
  revenue: string;
  cogs: string;
  margin: string;
  salesCount: number;
}

export interface ReportResult {
  period: { from: string; to: string; label: string };
  activity: PresentedActivity;
  money: PresentedMoney;
  integrity: DashboardResult['integrity'];
  sales: ReportSaleLine[];
  /** Articles classés par chiffre d'affaires. */
  topProducts: ReportTopProduct[];
  /** Articles classés par quantité — « produits les plus vendus » (§48). */
  bestSellers: ReportTopProduct[];
  expensesByCategory: { category: { id: string; name: string; icon: string | null }; count: number; amount: string }[];
}

/** §48 — rapport journalier : encaissements et dettes ouvertes sur la journée. */
export interface DailyReportExtras {
  /** Règlements clients + vendeurs en ligne encaissés (kind `*_PAYMENT`). */
  paymentsReceived: string;
  /** Règlements fournisseurs décaissés (kind `SUPPLIER_PAYMENT`). */
  paymentsSupplier: string;
  /** Ce qui est devenu dû sur la période (reste à payer à l'ouverture), hors annulations. */
  newDebts: string;
}

/** §48 — rapport mensuel : états cumulés à la fin du mois + ventilations. */
export interface MonthlyReportExtras {
  stock: { quantity: number; value: string };
  debts: { customer: string; onlineSeller: string; supplier: string; trosaSinoa: string };
  versementsByPerson: { person: string; count: number; amount: string }[];
}

export type DailyReportBody = ReportResult &
  DailyReportExtras & { type: 'daily'; date: string; label: string };

export type MonthlyReportBody = ReportResult &
  MonthlyReportExtras & { type: 'monthly'; year: number; month: number; label: string };


/** Corps commun : le `dashboard` brut est rendu interne (jamais sérialisé). */
async function buildReport(
  range: PeriodRange,
  take: number,
): Promise<{ report: ReportResult; dashboard: DashboardResult }> {
  const dashboard = await buildDashboard(range);

  const [sales, rawTop] = await Promise.all([
    prisma.sale.findMany({
      where: { date: { gte: range.from, lt: range.to }, status: { not: 'CANCELLED' } },
      orderBy: [{ date: 'asc' }, { reference: 'asc' }],
      take,
      include: {
        customer: { select: { name: true } },
        onlineSeller: { select: { name: true } },
        items: {
          include: {
            variant: {
              select: {
                sku: true,
                product: { select: { id: true, name: true } },
                size: { select: { value: true, label: true } },
              },
            },
          },
        },
      },
    }),
    prisma.saleItem.groupBy({
      by: ['variantId'],
      where: { sale: { date: { gte: range.from, lt: range.to }, status: { not: 'CANCELLED' } } },
      _sum: { quantity: true, lineTotal: true, cogs: true },
      _count: { _all: true },
    }),
  ]);

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: rawTop.map((t) => t.variantId) } },
    select: {
      id: true,
      sku: true,
      product: { select: { id: true, name: true } },
      size: { select: { value: true, label: true } },
    },
  });
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const topProducts = rawTop
    .map((t) => {
      const v = variantById.get(t.variantId);
      const revenue = t._sum.lineTotal ?? 0;
      const cogs = t._sum.cogs ?? 0;
      return {
        variantId: t.variantId,
        sku: v?.sku ?? null,
        product: v?.product ?? null,
        size: v?.size ?? null,
        quantity: t._sum.quantity ?? 0,
        revenue: money(revenue),
        cogs: money(cogs),
        margin: money(revenue - cogs),
        salesCount: t._count._all,
      };
    })
    .sort((a, b) => Number(b.revenue) - Number(a.revenue));

  const expenses = await expensesSummary({
    page: 1,
    limit: 50,
    from: range.from,
    to: new Date(range.to.getTime() - 1),
  });

  const report: ReportResult = {
    period: { from: range.from.toISOString(), to: range.to.toISOString(), label: range.label },
    activity: presentActivity(dashboard.activity),
    money: presentMoney(dashboard.money),
    integrity: dashboard.integrity,
    sales: sales.map((s) => ({
      id: s.id,
      reference: s.reference,
      date: s.date,
      status: s.status,
      totalAmount: money(s.totalAmount),
      paidAmount: money(s.paidAmount),
      remainingAmount: money(s.remainingAmount),
      cogs: money(s.cogs),
      margin: money(s.margin),
      party: s.customer?.name ?? s.onlineSeller?.name ?? null,
      items: s.items.map((i) => ({
        product: i.variant.product,
        size: i.variant.size,
        sku: i.variant.sku,
        quantity: i.quantity,
        unitPrice: money(i.unitPrice),
        lineTotal: money(i.lineTotal),
        cogs: money(i.cogs),
        margin: money(i.lineTotal - i.cogs),
      })),
    })),
    topProducts,
    bestSellers: [...topProducts].sort(
      (a, b) => b.quantity - a.quantity || Number(b.revenue) - Number(a.revenue),
    ),
    expensesByCategory: expenses.items,
  };

  return { report, dashboard };
}

/**
 * §48 (journalier) — « nouvelles dettes » : ce qui est **réellement devenu dû**
 * sur la période.
 *
 * `Debt.remainingAmount` bouge à chaque règlement : on y ajoute donc les
 * règlements journalisés depuis l'ouverture pour remonter au reste à payer du
 * jour (`initialAmount − payé à l'ouverture`). Résultat stable dans le temps
 * (§69) — contrairement à `remainingAmount` lu seul.
 *
 * Les règlements faits **à l'ouverture** d'un arrivage portent `refType =
 * 'ARRIVAL'` : compter l'arrivée non payée, pas l'acompte déjà sorti.
 */
async function newDebtsIn(range: PeriodRange): Promise<number> {
  const debts = await prisma.debt.findMany({
    where: { date: { gte: range.from, lt: range.to }, cancelledAt: null },
    select: { id: true, remainingAmount: true },
  });
  if (debts.length === 0) return 0;

  const settled = await prisma.ledgerEntry.groupBy({
    by: ['debtId'],
    where: {
      debtId: { in: debts.map((d) => d.id) },
      kind: {
        in: ['CUSTOMER_PAYMENT', 'ONLINE_SELLER_PAYMENT', 'SUPPLIER_PAYMENT', 'TROSA_REPAY'],
      },
      OR: [{ refType: { not: 'ARRIVAL' } }, { refType: null }],
    },
    _sum: { amount: true },
  });
  const byDebt = new Map(settled.map((s) => [s.debtId, s._sum.amount ?? 0]));

  return debts.reduce((total, d) => total + d.remainingAmount + (byDebt.get(d.id) ?? 0), 0);
}

/**
 * §48 (journalier) — encaissements et décaissements de la période.
 * Source : le journal financier (écritures `*_PAYMENT`).
 */
async function dailyExtras(range: PeriodRange): Promise<DailyReportExtras> {
  const [payments, newDebts] = await Promise.all([
    prisma.ledgerEntry.groupBy({
      by: ['kind'],
      where: {
        date: { gte: range.from, lt: range.to },
        kind: { in: ['CUSTOMER_PAYMENT', 'ONLINE_SELLER_PAYMENT', 'SUPPLIER_PAYMENT'] },
      },
      _sum: { amount: true },
    }),
    newDebtsIn(range),
  ]);

  const sumOf = (kinds: string[]) =>
    payments
      .filter((p) => kinds.includes(p.kind))
      .reduce((total, p) => total + (p._sum.amount ?? 0), 0);

  return {
    paymentsReceived: money(sumOf(['CUSTOMER_PAYMENT', 'ONLINE_SELLER_PAYMENT'])),
    paymentsSupplier: money(sumOf(['SUPPLIER_PAYMENT'])),
    newDebts: money(newDebts),
  };
}

/** §48 (mensuel) — états cumulés à la fin du mois + versements par personne. */
async function monthlyExtras(
  range: PeriodRange,
  dashboard: DashboardResult,
): Promise<MonthlyReportExtras> {
  const grouped = await prisma.versement.groupBy({
    by: ['personName'],
    where: { date: { gte: range.from, lt: range.to } },
    _sum: { amount: true },
    _count: { _all: true },
  });

  return {
    stock: { quantity: dashboard.stock.quantity, value: money(dashboard.stock.value) },
    debts: {
      customer: money(dashboard.debts.customer),
      onlineSeller: money(dashboard.debts.onlineSeller),
      supplier: money(dashboard.debts.supplier),
      trosaSinoa: money(dashboard.debts.trosaSinoa),
    },
    versementsByPerson: grouped
      .map((g) => ({
        person: g.personName,
        count: g._count._all,
        amount: money(g._sum.amount ?? 0),
      }))
      .sort((a, b) => Number(b.amount) - Number(a.amount)),
  };
}

export async function dailyReport(query: DailyReportQuery): Promise<DailyReportBody> {
  const { range, label, date } = dayRange(query.date);
  const [{ report }, extras] = await Promise.all([buildReport(range, 200), dailyExtras(range)]);
  return { type: 'daily', date, label, ...report, ...extras };
}

export async function monthlyReport(query: MonthlyReportQuery): Promise<MonthlyReportBody> {
  const { range, label, year, month } = monthRange(query.year, query.month);
  const { report, dashboard } = await buildReport(range, 500);
  const extras = await monthlyExtras(range, dashboard);
  return { type: 'monthly', year, month, label, ...report, ...extras };
}

/* ══════════════════ SÉRIES POUR GRAPHIQUES (§3) ══════════════════ */

const SERIES_LABELS: Record<SeriesMetric, string> = {
  ca: "Chiffre d'affaires",
  receipts: 'Recettes encaissées',
  outflow: "Sorties d'argent",
};

/** Au-delà, l'axe journalier d'un graphique n'est plus lisible. */
const MAX_SERIES_DAYS = 400;

const pad2 = (n: number): string => String(n).padStart(2, '0');

export interface SeriesPoint {
  /** Jour civil dans la timezone du business (`AAAA-MM-JJ`). */
  date: string;
  value: string;
}

/**
 * Jours civils de `[from, to)` dans la timezone du business.
 * On avance sur le **calendrier** (`Date.UTC(y, m, d + 1)`) plutôt qu'en
 * ajoutant 24 h à un instant : ni l'heure d'avance ni celle de retard ne
 * peuvent faire déborder la date d'un graphe.
 */
function civilDays(from: Date, to: Date): string[] {
  const first = toZonedParts(from);
  const last = toZonedParts(new Date(to.getTime() - 1));
  const stop = `${last.year}-${pad2(last.month)}-${pad2(last.day)}`;

  const days: string[] = [];
  let { year, month, day } = first;
  for (;;) {
    const date = `${year}-${pad2(month)}-${pad2(day)}`;
    if (date > stop) return days;
    days.push(date);
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
}

/**
 * §3 — série journalière d'un indicateur de flux pour le tableau de bord.
 * Les jours sans écriture sont remplis à `0` (axe continu) et les totaux
 * coïncident avec ceux du dashboard : mêmes prédicats, même plage.
 */
export async function reportSeries(query: SeriesQuery) {
  const range = resolvePeriod(
    query.period,
    new Date(),
    query.period === 'custom' ? { from: query.from, to: query.to } : undefined,
  );

  const days = civilDays(range.from, range.to);
  if (days.length > MAX_SERIES_DAYS) {
    throw badRequest(
      `Période trop longue pour une série journalière (max ${MAX_SERIES_DAYS} jours, demandés : ${days.length})`,
    );
  }

  const rows = await loadSeries(range.from, range.to, query.metric, env.BUSINESS_TIMEZONE);
  const byDay = new Map(rows.map((r) => [r.day, r.value]));

  return {
    metric: query.metric,
    label: SERIES_LABELS[query.metric],
    period: range.label,
    total: money(rows.reduce((sum, r) => sum + r.value, 0)),
    points: days.map<SeriesPoint>((date) => ({ date, value: money(byDay.get(date) ?? 0) })),
    meta: {
      period: range.key,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      timezone: env.BUSINESS_TIMEZONE,
      currency: 'MGA',
    },
  };
}

/* ════════════════════ EXPORT PDF (sans dépendance) ════════════════════ */

const PAGE_LINES = 48;

function escapePdfText(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 63;
    const byte = code <= 255 ? code : 63;
    const c = String.fromCharCode(byte);
    if (c === '(' || c === ')' || c === '\\') out += '\\' + c;
    else out += c;
  }
  return out;
}

/** Génère un PDF A4 minimal (Helvetica, pagination) — aucun service externe. */
export function buildPdf(title: string, lines: string[]): Buffer {
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += PAGE_LINES) pages.push(lines.slice(i, i + PAGE_LINES));
  if (pages.length === 0) pages.push([]);

  const pageCount = pages.length;
  const fontObj = 3 + 2 * pageCount;

  const objects: string[] = [];
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';

  const kids = pages.map((_, i) => `${3 + 2 * i} 0 R`).join(' ');
  objects[1] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;

  pages.forEach((pageLines, i) => {
    const pageObj = 3 + 2 * i;
    const contentObj = 4 + 2 * i;
    objects[pageObj - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentObj} 0 R >>`;

    const body = [
      'BT',
      '/F1 12 Tf',
      '14 TL',
      '50 800 Td',
      `(${escapePdfText(i === 0 ? title : `${title} (suite)`)} ) Tj`,
      'T*',
      '/F1 9 Tf',
      `(${escapePdfText('')}) Tj`,
      'T*',
      '/F1 10 Tf',
      ...pageLines.flatMap((l) => [`(${escapePdfText(l)}) Tj`, 'T*']),
      'ET',
    ].join('\n');

    objects[contentObj - 1] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });

  objects[fontObj - 1] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \r\n';
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \r\n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

export async function exportReportPdf(query: { type: 'daily' | 'monthly'; date?: string; year?: number; month?: number }) {
  const report =
    query.type === 'daily'
      ? await dailyReport({ date: query.date })
      : await monthlyReport({ year: query.year, month: query.month });

  const a = report.activity;
  const lines: string[] = [
    `${report.label} — ${report.type === 'daily' ? 'Rapport journalier' : 'Rapport mensuel'}`,
    '',
    `Chiffre d'affaires : ${a.ca} Ar   (${a.salesCount} vente(s))`,
    `Recettes encaissees : ${a.receipts} Ar`,
    `COGS : ${a.cogs} Ar`,
    `Benefice brut : ${a.grossProfit} Ar`,
    `Depenses : ${a.expenses} Ar`,
    `Versements (charges) : ${a.versementCharges} Ar`,
    `Benefice net : ${a.netProfit} Ar`,
    `Caisse : ${report.money.cash} Ar`,
    '',
  ];

  if (report.type === 'daily') {
    lines.push(
      `Paiements recus : ${report.paymentsReceived} Ar`,
      `Paiements fournisseurs : ${report.paymentsSupplier} Ar`,
      `Nouvelles dettes : ${report.newDebts} Ar`,
      '',
      'VENTES',
      ...report.sales.map(
        (s) =>
          `${s.reference}  ${s.date.toISOString().slice(0, 16).replace('T', ' ')}  ` +
          `${(s.party ?? 'Comptoir').padEnd(18).slice(0, 18)}  ${s.totalAmount.padStart(12)}  marge ${s.margin}`,
      ),
      '',
      'TOP PRODUITS',
      ...productLines(report.topProducts),
      '',
    );
  } else {
    lines.push(
      'SITUATION EN FIN DE MOIS',
      `Valeur du stock : ${report.stock.value} Ar (${report.stock.quantity} paire(s))`,
      `Dettes clients (a recevoir) : ${report.debts.customer} Ar`,
      `Dettes vendeurs en ligne (a recevoir) : ${report.debts.onlineSeller} Ar`,
      `Dettes fournisseurs (a payer) : ${report.debts.supplier} Ar`,
      `Trosa sinoa (a payer au fournisseur) : ${report.debts.trosaSinoa} Ar`,
      `Argent propre engage : ${report.money.personalCapitalEngaged} Ar`,
      '',
      'VERSEMENTS PAR PERSONNE',
      ...report.versementsByPerson.map(
        (v) =>
          `${v.person.padEnd(24).slice(0, 24)} ${String(v.count).padStart(3)} fois  ${v.amount.padStart(12)}`,
      ),
      '',
      'PRODUITS LES PLUS VENDUS (benefice par produit)',
      ...productLines(report.bestSellers),
      '',
      'VENTES',
      ...report.sales.map(
        (s) =>
          `${s.reference}  ${s.date.toISOString().slice(0, 16).replace('T', ' ')}  ` +
          `${(s.party ?? 'Comptoir').padEnd(18).slice(0, 18)}  ${s.totalAmount.padStart(12)}  marge ${s.margin}`,
      ),
      '',
      'CHIFFRE D AFFAIRES PAR PRODUIT',
      ...productLines(report.topProducts),
      '',
    );
  }

  lines.push(
    'DEPENSES PAR CATEGORIE',
    ...report.expensesByCategory.map(
      (c) => `${c.category.name.padEnd(28).slice(0, 28)} ${c.amount.padStart(12)}`,
    ),
  );

  const filename =
    report.type === 'daily' ? `rapport-${report.date}.pdf` : `rapport-${report.year}-${pad(report.month)}.pdf`;
  return { filename, buffer: buildPdf('Gestion Vente', lines), report };
}

function productLines(items: ReportTopProduct[], take = 15): string[] {
  return items.slice(0, take).map((t) => {
    const name = `${t.product?.name ?? '?'} ${t.size?.label ?? t.size?.value ?? ''}`.padEnd(28).slice(0, 28);
    return `${name} x${String(t.quantity).padStart(4)}  ${t.revenue.padStart(12)}  marge ${t.margin}`;
  });
}
