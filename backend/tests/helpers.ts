import request from 'supertest';
import { createApp } from '../src/app';

export const app = createApp();
export const API = '/api';

export const ADMIN = { email: 'admin@test.local', password: 'admin1234' };

export async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post(`${API}/auth/login`).send({ email, password });
  if (res.status !== 200) {
    throw new Error(`Échec de connexion ${res.status} : ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken as string;
}

export const adminToken = (): Promise<string> => login(ADMIN.email, ADMIN.password);

/** Crée (si nécessaire) un utilisateur et renvoie son jeton. */
export async function tokenFor(email: string, name: string, role: 'ADMIN' | 'MANAGER' | 'CASHIER'): Promise<string> {
  const admin = await adminToken();
  const created = await request(app)
    .post(`${API}/users`)
    .set('Authorization', `Bearer ${admin}`)
    .send({ email, name, password: 'motdepasse1', role });
  if (created.status !== 201 && created.status !== 409) {
    throw new Error(`Création utilisateur ${created.status} : ${JSON.stringify(created.body)}`);
  }
  return login(email, 'motdepasse1');
}

export interface AuthedRequest {
  get(url: string): request.Test;
  post(url: string): request.Test;
  put(url: string): request.Test;
  patch(url: string): request.Test;
  delete(url: string): request.Test;
}

/** Petit wrapper : ajoute le header Authorization à chaque requête. */
export const as = (token: string): AuthedRequest => ({
  get: (url) => request(app).get(`${API}${url}`).set('Authorization', `Bearer ${token}`),
  post: (url) => request(app).post(`${API}${url}`).set('Authorization', `Bearer ${token}`),
  put: (url) => request(app).put(`${API}${url}`).set('Authorization', `Bearer ${token}`),
  patch: (url) => request(app).patch(`${API}${url}`).set('Authorization', `Bearer ${token}`),
  delete: (url) => request(app).delete(`${API}${url}`).set('Authorization', `Bearer ${token}`),
});
