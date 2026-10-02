import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chip } from '@/components/chip';
import { todayISO } from '@/lib/finance';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import {
  useDailyReport,
  useLedger,
  useLedgerSummary,
  useMonthlyReport,
} from '@/lib/queries';
import { exportAndShareReport, firstOfMonth } from '@/lib/report';
import type { LedgerEntry, ReportBody } from '@/lib/types';

type Segment = 'daily' | 'monthly' | 'ledger';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'daily', label: 'Journalier' },
  { key: 'monthly', label: 'Mensuel' },
  { key: 'ledger', label: 'Journal' },
];

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  const color = tone === 'up' ? 'text-emerald-600' : tone === 'down' ? 'text-red-600' : 'text-slate-900';
  return (
    <View className="w-[48%] gap-0.5 rounded-xl bg-slate-50 px-3 py-2.5">
      <Text className="text-xs text-slate-500">{label}</Text>
      <Text className={`text-sm font-bold ${color}`}>{value}</Text>
    </View>
  );
}

function DateField({
  label,
  value,
  onChange,
  onToday,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onToday?: () => void;
}) {
  return (
    <View className="flex-1 flex-row items-end gap-2">
      <View className="flex-1 gap-1">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</Text>
        <TextInput
          autoCapitalize="none"
          className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900"
          keyboardType="numbers-and-punctuation"
          onChangeText={(next) => onChange(next.trim())}
          placeholder="AAAA-MM-JJ"
          placeholderTextColor="#94A3B8"
          selectionColor="#208AEF"
          value={value}
        />
      </View>
      {onToday ? (
        <Pressable
          className="h-10 items-center justify-center rounded-xl bg-slate-100 px-3"
          onPress={onToday}>
          <Text className="text-sm font-medium text-slate-700">Aujourd&apos;hui</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Section({ title, count }: { title: string; count?: number }) {
  return (
    <Text className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
      {title}
      {typeof count === 'number' ? ` · ${count}` : ''}
    </Text>
  );
}

function ReportBodyView({ report }: { report: ReportBody & { label: string } }) {
  const tone = (value: string) => (Number(value) >= 0 ? ('up' as const) : ('down' as const));
  const shownSales = report.sales.slice(0, 10);

  return (
    <View>
      <View className="flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <View className="flex-1">
          <Text className="text-sm font-semibold text-slate-900">{report.label}</Text>
          <Text className="text-xs text-slate-400">
            {formatDateTime(report.period.from)} → {formatDateTime(report.period.to)}
          </Text>
        </View>
        <View
          className={`rounded-full px-2 py-1 ${report.integrity.ok ? 'bg-emerald-50' : 'bg-red-50'}`}>
          <Text
            className={`text-[11px] font-semibold ${report.integrity.ok ? 'text-emerald-700' : 'text-red-600'}`}>
            {report.integrity.ok ? 'Équilibré' : `Écart ${report.integrity.identityDelta}`}
          </Text>
        </View>
      </View>

      <View className="mt-3 flex-row flex-wrap justify-between gap-y-2">
        <Metric label="Ventes" value={formatQuantity(report.activity.salesCount)} />
        <Metric label="Chiffre d'affaires" value={formatMoney(report.activity.ca)} />
        <Metric
          label="Bénéfice net"
          tone={tone(report.activity.netProfit)}
          value={formatMoney(report.activity.netProfit)}
        />
        <Metric label="Recettes" value={formatMoney(report.activity.receipts)} />
        <Metric label="Dépenses" value={formatMoney(report.activity.expenses)} />
        <Metric label="Caisse" value={formatMoney(report.money.cash)} />
      </View>

      <Section title="Ventes" count={report.sales.length} />
      <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {report.sales.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucune vente sur la période.</Text>
        ) : (
          shownSales.map((sale) => (
            <View
              className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0"
              key={sale.id}>
              <View className="flex-1">
                <Text className="text-sm font-semibold text-slate-800">
                  {sale.reference}
                  {sale.party ? ` · ${sale.party}` : ''}
                </Text>
                <Text className="text-xs text-slate-400">
                  {formatDateTime(sale.date)} · {sale.items.length} ligne(s)
                </Text>
              </View>
              <View className="items-end">
                <Text className="text-sm font-bold text-slate-900">
                  {formatMoney(sale.totalAmount)}
                </Text>
                <Text className="text-xs text-emerald-600">marge {formatMoney(sale.margin)}</Text>
              </View>
            </View>
          ))
        )}
        {report.sales.length > shownSales.length ? (
          <Text className="px-3 py-2 text-xs text-slate-400">
            … et {report.sales.length - shownSales.length} autre(s) — voir l&apos;export PDF.
          </Text>
        ) : null}
      </View>

      <Section title="Meilleures ventes" count={report.topProducts.length} />
      <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {report.topProducts.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucun article vendu.</Text>
        ) : (
          report.topProducts.slice(0, 5).map((item) => (
            <View
              className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0"
              key={item.variantId}>
              <View className="flex-1">
                <Text className="text-sm font-medium text-slate-800" numberOfLines={1}>
                  {item.product?.name ?? 'Article'}
                  {item.size?.label ? ` · ${item.size.label}` : ''}
                </Text>
                <Text className="text-xs text-slate-400">
                  {item.quantity} vendu(s) · {item.salesCount} vente(s)
                </Text>
              </View>
              <Text className="text-sm font-semibold text-slate-800">
                {formatMoney(item.revenue)}
              </Text>
            </View>
          ))
        )}
      </View>

      <Section title="Dépenses par catégorie" count={report.expensesByCategory.length} />
      <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {report.expensesByCategory.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucune dépense.</Text>
        ) : (
          report.expensesByCategory.map((row) => (
            <View
              className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0"
              key={row.category.id}>
              <Text className="flex-1 text-sm font-medium text-slate-800">
                {row.category.name}
                <Text className="text-xs text-slate-400"> · {row.count} fois</Text>
              </Text>
              <Text className="text-sm font-semibold text-red-600">
                −{formatMoney(row.amount)}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function LedgerView({
  entries,
  isLoading,
  summary,
}: {
  entries: LedgerEntry[];
  isLoading: boolean;
  summary: ReturnType<typeof useLedgerSummary>['data'];
}) {
  return (
    <View>
      {summary ? (
        <View className="flex-row flex-wrap justify-between gap-y-2">
          <Metric label="Écritures" value={formatQuantity(summary.totals.count)} />
          <Metric label="Volume" value={formatMoney(summary.totals.amount)} />
          <Metric
            label="Impact caisse"
            tone={Number(summary.totals.cashDelta) >= 0 ? 'up' : 'down'}
            value={formatMoney(summary.totals.cashDelta)}
          />
        </View>
      ) : null}

      {summary ? (
        <>
          <Section title="Par type d'écriture" count={summary.byKind.length} />
          <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {summary.byKind.length === 0 ? (
              <Text className="px-3 py-4 text-sm text-slate-400">Aucune écriture.</Text>
            ) : (
              summary.byKind.map((row) => (
                <View
                  className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0"
                  key={row.kind}>
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-slate-800">{row.kind}</Text>
                    <Text className="text-xs text-slate-400">{row.count} écriture(s)</Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-sm font-semibold text-slate-800">
                      {formatMoney(row.amount)}
                    </Text>
                    <Text className="text-xs text-slate-400">
                      caisse {formatMoney(row.cashDelta)}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </>
      ) : null}

      <Section title="Écritures" count={entries.length} />
      <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {isLoading ? (
          <ActivityIndicator className="py-4" color="#208AEF" />
        ) : entries.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucune écriture sur la période.</Text>
        ) : (
          entries.map((entry) => (
            <View
              className="border-b border-slate-100 px-3 py-2.5 last:border-b-0"
              key={entry.id}>
              <View className="flex-row items-center justify-between gap-3">
                <Text className="text-sm font-medium text-slate-800">
                  {entry.kind}
                  {entry.reference ? ` · ${entry.reference}` : ''}
                </Text>
                <Text
                  className={`text-sm font-semibold ${
                    Number(entry.cashDelta) >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                  {formatMoney(entry.cashDelta)}
                </Text>
              </View>
              <Text className="text-xs text-slate-400" numberOfLines={2}>
                {formatDateTime(entry.date)} · {entry.description}
                {entry.user ? ` · ${entry.user.name}` : ''}
              </Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

export default function ReportsScreen() {
  const [segment, setSegment] = useState<Segment>('daily');
  const [date, setDate] = useState(todayISO());
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(todayISO());
  const [sharing, setSharing] = useState(false);

  const daily = useDailyReport(date, segment === 'daily');
  const monthly = useMonthlyReport(Number(year), Number(month), segment === 'monthly');
  const ledger = useLedger(from, to, segment === 'ledger');
  const summary = useLedgerSummary(from, to, segment === 'ledger');

  const exportPdf = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      if (segment === 'daily') {
        await exportAndShareReport({ type: 'daily', date });
      } else if (segment === 'monthly') {
        await exportAndShareReport({ type: 'monthly', year: Number(year), month: Number(month) });
      } else {
        Alert.alert('Journal', "L'export PDF concerne les rapports journalier et mensuel.");
      }
    } catch (error) {
      Alert.alert('Export impossible', error instanceof Error ? error.message : 'Erreur inattendue');
    } finally {
      setSharing(false);
    }
  };

  const report =
    segment === 'daily' ? daily.data : segment === 'monthly' ? monthly.data : null;
  const pending =
    (segment === 'daily' && daily.isPending) ||
    (segment === 'monthly' && monthly.isPending) ||
    (segment === 'ledger' && (ledger.isPending || summary.isPending));
  const failed =
    (segment === 'daily' && daily.isError) ||
    (segment === 'monthly' && monthly.isError) ||
    (segment === 'ledger' && (ledger.isError || summary.isError));

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ gap: 12, padding: 16 }} keyboardShouldPersistTaps="handled">
        <ScrollView
          contentContainerStyle={{ gap: 8 }}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {SEGMENTS.map((item) => (
            <Chip
              key={item.key}
              label={item.label}
              selected={segment === item.key}
              onPress={() => setSegment(item.key)}
            />
          ))}
        </ScrollView>

        {segment === 'daily' ? (
          <DateField label="Date du rapport" onChange={setDate} onToday={() => setDate(todayISO())} value={date} />
        ) : null}

        {segment === 'monthly' ? (
          <View className="flex-row gap-2">
            <View className="w-28 gap-1">
              <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">Année</Text>
              <TextInput
                className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900"
                keyboardType="numeric"
                onChangeText={(next) => setYear(next.replace(/[^0-9]/g, ''))}
                value={year}
              />
            </View>
            <View className="w-20 gap-1">
              <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">Mois</Text>
              <TextInput
                className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900"
                keyboardType="numeric"
                onChangeText={(next) => setMonth(next.replace(/[^0-9]/g, ''))}
                value={month}
              />
            </View>
            <Pressable
              className="mb-0.5 h-10 items-center justify-center rounded-xl bg-slate-100 px-3"
              onPress={() => {
                const now = new Date();
                setYear(String(now.getFullYear()));
                setMonth(String(now.getMonth() + 1));
              }}>
              <Text className="text-sm font-medium text-slate-700">Ce mois</Text>
            </Pressable>
          </View>
        ) : null}

        {segment === 'ledger' ? (
          <View className="flex-row gap-2">
            <DateField label="Du" onChange={setFrom} value={from} />
            <DateField label="Au" onChange={setTo} value={to} />
          </View>
        ) : null}

        {segment !== 'ledger' ? (
          <Pressable
            className={`h-11 flex-row items-center justify-center gap-2 rounded-xl ${
              sharing ? 'bg-slate-300' : 'bg-brand'
            }`}
            disabled={sharing}
            onPress={() => void exportPdf()}>
            {sharing ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Ionicons color="#ffffff" name="document-text-outline" size={18} />
            )}
            <Text className="font-semibold text-white">
              {sharing ? 'Préparation…' : 'Exporter en PDF'}
            </Text>
          </Pressable>
        ) : null}

        {pending ? (
          <ActivityIndicator className="py-8" color="#208AEF" />
        ) : failed ? (
          <View className="items-center gap-1 rounded-xl bg-red-50 px-3 py-4">
            <Ionicons color="#DC2626" name="alert-circle-outline" size={24} />
            <Text className="text-sm text-red-600">Impossible de charger le rapport.</Text>
          </View>
        ) : report ? (
          <ReportBodyView report={report} />
        ) : segment === 'ledger' ? (
          <LedgerView
            entries={ledger.data?.items ?? []}
            isLoading={ledger.isPending}
            summary={summary.data}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}
