import { PrismaClient } from '@prisma/client';
import { seedReference } from './reference';

/**
 * Données de démonstration **optionnelles** — jamais lancées par le seed.
 *
 *   npm run db:seed         # rôles + admin (base vierge)
 *   npm run db:seed:demo    # + référentiels + produits, arrivages, ventes,
 *                           #   dettes, dépenses (Phase 5h)
 *
 * Passe par `prisma/demo.ts`, qui utilise les services métier (FIFO, COGS,
 * dettes, journal, identité comptable) comme le ferait l'API.
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('─ Seed démo (optionnel) ─');

  await seedReference(prisma);

  const { seedDemo } = await import('./demo');
  await seedDemo(prisma);

  console.log('─ Seed démo terminé ─');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
