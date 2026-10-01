import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();
const API = '/api';

const ADMIN = { email: 'admin@test.local', password: 'admin1234' };

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string; role: string };
}

let cashierToken = '';

describe('POST /api/auth/login', () => {
  it('accepte les identifiants valides et renvoie les deux jetons', async () => {
    const res = await request(app).post(`${API}/auth/login`).send(ADMIN);
    expect(res.status).toBe(200);
    const body = res.body as TokenResponse;
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.user.email).toBe(ADMIN.email);
    expect(body.user.role).toBe('ADMIN');
  });

  it('rejette un mauvais mot de passe (401)', async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: ADMIN.email, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejette un email inconnu avec le même message (pas d\'énumération)', async () => {
    const res = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: 'inconnu@test.local', password: 'nimporte-quoi' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Email ou mot de passe incorrect');
  });

  it('valide le corps de la requête (400)', async () => {
    const res = await request(app).post(`${API}/auth/login`).send({ email: 'pas-un-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.error.details)).toBe(true);
  });
});

describe('GET /api/auth/me — protection des routes', () => {
  it('refuse sans jeton (401)', async () => {
    const res = await request(app).get(`${API}/auth/me`);
    expect(res.status).toBe(401);
  });

  it('refuse un jeton falsifié (401)', async () => {
    const res = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.fake.signature');
    expect(res.status).toBe(401);
  });

  it('accepte un jeton valide', async () => {
    const login = await request(app).post(`${API}/auth/login`).send(ADMIN);
    const { accessToken } = login.body as TokenResponse;

    const res = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(ADMIN.email);
  });
});

describe('cycle de session : refresh + logout', () => {
  let refreshToken = '';

  beforeAll(async () => {
    const login = await request(app).post(`${API}/auth/login`).send(ADMIN);
    refreshToken = (login.body as TokenResponse).refreshToken;
  });

  it('rafraîchit le jeton et fait tourner le refresh token', async () => {
    const res = await request(app).post(`${API}/auth/refresh`).send({ refreshToken });
    expect(res.status).toBe(200);
    const next = res.body as TokenResponse;
    expect(next.refreshToken).not.toBe(refreshToken);
    expect(next.accessToken).toBeTruthy();

    // L'ancien refresh token ne doit plus marcher (rotation).
    const replay = await request(app).post(`${API}/auth/refresh`).send({ refreshToken });
    expect(replay.status).toBe(401);

    refreshToken = next.refreshToken;
  });

  it('révoque la session au logout', async () => {
    const res = await request(app).post(`${API}/auth/logout`).send({ refreshToken });
    expect(res.status).toBe(204);

    const replay = await request(app).post(`${API}/auth/refresh`).send({ refreshToken });
    expect(replay.status).toBe(401);
  });
});

describe('POST /api/users — RBAC (§57)', () => {
  const suffix = Date.now();

  it('un ADMIN crée un utilisateur', async () => {
    const login = await request(app).post(`${API}/auth/login`).send(ADMIN);
    const adminToken = (login.body as TokenResponse).accessToken;

    const res = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: `caissier-${suffix}@test.local`,
        name: 'Caissier Test',
        password: 'caissier1234',
        role: 'CASHIER',
      });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('CASHIER');
  });

  it('refuse un doublon d\'email (409)', async () => {
    const login = await request(app).post(`${API}/auth/login`).send(ADMIN);
    const adminToken = (login.body as TokenResponse).accessToken;

    const res = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: `caissier-${suffix}@test.local`,
        name: 'Doublon',
        password: 'caissier1234',
        role: 'CASHIER',
      });

    expect(res.status).toBe(409);
  });

  it('un CASHIER ne peut pas lister les utilisateurs (403)', async () => {
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: `caissier-${suffix}@test.local`, password: 'caissier1234' });
    expect(login.status).toBe(200);
    cashierToken = (login.body as TokenResponse).accessToken;

    const res = await request(app)
      .get(`${API}/users`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('un CASHIER ne peut pas créer d\'utilisateur (403)', async () => {
    const res = await request(app)
      .post(`${API}/users`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({ email: 'x@test.local', name: 'X', password: '12345678', role: 'ADMIN' });
    expect(res.status).toBe(403);
  });

  it('un compte désactivé perd immédiatement l\'accès (401)', async () => {
    const login = await request(app).post(`${API}/auth/login`).send(ADMIN);
    const adminToken = (login.body as TokenResponse).accessToken;

    const users = await request(app)
      .get(`${API}/users`)
      .set('Authorization', `Bearer ${adminToken}`);
    const target = (users.body as { email: string; id: string }[]).find(
      (u) => u.email === `caissier-${suffix}@test.local`,
    );
    expect(target).toBeDefined();

    await request(app)
      .patch(`${API}/users/${target!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });

    const res = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${cashierToken}`);
    expect(res.status).toBe(401);
  });
});
