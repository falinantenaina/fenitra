import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { adminToken, as, carton, tokenFor, type AuthedRequest } from './helpers';
import { accountingIdentity, identityBalance } from './identity';

/**
 * Régressions des anomalies corrigées (§6 de `docs/ANALYSE.md`) :
 *
 *  1. `unitCost = 0` refusé en 400 (plus de 500 P2010).
 *  2. Clés d'idempotence scoppées par utilisateur.
 *  3. Réclamation `pending` périmée reprise (pas de 409 éternel).
 *  4. Annulation d'arrivage après un règlement tardif → identité exacte.
 *  5. Vente à crédit sans tiers refusée (plus de dette « vendeur en ligne » sans vendeur).
 *  6. Annulation d'une vente après un règlement de dette → identité exacte.
 */
const stamp = Date.now();

let admin: AuthedRequest;
let manager: AuthedRequest;
let supplierId = '';
let customerId = '';
let variantId = '';
let productId = '';
let size40Id = '';

describe('Régressions — anomalies §6', () => {
  beforeAll(async () => {
    admin = as(await adminToken());
    manager = as(await tokenFor(`manager-reg-${stamp}@test.local`, 'Manager Rég', 'MANAGER'));

    const [supplier, customer] = await Promise.all([
      admin.post('/suppliers').send({ name: `Fournisseur Rég ${stamp}` }),
      admin.post('/customers').send({ name: `Client Rég ${stamp}` }),
    ]);
    supplierId = supplier.body.id;
    customerId = customer.body.id;

    const product = await admin.post('/products').send({ name: `Modèle Rég ${stamp}` });
    const sizes = await admin.get('/sizes?limit=100');
    const size = sizes.body.items.find((s: { value: number }) => s.value === 40);
    const variant = await admin
      .post('/variants')
      .send({ productId: product.body.id, sizeId: size.id, sellingPrice: 45000 });
    variantId = variant.body.id;
    productId = product.body.id;
    size40Id = size.id;

    // Stock de départ réglé d'emblée, distinct des arrivages annulés plus bas.
    const stock = await admin.post('/arrivals').send({
      supplierId,
      cartons: [carton(productId, size40Id, 20, 20000)],
      payment: { amount: 400000 },
    });
    expect(stock.status).toBe(201);
  });

  it('R1 — refuse un prix d\'achat nul en 400 (CHECK unitCost > 0)', async () => {
    const res = await admin.post('/arrivals').send({
      supplierId,
      cartons: [carton(productId, size40Id, 2, 0)],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('R2 — deux comptes peuvent employer la même Idempotency-Key', async () => {
    const key = `reg-${stamp}`;
    const first = await admin
      .post('/debts')
      .set('Idempotency-Key', key)
      .send({ type: 'CUSTOMER', customerId, amount: 1111 });
    const second = await manager
      .post('/debts')
      .set('Idempotency-Key', key)
      .send({ type: 'CUSTOMER', customerId, amount: 2222 });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Sans scopage, le second aurait rejoué la réponse du premier.
    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.initialAmount).toBe('2222.00');

    // Le même compte, la même clé, le même endpoint → replay.
    const replay = await admin
      .post('/debts')
      .set('Idempotency-Key', key)
      .send({ type: 'CUSTOMER', customerId, amount: 1111 });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
  });

  it('R3 — reprend une réclamation `pending` périmée', async () => {
    const key = `stale-${stamp}`;
    const me = await admin.get('/auth/me');
    await prisma.idempotencyRecord.create({
      data: {
        key: `${me.body.id}:${key}`,
        userId: me.body.id,
        endpoint: 'POST /debts',
        statusCode: 0,
        body: '',
        createdAt: new Date(Date.now() - 10 * 60_000),
      },
    });

    const res = await admin
      .post('/debts')
      .set('Idempotency-Key', key)
      .send({ type: 'CUSTOMER', customerId, amount: 3333 });
    expect(res.status).toBe(201);
    expect(res.body.initialAmount).toBe('3333.00');
  });

  it('R4 — annule un arrivage après un règlement tardif sans casser l\'identité', async () => {
    const created = await admin.post('/arrivals').send({
      supplierId,
      cartons: [carton(productId, size40Id, 5, 20000)],
    });
    expect(created.status).toBe(201);
    const arrivalId = created.body.id;
    expect(created.body.debt.status).toBe('OPEN');
    const debtId = created.body.debt.id;

    // Règlement tardif : `Arrival.paidAmount` n'est jamais mis à jour.
    const paid = await admin.post(`/debts/${debtId}/payments`).send({ amount: 40000 });
    expect(paid.status).toBe(200);
    expect(paid.body.remainingAmount).toBe('60000.00');

    const cancelled = await admin
      .post(`/arrivals/${arrivalId}/cancel`)
      .send({ reason: 'Test régression règlement tardif' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    const arrivalEntries = await prisma.ledgerEntry.findMany({
      where: { refType: 'ARRIVAL', refId: arrivalId },
    });
    expect(arrivalEntries.reduce((s, e) => s + e.cashDelta, 0)).toBe(0);
    const debtEntries = await prisma.ledgerEntry.findMany({
      where: { refType: 'DEBT', refId: debtId },
    });
    expect(debtEntries.reduce((s, e) => s + e.cashDelta, 0)).toBe(0);

    expect(identityBalance(await accountingIdentity()).delta).toBe(0);
  });

  it('R5 — refuse une vente à crédit sans client ni vendeur en ligne', async () => {
    const res = await admin.post('/sales').send({
      items: [{ variantId, quantity: 1, unitPrice: 45000 }],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('crédit');

    // Vendre au comptant sans tiers reste possible.
    const cash = await admin.post('/sales').send({
      items: [{ variantId, quantity: 1, unitPrice: 45000 }],
      payment: { amount: 45000 },
    });
    expect(cash.status).toBe(201);
    expect(cash.body.debt ?? null).toBeNull();
  });

  it('R6 — annule une vente après un règlement de dette sans casser l\'identité', async () => {
    const created = await admin.post('/sales').send({
      customerId,
      items: [{ variantId, quantity: 2, unitPrice: 50000 }],
    });
    expect(created.status).toBe(201);
    const saleId = created.body.id;
    const debtId = created.body.debt.id;

    const paid = await admin.post(`/debts/${debtId}/payments`).send({ amount: 30000 });
    expect(paid.status).toBe(200);

    const cancelled = await admin
      .post(`/sales/${saleId}/cancel`)
      .send({ reason: 'Test régression vente crédit' });
    expect(cancelled.status).toBe(200);

    const saleEntries = await prisma.ledgerEntry.findMany({
      where: { refType: 'SALE', refId: saleId },
    });
    expect(saleEntries.reduce((s, e) => s + e.amount, 0)).toBe(0);
    const debtEntries = await prisma.ledgerEntry.findMany({
      where: { refType: 'DEBT', refId: debtId },
    });
    expect(debtEntries.reduce((s, e) => s + e.amount, 0)).toBe(0);

    expect(identityBalance(await accountingIdentity()).delta).toBe(0);
  });
});
