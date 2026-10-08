import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { DrilldownModal } from '@/components/drilldown-modal';
import { KpiCard, type KpiTone } from '@/components/kpi-card';
import { PeriodTabs } from '@/components/period-tabs';
import { SeriesChart } from '@/components/series-chart';
import { apiMessage } from '@/lib/api';
import { formatMoney, formatQuantity } from '@/lib/format';
import { useDashboard } from '@/lib/queries';
import type { CustomRange, IndicatorKey, PeriodKey } from '@/lib/types';
import { useRefresh } from '@/lib/use-refresh';
import { useAuth } from '@/store/auth';

const LABEL_CA = "Chiffre d'affaires";
const LABEL_NET = 'Bénéfice net';
const LABEL_GROSS = 'Bénéfice brut';
const INTEGRITY_OK = 'Identité comptable vérifiée';

/** §51 — actions rapides de l'accueil. */
const ACTION_ICONS = {
  sale: 'cart-outline',
  expense: 'remove-circle-outline',
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
  const { onRefresh, refreshing } = useRefresh(() => dashboard.refetch());
  const d = dashboard.data;
  const open = (indicator: IndicatorKey) => setDrill(indicator);
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  // §51 — actions rapides : vente et dépense ouvertes à tous les rôles (A14),
  // les écritures de gestion (arrivages, paiements, argent propre) restent
  // réservées aux gestionnaires (RBAC §57).
  const actions: { key: string; label: string; icon: ActionIcon; onPress: () => void }[] = [
      { key: 'sale', label: 'Vente', icon: ACTION_ICONS.sale, onPress: () => router.push('/sale/new') },
      {
        key: 'expense',
        label: 'Dépense',
        icon: ACTION_ICONS.expense,
        onPress: () => router.push('/finance/expense'),
      },
      ...(canManage
        ? [
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
                router.push({
                  pathname: '/dettes',
                  params: { status: 'OPEN' },
                }),
            },
            {
              key: 'paySupplier',
              label: 'Paiement fournisseur',
              icon: ACTION_ICONS.paySupplier,
              onPress: () =>
                router.push({
                  pathname: '/fournisseurs',
                  params: { status: 'OPEN' },
                }),
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
        <ScrollView
          contentContainerStyle={{ gap: 20, padding: 16, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl
              colors={['#208AEF']}
              onRefresh={onRefresh}
              refreshing={refreshing}
            />
          }>
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
            {/* §A11 — les bénéfices et leurs coûts sont réservés aux
                gestionnaires : le caissier ne voit que les prix et flux. */}
            {canManage ? (
              <KpiCard
                hint={`dont achat des marchandises : ${formatMoney(d.activity.cogs)}`}
                onPress={() => open('grossProfit')}
                title={LABEL_GROSS}
                tone={toneOf(d.activity.grossProfit)}
                value={formatMoney(d.activity.grossProfit)}
              />
            ) : null}
            {canManage ? (
              <KpiCard
                hint="gagné seulement quand la vente est payée"
                onPress={() => open('netProfit')}
                title={LABEL_NET}
                tone={toneOf(d.activity.netProfit)}
                value={formatMoney(d.activity.netProfit)}
              />
            ) : null}
            <KpiCard
              onPress={() => open('receipts')}
              title="Argent reçu"
              value={formatMoney(d.activity.receipts)}
            />
            <KpiCard
              onPress={() => open('expenses')}
              title="Dépenses"
              tone="negative"
              value={formatMoney(d.activity.expenses)}
            />
            {/* §A11 — remboursements au fournisseur : réservés aux gestionnaires. */}
            {canManage ? (
              <KpiCard
                onPress={() => open('versements')}
                title="Remboursements fournisseurs"
                tone={toneOf(d.activity.versementCharges)}
                value={formatMoney(d.activity.versementCharges)}
              />
            ) : null}
          </Section>

          <SeriesChart period={period} range={range} />

          {/* §A11 — « Situation à la date » (états cumulés, bénéfices, argent
              propre) : réservée aux gestionnaires. */}
          {canManage ? (
            <Section title="Situation à la date">
              <KpiCard
                hint={`début de période ${formatMoney(d.money.cashAtStart)}`}
                onPress={() => open('cashBalance')}
                title="Caisse"
                value={formatMoney(d.money.cash)}
              />
              <KpiCard
                hint="ce que l'affaire possède moins ce qu'elle doit"
                onPress={() => open('vola')}
                title="Vola miodina"
                tone="brand"
                value={formatMoney(d.money.volaMiodina)}
              />
              <KpiCard
                hint={`gagné depuis le début — dont déjà retiré ${formatMoney(d.money.profitDrawings)}`}
                onPress={() => open('netProfitAccumulated')}
                title="Bénéfice total"
                tone={toneOf(d.money.netProfitAccumulated)}
                value={formatMoney(d.money.netProfitAccumulated)}
              />
              <KpiCard
                hint="ventes à crédit pas encore payées"
                onPress={() => open('unrealizedMargin')}
                title="Bénéfice à recevoir"
                value={formatMoney(d.money.unrealizedMargin)}
              />
              <KpiCard
                hint="retirable maintenant"
                onPress={() => open('disposableProfit')}
                title="Bénéfice disponible"
                tone={toneOf(d.money.disposableProfit)}
                value={formatMoney(d.money.disposableProfit)}
              />
              {/* §57 : le retrait est une écriture de gestion — carte ouverte aux
                  seuls gestionnaires, le dérillage de la carte ci-dessus reste à tous. */}
              <Pressable
                accessibilityRole="button"
                className="w-full flex-row items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 active:bg-emerald-100"
                onPress={() => router.push('/finance/retrait')}>
                <Text className="flex-1 text-xs font-semibold text-emerald-800">
                  Retirer du bénéfice — jusqu&apos;à {formatMoney(d.money.disposableProfit)}
                </Text>
                <Ionicons color="#059669" name="arrow-forward" size={16} />
              </Pressable>
              <KpiCard
                hint="l'argent du propriétaire mis dans l'affaire"
                onPress={() => open('capital')}
                title="Argent propre"
                value={formatMoney(d.money.personalCapitalEngaged)}
              />
            </Section>
          ) : null}

          <Section title="Stock et dettes">
            {/* §A11 — valorisation : réservée aux gestionnaires. */}
            {canManage ? (
              <KpiCard
                hint={`${formatQuantity(d.stock.quantity)} p. restantes`}
                onPress={() => open('stockValue')}
                title="Stock"
                value={formatMoney(d.stock.value)}
              />
            ) : null}
            <KpiCard
              hint="unités en magasin"
              onPress={canManage ? () => open('stockValue') : undefined}
              title="Disponibles"
              value={`${formatQuantity(d.stock.availableItems)} p.`}
            />
            <KpiCard
              hint="sorties enregistrées sur la période"
              title="Vendus"
              value={`${formatQuantity(d.stock.soldItems)} p.`}
            />
            <KpiCard
              hint="ce qu'on me doit — clients et vendeurs en ligne"
              onPress={() => open('receivables')}
              title="Dettes à recevoir"
              value={formatMoney(Number(d.debts.customer) + Number(d.debts.onlineSeller))}
            />
            {/* §A11 — dettes fournisseurs : réservées aux gestionnaires. */}
            {canManage ? (
              <KpiCard
                hint="ce que je dois — fournisseurs"
                onPress={() => open('payables')}
                title="Dettes à payer"
                value={formatMoney(Number(d.debts.supplier) + Number(d.debts.trosaSinoa))}
              />
            ) : null}
          </Section>

          <Pressable
            accessibilityRole="button"
            className="h-11 items-center justify-center rounded-xl border border-red-200 bg-red-50"
            onPress={() =>
              Alert.alert('Se déconnecter', 'Voulez-vous vraiment vous déconnecter ?', [
                { style: 'cancel', text: 'Annuler' },
                { style: 'destructive', text: 'Se déconnecter', onPress: () => void logout() },
              ])
            }>
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
