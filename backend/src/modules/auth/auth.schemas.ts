import { z } from 'zod';
import { RoleName } from '@prisma/client';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Jeton de rafraîchissement requis'),
});

export const passwordSchema = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères')
  .max(128);

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
  newPassword: passwordSchema,
});

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email invalide'),
  name: z.string().trim().min(2, 'Nom requis'),
  password: passwordSchema,
  role: z.nativeEnum(RoleName),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).optional(),
  role: z.nativeEnum(RoleName).optional(),
  active: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export const idParamSchema = z.object({ id: z.string().min(1) });
