import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/chip';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { useLots, useRecentMovements, useStockSummary } from '@/lib/queries';
import type { LotItem, StockMovementFeedItem } from '@/lib/types';
import { useAuth } from '@/store/auth';

const STATUS_FILTERS = [
  { key: '', label: 'Tous' },
  { key: 'OPEN', label: 'Ouverts' },
  { key: 'CLOSED', label: 'Clôturés' },
] as const;

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-1 rounded-xl bg-slate-50 px-3 py-2.5">
      <Text className="text-xs text-slate-500">{label}</Text>
      <Text className="text-sm font-bold text-slate-900">{value}</Text>
    </View>
  );
}

function LotRow({ lot, onPress }: { lot: LotItem; onPress: () => void }) {
  const size = lot.variant.size.label || `${lot.variant.size.value}`;
  const open = lot.status === 'OPEN';

  return (
    <Pressable
      className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0"
      onPress={onPress}>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-slate-800">
          {lot.variant.product.name} · {size}
        </Text>
        <Text className="text-xs text-slate-400">
          {lot.code}
          {lot.supplier ? ` · ${lot.supplier.name}` : ''}
          {lot.arrival ? ` · ${lot.arrival.reference}` : ''}
        </Text>
        <Text className="text-xs text-slate-400">
          Achat {formatMoney(lot.unitCost)} · restant {lot.remainingQty}/{lot.initialQty}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-sm font-semibold text-slate-800">{formatMoney(lot.value)}</Text>
        <Text className={`text-xs ${open ? 'text-emerald-600' : 'text-slate-400'}`}>
          {open ? 'Ouvert' : 'Clôturé'}
        </Text>
      </View>
    </Pressable>
  );
}

function MovementRow({ movement }: { movement: StockMovementFeedItem }) {
  const size = movement.variant.size.value;
  const positive = movement.delta > 0;

  return (
    <View className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0">
      <View className="flex-1">
        <Text className="text-sm font-medium text-slate-800">
          {movement.variant.product.name} · {size}
        </Text>
        <Text className="text-xs text-slate-400">
          {movement.lot.code} · {movement.refType ?? '—'} · {formatDateTime(movement.date)}
        </Text>
      </View>
      <Text
        className={`text-sm font-semibold ${positive ? 'text-emerald-600' : 'text-red-600'}`}>
        {positive ? '+' : ''}
        {movement.delta}
      </Text>
    </View>
  );
}

export default function StockScreen() {
  const user = useAuth((state) => state.user);
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const summary = useStockSummary(null);
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<'' | 'OPEN' | 'CLOSED'>('');
  const lots = useLots({ q: debounced, status });
  const movements = useRecentMovements();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const openLot = (lot: LotItem) =>
    router.push({
      pathname: '/stock/lot',
      params: {
        id: lot.id,
        code: lot.code,
        product: lot.variant.product.name,
        size: lot.variant.size.label || `${lot.variant.size.value}`,
        supplier: lot.supplier?.name ?? '',
        arrival: lot.arrival?.reference ?? '',
        entryDate: lot.entryDate,
      },
    });

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ gap: 14, padding: 16 }}>
        <Text className="text-xl font-bold text-slate-900">Stock</Text>

        {/* Résumé global */}
        <View className="flex-row gap-2">
          <SummaryCard label="Quantité" value={formatQuantity(summary.data?.quantity)} />
          <SummaryCard label="Valorisation" value={formatMoney(summary.data?.value)} />
          <SummaryCard label="Lots" value={formatQuantity(summary.data?.lots)} />
        </View>

        {/* Actions */}
        {canManage ? (
          <View className="flex-row gap-2">
            <Pressable
              className="h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-brand"
              onPress={() => router.push('/arrival/new')}>
              <Ionicons color="#ffffff" name="add" size={18} />
              <Text className="font-semibold text-white">Arrivage</Text>
            </Pressable>
            <Pressable
              className="h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white"
              onPress={() => router.push('/stock/adjust')}>
              <Ionicons color="#334155" name="warning-outline" size={18} />
              <Text className="font-semibold text-slate-700">Ajuster</Text>
            </Pressable>
          </View>
        ) : (
          <View className="rounded-xl bg-slate-50 px-3 py-2.5">
            <Text className="text-xs text-slate-500">
              La saisie d&apos;arrivage et les ajustements sont réservés aux gestionnaires et
              administrateurs.
            </Text>
          </View>
        )}

        {/* Recherche de lots */}
        <View className="flex-row items-center gap-2 rounded-xl border border-slate-300 bg-white px-3">
          <Ionicons color="#94A3B8" name="search" size={18} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="h-11 flex-1 text-base text-slate-900"
            onChangeText={setTerm}
            placeholder="Modèle, fournisseur…"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={term}
          />
        </View>

        <View className="flex-row gap-2">
          {STATUS_FILTERS.map((filter) => (
            <Chip
              key={filter.key}
              label={filter.label}
              selected={status === filter.key}
              onPress={() => setStatus(filter.key)}
            />
          ))}
        </View>

        {/* Lots */}
        <View>
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Lots · {lots.data?.total ?? 0}
          </Text>
          <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {lots.isPending ? (
              <ActivityIndicator className="py-4" color="#208AEF" />
            ) : (lots.data?.items ?? []).length === 0 ? (
              <Text className="px-3 py-4 text-sm text-slate-400">Aucun lot trouvé.</Text>
            ) : (
              (lots.data?.items ?? []).map((lot) => (
                <LotRow key={lot.id} lot={lot} onPress={() => openLot(lot)} />
              ))
            )}
          </View>
        </View>

        {/* Mouvements récents */}
        <View>
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Mouvements récents
          </Text>
          <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {movements.isPending ? (
              <ActivityIndicator className="py-4" color="#208AEF" />
            ) : (movements.data?.items ?? []).length === 0 ? (
              <Text className="px-3 py-4 text-sm text-slate-400">Aucun mouvement.</Text>
            ) : (
              (movements.data?.items ?? []).map((movement) => (
                <MovementRow key={movement.id} movement={movement} />
              ))
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
