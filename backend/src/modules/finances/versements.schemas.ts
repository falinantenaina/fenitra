import { z } from 'zod';
import { VersementTreatment } from '@prisma/client';
import { listQuerySchema } from '../../lib/pagination';

export const createVersementSchema = z.object({
  personName: z.string().trim().min(2, 'Nom de la personne requis').max(120),
  amount: z.number().int().min(1, 'Montant invalide'),
  date: z.coerce.date().optional(),
  motif: z.string().trim().min(3, 'Motif requis').max(300),
  method: z.string().trim().max(40).nullish(),
  comment: z.string().trim().max(1000).nullish(),
  /** A2 : absent = détection automatique (dette TROSA ouverte pour cette personne). */
  treatment: z.nativeEnum(VersementTreatment).optional(),
  debtId: z.string().min(1).optional(),
});

export type CreateVersementInput = z.infer<typeof createVersementSchema>;

export const updateVersementSchema = z.object({
  motif: z.string().trim().min(3, 'Motif requis').max(300),
  method: z.string().trim().max(40).nullish(),
  comment: z.string().trim().max(1000).nullish(),
  date: z.coerce.date().optional(),
});

export type UpdateVersementInput = z.infer<typeof updateVersementSchema>;

export const periodKeySchema = z.enum([
  'today',
  'yesterday',
  'last7d',
  'week',
  'month',
  'prevMonth',
  'year',
  'custom',
]);

/** §38 — mêmes filtres de période que `GET /dashboard`, sur la liste comme sur le résumé. */
export const versementListQuery = listQuerySchema
  .extend({
    personName: z.string().trim().min(1).optional(),
    treatment: z.nativeEnum(VersementTreatment).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    period: periodKeySchema.optional(),
  })
  .refine((q) => q.period !== 'custom' || Boolean(q.from && q.to), {
    message: 'period=custom exige from et to',
    path: ['from'],
  });

export type VersementListQuery = z.infer<typeof versementListQuery>;

/** §38 : le résumé par personne accepte exactement les mêmes filtres que la liste. */
export const summaryQuery = versementListQuery;

export type SummaryQuery = VersementListQuery;

export const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Motif requis').max(500),
});
