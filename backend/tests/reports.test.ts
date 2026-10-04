import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Response } from 'supertest';
import { adminToken, app, as, API, type AuthedRequest } from './helpers';
import { accountingIdentity, identityBalance } from './identity';
import { buildPdf } from '../src/modules/reports/reports.service';
import {
  disposableDrillRows,
  sumBalance,
  type CompositeParts,
  type DrillRow,
} from '../src/services/metrics';

const stamp = Date.now();
const WIDE = 'period=custom&from=2020-01-01&to=2100-12-31';
/** Fenêtre fermée : rien d'autre que ce fichier n'y écrit (voir test §62). */
const SEALED = 'period=custom&from=2099-06-01&to=2099-06-30';
const SEALED_DAY = '2099-06-15';

let admin: AuthedRequest;
let categoryId: string;
let variantId: string;

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
    categoryId = category.body.id;
    variantId = variant.body.id;

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
    // Les fichiers de test tournent en parallèle sur la même base et la
    // fenêtre est large : on encadre la lecture du dérillage par deux lectures
    // du journal, dont le total ne fait que croître (les annulations ajoutent
    // des lignes, elles n'en suppriment jamais).
    const ledgerBefore = await admin.get(`/ledger?kind=SALE&${WIDE}&limit=200`);

    const res = await admin.get(`/dashboard/ca/transactions?${WIDE}`);
    expect(res.status).toBe(200);
    expect(res.body.indicator).toBe('ca');
    expect(res.body.entries.every((e: { kind: string }) => e.kind === 'SALE')).toBe(true);
    expect(Number(res.body.total)).toBeGreaterThan(0);
    expect(res.body.count).toBe(res.body.entries.length);

    const ledgerAfter = await admin.get(`/ledger?kind=SALE&${WIDE}&limit=200`);
    expect(ledgerBefore.body.total).toBeLessThanOrEqual(res.body.count);
    expect(res.body.count).toBeLessThanOrEqual(ledgerAfter.body.total);

    const unknown = await admin.get('/dashboard/chuck-norris/transactions');
    expect(unknown.status).toBe(400);

    const indicators = await admin.get('/dashboard/indicators');
    expect(indicators.status).toBe(200);
    expect(indicators.body.items.length).toBeGreaterThan(5);
  });

  it('retombe exactement sur le dashboard pour chaque indicateur dérillable (§62)', async () => {
    // Toutes les autres suites écrivent « aujourd'hui » : comparées dans une
    // large période, deux lectures successives (dashboard puis dérillage) peuvent
    // voir des écritures différentes. On isole donc une fenêtre close en 2099,
    // remplie ici et par personne d'autre.
    const [sale, expense, versement] = await Promise.all([
      admin.post('/sales').send({
        date: SEALED_DAY,
        items: [{ variantId, quantity: 1, unitPrice: 60000 }],
        payment: { amount: 60000, method: 'Espèces' },
      }),
      admin.post('/expenses').send({
        categoryId,
        amount: 4000,
        date: SEALED_DAY,
        description: `Fenêtre §62 ${stamp}`,
      }),
      admin.post('/versements').send({
        personName: `Versement §62 ${stamp}`,
        amount: 2000,
        date: SEALED_DAY,
        motif: 'Dérillage des indicateurs',
      }),
    ]);
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(expense.status, JSON.stringify(expense.body)).toBe(201);
    expect(versement.status, JSON.stringify(versement.body)).toBe(201);

    const dash = await admin.get(`/dashboard?${SEALED}`);
    expect(dash.status).toBe(200);

    // Chaque indicateur doit être réellement renseigné dans la fenêtre.
    expect(Number(dash.body.activity.ca)).toBeGreaterThan(0);
    expect(Number(dash.body.activity.cogs)).toBeGreaterThan(0);
    expect(Number(dash.body.activity.expenses)).toBeGreaterThan(0);
    expect(Number(dash.body.activity.versementCharges)).toBeGreaterThan(0);

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
      const drill = await admin.get(`/dashboard/${indicator}/transactions?${SEALED}`);
      expect(drill.status, indicator).toBe(200);
      expect(
        Number(drill.body.total),
        `${indicator} : total du dérillage ≠ valeur affichée au dashboard`,
      ).toBeCloseTo(Number(displayed), 2);
    }
  });

  it('décompose le bénéfice disponible selon la contrainte qui le borne (§9)', () => {
    // Borne par l'excédent de caisse (cas courant) ou par le bénéfice net
    // cumulé : la branche ratée sortirait un total qui ne retombe pas sur la
    // carte du dashboard (§62, contrôle §16).
    const date = new Date('2099-06-30T00:00:00.000Z');
    const config = { openingCashBalance: 0, workingReserve: 0 };
    const row = (id: string, kind: string, amount: number, cashDelta = 0): DrillRow => ({
      id,
      seq: 0n,
      date,
      kind,
      amount,
      cashDelta,
      description: id,
      reference: null,
      refType: null,
      refId: null,
    });

    // Le journal est signé par `cashDelta` (une vente créditée n'a pas débité la
    // caisse) : caisse = 110 − 10 = 100 malgré des montants d'écriture distincts.
    const parts: CompositeParts = {
      cashRows: [row('sale', 'SALE', 999_999, 110), row('draw', 'PROFIT_DRAWING', 10, -10)],
      stockRows: [row('lot', 'LOT', 50)],
      receivableRows: [row('recv', 'CUSTOMER', 30)],
      payableRows: [row('pay', 'SUPPLIER', 20)],
    };
    const money = (disposableProfit: number) => ({
      cash: 100,
      payables: 20,
      personalCapitalEngaged: 40,
      disposableProfit,
    });

    // (a) excédent de caisse : 100 − 20 − 40 = 40 → ni stock ni créances dedans.
    const surplus = disposableDrillRows(money(40), config, date, parts);
    expect(sumBalance(surplus)).toBe(40);
    expect(surplus.map((r) => r.kind)).not.toContain('LOT');
    expect(surplus.some((r) => r.kind === 'CAPITAL')).toBe(true);

    // (b) bénéfice net cumulé : 100 + 50 + 30 − 20 − 40 + 10 = 130, et les
    // retraits (déjà déduits par la caisse) sont retirés pour ne pas doubler.
    const cumulative = disposableDrillRows(money(130), config, date, parts);
    expect(sumBalance(cumulative)).toBe(130);
    expect(cumulative.map((r) => r.kind)).toContain('LOT');
    expect(cumulative.map((r) => r.kind)).not.toContain('PROFIT_DRAWING');

    // (c) plancher à 0 : une seule ligne explicative, total nul.
    const floored = disposableDrillRows(money(0), config, date, parts);
    expect(sumBalance(floored)).toBe(0);
    expect(floored.map((r) => r.kind)).toEqual(['RULE']);
  });

  it('dérille les indicateurs d\'état vers leurs composantes (§62)', async () => {
    // Les indicateurs de flux sont scellés dans la fenêtre ci-dessus. Ceux-ci
    // sont des ÉTATS cumulés jusqu'à la date de fin : ils captent donc aussi les
    // écritures des autres fichiers de test, écrits en parallèle. Chaque
    // dérillage est encadré de deux lectures du dashboard — le total doit
    // retomber sur l'une des deux, ce qui autorise une écriture entre les deux
    // lectures mais jamais un total faux.
    const stateful: Record<string, (b: Record<string, any>) => number> = {
      cashBalance: (b) => Number(b.money.cash),
      receivables: (b) => Number(b.money.receivables),
      payables: (b) => Number(b.money.payable),
      debtsCustomer: (b) => Number(b.debts.customer),
      debtsOnlineSeller: (b) => Number(b.debts.onlineSeller),
      debtsSupplier: (b) => Number(b.debts.supplier),
      debtsTrosa: (b) => Number(b.debts.trosaSinoa),
      debtsTotal: (b) => Number(b.debts.total),
      stockValue: (b) => Number(b.stock.value),
      vola: (b) => Number(b.money.volaMiodina),
      disposableProfit: (b) => Number(b.money.disposableProfit),
      capital: (b) => Number(b.money.personalCapitalEngaged),
      profitDrawings: (b) => Number(b.money.profitDrawings),
    };

    const indicators = await admin.get('/dashboard/indicators');
    expect(indicators.status).toBe(200);
    const exposed = indicators.body.items.map((i: { key: string }) => i.key);
    for (const key of Object.keys(stateful)) expect(exposed).toContain(key);

    // Le stock est amorcé par ce fichier : sa valeur n'est jamais nulle.
    const seeded = await admin.get(`/dashboard?${SEALED}`);
    expect(Number(seeded.body.stock.value)).toBeGreaterThan(0);

    const close = (a: number, b: number) => Math.abs(a - b) < 0.01;

    for (const [indicator, pick] of Object.entries(stateful)) {
      let matched = false;
      let last = { before: NaN, drill: NaN, after: NaN };

      for (let attempt = 0; attempt < 3 && !matched; attempt += 1) {
        const before = await admin.get(`/dashboard?${SEALED}`);
        const drill = await admin.get(`/dashboard/${indicator}/transactions?${SEALED}`);
        const after = await admin.get(`/dashboard?${SEALED}`);

        expect(drill.status, indicator).toBe(200);
        expect(drill.body.scope, indicator).toBe('toDate');
        expect(drill.body.count, indicator).toBe(drill.body.entries.length);

        last = {
          before: pick(before.body),
          drill: Number(drill.body.total),
          after: pick(after.body),
        };
        matched = close(last.drill, last.before) || close(last.drill, last.after);
      }

      expect(matched, `${indicator} : dérillage ${JSON.stringify(last)}`).toBe(true);
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

    // §11 : montants exposés en string décimale, comme au dashboard
    expect(res.body.activity.ca).toMatch(/^\d+\.\d{2}$/);
    expect(res.body.activity.netProfit).toMatch(/^-?\d+\.\d{2}$/);
    expect(res.body.money.cash).toMatch(/^-?\d+\.\d{2}$/);
    expect(res.body.money).toHaveProperty('payable');
    expect(res.body.integrity.ok).toBe(true);
    expect(res.body.integrity.identityDelta).toBe(0);

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
    expect(res.body.activity.ca).toMatch(/^\d+\.\d{2}$/);
    expect(res.body.integrity.identityDelta).toBe(0);

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
