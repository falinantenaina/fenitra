import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { adminToken, as, type AuthedRequest } from './helpers';
import { accountingIdentity, identityBalance } from './identity';

/**
 * Scénarios E2E de bout en bout — voir `docs/ANALYSE.md` §16.
 *
 * Les 12 scénarios sont joués dans l'ordre, chacun avec **son propre jeu de
 * données** (noms et montants uniques) pour que la suite soit reproductible
 * quel que soit l'ordre des fichiers de test.
 */
const stamp = Date.now();
const WIDE = 'period=custom&from=2020-01-01&to=2100-12-31';

let admin: AuthedRequest;
let supplierId = '';
let customerId = '';
let variantA = '';
let variantC = '';
let categoryId = '';

let arrival1Id = '';
let arrival2Id = '';
let arrival3Id = '';
let arrival4Id = '';
let saleId = '';
let creditSaleId = '';
let creditSaleDebtId = '';
let trosaDebtId = '';

const ledger = (refType: string, refId: string) =>
  prisma.ledgerEntry.findMany({ where: { refType, refId } });

const sum = <K extends 'amount' | 'cashDelta'>(rows: { amount: number; cashDelta: number }[], key: K) =>
  rows.reduce((s, r) => s + r[key], 0);

describe('12 scénarios E2E', () => {
  beforeAll(async () => {
    admin = as(await adminToken());

    // Catégorie créée pour ce fichier : `items[0]` d'une liste partagée peut
    // être une catégorie temporaire qu'un autre fichier désactive en parallèle.
    const [supplier, customer, category, sizes] = await Promise.all([
      admin.post('/suppliers').send({ name: `Fournisseur E2E ${stamp}` }),
      admin.post('/customers').send({ name: `Client E2E ${stamp}` }),
      admin.post('/expense-categories').send({ name: `Divers E2E ${stamp}`, icon: 'box' }),
      admin.get('/sizes?limit=100'),
    ]);
    supplierId = supplier.body.id;
    customerId = customer.body.id;
    if (category.status !== 201) {
      throw new Error(`Catégorie E2E ${category.status}: ${JSON.stringify(category.body)}`);
    }
    categoryId = category.body.id;

    const size40 = sizes.body.items.find((s: { value: number }) => s.value === 40);
    const size42 = sizes.body.items.find((s: { value: number }) => s.value === 42);
    if (!size40 || !size42) throw new Error('Pointures 40/42 absentes des référentiels');

    const product = await admin.post('/products').send({ name: `Chaussures E2E ${stamp}` });
    const [va, vc] = await Promise.all([
      admin
        .post('/variants')
        .send({ productId: product.body.id, sizeId: size40.id, sellingPrice: 45000 }),
      admin
        .post('/variants')
        .send({ productId: product.body.id, sizeId: size42.id, sellingPrice: 50000 }),
    ]);
    variantA = va.body.id;
    variantC = vc.body.id;
  });

  /** E2E-01 — arrivage complet réglé d'emblée (Phase 5c). */
  it('E2E-01 : arrivage complet réglé → lots, stock et journal', async () => {
    const res = await admin.post('/arrivals').send({
      supplierId,
      cartons: [{ items: [{ variantId: variantA, quantity: 6, unitCost: 20000 }] }],
      payment: { amount: 120000, method: 'Espèces' },
    });
    expect(res.status).toBe(201);
    arrival1Id = res.body.id;
    expect(res.body.reference).toMatch(/^ARR-\d{4}$/);
    expect(res.body.totalCost).toBe('120000.00');
    expect(res.body.paidAmount).toBe('120000.00');
    expect(res.body.unpaidAmount).toBe('0.00');
    expect(res.body.lots).toHaveLength(1);
    expect(res.body.lots[0].remainingQty).toBe(6);
    expect(res.body.lots[0].unitCost).toBe('20000.00');
    expect(res.body.debt === null || res.body.debt.status === 'PAID').toBe(true);

    const stock = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(stock.body.quantity).toBe(6);
    expect(stock.body.value).toBe('120000.00');

    const entries = await ledger('ARRIVAL', arrival1Id);
    const payment = entries.filter((e) => e.kind === 'SUPPLIER_PAYMENT');
    expect(sum(payment, 'amount')).toBe(120000);
    expect(sum(payment, 'cashDelta')).toBe(-120000);
  });

  /** E2E-02 — arrivage à crédit partiel (Phase 5c). */
  it('E2E-02 : arrivage partiellement réglé → dette fournisseur ouverte', async () => {
    const res = await admin.post('/arrivals').send({
      supplierId,
      cartons: [{ items: [{ variantId: variantA, quantity: 6, unitCost: 23000 }] }],
      payment: { amount: 50000, method: 'Espèces' },
    });
    expect(res.status).toBe(201);
    arrival2Id = res.body.id;
    expect(res.body.unpaidAmount).toBe('88000.00');
    expect(res.body.debt.status).toBe('PARTIAL');
    expect(res.body.debt.initialAmount).toBe('138000.00');
    expect(res.body.debt.paidAmount).toBe('50000.00');
    expect(res.body.debt.remainingAmount).toBe('88000.00');
    expect(res.body.debt.direction).toBe('PAYABLE');

    const stock = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(stock.body.quantity).toBe(12);
    expect(stock.body.value).toBe('258000.00');

    const entries = await ledger('ARRIVAL', arrival2Id);
    expect(sum(entries.filter((e) => e.kind === 'SUPPLIER_PAYMENT'), 'cashDelta')).toBe(-50000);
  });

  /** E2E-03 — annulation d'un arrivage (Phase 5c). */
  it('E2E-03 : annulation d’arrivage → lots et dette annulés, journal contre-passé', async () => {
    const res = await admin.post('/arrivals').send({
      supplierId,
      cartons: [{ items: [{ variantId: variantC, quantity: 4, unitCost: 25000 }] }],
      payment: { amount: 40000, method: 'Espèces' },
    });
    expect(res.status).toBe(201);
    arrival3Id = res.body.id;
    expect(res.body.debt.status).toBe('PARTIAL');
    expect(res.body.debt.remainingAmount).toBe('60000.00');

    const stockBefore = await admin.get(`/stock/summary?variantId=${variantC}`);
    expect(stockBefore.body.quantity).toBe(4);

    const cancelled = await admin
      .post(`/arrivals/${arrival3Id}/cancel`)
      .send({ reason: 'Lot endommagé à la réception E2E' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.debt.status).toBe('CANCELLED');
    expect(cancelled.body.lots.every((l: { status: string }) => l.status === 'CANCELLED')).toBe(true);

    const stockAfter = await admin.get(`/stock/summary?variantId=${variantC}`);
    expect(stockAfter.body.quantity).toBe(0);
    expect(stockAfter.body.value).toBe('0.00');

    const entries = await ledger('ARRIVAL', arrival3Id);
    expect(sum(entries, 'amount')).toBe(0);
    expect(sum(entries, 'cashDelta')).toBe(0);
    expect(entries.filter((e) => e.amount > 0)).toHaveLength(entries.filter((e) => e.amount < 0).length);
  });

  /** E2E-04 — vente FIFO avec COGS figé (Phase 5d). */
  it('E2E-04 : vente FIFO → allocation par lot, COGS et marge', async () => {
    const res = await admin.post('/sales').send({
      customerId,
      items: [{ variantId: variantA, quantity: 10, unitPrice: 45000 }],
      payment: { amount: 450000, method: 'Espèces' },
    });
    expect(res.status).toBe(201);
    saleId = res.body.id;
    expect(res.body.status).toBe('PAID');
    expect(res.body.totalAmount).toBe('450000.00');
    expect(res.body.cogs).toBe('212000.00');
    expect(res.body.margin).toBe('238000.00');

    const lots = res.body.items[0].lots;
    expect(lots).toHaveLength(2);
    expect(lots[0]).toMatchObject({ quantity: 6, unitCost: '20000.00' });
    expect(lots[1]).toMatchObject({ quantity: 4, unitCost: '23000.00' });

    const entries = await ledger('SALE', saleId);
    expect(sum(entries.filter((e) => e.kind === 'SALE'), 'amount')).toBe(450000);
    expect(sum(entries.filter((e) => e.kind === 'SALE'), 'cashDelta')).toBe(450000);
    expect(sum(entries.filter((e) => e.kind === 'COGS'), 'amount')).toBe(212000);
    expect(sum(entries.filter((e) => e.kind === 'COGS'), 'cashDelta')).toBe(0);

    const stock = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(stock.body.quantity).toBe(2);
    expect(stock.body.value).toBe('46000.00');
  });

  /** E2E-05 — annulation de vente (Phase 5d). */
  it('E2E-05 : annulation de vente → restitution dans les mêmes lots', async () => {
    const res = await admin.post(`/sales/${saleId}/cancel`).send({ reason: 'Client E2E annulée' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');

    const stock = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(stock.body.quantity).toBe(12);
    expect(stock.body.value).toBe('258000.00');

    const lots = await admin.get(`/stock/lots?variantId=${variantA}&status=OPEN`);
    expect(lots.body.items).toHaveLength(2);
    const remaining = lots.body.items
      .map((l: { remainingQty: number }) => l.remainingQty)
      .sort((a: number, b: number) => a - b);
    expect(remaining).toEqual([6, 6]);

    const entries = await ledger('SALE', saleId);
    expect(sum(entries.filter((e) => e.kind === 'SALE'), 'amount')).toBe(0);
    expect(sum(entries.filter((e) => e.kind === 'SALE'), 'cashDelta')).toBe(0);
    expect(sum(entries.filter((e) => e.kind === 'COGS'), 'amount')).toBe(0);
    expect(entries.filter((e) => e.amount > 0)).toHaveLength(entries.filter((e) => e.amount < 0).length);
  });

  /** E2E-06 — vente à crédit (Phase 5d). */
  it('E2E-06 : vente à crédit → dette client avec motif auto', async () => {
    const res = await admin.post('/sales').send({
      customerId,
      items: [{ variantId: variantA, quantity: 2, unitPrice: 50000 }],
    });
    expect(res.status).toBe(201);
    creditSaleId = res.body.id;
    expect(res.body.status).toBe('UNPAID');
    expect(res.body.paidAmount).toBe('0.00');
    expect(res.body.remainingAmount).toBe('100000.00');
    expect(res.body.debt.status).toBe('OPEN');
    expect(res.body.debt.origin).toBe('SALE');
    expect(res.body.debt.reason).toContain('non payé');
    creditSaleDebtId = res.body.debt.id;

    const entries = await ledger('SALE', creditSaleId);
    expect(sum(entries.filter((e) => e.kind === 'SALE'), 'amount')).toBe(100000);
    expect(sum(entries.filter((e) => e.kind === 'SALE'), 'cashDelta')).toBe(0);
    expect(entries.filter((e) => e.kind === 'CUSTOMER_PAYMENT')).toHaveLength(0);

    const stock = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(stock.body.quantity).toBe(10);
    expect(stock.body.value).toBe('218000.00');
  });

  /** E2E-07 — dettes génériques et paiements multiples (Phase 5e). */
  it('E2E-07 : dettes manuelles → contrepartie de caisse, transitions et garde-fous', async () => {
    const trosa = await admin.post('/debts').send({
      type: 'TROSA_SINOA',
      partyName: `Ravo E2E ${stamp}`,
      amount: 50000,
      motif: 'Emprunt trosa sinoa E2E',
    });
    expect(trosa.status).toBe(201);
    trosaDebtId = trosa.body.id;
    expect(trosa.body.direction).toBe('PAYABLE');
    expect(trosa.body.status).toBe('OPEN');
    expect(trosa.body.reason).toContain('Trosa sinoa');
    expect(trosa.body.reason).toContain(`Ravo E2E ${stamp}`);

    const trosaEntries = await ledger('DEBT', trosaDebtId);
    expect(sum(trosaEntries.filter((e) => e.kind === 'TROSA_BORROW'), 'amount')).toBe(50000);
    expect(sum(trosaEntries.filter((e) => e.kind === 'TROSA_BORROW'), 'cashDelta')).toBe(50000);

    const first = await admin.post(`/debts/${trosaDebtId}/payments`).send({ amount: 20000 });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('PARTIAL');
    expect(first.body.remainingAmount).toBe('30000.00');

    const tooMuch = await admin.post(`/debts/${trosaDebtId}/payments`).send({ amount: 40000 });
    expect(tooMuch.status).toBe(422);

    const still = await admin.get(`/debts/${trosaDebtId}`);
    expect(still.body.remainingAmount).toBe('30000.00');
    expect(still.body.status).toBe('PARTIAL');

    const customerDebt = await admin.post('/debts').send({
      type: 'CUSTOMER',
      customerId,
      amount: 40000,
    });
    expect(customerDebt.status).toBe(201);
    expect(customerDebt.body.status).toBe('OPEN');
    expect(customerDebt.body.direction).toBe('RECEIVABLE');
    expect(customerDebt.body.reason).toContain('Dette client déclarée');

    const part = await admin
      .post(`/debts/${customerDebt.body.id}/payments`)
      .send({ amount: 10000, method: 'Espèces' });
    expect(part.body.status).toBe('PARTIAL');
    expect(part.body.remainingAmount).toBe('30000.00');

    const paid = await admin
      .post(`/debts/${customerDebt.body.id}/payments`)
      .send({ amount: 30000, method: 'Espèces' });
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.remainingAmount).toBe('0.00');

    const saleDebt = await admin.get(`/debts/${creditSaleDebtId}`);
    expect(saleDebt.body.origin).toBe('SALE');
    const cancelRefused = await admin
      .post(`/debts/${creditSaleDebtId}/cancel`)
      .send({ reason: 'Tentative d’annulation d’une dette née d’une vente' });
    expect(cancelRefused.status).toBe(422);
  });

  /** E2E-08 — valorisation à une date + historique des prix d'achat (Phase 5c). */
  it('E2E-08 : valorisation à la date de la vente + historique des prix d’achat', async () => {
    const sale = await admin.get(`/sales/${creditSaleId}`);
    // Frontière déterministe : `to` est filtré par `date < at`, donc à l'instant
    // exact de la vente, sa propre sortie de stock n'est pas encore appliquée —
    // ni aucun écart de quelques millisecondes entre les ventes précédentes.
    const atSale = await admin.get(`/stock/summary?variantId=${variantA}&to=${sale.body.date}`);
    expect(atSale.body.quantity).toBe(12);
    expect(atSale.body.value).toBe('258000.00');

    const now = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(now.body.quantity).toBe(10);
    expect(now.body.value).toBe('218000.00');

    const history = await admin.get(`/variants/${variantA}/price-history`);
    expect(history.status).toBe(200);
    const costs = history.body.items.map((i: { unitCost: string }) => i.unitCost);
    expect(costs).toContain('20000.00');
    expect(costs).toContain('23000.00');
    expect(history.body.total).toBeGreaterThanOrEqual(2);
  });

  /** E2E-09 — lots, mouvements et ajustement (perte) en FIFO (Phase 5c). */
  it('E2E-09 : lots FIFO, piste d’audit et ajustement de perte', async () => {
    const lots = await admin.get(`/stock/lots?variantId=${variantA}`);
    expect(lots.body.items).toHaveLength(2);
    expect(lots.body.items[0].remainingQty).toBe(4);
    expect(lots.body.items[1].remainingQty).toBe(6);
    expect(new Date(lots.body.items[0].entryDate).getTime()).toBeLessThanOrEqual(
      new Date(lots.body.items[1].entryDate).getTime(),
    );

    const firstLot = lots.body.items[0].id;
    const movements = await admin.get(`/stock/lots/${firstLot}/movements`);
    expect(movements.status).toBe(200);
    expect(movements.body.items.some((m: { type: string; delta: number }) => m.type === 'IN' && m.delta === 6)).toBe(
      true,
    );
    expect(movements.body.items.some((m: { type: string; delta: number }) => m.type === 'OUT' && m.delta === -2)).toBe(
      true,
    );

    const adjustment = await admin.post('/stock/adjustments').send({
      variantId: variantA,
      qty: 2,
      reason: 'Casse à l’entrepôt E2E',
    });
    expect(adjustment.status).toBe(201);
    expect(adjustment.body.lostValue).toBe('40000.00');
    expect(adjustment.body.allocations[0]).toMatchObject({ quantity: 2, unitCost: '20000.00' });

    const expenseEntries = await ledger('EXPENSE', adjustment.body.expenseId);
    expect(expenseEntries).toHaveLength(1);
    expect(expenseEntries[0]!.amount).toBe(40000);
    expect(expenseEntries[0]!.cashDelta).toBe(0);

    const stock = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(stock.body.quantity).toBe(8);
    expect(stock.body.value).toBe('178000.00');
  });

  /** E2E-10 — règlements successifs d'une vente (Phase 5d). */
  it('E2E-10 : règlements partiels → UNPAID → PARTIAL → PAID', async () => {
    const partial = await admin
      .post(`/sales/${creditSaleId}/payments`)
      .send({ amount: 30000, method: 'Espèces' });
    expect(partial.status).toBe(200);
    expect(partial.body.status).toBe('PARTIAL');
    expect(partial.body.paidAmount).toBe('30000.00');
    expect(partial.body.remainingAmount).toBe('70000.00');

    const settled = await admin
      .post(`/sales/${creditSaleId}/payments`)
      .send({ amount: 70000, method: 'Mobile Money' });
    expect(settled.body.status).toBe('PAID');
    expect(settled.body.remainingAmount).toBe('0.00');
    expect(settled.body.debt.status).toBe('PAID');

    const entries = await ledger('SALE', creditSaleId);
    const received = entries.filter((e) => e.kind === 'CUSTOMER_PAYMENT');
    expect(received).toHaveLength(2);
    expect(sum(received, 'amount')).toBe(100000);
    expect(sum(received, 'cashDelta')).toBe(100000);

    const stock = await admin.get(`/stock/summary?variantId=${variantA}`);
    expect(stock.body.quantity).toBe(8);
  });

  /** E2E-11 — dépenses et versements (A2) (Phase 5f). */
  it('E2E-11 : dépense toujours réglée + versement → DEBT_SETTLEMENT ou CHARGE', async () => {
    const expense = await admin.post('/expenses').send({
      categoryId,
      amount: 9000,
      description: `Carburant tuk-tuk E2E ${stamp}`,
      method: 'Espèces',
    });
    expect(expense.status).toBe(201);
    const expenseEntries = await ledger('EXPENSE', expense.body.id);
    expect(expenseEntries).toHaveLength(1);
    expect(expenseEntries[0]!.amount).toBe(9000);
    expect(expenseEntries[0]!.cashDelta).toBe(-9000);

    const settle = await admin.post('/versements').send({
      personName: `Ravo E2E ${stamp}`,
      amount: 20000,
      motif: 'Remboursement trosa E2E',
      method: 'Espèces',
    });
    expect(settle.status).toBe(201);
    expect(settle.body.treatment).toBe('DEBT_SETTLEMENT');
    const settleEntries = await ledger('VERSEMENT', settle.body.id);
    expect(settleEntries.every((e) => e.kind === 'TROSA_REPAY')).toBe(true);
    expect(sum(settleEntries, 'cashDelta')).toBe(-20000);

    const trosa = await admin.get(`/debts/${trosaDebtId}`);
    expect(trosa.body.remainingAmount).toBe('10000.00');
    expect(trosa.body.status).toBe('PARTIAL');

    const charge = await admin.post('/versements').send({
      personName: `Personne sans dette E2E ${stamp}`,
      amount: 5000,
      motif: 'Cadeau famille E2E',
      method: 'Espèces',
    });
    expect(charge.status).toBe(201);
    expect(charge.body.treatment).toBe('CHARGE');
    const chargeEntries = await ledger('VERSEMENT', charge.body.id);
    expect(chargeEntries.every((e) => e.kind === 'VERSEMENT')).toBe(true);
    expect(sum(chargeEntries, 'amount')).toBe(5000);
    expect(sum(chargeEntries, 'cashDelta')).toBe(-5000);

    const removed = await admin
      .delete(`/versements/${charge.body.id}`)
      .send({ reason: 'Versement saisi par erreur E2E' });
    expect(removed.status).toBe(200);
    const afterDelete = await ledger('VERSEMENT', charge.body.id);
    expect(sum(afterDelete, 'amount')).toBe(0);
    expect(sum(afterDelete, 'cashDelta')).toBe(0);
  });

  /** E2E-12 — argent propre, trosa et financement mixte (A7) + identité (Phase 5f). */
  it('E2E-12 : injection propre liée à un arrivage sans double comptage + identité exacte', async () => {
    const arrival = await admin.post('/arrivals').send({
      supplierId,
      cartons: [{ items: [{ variantId: variantC, quantity: 3, unitCost: 10000 }] }],
      notes: 'Arrivage financé par l’argent propre E2E',
    });
    expect(arrival.status).toBe(201);
    arrival4Id = arrival.body.id;
    expect(arrival.body.debt.status).toBe('OPEN');
    expect(arrival.body.debt.remainingAmount).toBe('30000.00');

    const capital = await admin.post('/personal-capital').send({
      type: 'IN',
      amount: 30000,
      motif: `Injection propre E2E ${stamp}`,
      destinationType: 'ARRIVAL',
      destinationId: arrival4Id,
    });
    expect(capital.status).toBe(201);
    const capitalEntries = await ledger('CAPITAL', capital.body.id);
    expect(sum(capitalEntries.filter((e) => e.kind === 'PERSONAL_CAPITAL_IN'), 'amount')).toBe(30000);
    expect(sum(capitalEntries.filter((e) => e.kind === 'PERSONAL_CAPITAL_IN'), 'cashDelta')).toBe(30000);

    const payment = await admin.post('/payments').send({
      debtId: arrival.body.debt.id,
      amount: 30000,
      method: 'Espèces',
    });
    expect(payment.status).toBe(200);
    expect(payment.body.remainingAmount ?? payment.body.debt?.remainingAmount ?? '0.00').toBe('0.00');

    const paymentEntries = await ledger('DEBT', arrival.body.debt.id);
    expect(sum(paymentEntries.filter((e) => e.kind === 'SUPPLIER_PAYMENT'), 'cashDelta')).toBe(-30000);
    expect(sum(paymentEntries, 'cashDelta')).toBe(-30000);
    expect(sum(capitalEntries, 'cashDelta') + sum(paymentEntries, 'cashDelta')).toBe(0);

    const resolved = await admin.get(`/personal-capital/${capital.body.id}/destinations`);
    expect(resolved.status).toBe(200);
    expect(Array.isArray(resolved.body.destinations)).toBe(true);
    expect(resolved.body.destinations.length).toBeGreaterThan(0);
    expect(JSON.stringify(resolved.body.destinations)).toContain('ARR-');

    const dashboard = await admin.get(`/dashboard?${WIDE}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.integrity.identityDelta).toBe(0);

    const snapshot = await accountingIdentity();
    const balance = identityBalance(snapshot);
    expect(balance.delta).toBe(0);
    expect(snapshot.lots).toBeGreaterThan(0);
  });
});
