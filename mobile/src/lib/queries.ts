import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  CreateArrivalBody,
  DashboardResponse,
  DrilldownResponse,
  IndicatorKey,
  Party,
  PaymentMethod,
  PeriodKey,
  ProductDetail,
  ProductListItem,
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
