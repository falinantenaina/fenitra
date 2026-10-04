import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { DrilldownModal } from '@/components/drilldown-modal';
import { KpiCard, type KpiTone } from '@/components/kpi-card';
import { PeriodTabs } from '@/components/period-tabs';
import { SeriesChart } from '@/components/series-chart';
import { apiMessage } from '@/lib/api';
import { formatMoney, formatQuantity } from '@/lib/format';
import { useDashboard } from '@/lib/queries';
import type { CustomRange, IndicatorKey, PeriodKey } from '@/lib/types';
import { useAuth } from '@/store/auth';

const LABEL_CA = "Chiffre d'affaires";
const LABEL_NET = 'Bénéfice net';
const LABEL_GROSS = 'Bénéfice brut';
const INTEGRITY_OK = 'Identité comptable vérifiée';

/** §51 — actions rapides de l'accueil. */
const ACTION_ICONS = {
  sale: 'cart-outline',
  expense: 'remove-circle-outline',
  versement: 'swap-horizontal-outline',
  arrival: 'cube-outline',
  payCustomer: 'person-outline',
  paySupplier: 'business-outline',
  capital: 'wallet-outline',
} as const;

type ActionIcon = (typeof ACTION_ICONS)[keyof typeof ACTION_ICONS];

function toneOf(value: string): KpiTone {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 'neutral';
  return n > 0 ? 'positive' : 'negative';
}

function Section({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <View className="gap-2">
      <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</Text>
      <View className="flex-row flex-wrap gap-3">{children}</View>
    </View>
  );
}

export default function HomeScreen() {
  const logout = useAuth((state) => state.logout);
  const user = useAuth((state) => state.user);
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [range, setRange] = useState<CustomRange | null>(null);
  const [drill, setDrill] = useState<IndicatorKey | null>(null);

  const selectPeriod = (next: { key: PeriodKey; range?: CustomRange }) => {
    setPeriod(next.key);
    setRange(next.range ?? null);
  };

  const dashboard = useDashboard(period, range);
  const d = dashboard.data;
  const open = (indicator: IndicatorKey) => setDrill(indicator);
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  // §51 — actions rapides : la vente est ouverte à tous, les écritures qui
  // débitent la caisse restent réservées aux gestionnaires (RBAC §57).
  const actions: { key: string; label: string; icon: ActionIcon; onPress: () => void }[] = [
      { key: 'sale', label: 'Vente', icon: ACTION_ICONS.sale, onPress: () => router.push('/sale/new') },
      ...(canManage
        ? [
            {
              key: 'expense',
              label: 'Dépense',
              icon: ACTION_ICONS.expense,
              onPress: () => router.push('/finance/expense'),
            },
            {
              key: 'versement',
              label: 'Versement',
              icon: ACTION_ICONS.versement,
              onPress: () => router.push('/finance/versement'),
            },
            {
              key: 'arrival',
              label: 'Arrivage',
              icon: ACTION_ICONS.arrival,
              onPress: () => router.push('/arrival/new'),
            },
            {
              key: 'payCustomer',
              label: 'Paiement client',
              icon: ACTION_ICONS.payCustomer,
              onPress: () =>
                router.push({ pathname: '/dettes', params: { type: 'CUSTOMER', status: 'OPEN' } }),
            },
            {
              key: 'paySupplier',
              label: 'Paiement fournisseur',
              icon: ACTION_ICONS.paySupplier,
              onPress: () =>
                router.push({ pathname: '/dettes', params: { type: 'SUPPLIER', status: 'OPEN' } }),
            },
            {
              key: 'capital',
              label: 'Argent propre',
              icon: ACTION_ICONS.capital,
              onPress: () => router.push('/finance/capital'),
            },
          ]
        : []),
    ];

  return (
    <View className="flex-1 bg-slate-50">
      <PeriodTabs onChange={selectPeriod} range={range} value={period} />

      {dashboard.isPending ? (
        <View className="flex-1 items-center justify-center gap-2">
          <ActivityIndicator color="#208AEF" />
          <Text className="text-sm text-slate-500">Chargement du tableau de bord…</Text>
        </View>
      ) : dashboard.isError ? (
        <View className="flex-1 items-center justify-center gap-3 px-6">
          <Text className="text-center text-sm text-red-600">{apiMessage(dashboard.error)}</Text>
          <Pressable
            className="rounded-lg bg-slate-100 px-4 py-2"
            onPress={() => void dashboard.refetch()}>
            <Text className="text-sm font-medium text-slate-700">Réessayer</Text>
          </Pressable>
        </View>
      ) : d ? (
        <ScrollView contentContainerStyle={{ gap: 20, padding: 16, paddingBottom: 32 }}>
          <View className="gap-2">
            <Text className="text-sm text-slate-500">{d.period.label}</Text>
            <View
              className={`rounded-xl px-3 py-2 ${d.integrity.ok ? 'bg-emerald-50' : 'bg-red-50'}`}>
              <Text className={`text-xs ${d.integrity.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                {d.integrity.ok
                  ? `${INTEGRITY_OK} · écart 0`
                  : `Écart d'intégrité : ${formatMoney(d.integrity.identityDelta)}`}
              </Text>
            </View>
          </View>

          <Section title="Actions rapides">
            {actions.map((action) => (
              <Pressable
                accessibilityRole="button"
                className="w-[30%] items-center gap-1.5 rounded-xl border border-slate-200 bg-white py-3"
                key={action.key}
                onPress={action.onPress}>
                <Ionicons color="#208AEF" name={action.icon} size={20} />
                <Text className="text-center text-xs font-semibold text-slate-700">
                  {action.label}
                </Text>
              </Pressable>
            ))}
          </Section>

          <Section title="Activité de la période">
            <KpiCard
              hint={`${d.activity.salesCount} vente(s)`}
              onPress={() => open('ca')}
              title={LABEL_CA}
              value={formatMoney(d.activity.ca)}
            />
            <KpiCard
              onPress={() => open('grossProfit')}
              title={LABEL_GROSS}
              tone={toneOf(d.activity.grossProfit)}
              value={formatMoney(d.activity.grossProfit)}
            />
            <KpiCard
              onPress={() => open('netProfit')}
              title={LABEL_NET}
              tone={toneOf(d.activity.netProfit)}
              value={formatMoney(d.activity.netProfit)}
            />
            <KpiCard
              hint="marchandises vendues"
              onPress={() => open('cogs')}
              title="Coût des marchandises"
              value={formatMoney(d.activity.cogs)}
            />
            <KpiCard
              onPress={() => open('receipts')}
              title="Recettes encaissées"
              value={formatMoney(d.activity.receipts)}
            />
            <KpiCard
              onPress={() => open('expenses')}
              title="Dépenses"
              tone="negative"
              value={formatMoney(d.activity.expenses)}
            />
            <KpiCard
              onPress={() => open('versements')}
              title="Versements"
              tone={toneOf(d.activity.versementCharges)}
              value={formatMoney(d.activity.versementCharges)}
            />
          </Section>

          <SeriesChart period={period} range={range} />

          <Section title="Situation à la date">
            <KpiCard
              hint={`début de période ${formatMoney(d.money.cashAtStart)}`}
              onPress={() => open('cashBalance')}
              title="Caisse"
              value={formatMoney(d.money.cash)}
            />
            <KpiCard
              onPress={() => open('cash')}
              title="Variation de caisse"
              tone={toneOf(d.money.cashDelta)}
              value={formatMoney(d.money.cashDelta)}
            />
            <KpiCard
              hint="caisse + stock + créances − passifs"
              onPress={() => open('vola')}
              title="Vola miodina"
              tone="brand"
              value={formatMoney(d.money.volaMiodina)}
            />
            <KpiCard
              hint="à recevoir — clients + vendeurs en ligne"
              onPress={() => open('receivables')}
              title="Créances"
              value={formatMoney(d.money.receivables)}
            />
            <KpiCard
              hint="à payer — fournisseurs + trosa sinoa"
              onPress={() => open('payables')}
              title="Dettes à payer"
              value={formatMoney(d.money.payable)}
            />
            <KpiCard
              hint="bénéfice non sorti"
              onPress={() => open('disposableProfit')}
              title="Bénéfice disponible"
              tone={toneOf(d.money.disposableProfit)}
              value={formatMoney(d.money.disposableProfit)}
            />
            <KpiCard
              hint="injecté − récupéré"
              onPress={() => open('capital')}
              title="Argent propre"
              value={formatMoney(d.money.personalCapitalEngaged)}
            />
            <KpiCard
              hint="cumulé depuis le début"
              onPress={() => open('profitDrawings')}
              title="Bénéfice sorti"
              value={formatMoney(d.money.profitDrawings)}
            />
          </Section>

          <Section title="Stock et dettes">
            <KpiCard
              hint={`${formatQuantity(d.stock.quantity)} p. restantes`}
              onPress={() => open('stockValue')}
              title="Stock"
              value={formatMoney(d.stock.value)}
            />
            <KpiCard
              hint="unités en magasin"
              onPress={() => open('stockValue')}
              title="Disponibles"
              value={`${formatQuantity(d.stock.availableItems)} p.`}
            />
            <KpiCard
              hint="sorties enregistrées sur la période"
              title="Vendus"
              value={`${formatQuantity(d.stock.soldItems)} p.`}
            />
            <KpiCard
              hint="à recevoir"
              onPress={() => open('debtsCustomer')}
              title="Dettes clients"
              value={formatMoney(d.debts.customer)}
            />
            <KpiCard
              hint="à recevoir"
              onPress={() => open('debtsOnlineSeller')}
              title="Vendeurs en ligne"
              value={formatMoney(d.debts.onlineSeller)}
            />
            <KpiCard
              hint="à payer"
              onPress={() => open('debtsSupplier')}
              title="Fournisseurs"
              value={formatMoney(d.debts.supplier)}
            />
            <KpiCard
              hint="à payer, comme les fournisseurs"
              onPress={() => open('debtsTrosa')}
              title="Trosa sinoa"
              value={formatMoney(d.debts.trosaSinoa)}
            />
          </Section>

          <Pressable
            className="h-11 items-center justify-center rounded-xl border border-red-200 bg-red-50"
            onPress={() => void logout()}>
            <Text className="font-semibold text-red-600">Se déconnecter</Text>
          </Pressable>
        </ScrollView>
      ) : null}

      <DrilldownModal
        indicator={drill}
        onClose={() => setDrill(null)}
        period={period}
        range={range}
      />
    </View>
  );
}
