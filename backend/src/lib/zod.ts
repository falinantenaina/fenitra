import { z } from 'zod';

/** Paramètre d'URL `:id` — commune à tous les endpoints. */
export const idParamSchema = z.object({ id: z.string().min(1, 'Identifiant requis') });

export type IdParam = z.infer<typeof idParamSchema>;
