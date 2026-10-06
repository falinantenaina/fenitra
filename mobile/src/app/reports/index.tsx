import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chip } from '@/components/chip';
import { DateField } from '@/components/date-field';
import { ErrorPanel } from '@/components/error-panel';
import { ListFooter } from '@/components/list-footer';
import { Section } from '@/components/section';
import { toast } from '@/components/toast';
import { todayISO } from '@/lib/finance';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import {
  useDailyReport,
  useLedger,
  useLedgerSummary,
  useMonthlyReport,
} from '@/lib/queries';
import { exportAndShareReport, firstOfMonth } from '@/lib/report';
import type { DailyReport, LedgerEntry, MonthlyReport } from '@/lib/types';
import { useRefresh } from '@/lib/use-refresh';

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

function ReportBodyView({ report }: { report: DailyReport | MonthlyReport }) {
  const tone = (value: string) => (Number(value) >= 0 ? ('up' as const) : ('down' as const));
  const shownSales = report.sales.slice(0, 10);
  const a = report.activity;
  const isDaily = report.type === 'daily';
  /** §48 — le rapport mensuel classe les articles par quantité vendue. */
  const products = isDaily ? report.topProducts : report.bestSellers;

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

      {/* §48 : CA, recettes, COGS, dépenses, versements, bénéfices, caisse —
          plus les trois rubriques propres au journalier. */}
      <View className="mt-3 flex-row flex-wrap justify-between gap-y-2">
        {(
          [
            { label: 'Ventes', value: formatQuantity(a.salesCount) },
            { label: "Chiffre d'affaires", value: formatMoney(a.ca) },
            { label: 'Recettes', value: formatMoney(a.receipts) },
            { label: 'Coût des marchandises', value: formatMoney(a.cogs) },
            { label: 'Dépenses', value: formatMoney(a.expenses) },
            { label: 'Versements', value: formatMoney(a.versementCharges) },
            { label: 'Bénéfice brut', tone: tone(a.grossProfit), value: formatMoney(a.grossProfit) },
            { label: 'Bénéfice net', tone: tone(a.netProfit), value: formatMoney(a.netProfit) },
            { label: 'Caisse', value: formatMoney(report.money.cash) },
            ...(isDaily
              ? [
                  { label: 'Paiements reçus', value: formatMoney(report.paymentsReceived) },
                  { label: 'Paiements fournisseur', value: formatMoney(report.paymentsSupplier) },
                  { label: 'Nouvelles dettes', value: formatMoney(report.newDebts) },
                ]
              : []),
          ] as { label: string; value: string; tone?: 'up' | 'down' }[]
        ).map((metric) => (
          <Metric key={metric.label} {...metric} />
        ))}
      </View>

      {report.type === 'monthly' ? (
        <>
          <Section title="Situation en fin de mois" />
          <View className="mt-2 flex-row flex-wrap justify-between gap-y-2">
            <Metric
              label={`Stock · ${formatQuantity(report.stock.quantity)} paires`}
              value={formatMoney(report.stock.value)}
            />
            <Metric
              label="Clients (à recevoir)"
              value={formatMoney(Number(report.debts.customer) + Number(report.debts.onlineSeller))}
            />
            <Metric
              label="Fournisseurs (à payer)"
              value={formatMoney(Number(report.debts.supplier) + Number(report.debts.trosaSinoa))}
            />
            <Metric
              label="Argent propre engagé"
              value={formatMoney(report.money.personalCapitalEngaged)}
            />
          </View>
        </>
      ) : null}

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

      {/* §48 : journalier = meilleures ventes ; mensuel = produits les plus
          vendus, chacun affichant le bénéfice qu'il rapporte. */}
      <Section
        title={isDaily ? 'Meilleures ventes' : 'Produits les plus vendus'}
        count={products.length}
      />
      <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {products.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucun article vendu.</Text>
        ) : (
          products.slice(0, 8).map((item) => (
            <View
              className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0"
              key={item.variantId}>
              <View className="flex-1">
                <Text className="text-sm font-medium text-slate-800" numberOfLines={1}>
                  {item.product?.name ?? 'Article'}
                  {item.size ? ` · ${item.size.label || item.size.value}` : ''}
                </Text>
                <Text className="text-xs text-slate-400">
                  {item.quantity} vendu(s)
                  {isDaily ? ` · ${item.salesCount} vente(s)` : ` · bénéfice ${formatMoney(item.margin)}`}
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

      {report.type === 'monthly' ? (
        <>
          <Section title="Versements par personne" count={report.versementsByPerson.length} />
          <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {report.versementsByPerson.length === 0 ? (
              <Text className="px-3 py-4 text-sm text-slate-400">Aucun versement.</Text>
            ) : (
              report.versementsByPerson.map((row) => (
                <View
                  className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0"
                  key={row.person}>
                  <View className="flex-1">
                    <Text className="text-sm font-medium text-slate-800">{row.person}</Text>
                    <Text className="text-xs text-slate-400">{row.count} fois</Text>
                  </View>
                  <Text className="text-sm font-semibold text-slate-800">
                    {formatMoney(row.amount)}
                  </Text>
                </View>
              ))
            )}
          </View>
        </>
      ) : null}
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
        toast.error('Journal', "L'export PDF concerne les rapports journalier et mensuel.");
      }
    } catch (error) {
      toast.error('Export impossible', error instanceof Error ? error.message : 'Erreur inattendue');
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

  const retry = async () => {
    if (segment === 'daily') await daily.refetch();
    else if (segment === 'monthly') await monthly.refetch();
    else await Promise.all([ledger.refetch(), summary.refetch()]);
  };
  const { onRefresh, refreshing } = useRefresh(retry);

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ gap: 12, padding: 16 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl colors={['#208AEF']} onRefresh={onRefresh} refreshing={refreshing} />
        }>
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
          <ErrorPanel
            isRetrying={refreshing}
            message="Impossible de charger le rapport."
            onRetry={() => void onRefresh()}
          />
        ) : report ? (
          <ReportBodyView report={report} />
        ) : segment === 'ledger' ? (
          <>
            <LedgerView
              entries={ledger.items}
              isLoading={ledger.isPending}
              summary={summary.data}
            />
            <ListFooter
              fetchNextPage={() => void ledger.fetchNextPage()}
              hasMore={ledger.hasMore}
              isFetchingNextPage={ledger.isFetchingNextPage}
              shown={ledger.items.length}
              total={ledger.total}
            />
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
