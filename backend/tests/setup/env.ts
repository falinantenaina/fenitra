import path from 'node:path';
import dotenv from 'dotenv';

/**
 * Exécuté AVANT chaque fichier de test.
 * Force `NODE_ENV=test` et bascule sur la base de tests.
 * `dotenv` ne surcharge pas les variables déjà définies.
 */
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

process.env.NODE_ENV = 'test';

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
