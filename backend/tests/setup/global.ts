import { execSync } from 'node:child_process';
import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Exécuté une seule fois avant toute la suite de tests.
 * Recrée la base de tests à partir des migrations (reset complet).
 */
export default function globalSetup(): void {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });

  if (process.env.SKIP_DB_RESET === '1') return;

  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL manquant');

  execSync('npx prisma migrate reset --force --skip-generate --skip-seed', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
    stdio: 'inherit',
  });
}
