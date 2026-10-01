import { z } from 'zod';
import { FundingSource } from '@prisma/client';

/** Peek/next des références automatiques (`ARR-0001`, `LOT-0001`, …). */
const PREFIX: Record<string, string> = {
  arrival: 'ARR',
  lot: 'LOT',
  sale: 'VTE',
  payment: 'PAY',
  carton: 'CART',
  expense: 'DEP',
};

type Db = { $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T> };

/** Incrémente le compteur de façon atomique et renvoie la valeur fraîche. */
export async function nextSequence(db: Db, key: string): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "Sequence" ("key", "value")
    VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Sequence"."value" + 1
    RETURNING "value"`;
  return rows[0]?.value ?? 1;
}

/** Référence à usage unique, ex. `ARR-0007`. */
export async function nextReference(db: Db, key: string): Promise<string> {
  const value = await nextSequence(db, key);
  return formatReference(key, value);
}

/** Référence SUIVANTE sans consommer le compteur (prévisualisation). */
export async function peekReference(db: Db, key: string): Promise<string> {
  const rows = await db.$queryRaw<{ value: number | null }[]>`
    SELECT "value" FROM "Sequence" WHERE "key" = ${key}`;
  return formatReference(key, (rows[0]?.value ?? 0) + 1);
}

export function formatReference(key: string, value: number): string {
  const prefix = PREFIX[key] ?? key.toUpperCase().slice(0, 3);
  return `${prefix}-${String(value).padStart(4, '0')}`;
}
