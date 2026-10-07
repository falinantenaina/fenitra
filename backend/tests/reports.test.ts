import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Response } from 'supertest';
import { adminToken, app, as, API, carton, tokenFor, type AuthedRequest } from './helpers';
import { accountingIdentity, identityBalance } from './identity';
import { buildPdf, exportReportPdf } from '../src/modules/reports/reports.service';
import {
  accumulatedProfitDrillRows,
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
/** Fenêtre silencieuse du §48 : jour de la fenêtre scellée, jamais utilisé ailleurs. */
const SILENT_DAY = '2099-06-20';

let admin: AuthedRequest;
let categoryId: string;
let variantId: string;
/** Dette fournisseur amorcée au `beforeAll` — sert aux règlements du §48. */
let supplierDebtId: string | null;

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

    // 6 unités : 2 pour l'amorçage, 1 pour la fenêtre §62, 1 pour le §48 —
    // il en reste toujours (l'identité comptable exige des lots vivants).
    const arrival = await admin.post('/arrivals').send({
      supplierId: supplier.body.id,
      cartons: [carton(product.body.id, size40.id, 6, 30000)],
    });
    if (arrival.status !== 201) {
      throw new Error(`Amorçage arrivage ${arrival.status}: ${JSON.stringify(arrival.body)}`);
    }
    supplierDebtId = arrival.body.debt?.id ?? null;

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
    // §45 : le retrait ne crée ni ne détruit du bénéfice — il ne fait que le
    // sortir de la caisse. Total = sorti + non sorti, à tout instant.
    expect(b.money.netProfitAccumulated).toMatch(/^-?\d+\.\d{2}$/);
    expect(b.money.netProfitNotWithdrawn).toMatch(/^-?\d+\.\d{2}$/);
    expect(Number(b.money.netProfitAccumulated)).toBe(
      Number(b.money.profitDrawings) + Number(b.money.netProfitNotWithdrawn),
    );
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

  it('décompose le bénéfice disponible en vola − argent propre (§9)', () => {
    // Le disponible est le bénéfice encaissé non sorti : caisse + stock +
    // créances − passifs − argent propre − marge à recevoir. Les retraits
    // restent comptés DANS la caisse (cashDelta négatif) — c'est ce qui le
    // fait descendre. Sinon, une seule ligne « règle » explique le plancher
    // à 0 (§62, contrôle §16).
    const date = new Date('2099-06-30T00:00:00.000Z');
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
      personalCapitalEngaged: 40,
      disposableProfit,
    });

    // (a) vola − K : 100 + 50 + 30 − 20 − 40 = 120. Le retrait (−10 en caisse)
    // fait bien partie du total : c'est lui qui diminue le disponible.
    const positive = disposableDrillRows(money(120), date, parts, []);
    expect(sumBalance(positive)).toBe(120);
    expect(positive.map((r) => r.kind)).toContain('LOT');
    expect(positive.map((r) => r.kind)).toContain('PROFIT_DRAWING');
    expect(positive.some((r) => r.kind === 'CAPITAL')).toBe(true);

    // (b) plancher à 0 : une seule ligne explicative, total nul — même avec
    // une marge à recevoir (le plancher l'emporte sur la soustraction).
    const floored = disposableDrillRows(money(0), date, parts, [
      row('open', 'MARGIN_UNREALIZED', 20),
    ]);
    expect(sumBalance(floored)).toBe(0);
    expect(floored.map((r) => r.kind)).toEqual(['RULE']);

    // (c) marge à recevoir : elle SOUSTRAIT du disponible (§41).
    const withCredit = disposableDrillRows(money(100), date, parts, [
      row('open', 'MARGIN_UNREALIZED', 20),
    ]);
    expect(sumBalance(withCredit)).toBe(100);
    expect(withCredit.some((r) => r.kind === 'MARGIN_UNREALIZED' && r.amount === -20)).toBe(true);
  });

  it('décompose le bénéfice total en vola − argent propre + retraits (§45)', () => {
    // total encaissé = vola − K + retraits − marge à recevoir : les retraits
    // sont déjà déduits DANS la caisse, leur ligne est retirée pour ne pas les
    // compter deux fois.
    const date = new Date('2099-06-30T00:00:00.000Z');
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
    const parts: CompositeParts = {
      cashRows: [row('sale', 'SALE', 999_999, 110), row('draw', 'PROFIT_DRAWING', 10, -10)],
      stockRows: [row('lot', 'LOT', 50)],
      receivableRows: [row('recv', 'CUSTOMER', 30)],
      payableRows: [row('pay', 'SUPPLIER', 20)],
    };

    const rows = accumulatedProfitDrillRows({ personalCapitalEngaged: 40 }, date, parts, []);
    expect(sumBalance(rows)).toBe(110 + 50 + 30 - 20 - 40);
    expect(rows.map((r) => r.kind)).toContain('LOT');
    expect(rows.map((r) => r.kind)).not.toContain('PROFIT_DRAWING');
    expect(rows.some((r) => r.kind === 'CAPITAL')).toBe(true);

    // La marge à recevoir est soustraite : le total n'est reconnu qu'encaissé.
    const withCredit = accumulatedProfitDrillRows({ personalCapitalEngaged: 40 }, date, parts, [
      row('open', 'MARGIN_UNREALIZED', 20),
    ]);
    expect(sumBalance(withCredit)).toBe(110 + 50 + 30 - 20 - 40 - 20);
  });

  it('dérille les indicateurs d\'état vers leurs composantes (§62)', async () => {
    // Les indicateurs de flux sont scellés dans la fenêtre ci-dessus. Ceux-ci
    // sont des ÉTATS cumulés jusqu'à la date de fin : ils captent donc aussi les
    // écritures des autres fichiers de test, écrits en parallèle. Chaque
    // dérillage est encadré de deux lectures du dashboard — le total doit
    // retomber sur l'une des deux quand rien n'a bougé, et, sinon, rester dans
    // l'intervalle balayé par les deux lectures (le dérillage est produit entre
    // elles) : une écriture pendant le bracket déplace le solde, jamais un total
    // faux. Cinq tentatives couvrent le cas rare où le solde monte ET descend
    // entre les deux lectures.
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
      netProfitAccumulated: (b) => Number(b.money.netProfitAccumulated),
      unrealizedMargin: (b) => Number(b.money.unrealizedMargin),
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
    const between = (v: number, a: number, b: number) =>
      v >= Math.min(a, b) - 0.01 && v <= Math.max(a, b) + 0.01;

    for (const [indicator, pick] of Object.entries(stateful)) {
      let matched = false;
      let last = { before: NaN, drill: NaN, after: NaN };

      for (let attempt = 0; attempt < 5 && !matched; attempt += 1) {
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
        matched =
          close(last.drill, last.before) ||
          close(last.drill, last.after) ||
          between(last.drill, last.before, last.after);
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

  it('couvre les 11 champs du rapport journalier (§48)', async () => {
    // Jour isolé : rien d'autre que cette suite n'y écrit, les totaux sont
    // donc déterministes (vente partiellement payée → dette de 40 000).
    const customer = await admin.post('/customers').send({ name: `Client §48 ${stamp}` });
    expect(customer.status, JSON.stringify(customer.body)).toBe(201);

    const [sale, expense, versement] = await Promise.all([
      admin.post('/sales').send({
        date: SILENT_DAY,
        customerId: customer.body.id,
        items: [{ variantId, quantity: 1, unitPrice: 60000 }],
        payment: { amount: 20000, method: 'Espèces' },
      }),
      admin.post('/expenses').send({
        categoryId,
        amount: 4000,
        date: SILENT_DAY,
        description: `Rapport §48 ${stamp}`,
      }),
      admin.post('/versements').send({
        personName: `Mr Kely ${stamp}`,
        amount: 2000,
        date: SILENT_DAY,
        motif: 'Rapport journalier §48',
      }),
    ]);
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(expense.status, JSON.stringify(expense.body)).toBe(201);
    expect(versement.status, JSON.stringify(versement.body)).toBe(201);

    // Règlements de dettes le même jour : ils alimentent « paiements reçus »
    // (client) et « paiements fournisseurs » (§48), sans créer de nouvelle dette.
    const [repaid, supplierPaid] = await Promise.all([
      admin
        .post(`/debts/${sale.body.debt.id}/payments`)
        .send({ amount: 5000, method: 'Espèces', date: SILENT_DAY }),
      admin.post(`/debts/${supplierDebtId!}/payments`).send({
        amount: 10000,
        method: 'Espèces',
        date: SILENT_DAY,
      }),
    ]);
    expect(repaid.status, JSON.stringify(repaid.body)).toBe(200);
    expect(supplierPaid.status, JSON.stringify(supplierPaid.body)).toBe(200);

    const res = await admin.get(`/reports/daily?date=${SILENT_DAY}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: 'daily', date: SILENT_DAY });

    // 1-7 : activité de la journée (COGS FIFO = 1 × 30 000).
    expect(res.body.activity).toMatchObject({
      ca: '60000.00',
      receipts: '25000.00',
      cogs: '30000.00',
      expenses: '4000.00',
      versementCharges: '2000.00',
      grossProfit: '30000.00',
      // §41 : la vente du jour n'est pas réglée (25 000 sur 60 000) — sa marge
      // de 30 000 reste à recevoir. Bénéfice encaissé = 30 000 (brut) − 4 000
      // (dépenses) − 2 000 (versements) − 30 000 (Δ marge à recevoir) = −6 000.
      netProfit: '-6000.00',
    });
    // 8-9 : règlements de dettes du jour (l'encaissement initial appartient
    // aux « recettes », pas aux « paiements reçus »).
    expect(res.body.paymentsReceived).toBe('5000.00');
    expect(res.body.paymentsSupplier).toBe('10000.00');
    // 10 : caisse en fin de journée — soldes cumulés, donc non déterministes
    // ici (les autres suites écrivent en parallèle) : contrôle de forme.
    expect(res.body.money.cash).toMatch(/^-?\d+\.\d{2}$/);
    // 11 : seule la vente a ouvert une dette ce jour-là (60 000 − 20 000).
    expect(res.body.newDebts).toBe('40000.00');

    // §62 — contrôle d'indépendance : le journal recalcule les encaissements.
    const summary = await admin.get('/ledger/summary').query({ from: SILENT_DAY, to: '2099-06-21' });
    const amountOf = (kinds: string[]) =>
      summary.body.byKind
        .filter((row: { kind: string }) => kinds.includes(row.kind))
        .reduce((total: number, row: { amount: string }) => total + Number(row.amount), 0);
    expect(Number(res.body.paymentsReceived)).toBe(
      amountOf(['CUSTOMER_PAYMENT', 'ONLINE_SELLER_PAYMENT']),
    );
    expect(Number(res.body.paymentsSupplier)).toBe(amountOf(['SUPPLIER_PAYMENT']));
  });

  it('couvre les 18 champs du rapport mensuel (§48)', async () => {
    const res = await admin.get('/reports/monthly?year=2099&month=6');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: 'monthly', year: 2099, month: 6 });

    const MONEY = /^-?\d+\.\d{2}$/;
    // 1-8 : activité + caisse.
    expect(res.body.activity.ca).toMatch(MONEY);
    expect(res.body.activity.receipts).toMatch(MONEY);
    expect(res.body.activity.cogs).toMatch(MONEY);
    expect(res.body.activity.expenses).toMatch(MONEY);
    expect(res.body.activity.versementCharges).toMatch(MONEY);
    expect(res.body.activity.grossProfit).toMatch(MONEY);
    expect(res.body.activity.netProfit).toMatch(MONEY);
    expect(res.body.money.cash).toMatch(MONEY);
    // 9-13 : stock et dettes par type, cumulés au 30/06.
    expect(res.body.stock.value).toMatch(MONEY);
    for (const key of ['customer', 'onlineSeller', 'supplier', 'trosaSinoa']) {
      expect(res.body.debts[key], `debts.${key}`).toMatch(MONEY);
    }
    // 14 : argent propre engagé.
    expect(res.body.money.personalCapitalEngaged).toMatch(MONEY);
    // 15-16 : produits les plus vendus, classés par quantité, avec leur bénéfice.
    expect(res.body.bestSellers.length).toBeGreaterThan(0);
    expect(res.body.bestSellers[0].margin).toMatch(MONEY);
    for (let i = 1; i < res.body.bestSellers.length; i += 1) {
      expect(res.body.bestSellers[i - 1].quantity).toBeGreaterThanOrEqual(
        res.body.bestSellers[i].quantity,
      );
    }
    // 17 : dépenses par catégorie.
    expect(res.body.expensesByCategory.length).toBeGreaterThan(0);
    // 18 : versements par personne (celui du jour silencieux).
    const byPerson = res.body.versementsByPerson.find(
      (row: { person: string }) => row.person === `Mr Kely ${stamp}`,
    );
    expect(byPerson).toMatchObject({ amount: '2000.00', count: 1 });

    // §62 — un seul objet : l'agrégat « produits les plus vendus » doit
    // retomber sur la somme des lignes de ventes du même rapport (les soldes
    // cumulés, eux, ne se comparent pas : d'autres suites écrivent en parallèle).
    const soldByArticle = new Map<string, number>();
    for (const sale of res.body.sales) {
      for (const item of sale.items) {
        const key = `${item.product?.name ?? '?'}|${item.size?.label ?? ''}`;
        soldByArticle.set(key, (soldByArticle.get(key) ?? 0) + item.quantity);
      }
    }
    expect(soldByArticle.size).toBeGreaterThan(0);
    for (const row of res.body.bestSellers) {
      const key = `${row.product?.name ?? '?'}|${row.size?.label ?? ''}`;
      expect(row.quantity, `${key} : agrégat ≠ ventes`).toBe(soldByArticle.get(key) ?? 0);
    }
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

    // §48 — les rubriques propres à chaque rapport sont imprimées.
    expect(buf.toString('latin1')).toContain('VERSEMENTS PAR PERSONNE');
    expect(buf.toString('latin1')).toContain('PRODUITS LES PLUS VENDUS');
    const daily = await exportReportPdf({ type: 'daily', date: SILENT_DAY });
    const dailyText = daily.buffer.toString('latin1');
    expect(dailyText).toContain('Paiements recus');
    expect(dailyText).toContain('Paiements fournisseurs');
    expect(dailyText).toContain('Nouvelles dettes');
    expect(dailyText).toContain('Caisse');
  });

  it('génère un PDF paginé même avec beaucoup de lignes', () => {
    const lines = Array.from({ length: 120 }, (_, i) => `Ligne ${i} — dépense (test)`);
    const buf = buildPdf('Test', lines);
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.toString('latin1')).toContain('/Count 3');
    expect(buf.toString('latin1')).toContain('%%EOF');
  });

  it('valide les paramètres de la série journalière (§3)', async () => {
    const noToken = await request(app).get(`${API}/reports/series`);
    expect(noToken.status).toBe(401);

    const noBounds = await admin.get('/reports/series?period=custom');
    expect(noBounds.status).toBe(400);

    const badMetric = await admin.get('/reports/series?metric=netProfit');
    expect(badMetric.status).toBe(400);

    const tooLong = await admin.get(
      '/reports/series?period=custom&from=2020-01-01&to=2100-12-31&metric=ca',
    );
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.error.message).toMatch(/trop longue/);

    // `metric` sans défaut → `ca`, une seule pointe pour « hier ».
    const yesterday = await admin.get('/reports/series?period=yesterday');
    expect(yesterday.status).toBe(200);
    expect(yesterday.body.metric).toBe('ca');
    expect(yesterday.body.points).toHaveLength(1);
  });

  it('expose la série journalière des indicateurs de flux (§3 graphiques)', async () => {
    // Fenêtre scellée (personne d'autre n'y écrit) : une vente et une dépense
    // datées sur deux jours distincts pour éprouver le remplissage à 0.
    const [sale, expense] = await Promise.all([
      admin.post('/sales').send({
        date: '2099-06-05T09:00:00.000Z',
        items: [{ variantId, quantity: 1, unitPrice: 60000 }],
        payment: { amount: 60000, method: 'Espèces' },
      }),
      admin.post('/expenses').send({
        categoryId,
        amount: 4000,
        date: '2099-06-12',
        description: `Série journalière ${stamp}`,
      }),
    ]);
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    expect(expense.status, JSON.stringify(expense.body)).toBe(201);

    const series = await admin.get(`/reports/series?${SEALED}&metric=ca`);
    expect(series.status).toBe(200);
    expect(series.body).toMatchObject({ metric: 'ca', label: "Chiffre d'affaires" });
    expect(series.body.meta).toMatchObject({ period: 'custom', timezone: expect.any(String) });
    expect(series.body.points).toHaveLength(30);
    expect(series.body.points[0].date).toBe('2099-06-01');
    expect(series.body.points[series.body.points.length - 1].date).toBe('2099-06-30');
    expect(
      series.body.points.every((p: { value: string }) => /^\d+\.\d{2}$/.test(p.value)),
    ).toBe(true);

    const byDate = Object.fromEntries(
      series.body.points.map((p: { date: string; value: string }) => [p.date, Number(p.value)]),
    );
    expect(byDate['2099-06-05']).toBe(60000);
    // Jour de dépense : aucune vente, donc 0 sur la série du CA.
    expect(byDate['2099-06-12']).toBe(0);
    expect(byDate['2099-06-01']).toBe(0);
    expect(byDate['2099-06-30']).toBe(0);

    // Sorties d'argent : la dépense du 12 apparaît, pas le reste du mois.
    const outflow = await admin.get(`/reports/series?${SEALED}&metric=outflow`);
    expect(outflow.status).toBe(200);
    const outByDate = Object.fromEntries(
      outflow.body.points.map((p: { date: string; value: string }) => [p.date, Number(p.value)]),
    );
    expect(outByDate['2099-06-12']).toBe(4000);
    expect(outByDate['2099-06-01']).toBe(0);

    // Total des trois séries = valeur affichée au dashboard (même plage,
    // mêmes prédicats) : c'est le contrat du §3.
    const dash = await admin.get(`/dashboard?${SEALED}`);
    expect(dash.status).toBe(200);

    const displayed: Record<string, string> = {
      ca: dash.body.activity.ca,
      receipts: dash.body.activity.receipts,
      outflow: dash.body.activity.cashOutflow,
    };

    for (const [metric, value] of Object.entries(displayed)) {
      const res = await admin.get(`/reports/series?${SEALED}&metric=${metric}`);
      expect(res.status, metric).toBe(200);
      const sum = res.body.points.reduce(
        (s: number, p: { value: string }) => s + Number(p.value),
        0,
      );
      expect(sum, `${metric} : total de la série ≠ valeur du dashboard`).toBeCloseTo(
        Number(value),
        2,
      );
      expect(Number(res.body.total), `${metric} : total exposé`).toBeCloseTo(sum, 2);
    }
  });

  it('applique le RBAC caissier sur le journal et les rapports', async () => {
    const cashier = as(
      await tokenFor(`caissier-rapports-${stamp}@test.local`, 'Caissier Rapports', 'CASHIER'),
    );

    // Tableau de bord et série du graphique : visualisation ouverte au caissier.
    expect((await cashier.get(`/dashboard?${WIDE}`)).status).toBe(200);
    expect((await cashier.get(`/reports/series?${SEALED}&metric=ca`)).status).toBe(200);

    // Journal et rapports détaillés : réservés aux gestionnaires.
    expect((await cashier.get(`/ledger?${WIDE}`)).status).toBe(403);
    expect((await cashier.get(`/ledger/summary?${WIDE}`)).status).toBe(403);
    expect((await cashier.get(`/reports/daily?date=${SEALED_DAY}`)).status).toBe(403);
    expect((await cashier.get(`/reports/monthly?year=2099&month=6`)).status).toBe(403);
    expect((await cashier.get(`/reports/export.pdf?type=daily&date=${SEALED_DAY}`)).status).toBe(403);
  });

  it('identité comptable confirmée par le dashboard', async () => {
    const snapshot = await accountingIdentity();
    const { lhs, rhs, delta } = identityBalance(snapshot);

    expect(delta).toBe(0);
    expect(lhs).toBe(rhs);
    expect(snapshot.lots).toBeGreaterThan(0);
  });
});
