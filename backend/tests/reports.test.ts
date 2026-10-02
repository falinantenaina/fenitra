import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Response } from 'superagent';
import { adminToken, app, as, API, type AuthedRequest } from './helpers';
import { accountingIdentity, identityBalance } from './identity';
import { buildPdf } from '../src/modules/reports/reports.service';

const stamp = Date.now();
const WIDE = 'period=custom&from=2020-01-01&to=2100-12-31';

let admin: AuthedRequest;

describe('Journal, dashboard et rapports', () => {
  beforeAll(async () => {
    admin = as(await adminToken());

    // Le fichier peut être le premier exécuté : il crée son propre jeu de
    // données pour ne dépendre d'aucune autre suite.
    const [supplier, product, category] = await Promise.all([
      admin.post('/suppliers').send({ name: `Fournisseur Rapports ${stamp}` }),
      admin.post('/products').send({ name: `Modèle Rapport ${stamp}` }),
      // Catégorie dédiée : `items[0]` d'une liste partagée peut être une
      // catégorie temporaire qu'un autre fichier désactive en parallèle.
      admin.post('/expense-categories').send({ name: `Rapports ${stamp}`, icon: 'stats-chart' }),
    ]);
    if (category.status !== 201) {
      throw new Error(`Catégorie Rapports ${category.status}: ${JSON.stringify(category.body)}`);
    }
    const sizes = await admin.get('/sizes?limit=100');
    const size40 = sizes.body.items.find((s: { value: number }) => s.value === 40);

    const variant = await admin
      .post('/variants')
      .send({ productId: product.body.id, sizeId: size40.id, sellingPrice: 60000 });

    await admin.post('/arrivals').send({
      supplierId: supplier.body.id,
      cartons: [{ items: [{ variantId: variant.body.id, quantity: 4, unitCost: 30000 }] }],
    });

    const sale = await admin.post('/sales').send({
      items: [{ variantId: variant.body.id, quantity: 2, unitPrice: 60000 }],
      payment: { amount: 120000, method: 'Espèces' },
    });
    if (sale.status !== 201) throw new Error(`Amorçage vente ${sale.status}: ${JSON.stringify(sale.body)}`);

    const expense = await admin.post('/expenses').send({
      categoryId: category.body.id,
      amount: 4000,
      description: `Frais de rapport ${stamp}`,
    });
    if (expense.status !== 201) {
      throw new Error(`Amorçage dépense ${expense.status}: ${JSON.stringify(expense.body)}`);
    }
  });

  it('refuse l\'accès sans jeton', async () => {
    const res = await request(app).get(`${API}/dashboard`);
    expect(res.status).toBe(401);
  });

  it('liste le journal financier (§39)', async () => {
    const res = await admin.get(`/ledger?limit=20`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body).toMatchObject({ page: 1, limit: 20 });
    expect(res.body.items[0]).toHaveProperty('kind');
    expect(res.body.items[0]).toHaveProperty('cashDelta');
    expect(res.body.items[0].amount).toMatch(/^-?\d+\.\d{2}$/);

    const sales = await admin.get('/ledger?kind=SALE&limit=50');
    expect(sales.status).toBe(200);
    expect(sales.body.items.every((e: { kind: string }) => e.kind === 'SALE')).toBe(true);

    const cashOnly = await admin.get('/ledger?cash=true&limit=50');
    expect(cashOnly.body.items.every((e: { cashDelta: string }) => Number(e.cashDelta) !== 0)).toBe(true);

    const search = await admin.get('/ledger?q=marchandises&limit=50');
    expect(search.status).toBe(200);
  });

  it('résume le journal par type d\'écriture', async () => {
    const res = await admin.get(`/ledger/summary?${WIDE}`);
    expect(res.status).toBe(200);
    expect(res.body.byKind.length).toBeGreaterThan(0);
    expect(res.body.totals.count).toBeGreaterThan(0);
    expect(res.body.totals.cashDelta).toMatch(/^-?\d+\.\d{2}$/);

    const saleLine = res.body.byKind.find((k: { kind: string }) => k.kind === 'SALE');
    expect(saleLine).toBeDefined();
    expect(Number(saleLine.amount)).toBeGreaterThan(0);
  });

  it('expose le dashboard avec des montants en string et l\'intégrité à 0', async () => {
    const res = await admin.get(`/dashboard?${WIDE}`);
    expect(res.status).toBe(200);

    const b = res.body;
    expect(b.period).toHaveProperty('key');
    expect(b.activity.ca).toMatch(/^\d+\.\d{2}$/);
    expect(b.activity.netProfit).toMatch(/^-?\d+\.\d{2}$/);
    expect(b.money.cash).toMatch(/^-?\d+\.\d{2}$/);
    expect(b.money).toHaveProperty('workingCapital');
    expect(b.money).toHaveProperty('payable');
    expect(b.debts.customer).toMatch(/^\d+\.\d{2}$/);
    expect(b.stock).toHaveProperty('availableItems');
    expect(b.meta).toMatchObject({ currency: 'MGA' });

    expect(b.integrity.ok).toBe(true);
    expect(b.integrity.identityDelta).toBe(0);
  });

  it('accepte les périodes nommées', async () => {
    for (const period of ['today', 'yesterday', 'week', 'month', 'prevMonth', 'year', 'last7d']) {
      const res = await admin.get(`/dashboard?period=${period}`);
      expect(res.status, period).toBe(200);
      expect(res.body.period.key, period).toBe(period);
    }

    const bad = await admin.get('/dashboard?period=inconnu');
    expect(bad.status).toBe(400);
  });

  it('dérille un indicateur vers ses écritures (§62)', async () => {
    const res = await admin.get(`/dashboard/ca/transactions?${WIDE}`);
    expect(res.status).toBe(200);
    expect(res.body.indicator).toBe('ca');
    expect(res.body.entries.every((e: { kind: string }) => e.kind === 'SALE')).toBe(true);
    expect(Number(res.body.total)).toBeGreaterThan(0);
    expect(res.body.count).toBe(res.body.entries.length);

    const all = await admin.get(`/ledger?kind=SALE&${WIDE}&limit=200`);
    expect(res.body.count).toBe(all.body.total);

    const unknown = await admin.get('/dashboard/chuck-norris/transactions');
    expect(unknown.status).toBe(400);

    const indicators = await admin.get('/dashboard/indicators');
    expect(indicators.status).toBe(200);
    expect(indicators.body.items.length).toBeGreaterThan(5);
  });

  it('retombe exactement sur le dashboard pour chaque indicateur dérillable (§62)', async () => {
    const dash = await admin.get(`/dashboard?${WIDE}`);
    expect(dash.status).toBe(200);

    // `capital` et `profitDrawings` n'ont pas d'équivalent de période au
    // dashboard (cumulés depuis l'origine) : ils sont exclus de la comparaison.
    const expected: Record<string, string> = {
      ca: dash.body.activity.ca,
      cogs: dash.body.activity.cogs,
      grossProfit: dash.body.activity.grossProfit,
      netProfit: dash.body.activity.netProfit,
      receipts: dash.body.activity.receipts,
      expenses: dash.body.activity.expenses,
      versements: dash.body.activity.versementCharges,
      cash: dash.body.money.cashDelta,
    };

    for (const [indicator, displayed] of Object.entries(expected)) {
      const drill = await admin.get(`/dashboard/${indicator}/transactions?${WIDE}`);
      expect(drill.status, indicator).toBe(200);
      expect(
        Number(drill.body.total),
        `${indicator} : total du dérillage ≠ valeur affichée au dashboard`,
      ).toBeCloseTo(Number(displayed), 2);
    }
  });

  it('produit le rapport journalier', async () => {
    const res = await admin.get('/reports/daily');
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('daily');
    expect(res.body).toHaveProperty('activity');
    expect(res.body).toHaveProperty('topProducts');
    expect(res.body).toHaveProperty('expensesByCategory');
    expect(Array.isArray(res.body.sales)).toBe(true);

    const explicit = await admin.get('/reports/daily?date=2026-09-30');
    expect(explicit.status).toBe(200);
    expect(explicit.body.date).toBe('2026-09-30');

    const invalid = await admin.get('/reports/daily?date=30-09-2026');
    expect(invalid.status).toBe(400);
  });

  it('produit le rapport mensuel', async () => {
    const res = await admin.get('/reports/monthly?year=2026&month=10');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: 'monthly', year: 2026, month: 10 });
    expect(res.body.topProducts.length).toBeGreaterThan(0);

    const missingYear = await admin.get('/reports/export.pdf?type=monthly');
    expect(missingYear.status).toBe(400);
  });

  it('exporte un PDF valide et le rapport JSON', async () => {
    const json = await admin.get('/reports/export.pdf?type=daily&download=json');
    expect(json.status).toBe(200);
    expect(json.body.filename).toMatch(/^rapport-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(json.body.report.activity).toHaveProperty('ca');

    const pdf = await admin
      .get('/reports/export.pdf?type=monthly&year=2026&month=10')
      .buffer(true)
      .parse((res: Response, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const buf = pdf.body as Buffer;
    expect(buf.length).toBeGreaterThan(200);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('génère un PDF paginé même avec beaucoup de lignes', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `Ligne ${i} — dépense (test)`);
    const buf = buildPdf('Test', lines);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.toString('latin1')).toContain('/Count 3');
    expect(buf.toString('latin1')).toContain('%%EOF');
  });

  it('identité comptable confirmée par le dashboard', async () => {
    const snapshot = await accountingIdentity();
    const { lhs, rhs, delta } = identityBalance(snapshot);

    expect(delta).toBe(0);
    expect(lhs).toBe(rhs);
    expect(snapshot.lots).toBeGreaterThan(0);
  });
});
