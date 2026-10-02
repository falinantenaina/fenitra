import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { Chip } from '@/components/chip';
import { formatMoney } from '@/lib/format';
import { useDebts } from '@/lib/queries';
import type { DebtItem, DebtStatus, DebtType } from '@/lib/types';

const TYPE_FILTERS: { key: DebtType | ''; label: string }[] = [
  { key: '', label: 'Toutes' },
  { key: 'CUSTOMER', label: 'Clients' },
  { key: 'ONLINE_SELLER', label: 'Vendeurs' },
  { key: 'SUPPLIER', label: 'Fournisseurs' },
  { key: 'TROSA_SINOA', label: 'Trosa' },
];

const STATUS_FILTERS: { key: DebtStatus | ''; label: string }[] = [
  { key: '', label: 'Tout statut' },
  { key: 'OPEN', label: 'Ouvertes' },
  { key: 'PARTIAL', label: 'Partielles' },
  { key: 'PAID', label: 'Réglées' },
];

const TYPE_LABELS: Record<DebtType, string> = {
  CUSTOMER: 'Client',
  ONLINE_SELLER: 'Vendeur',
  SUPPLIER: 'Fournisseur',
  TROSA_SINOA: 'Trosa sinoa',
};

const STATUS_STYLES: Record<DebtStatus, { label: string; className: string; text: string }> = {
  OPEN: { label: 'Ouverte', className: 'bg-amber-50', text: 'text-amber-700' },
  PARTIAL: { label: 'Partielle', className: 'bg-sky-50', text: 'text-sky-700' },
  PAID: { label: 'Réglée', className: 'bg-emerald-50', text: 'text-emerald-700' },
  CANCELLED: { label: 'Annulée', className: 'bg-slate-100', text: 'text-slate-500' },
};

function DebtRow({ debt, onPress }: { debt: DebtItem; onPress: () => void }) {
  const status = STATUS_STYLES[debt.status];

  return (
    <Pressable
      className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0"
      onPress={onPress}>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-slate-800">
          {debt.party?.name ?? '—'}
          <Text className="text-xs font-normal text-slate-400">
            {' '}
            · {TYPE_LABELS[debt.type]}
          </Text>
        </Text>
        {debt.reason ? (
          <Text className="text-xs text-slate-400" numberOfLines={1}>
            {debt.reason}
          </Text>
        ) : null}
        <View className={`mt-1 self-start rounded-full px-2 py-0.5 ${status.className}`}>
          <Text className={`text-[11px] font-semibold ${status.text}`}>{status.label}</Text>
        </View>
      </View>
      <View className="items-end">
        <Text className="text-sm font-bold text-slate-900">
          {formatMoney(debt.remainingAmount)}
        </Text>
        <Text className="text-xs text-slate-400">sur {formatMoney(debt.initialAmount)}</Text>
      </View>
    </Pressable>
  );
}

export default function DebtsScreen() {
  const [type, setType] = useState<DebtType | ''>('');
  const [status, setStatus] = useState<DebtStatus | ''>('');
  const debts = useDebts({ type, status });

  const openTotal = (debts.data?.items ?? [])
    .filter((d) => d.status === 'OPEN' || d.status === 'PARTIAL')
    .reduce((sum, d) => sum + Number(d.remainingAmount), 0);

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ gap: 12, padding: 16 }}>
        <Text className="text-xl font-bold text-slate-900">Dettes</Text>

        <View className="flex-row items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
          <Text className="text-xs text-slate-500">Restant dû (liste affichée)</Text>
          <Text className="text-sm font-bold text-slate-900">{formatMoney(openTotal)}</Text>
        </View>

        <ScrollView
          contentContainerStyle={{ gap: 8 }}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {TYPE_FILTERS.map((filter) => (
            <Chip
              key={filter.key || 'all'}
              label={filter.label}
              selected={type === filter.key}
              onPress={() => setType(filter.key)}
            />
          ))}
        </ScrollView>

        <ScrollView
          contentContainerStyle={{ gap: 8 }}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {STATUS_FILTERS.map((filter) => (
            <Chip
              key={filter.key || 'any'}
              label={filter.label}
              selected={status === filter.key}
              onPress={() => setStatus(filter.key)}
            />
          ))}
        </ScrollView>

        <View className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {debts.isPending ? (
            <ActivityIndicator className="py-4" color="#208AEF" />
          ) : (debts.data?.items ?? []).length === 0 ? (
            <View className="items-center gap-1 px-3 py-6">
              <Ionicons color="#CBD5E1" name="wallet-outline" size={28} />
              <Text className="text-sm text-slate-400">Aucune dette pour ce filtre.</Text>
            </View>
          ) : (
            (debts.data?.items ?? []).map((debt) => (
              <DebtRow
                key={debt.id}
                debt={debt}
                onPress={() =>
                  router.push({ pathname: '/dettes/[id]', params: { id: debt.id } })
                }
              />
            ))
          )}
        </View>

        <Text className="text-xs text-slate-400">
          {debts.data ? `${debts.data.total} dette(s) au total` : ''}
        </Text>
      </ScrollView>
    </View>
  );
}
