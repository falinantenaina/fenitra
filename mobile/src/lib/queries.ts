import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  AdjustStockBody,
  AdjustStockResult,
  CapitalItem,
  CreateArrivalBody,
  CreateCapitalBody,
  CreateExpenseBody,
  CreateSaleBody,
  CreateTrosaBody,
  CreateVersementBody,
  DashboardResponse,
  DebtDetail,
  DebtItem,
  DebtPaymentBody,
  DebtStatus,
  DebtType,
  DrilldownResponse,
  ExpenseCategory,
  ExpenseItem,
  IndicatorKey,
  LotItem,
  LotMovementsResponse,
  PagedResponse,
  Party,
  PaymentMethod,
  PeriodKey,
  ProductDetail,
  ProductListItem,
  SaleCreated,
  StockMovementFeedItem,
  StockSummary,
  VariantSearchItem,
  VersementItem,
} from '@/lib/types';

/** `GET /api/dashboard?period=` — KPI de la période demandée. */
export function useDashboard(period: PeriodKey): UseQueryResult<DashboardResponse> {
  return useQuery<DashboardResponse>({
    queryKey: ['dashboard', period],
    queryFn: async () => {
      const { data } = await api.get<DashboardResponse>('/dashboard', { params: { period } });
      return data;
    },
    staleTime: 15_000,
  });
}

/** `GET /api/dashboard/:indicator/transactions` — dérillage d'un indicateur. */
export function useDrilldown(
  indicator: IndicatorKey,
  period: PeriodKey,
  enabled = true,
): UseQueryResult<DrilldownResponse> {
  return useQuery<DrilldownResponse>({
    queryKey: ['drilldown', indicator, period],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<DrilldownResponse>(
        `/dashboard/${indicator}/transactions`,
        { params: { period } },
      );
      return data;
    },
    staleTime: 15_000,
  });
}

/* ════════════ Référentiels ════════════ */

interface ListResponse<T> {
  items: T[];
  total: number;
}

/** Fournisseurs actifs (`GET /suppliers?active=true`). */
export function useSuppliers(): UseQueryResult<Party[]> {
  return useQuery<Party[]>({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data } = await api.get<ListResponse<Party>>('/suppliers', {
        params: { active: 'true', limit: 200 },
      });
      return data.items;
    },
    staleTime: 60_000,
  });
}

/** Modèles actifs (`GET /products?active=true`). */
export function useProducts(): UseQueryResult<ProductListItem[]> {
  return useQuery<ProductListItem[]>({
    queryKey: ['products'],
    queryFn: async () => {
      const { data } = await api.get<ListResponse<ProductListItem>>('/products', {
        params: { active: 'true', limit: 200 },
      });
      return data.items;
    },
    staleTime: 60_000,
  });
}

/** Variants (pointures) d'un modèle — requis pour la grille de saisie. */
export function useProduct(productId: string | null): UseQueryResult<ProductDetail> {
  return useQuery<ProductDetail>({
    queryKey: ['product', productId],
    enabled: Boolean(productId),
    queryFn: async () => {
      const { data } = await api.get<ProductDetail>(`/products/${productId}`);
      return data;
    },
    staleTime: 60_000,
  });
}

/** Modes de paiement actifs (`GET /payment-methods`). */
export function usePaymentMethods(): UseQueryResult<PaymentMethod[]> {
  return useQuery<PaymentMethod[]>({
    queryKey: ['payment-methods'],
    queryFn: async () => {
      const { data } = await api.get<ListResponse<PaymentMethod>>('/payment-methods');
      return data.items.filter((m) => m.active);
    },
    staleTime: 60_000,
  });
}

/** Recherche de pointures par nom de modèle ou SKU (`GET /variants?q=`). */
export function useVariantSearch(term: string): UseQueryResult<VariantSearchItem[]> {
  const trimmed = term.trim();
  return useQuery<VariantSearchItem[]>({
    queryKey: ['variants', 'search', trimmed],
    enabled: trimmed.length >= 2,
    queryFn: async () => {
      const { data } = await api.get<ListResponse<VariantSearchItem>>('/variants', {
        params: { active: 'true', q: trimmed, limit: 20, sort: 'sku' },
      });
      return data.items;
    },
    staleTime: 10_000,
  });
}

/** Clients actifs (`GET /customers?active=true`). */
export function useCustomers(): UseQueryResult<Party[]> {
  return useQuery<Party[]>({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data } = await api.get<ListResponse<Party>>('/customers', {
        params: { active: 'true', limit: 200 },
      });
      return data.items;
    },
    staleTime: 60_000,
  });
}

/**
 * `GET /stock/summary?variantId=` — quantité encore disponible.
 * `variantId = null` donne le résumé global (quantité, valeur, nombre de lots).
 */
export function useStockSummary(variantId: string | null): UseQueryResult<StockSummary> {
  return useQuery<StockSummary>({
    queryKey: ['stock-summary', variantId ?? 'all'],
    queryFn: async () => {
      const { data } = await api.get<StockSummary>('/stock/summary', {
        params: variantId ? { variantId } : {},
      });
      return data;
    },
    staleTime: 10_000,
  });
}

/** Prochaine référence de vente, sans la consommer (`GET /sales/reference-preview`). */
export function useSaleReference(): UseQueryResult<{ reference: string }> {
  return useQuery<{ reference: string }>({
    queryKey: ['sale-reference'],
    queryFn: async () => {
      const { data } = await api.get<{ reference: string }>('/sales/reference-preview');
      return data;
    },
    staleTime: 30_000,
  });
}

/* ════════════ Stock / dettes / finances (6e) ════════════ */

export interface LotFilter {
  q?: string;
  status?: '' | 'OPEN' | 'CLOSED';
}

/** Lots valorisés (`GET /stock/lots`). */
export function useLots(filter: LotFilter): UseQueryResult<PagedResponse<LotItem>> {
  const q = filter.q?.trim() ?? '';
  const status = filter.status || undefined;
  return useQuery<PagedResponse<LotItem>>({
    queryKey: ['stock', 'lots', q, status ?? ''],
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<LotItem>>('/stock/lots', {
        params: { ...(q ? { q } : {}), ...(status ? { status } : {}), limit: 50 },
      });
      return data;
    },
    staleTime: 15_000,
  });
}

/** Mouvements d'un lot — piste d'audit (`GET /stock/lots/:id/movements`). */
export function useLotMovements(lotId: string | null): UseQueryResult<LotMovementsResponse> {
  return useQuery<LotMovementsResponse>({
    queryKey: ['stock', 'lot-movements', lotId],
    enabled: Boolean(lotId),
    queryFn: async () => {
      const { data } = await api.get<LotMovementsResponse>(`/stock/lots/${lotId}/movements`, {
        params: { limit: 100 },
      });
      return data;
    },
    staleTime: 15_000,
  });
}

/** Derniers mouvements de stock (`GET /stock/movements`). */
export function useRecentMovements(
  limit = 8,
): UseQueryResult<PagedResponse<StockMovementFeedItem>> {
  return useQuery<PagedResponse<StockMovementFeedItem>>({
    queryKey: ['stock', 'movements', limit],
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<StockMovementFeedItem>>('/stock/movements', {
        params: { limit },
      });
      return data;
    },
    staleTime: 15_000,
  });
}

export interface DebtFilter {
  type?: DebtType | '';
  status?: DebtStatus | '';
}

/** Dettes (`GET /debts`) — filtres type et statut. */
export function useDebts(filter: DebtFilter = {}): UseQueryResult<PagedResponse<DebtItem>> {
  const type = filter.type || undefined;
  const status = filter.status || undefined;
  return useQuery<PagedResponse<DebtItem>>({
    queryKey: ['debts', 'list', type ?? '', status ?? ''],
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<DebtItem>>('/debts', {
        params: { ...(type ? { type } : {}), ...(status ? { status } : {}), limit: 50 },
      });
      return data;
    },
    staleTime: 15_000,
  });
}

/** Détail d'une dette : paiements, écritures, versements liés (`GET /debts/:id`). */
export function useDebt(id: string | null): UseQueryResult<DebtDetail> {
  return useQuery<DebtDetail>({
    queryKey: ['debts', 'detail', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await api.get<DebtDetail>(`/debts/${id}`);
      return data;
    },
    staleTime: 10_000,
  });
}

/** Dépenses (`GET /expenses`). */
export function useExpenses(): UseQueryResult<PagedResponse<ExpenseItem>> {
  return useQuery<PagedResponse<ExpenseItem>>({
    queryKey: ['expenses', 'list'],
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<ExpenseItem>>('/expenses', {
        params: { limit: 50 },
      });
      return data;
    },
    staleTime: 15_000,
  });
}

/** Catégories de dépenses actives (`GET /expense-categories`). */
export function useExpenseCategories(): UseQueryResult<ExpenseCategory[]> {
  return useQuery<ExpenseCategory[]>({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<ExpenseCategory>>('/expense-categories', {
        params: { limit: 200 },
      });
      return data.items.filter((c) => c.active);
    },
    staleTime: 60_000,
  });
}

/** Versements (`GET /versements`). */
export function useVersements(): UseQueryResult<PagedResponse<VersementItem>> {
  return useQuery<PagedResponse<VersementItem>>({
    queryKey: ['versements', 'list'],
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<VersementItem>>('/versements', {
        params: { limit: 50 },
      });
      return data;
    },
    staleTime: 15_000,
  });
}

/** Argent propre (`GET /personal-capital`). */
export function useCapitalMovements(): UseQueryResult<PagedResponse<CapitalItem>> {
  return useQuery<PagedResponse<CapitalItem>>({
    queryKey: ['capital', 'list'],
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<CapitalItem>>('/personal-capital', {
        params: { limit: 50 },
      });
      return data;
    },
    staleTime: 15_000,
  });
}

/* ════════════ Mutations ════════════ */

/** `POST /arrivals` — enregistrement transactionnel (cartons → lots → dette). */
export function useCreateArrival() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateArrivalBody) => {
      // Une clé par tentative : un double tap ne crée jamais deux arrivages.
      const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const { data } = await api.post<ArrivalCreated>('/arrivals', body, {
        headers: { 'Idempotency-Key': key },
      });
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['arrivals'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['stock'] });
      void client.invalidateQueries({ queryKey: ['debts'] });
    },
  });
}

export interface ArrivalCreated {
  id: string;
  reference: string;
  totalCost: string;
  totalQty: number;
}

/** `POST /sales` — vente FIFO avec règlement éventuel (Idempotency-Key par tentative). */
export function useCreateSale() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateSaleBody) => {
      const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const { data } = await api.post<SaleCreated>('/sales', body, {
        headers: { 'Idempotency-Key': key },
      });
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['sales'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['stock'] });
      void client.invalidateQueries({ queryKey: ['stock-summary'] });
      void client.invalidateQueries({ queryKey: ['debts'] });
      void client.invalidateQueries({ queryKey: ['sale-reference'] });
    },
  });
}

/** `POST /stock/adjustments` — casse / perte : FIFO + dépense automatique. */
export function useAdjustStock() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: AdjustStockBody) => {
      const { data } = await api.post<AdjustStockResult>('/stock/adjustments', body);
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['stock'] });
      void client.invalidateQueries({ queryKey: ['stock-summary'] });
      void client.invalidateQueries({ queryKey: ['expenses'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** `POST /debts/:id/payments` — règlement partiel ou total d'une dette. */
export function usePayDebt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: DebtPaymentBody }) => {
      const { data } = await api.post<DebtDetail>(`/debts/${id}/payments`, body);
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['debts'] });
      void client.invalidateQueries({ queryKey: ['versements'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** `POST /trosa-sinoa` — dette dont je suis redevable (A1 : caisse +X). */
export function useCreateTrosa() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateTrosaBody) => {
      const { data } = await api.post<DebtDetail>('/trosa-sinoa', body);
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['debts'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** `POST /expenses` — dépense toujours réglée (A8 : caisse −amount). */
export function useCreateExpense() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateExpenseBody) => {
      const { data } = await api.post<ExpenseItem>('/expenses', body);
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['expenses'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** `POST /versements` — le traitement (charge ou remboursement) est détecté (A2). */
export function useCreateVersement() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateVersementBody) => {
      const { data } = await api.post<VersementItem>('/versements', body);
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['versements'] });
      void client.invalidateQueries({ queryKey: ['debts'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

/** `POST /personal-capital` — argent propre, distinct du bénéfice (A5). */
export function useCreateCapital() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateCapitalBody) => {
      const { data } = await api.post<CapitalItem>('/personal-capital', body);
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['capital'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
