import { execSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Exécuté une seule fois avant toute la suite de tests.
 * Recrée la base de tests à partir des migrations (reset complet).
 *
 * Le seed (`prisma/seed.ts`) ne crée que les rôles et le compte de connexion :
 * la suite s'assure elle-même que ses référentiels (pointures, catégories de
 * dépenses, modes de paiement) existent — voir `prisma/reference.ts`.
 */
export default async function globalSetup(): Promise<void> {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });

  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL manquant');

  if (process.env.SKIP_DB_RESET !== '1') {
    // Reset complet + seed minimal (rôles + admin) via prisma.config.ts
    execSync('npx prisma migrate reset --force --skip-generate', {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
      stdio: 'inherit',
    });
  }

  await ensureReference(databaseUrl);
}

/** Pointures, catégories et modes de paiement — idempotent, sans course. */
async function ensureReference(databaseUrl: string): Promise<void> {
  const { PrismaClient } = await import('@prisma/client');
  const { seedReference } = await import('../../prisma/reference');

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    await seedReference(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
