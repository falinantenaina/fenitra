import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminToken, API, app, as, tokenFor, type AuthedRequest } from './helpers';

const stamp = Date.now();

let admin: AuthedRequest;
let cashier: AuthedRequest;
let productId = '';
let size46Id = '';
let variantId = '';

describe('Catalogue', () => {
  beforeAll(async () => {
    admin = as(await adminToken());
    cashier = as(await tokenFor(`caissier-catalog-${stamp}@test.local`, 'Caissier Catalogue', 'CASHIER'));
  });

  it('refuse les lectures sans jeton (401)', async () => {
    const res = await request(app).get(`${API}/sizes`);
    expect(res.status).toBe(401);
  });

  it('liste les pointures du seed', async () => {
    const res = await admin.get('/sizes?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(9);
    expect(res.body.items[0].value).toBe(36);
  });

  it('crée une pointure puis refuse le doublon', async () => {
    const created = await admin.post('/sizes').send({ value: 46, label: '46' });
    expect(created.status).toBe(201);
    expect(created.body.value).toBe(46);
    size46Id = created.body.id;

    const duplicate = await admin.post('/sizes').send({ value: 46 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
  });

  it('crée un produit avec un slug unique', async () => {
    const created = await admin.post('/products').send({ name: 'Stan Smith Test', description: 'Blanc / Vert' });
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe('stan-smith-test');
    productId = created.body.id;

    const twin = await admin.post('/products').send({ name: 'Stan Smith Test' });
    expect(twin.status).toBe(201);
    expect(twin.body.slug).toBe('stan-smith-test-2');
  });

  it('crée une variante produit × pointure avec le prix en string', async () => {
    const res = await admin
      .post('/variants')
      .send({ productId, sizeId: size46Id, sku: `SKU-${stamp}`, sellingPrice: 75000 });

    expect(res.status).toBe(201);
    expect(res.body.sellingPrice).toBe('75000.00');
    expect(res.body.size.value).toBe(46);
    variantId = res.body.id;
  });

  it('refuse la même combinaison produit × pointure (409)', async () => {
    const res = await admin
      .post('/variants')
      .send({ productId, sizeId: size46Id, sellingPrice: 1000 });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('existe déjà en pointure');
  });

  it('lit un produit avec ses variantes et leurs tailles', async () => {
    const res = await admin.get(`/products/${productId}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Stan Smith Test');
    expect(Array.isArray(res.body.variants)).toBe(true);
    expect(res.body.variants.some((v: { id: string }) => v.id === variantId)).toBe(true);
    expect(res.body.variants[0].sellingPrice).toMatch(/^\d+\.\d{2}$/);
  });

  it('recherche insensible à la casse sur le nom du produit', async () => {
    const res = await admin.get('/products?q=stan%20smith');
    expect(res.status).toBe(200);
    expect(res.body.items.some((p: { id: string }) => p.id === productId)).toBe(true);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(50);
  });

  it('change le prix de vente courant (§19)', async () => {
    const res = await admin.put(`/variants/${variantId}/price`).send({ sellingPrice: 80000 });
    expect(res.status).toBe(200);
    expect(res.body.sellingPrice).toBe('80000.00');

    const read = await admin.get(`/variants/${variantId}`);
    expect(read.body.sellingPrice).toBe('80000.00');
  });

  it('renvoie l\'historique des prix d\'achat (§18)', async () => {
    const res = await admin.get(`/variants/${variantId}/price-history`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it('refuse la suppression d\'une pointure utilisée (409)', async () => {
    const sizes = await admin.get('/sizes?limit=100');
    const used = sizes.body.items.find((s: { value: number }) => s.value === 42);
    expect(used).toBeDefined();

    const res = await admin.delete(`/sizes/${used.id}`);
    expect(res.status).toBe(409);
  });

  it('interdit la création d\'un produit à un caissier (403)', async () => {
    const res = await cashier.post('/products').send({ name: 'Interdit' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('désactive un produit (DELETE = suppression douce)', async () => {
    const res = await admin.delete(`/products/${productId}`);
    expect(res.status).toBe(204);

    const read = await admin.get(`/products/${productId}`);
    expect(read.body.active).toBe(false);
  });
});
