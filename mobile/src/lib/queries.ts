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
  CreateCategoryBody,
  CreateExpenseBody,
  CreateMethodBody,
  CreatePartyBody,
  CreateProductBody,
  CreateSaleBody,
  CreateSizeBody,
  CreateTrosaBody,
  CreateUserBody,
  CreateVersementBody,
  DashboardResponse,
  DailyReport,
  DebtDetail,
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
  SaleCreated,
  SettingsMap,
  SizeListItem,
  StockMovementFeedItem,
  StockSummary,
  UpdateCategoryBody,
  UpdateMethodBody,
  UpdatePartyBody,
  UpdateProductBody,
  UpdateUserBody,
  UserItem,
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

/** Journal financier sur une plage (`GET /ledger`). */
export function useLedger(
  from: string,
  to: string,
  enabled = true,
): UseQueryResult<PagedResponse<LedgerEntry>> {
  return useQuery<PagedResponse<LedgerEntry>>({
    queryKey: ['ledger', 'list', from, to],
    enabled: enabled && Boolean(from && to),
    queryFn: async () => {
      const { data } = await api.get<PagedResponse<LedgerEntry>>('/ledger', {
        params: { from, to, limit: 50 },
      });
      return data;
    },
    staleTime: 15_000,
  });
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

