import { beforeAll, describe, expect, it } from 'vitest';
import { adminToken, as, tokenFor, type AuthedRequest } from './helpers';
import { prisma } from '../src/lib/prisma';
import { accountingIdentity, identityBalance } from './identity';

const stamp = Date.now();

let admin: AuthedRequest;
let cashier: AuthedRequest;

let categoryId = '';
let expenseId = '';
let expenseAmount = 15000;

let trosaDebtId = '';
let settlementVersementId = '';
let chargeVersementId = '';
let capitalInId = '';

const netOf = async (refType: string, refId: string) => {
  const entries = await prisma.ledgerEntry.findMany({ where: { refType, refId } });
  return entries.reduce((s, e) => s + e.amount, 0);
};

describe('Finances — dépenses, versements, argent propre, trosa', () => {
  beforeAll(async () => {
    admin = as(await adminToken());
    cashier = as(await tokenFor(`caissier-fin-${stamp}@test.local`, 'Caissier Finances', 'CASHIER'));

    const categories = await admin.get('/expense-categories');
    categoryId = categories.body.items[0].id;
  });

  /* ══════════════ DÉPENSES ══════════════ */

  it('enregistre une dépense réglée immédiatement (A8)', async () => {
    const res = await admin.post('/expenses').send({
      categoryId,
      amount: expenseAmount,
      description: `Loyer atelier ${stamp}`,
      method: 'Espèces',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      amount: '15000.00',
      description: `Loyer atelier ${stamp}`,
      category: { id: categoryId },
    });

    expenseId = res.body.id;

    const entry = await prisma.ledgerEntry.findFirst({
      where: { refType: 'EXPENSE', refId: expenseId, kind: 'EXPENSE' },
    });
    expect(entry).toMatchObject({ amount: 15000, cashDelta: -15000 });
  });

  it('refuse une dépense dans une catégorie désactivée ou inconnue', async () => {
    const unknown = await admin
      .post('/expenses')
      .send({ categoryId: 'inconnue', amount: 1000, description: 'Test' });
    expect(unknown.status).toBe(404);

    const disabled = await admin.post('/expense-categories').send({ name: `Temp ${stamp}` });
    expect(disabled.status).toBe(201);
    await admin
      .put(`/expense-categories/${disabled.body.id}`)
      .send({ active: false, name: disabled.body.name });

    const res = await admin
      .post('/expenses')
      .send({ categoryId: disabled.body.id, amount: 1000, description: 'Test catégorie fermée' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('désactivée');
  });

  it('filtre les dépenses par catégorie', async () => {
    const res = await admin.get(`/expenses?categoryId=${categoryId}&limit=100`);
    expect(res.status).toBe(200);
    expect(res.body.items.some((e: { id: string }) => e.id === expenseId)).toBe(true);

    const summary = await admin.get(`/expenses/summary?categoryId=${categoryId}`);
    expect(summary.status).toBe(200);
    expect(Number(summary.body.totalAmount)).toBeGreaterThanOrEqual(15000);
  });

  it('corrige une dépense par contre-passation (PUT)', async () => {
    const res = await admin.put(`/expenses/${expenseId}`).send({
      categoryId,
      amount: 20000,
      description: `Loyer atelier ${stamp} (corrigé)`,
    });
    expect(res.status).toBe(200);
    expect(res.body.amount).toBe('20000.00');

    expect(await netOf('EXPENSE', expenseId)).toBe(20000);

    const again = await admin.put(`/expenses/${expenseId}`).send({
      categoryId,
      amount: 18000,
      description: `Loyer atelier ${stamp} (2e correction)`,
    });
    expect(again.status).toBe(200);
    expect(await netOf('EXPENSE', expenseId)).toBe(18000);

    expenseAmount = 18000;
  });

  it('supprime une dépense et annule son impact (DELETE)', async () => {
    const res = await admin.delete(`/expenses/${expenseId}`).send({ reason: 'Saisie erronée' });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(await netOf('EXPENSE', expenseId)).toBe(0);

    const after = await admin.get(`/expenses?categoryId=${categoryId}&limit=100`);
    expect(after.body.items.some((e: { id: string }) => e.id === expenseId)).toBe(false);

    const missing = await admin.get(`/expenses/${expenseId}`);
    expect(missing.status).toBe(404);
  });

  /* ══════════════ VERSEMENTS (A2) ══════════════ */

  it('détecte automatiquement une dette TROSA ouverte → DEBT_SETTLEMENT (A2)', async () => {
    const debt = await admin.post('/debts').send({
      type: 'TROSA_SINOA',
      partyName: 'Hanitra',
      amount: 60000,
      reason: `Trosa ${stamp}`,
    });
    expect(debt.status).toBe(201);
    trosaDebtId = debt.body.id;

    const res = await admin.post('/versements').send({
      personName: 'HANITRA',
      amount: 20000,
      motif: 'Remboursement hebdo',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      treatment: 'DEBT_SETTLEMENT',
      debtId: trosaDebtId,
      amount: '20000.00',
    });

    settlementVersementId = res.body.id;

    const entry = await prisma.ledgerEntry.findFirst({
      where: { refType: 'VERSEMENT', refId: settlementVersementId },
    });
    expect(entry).toMatchObject({ kind: 'TROSA_REPAY', amount: 20000, cashDelta: -20000 });

    const debtAfter = await admin.get(`/debts/${trosaDebtId}`);
    expect(debtAfter.body).toMatchObject({
      status: 'PARTIAL',
      paidAmount: '20000.00',
      remainingAmount: '40000.00',
    });
  });

  it('traite en CHARGE un versement sans dette ouverte', async () => {
    const res = await admin.post('/versements').send({
      personName: `SansDette ${stamp}`,
      amount: 5000,
      motif: 'Repos hebdomadaire',
      method: 'Espèces',
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ treatment: 'CHARGE', debtId: null });

    chargeVersementId = res.body.id;

    const entry = await prisma.ledgerEntry.findFirst({
      where: { refType: 'VERSEMENT', refId: chargeVersementId },
    });
    expect(entry).toMatchObject({ kind: 'VERSEMENT', amount: 5000, cashDelta: -5000 });
  });

  it('refuse un versement supérieur à la dette restante', async () => {
    const res = await admin.post('/versements').send({
      personName: 'Hanitra',
      amount: 999999,
      motif: 'Trop-plein',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('dépasse la dette restante');

    const explicitMissing = await admin
      .post('/versements')
      .send({ personName: 'Hanitra', amount: 1000, motif: 'Dette inconnue', debtId: 'inconnu' });
    expect(explicitMissing.status).toBe(404);
  });

  it('résume les versements par personne (§38)', async () => {
    const kept = await admin.post('/versements').send({
      personName: `SansDette ${stamp}`,
      amount: 7000,
      motif: 'Prime de fin de semaine',
    });
    expect(kept.status).toBe(201);
    expect(kept.body.treatment).toBe('CHARGE');

    const res = await admin.get(`/versements/summary?personName=Hanitra`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ personName: 'HANITRA', count: 1, amount: '20000.00' });
    expect(res.body.items[0].debtSettlement).toBe('20000.00');
    expect(res.body.items[0].charge).toBe('0.00');

    const all = await admin.get(`/versements/summary?personName=${encodeURIComponent(`SansDette ${stamp}`)}`);
    expect(all.body.items[0]).toMatchObject({ count: 2, amount: '12000.00', charge: '12000.00' });

    const list = await admin.get('/versements?treatment=CHARGE&limit=100');
    expect(list.body.items.some((v: { id: string }) => v.id === chargeVersementId)).toBe(true);
  });

  it('annule un versement CHARGE et restitue la dette réglée', async () => {
    const charge = await admin.delete(`/versements/${chargeVersementId}`).send({ reason: 'Doublon' });
    expect(charge.status).toBe(200);
    expect(await netOf('VERSEMENT', chargeVersementId)).toBe(0);
    expect((await admin.get(`/versements/${chargeVersementId}`)).status).toBe(404);

    const settle = await admin.delete(`/versements/${settlementVersementId}`).send({ reason: 'Erreur de saisie' });
    expect(settle.status).toBe(200);
    expect(await netOf('VERSEMENT', settlementVersementId)).toBe(0);

    const debt = await admin.get(`/debts/${trosaDebtId}`);
    expect(debt.body).toMatchObject({ status: 'OPEN', paidAmount: '0.00', remainingAmount: '60000.00' });
  });

  /* ══════════════ ARGENT PROPRE (§34) ══════════════ */

  it('enregistre une injection et une récupération de capital', async () => {
    const expense = await admin.post('/expenses').send({
      categoryId,
      amount: 3000,
      description: `Achat caoutchouc ${stamp}`,
    });

    const inn = await admin.post('/personal-capital').send({
      type: 'IN',
      amount: 50000,
      motif: `Apport initial ${stamp}`,
      destinationType: 'EXPENSE',
      destinationId: expense.body.id,
    });
    expect(inn.status).toBe(201);
    capitalInId = inn.body.id;

    const entryIn = await prisma.ledgerEntry.findFirst({
      where: { refType: 'CAPITAL', refId: capitalInId },
    });
    expect(entryIn).toMatchObject({ kind: 'PERSONAL_CAPITAL_IN', amount: 50000, cashDelta: 50000 });

    const out = await admin.post('/personal-capital').send({
      type: 'OUT',
      amount: 20000,
      motif: 'Retrait de capital',
    });
    expect(out.status).toBe(201);

    const entryOut = await prisma.ledgerEntry.findFirst({
      where: { refType: 'CAPITAL', refId: out.body.id },
    });
    expect(entryOut).toMatchObject({ kind: 'PERSONAL_CAPITAL_OUT', amount: 20000, cashDelta: -20000 });

    const destinations = await admin.get(`/personal-capital/${capitalInId}/destinations`);
    expect(destinations.status).toBe(200);
    expect(destinations.body.destinations).toHaveLength(1);
    expect(destinations.body.destinations[0]).toMatchObject({
      type: 'EXPENSE',
      id: expense.body.id,
      found: true,
      label: `Achat caoutchouc ${stamp}`,
    });
    expect(destinations.body.history).toHaveLength(1);

    const list = await admin.get('/personal-capital?type=IN');
    expect(list.body.items.some((m: { id: string }) => m.id === capitalInId)).toBe(true);
  });

  it('corrige puis supprime un mouvement de capital', async () => {
    const put = await admin.put(`/personal-capital/${capitalInId}`).send({
      amount: 45000,
      motif: `Apport initial ${stamp} (corrigé)`,
      destinationType: 'EXPENSE',
    });
    expect(put.status).toBe(200);
    expect(put.body.amount).toBe('45000.00');
    expect(await netOf('CAPITAL', capitalInId)).toBe(45000);

    const del = await admin.delete(`/personal-capital/${capitalInId}`).send({ reason: 'Annulation' });
    expect(del.status).toBe(200);
    expect(await netOf('CAPITAL', capitalInId)).toBe(0);
    expect((await admin.get(`/personal-capital/${capitalInId}`)).status).toBe(404);
  });

  /* ══════════════ TROSA SINOA (vue dédiée) ══════════════ */

  it('publie la vue trosa-sinoa et refuse un tiers enregistré', async () => {
    const list = await admin.get('/trosa-sinoa?status=OPEN&limit=100');
    expect(list.status).toBe(200);
    expect(list.body.items.every((d: { type: string }) => d.type === 'TROSA_SINOA')).toBe(true);
    expect(list.body.items.some((d: { id: string }) => d.id === trosaDebtId)).toBe(true);

    const wrong = await admin
      .post('/trosa-sinoa')
      .send({ type: 'TROSA_SINOA', partyName: 'Jean', customerId: 'abc', amount: 1000 });
    expect(wrong.status).toBe(400);

    const created = await admin
      .post('/trosa-sinoa')
      .send({ type: 'TROSA_SINOA', partyName: `Solo ${stamp}`, amount: 25000 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ type: 'TROSA_SINOA', direction: 'PAYABLE', origin: 'MANUAL' });

    const put = await admin.put(`/trosa-sinoa/${created.body.id}`).send({
      reason: `Trosa ${stamp} — révisé`,
      partyName: `Solo ${stamp}`,
      dueDate: '2026-12-31',
    });
    expect(put.status).toBe(200);
    expect(put.body.reason).toBe(`Trosa ${stamp} — révisé`);

    const notTrosa = await admin.get('/trosa-sinoa/zzz-inconnu');
    expect(notTrosa.status).toBe(404);
  });

  it('règle puis annule une trosa sinoa', async () => {
    const pay = await admin.post(`/trosa-sinoa/${trosaDebtId}/payments`).send({ amount: 25000 });
    expect(pay.status).toBe(200);
    expect(pay.body).toMatchObject({ status: 'PARTIAL', remainingAmount: '35000.00' });

    const entry = await prisma.ledgerEntry.findFirst({
      where: { debtId: trosaDebtId, kind: 'TROSA_REPAY' },
      orderBy: { seq: 'desc' },
    });
    expect(entry).toMatchObject({ amount: 25000, cashDelta: -25000 });

    const del = await admin.delete(`/trosa-sinoa/${trosaDebtId}`).send({ reason: 'Dette inexistante' });
    expect(del.status).toBe(200);
    expect(del.body.status).toBe('CANCELLED');
  });

  /* ══════════════ RBAC ══════════════ */

  it('applique le RBAC', async () => {
    expect((await cashier.get('/expenses')).status).toBe(200);
    expect((await cashier.get('/versements')).status).toBe(200);
    expect((await cashier.get('/personal-capital')).status).toBe(200);
    expect((await cashier.get('/trosa-sinoa')).status).toBe(200);

    expect(
      (await cashier.post('/expenses').send({ categoryId, amount: 100, description: 'Interdit' })).status,
    ).toBe(403);
    expect(
      (await cashier.post('/versements').send({ personName: 'X', amount: 100, motif: 'Interdit' })).status,
    ).toBe(403);
    expect(
      (await cashier.post('/personal-capital').send({ type: 'IN', amount: 100, motif: 'Interdit' })).status,
    ).toBe(403);
    expect(
      (await cashier.post('/trosa-sinoa').send({ type: 'TROSA_SINOA', partyName: 'X', amount: 100 })).status,
    ).toBe(403);
    expect((await cashier.delete(`/expenses/${expenseId}`).send({ reason: 'x' })).status).toBe(403);
  });

  it('identité comptable après les finances', async () => {
    const snapshot = await accountingIdentity();
    const { lhs, rhs, delta } = identityBalance(snapshot);

    expect(snapshot.expense).toBeGreaterThan(0);
    expect(snapshot.versement).toBeGreaterThan(0);
    expect(snapshot.k).not.toBe(0);
    expect(delta).toBe(0);
    expect(lhs).toBe(rhs);
  });
});
