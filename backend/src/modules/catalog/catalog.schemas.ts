import { z } from 'zod';
import { listQuerySchema } from '../../lib/pagination';

export { idParamSchema } from '../../lib/zod';

/** slug : généré une seule fois à la création, jamais régénéré ensuite. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'produit';
}

export const productListQuery = listQuerySchema.extend({
  sort: z.enum(['name', '-name', 'createdAt', '-createdAt']).default('name'),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(2, 'Nom du produit requis'),
  description: z.string().trim().max(2000).nullish(),
  imageUrl: z.string().trim().max(500).nullish(),
});

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(2).optional(),
    description: z.string().trim().max(2000).nullish(),
    imageUrl: z.string().trim().max(500).nullish(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ à mettre à jour' });

export const sizeListQuery = listQuerySchema;

export const createSizeSchema = z.object({
  value: z.number().int().min(1, 'Pointure invalide').max(100, 'Pointure invalide'),
  label: z.string().trim().max(40).nullish(),
  order: z.number().int().min(0).optional(),
});

export const updateSizeSchema = z
  .object({
    label: z.string().trim().max(40).nullish(),
    order: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ à mettre à jour' });

export const variantListQuery = listQuerySchema.extend({
  productId: z.string().min(1).optional(),
  sizeId: z.string().min(1).optional(),
  sort: z.enum(['createdAt', '-createdAt', 'sku', '-sku']).default('-createdAt'),
});

export const createVariantSchema = z.object({
  productId: z.string().min(1, 'Produit requis'),
  sizeId: z.string().min(1, 'Pointure requise'),
  sku: z.string().trim().max(64).nullish(),
  sellingPrice: z.number().int().min(0).default(0),
});

export const updateVariantSchema = z
  .object({
    sku: z.string().trim().max(64).nullish(),
    sellingPrice: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ à mettre à jour' });

export const priceSchema = z.object({
  sellingPrice: z.number().int().min(0, 'Prix de vente invalide'),
});
