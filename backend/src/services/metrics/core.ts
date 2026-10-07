/**
 * NOYAU DE CALCUL FINANCIER — fonctions pures, sans base de données.
 *
 * Toutes les formules sont celles validées dans docs/ANALYSE.md §8, §9, §10.
 * Aucune valeur n'est « inventée » : chaque entrée est une agrégation du
 * journal financier (`LedgerEntry`), des dettes (`Debt`) ou des lots (`StockLot`).
 */

// ───────────────────────── entrées brutes ─────────────────────────

/** Agrégats de flux sur une PÉRIODE (jour, semaine, mois…). */
export interface RawActivity {
  /** Nombre de ventes enregistrées (hors annulations) */
  salesCount: number;
  /** CA = Σ amount(kind = SALE) */
  ca: number;
  /** COGS = Σ amount(kind = COGS) */
  cogs: number;
  /** Recettes = Σ cashDelta>0 des écritures de vente (du moment + règlements) */
  receipts: number;
  /** dont encaissé au moment de la vente (sous-indicateur) */
  collectedAtSale: number;
  /** Dépenses = Σ amount(kind = EXPENSE) */
  expenses: number;
  /** Versements traités en CHARGE (Σ amount, kind = VERSEMENT) */
  versementCharges: number;
  /** Retraits de bénéfice sur la période (Σ amount, kind = PROFIT_DRAWING) */
  profitDrawings: number;
  /** Σ −cashDelta des écritures à cashDelta négatif (sorties d'argent) */
  cashOutflow: number;
}

/** États à une DATE (cumulés depuis l'origine des temps jusqu'à `to`). */
export interface RawBalance {
  /** Solde de caisse au début de la période */
  cashAtStart: number;
  /** Solde de caisse à la fin de la période = ouverture + Σ cashDelta */
  cashAtEnd: number;
  /** Σ (StockLot.remainingQty × unitCost) + cartons à ventiler (montant − lignes) */
  stockValue: number;
  /** Σ StockLot.remainingQty */
  stockQuantity: number;
  /** Σ remainingAmount des dettes clients */
  customerDebts: number;
  /** Σ remainingAmount des dettes vendeurs en ligne */
  onlineSellerDebts: number;
  /** Σ remainingAmount des dettes fournisseurs */
  supplierDebts: number;
  /** Σ remainingAmount des trosa sinoa (tous PAYABLE) */
  trosaSinoaDebts: number;
  /** Σ PERSONAL_CAPITAL_IN */
  personalCapitalIn: number;
  /** Σ PERSONAL_CAPITAL_OUT */
  personalCapitalOut: number;
  /** Σ PROFIT_DRAWING cumulés */
  profitDrawingsCumulated: number;
}

export interface FinanceConfig {
  /** Solde de caisse initial de l'activité */
  openingCashBalance: number;
}

// ───────────────────────── dérivés ─────────────────────────

export interface ActivityMetrics {
  salesCount: number;
  ca: number;
  cogs: number;
  receipts: number;
  collectedAtSale: number;
  debtsCreatedFromSales: number;
  expenses: number;
  versementCharges: number;
  profitDrawings: number;
  /** Bénéfice brut = CA − COGS (§44) */
  grossProfit: number;
  /**
   * Bénéfice net = Brut − Dépenses − Versements(charges) (§45).
   * Ne déduit JAMAIS : remboursement de dette fournisseur, récupération
   * d'argent propre, retrait de capital, retrait de bénéfice.
   */
  netProfit: number;
  /** Sorties d'argent sur la période (toutes causes) */
  cashOutflow: number;
}

export interface BalanceMetrics {
  /** Caisse = soldeInitial + Σ cashDelta (§46) */
  cash: number;
  cashAtStart: number;
  cashDelta: number;
  /** Lots + cartons dont les pointures sont inconnues (§17) */
  stockValue: number;
  stockQuantity: number;
  customerDebts: number;
  onlineSellerDebts: number;
  supplierDebts: number;
  trosaSinoaDebts: number;
  /** Argent à recevoir = clients + vendeurs en ligne */
  receivables: number;
  /** Argent à payer = fournisseurs + trosa sinoa */
  payables: number;
  /** Argent propre engagé K = Σ IN − Σ OUT (§34) */
  personalCapitalEngaged: number;
  personalCapitalIn: number;
  personalCapitalOut: number;
  profitDrawingsCumulated: number;
}

export interface DerivedMetrics extends ActivityMetrics, BalanceMetrics {
  /**
   * VOLA MIODINA = caisse + stock + créances − passifs (§10).
   * Identité : vola = argent propre engagé + bénéfice net non sorti.
   */
  volaMiodina: number;
  /** Bénéfice net cumulé réalisé = vola − argent propre engagé */
  netProfitAccumulated: number;
  /** Bénéfice net cumulé non sorti = réalisé − retraits de bénéfice */
  netProfitNotWithdrawn: number;
  /**
   * BÉNÉFICE DISPONIBLE (§9, révision A3) = bénéfice net cumulé **non sorti**
   * = max(0, vola − argent propre engagé). C'est le plafond d'un retrait :
   * la caisse, les passifs et l'argent propre ne le bornent plus (seul l'argent
   * propre — qui n'est pas du bénéfice — est soustrait).
   */
  disposableProfit: number;
  /** Marge brute (CA − COGS) — alias explicite */
  grossMargin: number;
  /** Contrôle d'identité : doit être strictement égal à 0 */
  identityDelta: number;
}

// ───────────────────────── calculs ─────────────────────────

export function computeActivity(raw: RawActivity): ActivityMetrics {
  const grossProfit = raw.ca - raw.cogs;
  const netProfit = grossProfit - raw.expenses - raw.versementCharges;
  return {
    salesCount: raw.salesCount,
    ca: raw.ca,
    cogs: raw.cogs,
    receipts: raw.receipts,
    collectedAtSale: raw.collectedAtSale,
    /** Dettes générées par les ventes du moment = CA encaissé à la vente */
    debtsCreatedFromSales: raw.ca - raw.collectedAtSale,
    expenses: raw.expenses,
    versementCharges: raw.versementCharges,
    profitDrawings: raw.profitDrawings,
    grossProfit,
    netProfit,
    cashOutflow: raw.cashOutflow,
  };
}

export function computeBalance(raw: RawBalance): BalanceMetrics {
  const receivables = raw.customerDebts + raw.onlineSellerDebts;
  const payables = raw.supplierDebts + raw.trosaSinoaDebts;
  return {
    cash: raw.cashAtEnd,
    cashAtStart: raw.cashAtStart,
    cashDelta: raw.cashAtEnd - raw.cashAtStart,
    stockValue: raw.stockValue,
    stockQuantity: raw.stockQuantity,
    customerDebts: raw.customerDebts,
    onlineSellerDebts: raw.onlineSellerDebts,
    supplierDebts: raw.supplierDebts,
    trosaSinoaDebts: raw.trosaSinoaDebts,
    receivables,
    payables,
    personalCapitalEngaged: raw.personalCapitalIn - raw.personalCapitalOut,
    personalCapitalIn: raw.personalCapitalIn,
    personalCapitalOut: raw.personalCapitalOut,
    profitDrawingsCumulated: raw.profitDrawingsCumulated,
  };
}

/**
 * Identité comptable (docs/ANALYSE.md §8.3) :
 *
 *   caisse + stock + créances − passifs
 *     = argent propre engagé + (CA − COGS − dépenses − versements_charges − retraits_bénéfice)
 *
 * Vérifiée en permanence : si `identityDelta !== 0`, un flux n'a pas été journalisé.
 */
export function verifyIdentity(
  balance: BalanceMetrics,
  activity: ActivityMetrics,
): { identityDelta: number; expected: number; actual: number } {
  const lhs = balance.cash + balance.stockValue + balance.receivables - balance.payables;
  const expected =
    balance.personalCapitalEngaged +
    activity.ca -
    activity.cogs -
    activity.expenses -
    activity.versementCharges -
    balance.profitDrawingsCumulated;
  return { identityDelta: lhs - expected, expected, actual: lhs };
}

/**
 * @param cumulativeActivity Activité **cumulée depuis l'origine jusqu'à `to`**,
 * seule compatible avec l'identité (les stocks de `balance` — caisse, stock,
 * dettes — sont cumulés eux aussi). Sans cet argument, on retombe sur
 * l'activité de la période, ce qui n'est juste que pour une période
 * commençant à l'origine.
 */
export function computeDerived(
  activity: RawActivity,
  balance: RawBalance,
  cumulativeActivity?: RawActivity,
): DerivedMetrics {
  const a = computeActivity(activity);
  const b = computeBalance(balance);
  const cumulative = cumulativeActivity ? computeActivity(cumulativeActivity) : a;
  const { identityDelta } = verifyIdentity(b, cumulative);

  const volaMiodina = b.cash + b.stockValue + b.receivables - b.payables;

  // Identité : vola = K + (bénéfice net réalisé − retraits de bénéfice)
  //   ⇒ bénéfice net réalisé = vola − K + retraits
  const netProfitAccumulated = volaMiodina - b.personalCapitalEngaged + b.profitDrawingsCumulated;
  const netProfitNotWithdrawn = volaMiodina - b.personalCapitalEngaged;

  // Révision A3 : le plafond d'un retrait est le bénéfice net NON SORTI.
  // La caisse, les passifs et la réserve de rotation ne le bornent plus — le
  // retrait peut donc faire descendre la caisse sous les passifs (l'identité
  // comptable reste vérifiée : un retrait ne modifie ni le CA ni le bénéfice).
  const disposableProfit = Math.max(0, netProfitNotWithdrawn);

  return {
    ...a,
    ...b,
    volaMiodina,
    netProfitAccumulated,
    netProfitNotWithdrawn,
    disposableProfit,
    grossMargin: a.grossProfit,
    identityDelta,
  };
}
