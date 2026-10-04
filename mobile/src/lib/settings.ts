import { z } from 'zod';

import type {
  CreateCategoryBody,
  CreateMethodBody,
  CreatePartyBody,
  CreateProductBody,
  CreateSizeBody,
  CreateUserBody,
  SettingsMap,
  UpdateCategoryBody,
  UpdatePartyBody,
  UpdateProductBody,
} from '@/lib/types';

/* ════════════ Schémas de saisie (Zod + `zodResolver`) ════════════ */

export const productFormSchema = z.object({
  name: z.string().trim().min(2, 'Nom requis').max(120),
  description: z.string().trim().max(2000).optional(),
});
export type ProductFormValues = z.infer<typeof productFormSchema>;

export const sizeFormSchema = z.object({
  value: z
    .number({ invalid_type_error: 'Pointure invalide' })
    .int('Pointure invalide')
    .min(1, 'Pointure invalide')
    .max(100, 'Pointure invalide'),
  label: z.string().trim().max(40).optional(),
});
export type SizeFormValues = z.infer<typeof sizeFormSchema>;

export const partyFormSchema = z.object({
  name: z.string().trim().min(2, 'Nom requis').max(120),
  phone: z.string().trim().max(40).optional(),
  address: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type PartyFormValues = z.infer<typeof partyFormSchema>;

export const categoryFormSchema = z.object({
  name: z.string().trim().min(2, 'Nom requis').max(80),
});
export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

export const methodFormSchema = z.object({
  name: z.string().trim().min(2, 'Nom requis').max(40),
});
export type MethodFormValues = z.infer<typeof methodFormSchema>;

export const userFormSchema = z.object({
  name: z.string().trim().min(2, 'Nom requis').max(120),
  email: z.string().trim().toLowerCase().email('Email invalide'),
  password: z.string().min(8, '8 caractères minimum'),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER'], {
    errorMap: () => ({ message: 'Rôle requis' }),
  }),
});
export type UserFormValues = z.infer<typeof userFormSchema>;

export const userEditFormSchema = z.object({
  name: z.string().trim().min(2, 'Nom requis').max(120),
});
export type UserEditFormValues = z.infer<typeof userEditFormSchema>;

export const passwordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
    newPassword: z.string().min(8, '8 caractères minimum'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: 'Les deux mots de passe diffèrent',
  });
export type PasswordFormValues = z.infer<typeof passwordFormSchema>;

export const resetPasswordFormSchema = z.object({
  newPassword: z.string().min(8, '8 caractères minimum'),
});
export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;

export const settingFormSchema = z.object({
  key: z.string().trim().min(1, 'Clé requise').max(64),
  value: z.string().max(4000, 'Valeur trop longue'),
});
export type SettingFormValues = z.infer<typeof settingFormSchema>;

/* ════════════ Builders — on n'envoie que les champs renseignés ════════════ */

const text = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

export const buildProductPayload = (v: ProductFormValues): CreateProductBody => ({
  name: v.name.trim(),
  ...(text(v.description) ? { description: text(v.description) } : {}),
});

export const buildProductUpdatePayload = (
  v: ProductFormValues,
  active?: boolean,
): UpdateProductBody => ({
  name: v.name.trim(),
  description: v.description?.trim() || null,
  ...(active === undefined ? {} : { active }),
});

export const buildSizePayload = (v: SizeFormValues): CreateSizeBody => ({
  value: v.value,
  ...(text(v.label) ? { label: text(v.label) } : {}),
});

export const buildPartyPayload = (v: PartyFormValues): CreatePartyBody => ({
  name: v.name.trim(),
  ...(text(v.phone) ? { phone: text(v.phone) } : {}),
  ...(text(v.address) ? { address: text(v.address) } : {}),
  ...(text(v.notes) ? { notes: text(v.notes) } : {}),
});

export const buildPartyUpdatePayload = (
  v: PartyFormValues,
  active?: boolean,
): UpdatePartyBody => ({
  name: v.name.trim(),
  phone: v.phone?.trim() || null,
  address: v.address?.trim() || null,
  notes: v.notes?.trim() || null,
  ...(active === undefined ? {} : { active }),
});

export const buildCategoryPayload = (v: CategoryFormValues): CreateCategoryBody => ({
  name: v.name.trim(),
});

export const buildCategoryUpdatePayload = (v: CategoryFormValues): UpdateCategoryBody => ({
  name: v.name.trim(),
});

export const buildMethodPayload = (v: MethodFormValues): CreateMethodBody => ({
  name: v.name.trim(),
});

export const buildUserPayload = (v: UserFormValues): CreateUserBody => ({
  email: v.email.trim().toLowerCase(),
  name: v.name.trim(),
  password: v.password,
  role: v.role,
});

/** `PUT /settings` — fusion : seules les paires saisies sont envoyées. */
export const buildSettingsPayload = (v: SettingFormValues): SettingsMap => ({
  [v.key.trim()]: v.value,
});
