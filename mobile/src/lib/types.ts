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
  | 'capital'
  | 'profitDrawings';

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
    size: { label: string | null } | null;
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
  size: { label: string | null } | null;
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
  expensesByCategory: {
    category: { id: string; name: string; icon: string | null };
    count: number;
    amount: string;
  }[];
}

export interface DailyReport extends ReportBody {
  type: 'daily';
  date: string;
  label: string;
}

export interface MonthlyReport extends ReportBody {
  type: 'monthly';
  year: number;
  month: number;
  label: string;
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

/** Corps de `POST /arrivals`. */
export interface CreateArrivalBody {
  supplierId: string;
  date: string;
  notes?: string;
  cartons: {
    reference: string;
    notes?: string;
    items: { variantId: string; quantity: number; unitCost: number }[];
  }[];
  payment?: { amount: number; method?: string };
  funding?: { source: FundingSource; amount: number; notes?: string };
}

/* ════════════ Référentiels (vente) ════════════ */

/** Ligne de `GET /variants` — recherche modèle/SKU pour la vente. */
export interface VariantSearchItem {
  id: string;
  sku: string | null;
  sellingPrice: string;
  active: boolean;
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
    initialQty: number;
    remainingQty: number;
    unitCost: string;
    status: LotStatus;
  };
  items: LotMovementItem[];
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
export type DebtStatus = 'OPEN' | 'PARTIAL' | 'PAID' | 'CANCELLED';

/** Ligne de `GET /debts`. */
export interface DebtItem {
  id: string;
  type: DebtType;
  direction: 'PAYABLE' | 'RECEIVABLE';
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

/** Corps de `POST /trosa-sinoa` (A1 : on ne doit pas, la caisse sort à la création). */
export interface CreateTrosaBody {
  type: 'TROSA_SINOA';
  partyName: string;
  amount: number;
  paidAmount?: number;
  reason?: string;
  date?: string;
  method?: string | null;
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

/** Ligne de `GET /versements`. */
export interface VersementItem {
  id: string;
  personName: string;
  amount: string;
  date: string;
  motif: string;
  method: string | null;
  comment: string | null;
  treatment: string;
  debtId: string | null;
  user: { id: string; name: string } | null;
}

/** Corps de `POST /versements` (A2 : traitement détecté côté serveur). */
export interface CreateVersementBody {
  personName: string;
  amount: number;
  date?: string;
  motif: string;
  method?: string | null;
  comment?: string | null;
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

/** Corps de `POST /personal-capital` (A5 : ni bénéfice, ni trosa). */
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
