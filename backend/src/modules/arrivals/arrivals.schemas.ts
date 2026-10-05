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

/**
 * Un carton = un modèle. Les pointures sont **facultatives** : on peut ne
 * connaître que la quantité et le montant (`totalQty`/`totalCost`) et ventiler
 * les pointures plus tard — sinon on fournit `items` (modèle déduit, ou
 * `productId` fourni doit correspondre).
 */
const cartonSchema = z
  .object({
    productId: z.string().min(1).optional(),
    reference: z.string().trim().min(1).max(40).optional(),
    date: z.coerce.date().optional(),
    notes: z.string().trim().max(500).nullish(),
    items: z.array(arrivalItem).max(200).optional(),
    totalQty: z.number().int().min(1, 'Quantité invalide').max(10000).optional(),
    totalCost: z.number().int().min(1, 'Montant invalide').optional(),
  })
  .superRefine((carton, ctx) => {
    const items = carton.items ?? [];
    const qty = items.reduce((sum, item) => sum + item.quantity, 0);
    const cost = items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);

    if (items.length > 0) {
      if (carton.totalQty !== undefined && carton.totalQty !== qty) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['totalQty'],
          message: `La quantité déclarée (${carton.totalQty}) ne correspond pas aux pointures saisies (${qty})`,
        });
      }
      if (carton.totalCost !== undefined && carton.totalCost !== cost) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['totalCost'],
          message: `Le montant déclaré (${carton.totalCost}) ne correspond pas aux pointures saisies (${cost})`,
        });
      }
      return;
    }

    if (carton.productId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['productId'],
        message: 'Modèle requis quand les pointures sont inconnues',
      });
    }
    if (carton.totalQty === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalQty'],
        message: 'Quantité du carton requise',
      });
    }
    if (carton.totalCost === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalCost'],
        message: 'Montant du carton requis',
      });
    } else if (carton.totalQty !== undefined && carton.totalCost < carton.totalQty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalCost'],
        message: 'Le montant doit couvrir au moins une paire (≥ quantité)',
      });
    }
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

const ventilateLine = z.object({
  sizeId: z.string().min(1, 'Pointure requise'),
  quantity: z.number().int().min(1, 'Quantité invalide').max(10000),
});

const ventilateCarton = z.object({
  cartonId: z.string().min(1, 'Carton requis'),
  lines: z.array(ventilateLine).min(1, 'Au moins une pointure est requise').max(60),
});

/**
 * `POST /arrivals/:id/ventilate` — répartition des pointures d'un carton déjà
 * enregistré. Le prix d'achat unitaire n'est **pas** envoyé : il vaut
 * `floor(montant du carton / quantité du carton)` (imposé), et la somme des
 * quantités doit être exactement celle du carton.
 */
export const ventilateSchema = z.object({
  cartons: z.array(ventilateCarton).min(1, 'Au moins un carton à ventiler').max(50),
});

export type VentilateInput = z.infer<typeof ventilateSchema>;

export const arrivalListQuery = listQuerySchema.extend({
  supplierId: z.string().min(1).optional(),
  status: z.enum(['RECEIVED', 'CANCELLED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** `true` → uniquement les arrivages ayant encore des cartons à ventiler. */
  unventilated: z.enum(['true', 'false']).optional(),
});

export type ArrivalListQuery = z.infer<typeof arrivalListQuery>;

export const cancelSchema = z.object({
  reason: z.string().trim().min(3, 'Motif d\'annulation requis').max(500),
});
