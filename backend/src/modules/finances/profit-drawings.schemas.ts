import { z } from 'zod';
import { listQuerySchema } from '../../lib/pagination';
import { periodKeySchema } from './versements.schemas';

/**
 * § A5 / §45 — retrait de bénéfice : montant entier strictement positif.
 * `date`, `method` et `notes` sont facultatifs (défauts : maintenant, méthode
 * libre, sans note).
 */
export const createProfitDrawingSchema = z.object({
  amount: z.number().int().min(1, 'Montant invalide'),
  date: z.coerce.date().optional(),
  method: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export type CreateProfitDrawingInput = z.infer<typeof createProfitDrawingSchema>;

/** §38 — mêmes filtres de période que `GET /dashboard`, sur la liste comme ailleurs. */
export const profitDrawingListQuery = listQuerySchema
  .extend({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    period: periodKeySchema.optional(),
  })
  .refine((q) => q.period !== 'custom' || Boolean(q.from && q.to), {
    message: 'period=custom exige from et to',
    path: ['from'],
  });

export type ProfitDrawingListQuery = z.infer<typeof profitDrawingListQuery>;

export const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Motif requis').max(500),
});
