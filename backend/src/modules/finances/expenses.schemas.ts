import { z } from 'zod';
import { listQuerySchema } from '../../lib/pagination';

const expenseFields = {
  categoryId: z.string().min(1, 'Catégorie requise'),
  amount: z.number().int().min(1, 'Montant invalide'),
  date: z.coerce.date().optional(),
  description: z.string().trim().min(3, 'Description requise').max(300),
  method: z.string().trim().max(40).nullish(),
  reference: z.string().trim().max(60).nullish(),
  notes: z.string().trim().max(1000).nullish(),
};

/** §36 / A8 : une dépense est toujours réglée → sortie de caisse immédiate. */
export const createExpenseSchema = z.object(expenseFields);

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z.object(expenseFields);

export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const expenseListQuery = listQuerySchema.extend({
  categoryId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ExpenseListQuery = z.infer<typeof expenseListQuery>;

export const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Motif requis').max(500),
});
