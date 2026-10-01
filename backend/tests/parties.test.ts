import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminToken, app, API, as, tokenFor, type AuthedRequest } from './helpers';

const stamp = Date.now();

let admin: AuthedRequest;
let cashier: AuthedRequest;
let supplierId = '';
let customerId = '';
let sellerId = '';

describe('Tiers', () => {
  beforeAll(async () => {
    admin = as(await adminToken());
    cashier = as(await tokenFor(`caissier-parties-${stamp}@test.local`, 'Caissier Tiers', 'CASHIER'));
  });

  it('exige une authentification', async () => {
    const res = await request(app).get(`${API}/suppliers`);
    expect(res.status).toBe(401);
  });

  it('crée un fournisseur', async () => {
    const res = await admin
      .post('/suppliers')
      .send({ name: `Fournisseur Test ${stamp}`, phone: '032 00 000 00', address: 'Antananarivo' });
    expect(res.status).toBe(201);
    expect(res.body.name).toContain('Fournisseur Test');
    expect(res.body.active).toBe(true);
    supplierId = res.body.id;
  });

  it('crée un client', async () => {
    const res = await admin.post('/customers').send({ name: `Client Test ${stamp}`, phone: '033 11 111 11' });
    expect(res.status).toBe(201);
    customerId = res.body.id;
  });

  it('crée un vendeur en ligne', async () => {
    const res = await admin.post('/online-sellers').send({ name: `Vendeur Test ${stamp}` });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
    sellerId = res.body.id;
  });

  it('refuse un nom trop court (400)', async () => {
    const res = await admin.post('/customers').send({ name: 'A' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('résumé fournisseur : arrivages + dettes + paiements', async () => {
    const res = await admin.get(`/suppliers/${supplierId}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.supplier.name).toContain('Fournisseur Test');
    expect(res.body.arrivals).toEqual({
      count: 0,
      totalCost: '0.00',
      totalQty: 0,
      paidAmount: '0.00',
      unpaidAmount: '0.00',
    });
    expect(res.body.debts).toEqual({
      count: 0,
      openCount: 0,
      initialAmount: '0.00',
      paidAmount: '0.00',
      remainingAmount: '0.00',
    });
    expect(res.body.payments).toEqual({ count: 0, total: '0.00' });
  });

  it('résumé client : ventes + dettes + paiements', async () => {
    const res = await admin.get(`/customers/${customerId}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.sales.count).toBe(0);
    expect(res.body.sales.totalAmount).toBe('0.00');
    expect(res.body.debts.openCount).toBe(0);
    expect(res.body.payments.total).toBe('0.00');
  });

  it('résumé vendeur en ligne : ventes + dettes + paiements', async () => {
    const res = await admin.get(`/online-sellers/${sellerId}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.onlineSeller.name).toContain('Vendeur Test');
    expect(res.body.sales.count).toBe(0);
    expect(res.body.debts.count).toBe(0);
  });

  it('liste paginée avec métadonnées', async () => {
    const res = await admin.get('/customers?limit=5&page=1');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(5);
    expect(res.body).toMatchObject({ page: 1, limit: 5 });
    expect(res.body.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('met à jour un client', async () => {
    const res = await admin.put(`/customers/${customerId}`).send({ phone: '034 22 222 22', notes: 'Fidèle' });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBe('034 22 222 22');
    expect(res.body.notes).toBe('Fidèle');
  });

  it('désactive un tiers (DELETE = suppression douce)', async () => {
    const res = await admin.delete(`/suppliers/${supplierId}`);
    expect(res.status).toBe(204);

    const read = await admin.get(`/suppliers/${supplierId}`);
    expect(read.body.active).toBe(false);
  });

  it('404 sur un identifiant inconnu', async () => {
    const res = await admin.get('/customers/id-inconnu');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('interdit l\'écriture à un caissier (403)', async () => {
    const create = await cashier.post('/customers').send({ name: `Refusé ${stamp}` });
    expect(create.status).toBe(403);

    const update = await cashier.put(`/customers/${customerId}`).send({ phone: '000' });
    expect(update.status).toBe(403);
  });

  it('autorise la lecture à un caissier', async () => {
    const res = await cashier.get('/customers');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });
});
