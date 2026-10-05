import { beforeAll, describe, expect, it } from 'vitest';
import { adminToken, as, carton, tokenFor, type AuthedRequest } from './helpers';
import { prisma } from '../src/lib/prisma';
import { accountingIdentity, identityBalance } from './identity';

const stamp = Date.now();

let admin: AuthedRequest;
let cashier: AuthedRequest;
let supplierId = '';
let customerId = '';
let sellerId = '';
let variantA = '';
let variantB = '';
let saleFifoId = '';
let saleCreditId = '';

const PRODUCT = `Modèle Vente ${stamp}`;

describe('Ventes', () => {
  beforeAll(async () => {
    admin = as(await adminToken());
    cashier = as(await tokenFor(`caissier-ventes-${stamp}@test.local`, 'Caissier Ventes', 'CASHIER'));

    const [supplier, customer, seller] = await Promise.all([
      admin.post('/suppliers').send({ name: `Fournisseur Vente ${stamp}` }),
      admin.post('/customers').send({ name: `Client Vente ${stamp}` }),
      admin.post('/online-sellers').send({ name: `Vendeur Vente ${stamp}` }),
    ]);
    supplierId = supplier.body.id;
    customerId = customer.body.id;
    sellerId = seller.body.id;

    const product = await admin.post('/products').send({ name: PRODUCT });
    const sizes = await admin.get('/sizes?limit=100');
    const size40 = sizes.body.items.find((s: { value: number }) => s.value === 40);
    const size41 = sizes.body.items.find((s: { value: number }) => s.value === 41);

    const a = await admin.post('/variants').send({ productId: product.body.id, sizeId: size40.id, sellingPrice: 45000 });
    const b = await admin.post('/variants').send({ productId: product.body.id, sizeId: size41.id, sellingPrice: 50000 });
    variantA = a.body.id;
    variantB = b.body.id;

    // Deux arrivages à prix différents pour le test FIFO
    await admin.post('/arrivals').send({
      supplierId,
      cartons: [carton(product.body.id, size40.id, 10, 20000)],
    });
    await admin.post('/arrivals').send({
      supplierId,
      cartons: [carton(product.body.id, size40.id, 8, 23000)],
    });
    await admin.post('/arrivals').send({
      supplierId,
      cartons: [carton(product.body.id, size41.id, 5, 15000)],
    });
  });

  it('prévisualise la référence de vente', async () => {
    const first = await admin.get('/sales/reference-preview');
    const second = await admin.get('/sales/reference-preview');
    expect(first.body.reference).toMatch(/^VTE-\d{4}$/);

    if (second.body.reference !== first.body.reference) {
      // Les fichiers tournent en parallèle : une autre suite a pu consommer la
      // référence entre les deux appels — il faut alors qu'une VENTE la porte.
      const consumed = await prisma.sale.findFirst({ where: { reference: first.body.reference } });
      expect(consumed, `prévisualisation ${first.body.reference} non consommée`).not.toBeNull();
    }
  });

  it('refuse une vente de total nul (400 et jamais une contrainte 500)', async () => {
    const res = await admin.post('/sales').send({
      items: [{ variantId: variantA, quantity: 1, unitPrice: 0 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain('strictement positif');
  });

  it('vend en FIFO : COGS = 10×20000 + 2×23000 (Test 4)', async () => {
    const res = await admin.post('/sales').send({
      items: [{ variantId: variantA, quantity: 12, unitPrice: 45000 }],
      payment: { amount: 540000, method: 'Espèces' },
      paymentMethod: 'Espèces',
    });

    expect(res.status).toBe(201);
    const sale = res.body;
    expect(sale.status).toBe('PAID');
    expect(sale.totalAmount).toBe('540000.00');
    expect(sale.paidAmount).toBe('540000.00');
    expect(sale.remainingAmount).toBe('0.00');
    expect(sale.cogs).toBe('246000.00'); // 10×20000 + 2×23000
    expect(sale.margin).toBe('294000.00');
    expect(sale.debt).toBeNull();
    expect(sale.items[0].lots).toHaveLength(2);
    expect(sale.items[0].lots[0]).toMatchObject({ quantity: 10, unitCost: '20000.00' });
    expect(sale.items[0].lots[1]).toMatchObject({ quantity: 2, unitCost: '23000.00' });

    // il ne reste que le second lot : 6 × 23000
    const stock = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(stock.body.quantity).toBe(6);
    expect(stock.body.value).toBe('138000.00');

    // journal : CA + COGS
    const entries = await prisma.ledgerEntry.findMany({ where: { refType: 'SALE', refId: sale.id } });
    const saleEntry = entries.find((e) => e.kind === 'SALE');
    const cogsEntry = entries.find((e) => e.kind === 'COGS');
    expect(saleEntry).toMatchObject({ amount: 540000, cashDelta: 540000 });
    expect(cogsEntry).toMatchObject({ amount: 246000, cashDelta: 0 });

    saleFifoId = sale.id;
  });

  it('vente à crédit : dette client ouverte avec motif obligatoire', async () => {
    const res = await admin.post('/sales').send({
      customerId,
      items: [{ variantId: variantB, quantity: 1, unitPrice: 50000 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('UNPAID');
    expect(res.body.remainingAmount).toBe('50000.00');
    expect(res.body.cogs).toBe('15000.00');
    expect(res.body.debt).not.toBeNull();
    expect(res.body.debt.status).toBe('OPEN');
    expect(res.body.debt.reason).toBe(`Achat de ${PRODUCT} — non payé`);

    saleCreditId = res.body.id;
  });

  it('accepte un règlement partiel puis refuse un trop-perçu', async () => {
    const partial = await cashier.post(`/sales/${saleCreditId}/payments`).send({ amount: 20000 });
    expect(partial.status).toBe(200);
    expect(partial.body.status).toBe('PARTIAL');
    expect(partial.body.paidAmount).toBe('20000.00');
    expect(partial.body.remainingAmount).toBe('30000.00');
    expect(partial.body.debt.status).toBe('PARTIAL');
    expect(partial.body.debt.paidAmount).toBe('20000.00');

    const ledger = await prisma.ledgerEntry.findMany({
      where: { refType: 'SALE', refId: saleCreditId, kind: 'CUSTOMER_PAYMENT' },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ amount: 20000, cashDelta: 20000 });

    const tooMuch = await admin.post(`/sales/${saleCreditId}/payments`).send({ amount: 999999 });
    expect(tooMuch.status).toBe(422);

    const settle = await admin.post(`/sales/${saleCreditId}/payments`).send({ amount: 30000 });
    expect(settle.status).toBe(200);
    expect(settle.body.status).toBe('PAID');
    expect(settle.body.remainingAmount).toBe('0.00');
    expect(settle.body.debt.status).toBe('PAID');
    expect(settle.body.debt.remainingAmount).toBe('0.00');
  });

  it('refuse un second règlement sur une vente soldée', async () => {
    const res = await admin.post(`/sales/${saleCreditId}/payments`).send({ amount: 1000 });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('déjà réglée');
  });

  it('crée une dette vendeur en ligne et la solde', async () => {
    const sale = await admin.post('/sales').send({
      onlineSellerId: sellerId,
      items: [{ variantId: variantB, quantity: 1, unitPrice: 30000 }],
      payment: { amount: 10000 },
    });
    expect(sale.status).toBe(201);
    expect(sale.body.status).toBe('PARTIAL');
    expect(sale.body.debt.type).toBe('ONLINE_SELLER');
    expect(sale.body.debt.direction).toBe('RECEIVABLE');

    const settled = await admin.post(`/sales/${sale.body.id}/payments`).send({ amount: 20000 });
    expect(settled.status).toBe(200);
    expect(settled.body.debt.status).toBe('PAID');

    const kinds = await prisma.ledgerEntry.findMany({
      where: { refType: 'SALE', refId: sale.body.id, kind: 'ONLINE_SELLER_PAYMENT' },
    });
    expect(kinds).toHaveLength(1);
  });

  it('refuse un article en rupture (409)', async () => {
    const res = await admin.post('/sales').send({
      customerId,
      items: [{ variantId: variantB, quantity: 500, unitPrice: 1000 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('refuse client et vendeur en ligne ensemble (400)', async () => {
    const res = await admin.post('/sales').send({
      customerId,
      onlineSellerId: sellerId,
      items: [{ variantId: variantB, quantity: 1, unitPrice: 1000 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuse un paiement supérieur au montant de la vente', async () => {
    const res = await admin.post('/sales').send({
      items: [{ variantId: variantB, quantity: 1, unitPrice: 1000 }],
      payment: { amount: 999999 },
    });
    expect(res.status).toBe(422);
  });

  it('rejette un doublon avec la même Idempotency-Key', async () => {
    const key = `sale-${stamp}`;
    const payload = {
      customerId,
      items: [{ variantId: variantB, quantity: 1, unitPrice: 20000 }],
    };
    const first = await admin.post('/sales').set('Idempotency-Key', key).send(payload);
    const second = await admin.post('/sales').set('Idempotency-Key', key).send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
  });

  it('annule une vente : les lots reviennent et le journal est contre-passé (Test 5)', async () => {
    const before = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(before.body.quantity).toBe(6);

    const res = await admin.post(`/sales/${saleFifoId}/cancel`).send({ reason: 'Erreur de caisse' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.cancelReason).toBe('Erreur de caisse');

    const after = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(after.body.quantity).toBe(18); // 6 + 10 + 2 restitués
    expect(after.body.value).toBe('384000.00'); // 10×20000 + 8×23000

    // restitution DANS LES MÊMES lots
    const restored = await prisma.stockMovement.findMany({
      where: { refType: 'SALE', refId: saleFifoId, type: 'RETURN' },
    });
    expect(restored).toHaveLength(2);
    expect(restored.map((m) => m.delta).sort((a, b) => a - b)).toEqual([2, 10]);

    // Σ amount WHERE refId = vente = 0 : chaque écriture est annulée
    const entries = await prisma.ledgerEntry.findMany({ where: { refType: 'SALE', refId: saleFifoId } });
    const net = entries.reduce((sum, e) => sum + e.amount, 0);
    expect(net).toBe(0);
    expect(entries.filter((e) => e.amount < 0).every((e) => e.reference?.startsWith('ANNULATION'))).toBe(true);
    expect(entries.filter((e) => e.kind === 'SALE').reduce((s, e) => s + e.cashDelta, 0)).toBe(0);
  });

  it('refuse une double annulation', async () => {
    const res = await admin.post(`/sales/${saleFifoId}/cancel`).send({ reason: 'Encore' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('déjà annulée');
  });

  it('un caissier peut vendre mais pas annuler (§57)', async () => {
    const created = await cashier.post('/sales').send({
      items: [{ variantId: variantB, quantity: 1, unitPrice: 35000 }],
      payment: { amount: 35000 },
    });
    expect(created.status).toBe(201);

    const denied = await cashier.post(`/sales/${saleCreditId}/cancel`).send({ reason: 'Tentative' });
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
  });

  it('liste et lit une vente', async () => {
    const list = await admin.get('/sales?limit=10');
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    expect(list.body.items[0].totalAmount).toMatch(/^\d+\.\d{2}$/);

    const filtered = await admin.get(`/sales?customerId=${customerId}`);
    expect(filtered.body.items.every((s: { customer: { id: string } | null }) => s.customer?.id === customerId)).toBe(true);

    const detail = await admin.get(`/sales/${saleCreditId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.items[0].lots[0].code).toMatch(/^LOT-\d{4}$/);
    expect(detail.body.payments.length).toBeGreaterThan(0);

    const cancelled = await admin.get('/sales?status=CANCELLED');
    expect(cancelled.body.items.some((s: { id: string }) => s.id === saleFifoId)).toBe(true);
  });

  it('404 sur une vente inconnue', async () => {
    const res = await admin.get('/sales/id-inconnu');
    expect(res.status).toBe(404);
  });

  it('identité comptable : caisse + stock + créances − passifs = K + (CA − COGS − charges)', async () => {
    const snapshot = await accountingIdentity();
    const { lhs, rhs, delta } = identityBalance(snapshot);

    expect(snapshot.lots).toBeGreaterThan(0);
    expect(snapshot.cash).not.toBe(0);
    expect(delta).toBe(0);
    expect(lhs).toBe(rhs);
  });
});
