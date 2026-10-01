import { PrismaClient, RoleName } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Pointures standards pour l'activité chaussures. */
const SIZES = [36, 37, 38, 39, 40, 41, 42, 43, 44];

const EXPENSE_CATEGORIES = [
  { name: 'Transport', order: 1 },
  { name: 'Pourboire', order: 2 },
  { name: 'Ticket', order: 3 },
  { name: 'Repas / nourriture', order: 4 },
  { name: 'Boost', order: 5 },
  { name: 'Autre', order: 6 },
];

const PAYMENT_METHODS = ['Espèces', 'Mobile Money', 'Virement', 'Chèque'];

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

async function main(): Promise<void> {
  console.log('─ Seed ─');

  // Rôles
  const roles: Record<string, string> = {};
  for (const name of Object.values(RoleName)) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    roles[name] = role.id;
  }

  // Utilisateur administrateur
  const adminEmail = 'admin@local';
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
    console.log(`  + utilisateur ${adminEmail} (mot de passe : admin1234)`);
  }

  // Pointures
  for (const [i, value] of SIZES.entries()) {
    await prisma.size.upsert({
      where: { value },
      update: {},
      create: { value, order: i, label: `${value}` },
    });
  }
  console.log(`  + ${SIZES.length} pointures`);

  // Produit de base
  const productName = 'Samba';
  let product = await prisma.product.findUnique({ where: { slug: slugify(productName) } });
  if (!product) {
    product = await prisma.product.create({
      data: { name: productName, slug: slugify(productName) },
    });
    console.log(`  + produit ${productName}`);
  }

  for (const value of SIZES) {
    const size = await prisma.size.findUniqueOrThrow({ where: { value } });
    await prisma.productVariant.upsert({
      where: { productId_sizeId: { productId: product.id, sizeId: size.id } },
      update: {},
      create: { productId: product.id, sizeId: size.id, sellingPrice: 0 },
    });
  }
  console.log(`  + variantes ${productName} (${SIZES.join(', ')})`);

  // Catégories de dépenses
  for (const c of EXPENSE_CATEGORIES) {
    await prisma.expenseCategory.upsert({ where: { name: c.name }, update: {}, create: c });
  }
  console.log(`  + ${EXPENSE_CATEGORIES.length} catégories de dépenses`);

  // Modes de paiement
  for (const [i, name] of PAYMENT_METHODS.entries()) {
    await prisma.paymentMethod.upsert({ where: { name }, update: {}, create: { name, order: i } });
  }
  console.log(`  + ${PAYMENT_METHODS.length} modes de paiement`);

  console.log('─ Seed terminé ─');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
