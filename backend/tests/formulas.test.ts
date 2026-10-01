import { describe, expect, it } from 'vitest';
import {
  computeActivity,
  computeBalance,
  computeDerived,
  DEFAULT_FINANCE_CONFIG,
  verifyIdentity,
  type RawActivity,
  type RawBalance,
} from '../src/services/metrics/core';

const activity = (over: Partial<RawActivity> = {}): RawActivity => ({
  salesCount: 0,
  ca: 0,
  cogs: 0,
  receipts: 0,
  collectedAtSale: 0,
  expenses: 0,
  versementCharges: 0,
  profitDrawings: 0,
  cashOutflow: 0,
  ...over,
});

const balance = (over: Partial<RawBalance> = {}): RawBalance => ({
  cashAtStart: 0,
  cashAtEnd: 0,
  stockValue: 0,
  stockQuantity: 0,
  customerDebts: 0,
  onlineSellerDebts: 0,
  supplierDebts: 0,
  trosaSinoaDebts: 0,
  personalCapitalIn: 0,
  personalCapitalOut: 0,
  profitDrawingsCumulated: 0,
  ...over,
});

describe('§44/§45 — bénéfice brut et net', () => {
  it('bénéfice brut = CA − COGS', () => {
    const a = computeActivity(activity({ ca: 100, cogs: 70 }));
    expect(a.grossProfit).toBe(30);
  });

  it('bénéfice net = brut − dépenses − versements(charges)', () => {
    const a = computeActivity(activity({ ca: 200, cogs: 120, expenses: 30, versementCharges: 10 }));
    expect(a.grossProfit).toBe(80);
    expect(a.netProfit).toBe(40);
  });

  it('un retrait de bénéfice ne réduit PAS le bénéfice net (§45)', () => {
    const a = computeActivity(activity({ ca: 100, cogs: 60, profitDrawings: 40 }));
    expect(a.netProfit).toBe(40);
  });
});

describe('§41/§42 — CA ≠ recettes', () => {
  it('vente non payée : CA = 100, recettes = 0', () => {
    const a = computeActivity(activity({ ca: 100, receipts: 0, collectedAtSale: 0 }));
    expect(a.ca).toBe(100);
    expect(a.receipts).toBe(0);
    expect(a.debtsCreatedFromSales).toBe(100);
  });

  it('vente partiellement payée : CA = 100, recettes = 40, dette = 60', () => {
    const a = computeActivity(activity({ ca: 100, receipts: 40, collectedAtSale: 40 }));
    expect(a.ca).toBe(100);
    expect(a.receipts).toBe(40);
    expect(a.debtsCreatedFromSales).toBe(60);
  });

  it('un règlement de dette antérieur compte dans les recettes mais pas dans le CA', () => {
    const a = computeActivity(activity({ ca: 0, receipts: 60, collectedAtSale: 0 }));
    expect(a.ca).toBe(0);
    expect(a.receipts).toBe(60);
  });
});

describe('§10 — vola miodina', () => {
  it('= caisse + stock + créances − passifs', () => {
    const d = computeDerived(
      activity(),
      balance({ cashAtEnd: 120, stockValue: 50, customerDebts: 30, supplierDebts: 20 }),
    );
    expect(d.volaMiodina).toBe(120 + 50 + 30 - 20);
  });

  it('= argent propre engagé + bénéfice net cumulé', () => {
    // Injection 100, achat stock 100, vente 120 payée → bénéfice 20
    const d = computeDerived(
      activity({ ca: 120, cogs: 100, receipts: 120, collectedAtSale: 120, salesCount: 1 }),
      balance({ cashAtEnd: 120, personalCapitalIn: 100 }),
    );
    expect(d.volaMiodina).toBe(120);
    expect(d.personalCapitalEngaged).toBe(100);
    expect(d.netProfitAccumulated).toBe(20);
    expect(d.volaMiodina).toBe(d.personalCapitalEngaged + d.netProfitAccumulated);
  });
});

describe('§9 — bénéfice mangeable', () => {
  it('vente intégralement payée → mangeable = 20', () => {
    const d = computeDerived(
      activity({ ca: 120, cogs: 100, receipts: 120, collectedAtSale: 120 }),
      balance({ cashAtEnd: 120, personalCapitalIn: 100 }),
    );
    expect(d.disposableProfit).toBe(20);
  });

  it('stock à moitié vendu, tout encaissé → mangeable = 0 (mon argent est dans le stock)', () => {
    // 100 injectés, 100 de stock, moitié vendue 75
    const d = computeDerived(
      activity({ ca: 75, cogs: 50, receipts: 75, collectedAtSale: 75 }),
      balance({ cashAtEnd: 75, stockValue: 50, personalCapitalIn: 100 }),
    );
    expect(d.netProfitAccumulated).toBe(25);
    expect(d.disposableProfit).toBe(0);
  });

  it('vente à crédit non encaissée → mangeable = 0 (l\'argent est chez le client)', () => {
    const d = computeDerived(
      activity({ ca: 120, cogs: 100, receipts: 60, collectedAtSale: 60 }),
      balance({ cashAtEnd: 60, customerDebts: 60, personalCapitalIn: 100 }),
    );
    expect(d.netProfitAccumulated).toBe(20);
    expect(d.disposableProfit).toBe(0);
  });

  it('après règlement du client → mangeable = 20', () => {
    const d = computeDerived(
      activity({ ca: 120, cogs: 100, receipts: 120, collectedAtSale: 60 }),
      balance({ cashAtEnd: 120, personalCapitalIn: 100 }),
    );
    expect(d.disposableProfit).toBe(20);
  });

  it('est plafonné par le surplus de caisse (donc jamais supérieur au bénéfice net)', () => {
    // Injection 100 + emprunt trosa 50 → 150 de caisse
    // Achat de stock 150 (10 paires à 15) → caisse 0, stock 150
    // Vente de 4 paires à 24 = 96 payés, COGS = 4 × 15 = 60
    const d = computeDerived(
      activity({ salesCount: 1, ca: 96, cogs: 60, receipts: 96, collectedAtSale: 96 }),
      balance({
        cashAtEnd: 96,
        stockValue: 90,
        stockQuantity: 6,
        trosaSinoaDebts: 50,
        personalCapitalIn: 100,
      }),
    );
    expect(d.identityDelta).toBe(0);
    expect(d.netProfitAccumulated).toBe(36);
    // caisse 96 − à payer 50 − argent propre 100 = −54 → rien de mangeable
    expect(d.disposableProfit).toBe(0);
    expect(d.disposableProfit).toBeLessThanOrEqual(d.netProfitAccumulated);
  });

  it('tient compte de la réserve de rotation', () => {
    const d = computeDerived(
      activity({ ca: 120, cogs: 100, receipts: 120, collectedAtSale: 120 }),
      balance({ cashAtEnd: 120, personalCapitalIn: 100 }),
      { ...DEFAULT_FINANCE_CONFIG, workingReserve: 30 },
    );
    // surplus = 120 − 0 − 100 − 30 = −10 → 0
    expect(d.disposableProfit).toBe(0);
    expect(d.netProfitAccumulated).toBe(20);
  });
});

describe('§34 — argent propre', () => {
  it('engagé = injecté − récupéré', () => {
    const d = computeDerived(activity(), balance({ personalCapitalIn: 100, personalCapitalOut: 30 }));
    expect(d.personalCapitalEngaged).toBe(70);
  });

  it('sortir de l\'argent propre ne crée pas de bénéfice', () => {
    const d = computeDerived(
      activity({ ca: 0, cogs: 0 }),
      balance({ cashAtEnd: 70, personalCapitalIn: 100, personalCapitalOut: 30 }),
    );
    expect(d.netProfitAccumulated).toBe(0);
    expect(d.disposableProfit).toBe(0);
  });
});

describe('§8.3 — identité comptable', () => {
  const cases: { name: string; a: RawActivity; b: RawBalance }[] = [
    {
      name: 'injection 100 → achat stock 100 → vente 120 payée',
      a: activity({ salesCount: 1, ca: 120, cogs: 100, receipts: 120, collectedAtSale: 120 }),
      b: balance({ cashAtEnd: 120, personalCapitalIn: 100 }),
    },
    {
      name: 'vente à crédit (60 encaissés / 60 dus)',
      a: activity({ salesCount: 1, ca: 120, cogs: 100, receipts: 60, collectedAtSale: 60 }),
      b: balance({ cashAtEnd: 60, customerDebts: 60, personalCapitalIn: 100 }),
    },
    {
      name: 'avec dépenses de 30',
      a: activity({ salesCount: 1, ca: 120, cogs: 100, receipts: 120, collectedAtSale: 120, expenses: 30 }),
      b: balance({ cashAtEnd: 90, personalCapitalIn: 100 }),
    },
    {
      name: 'arrivage 1000 payé 600 + trosa emprunté 100',
      a: activity(),
      b: balance({
        cashAtEnd: 200,
        stockValue: 1000,
        stockQuantity: 50,
        supplierDebts: 400,
        trosaSinoaDebts: 100,
        personalCapitalIn: 700,
      }),
    },
    {
      name: 'avec versement en charge de 20',
      a: activity({ versementCharges: 20 }),
      b: balance({
        cashAtEnd: 180,
        stockValue: 1000,
        supplierDebts: 400,
        trosaSinoaDebts: 100,
        personalCapitalIn: 700,
      }),
    },
    {
      name: 'règlement trosa (versement DEBT_SETTLEMENT) de 50',
      a: activity(),
      b: balance({
        cashAtEnd: 150,
        stockValue: 1000,
        supplierDebts: 400,
        trosaSinoaDebts: 50,
        personalCapitalIn: 700,
      }),
    },
    {
      name: 'paiement fournisseur de 200',
      a: activity(),
      b: balance({
        cashAtEnd: 0,
        stockValue: 1000,
        supplierDebts: 200,
        trosaSinoaDebts: 100,
        personalCapitalIn: 700,
      }),
    },
    {
      name: 'récupération d\'argent propre de 30',
      a: activity(),
      b: balance({
        cashAtEnd: 170,
        stockValue: 1000,
        supplierDebts: 400,
        trosaSinoaDebts: 100,
        personalCapitalIn: 700,
        personalCapitalOut: 30,
      }),
    },
    {
      name: 'retrait de bénéfice de 20',
      a: activity({ salesCount: 1, ca: 120, cogs: 100, receipts: 120, collectedAtSale: 120, profitDrawings: 20 }),
      b: balance({ cashAtEnd: 100, personalCapitalIn: 100, profitDrawingsCumulated: 20 }),
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const a = computeActivity(c.a);
      const b = computeBalance(c.b);
      const { identityDelta, expected, actual } = verifyIdentity(b, a);
      expect(
        identityDelta,
        `attendu=${expected} obtenu=${actual}`,
      ).toBe(0);
    });
  }

  it('détecte un flux non journalisé', () => {
    // 100 apparaissent en caisse sans aucune opération comptabilisée
    const a = computeActivity(activity());
    const b = computeBalance(balance({ cashAtEnd: 100 }));
    const { identityDelta } = verifyIdentity(b, a);
    expect(identityDelta).toBe(100);
    expect(identityDelta).not.toBe(0);
  });
});

describe('bénéfice net cumulé vs non sorti', () => {
  it('après un retrait de bénéfice, le réalisé est conservé et le non sorti diminue', () => {
    const d = computeDerived(
      activity({ ca: 120, cogs: 100, receipts: 120, collectedAtSale: 120, profitDrawings: 20 }),
      balance({ cashAtEnd: 100, personalCapitalIn: 100, profitDrawingsCumulated: 20 }),
    );
    expect(d.netProfitAccumulated).toBe(20);
    expect(d.netProfitNotWithdrawn).toBe(0);
    expect(d.disposableProfit).toBe(0);
    expect(d.identityDelta).toBe(0);
  });
});
