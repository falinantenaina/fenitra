import { PrismaClient } from '@prisma/client';
import { createArrival } from '../src/modules/arrivals/arrivals.service';
import { addSalePayment, createSale } from '../src/modules/sales/sales.service';
import { createDebt, payDebt } from '../src/modules/debts/debts.service';
import { createExpense } from '../src/modules/finances/expenses.service';
import { createVersement } from '../src/modules/finances/versements.service';
import { createCapital } from '../src/modules/finances/capital.service';

/**
 * Données de démonstration réalistes (Phase 5h).
 *
 * Tout passe par les **services métier** (et non par des écritures Prisma
 * directes) : FIFO, COGS, dettes, écritures de journal et identité
 * comptable sont donc exactement celles que produit l'API.
 *
 * Exécuté uniquement en dehors des tests (`NODE_ENV !== 'test'`) : la suite
 * démarre sur un base vierge + seed minimal.
 */

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const daysAgo = (n: number, hour = 10): Date => {
  const d = new Date(Date.now() - n * 86_400_000);
  d.setHours(hour, 15, 0, 0);
  return d;
};

const CATALOGUE = [
  { name: 'Samba', sizes: [40, 41, 42], price: 180_000 },
  { name: 'RunFast 300', sizes: [40, 41], price: 145_000 },
  { name: 'Basket Urbain', sizes: [40, 41], price: 165_000 },
  { name: 'Mocassin Cuir', sizes: [41, 42], price: 220_000 },
];

export async function seedDemo(prisma: PrismaClient): Promise<void> {
  if ((await prisma.sale.count()) > 0) {
    console.log('  · données de démo déjà présentes, rien à faire');
    return;
  }

  const admin = await prisma.user.findUnique({ where: { email: 'admin@test.local' } });
  if (!admin) throw new Error('admin@test.local introuvable : lancez d\'abord le seed minimal');
  const userId = admin.id;

  // ── Tiers ────────────────────────────────────────────────────────────────
  const suppliers = [];
  for (const name of ['Import Chaussures Toamasina', 'Grossiste Analamahitsy']) {
    suppliers.push(
      (await prisma.supplier.findFirst({ where: { name } })) ??
        (await prisma.supplier.create({ data: { name } })),
    );
  }
  const customers = [];
  for (const name of ['Rakoto Jean', 'Rasoanaivo Hery', 'Andria Miora']) {
    customers.push(
      (await prisma.customer.findFirst({ where: { name } })) ??
        (await prisma.customer.create({ data: { name } })),
    );
  }
  const sellers = [];
  for (const name of ['Boutique Antaninarenina', 'Vendeuse Instagram']) {
    sellers.push(
      (await prisma.onlineSeller.findFirst({ where: { name } })) ??
        (await prisma.onlineSeller.create({ data: { name } })),
    );
  }
  console.log(`  + ${suppliers.length} fournisseurs, ${customers.length} clients, ${sellers.length} vendeurs en ligne`);

  // ── Catalogue (prix de vente par défaut, A10) ────────────────────────────
  const variantOf = new Map<string, string>();
  const productByName = new Map<string, string>();
  for (const p of CATALOGUE) {
    const slug = slugify(p.name);
    const product =
      (await prisma.product.findUnique({ where: { slug } })) ??
      (await prisma.product.create({ data: { name: p.name, slug } }));
    productByName.set(p.name, product.id);

    for (const sizeValue of p.sizes) {
      const size = await prisma.size.findUniqueOrThrow({ where: { value: sizeValue } });
      const variant = await prisma.productVariant.upsert({
        where: { productId_sizeId: { productId: product.id, sizeId: size.id } },
        update: { sellingPrice: p.price, active: true },
        create: { productId: product.id, sizeId: size.id, sellingPrice: p.price },
      });
      variantOf.set(`${p.name}:${sizeValue}`, variant.id);
    }
  }
  console.log(`  + ${CATALOGUE.length} modèles valorisés (${variantOf.size} variantes)`);

  const v = (model: string, size: number): string => {
    const id = variantOf.get(`${model}:${size}`);
    if (!id) throw new Error(`Variante absente : ${model} ${size}`);
    return id;
  };

  /** Modèle → `productId` (un carton porte toujours son modèle). */
  const modelId = (model: string): string => {
    const id = productByName.get(model);
    if (!id) throw new Error(`Modèle absent : ${model}`);
    return id;
  };
  /** Pointure → `sizeId`. */
  const pt = async (value: number): Promise<string> =>
    (await prisma.size.findUniqueOrThrow({ where: { value } })).id;

  // ── Argent propre de départ (A5) ─────────────────────────────────────────
  await createCapital(
    { type: 'IN', amount: 3_000_000, date: daysAgo(45), motif: 'Fonds propres — apport initial' },
    userId,
  );

  // ── Arrivages (FIFO, dettes fournisseurs) ────────────────────────────────
  await createArrival(
    {
      supplierId: suppliers[0]!.id,
      date: daysAgo(40),
      notes: 'Premier arrivage de la saison',
      cartons: [
        {
          reference: 'CTN-RF-01',
          productId: modelId('RunFast 300'),
          totalQty: 12,
          totalCost: 12 * 70_000,
          sizes: [
            { sizeId: await pt(40), quantity: 6 },
            { sizeId: await pt(41), quantity: 6 },
          ],
        },
        {
          reference: 'CTN-SB-01',
          productId: modelId('Samba'),
          totalQty: 12,
          totalCost: 12 * 85_000,
          sizes: [
            { sizeId: await pt(40), quantity: 6 },
            { sizeId: await pt(41), quantity: 6 },
          ],
        },
      ],
      payment: { amount: 1_860_000, method: 'Espèces' },
    },
    userId,
  );

  await createArrival(
    {
      supplierId: suppliers[1]!.id,
      date: daysAgo(22),
      notes: 'Achat à crédit : 300 000 réglés d\'emblée',
      cartons: [
        {
          productId: modelId('Basket Urbain'),
          totalQty: 10,
          totalCost: 10 * 80_000,
          sizes: [
            { sizeId: await pt(40), quantity: 5 },
            { sizeId: await pt(41), quantity: 5 },
          ],
        },
      ],
      payment: { amount: 300_000, method: 'Mobile Money' },
    },
    userId,
  );

  await createArrival(
    {
      supplierId: suppliers[0]!.id,
      date: daysAgo(8),
      cartons: [
        {
          productId: modelId('Mocassin Cuir'),
          totalQty: 8,
          totalCost: 8 * 120_000,
          sizes: [
            { sizeId: await pt(41), quantity: 4 },
            { sizeId: await pt(42), quantity: 4 },
          ],
        },
      ],
      payment: { amount: 960_000, method: 'Virement' },
    },
    userId,
  );
  console.log('  + 3 arrivages (2 réglés, 1 partiel)');

  // ── Ventes (mixte : espèces, partielles, crédit) ─────────────────────────
  const sold = await createSale(
    {
      customerId: customers[0]!.id,
      date: daysAgo(30),
      items: [
        { variantId: v('RunFast 300', 40), quantity: 1, unitPrice: 145_000 },
        { variantId: v('RunFast 300', 41), quantity: 1, unitPrice: 145_000 },
      ],
      payment: { amount: 290_000, method: 'Espèces' },
    },
    userId,
  );

  const partialSale = await createSale(
    {
      customerId: customers[1]!.id,
      date: daysAgo(26),
      items: [
        { variantId: v('Samba', 40), quantity: 1, unitPrice: 180_000 },
        { variantId: v('Samba', 41), quantity: 2, unitPrice: 175_000 },
      ],
      payment: { amount: 200_000, method: 'Mobile Money' },
      notes: 'Solde à régler en deux fois',
    },
    userId,
  );

  await createSale(
    {
      customerId: customers[1]!.id,
      date: daysAgo(18),
      items: [
        { variantId: v('Basket Urbain', 40), quantity: 1, unitPrice: 165_000 },
        { variantId: v('Basket Urbain', 41), quantity: 1, unitPrice: 165_000 },
      ],
      payment: { amount: 330_000, method: 'Espèces' },
    },
    userId,
  );

  await createSale(
    {
      customerId: customers[2]!.id,
      date: daysAgo(10),
      items: [{ variantId: v('Mocassin Cuir', 41), quantity: 1, unitPrice: 220_000 }],
      notes: 'Pris sans payer — à encaisser',
    },
    userId,
  );

  await createSale(
    {
      onlineSellerId: sellers[0]!.id,
      date: daysAgo(4),
      items: [
        { variantId: v('Samba', 41), quantity: 1, unitPrice: 180_000 },
        { variantId: v('RunFast 300', 41), quantity: 1, unitPrice: 145_000 },
      ],
      payment: { amount: 325_000, method: 'Mobile Money' },
    },
    userId,
  );

  await createSale(
    {
      customerId: customers[0]!.id,
      date: daysAgo(1),
      items: [{ variantId: v('Mocassin Cuir', 42), quantity: 1, unitPrice: 220_000 }],
      payment: { amount: 220_000, method: 'Espèces' },
    },
    userId,
  );

  await addSalePayment(
    partialSale.id,
    { amount: 100_000, method: 'Espèces', date: daysAgo(12), notes: 'Premier acompte' },
    userId,
  );
  console.log(`  + 6 ventes (dont crédit partiel ${sold.reference} et solde à venir)`);

  // ── Dettes déclarées (Phase 5e) ──────────────────────────────────────────
  const lent = await createDebt(
    {
      type: 'CUSTOMER',
      customerId: customers[2]!.id,
      amount: 80_000,
      paidAmount: 0,
      date: daysAgo(12),
      method: 'Espèces',
    },
    userId,
  );
  await payDebt(lent.id, { amount: 30_000, method: 'Espèces', date: daysAgo(5) }, userId);

  const trosa = await createDebt(
    {
      type: 'TROSA_SINOA',
      partyName: 'Ravo',
      amount: 400_000,
      paidAmount: 0,
      date: daysAgo(14),
      reason: 'Emprunt pour compléter l\'achat de chaussures',
    },
    userId,
  );
  console.log('  + 2 dettes manuelles (cliente + trosa sinoa)');

  // ── Finances : dépenses, versements, capital ─────────────────────────────
  const categories = await prisma.expenseCategory.findMany({ orderBy: { order: 'asc' } });
  const cat = (name: string): string => {
    const found = categories.find((c) => c.name === name);
    if (!found) throw new Error(`Catégorie absente : ${name}`);
    return found.id;
  };

  const expenses: [string, number, string, number][] = [
    ['Transport', 25_000, 'Taxi-brousse jusqu\'à l\'entrepôt', 35],
    ['Ticket', 15_000, 'Stationnement Analakely', 30],
    ['Repas / nourriture', 20_000, 'Déjeuner équipe de vente', 24],
    ['Boost', 50_000, 'Sponsored Instagram boutique', 6],
    ['Pourboire', 10_000, 'Chargement des cartons', 3],
    ['Transport', 30_000, 'Livraison client en moto', 2],
  ];
  for (const [category, amount, description, ago] of expenses) {
    await createExpense(
      { categoryId: cat(category), amount, description, date: daysAgo(ago, 16), method: 'Espèces' },
      userId,
    );
  }

  // A2 : versement sur une trosa ouverte → DEBT_SETTLEMENT (hors bénéfice)
  await createVersement(
    {
      personName: 'Ravo',
      amount: 150_000,
      date: daysAgo(6, 17),
      motif: 'Remboursement partiel de la trosa',
      method: 'Espèces',
      debtId: trosa.id,
    },
    userId,
  );
  // A2 : pas de dette ouverte pour cette personne → CHARGE (réduit le bénéfice)
  await createVersement(
    {
      personName: 'Famille',
      amount: 50_000,
      date: daysAgo(3, 18),
      motif: 'Aide à la famille',
      method: 'Espèces',
      treatment: 'CHARGE',
    },
    userId,
  );

  await createCapital(
    { type: 'OUT', amount: 100_000, date: daysAgo(2), motif: 'Retrait de capital pour dépenses personnelles' },
    userId,
  );
  console.log('  + 6 dépenses, 2 versements (1 règlement de trosa, 1 charge), 2 mouvements de capital');
}
