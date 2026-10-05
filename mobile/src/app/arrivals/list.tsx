import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ListFooter } from '@/components/list-footer';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { useArrivals } from '@/lib/queries';
import { ARRIVAL_STATUS, TO_VENTILATE_STYLE } from '@/lib/status';
import type { ArrivalRow, ArrivalStatus } from '@/lib/types';

interface ArrivalFilter {
  key: string;
  label: string;
  status: ArrivalStatus | '';
  unventilated?: boolean;
}

const STATUS_FILTERS: ArrivalFilter[] = [
  { key: 'all', label: 'Tous', status: '' },
  { key: 'received', label: 'Reçus', status: 'RECEIVED' },
  { key: 'unventilated', label: 'À ventiler', status: 'RECEIVED', unventilated: true },
  { key: 'cancelled', label: 'Annulés', status: 'CANCELLED' },
];

function ArrivalRowView({ arrival, onPress }: { arrival: ArrivalRow; onPress: () => void }) {
  const status = ARRIVAL_STATUS[arrival.status];
  const pending = arrival.status === 'RECEIVED' && arrival.toVentilate > 0;
  const badge = pending ? TO_VENTILATE_STYLE : status;

  return (
    <Pressable
      className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0"
      onPress={onPress}>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-slate-800">
          {arrival.reference}
          <Text className="text-xs font-normal text-slate-400">
            {' '}
            · {arrival.supplier.name}
          </Text>
        </Text>
        <Text className="text-xs text-slate-400">
          {formatDateTime(arrival.date)} · {formatQuantity(arrival.totalQty)} article
          {arrival.totalQty > 1 ? 's' : ''}
        </Text>
        <View className={`mt-1 self-start rounded-full px-2 py-0.5 ${badge.className}`}>
          <Text className={`text-[11px] font-semibold ${badge.text}`}>
            {pending ? `${badge.label} (${arrival.toVentilate})` : badge.label}
          </Text>
        </View>
      </View>
      <View className="items-end">
        <Text className="text-sm font-bold text-slate-900">{formatMoney(arrival.totalCost)}</Text>
        {Number(arrival.unpaidAmount) > 0 ? (
          <Text className="text-xs text-amber-600">
            dû {formatMoney(arrival.unpaidAmount)}
          </Text>
        ) : (
          <Text className="text-xs text-emerald-600">soldé</Text>
        )}
      </View>
    </Pressable>
  );
}

export default function ArrivalsScreen() {
  const [filter, setFilter] = useState<ArrivalFilter>(STATUS_FILTERS[0]!);
  const arrivals = useArrivals({ status: filter.status, unventilated: filter.unventilated });

  const displayedTotal = arrivals.items.reduce((sum, a) => sum + Number(a.totalCost), 0);

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ gap: 12, padding: 16 }}>
        <Pressable
          className="h-11 flex-row items-center justify-center gap-2 rounded-xl bg-brand"
          onPress={() => router.push('/arrival/new')}>
          <Ionicons color="#ffffff" name="add" size={18} />
          <Text className="font-semibold text-white">Nouvel arrivage</Text>
        </Pressable>

        <View className="flex-row items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
          <Text className="text-xs text-slate-500">
            {arrivals.items.length} affiché{arrivals.items.length > 1 ? 's' : ''} ·{' '}
            {arrivals.total} au total
          </Text>
          <Text className="text-sm font-bold text-slate-900">
            {formatMoney(displayedTotal)}
          </Text>
        </View>

        <ScrollView
          contentContainerStyle={{ gap: 8 }}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {STATUS_FILTERS.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              selected={filter.key === option.key}
              onPress={() => setFilter(option)}
            />
          ))}
        </ScrollView>

        <View className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {arrivals.isPending ? (
            <ActivityIndicator className="py-4" color="#208AEF" />
          ) : arrivals.isError ? (
            <View className="items-center gap-1 px-3 py-6">
              <Ionicons color="#FCA5A5" name="alert-circle-outline" size={28} />
              <Text className="text-sm text-slate-500">Impossible de charger les arrivages.</Text>
            </View>
          ) : arrivals.items.length === 0 ? (
            <View className="items-center gap-1 px-3 py-6">
              <Ionicons color="#CBD5E1" name="cube-outline" size={28} />
              <Text className="text-sm text-slate-400">Aucun arrivage pour ce filtre.</Text>
            </View>
          ) : (
            arrivals.items.map((arrival) => (
              <ArrivalRowView
                key={arrival.id}
                arrival={arrival}
                onPress={() =>
                  router.push({ pathname: '/arrivals/[id]', params: { id: arrival.id } })
                }
              />
            ))
          )}
        </View>

        <ListFooter
          fetchNextPage={() => void arrivals.fetchNextPage()}
          hasMore={arrivals.hasMore}
          isFetchingNextPage={arrivals.isFetchingNextPage}
          shown={arrivals.items.length}
          total={arrivals.total}
        />
      </ScrollView>
    </View>
  );
}
