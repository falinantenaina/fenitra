import { describe, expect, it } from 'vitest';
import {
  computeActivity,
  computeBalance,
  computeDerived,
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
  unrealizedMargin: 0,
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

describe('§9 — bénéfice disponible (plafond du retrait)', () => {
  it('= bénéfice encaissé non sorti : vente 120 payée après injection 100 → 20', () => {
    const d = computeDerived(
      activity({ ca: 120, cogs: 100, receipts: 120, collectedAtSale: 120 }),
      balance({ cashAtEnd: 120, personalCapitalIn: 100 }),
    );
    expect(d.disposableProfit).toBe(20);
    expect(d.disposableProfit).toBe(d.netProfitNotWithdrawn);
  });

  it('stock à moitié vendu, tout encaissé → 25 (le stock ne bloque pas le retrait)', () => {
    // 100 injectés, 100 de stock, moitié vendue 75
    const d = computeDerived(
      activity({ ca: 75, cogs: 50, receipts: 75, collectedAtSale: 75 }),
      balance({ cashAtEnd: 75, stockValue: 50, personalCapitalIn: 100 }),
    );
    expect(d.netProfitAccumulated).toBe(25);
    expect(d.disposableProfit).toBe(25);
  });

  it('vente à crédit non réglée → 0 : la marge n\'est reconnue qu\'à l\'encaissement (§41)', () => {
    // Vente 120 créditée (60 encaissés / 60 dus) : marge 20 ENTIÈRE à recevoir.
    const d = computeDerived(
      activity({ ca: 120, cogs: 100, receipts: 60, collectedAtSale: 60 }),
      balance({ cashAtEnd: 60, customerDebts: 60, personalCapitalIn: 100, unrealizedMargin: 20 }),
    );
    expect(d.netProfitAccumulated).toBe(0);
    expect(d.disposableProfit).toBe(0);
    expect(d.identityDelta).toBe(0);
  });

  it('après règlement du client → 20 (la marge est encaissée)', () => {
    const d = computeDerived(
      activity({ ca: 120, cogs: 100, receipts: 120, collectedAtSale: 60 }),
      balance({ cashAtEnd: 120, personalCapitalIn: 100, unrealizedMargin: 0 }),
    );
    expect(d.netProfitAccumulated).toBe(20);
    expect(d.disposableProfit).toBe(20);
  });

  it("n'est borné ni par la caisse ni par les passifs (révision A3)", () => {
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
    // Sous l'ancienne règle A3 : caisse 96 − à payer 50 − K 100 = −54 → 0.
    // La révision : le plafond est le bénéfice encaissé non sorti, quel que
    // soit l'état de la caisse.
    expect(d.disposableProfit).toBe(36);
    expect(d.disposableProfit).toBe(d.netProfitNotWithdrawn);
    expect(d.disposableProfit).toBeLessThanOrEqual(d.netProfitAccumulated);
  });

  it("n'est plus réduit par une réserve de rotation (paramètre supprimé)", () => {
    const d = computeDerived(
      activity({ ca: 120, cogs: 100, receipts: 120, collectedAtSale: 120 }),
      balance({ cashAtEnd: 120, personalCapitalIn: 100 }),
    );
    expect(d.disposableProfit).toBe(20);
    expect(d.disposableProfit).toBe(d.netProfitAccumulated);
  });

  it('planche à 0 tant que le bénéfice encaissé non sorti est nul', () => {
    const d = computeDerived(activity(), balance());
    expect(d.disposableProfit).toBe(0);
    expect(d.netProfitNotWithdrawn).toBe(0);
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

describe('§41 — reconnaissance à l\'encaissement intégral', () => {
  it('vente créditée entièrement : la caisse monte, le bénéfice reste à 0', () => {
    // Injection 100 → vente 120 TOUTE à crédit : caisse 0, créance 120.
    const d = computeDerived(
      activity({ salesCount: 1, ca: 120, cogs: 100, receipts: 0, collectedAtSale: 0 }),
      balance({ cashAtEnd: 0, customerDebts: 120, personalCapitalIn: 100, unrealizedMargin: 20 }),
    );
    expect(d.volaMiodina).toBe(120);
    expect(d.netProfitAccumulated).toBe(0);
    expect(d.netProfitNotWithdrawn).toBe(0);
    expect(d.disposableProfit).toBe(0);
    expect(d.identityDelta).toBe(0);
  });

  it('règlement partiel : la caisse monte, le bénéfice reste à 0 (tout-ou-rien)', () => {
    // 40 encaissés sur 120 → créance 80, mais la marge 20 reste entière à recevoir.
    const d = computeDerived(
      activity({ salesCount: 1, ca: 120, cogs: 100, receipts: 40, collectedAtSale: 40 }),
      balance({ cashAtEnd: 40, customerDebts: 80, personalCapitalIn: 100, unrealizedMargin: 20 }),
    );
    expect(d.netProfitAccumulated).toBe(0);
    expect(d.disposableProfit).toBe(0);
    expect(d.identityDelta).toBe(0);
  });

  it('règlement intégral : la marge est encaissée', () => {
    const d = computeDerived(
      activity({ salesCount: 1, ca: 120, cogs: 100, receipts: 120, collectedAtSale: 120 }),
      balance({ cashAtEnd: 120, personalCapitalIn: 100, unrealizedMargin: 0 }),
    );
    expect(d.netProfitAccumulated).toBe(20);
    expect(d.disposableProfit).toBe(20);
  });

  it('vente à perte non réglée : la perte n\'est pas reconnue non plus', () => {
    // Vente 80 pour un coût de 100 → marge −20 non encore reconnue.
    const d = computeDerived(
      activity({ salesCount: 1, ca: 80, cogs: 100, receipts: 0, collectedAtSale: 0 }),
      balance({ cashAtEnd: 0, customerDebts: 80, personalCapitalIn: 100, unrealizedMargin: -20 }),
    );
    expect(d.netProfitAccumulated).toBe(0);
    expect(d.disposableProfit).toBe(0);
    expect(d.identityDelta).toBe(0);
  });

  it('invariants : encaissé = sorti + non sorti ; non sorti + à recevoir = vola − K', () => {
    const d = computeDerived(
      activity({ salesCount: 1, ca: 120, cogs: 100, receipts: 60, collectedAtSale: 60, profitDrawings: 10 }),
      balance({
        cashAtEnd: 50,
        customerDebts: 60,
        personalCapitalIn: 100,
        profitDrawingsCumulated: 10,
        unrealizedMargin: 20,
      }),
    );
    expect(d.netProfitAccumulated).toBe(d.profitDrawingsCumulated + d.netProfitNotWithdrawn);
    expect(d.netProfitNotWithdrawn + d.unrealizedMargin).toBe(
      d.volaMiodina - d.personalCapitalEngaged,
    );
    expect(d.disposableProfit).toBe(Math.max(0, d.netProfitNotWithdrawn));
  });
});
