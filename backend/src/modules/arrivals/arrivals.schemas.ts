import { z } from 'zod';
import { FundingSource } from '@prisma/client';
import { listQuerySchema } from '../../lib/pagination';

export { idParamSchema } from '../../lib/zod';

const arrivalItem = z.object({
  variantId: z.string().min(1, 'Variante requise'),
  quantity: z.number().int().min(1, 'Quantité invalide').max(10000),
  // `StockLot_unit_cost_positive` impose unitCost > 0 : on refuse au niveau du
  // schéma (400) plutôt que de laisser Prisma lever une P2010 (500).
  unitCost: z.number().int().min(1, 'Prix d\'achat invalide (doit être supérieur à 0)'),
});

const cartonSchema = z.object({
  reference: z.string().trim().min(1).max(40).optional(),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullish(),
  items: z.array(arrivalItem).min(1, 'Un carton doit contenir au moins une ligne'),
});

const paymentSchema = z.object({
  amount: z.number().int().min(1, 'Montant invalide'),
  method: z.string().trim().max(40).nullish(),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullish(),
});

const fundingSchema = z.object({
  source: z.nativeEnum(FundingSource),
  amount: z.number().int().min(1, 'Montant invalide'),
  notes: z.string().trim().max(500).nullish(),
});

export const createArrivalSchema = z.object({
  supplierId: z.string().min(1, 'Fournisseur requis'),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).nullish(),
  cartons: z.array(cartonSchema).min(1, 'Au moins un carton est requis').max(50),
  payment: paymentSchema.optional(),
  funding: fundingSchema.optional(),
});

export type CreateArrivalInput = z.infer<typeof createArrivalSchema>;

const draftCartonSchema = z.object({
  reference: z.string().trim().min(1).max(40).optional(),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullish(),
  /** Montant déclaré du carton — la ventilation par pointure vient après. */
  totalCost: z.number().int().min(1, 'Montant du carton requis'),
});

/** Brouillon à ventiler : sans pointures, sans paiement, sans financement. */
export const createArrivalDraftSchema = z.object({
  supplierId: z.string().min(1, 'Fournisseur requis'),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).nullish(),
  cartons: z.array(draftCartonSchema).min(1, 'Au moins un carton est requis').max(50),
});

export type CreateArrivalDraftInput = z.infer<typeof createArrivalDraftSchema>;

export const arrivalListQuery = listQuerySchema.extend({
  supplierId: z.string().min(1).optional(),
  status: z.enum(['DRAFT', 'RECEIVED', 'CANCELLED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ArrivalListQuery = z.infer<typeof arrivalListQuery>;

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'Motif d\'annulation requis').max(500),
});
