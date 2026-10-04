import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseParams, parseQuery } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { money } from '../../lib/money';
import { prisma } from '../../lib/prisma';
import {
  getDashboard,
  getIndicatorDrilldown,
  INDICATORS,
  INDICATOR_KEYS,
  type DashboardResult,
  type IndicatorKey,
} from '../../services/metrics';
import {
  dashboardQuery,
  dailyReportQuery,
  exportQuery,
  ledgerQuery,
  monthlyReportQuery,
  seriesQuery,
} from './reports.schemas';
import {
  dailyReport,
  exportReportPdf,
  ledgerSummary,
  listLedger,
  monthlyReport,
  presentActivity,
  presentMoney,
  reportSeries,
} from './reports.service';

export const ledgerRouter = Router();
export const dashboardRouter = Router();
export const reportsRouter = Router();

/* ════════════════════ JOURNAL (§39) ════════════════════ */

/** GET /api/ledger — journal financier central */
ledgerRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listLedger(parseQuery(req, ledgerQuery)));
  }),
);

/** GET /api/ledger/summary — agrégats par type d'écriture */
ledgerRouter.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await ledgerSummary(parseQuery(req, ledgerQuery)));
  }),
);

/* ════════════════════ DASHBOARD ════════════════════ */

type Presentable = DashboardResult & { soldItems?: number };

/** Montants exposés en string (conventions §11), compteurs laissés en nombre. */
function presentDashboard(d: Presentable) {
  return {
    period: d.period,
    activity: presentActivity(d.activity),
    money: presentMoney(d.money),
    debts: {
      customer: money(d.debts.customer),
      onlineSeller: money(d.debts.onlineSeller),
      supplier: money(d.debts.supplier),
      trosaSinoa: money(d.debts.trosaSinoa),
      total: money(d.debts.total),
    },
    stock: {
      quantity: d.stock.quantity,
      value: money(d.stock.value),
      availableItems: d.stock.quantity,
      soldItems: d.soldItems ?? 0,
    },
    integrity: d.integrity,
    meta: { period: d.period.key, currency: 'MGA' },
  };
}

/** Unités vendues sur la période et unités disponibles en stock (§62). */
async function stockExtras(from: Date, to: Date) {
  const [lotQty, sold] = await Promise.all([
    prisma.stockLot.aggregate({
      where: { status: { not: 'CANCELLED' } },
      _sum: { remainingQty: true },
    }),
    prisma.stockMovement.aggregate({
      where: { type: 'OUT', refType: 'SALE', date: { gte: from, lt: to } },
      _sum: { delta: true },
    }),
  ]);

  return {
    availableItems: lotQty._sum.remainingQty ?? 0,
    soldItems: Math.abs(sold._sum.delta ?? 0),
  };
}

/** GET /api/dashboard?period&from&to */
dashboardRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = parseQuery(req, dashboardQuery);
    const dashboard = await getDashboard(q.period, {
      ...(q.from ? { from: q.from.toISOString() } : {}),
      ...(q.to ? { to: q.to.toISOString() } : {}),
    });

    const extras = await stockExtras(new Date(dashboard.period.from), new Date(dashboard.period.to));
    const presented = presentDashboard({ ...dashboard, soldItems: extras.soldItems });

    res.json({
      ...presented,
      stock: {
        ...presented.stock,
        availableItems: extras.availableItems,
        soldItems: extras.soldItems,
      },
    });
  }),
);

const indicatorParam = z.object({
  indicator: z
    .string()
    .min(1)
    .refine((v) => (INDICATOR_KEYS as string[]).includes(v), { message: 'Indicateur inconnu' })
    .transform((v) => v as IndicatorKey),
});

/** GET /api/dashboard/:indicator/transactions — dérillage (§62) */
dashboardRouter.get(
  '/:indicator/transactions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { indicator } = parseParams(req, indicatorParam);
    const q = parseQuery(req, dashboardQuery);
    const drill = await getIndicatorDrilldown(indicator, q.period, {
      ...(q.from ? { from: q.from.toISOString() } : {}),
      ...(q.to ? { to: q.to.toISOString() } : {}),
    });

    res.json({
      indicator: drill.indicator,
      label: drill.label,
      scope: drill.scope,
      period: drill.period,
      count: drill.count,
      total: money(drill.total),
      entries: drill.entries.map((e) => ({
        id: e.id,
        date: e.date,
        kind: e.kind,
        amount: money(e.amount),
        cashDelta: money(e.cashDelta),
        description: e.description,
        reference: e.reference,
        refType: e.refType,
        refId: e.refId,
      })),
    });
  }),
);

/** GET /api/dashboard/indicators — indicateurs disponibles */
dashboardRouter.get(
  '/indicators',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ items: INDICATOR_KEYS.map((key) => ({ key, label: INDICATORS[key].label })) });
  }),
);

/* ════════════════════ RAPPORTS ════════════════════ */

/** GET /api/reports/daily?date=AAAA-MM-JJ */
reportsRouter.get(
  '/daily',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await dailyReport(parseQuery(req, dailyReportQuery)));
  }),
);

/** GET /api/reports/monthly?year&month */
reportsRouter.get(
  '/monthly',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await monthlyReport(parseQuery(req, monthlyReportQuery)));
  }),
);

/** GET /api/reports/series?period&metric — série journalière des graphiques (§3) */
reportsRouter.get(
  '/series',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await reportSeries(parseQuery(req, seriesQuery)));
  }),
);

/** GET /api/reports/export.pdf?type=daily|monthly — `?download=json` renvoie le rapport JSON */
reportsRouter.get(
  '/export.pdf',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = parseQuery(req, exportQuery);
    const { filename, buffer, report } = await exportReportPdf(q);

    if (req.query.download === 'json') {
      res.json({ filename, report });
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).end(buffer);
  }),
);
