import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type {
  DashboardResponse,
  DrilldownResponse,
  IndicatorKey,
  PeriodKey,
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
