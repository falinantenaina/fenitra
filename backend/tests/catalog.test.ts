import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminToken, API, app, as, carton, tokenFor, type AuthedRequest } from './helpers';

const stamp = Date.now();

let admin: AuthedRequest;
let cashier: AuthedRequest;
let productId = '';
let bulkProductId = '';
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

  it('liste les pointures de référence', async () => {
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
    const used = sizes.body.items.find((s: { value: number }) => s.value === 46);
    expect(used).toBeDefined();

    const res = await admin.delete(`/sizes/${used.id}`);
    expect(res.status).toBe(409);
  });

  it('interdit la création d\'un produit à un caissier (403)', async () => {
    const res = await cashier.post('/products').send({ name: 'Interdit' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('crée des variantes en bloc par pointures (saisie rapide)', async () => {
    const product = await admin.post('/products').send({ name: 'Bulk Models' });
    expect(product.status).toBe(201);
    bulkProductId = product.body.id;

    // 40 existe déjà (référentiel), 47 / 48 sont créées à la volée, 47 en doublon dans la requête.
    const res = await admin
      .post(`/products/${bulkProductId}/variants`)
      .send({ sizeValues: [47, 40, 47, 48], sellingPrice: 50000 });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(3);
    expect(res.body.skipped).toBe(0);
    expect(res.body.variants.map((v: { size: { value: number } }) => v.size.value)).toEqual([40, 47, 48]);
    expect(res.body.variants[0].sellingPrice).toBe('50000.00');

    const sizes = await admin.get('/sizes?limit=100');
    expect(sizes.body.items.some((s: { value: number }) => s.value === 48)).toBe(true);
  });

  it('ignore les pointures déjà pourvues et refuse un appel sans nouvelle pointure', async () => {
    const partial = await admin.post(`/products/${bulkProductId}/variants`).send({ sizeValues: [40, 41] });
    expect(partial.status).toBe(201);
    expect(partial.body.created).toBe(1);
    expect(partial.body.skipped).toBe(1);

    const again = await admin.post(`/products/${bulkProductId}/variants`).send({ sizeValues: [40, 41] });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain('déjà pourvues');

    const empty = await admin.post(`/products/${bulkProductId}/variants`).send({ sizeValues: [] });
    expect(empty.status).toBe(400);
  });

  it('réactive une pointure désactivée du modèle au lieu de la refuser', async () => {
    const read = await admin.get(`/products/${bulkProductId}`);
    const variant41 = read.body.variants.find(
      (v: { size: { value: number } }) => v.size.value === 41,
    );
    expect(variant41).toBeDefined();

    const off = await admin.put(`/variants/${variant41.id}`).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);

    const afterOff = await admin.get(`/products/${bulkProductId}`);
    expect(
      afterOff.body.variants.find((v: { size: { value: number } }) => v.size.value === 41).active,
    ).toBe(false);

    const res = await admin.post(`/products/${bulkProductId}/variants`).send({ sizeValues: [41] });
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(0);
    expect(res.body.reactivated).toBe(1);
    expect(res.body.skipped).toBe(0);

    const restored = await admin.get(`/products/${bulkProductId}`);
    expect(
      restored.body.variants.find((v: { size: { value: number } }) => v.size.value === 41).active,
    ).toBe(true);
  });

  it('refuse la création en bloc sur un produit inconnu (404) ou à un caissier (403)', async () => {
    const missing = await admin.post('/products/produit-inexistant/variants').send({ sizeValues: [40] });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');

    const forbidden = await cashier.post(`/products/${bulkProductId}/variants`).send({ sizeValues: [42] });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });

  it('inStock=true ne retourne que les pointures vendables (recherche de vente)', async () => {
    const supplier = await admin.post('/suppliers').send({ name: `Fournisseur Stock ${stamp}` });
    expect(supplier.status).toBe(201);

    const name = `Modèle Rupture ${stamp}`;
    const product = await admin.post('/products').send({ name });
    expect(product.status).toBe(201);

    const sizes = await admin.get('/sizes?limit=100');
    const size40 = sizes.body.items.find((s: { value: number }) => s.value === 40);
    const size41 = sizes.body.items.find((s: { value: number }) => s.value === 41);

    const stocked = await admin
      .post('/variants')
      .send({ productId: product.body.id, sizeId: size40.id, sellingPrice: 30000 });
    const empty = await admin
      .post('/variants')
      .send({ productId: product.body.id, sizeId: size41.id, sellingPrice: 30000 });
    expect(stocked.status).toBe(201);
    expect(empty.status).toBe(201);

    const arrival = await admin.post('/arrivals').send({
      supplierId: supplier.body.id,
      cartons: [carton(product.body.id, size40.id, 7, 10000)],
    });
    expect(arrival.status).toBe(201);

    const q = encodeURIComponent(name);

    const all = await admin.get(`/variants?q=${q}`);
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(2);
    expect(all.body.items.find((v: { id: string }) => v.id === stocked.body.id).stock).toBe(7);
    expect(all.body.items.find((v: { id: string }) => v.id === empty.body.id).stock).toBe(0);

    const inStock = await admin.get(`/variants?q=${q}&inStock=true`);
    expect(inStock.status).toBe(200);
    expect(inStock.body.items).toHaveLength(1);
    expect(inStock.body.items[0].id).toBe(stocked.body.id);

    // Épuisé par une vente : la pointure disparaît de la recherche de vente.
    const sold = await admin.post('/sales').send({
      items: [{ variantId: stocked.body.id, quantity: 7, unitPrice: 30000 }],
      payment: { amount: 210000, method: 'Espèces' },
    });
    expect(sold.status).toBe(201);

    const after = await admin.get(`/variants?q=${q}&inStock=true`);
    expect(after.status).toBe(200);
    expect(after.body.items).toHaveLength(0);
  });

  it('désactive un produit (DELETE = suppression douce)', async () => {
    const res = await admin.delete(`/products/${productId}`);
    expect(res.status).toBe(204);

    const read = await admin.get(`/products/${productId}`);
    expect(read.body.active).toBe(false);
  });

  it('refuse la création en bloc sur un produit désactivé (409)', async () => {
    const res = await admin.post(`/products/${productId}/variants`).send({ sizeValues: [40] });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('désactivé');
  });
});
