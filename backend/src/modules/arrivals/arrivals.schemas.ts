import { z } from 'zod';
import { FundingSource } from '@prisma/client';
import { listQuerySchema } from '../../lib/pagination';

export { idParamSchema } from '../../lib/zod';

const cartonSizeLine = z.object({
  sizeId: z.string().min(1, 'Pointure requise'),
  quantity: z.number().int().min(1, 'Quantité invalide').max(10000),
});

/**
 * Un carton (ou autre conteneur) : **un modèle**, **une quantité de paires**
 * et **un montant total** — c'est tout ce qui est obligatoire. On peut ensuite
 * lister les pointures (`sizes`) quand on les connaît ; leur somme doit être
 * exactement la quantité annoncée, sinon le carton reste « à ventiler » et se
 * ventile plus tard via `POST /arrivals/:id/ventilate`.
 *
 * Le prix d'achat unitaire n'est **jamais** saisi : il vaut
 * `floor(montant total / quantité)` — la même règle à la création et à la
 * ventilation.
 */
const cartonSchema = z
  .object({
    productId: z.string().min(1, 'Modèle requis'),
    reference: z.string().trim().min(1).max(40).optional(),
    date: z.coerce.date().optional(),
    notes: z.string().trim().max(500).nullish(),
    totalQty: z.number().int().min(1, 'Quantité invalide').max(10000),
    totalCost: z.number().int().min(1, 'Montant invalide'),
    sizes: z.array(cartonSizeLine).max(60).optional(),
  })
  .superRefine((carton, ctx) => {
    if (carton.totalCost < carton.totalQty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalCost'],
        message: 'Le montant doit couvrir au moins une paire (≥ quantité)',
      });
    }

    const sizes = carton.sizes ?? [];
    if (sizes.length === 0) return;

    const listed = sizes.reduce((sum, line) => sum + line.quantity, 0);
    const ids = sizes.map((line) => line.sizeId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sizes'],
        message: 'Une pointure est listée deux fois dans ce carton',
      });
    }
    if (listed !== carton.totalQty) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['totalQty'],
        message: `${listed} paires listées pour ${carton.totalQty} annoncées`,
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
