import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminToken, app, API, as, tokenFor, type AuthedRequest } from './helpers';

const stamp = Date.now();

let admin: AuthedRequest;
let cashier: AuthedRequest;

describe('Référentiels et réglages', () => {
  beforeAll(async () => {
    admin = as(await adminToken());
    cashier = as(await tokenFor(`caissier-settings-${stamp}@test.local`, 'Caissier Réglages', 'CASHIER'));
  });

  it('GET /api/health est public', async () => {
    const res = await request(app).get(`${API}/health`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });

  it('GET /api/settings exige une authentification', async () => {
    const res = await request(app).get(`${API}/settings`);
    expect(res.status).toBe(401);
  });

  it('PUT /api/settings fusionne les clés', async () => {
    const put = await admin.put('/settings').send({
      devise: 'Ar',
      localisation: 'Antananarivo',
      [`cle_test_${stamp}`]: 'valeur',
    });
    expect(put.status).toBe(200);
    expect(put.body.devise).toBe('Ar');

    const get = await admin.get('/settings');
    expect(get.status).toBe(200);
    expect(get.body.localisation).toBe('Antananarivo');
    expect(get.body[`cle_test_${stamp}`]).toBe('valeur');
  });

  it('refuse un réglage vide (400)', async () => {
    const res = await admin.put('/settings').send({});
    expect(res.status).toBe(400);
  });

  it('interdit la modification des réglages à un caissier (403)', async () => {
    const res = await cashier.put('/settings').send({ devise: 'EUR' });
    expect(res.status).toBe(403);
  });

  it('liste les catégories de dépenses du seed', async () => {
    const res = await admin.get('/expense-categories');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(6);
    expect(res.body.items.some((c: { name: string }) => c.name === 'Transport')).toBe(true);
  });

  it('crée une catégorie puis refuse le doublon', async () => {
    const name = `Catégorie Test ${stamp}`;
    const created = await admin.post('/expense-categories').send({ name, icon: 'box' });
    expect(created.status).toBe(201);
    expect(created.body.active).toBe(true);

    const duplicate = await admin.post('/expense-categories').send({ name });
    expect(duplicate.status).toBe(409);
  });

  it('désactive une catégorie sans la supprimer (§36)', async () => {
    const name = `À désactiver ${stamp}`;
    const created = await admin.post('/expense-categories').send({ name });
    const id = created.body.id;

    const disabled = await admin.put(`/expense-categories/${id}`).send({ active: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.active).toBe(false);

    const activeList = await admin.get('/expense-categories?active=true');
    expect(activeList.body.items.some((c: { id: string }) => c.id === id)).toBe(false);

    const all = await admin.get('/expense-categories?active=false');
    expect(all.body.items.some((c: { id: string }) => c.id === id)).toBe(true);
  });

  it('liste les modes de paiement du seed', async () => {
    const res = await admin.get('/payment-methods');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(4);
    expect(res.body.items.some((m: { name: string }) => m.name === 'Espèces')).toBe(true);
  });

  it('crée un mode de paiement, refuse le doublon, le désactive', async () => {
    const name = `Mode Test ${stamp}`;
    const created = await admin.post('/payment-methods').send({ name });
    expect(created.status).toBe(201);

    const duplicate = await admin.post('/payment-methods').send({ name });
    expect(duplicate.status).toBe(409);

    const disabled = await admin.patch(`/payment-methods/${created.body.id}`).send({ active: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.active).toBe(false);
  });

  it('404 sur une catégorie inconnue', async () => {
    const res = await admin.put('/expense-categories/id-inconnu').send({ active: false });
    expect(res.status).toBe(404);
  });
});
