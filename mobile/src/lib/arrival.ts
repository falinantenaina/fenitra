import { z } from 'zod';

import type { ArrivalDetail, CreateArrivalBody, UpdateArrivalBody } from '@/lib/types';

const maxMoney = 10_000_000_000;
const nonNegativeInt = z.number().int().min(0).max(maxMoney);

/**
 * Saisie d'un carton : **un modèle**, **une quantité de paires** et **un
 * montant total** — puis, quand on les connaît, la liste des pointures
 * (`sizes` : sizeId → quantité). Le prix d'achat unitaire n'est jamais saisi :
 * il vaut `montant ÷ quantité` (arrondi inférieur), côté client comme côté
 * serveur. Sans pointures, le carton part « à ventiler » et se ventile depuis
 * le détail de l'arrivage.
 */
export const cartonDraftSchema = z.object({
  /** Carton déjà enregistré (mode édition) — absent = carton à créer. */
  id: z.string().min(1).optional(),
  reference: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
  activeProductId: z.string(),
  /** Paires annoncées pour ce carton. */
  quantity: nonNegativeInt,
  /** Montant total du carton (Ar) — le prix unitaire en dérive. */
  amount: nonNegativeInt,
  sellingPrice: nonNegativeInt.optional(),
  /** Pointures listées, quantité 0 = ligne ignorée. */
  sizes: z.record(z.string(), nonNegativeInt),
});
export type CartonDraft = z.infer<typeof cartonDraftSchema>;

/** Pointures réellement listées (quantité > 0), dans l'ordre de saisie. */
export function listedSizes(carton: CartonDraft): { sizeId: string; quantity: number }[] {
  return Object.entries(carton.sizes ?? {})
    .filter(([, quantity]) => quantity > 0)
    .map(([sizeId, quantity]) => ({ sizeId, quantity }));
}

export function listedQuantity(carton: CartonDraft): number {
  return listedSizes(carton).reduce((sum, line) => sum + line.quantity, 0);
}

export const arrivalFormSchema = z
  .object({
    supplierId: z.string().min(1, 'Fournisseur requis'),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ'),
    notes: z.string().trim().max(1000).optional(),
    cartons: z.array(cartonDraftSchema).min(1, 'Au moins un carton est requis'),
    // Ce qui est réglé sort de la caisse ; le reste devient une dette fournisseur.
    // Aucune source de financement à choisir (aucun emprunt, aucun crédit fournisseur).
    payment: z.object({
      enabled: z.boolean(),
      amount: nonNegativeInt,
      method: z.string().trim().max(40).optional(),
    }),
  })
  .superRefine((form, ctx) => {
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

      if (!(carton.quantity >= 1)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cartons', index, 'quantity'],
          message: `Carton ${index + 1} : quantité requise (paires reçues).`,
        });
        return;
      }
      if (!(carton.amount >= carton.quantity)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cartons', index, 'amount'],
          message: `Carton ${index + 1} : le montant doit couvrir au moins une paire (≥ quantité).`,
        });
        return;
      }

      // Pointures listées : leur somme doit être exactement celle du carton
      // (la même règle que `POST /arrivals` côté serveur).
      const listed = listedQuantity(carton);
      if (listed > 0 && listed !== carton.quantity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['cartons', index, 'sizes'],
          message: `Carton ${index + 1} : ${listed} paires listées pour ${carton.quantity} annoncées.`,
        });
        return;
      }

      total += carton.amount;
    });

    // 0 autorisé : rien de réglé → la totalité reste due au fournisseur.
    if (form.payment.enabled && form.payment.amount > total) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment', 'amount'],
        message: `Le paiement dépasse le total de l'arrivage (${total} Ar).`,
      });
    }
  });

export type ArrivalFormValues = z.infer<typeof arrivalFormSchema>;

/** Date locale `AAAA-MM-JJ` (le serveur convertit via la timezone d'activité). */
export function todayISO(now: Date = new Date()): string {
  const p = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Prix d'achat unitaire déduit du carton — jamais saisi. */
export function unitCostOf(carton: Pick<CartonDraft, 'quantity' | 'amount'>): number {
  return carton.quantity > 0 ? Math.floor(carton.amount / carton.quantity) : 0;
}

export function cartonTotals(carton: CartonDraft): { quantity: number; cost: number } {
  return { quantity: carton.quantity, cost: carton.amount };
}

export function formTotals(form: ArrivalFormValues): { quantity: number; cost: number } {
  return form.cartons.reduce(
    (acc, carton) => {
      const t = cartonTotals(carton);
      return { quantity: acc.quantity + t.quantity, cost: acc.cost + t.cost };
    },
    { quantity: 0, cost: 0 },
  );
}

/** Cartons dont les pointures ne sont pas encore listées (à ventiler après). */
export function cartonsToVentilate(form: ArrivalFormValues): number {
  return form.cartons.filter((carton) => listedSizes(carton).length === 0).length;
}

/**
 * Un brouillon n'est proposé à la reprise que s'il contient du travail réel :
 * fournisseur et modèle pré-remplis seuls ne justifient pas une relance.
 */
export function draftHasContent(form: ArrivalFormValues): boolean {
  if (form.notes?.trim()) return true;
  if (form.cartons.length > 1) return true;
  return form.cartons.some(
    (carton) => carton.quantity > 0 || carton.amount > 0 || listedQuantity(carton) > 0,
  );
}

/**
 * Transforme les brouillons en corps `POST /arrivals` : modèle, quantité et
 * montant pour chaque carton, pointures quand elles sont listées — le serveur
 * déduit le prix unitaire et crée les lots correspondants.
 */
function payloadCarton(carton: CartonDraft, index: number) {
  const reference = carton.reference?.trim() || `Carton ${index + 1}`;
  const notes = carton.notes?.trim() ? { notes: carton.notes.trim() } : {};
  const sizes = listedSizes(carton);

  return {
    reference,
    productId: carton.activeProductId,
    totalQty: carton.quantity,
    totalCost: carton.amount,
    ...(carton.sellingPrice ? { sellingPrice: carton.sellingPrice } : {}),
    ...(sizes.length > 0 ? { sizes } : {}),
    ...notes,
  };
}

// Rien de réglé (0 ou case décochée) : aucun paiement envoyé — la totalité
// devient une dette fournisseur côté serveur. Pas de bloc financement : ce qui
// est réglé sort de la caisse, le reste est dû au fournisseur.
function payloadSettlement(form: ArrivalFormValues) {
  const paid = form.payment.enabled ? form.payment.amount : 0;

  return paid > 0
    ? {
        payment: {
          amount: paid,
          ...(form.payment.method?.trim() ? { method: form.payment.method.trim() } : {}),
        },
      }
    : {};
}

export function buildArrivalPayload(form: ArrivalFormValues): CreateArrivalBody {
  return {
    supplierId: form.supplierId,
    date: form.date,
    ...(form.notes?.trim() ? { notes: form.notes.trim() } : {}),
    cartons: form.cartons.map((carton, index) => payloadCarton(carton, index)),
    ...payloadSettlement(form),
  };
}

/**
 * Corps `PATCH /arrivals/:id` — même saisie que la création, chaque carton
 * portant son `id` quand il existe déjà (le serveur remplace la liste en
 * entier : conservé, ajouté ou supprimé).
 */
export function buildUpdateArrivalPayload(form: ArrivalFormValues): UpdateArrivalBody {
  return {
    ...buildArrivalPayload(form),
    cartons: form.cartons.map((carton, index) => ({
      ...(carton.id ? { id: carton.id } : {}),
      ...payloadCarton(carton, index),
    })),
  };
}

/**
 * Détail d'un arrivage → valeurs du formulaire (mode édition) : fournisseur,
 * date, notes, cartons avec leurs pointures déjà réparties et le réglé actuel.
 */
export function arrivalToForm(detail: ArrivalDetail): ArrivalFormValues {
  const paid = Number(detail.paidAmount) || 0;

  return {
    supplierId: detail.supplier.id,
    date: detail.date.slice(0, 10),
    notes: detail.notes ?? '',
    cartons: detail.cartons.map((carton) => ({
      id: carton.id,
      reference: carton.reference,
      notes: carton.notes ?? undefined,
      activeProductId: carton.productId,
      quantity: carton.totalQty,
      amount: Number(carton.totalCost) || 0,
      ...(carton.sellingPrice && Number(carton.sellingPrice) > 0
        ? { sellingPrice: Number(carton.sellingPrice) }
        : {}),
      sizes: Object.fromEntries(
        carton.items
          .filter((item) => item.quantity > 0)
          .map((item) => [item.size.id, item.quantity]),
      ),
    })),
    payment: {
      enabled: paid > 0,
      amount: paid,
      method: detail.payments[0]?.method ?? undefined,
    },
  };
}
