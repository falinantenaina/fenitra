import { beforeAll, describe, expect, it } from 'vitest';
import { adminToken, as, carton, tokenFor, type AuthedRequest } from './helpers';
import { prisma } from '../src/lib/prisma';
import { accountingIdentity, identityBalance } from './identity';

const stamp = Date.now();

const PAIR_COST = 50_000;
const PAIRS = 6;
/** Les autres fichiers dépensent en parallèle : on vise large, jamais au centime. */
const MARGIN = 1_000_000;
const TARGET = 50_000;

let admin: AuthedRequest;
let cashier: AuthedRequest;
let supplierId = '';
let productId = '';
let sizeId = '';
let variantId = '';
let drawingId = '';
let arrivalId = '';
let pairsLeft = PAIRS;

const num = (v: unknown): number => Number(v);

async function dashMoney(): Promise<Record<string, string>> {
  const res = await admin.get('/dashboard');
  if (res.status !== 200) throw new Error(`dashboard ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.money as Record<string, string>;
}

const netOf = async (refId: string) => {
  const entries = await prisma.ledgerEntry.findMany({ where: { refType: 'PROFIT_DRAWING', refId } });
  return { count: entries.length, amount: entries.reduce((s, e) => s + e.amount, 0) };
};

/**
 * Créer du bénéfice encaissé non sorti (`disposableProfit` = vola − argent
 * propre − marge à recevoir) : la base de test démarre avec du stock et des
 * passifs, le disponible y part de (quasi) rien. On achète un arrivage dédié
 * puis on revend ses paires bien au-dessus du coût — chaque vente ENCAISSÉE
 * ajoute exactement `prix − coût` au vola, donc au plafond de retrait.
 */
async function ensureDisposable(target: number): Promise<void> {
  if (!arrivalId) {
    const res = await admin.post('/arrivals').send({
      supplierId,
      cartons: [carton(productId, sizeId, PAIRS, PAIR_COST)],
      payment: { amount: PAIRS * PAIR_COST, method: 'Espèces' },
    });
    if (res.status !== 201) throw new Error(`arrivage d'appoint ${res.status}: ${JSON.stringify(res.body)}`);
    arrivalId = res.body.id;
  }

  for (let attempt = 0; attempt <= PAIRS; attempt++) {
    const m = await dashMoney();
    if (num(m.disposableProfit) >= target) return;
    if (pairsLeft === 0) break;

    const deficit = Math.max(0, target - num(m.disposableProfit));
    const price = Math.max(PAIR_COST * 2, PAIR_COST + deficit + MARGIN);

    const sale = await admin.post('/sales').send({
      items: [{ variantId, quantity: 1, unitPrice: price }],
      payment: { amount: price, method: 'Espèces' },
      paymentMethod: 'Espèces',
    });
    if (sale.status !== 201) throw new Error(`vente d'appoint ${sale.status}: ${JSON.stringify(sale.body)}`);
    pairsLeft -= 1;
  }

  const last = await dashMoney();
  if (num(last.disposableProfit) < target) {
    throw new Error(`bénéfice disponible ${last.disposableProfit} < ${target}`);
  }
}

describe('Retrait de bénéfice', () => {
  beforeAll(async () => {
    admin = as(await adminToken());
    cashier = as(await tokenFor(`caissier-benefice-${stamp}@test.local`, 'Caissier Bénéfice', 'CASHIER'));

    const supplier = await admin.post('/suppliers').send({ name: `Fournisseur Bénéfice ${stamp}` });
    supplierId = supplier.body.id;

    const product = await admin.post('/products').send({ name: `Modèle Bénéfice ${stamp}` });
    productId = product.body.id;

    const sizes = await admin.get('/sizes?limit=100');
    const found = sizes.body.items.find((s: { value: number }) => s.value === 40);
    if (!found) throw new Error('pointure 40 absente du catalogue');
    sizeId = found.id;

    const variant = await admin
      .post('/variants')
      .send({ productId, sizeId, sellingPrice: 80000 });
    if (variant.status !== 201) throw new Error(`variante ${variant.status}: ${JSON.stringify(variant.body)}`);
    variantId = variant.body.id;
  });

  /* ══════════════ PLAFOND : BÉNÉFICE NET NON SORTI ══════════════ */

  it('refuse un retrait supérieur au bénéfice disponible (409, rien n\'est écrit)', async () => {
    const drawingsBefore = await prisma.profitDrawing.count();
    const ledgerBefore = await prisma.ledgerEntry.count({ where: { refType: 'PROFIT_DRAWING' } });

    const current = await dashMoney();
    const amount = Math.ceil(num(current.disposableProfit)) + 1_000_000;
    const res = await admin.post('/profit-drawings').send({ amount });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.details).toHaveProperty('available');

    expect(await prisma.profitDrawing.count()).toBe(drawingsBefore);
    expect(await prisma.ledgerEntry.count({ where: { refType: 'PROFIT_DRAWING' } })).toBe(ledgerBefore);
  });

  it('refuse un montant nul ou non entier (400)', async () => {
    const res = await admin.post('/profit-drawings').send({ amount: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body.error.details)).toContain('Montant invalide');

    const negative = await admin.post('/profit-drawings').send({ amount: -1000 });
    expect(negative.status).toBe(400);
  });

  it('interdit au caissier de lire ou d\'écrire un retrait (403)', async () => {
    const post = await cashier.post('/profit-drawings').send({ amount: TARGET });
    expect(post.status).toBe(403);
    expect(post.body.error.code).toBe('FORBIDDEN');

    const list = await cashier.get('/profit-drawings');
    expect(list.status).toBe(403);
  });

  /* ══════════════ RETRAIT ══════════════ */

  it('enregistre un retrait dans le plafond et journalise A5 / §45', async () => {
    let before: Record<string, string> | null = null;
    let body: Record<string, any> | null = null;
    let status = 0;

    // Un autre fichier peut dépenser ou retirer entre la mesure et l'écriture :
    // on remonte le disponible puis on réessaie, sans jamais dépasser le plafond.
    for (let attempt = 0; attempt < 3 && status !== 201; attempt++) {
      await ensureDisposable(TARGET + 500_000);
      before = await dashMoney();
      const res = await admin
        .post('/profit-drawings')
        .send({ amount: TARGET, method: 'Espèces', notes: `Retrait ${stamp}` });
      status = res.status;
      body = res.body;
    }

    expect(status).toBe(201);
    drawingId = body!.id;
    expect(body!).toMatchObject({
      amount: `${TARGET}.00`,
      method: 'Espèces',
      notes: `Retrait ${stamp}`,
    });
    expect(body!.user).toHaveProperty('id');

    // A5 : une écriture `PROFIT_DRAWING` sort la caisse, K n'y touche pas.
    const entry = await prisma.ledgerEntry.findFirst({
      where: { refType: 'PROFIT_DRAWING', refId: drawingId, kind: 'PROFIT_DRAWING' },
    });
    expect(entry).toMatchObject({ amount: TARGET, cashDelta: -TARGET });

    // §45 : le retrait ne crée pas de bénéfice, il le sort — total inchangé.
    const after = await dashMoney();
    expect(num(after.profitDrawings)).toBeCloseTo(num(before!.profitDrawings) + TARGET, 2);
    expect(num(after.netProfitAccumulated)).toBeCloseTo(
      num(after.profitDrawings) + num(after.netProfitNotWithdrawn),
      2,
    );

    expect(identityBalance(await accountingIdentity()).delta).toBe(0);
  });

  /* ══════════════ LECTURES ══════════════ */

  it('liste les retraits avec pagination et recherche', async () => {
    const res = await admin.get('/profit-drawings?limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body.items.some((i: { id: string }) => i.id === drawingId)).toBe(true);
    expect(res.body.items[0].amount).toMatch(/^\d+\.\d{2}$/);

    const search = await admin.get(`/profit-drawings?q=${encodeURIComponent(`Retrait ${stamp}`)}`);
    expect(search.status).toBe(200);
    expect(search.body.items.some((i: { id: string }) => i.id === drawingId)).toBe(true);

    const custom = await admin.get('/profit-drawings?period=custom');
    expect(custom.status).toBe(400);
  });

  it('lit un retrait par son identifiant (404 si inconnu)', async () => {
    const res = await admin.get(`/profit-drawings/${drawingId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: drawingId, amount: `${TARGET}.00` });

    const missing = await admin.get('/profit-drawings/inconnu');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  /* ══════════════ CONTRE-PASSATION ══════════════ */

  it('annule un retrait : le bénéfice redevient disponible (A5, identité)', async () => {
    const res = await admin
      .delete(`/profit-drawings/${drawingId}`)
      .send({ reason: `Annulation ${stamp}` });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deleted: true, refundedAmount: `${TARGET}.00` });

    expect(await prisma.profitDrawing.findUnique({ where: { id: drawingId } })).toBeNull();

    // Écriture + contre-écriture : le net rattaché au retrait est nul.
    const { count, amount } = await netOf(drawingId);
    expect(count).toBe(2);
    expect(amount).toBe(0);

    // §45 : le retrait sorti repart à zéro — aucun autre retrait en base.
    const m = await dashMoney();
    expect(num(m.profitDrawings)).toBe(0);

    expect(identityBalance(await accountingIdentity()).delta).toBe(0);
  });

  it('refuse d\'annuler un retrait inconnu (404)', async () => {
    const res = await admin.delete('/profit-drawings/inconnu').send({ reason: 'Rien à annuler' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
