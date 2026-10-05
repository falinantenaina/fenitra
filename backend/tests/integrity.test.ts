import { beforeAll, describe, expect, it } from 'vitest';
import { adminToken, as, carton, type AuthedRequest } from './helpers';
import { prisma } from '../src/lib/prisma';
import { accountingIdentity, identityBalance } from './identity';

const stamp = Date.now();

let admin: AuthedRequest;
let supplierId = '';
let customerId = '';
let variantId = '';
let productId = '';
let sizeId = '';
let categoryId = '';
let debtId = '';

const PRODUCT = `Module Intégrité ${stamp}`;

/**
 * Périmètre « propre » : toutes les tables sont comptées **pour les entités de
 * ce fichier uniquement**, les autres suites tournant en parallèle sur la même
 * base (pool de forks).
 */
async function scope() {
  const [sales, saleItems, movements, lots, arrivals, supplierDebts, customerDebts, expenses] =
    await Promise.all([
      prisma.sale.count({ where: { customerId } }),
      prisma.saleItem.count({ where: { variantId } }),
      prisma.stockMovement.count({ where: { variantId } }),
      prisma.stockLot.count({ where: { variantId } }),
      prisma.arrival.count({ where: { supplierId } }),
      prisma.debt.count({ where: { supplierId, type: 'SUPPLIER' } }),
      prisma.debt.count({ where: { customerId, type: 'CUSTOMER' } }),
      prisma.expense.count({ where: { categoryId } }),
    ]);
  const payments = debtId ? await prisma.payment.count({ where: { debtId } }) : 0;
  return {
    sales,
    saleItems,
    movements,
    lots,
    arrivals,
    supplierDebts,
    customerDebts,
    payments,
    expenses,
  };
}

describe('Intégrité — rollback et anti double-soumission', () => {
  beforeAll(async () => {
    admin = as(await adminToken());

    const [supplier, customer] = await Promise.all([
      admin.post('/suppliers').send({ name: `Fournisseur Intégrité ${stamp}` }),
      admin.post('/customers').send({ name: `Client Intégrité ${stamp}` }),
    ]);
    supplierId = supplier.body.id;
    customerId = customer.body.id;

    const category = await admin
      .post('/expense-categories')
      .send({ name: `Intégrité ${stamp}` });
    categoryId = category.body.id;

    const product = await admin.post('/products').send({ name: PRODUCT });
    const sizes = await admin.get('/sizes?limit=100');
    const size = sizes.body.items.find((s: { value: number }) => s.value === 42) as
      | { id: string }
      | undefined;
    const fallback = (sizes.body.items as { id: string; value: number }[])[0]!;
    const variant = await admin
      .post('/variants')
      .send({ productId: product.body.id, sizeId: size?.id ?? fallback.id, sellingPrice: 30000 });
    variantId = variant.body.id;
    productId = product.body.id;
    sizeId = size?.id ?? fallback.id;

    // 10 unités en stock pour les tentatives de vente.
    const arrival = await admin.post('/arrivals').send({
      supplierId,
      cartons: [carton(productId, sizeId, 10, 12000)],
      payment: { amount: 120000, method: 'Espèces' },
    });
    expect(arrival.status).toBe(201);

    const debt = await admin.post('/debts').send({
      type: 'CUSTOMER',
      customerId,
      amount: 100000,
      reason: 'Dette d\'intégrité',
    });
    expect(debt.status).toBe(201);
    debtId = debt.body.id;
  });

  /* ════════════ Rollback : aucune écriture partielle ════════════ */

  it('une vente au-delà du stock ne laisse ni vente, ni allocation, ni mouvement', async () => {
    const before = await scope();

    const res = await admin.post('/sales').send({
      customerId,
      items: [{ variantId, quantity: 50, unitPrice: 30000 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');

    const after = await scope();
    expect(after.sales).toBe(before.sales);
    expect(after.saleItems).toBe(before.saleItems);
    expect(after.movements).toBe(before.movements);
    expect(after.lots).toBe(before.lots);
  });

  it('une vente sur une variante inconnue ne crée rien', async () => {
    const before = await scope();

    const res = await admin.post('/sales').send({
      customerId,
      items: [{ variantId: 'variant-inexistante', quantity: 1, unitPrice: 1000 }],
    });
    expect(res.status).toBe(404);

    const after = await scope();
    expect(after.sales).toBe(before.sales);
    expect(after.saleItems).toBe(before.saleItems);
    expect(after.movements).toBe(before.movements);
  });

  it('un arrivage à fournisseur inconnu ne crée ni arrivage, ni lot, ni dette', async () => {
    const before = await scope();

    const res = await admin.post('/arrivals').send({
      supplierId: 'fournisseur-inexistant',
      cartons: [carton(productId, sizeId, 3, 10000)],
      payment: { amount: 30000 },
    });
    expect(res.status).toBe(404);

    const after = await scope();
    expect(after.arrivals).toBe(before.arrivals);
    expect(after.lots).toBe(before.lots);
    expect(after.movements).toBe(before.movements);
    expect(after.supplierDebts).toBe(before.supplierDebts);
  });

  it('une dépense à catégorie inconnue ne crée ni dépense, ni écriture', async () => {
    const before = await scope();

    const res = await admin.post('/expenses').send({
      categoryId: 'categorie-inexistante',
      amount: 5000,
      description: 'Rollback dépense',
    });
    expect(res.status).toBe(404);

    const after = await scope();
    expect(after.expenses).toBe(before.expenses);
  });

  it('un règlement supérieur au reste dû ne crée pas de paiement', async () => {
    const before = await scope();
    const debtBefore = await admin.get(`/debts/${debtId}`);
    expect(debtBefore.status).toBe(200);

    const res = await admin.post(`/debts/${debtId}/payments`).send({ amount: 500000 });
    expect(res.status).toBe(422);

    const after = await scope();
    expect(after.payments).toBe(before.payments);

    const debtAfter = await admin.get(`/debts/${debtId}`);
    expect(debtAfter.body.remainingAmount).toBe(debtBefore.body.remainingAmount);
    expect(debtAfter.body.status).toBe(debtBefore.body.status);
  });

  /* ════════════ Anti double-soumission ════════════ */

  it('rejoue la même réponse pour deux soumissions séquentielles (POST /debts)', async () => {
    const key = `integrite-debt-${stamp}`;
    const payload = {
      type: 'CUSTOMER',
      customerId,
      amount: 25000,
      reason: 'Anti double soumission',
    };

    const before = await scope();
    const first = await admin.post('/debts').set('Idempotency-Key', key).send(payload);
    const second = await admin.post('/debts').set('Idempotency-Key', key).send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);

    const after = await scope();
    expect(after.customerDebts - before.customerDebts).toBe(1);
  });

  it('ne crée qu\'une seule dette pour deux soumissions simultanées', async () => {
    const key = `integrite-debt-par-${stamp}`;
    const payload = {
      type: 'CUSTOMER',
      customerId,
      amount: 30000,
      reason: 'Soumission simultanée',
    };

    const before = await scope();
    const first = admin.post('/debts').set('Idempotency-Key', key).send(payload);
    const second = admin.post('/debts').set('Idempotency-Key', key).send(payload);
    const [a, b] = await Promise.all([first, second]);

    // Le second obtient soit la réponse rejouée, soit un refus de course (409) :
    // dans les deux cas, une seule dette a été créée.
    for (const res of [a, b]) {
      expect([201, 409]).toContain(res.status);
      if (res.status === 201) expect(res.body.id).toBeDefined();
    }
    if (a.status === 201 && b.status === 201) {
      expect(b.body.id).toBe(a.body.id);
    }

    const after = await scope();
    expect(after.customerDebts - before.customerDebts).toBe(1);
  });

  it('ne crée qu\'une seule vente pour deux soumissions simultanées', async () => {
    const key = `integrite-sale-${stamp}`;
    const payload = {
      customerId,
      items: [{ variantId, quantity: 1, unitPrice: 30000 }],
    };

    const before = await scope();
    const first = admin.post('/sales').set('Idempotency-Key', key).send(payload);
    const second = admin.post('/sales').set('Idempotency-Key', key).send(payload);
    const [a, b] = await Promise.all([first, second]);

    for (const res of [a, b]) {
      expect([201, 409]).toContain(res.status);
    }
    if (a.status === 201 && b.status === 201) {
      expect(b.body.id).toBe(a.body.id);
    }

    const after = await scope();
    expect(after.sales - before.sales).toBe(1);
    expect(after.saleItems - before.saleItems).toBe(1);
    expect(after.movements - before.movements).toBe(1);
  });

  it('libère la clé après un échec : le même clé peut ensuite aboutir', async () => {
    const key = `integrite-release-${stamp}`;
    const failing = {
      customerId,
      items: [{ variantId, quantity: 99, unitPrice: 30000 }],
    };

    const failed = await admin.post('/sales').set('Idempotency-Key', key).send(failing);
    expect(failed.status).toBe(409);

    const before = await scope();
    const valid = {
      customerId,
      items: [{ variantId, quantity: 1, unitPrice: 30000 }],
    };
    const retried = await admin.post('/sales').set('Idempotency-Key', key).send(valid);

    expect(retried.status).toBe(201);
    const after = await scope();
    expect(after.sales - before.sales).toBe(1);
  });

  it('rejoue un règlement de dette soumis deux fois avec la même clé', async () => {
    const key = `integrite-payment-${stamp}`;

    const before = await scope();
    const first = await admin
      .post(`/debts/${debtId}/payments`)
      .set('Idempotency-Key', key)
      .send({ amount: 10000 });
    const second = await admin
      .post(`/debts/${debtId}/payments`)
      .set('Idempotency-Key', key)
      .send({ amount: 10000 });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.paidAmount).toBe(first.body.paidAmount);

    const after = await scope();
    expect(after.payments - before.payments).toBe(1);
  });

  it('laisse l\'identité comptable à zéro après tous ces refus', async () => {
    const snapshot = await accountingIdentity();
    const { delta } = identityBalance(snapshot);
    expect(delta).toBe(0);
  });
});
