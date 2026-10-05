import { PrismaClient, RoleName } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seed **strictement minimal** : rôles + seul compte de connexion.
 *
 * Aucune donnée métier n'est créée (pointures, catégories, modes de paiement,
 * produits, arrivages, dettes…) : la base part vierge pour que l'application
 * soit testée de bout en bout depuis rien.
 *
 * - `npm run db:seed`        → ce fichier (rôles + `admin@test.local`)
 * - `npm run db:seed:demo`   → + référentiels et données de démonstration
 * - la suite de tests crée elle-même ses référentiels
 *   (`prisma/reference.ts`, appelé par `tests/setup/env.ts`)
 */
async function main(): Promise<void> {
  console.log('─ Seed (rôles + connexion) ─');

  const roles: Record<string, string> = {};
  for (const name of Object.values(RoleName)) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    roles[name] = role.id;
  }
  console.log(`  + ${Object.keys(roles).length} rôles`);

  const adminEmail = 'admin@test.local';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Administrateur',
        passwordHash: await bcrypt.hash('admin1234', 10),
        roleId: roles.ADMIN!,
      },
    });
  }
  console.log(`  + ${adminEmail} (mot de passe : admin1234)`);

  console.log('─ Seed terminé — base vierge, aucune donnée métier ─');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
