import { useMemo, useRef } from 'react';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  AdjustStockBody,
  AdjustStockResult,
  ArrivalDetail,
  ArrivalRow,
  ArrivalStatus,
  BulkVariantsResponse,
  CapitalItem,
  CreateArrivalBody,
  CreateCapitalBody,
  CreateCategoryBody,
  CreateExpenseBody,
  CreateMethodBody,
  CreatePartyBody,
  CreateProductBody,
  CreateSaleBody,
  CreateSizeBody,
  CreateSupplierDebtBody,
  CreateUserBody,
  CustomRange,
  DashboardResponse,
  DailyReport,
  DebtDetail,
  DebtDirection,
  DebtItem,
  DebtPaymentBody,
  DebtStatus,
  DebtType,
  DrilldownResponse,
  ExpenseCategory,
  ExpenseItem,
  IndicatorKey,
  LedgerEntry,
  LedgerSummary,
  LotItem,
  LotMovementsResponse,
  MonthlyReport,
  PagedResponse,
  Party,
  PartyKind,
  PasswordBody,
  PaymentMethod,
  PeriodKey,
  ProductDetail,
  ProductListItem,
  ReportSeriesResponse,
  SaleCreated,
  SaleDetail,
  SaleRow,
  SaleStatus,
  SeriesMetric,
  SettingsMap,
  SizeListItem,
  StockMovementFeedItem,
  StockSummary,
  UpdateCategoryBody,
  UpdateMethodBody,
  UpdatePartyBody,
  UpdateProductBody,
  UpdateUserBody,
  UpdateVariantBody,
  UserItem,
  VariantPriceHistory,
  VariantSearchItem,
  VariantUpdated,
  VentilateArrivalBody,
} from '@/lib/types';

/** `GET /api/dashboard?period=` — KPI de la période demandée. */
export function useDashboard(
  period: PeriodKey,
  range?: CustomRange | null,
): UseQueryResult<DashboardResponse> {
  return useQuery<DashboardResponse>({
    queryKey: ['dashboard', period, range?.from ?? '', range?.to ?? ''],
    queryFn: async () => {
      const { data } = await api.get<DashboardResponse>('/dashboard', {
        params: { period, ...(range ? { from: range.from, to: range.to } : {}) },
      });
      return data;
    },
    staleTime: 15_000,
  });
}

/** `GET /api/dashboard/:indicator/transactions` — dérillage d'un indicateur. */
export function useDrilldown(
  indicator: IndicatorKey,
  period: PeriodKey,
  range?: CustomRange | null,
  enabled = true,
): UseQueryResult<DrilldownResponse> {
  return useQuery<DrilldownResponse>({
    queryKey: ['drilldown', indicator, period, range?.from ?? '', range?.to ?? ''],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<DrilldownResponse>(
        `/dashboard/${indicator}/transactions`,
        { params: { period, ...(range ? { from: range.from, to: range.to } : {}) } },
      );
      return data;
    },
    staleTime: 15_000,
  });
}

/** `GET /api/reports/series?period&metric` — série journalière (§3, graphiques). */
export function useSeries(
  metric: SeriesMetric,
  period: PeriodKey,
  range?: CustomRange | null,
): UseQueryResult<ReportSeriesResponse> {
  return useQuery<ReportSeriesResponse>({
    queryKey: ['series', metric, period, range?.from ?? '', range?.to ?? ''],
    queryFn: async () => {
      const { data } = await api.get<ReportSeriesResponse>('/reports/series', {
        params: { metric, period, ...(range ? { from: range.from, to: range.to } : {}) },
      });
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

/** Recherche de modèle actif (`GET /products?active=true&q=`) — arrivage. */
export function useProductSearch(term: string): UseQueryResult<PagedResponse<ProductListItem>> {
  const q = term.trim();
  return useQuery<PagedResponse<ProductListItem>>({
    queryKey: ['products', 'search', q],
    enabled: q.length > 0,
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<ProductListItem>>('/products', {
        params: { limit: 30, active: 'true', q },
      });
      return data;
    },
    staleTime: 10_000,
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

/* ════════════ Listes paginées ════════════ */

export type ListParams = Record<string, string | number | undefined>;

/** Retire les paramètres vides : un `status=""` casserait le parseur du serveur. */
function compact(params: ListParams): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(params).filter(
      (entry): entry is [string, string | number] =>
        entry[1] !== undefined && entry[1] !== '',
    ),
  );
}

export type PagedInfinite<T> = UseInfiniteQueryResult<
  InfiniteData<PagedResponse<T>, number>
> & {
  /** Toutes les pages chargées, à plat. */
  items: T[];
  /** Nombre total d'éléments côté serveur (page 1). */
  total: number;
  totalPages: number;
  hasMore: boolean;
};

/**
 * Liste paginée qui accumule les pages : le serveur répond
 * `{ items, total, page, limit, totalPages }`, on expose `items` à plat
 * et un `fetchNextPage()` déclenché par le bouton « Charger plus ».
 */
export function useInfiniteList<T>(
  baseKey: readonly unknown[],
  endpoint: string,
  params: ListParams = {},
  limit = 50,
  enabled = true,
): PagedInfinite<T> {
  const query = useInfiniteQuery<
    PagedResponse<T>,
    Error,
    InfiniteData<PagedResponse<T>, number>,
    readonly unknown[],
    number
  >({
    queryKey: [...baseKey, compact(params), limit],
    enabled,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<PagedResponse<T>>(endpoint, {
        params: { ...compact(params), limit, page: pageParam },
      });
      return data;
    },
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    staleTime: 15_000,
  });

  const pages = query.data?.pages ?? [];
  const total = pages[0]?.total ?? 0;

  return {
    ...query,
    items: pages.flatMap((page) => page.items),
    total,
    totalPages: pages[0]?.totalPages ?? 1,
    hasMore: query.hasNextPage ?? false,
  };
}

/* ════════════ Ventes ════════════ */

export interface SaleFilter {
  status?: SaleStatus | '';
  q?: string;
}

/** Ventes paginées (`GET /sales`). */
export function useSales(filter: SaleFilter = {}): PagedInfinite<SaleRow> {
  return useInfiniteList<SaleRow>(['sales', 'list'], '/sales', {
    status: filter.status || undefined,
    q: filter.q?.trim(),
  });
}

/** Détail d'une vente : lignes, lots consommés, dette et paiements (`GET /sales/:id`). */
export function useSale(id: string | null): UseQueryResult<SaleDetail> {
  return useQuery<SaleDetail>({
    queryKey: ['sales', 'detail', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await api.get<SaleDetail>(`/sales/${id}`);
      return data;
    },
    staleTime: 10_000,
  });
}

/** `POST /sales/:id/cancel` — restitution des lots + contre-passation. */
export function useCancelSale() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data } = await api.post<SaleDetail>(`/sales/${id}/cancel`, { reason });
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['sales'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['stock'] });
      void client.invalidateQueries({ queryKey: ['stock-summary'] });
      void client.invalidateQueries({ queryKey: ['debts'] });
      void client.invalidateQueries({ queryKey: ['ledger'] });
    },
  });
}

/** `POST /sales/:id/payments` — règlement partiel ou total d'une vente. */
export function usePaySale() {
  const client = useQueryClient();
  const keys = useIdempotencyKey();

  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { amount: number; method?: string | null; date?: string; notes?: string | null };
    }) => {
      const { data } = await api.post<SaleDetail>(`/sales/${id}/payments`, body, {
        headers: { 'Idempotency-Key': keys.keyFor({ id, body }) },
      });
      return data;
    },
    onSuccess: () => {
      keys.reset();
      void client.invalidateQueries({ queryKey: ['sales'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['debts'] });
      void client.invalidateQueries({ queryKey: ['ledger'] });
    },
  });
}

/* ════════════ Arrivages ════════════ */

export interface ArrivalFilter {
  status?: ArrivalStatus | '';
  /** `true` → uniquement les arrivages ayant encore des cartons à ventiler. */
  unventilated?: boolean;
  q?: string;
}

/** Arrivages paginés (`GET /arrivals`). */
export function useArrivals(filter: ArrivalFilter = {}): PagedInfinite<ArrivalRow> {
  return useInfiniteList<ArrivalRow>(['arrivals', 'list'], '/arrivals', {
    status: filter.status || undefined,
    unventilated: filter.unventilated ? 'true' : undefined,
    q: filter.q?.trim(),
  });
}

/** Détail d'un arrivage : cartons, lots, dette, paiements et financements. */
export function useArrival(id: string | null): UseQueryResult<ArrivalDetail> {
  return useQuery<ArrivalDetail>({
    queryKey: ['arrivals', 'detail', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data } = await api.get<ArrivalDetail>(`/arrivals/${id}`);
      return data;
    },
    staleTime: 10_000,
  });
}

/** `POST /arrivals/:id/cancel` — contre-passation, stock intact requis. */
export function useCancelArrival() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data } = await api.post<ArrivalDetail>(`/arrivals/${id}/cancel`, { reason });
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['arrivals'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['stock'] });
      void client.invalidateQueries({ queryKey: ['stock-summary'] });
      void client.invalidateQueries({ queryKey: ['debts'] });
      void client.invalidateQueries({ queryKey: ['ledger'] });
    },
  });
}

/** Vendeurs en ligne actifs (`GET /online-sellers?active=true`). */
export function useOnlineSellers(): UseQueryResult<Party[]> {
  return useQuery<Party[]>({
    queryKey: ['online-sellers'],
    queryFn: async () => {
      const { data } = await api.get<ListResponse<Party>>('/online-sellers', {
        params: { active: 'true', limit: 200 },
      });
      return data.items;
    },
    staleTime: 60_000,
  });
}

/* ════════════ Stock / dettes / finances (6e) ════════════ */

export interface LotFilter {
  q?: string;
  status?: '' | 'OPEN' | 'CLOSED';
}

/** Lots valorisés paginés (`GET /stock/lots`). */
export function useLots(filter: LotFilter): PagedInfinite<LotItem> {
  const q = filter.q?.trim() ?? '';
  const status = filter.status || '';
  return useInfiniteList<LotItem>(['stock', 'lots'], '/stock/lots', {
    q: q || undefined,
    status: status || undefined,
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

/** Historique des prix d'achat d'une variante (`GET /variants/:id/price-history`) — §18. */
export function useVariantPriceHistory(
  variantId: string | null,
): UseQueryResult<VariantPriceHistory> {
  return useQuery<VariantPriceHistory>({
    queryKey: ['variants', 'price-history', variantId],
    enabled: Boolean(variantId),
    queryFn: async () => {
      const { data } = await api.get<VariantPriceHistory>(
        `/variants/${variantId}/price-history`,
      );
      return data;
    },
    staleTime: 60_000,
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
  direction?: DebtDirection | '';
  status?: DebtStatus | '';
}

/** Dettes paginées (`GET /debts`) — filtres direction/type/statut, accumulation des pages. */
export function useDebts(filter: DebtFilter = {}): PagedInfinite<DebtItem> {
  return useInfiniteList<DebtItem>(['debts', 'list'], '/debts', {
    type: filter.type || undefined,
    direction: filter.direction || undefined,
    status: filter.status || undefined,
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

/** `POST /debts/:id/cancel` — contre-passation (dette créée manuellement). */
export function useCancelDebt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data } = await api.post<DebtDetail>(`/debts/${id}/cancel`, { reason });
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['debts'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['ledger'] });
    },
  });
}

/** Dépenses paginées (`GET /expenses`). */
export function useExpenses(): PagedInfinite<ExpenseItem> {
  return useInfiniteList<ExpenseItem>(['expenses', 'list'], '/expenses');
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

/** Argent propre paginé (`GET /personal-capital`). */
export function useCapitalMovements(): PagedInfinite<CapitalItem> {
  return useInfiniteList<CapitalItem>(['capital', 'list'], '/personal-capital');
}

/* ════════════ Rapports (6f) ════════════ */

/** Rapport quotidien (`GET /reports/daily?date=`). */
export function useDailyReport(
  date: string,
  enabled = true,
): UseQueryResult<DailyReport> {
  return useQuery<DailyReport>({
    queryKey: ['reports', 'daily', date],
    enabled,
    queryFn: async () => {
      const { data } = await api.get<DailyReport>('/reports/daily', { params: { date } });
      return data;
    },
    staleTime: 30_000,
  });
}

/** Rapport mensuel (`GET /reports/monthly?year=&month=`). */
export function useMonthlyReport(
  year: number,
  month: number,
  enabled = true,
): UseQueryResult<MonthlyReport> {
  return useQuery<MonthlyReport>({
    queryKey: ['reports', 'monthly', `${year}-${month}`],
    enabled: enabled && year > 2000 && month >= 1 && month <= 12,
    queryFn: async () => {
      const { data } = await api.get<MonthlyReport>('/reports/monthly', {
        params: { year, month },
      });
      return data;
    },
    staleTime: 30_000,
  });
}

/** Journal financier paginé sur une plage (`GET /ledger`). */
export function useLedger(from: string, to: string, enabled = true): PagedInfinite<LedgerEntry> {
  return useInfiniteList<LedgerEntry>(
    ['ledger', 'list'],
    '/ledger',
    { from: from || undefined, to: to || undefined },
    50,
    enabled && Boolean(from && to),
  );
}

/** Agrégats du journal (`GET /ledger/summary`). */
export function useLedgerSummary(
  from: string,
  to: string,
  enabled = true,
): UseQueryResult<LedgerSummary> {
  return useQuery<LedgerSummary>({
    queryKey: ['ledger', 'summary', from, to],
    enabled: enabled && Boolean(from && to),
    queryFn: async () => {
      const { data } = await api.get<LedgerSummary>('/ledger/summary', { params: { from, to } });
      return data;
    },
    staleTime: 15_000,
  });
}

/* ════════════ Mutations ════════════ */

/**
 * Clé d'idempotence stable pour une soumission.
 *
 * La clé ne change que si le corps change : un retry réseau rejoue donc la
 * *même* opération au lieu d'en créer une seconde, alors qu'une nouvelle
 * saisie (corps différent) repart sur une clé neuve. `reset()` est appelé
 * après un succès pour qu'une re-saisie identique crée bien un nouvel enregistrement.
 */
export function useIdempotencyKey(): { keyFor: (payload: unknown) => string; reset: () => void } {
  const ref = useRef<{ payload: string; key: string } | null>(null);

  return useMemo(
    () => ({
      keyFor: (payload: unknown) => {
        const serialized = JSON.stringify(payload);
        if (ref.current?.payload !== serialized) {
          ref.current = {
            payload: serialized,
            key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
          };
        }
        return ref.current.key;
      },
      reset: () => {
        ref.current = null;
      },
    }),
    [],
  );
}

/** `POST /arrivals` — enregistrement transactionnel (cartons → lots → dette). */
export function useCreateArrival() {
  const client = useQueryClient();
  const keys = useIdempotencyKey();

  return useMutation({
    mutationFn: async (body: CreateArrivalBody) => {
      const { data } = await api.post<ArrivalCreated>('/arrivals', body, {
        headers: { 'Idempotency-Key': keys.keyFor(body) },
      });
      return data;
    },
    onSuccess: () => {
      keys.reset();
      void client.invalidateQueries({ queryKey: ['arrivals'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['stock'] });
      void client.invalidateQueries({ queryKey: ['stock-summary'] });
      void client.invalidateQueries({ queryKey: ['debts'] });
      void client.invalidateQueries({ queryKey: ['ledger'] });
    },
  });
}

export interface ArrivalCreated {
  id: string;
  reference: string;
  totalCost: string;
  totalQty: number;
}

/** `POST /arrivals/:id/ventilate` — répartit les pointures d'un carton déjà enregistré. */
export function useVentilateArrival() {
  const client = useQueryClient();
  const keys = useIdempotencyKey();

  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: VentilateArrivalBody }) => {
      const { data } = await api.post<ArrivalDetail>(`/arrivals/${id}/ventilate`, body, {
        headers: { 'Idempotency-Key': keys.keyFor({ id, body }) },
      });
      return data;
    },
    onSuccess: () => {
      keys.reset();
      void client.invalidateQueries({ queryKey: ['arrivals'] });
      void client.invalidateQueries({ queryKey: ['stock'] });
      void client.invalidateQueries({ queryKey: ['stock-summary'] });
    },
  });
}

/** `POST /sales` — vente FIFO avec règlement éventuel (Idempotency-Key stable par soumission). */
export function useCreateSale() {
  const client = useQueryClient();
  const keys = useIdempotencyKey();

  return useMutation({
    mutationFn: async (body: CreateSaleBody) => {
      const { data } = await api.post<SaleCreated>('/sales', body, {
        headers: { 'Idempotency-Key': keys.keyFor(body) },
      });
      return data;
    },
    onSuccess: () => {
      keys.reset();
      void client.invalidateQueries({ queryKey: ['sales'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['stock'] });
      void client.invalidateQueries({ queryKey: ['stock-summary'] });
      void client.invalidateQueries({ queryKey: ['debts'] });
      void client.invalidateQueries({ queryKey: ['ledger'] });
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
      void client.invalidateQueries({ queryKey: ['ledger'] });
    },
  });
}

/** `POST /debts/:id/payments` — règlement partiel ou total d'une dette. */
export function usePayDebt() {
  const client = useQueryClient();
  const keys = useIdempotencyKey();

  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: DebtPaymentBody }) => {
      const { data } = await api.post<DebtDetail>(`/debts/${id}/payments`, body, {
        headers: { 'Idempotency-Key': keys.keyFor({ id, body }) },
      });
      return data;
    },
    onSuccess: () => {
      keys.reset();
      void client.invalidateQueries({ queryKey: ['debts'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['ledger'] });
    },
  });
}

/** `POST /debts` — dette fournisseur à payer (A1 : caisse +X, passif au passif). */
export function useCreateSupplierDebt() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateSupplierDebtBody) => {
      const { data } = await api.post<DebtDetail>('/debts', body);
      return data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['debts'] });
      void client.invalidateQueries({ queryKey: ['dashboard'] });
      void client.invalidateQueries({ queryKey: ['ledger'] });
      void client.invalidateQueries({ queryKey: ['capital'] });
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
      void client.invalidateQueries({ queryKey: ['ledger'] });
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
      void client.invalidateQueries({ queryKey: ['ledger'] });
    },
  });
}
/* ════════════ Paramètres & administration (6f-b) ════════════ */

/** `GET /products?limit=` — catalogue complet, y compris les produits inactifs. */
export function useProductList(term: string): UseQueryResult<PagedResponse<ProductListItem>> {
  const q = term.trim();
  return useQuery<PagedResponse<ProductListItem>>({
    queryKey: ['products', 'admin', q],
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<ProductListItem>>('/products', {
        params: { limit: 100, ...(q ? { q } : {}) },
      });
      return data;
    },
    staleTime: 15_000,
  });
}

/** `GET /sizes?limit=` — pointures du catalogue. */
export function useSizeList(): UseQueryResult<PagedResponse<SizeListItem>> {
  return useQuery<PagedResponse<SizeListItem>>({
    queryKey: ['sizes'],
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<SizeListItem>>('/sizes', {
        params: { limit: 200 },
      });
      return data;
    },
    staleTime: 60_000,
  });
}

/** `GET /:kind?limit=&q=` — fournisseurs / clients / vendeurs en ligne. */
export function usePartyList(
  kind: PartyKind,
  term: string,
): UseQueryResult<PagedResponse<Party>> {
  const q = term.trim();
  return useQuery<PagedResponse<Party>>({
    queryKey: ['parties', kind, q],
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<Party>>(`/${kind}`, {
        params: { limit: 100, ...(q ? { q } : {}) },
      });
      return data;
    },
    staleTime: 15_000,
  });
}

/** `GET /users` — liste complète (ADMIN). */
export function useUserList(): UseQueryResult<UserItem[]> {
  return useQuery<UserItem[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const { data } = await api.get<UserItem[]>('/users');
      return data;
    },
    staleTime: 15_000,
  });
}

/** `GET /users/roles` — rôles disponibles (ADMIN ou MANAGER). */
export function useRoleList(): UseQueryResult<string[]> {
  return useQuery<string[]>({
    queryKey: ['roles'],
    queryFn: async () => {
      const { data } = await api.get<string[]>('/users/roles');
      return data;
    },
    staleTime: 300_000,
  });
}

/** `GET /settings` — objet plat `{ cle: valeur }`. */
export function useSettings(): UseQueryResult<SettingsMap> {
  return useQuery<SettingsMap>({
    queryKey: ['settings'],
    queryFn: async () => {
      const { data } = await api.get<SettingsMap>('/settings');
      return data;
    },
    staleTime: 30_000,
  });
}

/** `GET /expense-categories` — y compris les catégories désactivées. */
export function useExpenseCategoryList(): UseQueryResult<ExpenseCategory[]> {
  return useQuery<ExpenseCategory[]>({
    queryKey: ['expense-categories', 'all'],
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<ExpenseCategory>>('/expense-categories', {
        params: { limit: 200 },
      });
      return data.items;
    },
    staleTime: 30_000,
  });
}

/** `GET /payment-methods` — y compris les modes désactivés. */
export function usePaymentMethodList(): UseQueryResult<PaymentMethod[]> {
  return useQuery<PaymentMethod[]>({
    queryKey: ['payment-methods', 'all'],
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<PaymentMethod>>('/payment-methods');
      return data.items;
    },
    staleTime: 30_000,
  });
}

/** `POST /products` */
export function useCreateProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateProductBody) => {
      const { data } = await api.post<ProductListItem>('/products', body);
      return data;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['products'] }),
  });
}

/** `POST /products/:id/variants` — variantes en bloc par pointures (saisie rapide). */
export function useCreateVariantsBulk() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ productId, sizeValues }: { productId: string; sizeValues: number[] }) => {
      const { data } = await api.post<BulkVariantsResponse>(`/products/${productId}/variants`, {
        sizeValues,
      });
      return data;
    },
    onSuccess: (_data, variables) => {
      void client.invalidateQueries({ queryKey: ['products'] });
      void client.invalidateQueries({ queryKey: ['product', variables.productId] });
      void client.invalidateQueries({ queryKey: ['sizes'] });
    },
  });
}

/** `PUT /variants/:id` — une pointure du modèle : prix de vente, actif, SKU. */
export function useUpdateVariant() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateVariantBody }) => {
      const { data } = await api.put<VariantUpdated>(`/variants/${id}`, body);
      return data;
    },
    onSuccess: (data) => {
      void client.invalidateQueries({ queryKey: ['product', data.product.id] });
      void client.invalidateQueries({ queryKey: ['products'] });
      void client.invalidateQueries({ queryKey: ['variants'] });
    },
  });
}

/** `PUT /products/:id` — renommage ou activation / désactivation. */
export function useUpdateProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateProductBody }) => {
      const { data } = await api.put<ProductListItem>(`/products/${id}`, body);
      return data;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['products'] }),
  });
}

/** `POST /sizes` */
export function useCreateSize() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateSizeBody) => {
      const { data } = await api.post<SizeListItem>('/sizes', body);
      return data;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['sizes'] }),
  });
}

/** `DELETE /sizes/:id` — refusé (409) si des variantes l'utilisent. */
export function useDeleteSize() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/sizes/${id}`);
      return id;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['sizes'] }),
  });
}

/** `POST /suppliers|customers|online-sellers` */
export function useCreateParty() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, body }: { kind: PartyKind; body: CreatePartyBody }) => {
      const { data } = await api.post<Party>(`/${kind}`, body);
      return data;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['parties'] }),
  });
}

/** `PUT /suppliers|customers|online-sellers/:id` */
export function useUpdateParty() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      kind,
      id,
      body,
    }: {
      kind: PartyKind;
      id: string;
      body: UpdatePartyBody;
    }) => {
      const { data } = await api.put<Party>(`/${kind}/${id}`, body);
      return data;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['parties'] }),
  });
}

/** `POST /expense-categories` */
export function useCreateCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateCategoryBody) => {
      const { data } = await api.post<ExpenseCategory>('/expense-categories', body);
      return data;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['expense-categories'] }),
  });
}

/** `PUT /expense-categories/:id` — renommage ou `active:false` (jamais de suppression). */
export function useUpdateCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateCategoryBody }) => {
      const { data } = await api.put<ExpenseCategory>(`/expense-categories/${id}`, body);
      return data;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['expense-categories'] }),
  });
}

/** `POST /payment-methods` */
export function useCreateMethod() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateMethodBody) => {
      const { data } = await api.post<PaymentMethod>('/payment-methods', body);
      return data;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['payment-methods'] }),
  });
}

/** `PATCH /payment-methods/:id` */
export function useUpdateMethod() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateMethodBody }) => {
      const { data } = await api.patch<PaymentMethod>(`/payment-methods/${id}`, body);
      return data;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['payment-methods'] }),
  });
}

/** `POST /users` — création d'un compte (ADMIN). */
export function useCreateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateUserBody) => {
      const { data } = await api.post<UserItem>('/users', body);
      return data;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['users'] }),
  });
}

/** `PATCH /users/:id` — nom, rôle ou activation (ADMIN). */
export function useUpdateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: string; body: UpdateUserBody }) => {
      const { data } = await api.patch<UserItem>(`/users/${id}`, body);
      return data;
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['users'] }),
  });
}

/** `POST /users/:id/password` — réinitialisation par un administrateur (204). */
export function useResetUserPassword() {
  return useMutation({
    mutationFn: async ({ id, newPassword }: { id: string; newPassword: string }) => {
      await api.post(`/users/${id}/password`, { newPassword });
      return id;
    },
  });
}

/** `PUT /settings` — fusion des clés envoyées. */
export function useUpdateSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: SettingsMap) => {
      const { data } = await api.put<SettingsMap>('/settings', body);
      return data;
    },
    onSuccess: (data) => client.setQueryData(['settings'], data),
  });
}

/** `POST /users/me/password` — révoque toutes les sessions de l'utilisateur (204). */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (body: PasswordBody) => {
      await api.post('/users/me/password', body);
      return true;
    },
  });
}

