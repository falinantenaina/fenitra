import { z } from 'zod';

import type { CreateSaleBody } from '@/lib/types';

const maxMoney = 10_000_000_000;

/** Une ligne de panier : identité (variante + libellés d'affichage) et montants. */
export const saleLineSchema = z.object({
  variantId: z.string().min(1),
  productName: z.string().min(1),
  sizeLabel: z.string(),
  quantity: z.number().int().min(1).max(1000),
  unitPrice: z.number().int().min(0).max(maxMoney),
});
export type SaleLine = z.infer<typeof saleLineSchema>;

/** A10 — le prix est libre par ligne (remise, prix négocié). */
export const paymentModeSchema = z.enum(['FULL', 'PARTIAL', 'CREDIT']);
export type PaymentMode = z.infer<typeof paymentModeSchema>;
export const PAYMENT_MODES = paymentModeSchema.options;

export const saleFormSchema = z
  .object({
    items: z.array(saleLineSchema).min(1, 'Ajoutez au moins un article au panier'),
    /** `''` = vente au comptoir, sans client rattaché. */
    customerId: z.string(),
    /** `''` = pas de vendeur en ligne (mutuellement exclusif avec le client). */
    onlineSellerId: z.string(),
    paymentMode: paymentModeSchema,
    /** Utilisé en mode PARTIAL uniquement. */
    paymentAmount: z.number().int().min(0).max(maxMoney),
    paymentMethod: z.string().trim().max(40).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .superRefine((form, ctx) => {
    const total = saleTotal(form.items);

    if (total < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: 'Le total de la vente doit être strictement positif (une ligne peut être offerte)',
      });
    }

    if (form.customerId && form.onlineSellerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['onlineSellerId'],
        message: 'Client et vendeur en ligne sont mutuellement exclusifs',
      });
    }

    if (form.paymentMode === 'PARTIAL') {
      if (form.paymentAmount < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentAmount'],
          message: 'Montant du règlement requis.',
        });
      } else if (form.paymentAmount > total) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['paymentAmount'],
          message: `Le règlement dépasse le total (${total} Ar).`,
        });
      }
    }

    // Miroir de la règle serveur (sales.service.ts) : une créance sans tiers
    // serait comptée sans rattachement — on bloque avant l'envoi.
    const paid =
      form.paymentMode === 'FULL'
        ? total
        : form.paymentMode === 'PARTIAL'
          ? Math.min(form.paymentAmount, total)
          : 0;

    if (total - paid > 0 && !form.customerId && !form.onlineSellerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customerId'],
        message:
          'Une vente à crédit doit être rattachée à un client ou à un vendeur en ligne',
      });
    }
  });

export type SaleFormValues = z.infer<typeof saleFormSchema>;

export function saleTotal(items: SaleLine[]): number {
  return items.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
}

export function saleQuantity(items: SaleLine[]): number {
  return items.reduce((sum, line) => sum + line.quantity, 0);
}

/** Transforme le formulaire en corps `POST /sales`. */
export function buildSalePayload(form: SaleFormValues): CreateSaleBody {
  const total = saleTotal(form.items);

  return {
    items: form.items.map((line) => ({
      variantId: line.variantId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
    ...(form.customerId ? { customerId: form.customerId } : {}),
    ...(form.onlineSellerId ? { onlineSellerId: form.onlineSellerId } : {}),
    ...(form.notes?.trim() ? { notes: form.notes.trim() } : {}),
    // Crédit : aucun objet `payment` → la vente crée une dette client.
    ...(form.paymentMode === 'CREDIT'
      ? {}
      : {
          payment: {
            amount: form.paymentMode === 'FULL' ? total : form.paymentAmount,
            ...(form.paymentMethod?.trim() ? { method: form.paymentMethod.trim() } : {}),
          },
        }),
  };
}
