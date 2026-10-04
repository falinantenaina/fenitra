import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from 'react-native';

import { apiMessage } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useDrilldown } from '@/lib/queries';
import type { CustomRange, DrillEntry, IndicatorKey, PeriodKey } from '@/lib/types';

interface DrilldownModalProps {
  /** `null` = modal fermée. */
  indicator: IndicatorKey | null;
  period: PeriodKey;
  /** Bornes de `period=custom`, reprises pour que le dérillage suive l'écran. */
  range?: CustomRange | null;
  onClose: () => void;
}

function EntryRow({ entry }: { entry: DrillEntry }) {
  const cash = Number(entry.cashDelta);
  return (
    <View className="flex-row items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <View className="flex-1 gap-0.5">
        <Text className="text-sm text-slate-800" numberOfLines={2}>
          {entry.description}
        </Text>
        <Text className="text-[11px] text-slate-400">
          {formatDateTime(entry.date)} · {entry.kind}
          {entry.reference ? ` · ${entry.reference}` : ''}
        </Text>
      </View>
      <View className="items-end gap-0.5">
        <Text className="text-sm font-semibold text-slate-900">{formatMoney(entry.amount)}</Text>
        <Text
          className={`text-[11px] ${
            cash > 0 ? 'text-emerald-600' : cash < 0 ? 'text-red-500' : 'text-slate-400'
          }`}>
          caisse {formatMoney(entry.cashDelta)}
        </Text>
      </View>
    </View>
  );
}

export function DrilldownModal({ indicator, period, range, onClose }: DrilldownModalProps) {
  const open = indicator !== null;
  const query = useDrilldown(indicator ?? 'ca', period, range, open);

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={open}>
      <View className="flex-1 bg-white">
        <View className="flex-row items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <View className="flex-1">
            <Text className="text-base font-semibold text-slate-900">
              {query.data?.label ?? 'Dérillage'}
            </Text>
            <Text className="text-xs text-slate-500">
              {query.data?.period.label ?? ''}
              {query.data?.scope === 'toDate' ? ' · cumulé jusqu’à la date' : ''}
              {query.data ? ` · ${query.data.count} écriture(s)` : ''}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            className="rounded-lg bg-slate-100 px-3 py-2"
            onPress={onClose}>
            <Text className="text-sm font-medium text-slate-700">Fermer</Text>
          </Pressable>
        </View>

        {query.isPending ? (
          <View className="flex-1 items-center justify-center gap-2">
            <ActivityIndicator color="#208AEF" />
            <Text className="text-sm text-slate-500">Chargement des écritures…</Text>
          </View>
        ) : query.isError ? (
          <View className="flex-1 items-center justify-center gap-3 px-6">
            <Text className="text-center text-sm text-red-600">{apiMessage(query.error)}</Text>
            <Pressable
              className="rounded-lg bg-slate-100 px-4 py-2"
              onPress={() => void query.refetch()}>
              <Text className="text-sm font-medium text-slate-700">Réessayer</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={query.data?.entries ?? []}
            keyExtractor={(entry) => entry.id}
            ListEmptyComponent={
              <View className="items-center gap-1 px-6 py-10">
                <Text className="text-sm font-medium text-slate-700">
                  Aucune écriture sur cette période
                </Text>
                <Text className="text-center text-xs text-slate-400">
                  Changez de période pour afficher un autre historique.
                </Text>
              </View>
            }
            ListHeaderComponent={
              <View className="flex-row items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Total de l&apos;indicateur
                </Text>
                <Text className="text-base font-bold text-slate-900">
                  {formatMoney(query.data?.total)}
                </Text>
              </View>
            }
            renderItem={({ item }) => <EntryRow entry={item} />}
          />
        )}
      </View>
    </Modal>
  );
}
