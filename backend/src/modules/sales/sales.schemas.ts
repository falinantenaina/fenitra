import { z } from 'zod';
import { SaleStatus } from '@prisma/client';
import { listQuerySchema } from '../../lib/pagination';

export const idParamSchema = z.object({ id: z.string().min(1, 'Identifiant requis')});

/** A10 — le prix est libre **par ligne de vente** (remise, promotion, prix négocié). */
const saleItemSchema = z.object({
  variantId: z.string().min(1, 'Article requis'),
  quantity: z.number().int().min(1, 'Quantité invalide').max(1000),
  unitPrice: z.number().int().min(0, 'Prix de vente invalide'),
});

const paymentInput = z.object({
  amount: z.number().int().min(1, 'Montant invalide'),
  method: z.string().trim().max(40).nullish(),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullish(),
});

export const createSaleSchema = z
  .object({
    customerId: z.string().min(1).nullish(),
    onlineSellerId: z.string().min(1).nullish(),
    date: z.coerce.date().optional(),
    notes: z.string().trim().max(1000).nullish(),
    paymentMethod: z.string().trim().max(40).nullish(),
    items: z.array(saleItemSchema).min(1, 'Au moins un article').max(100),
    payment: paymentInput.optional(),
  })
  .refine((v) => !(v.customerId && v.onlineSellerId), {
    message: 'Client et vendeur en ligne sont mutuellement exclusifs',
    path: ['customerId'],
  });

export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const saleListQuery = listQuerySchema.extend({
  customerId: z.string().min(1).optional(),
  onlineSellerId: z.string().min(1).optional(),
  status: z.nativeEnum(SaleStatus).optional(),
  variantId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type SaleListQuery = z.infer<typeof saleListQuery>;

export const salePaymentSchema = z.object({
  amount: z.number().int().min(1, 'Montant invalide'),
  method: z.string().trim().max(40).nullish(),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullish(),
});

export const cancelSaleSchema = z.object({
  reason: z.string().trim().min(3, 'Motif d\'annulation requis').max(500),
});
