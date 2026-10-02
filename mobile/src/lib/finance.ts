import { z } from 'zod';

import type {
  AdjustStockBody,
  CreateCapitalBody,
  CreateExpenseBody,
  CreateTrosaBody,
  CreateVersementBody,
  DebtPaymentBody,
} from '@/lib/types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateField = z
  .string()
  .regex(DATE_RE, 'Date attendue au format AAAA-MM-JJ');

export function todayISO(now: Date = new Date()): string {
  const p = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/* ════════════ Ajustement de stock (casse / perte) ════════════ */

export const adjustFormSchema = z.object({
  variantId: z.string().min(1, 'Article requis'),
  qty: z
    .number({ invalid_type_error: 'Quantité invalide' })
    .int('Quantité entière')
    .min(1, 'Quantité minimale : 1')
    .max(10000, 'Quantité trop élevée'),
  reason: z.string().trim().min(3, 'Motif requis').max(500, 'Motif trop long'),
  date: dateField,
});

export type AdjustFormValues = z.infer<typeof adjustFormSchema>;

export function buildAdjustPayload(form: AdjustFormValues): AdjustStockBody {
  return { variantId: form.variantId, qty: form.qty, reason: form.reason, date: form.date };
}

/* ════════════ Dépense (A8 : toujours réglée) ════════════ */

export const expenseFormSchema = z.object({
  categoryId: z.string().min(1, 'Catégorie requise'),
  amount: z
    .number({ invalid_type_error: 'Montant invalide' })
    .int('Montant entier en ariary')
    .min(1, 'Montant minimal : 1 Ar'),
  date: dateField,
  description: z.string().trim().min(3, 'Description requise').max(300, 'Description trop longue'),
  method: z.string().optional(),
  notes: z.string().trim().max(1000, 'Notes trop longues').optional(),
});

export type ExpenseFormValues = z.infer<typeof expenseFormSchema>;

export function buildExpensePayload(form: ExpenseFormValues): CreateExpenseBody {
  return {
    categoryId: form.categoryId,
    amount: form.amount,
    date: form.date,
    description: form.description,
    ...(form.method ? { method: form.method } : {}),
    ...(form.notes ? { notes: form.notes } : {}),
  };
}

/* ════════════ Versement (A2 : traitement détecté côté serveur) ════════════ */

export const versementFormSchema = z.object({
  personName: z.string().trim().min(2, 'Nom requis').max(120, 'Nom trop long'),
  amount: z
    .number({ invalid_type_error: 'Montant invalide' })
    .int('Montant entier en ariary')
    .min(1, 'Montant minimal : 1 Ar'),
  date: dateField,
  motif: z.string().trim().min(3, 'Motif requis').max(300, 'Motif trop long'),
  method: z.string().optional(),
  comment: z.string().trim().max(1000, 'Commentaire trop long').optional(),
});

export type VersementFormValues = z.infer<typeof versementFormSchema>;

export function buildVersementPayload(form: VersementFormValues): CreateVersementBody {
  return {
    personName: form.personName,
    amount: form.amount,
    date: form.date,
    motif: form.motif,
    ...(form.method ? { method: form.method } : {}),
    ...(form.comment ? { comment: form.comment } : {}),
  };
}

/* ════════════ Argent propre (A5) ════════════ */

export const CAPITAL_TYPES = ['IN', 'OUT'] as const;

export const capitalFormSchema = z.object({
  type: z.enum(CAPITAL_TYPES, {
    errorMap: () => ({ message: 'Type requis : entrée ou sortie' }),
  }),
  amount: z
    .number({ invalid_type_error: 'Montant invalide' })
    .int('Montant entier en ariary')
    .min(1, 'Montant minimal : 1 Ar'),
  date: dateField,
  motif: z.string().trim().min(3, 'Motif requis').max(300, 'Motif trop long'),
  reference: z.string().trim().max(60, 'Référence trop longue').optional(),
  comment: z.string().trim().max(1000, 'Commentaire trop long').optional(),
});

export type CapitalFormValues = z.infer<typeof capitalFormSchema>;

export function buildCapitalPayload(form: CapitalFormValues): CreateCapitalBody {
  return {
    type: form.type,
    amount: form.amount,
    date: form.date,
    motif: form.motif,
    ...(form.reference ? { reference: form.reference } : {}),
    ...(form.comment ? { comment: form.comment } : {}),
  };
}

/* ════════════ Trosa sinoa (A1 : dette dont je suis redevable) ════════════ */

export const trosaFormSchema = z.object({
  partyName: z.string().trim().min(2, 'Nom requis').max(120, 'Nom trop long'),
  amount: z
    .number({ invalid_type_error: 'Montant invalide' })
    .int('Montant entier en ariary')
    .min(1, 'Montant minimal : 1 Ar'),
  date: dateField,
  reason: z.string().trim().min(3, 'Motif requis').max(300, 'Motif trop long'),
});

export type TrosaFormValues = z.infer<typeof trosaFormSchema>;

export function buildTrosaPayload(form: TrosaFormValues): CreateTrosaBody {
  return {
    type: 'TROSA_SINOA',
    partyName: form.partyName,
    amount: form.amount,
    date: form.date,
    reason: form.reason,
  };
}

/* ════════════ Règlement d'une dette ════════════ */

export const debtPaymentFormSchema = z.object({
  amount: z
    .number({ invalid_type_error: 'Montant invalide' })
    .int('Montant entier en ariary')
    .min(1, 'Montant minimal : 1 Ar'),
  method: z.string().optional(),
  notes: z.string().trim().max(500, 'Notes trop longues').optional(),
});

export type DebtPaymentFormValues = z.infer<typeof debtPaymentFormSchema>;

export function buildDebtPaymentPayload(form: DebtPaymentFormValues): DebtPaymentBody {
  return {
    amount: form.amount,
    ...(form.method ? { method: form.method } : {}),
    ...(form.notes ? { notes: form.notes } : {}),
  };
}
