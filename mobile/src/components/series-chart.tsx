import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';

import { Chip } from '@/components/chip';
import { apiMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { useSeries } from '@/lib/queries';
import type { CustomRange, PeriodKey, SeriesMetric } from '@/lib/types';

const METRICS: { key: SeriesMetric; label: string; color: string }[] = [
  { key: 'ca', label: 'CA', color: '#208AEF' },
  { key: 'receipts', label: 'Recettes', color: '#10B981' },
  { key: 'outflow', label: 'Sorties', color: '#F97316' },
];

const AXIS_TEXT = { fontSize: 9, color: '#94A3B8' };

/**
 * §3 — graphique journalier de la période, sur la bibliothèque de la stack
 * (`react-native-gifted-charts` + `react-native-svg`, toutes deux compatibles
 * Expo Go). Les libellés de l'axe X sont éclaircis : jour du mois sur une
 * courte période, numéro de mois au-delà de 45 jours.
 */
export function SeriesChart({
  period,
  range,
}: {
  period: PeriodKey;
  range?: CustomRange | null;
}) {
  const [metric, setMetric] = useState<SeriesMetric>('ca');
  const series = useSeries(metric, period, range);
  const points = series.data?.points ?? [];
  const n = points.length;
  const color = METRICS.find((m) => m.key === metric)?.color ?? '#208AEF';

  const values = points.map((p) => Number(p.value));
  const max = Math.max(0, ...values);
  const labelEvery = Math.max(1, Math.ceil(n / 7));

  const labelOf = (date: string, index: number): string => {
    if (n > 45) return index === 0 || date.endsWith('-01') ? date.slice(5, 7) : '';
    return index % labelEvery === 0 ? date.slice(8) : '';
  };

  const state = series.isPending
    ? 'pending'
    : series.isError
      ? 'error'
      : max === 0
        ? 'empty'
        : 'ready';

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Tendance journalière
        </Text>
        {series.data ? (
          <Text className="text-xs font-semibold text-slate-700">
            Total {formatMoney(series.data.total)}
          </Text>
        ) : null}
      </View>

      <View className="flex-row flex-wrap gap-2">
        {METRICS.map((m) => (
          <Chip
            key={m.key}
            label={m.label}
            selected={metric === m.key}
            onPress={() => setMetric(m.key)}
          />
        ))}
      </View>

      <View className="rounded-xl border border-slate-200 bg-white p-3">
        {state === 'pending' ? (
          <View className="h-[160px] items-center justify-center gap-2">
            <ActivityIndicator color="#208AEF" />
            <Text className="text-xs text-slate-500">Chargement du graphique…</Text>
          </View>
        ) : state === 'error' ? (
          <View className="h-[160px] items-center justify-center gap-2 px-2">
            <Text className="text-center text-xs text-red-600">{apiMessage(series.error)}</Text>
            <Pressable
              className="rounded-lg bg-slate-100 px-3 py-1.5"
              onPress={() => void series.refetch()}>
              <Text className="text-xs font-medium text-slate-700">Réessayer</Text>
            </Pressable>
          </View>
        ) : state === 'empty' ? (
          <View className="h-[160px] items-center justify-center">
            <Text className="text-xs text-slate-500">Aucune écriture sur cette période</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingVertical: 4 }}
            horizontal
            showsHorizontalScrollIndicator={false}>
            <BarChart
              data={points.map((p, i) => ({
                value: values[i],
                label: labelOf(p.date, i),
                labelTextStyle: AXIS_TEXT,
              }))}
              barWidth={n > 90 ? 4 : n > 45 ? 6 : n > 25 ? 9 : 16}
              spacing={n > 90 ? 1 : n > 45 ? 2 : n > 25 ? 3 : 6}
              initialSpacing={4}
              endSpacing={4}
              height={140}
              noOfSections={3}
              roundedTop
              frontColor={color}
              isAnimated
              disableScroll
              rulesColor="#E2E8F0"
              xAxisColor="#CBD5E1"
              yAxisColor="transparent"
              xAxisThickness={1}
              yAxisThickness={0}
              showXAxisIndices={false}
              showYAxisIndices={false}
              yAxisLabelWidth={44}
              yAxisTextStyle={AXIS_TEXT}
              xAxisLabelTextStyle={AXIS_TEXT}
            />
          </ScrollView>
        )}
      </View>

      {series.data ? (
        <Text className="text-xs text-slate-500">
          {series.data.period} · {series.data.label} · {n} jour(s)
        </Text>
      ) : null}
    </View>
  );
}
