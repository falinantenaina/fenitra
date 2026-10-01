import { z } from 'zod';
import { CapitalMovementType } from '@prisma/client';
import { listQuerySchema } from '../../lib/pagination';

const capitalFields = {
  amount: z.number().int().min(1, 'Montant invalide'),
  date: z.coerce.date().optional(),
  motif: z.string().trim().min(3, 'Motif requis').max(300),
  destinationType: z.string().trim().max(40).nullish(),
  destinationId: z.string().trim().max(60).nullish(),
  reference: z.string().trim().max(60).nullish(),
  comment: z.string().trim().max(1000).nullish(),
};

/** §33-§34 : IN = injection (K augmente), OUT = récupération de capital (K diminue). */
export const createCapitalSchema = z.object({
  type: z.nativeEnum(CapitalMovementType),
  ...capitalFields,
});

export type CreateCapitalInput = z.infer<typeof createCapitalSchema>;

export const updateCapitalSchema = z.object(capitalFields);

export type UpdateCapitalInput = z.infer<typeof updateCapitalSchema>;

export const capitalListQuery = listQuerySchema.extend({
  type: z.nativeEnum(CapitalMovementType).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CapitalListQuery = z.infer<typeof capitalListQuery>;

export const reasonSchema = z.object({
  reason: z.string().trim().min(3, 'Motif requis').max(500),
});
