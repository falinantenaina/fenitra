/** Périodes acceptées par `GET /api/dashboard?period=`. */
export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'last7d'
  | 'week'
  | 'month'
  | 'prevMonth'
  | 'year'
  | 'custom';

export type IndicatorKey =
  | 'ca'
  | 'cogs'
  | 'grossProfit'
  | 'netProfit'
  | 'receipts'
  | 'expenses'
  | 'versements'
  | 'cash'
  | 'cashBalance'
  | 'capital'
  | 'profitDrawings'
  | 'receivables'
  | 'payables'
  | 'debtsCustomer'
  | 'debtsOnlineSeller'
  | 'debtsSupplier'
  | 'debtsTrosa'
  | 'debtsTotal'
  | 'stockValue'
  | 'vola'
  | 'disposableProfit';

/** `period` = écritures de la période · `toDate` = état cumulé à la date de fin. */
export type DrillScope = 'period' | 'toDate';

/** Bornes d'une période personnalisée (`period=custom&from&to`, inclusives). */
export interface CustomRange {
  from: string;
  to: string;
}

export interface DashboardPeriod {
  key: string;
  from: string;
  to: string;
  label: string;
}

export interface DashboardActivity {
  salesCount: number;
  ca: string;
  receipts: string;
  collectedAtSale: string;
  cogs: string;
  grossProfit: string;
  expenses: string;
  versementCharges: string;
  netProfit: string;
  cashOutflow: string;
}

export interface DashboardMoney {
  cash: string;
  cashAtStart: string;
  cashDelta: string;
  receivables: string;
  payable: string;
  workingCapital: string;
  volaMiodina: string;
  personalCapitalEngaged: string;
  personalCapitalIn: string;
  personalCapitalOut: string;
  profitDrawings: string;
  disposableProfit: string;
}

export interface DashboardDebts {
  customer: string;
  onlineSeller: string;
  supplier: string;
  trosaSinoa: string;
  total: string;
}

export interface DashboardStock {
  quantity: number;
  value: string;
  availableItems: number;
  soldItems: number;
}

export interface DashboardResponse {
  period: DashboardPeriod;
  activity: DashboardActivity;
  money: DashboardMoney;
  debts: DashboardDebts;
  stock: DashboardStock;
  integrity: { identityDelta: number; ok: boolean };
  meta: { period: string; currency: string };
}

export interface DrillEntry {
  id: string;
  date: string;
  kind: string;
  amount: string;
  cashDelta: string;
  description: string;
  reference: string | null;
  refType: string | null;
  refId: string | null;
}

export interface DrilldownResponse {
  indicator: IndicatorKey;
  label: string;
  scope: DrillScope;
  period: DashboardPeriod;
  count: number;
  total: string;
  entries: DrillEntry[];
}

/** Réponse paginée standard (`items,total,page,limit,totalPages`). */
export interface PagedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ════════════ Rapports (6f) ════════════ */

/** Ligne de vente d'un rapport (`GET /reports/daily|monthly`). */
export interface ReportSalesLine {
  id: string;
  reference: string;
  date: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  cogs: string;
  margin: string;
  party: string | null;
  items: {
    product: { id: string; name: string } | null;
    size: { value: number; label: string | null } | null;
    sku: string | null;
    quantity: number;
    unitPrice: string;
    lineTotal: string;
    cogs: string;
    margin: string;
  }[];
}

/** Meilleures ventes d'une période, par pointure. */
export interface ReportTopProduct {
  variantId: string;
  sku: string | null;
  product: { id: string; name: string } | null;
  size: { value: number; label: string | null } | null;
  quantity: number;
  revenue: string;
  cogs: string;
  margin: string;
  salesCount: number;
}

/** Corps commun des rapports quotidien et mensuel. */
export interface ReportBody {
  period: { from: string; to: string; label: string };
  activity: DashboardActivity;
  money: DashboardMoney;
  integrity: { identityDelta: number; ok: boolean };
  sales: ReportSalesLine[];
  topProducts: ReportTopProduct[];
  /** Articles classés par quantité — « produits les plus vendus » (§48). */
  bestSellers: ReportTopProduct[];
  expensesByCategory: {
    category: { id: string; name: string; icon: string | null };
    count: number;
    amount: string;
  }[];
}

/** §48 — les trois rubriques propres au rapport journalier. */
export interface DailyReport extends ReportBody {
  type: 'daily';
  date: string;
  label: string;
  /** Règlements clients + vendeurs en ligne encaissés sur la journée. */
  paymentsReceived: string;
  /** Règlements fournisseurs décaissés sur la journée. */
  paymentsSupplier: string;
  /** Ce qui est devenu dû le jour même (hors annulations). */
  newDebts: string;
}

/** §48 — les états et ventilations propres au rapport mensuel. */
export interface MonthlyReport extends ReportBody {
  type: 'monthly';
  year: number;
  month: number;
  label: string;
  stock: { quantity: number; value: string };
  debts: { customer: string; onlineSeller: string; supplier: string; trosaSinoa: string };
  versementsByPerson: { person: string; count: number; amount: string }[];
}

/** §3 — indicateurs découpables en jours pour les graphiques. */
export type SeriesMetric = 'ca' | 'receipts' | 'outflow';

/** Un point par jour civil de la période (`GET /reports/series`). */
export interface SeriesPoint {
  /** `AAAA-MM-JJ` dans la timezone de l'entreprise. */
  date: string;
  value: string;
}

/** Série journalière d'un indicateur, remplie à `0` les jours sans écriture. */
export interface ReportSeriesResponse {
  metric: SeriesMetric;
  label: string;
  period: string;
  total: string;
  points: SeriesPoint[];
  meta: { period: PeriodKey; from: string; to: string; timezone: string; currency: string };
}

/** Écriture du journal (`GET /ledger`). */
export interface LedgerEntry {
  id: string;
  seq: number;
  date: string;
  kind: string;
  amount: string;
  cashDelta: string;
  description: string;
  reference: string | null;
  refType: string | null;
  refId: string | null;
  user?: { id: string; name: string };
}

/** Agrégats du journal (`GET /ledger/summary`). */
export interface LedgerSummary {
  byKind: { kind: string; count: number; amount: string; cashDelta: string }[];
  totals: { count: number; amount: string; cashDelta: string };
}

/* ════════════ Référentiels (arrivage) ════════════ */

export interface Party {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  active: boolean;
  variantsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SizeRef {
  id: string;
  value: number;
  label: string;
  order: number;
}

export interface VariantItem {
  id: string;
  sku: string;
  sellingPrice: string;
  active: boolean;
  size: SizeRef;
}

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  active: boolean;
  variants: VariantItem[];
}

export interface PaymentMethod {
  id: string;
  name: string;
  order: number;
  active: boolean;
}

export type FundingSource = 'OWN_CAPITAL' | 'TROSA_SINOA' | 'SALES_CASH' | 'SUPPLIER_CREDIT';

/** Ligne de pointure d'un carton — leur somme doit valoir la quantité annoncée. */
export interface ArrivalCartonLine {
  sizeId: string;
  quantity: number;
}

/**
 * Corps de `POST /arrivals` — un carton = **un modèle**, **une quantité** de
 * paires et **un montant total** ; les pointures sont facultatives (`sizes`),
 * sinon elles se listent après coup via `POST /arrivals/:id/ventilate`.
 * Le prix d'achat unitaire n'est pas envoyé : le serveur le déduit
 * (`floor(totalCost / totalQty)`).
 */
export interface CreateArrivalBody {
  supplierId: string;
  date: string;
  notes?: string;
  cartons: {
    reference: string;
    notes?: string;
    productId: string;
    totalQty: number;
    totalCost: number;
    sellingPrice?: number;
    /** Pointures connues à la saisie — somme = `totalQty`. */
    sizes?: ArrivalCartonLine[];
  }[];
  payment?: { amount: number; method?: string };
  funding?: { source: FundingSource; amount: number; notes?: string };
}

/**
 * Corps de `PATCH /arrivals/:id` — la création moins `funding`, avec un `id`
 * sur les cartons déjà enregistrés : un carton envoyé avec `id` est modifié,
 * sans `id` il est ajouté, absent de la liste il est supprimé.
 */
export interface UpdateArrivalBody extends Omit<CreateArrivalBody, 'cartons' | 'funding'> {
  cartons: (CreateArrivalBody['cartons'][number] & { id?: string })[];
}

/** Corps de `POST /arrivals/:id/ventilate` — répartition des pointures d'un carton. */
export interface VentilateArrivalBody {
  cartons: { cartonId: string; lines: { sizeId: string; quantity: number }[] }[];
}

/* ════════════ Référentiels (vente) ════════════ */

/** Ligne de `GET /variants` — recherche modèle/SKU pour la vente. */
export interface VariantSearchItem {
  id: string;
  sku: string | null;
  sellingPrice: string;
  active: boolean;
  /** Paires encore disponibles en stock (lots non annulés). */
  stock: number;
  product: { id: string; name: string; active: boolean };
  size: SizeRef;
}

/** `GET /stock/summary?variantId=` — quantité encore disponible. */
export interface StockSummary {
  at: string;
  variantId: string | null;
  quantity: number;
  value: string;
  lots: number;
}

/** Corps de `POST /sales` (§46 : prix libre par ligne — A10). */
export interface CreateSaleBody {
  customerId?: string;
  onlineSellerId?: string;
  date?: string;
  notes?: string;
  items: { variantId: string; quantity: number; unitPrice: number }[];
  payment?: { amount: number; method?: string };
}

/** Réponse de `POST /sales` — champs utiles à l'écran de saisie. */
export interface SaleCreated {
  id: string;
  reference: string;
  status: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
}

/* ════════════ Ventes & arrivages (6f — listes et détail) ════════════ */

export type SaleStatus = 'PAID' | 'PARTIAL' | 'UNPAID' | 'CANCELLED';
export type ArrivalStatus = 'RECEIVED' | 'CANCELLED';

export interface PartyRef {
  id: string;
  name: string;
  phone: string | null;
}

/** Ligne de `GET /sales`. */
export interface SaleRow {
  id: string;
  reference: string;
  date: string;
  status: SaleStatus;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  cogs: string;
  margin: string;
  customer: PartyRef | null;
  onlineSeller: PartyRef | null;
}

/** Ligne de `GET /arrivals`. */
export interface ArrivalRow {
  id: string;
  reference: string;
  date: string;
  status: ArrivalStatus;
  totalCost: string;
  totalQty: number;
  paidAmount: string;
  unpaidAmount: string;
  /** Cartons encore sans pointures — `> 0` → arrivage à ventiler. */
  toVentilate: number;
  supplier: PartyRef;
}

export interface SaleLineItem {
  id: string;
  variantId: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  cogs: string;
  margin: string;
  product: { id: string; name: string; slug: string };
  size: { id: string; value: number; label: string | null };
  sku: string | null;
  lots: {
    lotId: string;
    code: string;
    quantity: number;
    unitCost: string;
    cost: string;
    entryDate: string;
    status: LotStatus;
  }[];
}

export interface SimplePayment {
  id: string;
  reference: string;
  date: string;
  amount: string;
  direction: 'IN' | 'OUT';
  method: string | null;
  notes: string | null;
}

/** Réponse de `GET /sales/:id`. */
export interface SaleDetail extends SaleRow {
  notes: string | null;
  paymentMethod: string | null;
  createdBy: { id: string; name: string } | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  items: SaleLineItem[];
  debt: {
    id: string;
    type: DebtType;
    direction: 'PAYABLE' | 'RECEIVABLE';
    origin: string;
    reason: string | null;
    status: DebtStatus;
    initialAmount: string;
    paidAmount: string;
    remainingAmount: string;
  } | null;
  payments: SimplePayment[];
  createdAt: string;
  updatedAt: string;
}

/** Réponse de `GET /arrivals/:id`. */
export interface ArrivalDetail extends ArrivalRow {
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdBy: { id: string; name: string } | null;
  cartons: {
    id: string;
    reference: string;
    date: string;
    notes: string | null;
    productId: string;
    product: { id: string; name: string };
    totalCost: string;
    totalQty: number;
    sellingPrice: string | null;
    /** Pointures réparties (ou non) sur ce carton. */
    ventilatedAt: string | null;
    ventilated: boolean;
    /** Part du carton encore sans pointures — pèse dans la valorisation. */
    transitValue: string;
    transitQty: number;
    items: {
      id: string;
      variantId: string;
      quantity: number;
      unitCost: string;
      lineTotal: string;
      product: { id: string; name: string };
      size: { id: string; value: number; label: string | null };
      sku: string | null;
    }[];
  }[];
  lots: {
    id: string;
    code: string;
    variantId: string;
    product: { id: string; name: string };
    size: { id: string; value: number; label: string | null };
    initialQty: number;
    remainingQty: number;
    unitCost: string;
    totalCost: string;
    value: string;
    entryDate: string;
    status: LotStatus;
  }[];
  debt: {
    id: string;
    reason: string | null;
    initialAmount: string;
    paidAmount: string;
    remainingAmount: string;
    status: DebtStatus;
    direction: 'PAYABLE' | 'RECEIVABLE';
  } | null;
  payments: SimplePayment[];
  fundings: { id: string; source: FundingSource; amount: string; notes: string | null }[];
  createdAt: string;
  updatedAt: string;
}

/* ════════════ Stock (6e) ════════════ */

export type LotStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

/** Ligne de `GET /stock/lots`. */
export interface LotItem {
  id: string;
  code: string;
  entryDate: string;
  status: LotStatus;
  initialQty: number;
  remainingQty: number;
  unitCost: string;
  totalCost: string;
  value: string;
  supplier: { id: string; name: string } | null;
  arrival: { id: string; reference: string; date: string } | null;
  variant: {
    id: string;
    product: { id: string; name: string };
    size: { id: string; value: number; label: string | null };
  };
}

export type MovementType = 'IN' | 'OUT' | 'ADJUSTMENT' | 'RETURN' | 'REVERSAL';

/** Ligne de `GET /stock/by-product` — un modèle, toutes ses pointures confondues. */
export interface ProductStockItem {
  productId: string;
  name: string;
  /** Paires disponibles (restant de tous les lots du modèle). */
  quantity: number;
  value: string;
  lots: number;
}

/** Mouvement vu dans `GET /stock/movements` (flux global). */
export interface StockMovementFeedItem {
  id: string;
  type: MovementType;
  delta: number;
  unitCost: string;
  date: string;
  notes: string | null;
  refType: string | null;
  refId: string | null;
  lot: { id: string; code: string };
  variant: { id: string; product: { id: string; name: string }; size: { id: string; value: number } };
  user: { id: string; name: string } | null;
}

/** Mouvement vu dans `GET /stock/lots/:id/movements`. */
export interface LotMovementItem {
  id: string;
  type: MovementType;
  delta: number;
  unitCost: string;
  date: string;
  notes: string | null;
  refType: string | null;
  refId: string | null;
  user: { id: string; name: string } | null;
}

export interface LotMovementsResponse {
  lot: {
    id: string;
    code: string;
    /** Variante achetée — sert à charger l'historique des prix (§18). */
    variantId: string;
    initialQty: number;
    remainingQty: number;
    unitCost: string;
    status: LotStatus;
  };
  items: LotMovementItem[];
}

/** Ligne d'`GET /variants/:id/price-history` (§18 — prix d'achat). */
export interface PriceHistoryItem {
  arrivalId: string;
  reference: string;
  date: string;
  cartonReference: string;
  quantity: number;
  unitCost: string;
  lineTotal: string;
}

export interface VariantPriceHistory {
  items: PriceHistoryItem[];
  total: number;
}

/** Corps de `POST /stock/adjustments` (casse / perte). */
export interface AdjustStockBody {
  variantId: string;
  qty: number;
  reason: string;
  date?: string;
}

export interface AdjustStockResult {
  variantId: string;
  quantity: number;
  reason: string;
  lostValue: string;
  expenseId: string;
  allocations: { lotId: string; quantity: number; unitCost: string; cost: string }[];
}

/* ════════════ Dettes (6e) ════════════ */

export type DebtType = 'CUSTOMER' | 'ONLINE_SELLER' | 'SUPPLIER' | 'TROSA_SINOA';
export type DebtDirection = 'PAYABLE' | 'RECEIVABLE';
export type DebtStatus = 'OPEN' | 'PARTIAL' | 'PAID' | 'CANCELLED';

/** Ligne de `GET /debts`. */
export interface DebtItem {
  id: string;
  type: DebtType;
  direction: DebtDirection;
  origin: string;
  status: DebtStatus;
  party: { id: string; name: string; phone: string | null } | null;
  reason: string | null;
  initialAmount: string;
  paidAmount: string;
  remainingAmount: string;
  date: string;
  dueDate: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  saleId: string | null;
  arrivalId: string | null;
}

/** Ligne de `GET /debts/by-party` — toutes les dettes d'une même personne. */
export interface DebtPartyGroup {
  key: string;
  /** `id` absent (`null`) pour une trosa sinoa : pas de tiers enregistré. */
  party: { id: string | null; name: string };
  type: DebtType;
  direction: DebtDirection;
  count: number;
  statusCounts: Record<DebtStatus, number>;
  initialAmount: string;
  remainingAmount: string;
}

/** Ligne de `GET /payments` et des `payments[]` d'une dette. */
export interface PaymentItem {
  id: string;
  reference: string;
  date: string;
  amount: string;
  direction: 'IN' | 'OUT';
  partyType: string;
  debtId: string | null;
  saleId: string | null;
  arrivalId: string | null;
  method: string | null;
  notes: string | null;
  user: { id: string; name: string } | null;
}

/** Écriture du journal attachée à la dette (`history[]`). */
export interface LedgerLine {
  id: string;
  date: string;
  kind: string;
  amount: string;
  cashDelta: string;
  description: string;
  reference: string | null;
}

/** Réponse de `GET /debts/:id`. */
export interface DebtDetail extends DebtItem {
  payments: PaymentItem[];
  history: LedgerLine[];
  versements: { id: string; personName: string; motif: string; amount: number; date: string }[];
}

/** Corps de `POST /debts/:id/payments`. */
export interface DebtPaymentBody {
  amount: number;
  method?: string | null;
  date?: string;
  notes?: string | null;
}

/** Corps de `POST /debts` — dette fournisseur à payer (caisse +X, passif au passif). */
export interface CreateSupplierDebtBody {
  type: 'SUPPLIER';
  supplierId: string;
  amount: number;
  reason?: string;
  date?: string;
}

/* ════════════ Finances (6e) ════════════ */

export interface ExpenseCategory {
  id: string;
  name: string;
  icon: string | null;
  order: number;
  active: boolean;
}

/** Ligne de `GET /expenses`. */
export interface ExpenseItem {
  id: string;
  amount: string;
  date: string;
  description: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  categoryId: string;
  category: { id: string; name: string; icon: string | null } | null;
  user: { id: string; name: string } | null;
}

/** Corps de `POST /expenses` (A8 : toujours réglée → caisse −amount). */
export interface CreateExpenseBody {
  categoryId: string;
  amount: number;
  date?: string;
  description: string;
  method?: string | null;
  reference?: string | null;
  notes?: string | null;
}

/** Ligne de `GET /personal-capital`. */
export interface CapitalItem {
  id: string;
  type: 'IN' | 'OUT';
  amount: string;
  date: string;
  motif: string;
  destinationType: string | null;
  destinationId: string | null;
  reference: string | null;
  comment: string | null;
  user: { id: string; name: string } | null;
}

/** Corps de `POST /personal-capital` (A5 : ni bénéfice, ni dette à payer). */
export interface CreateCapitalBody {
  type: 'IN' | 'OUT';
  amount: number;
  date?: string;
  motif: string;
  destinationType?: string | null;
  destinationId?: string | null;
  reference?: string | null;
  comment?: string | null;
}

/* ════════════ Paramètres & administration (6f-b) ════════════ */

export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER';

/** Ligne de `GET /users`. */
export interface UserItem {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** Corps de `POST /users` (ADMIN). */
export interface CreateUserBody {
  email: string;
  name: string;
  password: string;
  role: UserRole;
}

/** Corps de `PATCH /users/:id` (ADMIN). */
export interface UpdateUserBody {
  name?: string;
  role?: UserRole;
  active?: boolean;
}

/** Référentiel de tiers manipulable depuis les paramètres. */
export type PartyKind = 'suppliers' | 'customers' | 'online-sellers';

/** Corps de `POST /suppliers|customers|online-sellers`. */
export interface CreatePartyBody {
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
  status?: string;
}

/** Corps de `PUT /suppliers|customers|online-sellers/:id` — `null` efface un champ texte. */
export interface UpdatePartyBody {
  name?: string;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  active?: boolean;
  status?: string;
}

export interface CreateProductBody {
  name: string;
  description?: string;
}

/** Corps de `POST /products/:id/variants` — création en bloc par pointures. */
export interface BulkVariantsBody {
  sizeValues: number[];
  sellingPrice?: number;
}

/** Réponse de `POST /products/:id/variants` : variantes du produit, triées par pointure. */
export interface BulkVariantsResponse {
  created: number;
  /** Pointures déjà présentes sur le modèle mais désactivées, remises à actives. */
  reactivated: number;
  skipped: number;
  variants: VariantItem[];
}

/** Corps de `PUT /variants/:id` — une pointure du modèle (prix, actif, SKU). */
export interface UpdateVariantBody {
  sku?: string | null;
  sellingPrice?: number;
  active?: boolean;
}

/** Réponse de `PUT /variants/:id`. */
export interface VariantUpdated {
  id: string;
  sku: string | null;
  sellingPrice: string;
  active: boolean;
  product: { id: string; name: string };
  size: { id: string; value: number; label: string | null };
  updatedAt: string;
}

export interface UpdateProductBody {
  name?: string;
  description?: string | null;
  active?: boolean;
}

export interface CreateSizeBody {
  value: number;
  label?: string;
}

export interface CreateCategoryBody {
  name: string;
}

export interface UpdateCategoryBody {
  name?: string;
  active?: boolean;
}

export interface CreateMethodBody {
  name: string;
}

export interface UpdateMethodBody {
  active?: boolean;
}

export interface PasswordBody {
  currentPassword: string;
  newPassword: string;
}

/** Objet plat de `GET|PUT /settings` : `{ cle: valeur }`. */
export type SettingsMap = Record<string, string>;

/** Ligne de `GET /sizes` (paramètres). */
export interface SizeListItem {
  id: string;
  value: number;
  label: string | null;
  order: number;
}
