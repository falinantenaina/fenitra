import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { money } from '../../lib/money';
import { ilike, offset, pageMeta } from '../../lib/pagination';
import {
  buildDashboard,
  type DashboardResult,
} from '../../services/metrics';
import {
  toZonedParts,
  zonedToUtc,
  type PeriodRange,
} from '../../services/period.service';
import { expensesSummary } from '../finances/expenses.service';
import type { DailyReportQuery, LedgerQuery, MonthlyReportQuery } from './reports.schemas';

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
  disposableProfit: string;
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
    disposableProfit: money(m.disposableProfit),
  };
}

export interface ReportResult {
  period: { from: string; to: string; label: string };
  activity: PresentedActivity;
  money: PresentedMoney;
  integrity: DashboardResult['integrity'];
  sales: unknown[];
  topProducts: unknown[];
  expensesByCategory: { category: { id: string; name: string; icon: string | null }; count: number; amount: string }[];
}

async function buildReport(range: PeriodRange, take: number): Promise<ReportResult> {
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
                size: { select: { label: true } },
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
      size: { select: { label: true } },
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

  return {
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
    expensesByCategory: expenses.items,
  };
}

export async function dailyReport(query: DailyReportQuery) {
  const { range, label, date } = dayRange(query.date);
  const report = await buildReport(range, 200);
  return { type: 'daily' as const, date, label, ...report };
}

export async function monthlyReport(query: MonthlyReportQuery) {
  const { range, label, year, month } = monthRange(query.year, query.month);
  const report = await buildReport(range, 500);
  return { type: 'monthly' as const, year, month, label, ...report };
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
  const report = query.type === 'daily' ? await dailyReport({ date: query.date }) : await monthlyReport({ year: query.year, month: query.month });

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
    '',
    'VENTES',
    ...report.sales.map((s) => {
      const sale = s as { reference: string; date: string; party: string | null; totalAmount: string; margin: string };
      return `${sale.reference}  ${new Date(sale.date).toISOString().slice(0, 16).replace('T', ' ')}  ` +
        `${(sale.party ?? 'Comptoir').padEnd(18).slice(0, 18)}  ${sale.totalAmount.padStart(12)}  marge ${sale.margin}`;
    }),
    '',
    'TOP PRODUITS',
    ...report.topProducts.slice(0, 15).map((p) => {
      const t = p as { product: { name: string } | null; size: { label: string } | null; quantity: number; revenue: string; margin: string };
      const name = `${t.product?.name ?? '?'} ${t.size?.label ?? ''}`.padEnd(28).slice(0, 28);
      return `${name} x${String(t.quantity).padStart(4)}  ${t.revenue.padStart(12)}  marge ${t.margin}`;
    }),
    '',
    'DEPENSES PAR CATEGORIE',
    ...report.expensesByCategory.map((c) => `${c.category.name.padEnd(28).slice(0, 28)} ${c.amount.padStart(12)}`),
  ];

  const filename =
    report.type === 'daily' ? `rapport-${report.date}.pdf` : `rapport-${report.year}-${pad(report.month)}.pdf`;
  return { filename, buffer: buildPdf('Gestion Vente', lines), report };
}
