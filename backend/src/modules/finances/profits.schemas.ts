import { z } from 'zod';

/**
 * A16 — bénéfice hors stock : on n'enregistre que le montant gagné et une
 * description facultative — ni article, ni prix de vente, ni encaissement.
 */
export const createGainSchema = z.object({
  amount: z.number().int().min(1, 'Montant invalide'),
  description: z.string().trim().min(3, 'Description trop courte').max(300).nullish(),
});

export type CreateGainInput = z.infer<typeof createGainSchema>;
