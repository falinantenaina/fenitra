import { z } from 'zod';

/**
 * Pagination commune : `page` (1-indexé) / `limit`, recherche `q`,
 * filtre booléen `active`. Les listes répondent toujours avec
 * `{ items, ...pageMeta }`.
 */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().min(1).max(200).optional(),
  active: z.enum(['true', 'false']).optional(),
});

export type ListQuery = z.infer<typeof listQuerySchema>;

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const pageMeta = (total: number, page: number, limit: number): PageMeta => ({
  total,
  page,
  limit,
  totalPages: Math.max(1, Math.ceil(total / limit)),
});

/** `"true"` / `"false"` → boolean | undefined (filtre Prisma). */
export const boolFilter = (v: string | undefined): boolean | undefined =>
  v === undefined ? undefined : v === 'true';

export const offset = (q: ListQuery): number => (q.page - 1) * q.limit;

/** Filtre de recherche insensible à la casse (PostgreSQL). */
export const ilike = (q: string | undefined): { contains: string; mode: 'insensitive' } | undefined =>
  q ? { contains: q, mode: 'insensitive' } : undefined;
