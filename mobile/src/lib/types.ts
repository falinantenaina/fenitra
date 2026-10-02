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
