import { z } from 'zod';
import { DebtType, LedgerKind, PaymentPartyType } from '@prisma/client';
import { listQuerySchema } from '../../lib/pagination';

export const idParamSchema = z.object({ id: z.string().min(1, 'Identifiant requis')});

export const createDebtSchema = z.object({
  type: z.nativeEnum(DebtType),
  partyName: z.string().trim().min(2, 'Nom de la personne requis').max(120).optional(),
  customerId: z.string().min(1).optional(),
  onlineSellerId: z.string().min(1).optional(),
  supplierId: z.string().min(1).optional(),
  reason: z.string().trim().min(3, 'Motif trop court').max(300).optional(),
  amount: z.number().int().min(1, 'Montant invalide'),
  paidAmount: z.number().int().min(0).default(0),
  date: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullish(),
  method: z.string().trim().max(40).nullish(),
});

export type CreateDebtInput = z.infer<typeof createDebtSchema>;

export const debtListQuery = listQuerySchema.extend({
  type: z.nativeEnum(DebtType).optional(),
  status: z.enum(['OPEN', 'PARTIAL', 'PAID', 'CANCELLED']).optional(),
  partyId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type DebtListQuery = z.infer<typeof debtListQuery>;

export const debtPaymentSchema = z.object({
  amount: z.number().int().min(1, 'Montant invalide'),
  method: z.string().trim().max(40).nullish(),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullish(),
});

export type DebtPaymentInput = z.infer<typeof debtPaymentSchema>;

export const cancelDebtSchema = z.object({
  reason: z.string().trim().min(3, 'Motif d\'annulation requis').max(500),
});

export const paymentListQuery = listQuerySchema.extend({
  direction: z.enum(['IN', 'OUT']).optional(),
  partyType: z.nativeEnum(PaymentPartyType).optional(),
  debtId: z.string().min(1).optional(),
  saleId: z.string().min(1).optional(),
  arrivalId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type PaymentListQuery = z.infer<typeof paymentListQuery>;

export const createPaymentSchema = z.object({
  debtId: z.string().min(1, 'Dette requise'),
  amount: z.number().int().min(1, 'Montant invalide'),
  method: z.string().trim().max(40).nullish(),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(500).nullish(),
});

/** Type de dette → type de tiers / type de paiement / type d'écriture. */
export const PARTY_TYPE: Record<DebtType, PaymentPartyType> = {
  CUSTOMER: 'CUSTOMER',
  ONLINE_SELLER: 'ONLINE_SELLER',
  SUPPLIER: 'SUPPLIER',
  TROSA_SINOA: 'TROSA_SINOA',
};

export const PAYMENT_KIND: Record<DebtType, LedgerKind> = {
  CUSTOMER: 'CUSTOMER_PAYMENT',
  ONLINE_SELLER: 'ONLINE_SELLER_PAYMENT',
  SUPPLIER: 'SUPPLIER_PAYMENT',
  TROSA_SINOA: 'TROSA_REPAY',
};
