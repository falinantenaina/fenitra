import { z } from 'zod';
import { LedgerKind } from '@prisma/client';
import { listQuerySchema } from '../../lib/pagination';
import { PERIOD_KEYS, type PeriodKey } from '../../services/period.service';

export const periodKeys = PERIOD_KEYS as unknown as [PeriodKey, ...PeriodKey[]];

export const dashboardQuery = z.object({
  period: z.enum(periodKeys).default('today'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const ledgerQuery = listQuerySchema.extend({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  kind: z.nativeEnum(LedgerKind).optional(),
  refType: z.string().trim().max(30).optional(),
  /** `true` = n'afficher que les écritures qui bougent la caisse. */
  cash: z.enum(['true', 'false']).optional(),
});

export type LedgerQuery = z.infer<typeof ledgerQuery>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const dailyReportQuery = z.object({
  date: z.string().regex(ISO_DAY, 'Date attendue au format AAAA-MM-JJ').optional(),
});

export type DailyReportQuery = z.infer<typeof dailyReportQuery>;

export const monthlyReportQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export type MonthlyReportQuery = z.infer<typeof monthlyReportQuery>;

export const exportQuery = z
  .object({
    type: z.enum(['daily', 'monthly']),
    date: z.string().regex(ISO_DAY).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  })
  .refine((v) => (v.type === 'daily' ? true : v.year !== undefined), {
    message: 'year est requis pour un rapport mensuel',
    path: ['year'],
  });
