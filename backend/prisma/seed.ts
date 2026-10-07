import { PrismaClient, RoleName } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seed **strictement minimal** : rôles + comptes de connexion.
 *
 * Aucune donnée métier n'est créée (pointures, catégories, modes de paiement,
 * produits, arrivages, dettes…) : la base part vierge pour que l'application
 * soit testée de bout en bout depuis rien.
 *
 * - `npm run db:seed`        → ce fichier (rôles + `admin@test.local` + `caissier@test.local`)
 * - `npm run db:seed:demo`   → + référentiels et données de démonstration
 * - la suite de tests crée elle-même ses référentiels
 *   (`prisma/reference.ts`, appelé par `tests/setup/env.ts`)
 */
async function main(): Promise<void> {
  console.log('─ Seed (rôles + connexions) ─');

  const roles: Record<string, string> = {};
  for (const name of Object.values(RoleName)) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    roles[name] = role.id;
  }
  console.log(`  + ${Object.keys(roles).length} rôles`);

  const accounts: { email: string; name: string; password: string; role: RoleName }[] = [
    { email: 'admin@test.local', name: 'Administrateur', password: 'admin1234', role: RoleName.ADMIN },
    { email: 'caissier@test.local', name: 'Caissier', password: 'caissier1234', role: RoleName.CASHIER },
  ];

  for (const account of accounts) {
    const existing = await prisma.user.findUnique({ where: { email: account.email } });
    if (!existing) {
      await prisma.user.create({
        data: {
          email: account.email,
          name: account.name,
          passwordHash: await bcrypt.hash(account.password, 10),
          roleId: roles[account.role]!,
        },
      });
    }
    console.log(`  + ${account.email} (mot de passe : ${account.password})`);
  }

  console.log('─ Seed terminé — base vierge, aucune donnée métier ─');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
