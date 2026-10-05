import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ErrorPanel } from '@/components/error-panel';
import { ListFooter } from '@/components/list-footer';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useSales } from '@/lib/queries';
import { SALE_STATUS } from '@/lib/status';
import { useRefresh } from '@/lib/use-refresh';
import type { SaleRow, SaleStatus } from '@/lib/types';

const STATUS_FILTERS: { key: SaleStatus | ''; label: string }[] = [
  { key: '', label: 'Toutes' },
  { key: 'PAID', label: 'Réglées' },
  { key: 'PARTIAL', label: 'Partielles' },
  { key: 'UNPAID', label: 'Impayées' },
  { key: 'CANCELLED', label: 'Annulées' },
];

function SaleRowView({ sale, onPress }: { sale: SaleRow; onPress: () => void }) {
  const status = SALE_STATUS[sale.status];
  const party = sale.customer ?? sale.onlineSeller;

  return (
    <Pressable
      className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0"
      onPress={onPress}>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-slate-800">
          {sale.reference}
          <Text className="text-xs font-normal text-slate-400">
            {' '}
            · {party?.name ?? 'Comptoir'}
          </Text>
        </Text>
        <Text className="text-xs text-slate-400">{formatDateTime(sale.date)}</Text>
        <View className={`mt-1 self-start rounded-full px-2 py-0.5 ${status.className}`}>
          <Text className={`text-[11px] font-semibold ${status.text}`}>{status.label}</Text>
        </View>
      </View>
      <View className="items-end">
        <Text className="text-sm font-bold text-slate-900">{formatMoney(sale.totalAmount)}</Text>
        {Number(sale.remainingAmount) > 0 ? (
          <Text className="text-xs text-amber-600">
            reste {formatMoney(sale.remainingAmount)}
          </Text>
        ) : (
          <Text className="text-xs text-emerald-600">soldée</Text>
        )}
      </View>
    </Pressable>
  );
}

export default function VentesScreen() {
  const [status, setStatus] = useState<SaleStatus | ''>('');
  const sales = useSales({ status });
  const { onRefresh, refreshing } = useRefresh(() => sales.refetch());

  const displayedTotal = sales.items.reduce((sum, s) => sum + Number(s.totalAmount), 0);

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ gap: 12, padding: 16 }}
        refreshControl={
          <RefreshControl colors={['#208AEF']} onRefresh={onRefresh} refreshing={refreshing} />
        }>
        <Text className="text-xl font-bold text-slate-900">Ventes</Text>

        <Pressable
          className="h-11 flex-row items-center justify-center gap-2 rounded-xl bg-brand"
          onPress={() => router.push('/sale/new')}>
          <Ionicons color="#ffffff" name="add" size={18} />
          <Text className="font-semibold text-white">Nouvelle vente</Text>
        </Pressable>

        <View className="flex-row items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
          <Text className="text-xs text-slate-500">
            {sales.items.length} affichée{sales.items.length > 1 ? 's' : ''} ·{' '}
            {sales.total} au total
          </Text>
          <Text className="text-sm font-bold text-slate-900">
            {formatMoney(displayedTotal)}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={{ gap: 8 }}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {STATUS_FILTERS.map((filter) => (
            <Chip
              key={filter.key || 'all'}
              label={filter.label}
              selected={status === filter.key}
              onPress={() => setStatus(filter.key)}
            />
          ))}
        </ScrollView>

        <View className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {sales.isPending ? (
            <ActivityIndicator className="py-4" color="#208AEF" />
          ) : sales.isError ? (
            <ErrorPanel
              isRetrying={sales.isRefetching}
              message="Impossible de charger les ventes."
              onRetry={() => void sales.refetch()}
            />
          ) : sales.items.length === 0 ? (
            <View className="items-center gap-1 px-3 py-6">
              <Ionicons color="#CBD5E1" name="receipt-outline" size={28} />
              <Text className="text-sm text-slate-400">Aucune vente pour ce filtre.</Text>
            </View>
          ) : (
            sales.items.map((sale) => (
              <SaleRowView
                key={sale.id}
                sale={sale}
                onPress={() =>
                  router.push({ pathname: '/sales/[id]', params: { id: sale.id } })
                }
              />
            ))
          )}
        </View>

        <ListFooter
          fetchNextPage={() => void sales.fetchNextPage()}
          hasMore={sales.hasMore}
          isFetchingNextPage={sales.isFetchingNextPage}
          shown={sales.items.length}
          total={sales.total}
        />
      </ScrollView>
    </View>
  );
}
