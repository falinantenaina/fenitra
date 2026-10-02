import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { DrilldownModal } from '@/components/drilldown-modal';
import { KpiCard, type KpiTone } from '@/components/kpi-card';
import { PeriodTabs } from '@/components/period-tabs';
import { apiMessage } from '@/lib/api';
import { formatMoney, formatQuantity } from '@/lib/format';
import { useDashboard } from '@/lib/queries';
import type { IndicatorKey, PeriodKey } from '@/lib/types';
import { useAuth } from '@/store/auth';

const LABEL_CA = "Chiffre d'affaires";
const LABEL_NET = 'Bénéfice net';
const LABEL_GROSS = 'Bénéfice brut';
const INTEGRITY_OK = 'Identité comptable vérifiée';

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
  const [period, setPeriod] = useState<PeriodKey>('today');
  const [drill, setDrill] = useState<IndicatorKey | null>(null);

  const dashboard = useDashboard(period);
  const d = dashboard.data;
  const open = (indicator: IndicatorKey) => setDrill(indicator);

  return (
    <View className="flex-1 bg-slate-50">
      <PeriodTabs onChange={setPeriod} value={period} />

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

          <Section title="Situation à la date">
            <KpiCard
              hint={`début de période ${formatMoney(d.money.cashAtStart)}`}
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
              title="Vola miodina"
              tone="brand"
              value={formatMoney(d.money.volaMiodina)}
            />
            <KpiCard
              hint="clients + vendeurs en ligne"
              title="Créances"
              value={formatMoney(d.money.receivables)}
            />
            <KpiCard
              hint="fournisseurs + trosa sinoa"
              title="Passifs"
              value={formatMoney(d.money.payable)}
            />
            <KpiCard
              hint="bénéfice non sorti"
              title="Bénéfice disponible"
              tone={toneOf(d.money.disposableProfit)}
              value={formatMoney(d.money.disposableProfit)}
            />
          </Section>

          <Section title="Stock et dettes">
            <KpiCard
              hint={formatMoney(d.stock.value)}
              title="Stock"
              value={`${formatQuantity(d.stock.quantity)} p.`}
            />
            <KpiCard
              hint={`dont trosa ${formatMoney(d.debts.trosaSinoa)}`}
              title="Dettes totales"
              value={formatMoney(d.debts.total)}
            />
            <KpiCard hint="ce que l'activité doit" title="Trosa sinoa" value={formatMoney(d.debts.trosaSinoa)} />
            <KpiCard
              hint={`bénéfice sorti ${formatMoney(d.money.profitDrawings)}`}
              title="Argent propre"
              value={formatMoney(d.money.personalCapitalEngaged)}
            />
          </Section>

          <Pressable
            className="h-11 flex-row items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white"
            onPress={() => router.push('/reports')}>
            <Ionicons color="#334155" name="document-text-outline" size={18} />
            <Text className="font-semibold text-slate-700">Rapports &amp; journal</Text>
          </Pressable>

          <Pressable
            className="h-11 items-center justify-center rounded-xl border border-red-200 bg-red-50"
            onPress={() => void logout()}>
            <Text className="font-semibold text-red-600">Se déconnecter</Text>
          </Pressable>
        </ScrollView>
      ) : null}

      <DrilldownModal indicator={drill} period={period} onClose={() => setDrill(null)} />
    </View>
  );
}
