import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { adminToken, app, as, tokenFor, type AuthedRequest } from './helpers';
import { prisma } from '../src/lib/prisma';
import { accountingIdentity, identityBalance } from './identity';

const stamp = Date.now();

let admin: AuthedRequest;
let cashier: AuthedRequest;
let manager: AuthedRequest;

const num = (v: unknown): number => Number(v);

async function drill(indicator: string) {
  const res = await admin.get(`/dashboard/${indicator}/transactions?period=today`);
  if (res.status !== 200) throw new Error(`dérillage ${indicator} ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body as {
    entries: { id: string; kind: string; amount: string; cashDelta: string; description: string }[];
  };
}

/**
 * A16 — bénéfice hors stock : montant + description facultative, sans vente ni
 * article. Le tests tourne en parallèle des autres fichiers : on n'asserte que
 * des écritures nominatives (par id), le dérillage qui les contient et
 * l'identité comptable — jamais d'écart global d'indicateur.
 */
describe('Bénéfice hors stock (A16)', () => {
  beforeAll(async () => {
    admin = as(await adminToken());
    cashier = as(await tokenFor(`caissier-gain-${stamp}@test.local`, 'Caissier Gain', 'CASHIER'));
    manager = as(await tokenFor(`manager-gain-${stamp}@test.local`, 'Manager Gain', 'MANAGER'));
  });

  it("écrit une entrée de journal SALE sans vente ni article, description par défaut", async () => {
    const res = await admin.post('/profits').send({ amount: 250_000 });
    expect(res.status).toBe(201);
    expect(res.body.description).toBe('Bénéfice hors stock');
    expect(num(res.body.amount)).toBe(250_000);
    expect(num(res.body.cashDelta)).toBe(250_000);

    const entry = await prisma.ledgerEntry.findUnique({ where: { id: res.body.id as string } });
    expect(entry).not.toBeNull();
    expect(entry!.kind).toBe('SALE');
    expect(entry!.amount).toBe(250_000);
    expect(entry!.cashDelta).toBe(250_000);
    expect(entry!.description).toBe('Bénéfice hors stock');
    expect(entry!.refType).toBeNull();
    expect(entry!.refId).toBeNull();
    expect(entry!.saleId).toBeNull();
    expect(entry!.userId).not.toBeNull();
  });

  it('apparaît dans le dérillage CA, argent reçu, bénéfice brut, bénéfice net et caisse', async () => {
    const res = await admin
      .post('/profits')
      .send({ amount: 120_000, description: 'Vente hors stock — modèle B12' });
    expect(res.status).toBe(201);
    const gainId = res.body.id as string;

    for (const indicator of ['ca', 'receipts', 'grossProfit', 'netProfit', 'cash'] as const) {
      const rows = await drill(indicator);
      const row = rows.entries.find((e) => e.id === gainId);
      expect(row, `dérillage ${indicator}`).toBeDefined();
      expect(row!.kind).toBe('SALE');
      expect(row!.description).toBe('Vente hors stock — modèle B12');
      expect(num(row!.amount)).toBe(120_000);
      expect(num(row!.cashDelta)).toBe(120_000);
    }
  });

  it("respecte l'identité comptable (§8.3)", async () => {
    expect(identityBalance(await accountingIdentity()).delta).toBe(0);
  });

  it('le caissier peut ajouter un bénéfice (A16)', async () => {
    const res = await cashier.post('/profits').send({ amount: 50_000, description: 'Vente rapide' });
    expect(res.status).toBe(201);
    expect(num(res.body.amount)).toBe(50_000);
  });

  it('le manager peut ajouter un bénéfice', async () => {
    const res = await manager.post('/profits').send({ amount: 75_000 });
    expect(res.status).toBe(201);
  });

  it('exige une authentification', async () => {
    const res = await request(app).post('/api/profits').send({ amount: 1_000 });
    expect(res.status).toBe(401);
  });

  it('refuse un montant ou une description invalide (400)', async () => {
    expect((await admin.post('/profits').send({ amount: 0 })).status).toBe(400);
    expect((await admin.post('/profits').send({ amount: -5 })).status).toBe(400);
    expect((await admin.post('/profits').send({ amount: 12.5 })).status).toBe(400);
    expect((await admin.post('/profits').send({ amount: 1_000 })).status).toBe(201);
    expect(
      (await admin.post('/profits').send({ amount: 1_000, description: 'x'.repeat(301) })).status,
    ).toBe(400);
    expect(
      (await admin.post('/profits').send({ amount: 1_000, description: 'ab' })).status,
    ).toBe(400);
  });
});
