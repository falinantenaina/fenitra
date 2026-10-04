import { z } from 'zod';

import type { CreateArrivalBody, CreateArrivalDraftBody } from '@/lib/types';

const maxMoney = 10_000_000_000;
const nonNegativeInt = z.number().int().min(0).max(maxMoney);

/** Une cellule de la grille : quantité + prix d'achat d'une pointure. */
export const gridCellSchema = z.object({
  quantity: z.number().int().min(0).max(10000),
  unitCost: nonNegativeInt,
});
export type GridCell = z.infer<typeof gridCellSchema>;

/** Brouillon d'un carton — `items` est un record variantId pour un accès O(1) à la grille. */
export const cartonDraftSchema = z.object({
  reference: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
  activeProductId: z.string(),
  usedProductIds: z.array(z.string()),
  items: z.record(z.string(), gridCellSchema),
  /** Mode brouillon : montant déclaré du carton, sans ventilation par pointure. */
  amount: nonNegativeInt,
});
export type CartonDraft = z.infer<typeof cartonDraftSchema>;

const fundingSourceSchema = z.enum([
  'OWN_CAPITAL',
  'TROSA_SINOA',
  'SALES_CASH',
  'SUPPLIER_CREDIT',
]);

export const arrivalFormSchema = z
  .object({
    supplierId: z.string().min(1, 'Fournisseur requis'),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ'),
    notes: z.string().trim().max(1000).optional(),
    cartons: z.array(cartonDraftSchema).min(1, 'Au moins un carton est requis'),
    /** Brouillon : montant par carton, grille et financement masqués. */
    draft: z.boolean(),
    payment: z.object({
      enabled: z.boolean(),
      amount: nonNegativeInt,
      method: z.string().trim().max(40).optional(),
    }),
    funding: z.object({
      enabled: z.boolean(),
      source: fundingSourceSchema,
      amount: nonNegativeInt,
      notes: z.string().trim().max(500).optional(),
    }),
  })
  .superRefine((form, ctx) => {
    // Brouillon à ventiler : uniquement le montant déclaré par carton — pas de
    // pointures, pas de paiement, pas de financement (aucun impact comptable).
    if (form.draft) {
      form.cartons.forEach((carton, index) => {
        if (!(carton.amount >= 1)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['cartons', index, 'amount'],
            message: `Carton ${index + 1} : montant déclaré requis.`,
          });
        }
      });
      return;
    }

    let total = 0;

    form.cartons.forEach((carton, index) => {
      if (!carton.activeProductId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cartons', index, 'activeProductId'],
          message: `Carton ${index + 1} : choisissez un modèle.`,
        });
        return;
      }
      const lines = Object.values(carton.items).filter((cell) => cell.quantity > 0);
      if (lines.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cartons', index, 'items'],
          message: `Le carton ${index + 1} est vide : saisissez au moins une quantité.`,
        });
        return;
      }
      const missingPrice = lines.filter((cell) => cell.unitCost <= 0);
      if (missingPrice.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cartons', index, 'items'],
          message: `Carton ${index + 1} : prix d'achat manquant sur ${missingPrice.length} pointure(s).`,
        });
        return;
      }
      total += lines.reduce((sum, cell) => sum + cell.quantity * cell.unitCost, 0);
    });

    if (form.payment.enabled && form.payment.amount < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment', 'amount'],
        message: 'Montant du paiement requis.',
      });
    } else if (form.payment.enabled && form.payment.amount > total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment', 'amount'],
        message: `Le paiement dépasse le total de l'arrivage (${total} Ar).`,
      });
    }

    if (form.funding.enabled && form.funding.amount < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['funding', 'amount'],
        message: 'Montant du financement requis.',
      });
    }
  });

export type ArrivalFormValues = z.infer<typeof arrivalFormSchema>;

/** Date locale `AAAA-MM-JJ` (le serveur convertit via la timezone d'activité). */
export function todayISO(now: Date = new Date()): string {
  const p = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function emptyCell(): GridCell {
  return { quantity: 0, unitCost: 0 };
}

export function cartonTotals(carton: CartonDraft): { quantity: number; cost: number } {
  return Object.values(carton.items).reduce(
    (acc, cell) => ({
      quantity: acc.quantity + (cell.quantity > 0 ? cell.quantity : 0),
      cost: acc.cost + (cell.quantity > 0 ? cell.quantity * cell.unitCost : 0),
    }),
    { quantity: 0, cost: 0 },
  );
}

export function formTotals(form: ArrivalFormValues): { quantity: number; cost: number } {
  // Mode brouillon : le total est la somme des montants déclarés.
  if (form.draft) {
    return form.cartons.reduce(
      (acc, carton) => ({ quantity: 0, cost: acc.cost + (carton.amount || 0) }),
      { quantity: 0, cost: 0 },
    );
  }
  return form.cartons.reduce(
    (acc, carton) => {
      const t = cartonTotals(carton);
      return { quantity: acc.quantity + t.quantity, cost: acc.cost + t.cost };
    },
    { quantity: 0, cost: 0 },
  );
}

/** Transforme les brouillons (records) en corps `POST /arrivals`. */
export function buildArrivalPayload(form: ArrivalFormValues): CreateArrivalBody {
  const cartons = form.cartons.map((carton, index) => {
    const items = Object.entries(carton.items)
      .filter(([, cell]) => cell.quantity > 0)
      .map(([variantId, cell]) => ({
        variantId,
        quantity: cell.quantity,
        unitCost: cell.unitCost,
      }));

    return {
      reference: carton.reference?.trim() || `Carton ${index + 1}`,
      items,
      ...(carton.notes?.trim() ? { notes: carton.notes.trim() } : {}),
    };
  });

  return {
    supplierId: form.supplierId,
    date: form.date,
    ...(form.notes?.trim() ? { notes: form.notes.trim() } : {}),
    cartons,
    ...(form.payment.enabled
      ? {
          payment: {
            amount: form.payment.amount,
            ...(form.payment.method?.trim() ? { method: form.payment.method.trim() } : {}),
          },
        }
      : {}),
    ...(form.funding.enabled
      ? {
          funding: {
            source: form.funding.source,
            amount: form.funding.amount,
            ...(form.funding.notes?.trim() ? { notes: form.funding.notes.trim() } : {}),
          },
        }
      : {}),
  };
}

/** Transforme les brouillons (records) en corps `POST /arrivals/drafts`. */
export function buildDraftPayload(form: ArrivalFormValues): CreateArrivalDraftBody {
  return {
    supplierId: form.supplierId,
    date: form.date,
    ...(form.notes?.trim() ? { notes: form.notes.trim() } : {}),
    cartons: form.cartons.map((carton, index) => ({
      reference: carton.reference?.trim() || `Carton ${index + 1}`,
      totalCost: carton.amount,
      ...(carton.notes?.trim() ? { notes: carton.notes.trim() } : {}),
    })),
  };
}
