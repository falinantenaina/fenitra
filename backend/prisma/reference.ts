import { PrismaClient } from '@prisma/client';

/** Pointures standards pour l'activité chaussures. */
export const SIZES = [36, 37, 38, 39, 40, 41, 42, 43, 44];

export const EXPENSE_CATEGORIES = [
  { name: 'Transport', order: 1 },
  { name: 'Pourboire', order: 2 },
  { name: 'Ticket', order: 3 },
  { name: 'Repas / nourriture', order: 4 },
  { name: 'Boost', order: 5 },
  { name: 'Autre', order: 6 },
];

export const PAYMENT_METHODS = ['Espèces', 'Mobile Money', 'Virement', 'Chèque'];

/**
 * Référentiels **vides de données métier** : pointures, catégories de dépenses
 * et modes de paiement.
 *
 * Ce module n'est **pas** appelé par `prisma/seed.ts` (qui ne crée que les
 * rôles et le compte de connexion) : il sert à
 *   - la suite de tests (`tests/setup/env.ts`) — chaque fichier s'assure que
 *     les référentiels existent avant de démarrer ;
 *   - le seed de démonstration (`npm run db:seed:demo`).
 *
 * Idempotent et sans course : `createMany` + `skipDuplicates`, donc rappelable
 * en parallèle par plusieurs workers.
 */
export async function seedReference(prisma: PrismaClient): Promise<void> {
  await prisma.size.createMany({
    data: SIZES.map((value, i) => ({ value, order: i, label: `${value}` })),
    skipDuplicates: true,
  });

  await prisma.expenseCategory.createMany({
    data: EXPENSE_CATEGORIES.map((c) => ({ ...c, icon: null })),
    skipDuplicates: true,
  });

  await prisma.paymentMethod.createMany({
    data: PAYMENT_METHODS.map((name, order) => ({ name, order })),
    skipDuplicates: true,
  });
}
