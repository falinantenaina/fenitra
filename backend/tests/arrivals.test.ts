import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { adminToken, app, API, as, carton, tokenFor, type AuthedRequest } from './helpers';
import { prisma } from '../src/lib/prisma';
import { accountingIdentity, identityBalance } from './identity';

const stamp = Date.now();

let admin: AuthedRequest;
let cashier: AuthedRequest;
let supplierId = '';
let productId = '';
let size40Id = '';
let size41Id = '';
let variantA = '';
let variantB = '';
let arrivalA = '';
let arrivalB = '';
let lotA = '';
let sansPtId = '';
let sansPtCartonId = '';

const payloadA = () => ({
  supplierId,
  cartons: [
    {
      reference: 'C1',
      productId,
      totalQty: 15,
      totalCost: 300000,
      sizes: [
        { sizeId: size40Id, quantity: 10 },
        { sizeId: size41Id, quantity: 5 },
      ],
    },
  ],
  payment: { amount: 100000, method: 'Espèces' },
});

describe('Arrivages & stock', () => {
  beforeAll(async () => {
    admin = as(await adminToken());
    cashier = as(await tokenFor(`caissier-arrivals-${stamp}@test.local`, 'Caissier Arrivages', 'CASHIER'));

    const supplier = await admin.post('/suppliers').send({ name: `Fournisseur Arrivage ${stamp}` });
    supplierId = supplier.body.id;

    const product = await admin.post('/products').send({ name: `Modèle Arrivage ${stamp}` });
    productId = product.body.id;
    const sizes = await admin.get('/sizes?limit=100');
    const size40 = sizes.body.items.find((s: { value: number }) => s.value === 40);
    const size41 = sizes.body.items.find((s: { value: number }) => s.value === 41);
    size40Id = size40.id;
    size41Id = size41.id;

    const a = await admin
      .post('/variants')
      .send({ productId: product.body.id, sizeId: size40.id, sellingPrice: 45000 });
    const b = await admin
      .post('/variants')
      .send({ productId: product.body.id, sizeId: size41.id, sellingPrice: 47000 });
    variantA = a.body.id;
    variantB = b.body.id;
  });

  it('exige une authentification', async () => {
    const res = await request(app).get(`${API}/stock/summary`);
    expect(res.status).toBe(401);
  });

  it('interdit la création d\'un arrivage à un caissier (403)', async () => {
    const res = await cashier.post('/arrivals').send(payloadA());
    expect(res.status).toBe(403);
  });

  it('prévisualise la référence sans la consommer', async () => {
    const first = await admin.get('/arrivals/reference-preview');
    const second = await admin.get('/arrivals/reference-preview');
    expect(first.body.reference).toMatch(/^ARR-\d{4}$/);

    if (second.body.reference !== first.body.reference) {
      // Les fichiers tournent en parallèle : une autre suite a pu consommer la
      // référence entre les deux appels. On vérifie alors qu'un ARRIVAGE porte
      // bien cette référence — sinon c'est la prévisualisation qui l'a gaspillée.
      const consumed = await prisma.arrival.findFirst({
        where: { reference: first.body.reference },
      });
      expect(consumed, `prévisualisation ${first.body.reference} non consommée`).not.toBeNull();
    }
  });

  it('enregistre un arrivage complet en une transaction (Test 1)', async () => {
    const res = await admin.post('/arrivals').send(payloadA());
    expect(res.status).toBe(201);

    const body = res.body;
    expect(body.reference).toMatch(/^ARR-\d{4}$/);
    expect(body.status).toBe('RECEIVED');
    expect(body.totalQty).toBe(15);
    expect(body.totalCost).toBe('300000.00');
    expect(body.paidAmount).toBe('100000.00');
    expect(body.unpaidAmount).toBe('200000.00');

    // cartons → lignes (pointures listées à la saisie → ventilé d'office)
    expect(body.cartons).toHaveLength(1);
    expect(body.cartons[0].items).toHaveLength(2);
    expect(body.cartons[0].totalCost).toBe('300000.00');
    expect(body.cartons[0].ventilated).toBe(true);
    expect(body.cartons[0].transitValue).toBe('0.00');
    expect(body.cartons[0].transitQty).toBe(0);

    // lots : un par ligne, coût déduit (montant / quantité), jamais saisi
    expect(body.lots).toHaveLength(2);
    expect(body.lots[0].remainingQty).toBe(10);
    expect(body.lots[0].unitCost).toBe('20000.00');
    expect(body.lots[0].value).toBe('200000.00');

    // dette fournisseur partielle
    expect(body.debt).not.toBeNull();
    expect(body.debt.status).toBe('PARTIAL');
    expect(body.debt.reason).toContain('paiement partiel');
    expect(body.debt.initialAmount).toBe('300000.00');
    expect(body.debt.paidAmount).toBe('100000.00');
    expect(body.debt.remainingAmount).toBe('200000.00');

    expect(body.payments).toHaveLength(1);
    expect(body.payments[0].amount).toBe('100000.00');
    expect(body.payments[0].direction).toBe('OUT');

    arrivalA = body.id;
    lotA = body.lots.find((l: { remainingQty: number }) => l.remainingQty === 10).id;

    // piste d'audit : un mouvement IN par lot
    const movements = await prisma.stockMovement.findMany({ where: { refType: 'ARRIVAL', refId: arrivalA } });
    expect(movements).toHaveLength(2);
    expect(movements.every((m) => m.type === 'IN' && m.delta > 0)).toBe(true);

    // écriture de journal : caisse −100000
    const ledger = await prisma.ledgerEntry.findMany({ where: { arrivalId: arrivalA } });
    expect(ledger).toHaveLength(1);
    const entry = ledger[0]!;
    expect(entry.kind).toBe('SUPPLIER_PAYMENT');
    expect(entry.amount).toBe(100000);
    expect(entry.cashDelta).toBe(-100000);
  });

  it(' rejette un paiement supérieur au montant de l\'arrivage', async () => {
    const res = await admin
      .post('/arrivals')
      .send({ ...payloadA(), payment: { amount: 999999 } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('rejette une pointure inconnue (404)', async () => {
    const res = await admin
      .post('/arrivals')
      .send({ supplierId, cartons: [carton(productId, 'pointure-inconnue', 1, 1000)] });
    expect(res.status).toBe(404);
    expect(res.body.error.message).toContain('Pointure inconnue');
  });

  it(' rejette une soumission dupliquée avec la même Idempotency-Key', async () => {
    const key = `arrival-${stamp}`;
    const payload = {
      supplierId,
      cartons: [carton(productId, size41Id, 4, 22000)],
      payment: { amount: 40000 },
    };
    const first = await admin.post('/arrivals').set('Idempotency-Key', key).send(payload);
    const second = await admin.post('/arrivals').set('Idempotency-Key', key).send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.reference).toBe(first.body.reference);
  });

  it('valorise le stock sans écraser les anciens prix (Test 2)', async () => {
    const summary0 = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(summary0.body.quantity).toBe(10);
    expect(summary0.body.value).toBe('200000.00');

    const second = await admin.post('/arrivals').send({
      supplierId,
      cartons: [carton(productId, size40Id, 4, 25000)],
      payment: { amount: 50000 },
    });
    expect(second.status).toBe(201);
    arrivalB = second.body.id;

    const summary1 = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(summary1.body.quantity).toBe(14);
    // 10×20000 + 4×25000 = 300000 — chaque lot conserve son propre coût
    expect(summary1.body.value).toBe('300000.00');

    const lots = await admin.get(`/stock/lots?variantId=${variantA}`);
    expect(lots.body.items).toHaveLength(2);
    expect(lots.body.items.map((l: { unitCost: string }) => l.unitCost).sort()).toEqual(['20000.00', '25000.00']);

    // historique des prix d'achat depuis les lots (§18)
    const history = await admin.get(`/variants/${variantA}/price-history`);
    expect(history.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('consomme en FIFO lors d\'un ajustement (Test 8)', async () => {
    const res = await admin.post('/stock/adjustments').send({
      variantId: variantA,
      qty: 3,
      reason: 'Casse constatée en vitrine',
    });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.quantity).toBe(3);
    expect(res.body.lostValue).toBe('60000.00'); // 3 × 20000, le lot le plus ancien
    expect(res.body.allocations).toHaveLength(1);
    expect(res.body.allocations[0].lotId).toBe(lotA);

    const summary = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(summary.body.quantity).toBe(11);

    // la perte est journalisée en dépense non monétaire (identité §3)
    const ledger = await prisma.ledgerEntry.findMany({ where: { refType: 'EXPENSE', refId: res.body.expenseId } });
    expect(ledger).toHaveLength(1);
    const loss = ledger[0]!;
    expect(loss.kind).toBe('EXPENSE');
    expect(loss.amount).toBe(60000);
    expect(loss.cashDelta).toBe(0);

    const lotMovements = await admin.get(`/stock/lots/${lotA}/movements`);
    expect(lotMovements.body.items).toHaveLength(2);
    expect(lotMovements.body.items[1].type).toBe('ADJUSTMENT');
    expect(lotMovements.body.items[1].delta).toBe(-3);
    // §18 — le détail du lot donne la variante, donc l'historique des prix
    expect(lotMovements.body.lot.variantId).toBe(variantA);
  });

  it('refuse un ajustement supérieur au stock (409)', async () => {
    const res = await admin.post('/stock/adjustments').send({
      variantId: variantA,
      qty: 9999,
      reason: 'Trop demandé',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('annule un arrivage au stock intact par contre-passation (Test 3)', async () => {
    const before = await prisma.ledgerEntry.count({ where: { arrivalId: arrivalB } });

    const res = await admin.post(`/arrivals/${arrivalB}/cancel`).send({ reason: 'Erreur de saisie' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.cancelReason).toBe('Erreur de saisie');
    expect(res.body.lots.every((l: { remainingQty: number; status: string }) => l.remainingQty === 0 && l.status === 'CANCELLED')).toBe(true);

    const summary = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(summary.body.quantity).toBe(7); // 14 − 3 perdues − 4 annulées
    expect(summary.body.value).toBe('140000.00'); // 7 × 20000

    // la dette annulée n'apparaît plus dans les totaux
    const debt = await prisma.debt.findFirst({ where: { arrivalId: arrivalB } });
    expect(debt?.status).toBe('CANCELLED');

    // les écritures de paiement éventuelles sont contre-passées (amount < 0)
    const after = await prisma.ledgerEntry.findMany({ where: { arrivalId: arrivalB } });
    expect(after.length).toBeGreaterThanOrEqual(before);
    expect(after.some((e) => e.amount < 0 && e.reference?.startsWith('ANNULATION'))).toBe(true);
  });

  it('refuse d\'annuler un arrivage dont le stock a bougé', async () => {
    const res = await admin.post(`/arrivals/${arrivalA}/cancel`).send({ reason: 'Trop tard' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('a déjà bougé');
  });

  it('refuse une double annulation', async () => {
    const res = await admin.post(`/arrivals/${arrivalB}/cancel`).send({ reason: 'Encore' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('déjà annulé');
  });

  it('liste les arrivages avec pagination', async () => {
    const res = await admin.get('/arrivals?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body).toMatchObject({ page: 1, limit: 5 });
    expect(res.body.items[0].totalCost).toMatch(/^\d+\.\d{2}$/);
  });

  it('lit le détail complet d\'un arrivage', async () => {
    const res = await admin.get(`/arrivals/${arrivalA}`);
    expect(res.status).toBe(200);
    expect(res.body.cartons).toHaveLength(1);
    expect(res.body.lots).toHaveLength(2);
    expect(res.body.debt).not.toBeNull();
    expect(res.body.supplier.name).toContain('Fournisseur Arrivage');
  });

  it('404 sur un arrivage inconnu', async () => {
    const res = await admin.get('/arrivals/id-inconnu');
    expect(res.status).toBe(404);
  });

  it('joue le journal des mouvements de stock', async () => {
    const res = await admin.get('/stock/movements?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.some((m: { type: string }) => m.type === 'IN')).toBe(true);
    expect(res.body.items.some((m: { type: string }) => m.type === 'ADJUSTMENT')).toBe(true);
    expect(res.body.items.some((m: { type: string }) => m.type === 'REVERSAL')).toBe(true);
  });

  it('enregistre un arrivage sans pointures : modèle, quantité, montant, paiement immédiat', async () => {
    const summaryBefore = await admin.get(`/suppliers/${supplierId}/summary`);

    const res = await admin.post('/arrivals').send({
      supplierId,
      cartons: [{ reference: 'SANS-PT', productId, totalQty: 12, totalCost: 360000 }],
      payment: { amount: 100000, method: 'Espèces' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('RECEIVED');
    expect(res.body.reference).toMatch(/^ARR-\d{4}$/);
    expect(res.body.totalQty).toBe(12);
    expect(res.body.totalCost).toBe('360000.00');
    expect(res.body.paidAmount).toBe('100000.00');
    expect(res.body.unpaidAmount).toBe('260000.00');
    sansPtId = res.body.id;
    sansPtCartonId = res.body.cartons[0].id;

    // carton non ventilé : le modèle est connu, les pointures pas encore
    expect(res.body.cartons[0].product.id).toBe(productId);
    expect(res.body.cartons[0].ventilated).toBe(false);
    expect(res.body.cartons[0].items).toEqual([]);
    expect(res.body.cartons[0].transitValue).toBe('360000.00');
    expect(res.body.cartons[0].transitQty).toBe(12);
    expect(res.body.lots).toEqual([]);

    // caisse et dette bougent dès l'enregistrement
    expect(res.body.debt).not.toBeNull();
    expect(res.body.debt.status).toBe('PARTIAL');
    expect(res.body.debt.remainingAmount).toBe('260000.00');
    expect(res.body.payments).toHaveLength(1);
    const ledger = await prisma.ledgerEntry.findMany({ where: { refType: 'ARRIVAL', refId: res.body.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.kind).toBe('SUPPLIER_PAYMENT');
    expect(ledger[0]!.amount).toBe(100000);
    expect(ledger[0]!.cashDelta).toBe(-100000);

    // le carton à ventiler pèse déjà dans le stock : identité comptable exacte
    expect(identityBalance(await accountingIdentity()).delta).toBe(0);

    const summaryAfter = await admin.get(`/suppliers/${supplierId}/summary`);
    expect(summaryAfter.body.arrivals.count).toBe(summaryBefore.body.arrivals.count + 1);
  });

  it('liste les cartons à ventiler et refuse l\'ancien ?status=DRAFT', async () => {
    const res = await admin.get('/arrivals?unventilated=true&limit=100');
    expect(res.status).toBe(200);
    expect(
      res.body.items.some((a: { id: string; status: string }) => a.id === sansPtId && a.status === 'RECEIVED'),
    ).toBe(true);
    expect(res.body.items.every((a: { status: string }) => a.status === 'RECEIVED')).toBe(true);

    const draft = await admin.get('/arrivals?status=DRAFT');
    expect(draft.status).toBe(400);
  });

  it('ventile les pointures : prix imposé, lots créés, aucune écriture comptable', async () => {
    const ledgerBefore = await prisma.ledgerEntry.count({ where: { refType: 'ARRIVAL', refId: sansPtId } });

    const res = await admin.post(`/arrivals/${sansPtId}/ventilate`).send({
      cartons: [
        {
          cartonId: sansPtCartonId,
          lines: [
            { sizeId: size40Id, quantity: 7 },
            { sizeId: size41Id, quantity: 5 },
          ],
        },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const carton = res.body.cartons[0];
    expect(carton.ventilated).toBe(true);
    expect(carton.items).toHaveLength(2);
    expect(carton.transitQty).toBe(0);
    expect(carton.transitValue).toBe('0.00');
    // prix unitaire imposé : floor(360000 / 12) = 30000, recopié partout
    expect(carton.items.every((i: { unitCost: string }) => i.unitCost === '30000.00')).toBe(true);
    expect(
      carton.items.map((i: { lineTotal: string }) => Number(i.lineTotal)).sort((a: number, b: number) => a - b),
    ).toEqual([150000, 210000]);
    expect(res.body.lots).toHaveLength(2);
    expect(res.body.lots.map((l: { unitCost: string }) => l.unitCost)).toEqual(['30000.00', '30000.00']);

    // la ventilation ne touche jamais au journal (caisse/dette posées à l'arrivée)
    const ledgerAfter = await prisma.ledgerEntry.count({ where: { refType: 'ARRIVAL', refId: sansPtId } });
    expect(ledgerAfter).toBe(ledgerBefore);
    expect(identityBalance(await accountingIdentity()).delta).toBe(0);
  });

  it('exige une somme exacte et garde le résidu d\'arrondi à ventiler', async () => {
    const created = await admin.post('/arrivals').send({
      supplierId,
      cartons: [{ productId, totalQty: 10, totalCost: 50003 }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;
    const cartonId = created.body.cartons[0].id;

    // 6 paires déclarées pour 10 annoncées → refus, rien n'est écrit
    const bad = await admin.post(`/arrivals/${id}/ventilate`).send({
      cartons: [{ cartonId, lines: [{ sizeId: size40Id, quantity: 6 }] }],
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toContain('paires ventilées pour 10 annoncées');
    const untouched = await admin.get(`/arrivals/${id}`);
    expect(untouched.body.cartons[0].ventilated).toBe(false);
    expect(untouched.body.lots).toEqual([]);

    const ok = await admin.post(`/arrivals/${id}/ventilate`).send({
      cartons: [
        {
          cartonId,
          lines: [
            { sizeId: size40Id, quantity: 4 },
            { sizeId: size41Id, quantity: 6 },
          ],
        },
      ],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const carton = ok.body.cartons[0];
    expect(carton.ventilated).toBe(true);
    // floor(50003 / 10) = 5000 → 50000 ventilés, 3 restent « à ventiler »
    expect(carton.items.every((i: { unitCost: string }) => i.unitCost === '5000.00')).toBe(true);
    expect(carton.transitQty).toBe(0);
    expect(carton.transitValue).toBe('3.00');
    expect(ok.body.lots).toHaveLength(2);

    // 50000 en lot + 3 en transit = 50003 = dette ouverte → identité exacte
    expect(identityBalance(await accountingIdentity()).delta).toBe(0);
  });

  it('refuse de ventiler un carton déjà ventilé, inconnu ou un arrivage annulé', async () => {
    const again = await admin.post(`/arrivals/${sansPtId}/ventilate`).send({
      cartons: [{ cartonId: sansPtCartonId, lines: [{ sizeId: size40Id, quantity: 12 }] }],
    });
    expect(again.status).toBe(422);
    expect(again.body.error.message).toContain('déjà ventilé');

    const unknown = await admin.post(`/arrivals/${sansPtId}/ventilate`).send({
      cartons: [{ cartonId: 'carton-inexistant', lines: [{ sizeId: size40Id, quantity: 1 }] }],
    });
    expect(unknown.status).toBe(404);

    const created = await admin.post('/arrivals').send({
      supplierId,
      cartons: [{ productId, totalQty: 6, totalCost: 180000 }],
    });
    await admin.post(`/arrivals/${created.body.id}/cancel`).send({ reason: 'Fausse manip' });
    const onCancelled = await admin.post(`/arrivals/${created.body.id}/ventilate`).send({
      cartons: [{ cartonId: created.body.cartons[0].id, lines: [{ sizeId: size40Id, quantity: 6 }] }],
    });
    expect(onCancelled.status).toBe(422);
    expect(onCancelled.body.error.message).toContain('annulé');
  });

  it('annule un arrivage à pointures inconnues : transit nul, journal contre-passé', async () => {
    const created = await admin.post('/arrivals').send({
      supplierId,
      cartons: [{ productId, totalQty: 6, totalCost: 180000 }],
      payment: { amount: 60000 },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id;
    expect(created.body.cartons[0].transitValue).toBe('180000.00');

    const cancel = await admin.post(`/arrivals/${id}/cancel`).send({ reason: 'Annulation anticipée' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(cancel.body.status).toBe('CANCELLED');
    expect(cancel.body.cartons[0].transitValue).toBe('0.00');
    expect(cancel.body.cartons[0].transitQty).toBe(0);
    expect(cancel.body.lots).toEqual([]);

    const entries = await prisma.ledgerEntry.findMany({ where: { refType: 'ARRIVAL', refId: id } });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.reduce((sum, e) => sum + e.cashDelta, 0)).toBe(0);

    expect(identityBalance(await accountingIdentity()).delta).toBe(0);
  });

  it('valide les cartons sans pointures (400) et interdit la ventilation au caissier (403)', async () => {
    const noCarton = await admin.post('/arrivals').send({ supplierId, cartons: [] });
    expect(noCarton.status).toBe(400);

    const noModel = await admin
      .post('/arrivals')
      .send({ supplierId, cartons: [{ totalQty: 5, totalCost: 1000 }] });
    expect(noModel.status).toBe(400);

    const noQty = await admin.post('/arrivals').send({ supplierId, cartons: [{ productId, totalCost: 1000 }] });
    expect(noQty.status).toBe(400);

    const noCost = await admin.post('/arrivals').send({ supplierId, cartons: [{ productId, totalQty: 5 }] });
    expect(noCost.status).toBe(400);

    const tooCheap = await admin
      .post('/arrivals')
      .send({ supplierId, cartons: [{ productId, totalQty: 5, totalCost: 3 }] });
    expect(tooCheap.status).toBe(400);

    const mismatch = await admin.post('/arrivals').send({
      supplierId,
      cartons: [{ productId, totalQty: 9, totalCost: 9000, sizes: [{ sizeId: size40Id, quantity: 10 }] }],
    });
    expect(mismatch.status).toBe(400);
    expect(
      (mismatch.body.error.details as { message: string }[]).some((d) =>
        d.message.includes('paires listées pour 9 annoncées'),
      ),
    ).toBe(true);

    const duplicated = await admin.post('/arrivals').send({
      supplierId,
      cartons: [
        {
          productId,
          totalQty: 9,
          totalCost: 9000,
          sizes: [
            { sizeId: size40Id, quantity: 4 },
            { sizeId: size40Id, quantity: 5 },
          ],
        },
      ],
    });
    expect(duplicated.status).toBe(400);
    expect(
      (duplicated.body.error.details as { message: string }[]).some((d) =>
        d.message.includes('listée deux fois'),
      ),
    ).toBe(true);

    const created = await admin.post('/arrivals').send({
      supplierId,
      cartons: [{ productId, totalQty: 4, totalCost: 80000 }],
    });
    expect(created.status).toBe(201);
    const forbidden = await cashier.post(`/arrivals/${created.body.id}/ventilate`).send({
      cartons: [{ cartonId: created.body.cartons[0].id, lines: [{ sizeId: size40Id, quantity: 4 }] }],
    });
    expect(forbidden.status).toBe(403);
  });
});
