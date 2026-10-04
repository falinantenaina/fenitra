import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { login, adminToken, app, as, tokenFor, API } from './helpers';

const stamp = Date.now();

describe('Couverture des routes de surface (aucune autre suite ne les touche)', () => {
  it('GET /health — santé du service, hors préfixe /api', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.env).toBe('string');
    expect(Number.isNaN(Date.parse(res.body.time))).toBe(false);
  });

  it("GET /api/ — catalogue des points d'entrée", async () => {
    const res = await request(app).get(`${API}/`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('gestion-vente-api');
    expect(res.body.version).toBe('1.0.0');
    expect(Array.isArray(res.body.endpoints)).toBe(true);
    expect(res.body.endpoints).toContain('/api/sales');
    expect(res.body.endpoints).toContain('/api/reports');
    expect(res.body.endpoints).toContain('/api/health');
  });

  it('GET /api/auth/sessions — 401 anonyme, liste des sessions sinon', async () => {
    expect((await request(app).get(`${API}/auth/sessions`)).status).toBe(401);

    const token = await tokenFor(`sessions-${stamp}@test.local`, 'Sessions', 'CASHIER');
    const res = await as(token).get('/auth/sessions');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('createdAt');
    expect(res.body[0]).not.toHaveProperty('token');
  });

  it('POST /api/auth/logout-all — 401 anonyme, révocation effective sinon', async () => {
    expect((await request(app).post(`${API}/auth/logout-all`)).status).toBe(401);

    const token = await tokenFor(`logout-${stamp}@test.local`, 'Logout All', 'CASHIER');
    const res = await as(token).post('/auth/logout-all');
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBeGreaterThanOrEqual(1);

    // Toutes les sessions de l'utilisateur sont révoquées.
    expect((await as(token).get('/auth/sessions')).body).toHaveLength(0);
  });

  it('GET /api/users/roles — 401 anonyme, 403 caissier, 200 admin', async () => {
    expect((await request(app).get(`${API}/users/roles`)).status).toBe(401);

    const cashier = await tokenFor(`roles-cashier-${stamp}@test.local`, 'Roles Cashier', 'CASHIER');
    expect((await as(cashier).get('/users/roles')).status).toBe(403);

    const res = await as(await adminToken()).get('/users/roles');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.arrayContaining(['ADMIN', 'MANAGER', 'CASHIER']));
  });

  it('POST /api/users/me/password — validation, ancien mot de passe faux, succès', async () => {
    const admin = await adminToken();
    const created = await as(admin)
      .post('/users')
      .send({
        email: `selfpwd-${stamp}@test.local`,
        name: 'Auto-mot-de-passe',
        password: 'motdepasse1',
        role: 'CASHIER',
      });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const token = await login(created.body.email, 'motdepasse1');

    // Payload invalide (moins de 8 caractères).
    const invalid = await as(token)
      .post('/users/me/password')
      .send({ currentPassword: 'motdepasse1', newPassword: 'court' });
    expect(invalid.status).toBe(400);

    // Ancien mot de passe incorrect → conflit, mot de passe inchangé.
    const wrong = await as(token)
      .post('/users/me/password')
      .send({ currentPassword: 'fauxmotdepasse', newPassword: 'nouveaumdp1' });
    expect(wrong.status).toBe(409);
    expect((await login(created.body.email, 'motdepasse1'))).toBeTruthy();

    // Succès → révocation des sessions, connexion avec le nouveau mot de passe.
    const ok = await as(token)
      .post('/users/me/password')
      .send({ currentPassword: 'motdepasse1', newPassword: 'nouveaumdp1' });
    expect(ok.status).toBe(204);
    expect(await login(created.body.email, 'nouveaumdp1')).toBeTruthy();
    await expect(login(created.body.email, 'motdepasse1')).rejects.toThrow();

    // Remise à zéro via la réinitialisation administrateur.
    const reset = await as(admin)
      .post(`/users/${id}/password`)
      .send({ newPassword: 'motdepasse1' });
    expect(reset.status).toBe(204);
    expect(await login(created.body.email, 'motdepasse1')).toBeTruthy();
  });

  it('POST /api/users/:id/password — droits et 404', async () => {
    const admin = await adminToken();

    expect(
      (await request(app).post(`${API}/users/inexistant/password`).send({ newPassword: 'motdepasse1' }))
        .status,
    ).toBe(401);

    const cashier = await tokenFor(`reset-cashier-${stamp}@test.local`, 'Reset Cashier', 'CASHIER');
    expect(
      (await as(cashier).post('/users/inexistant/password').send({ newPassword: 'motdepasse1' })).status,
    ).toBe(403);

    expect(
      (await as(admin).post('/users/inexistant/password').send({ newPassword: 'motdepasse1' })).status,
    ).toBe(404);

    expect(
      (await as(admin).post('/users/inexistant/password').send({ newPassword: 'court' })).status,
    ).toBe(400);
  });
});
