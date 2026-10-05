import { beforeAll, describe, expect, it } from 'vitest';
import { adminToken, as, carton, tokenFor, type AuthedRequest } from './helpers';
import { prisma } from '../src/lib/prisma';
import { accountingIdentity, identityBalance } from './identity';

const stamp = Date.now();

let admin: AuthedRequest;
let manager: AuthedRequest;
let cashier: AuthedRequest;
let supplierId = '';
let customerId = '';
let sellerId = '';

let customerDebtId = '';
let supplierDebtId = '';
let trosaDebtId = '';
let paidDebtId = '';

describe('Dettes & règlements', () => {
  beforeAll(async () => {
    admin = as(await adminToken());
    manager = as(await tokenFor(`manager-dettes-${stamp}@test.local`, 'Manager Dettes', 'MANAGER'));
    cashier = as(await tokenFor(`caissier-dettes-${stamp}@test.local`, 'Caissier Dettes', 'CASHIER'));

    const [supplier, customer, seller] = await Promise.all([
      admin.post('/suppliers').send({ name: `Fournisseur Dette ${stamp}` }),
      admin.post('/customers').send({ name: `Client Dette ${stamp}` }),
      admin.post('/online-sellers').send({ name: `Vendeur Dette ${stamp}` }),
    ]);
    supplierId = supplier.body.id;
    customerId = customer.body.id;
    sellerId = seller.body.id;
  });

  it('crée une créance client manuelle avec motif généré (§30)', async () => {
    const res = await manager.post('/debts').send({ type: 'CUSTOMER', customerId, amount: 75000 });

    expect(res.status).toBe(201);
    const debt = res.body;
    expect(debt).toMatchObject({
      type: 'CUSTOMER',
      direction: 'RECEIVABLE',
      origin: 'MANUAL',
      status: 'OPEN',
      initialAmount: '75000.00',
      paidAmount: '0.00',
      remainingAmount: '75000.00',
      reason: `Dette client déclarée — Client Dette ${stamp}`,
    });
    expect(debt.party).toMatchObject({ id: customerId });

    customerDebtId = debt.id;

    const entry = await prisma.ledgerEntry.findFirst({
      where: { refType: 'DEBT', refId: debt.id, kind: 'OTHER' },
    });
    expect(entry).toMatchObject({ amount: 75000, cashDelta: -75000 });
  });

  it('crée une dette fournisseur avec contrepartie de caisse', async () => {
    const res = await manager.post('/debts').send({ type: 'SUPPLIER', supplierId, amount: 120000 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'SUPPLIER',
      direction: 'PAYABLE',
      origin: 'MANUAL',
      status: 'OPEN',
      remainingAmount: '120000.00',
      reason: `Dette fournisseur déclarée — Fournisseur Dette ${stamp}`,
    });

    supplierDebtId = res.body.id;

    const entry = await prisma.ledgerEntry.findFirst({
      where: { refType: 'DEBT', refId: res.body.id, kind: 'OTHER' },
    });
    expect(entry).toMatchObject({ amount: 120000, cashDelta: 120000 });
  });

  it('filtre la liste par direction : à recevoir / à payer', async () => {
    const payable = await admin.get('/debts?direction=PAYABLE');
    expect(payable.status).toBe(200);
    expect(payable.body.items.length).toBeGreaterThan(0);
    expect(
      payable.body.items.every((d: { direction: string }) => d.direction === 'PAYABLE'),
    ).toBe(true);

    const receivable = await admin.get('/debts?direction=RECEIVABLE');
    expect(receivable.status).toBe(200);
    expect(receivable.body.items.length).toBeGreaterThan(0);
    expect(
      receivable.body.items.every((d: { direction: string }) => d.direction === 'RECEIVABLE'),
    ).toBe(true);

    const invalid = await admin.get('/debts?direction=IN');
    expect(invalid.status).toBe(400);
  });

  it('impose direction PAYABLE pour une trosa sinoa (A1)', async () => {
    const res = await manager.post('/debts').send({ type: 'TROSA_SINOA', partyName: 'Rakoto', amount: 50000 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      type: 'TROSA_SINOA',
      direction: 'PAYABLE',
      status: 'OPEN',
      reason: 'Trosa sinoa — Rakoto',
    });
    expect(res.body.party).toEqual({ name: 'Rakoto' });

    trosaDebtId = res.body.id;

    const entry = await prisma.ledgerEntry.findFirst({
      where: { refType: 'DEBT', refId: res.body.id, kind: 'TROSA_BORROW' },
    });
    expect(entry).toMatchObject({ amount: 50000, cashDelta: 50000 });
  });

  it('valide la cohérence du tiers et le montant', async () => {
    const noParty = await manager.post('/debts').send({ type: 'TROSA_SINOA', amount: 10000 });
    expect(noParty.status).toBe(400);

    const wrongParty = await manager
      .post('/debts')
      .send({ type: 'CUSTOMER', customerId, partyName: 'Rakoto', amount: 10000 });
    expect(wrongParty.status).toBe(400);

    const noCustomer = await manager.post('/debts').send({ type: 'CUSTOMER', amount: 10000 });
    expect(noCustomer.status).toBe(400);

    const unknownCustomer = await manager
      .post('/debts')
      .send({ type: 'CUSTOMER', customerId: 'inconnu', amount: 10000 });
    expect(unknownCustomer.status).toBe(404);

    const overpaid = await manager
      .post('/debts')
      .send({ type: 'CUSTOMER', customerId, amount: 10000, paidAmount: 20000 });
    expect(overpaid.status).toBe(422);
  });

  it('encaisse par règlements multiples jusqu\'à PAID', async () => {
    const created = await manager
      .post('/debts')
      .send({ type: 'CUSTOMER', customerId, amount: 100000, reason: `Règlements multiples ${stamp}` });
    expect(created.status).toBe(201);
    paidDebtId = created.body.id;

    const first = await manager.post(`/debts/${paidDebtId}/payments`).send({ amount: 40000, method: 'Espèces' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'PARTIAL', paidAmount: '40000.00', remainingAmount: '60000.00' });
    expect(first.body.payments).toHaveLength(1);

    const second = await manager.post(`/debts/${paidDebtId}/payments`).send({ amount: 60000, method: 'Mobile Money' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ status: 'PAID', paidAmount: '100000.00', remainingAmount: '0.00' });
    expect(second.body.payments).toHaveLength(2);
    expect(second.body.history).toHaveLength(3); // création + 2 règlements

    const third = await manager.post(`/debts/${paidDebtId}/payments`).send({ amount: 1000 });
    expect(third.status).toBe(422);
    expect(third.body.error.message).toContain('déjà réglée');

    const entries = await prisma.ledgerEntry.findMany({ where: { debtId: paidDebtId }, orderBy: { seq: 'asc' } });
    expect(entries.map((e) => e.kind)).toEqual(['OTHER', 'CUSTOMER_PAYMENT', 'CUSTOMER_PAYMENT']);
    expect(entries.map((e) => e.amount)).toEqual([100000, 40000, 60000]);
    expect(entries.map((e) => e.cashDelta)).toEqual([-100000, 40000, 60000]);
  });

  it('refuse un règlement supérieur au reste à payer', async () => {
    const res = await manager.post(`/debts/${trosaDebtId}/payments`).send({ amount: 999999 });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('dépasse le reste à payer');

    const partial = await manager.post(`/debts/${trosaDebtId}/payments`).send({ amount: 20000 });
    expect(partial.status).toBe(200);
    expect(partial.body).toMatchObject({ status: 'PARTIAL', remainingAmount: '30000.00' });

    const entries = await prisma.ledgerEntry.findMany({ where: { debtId: trosaDebtId, kind: 'TROSA_REPAY' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ amount: 20000, cashDelta: -20000 });
  });

  it('accepte POST /payments rattaché à une dette', async () => {
    const res = await manager.post('/payments').send({ debtId: supplierDebtId, amount: 70000, method: 'Espèces' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'PARTIAL', remainingAmount: '50000.00' });

    const entry = await prisma.ledgerEntry.findFirst({
      where: { debtId: supplierDebtId, kind: 'SUPPLIER_PAYMENT' },
    });
    expect(entry).toMatchObject({ amount: 70000, cashDelta: -70000 });
  });

  it('publie la synthèse et le journal des règlements', async () => {
    const summary = await admin.get('/debts/summary');
    expect(summary.status).toBe(200);
    const b = summary.body;
    expect(b.customer.count).toBeGreaterThanOrEqual(2);
    expect(b.supplier.count).toBeGreaterThanOrEqual(1);
    expect(b.trosaSinoa.count).toBeGreaterThanOrEqual(1);

    const receivable = Number(b.customer.remainingAmount) + Number(b.onlineSeller.remainingAmount);
    const payable = Number(b.supplier.remainingAmount) + Number(b.trosaSinoa.remainingAmount);
    expect(Number(b.totals.receivable)).toBe(receivable);
    expect(Number(b.totals.payable)).toBe(payable);
    expect(Number(b.totals.net)).toBe(receivable - payable);
    expect(Number(b.customer.remainingAmount)).toBeGreaterThanOrEqual(75000);

    const list = await admin.get(`/debts?type=SUPPLIER&status=PARTIAL`);
    expect(list.status).toBe(200);
    expect(list.body.items.some((d: { id: string }) => d.id === supplierDebtId)).toBe(true);

    const payments = await admin.get(`/payments?debtId=${supplierDebtId}`);
    expect(payments.status).toBe(200);
    expect(payments.body.items).toHaveLength(1);
    expect(payments.body.items[0]).toMatchObject({ direction: 'OUT', partyType: 'SUPPLIER', amount: '70000.00' });
  });

  it('regroupe les dettes par tiers (GET /debts/by-party)', async () => {
    const res = await admin.get('/debts/by-party?direction=PAYABLE');
    expect(res.status).toBe(200);

    // une seule ligne par personne, même si elle a plusieurs dettes
    const keys = res.body.items.map((g: { key: string }) => g.key);
    expect(new Set(keys).size).toBe(keys.length);

    const supplierGroup = res.body.items.find(
      (g: { party: { id: string | null } }) => g.party.id === supplierId,
    );
    expect(supplierGroup).toMatchObject({
      type: 'SUPPLIER',
      direction: 'PAYABLE',
      party: { id: supplierId, name: `Fournisseur Dette ${stamp}` },
    });
    expect(supplierGroup.count).toBeGreaterThanOrEqual(1);
    expect(supplierGroup.statusCounts.PARTIAL).toBeGreaterThanOrEqual(1);

    // le total du groupe est la somme exacte des dettes de ce tiers
    const detail = await admin.get(`/debts?partyId=${supplierId}`);
    expect(detail.body.total).toBe(supplierGroup.count);
    const sum = detail.body.items.reduce(
      (s: number, d: { remainingAmount: string }) => s + Number(d.remainingAmount),
      0,
    );
    expect(Number(supplierGroup.remainingAmount)).toBe(sum);

    // trosa sinoa : pas de tiers enregistré, regroupée par nom
    const trosa = res.body.items.find(
      (g: { type: string; party: { name: string } }) =>
        g.type === 'TROSA_SINOA' && g.party.name === 'Rakoto',
    );
    expect(trosa).toMatchObject({ party: { id: null, name: 'Rakoto' }, direction: 'PAYABLE' });

    const byName = await admin.get(`/debts?partyName=${encodeURIComponent('Rakoto')}`);
    expect(byName.status).toBe(200);
    expect(byName.body.items.some((d: { id: string }) => d.id === trosaDebtId)).toBe(true);
    expect(byName.body.items.every((d: { type: string }) => d.type === 'TROSA_SINOA')).toBe(true);

    // les filtres s'appliquent aussi au groupement
    const paidOnly = await admin.get('/debts/by-party?status=PAID');
    expect(paidOnly.status).toBe(200);
    expect(
      paidOnly.body.items.every(
        (g: { statusCounts: Record<string, number> }) => g.statusCounts.OPEN === 0,
      ),
    ).toBe(true);
  });

  it('annule une dette manuelle par contre-passation', async () => {
    const created = await manager
      .post('/debts')
      .send({ type: 'CUSTOMER', customerId, amount: 30000, reason: `À annuler ${stamp}` });
    const id = created.body.id;

    const before = await prisma.ledgerEntry.count({ where: { debtId: id } });

    const cancelled = await manager.post(`/debts/${id}/cancel`).send({ reason: 'Saisie erronée' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Saisie erronée' });

    const after = await prisma.ledgerEntry.findMany({ where: { debtId: id }, orderBy: { seq: 'asc' } });
    expect(after).toHaveLength(before + 1);
    expect(after[after.length - 1]).toMatchObject({ kind: 'OTHER', amount: -30000, cashDelta: 30000 });

    const again = await manager.post(`/debts/${id}/cancel`).send({ reason: 'Encore' });
    expect(again.status).toBe(422);

    const list = await admin.get('/debts?status=CANCELLED&q=' + encodeURIComponent(`À annuler ${stamp}`));
    expect(list.body.items.some((d: { id: string }) => d.id === id)).toBe(true);
  });

  it('refuse d\'annuler une dette née d\'une vente', async () => {
    const product = await admin.post('/products').send({ name: `Modèle Dette ${stamp}` });
    const sizes = await admin.get('/sizes?limit=100');
    const size40 = sizes.body.items.find((s: { value: number }) => s.value === 40);
    const variant = await admin
      .post('/variants')
      .send({ productId: product.body.id, sizeId: size40.id, sellingPrice: 40000 });

    await admin.post('/arrivals').send({
      supplierId,
      cartons: [carton(product.body.id, size40.id, 3, 25000)],
    });

    const sale = await admin.post('/sales').send({
      customerId,
      items: [{ variantId: variant.body.id, quantity: 1, unitPrice: 40000 }],
    });
    expect(sale.status).toBe(201);
    expect(sale.body.debt.origin).toBe('SALE');

    const res = await manager.post(`/debts/${sale.body.debt.id}/cancel`).send({ reason: 'Tentative' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('annulez la vente');

    const cancelledSale = await admin.post(`/sales/${sale.body.id}/cancel`).send({ reason: 'Annulation ventes' });
    expect(cancelledSale.status).toBe(200);
    const debtAfter = await admin.get(`/debts/${sale.body.debt.id}`);
    expect(debtAfter.body.status).toBe('CANCELLED');
  });

  it('applique le RBAC', async () => {
    expect((await cashier.get('/debts')).status).toBe(200);
    expect((await cashier.get('/debts/summary')).status).toBe(200);
    expect((await cashier.get('/payments')).status).toBe(200);

    const create = await cashier.post('/debts').send({ type: 'CUSTOMER', customerId, amount: 1000 });
    expect(create.status).toBe(403);

    const pay = await cashier.post(`/debts/${supplierDebtId}/payments`).send({ amount: 1000 });
    expect(pay.status).toBe(403);

    const pay2 = await cashier.post('/payments').send({ debtId: supplierDebtId, amount: 1000 });
    expect(pay2.status).toBe(403);

    const cancel = await cashier.post(`/debts/${supplierDebtId}/cancel`).send({ reason: 'x' });
    expect(cancel.status).toBe(403);

    expect((await manager.get('/debts')).status).toBe(200);
  });

  it('404 sur une dette inconnue', async () => {
    expect((await admin.get('/debts/id-inconnu')).status).toBe(404);
    expect((await admin.post('/payments').send({ debtId: 'id-inconnu', amount: 1000 })).status).toBe(404);
  });

  it('identité comptable après les opérations manuelles', async () => {
    const snapshot = await accountingIdentity();
    const { lhs, rhs, delta } = identityBalance(snapshot);

    expect(snapshot.recv).toBeGreaterThan(0);
    expect(snapshot.liab).toBeGreaterThan(0);
    expect(delta).toBe(0);
    expect(lhs).toBe(rhs);
  });
});
