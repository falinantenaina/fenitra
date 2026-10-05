import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ErrorPanel } from '@/components/error-panel';
import { ListFooter } from '@/components/list-footer';
import { formatMoney } from '@/lib/format';
import { useDebts, useDebtsByParty } from '@/lib/queries';
import type {
  DebtDirection,
  DebtItem,
  DebtPartyGroup,
  DebtStatus,
  DebtType,
} from '@/lib/types';
import { useRefresh } from '@/lib/use-refresh';

const DIRECTION_FILTERS: { key: DebtDirection | ''; label: string }[] = [
  { key: '', label: 'Toutes' },
  { key: 'RECEIVABLE', label: 'Clients (à recevoir)' },
  { key: 'PAYABLE', label: 'Fournisseurs (à payer)' },
];

const STATUS_FILTERS: { key: DebtStatus | ''; label: string }[] = [
  { key: '', label: 'Tout statut' },
  { key: 'OPEN', label: 'Ouvertes' },
  { key: 'PARTIAL', label: 'Partielles' },
  { key: 'PAID', label: 'Réglées' },
];

// Un seul libellé par sens (§18, fusion à l'affichage) : les vendeurs en
// ligne sont des clients, la trosa sinoa est traitée comme une dette
// fournisseur.
const TYPE_LABELS: Record<DebtType, string> = {
  CUSTOMER: 'Client (à recevoir)',
  ONLINE_SELLER: 'Client (à recevoir)',
  SUPPLIER: 'Fournisseur (à payer)',
  TROSA_SINOA: 'Fournisseur (à payer)',
};

const STATUS_STYLES: Record<DebtStatus, { label: string; className: string; text: string }> = {
  OPEN: { label: 'Ouverte', className: 'bg-amber-50', text: 'text-amber-700' },
  PARTIAL: { label: 'Partielle', className: 'bg-sky-50', text: 'text-sky-700' },
  PAID: { label: 'Réglée', className: 'bg-emerald-50', text: 'text-emerald-700' },
  CANCELLED: { label: 'Annulée', className: 'bg-slate-100', text: 'text-slate-500' },
};

/** Répartition d'un groupe, en minuscules : « 1 ouverte · 1 partielle ». */
const STATUS_LOWER: Record<DebtStatus, string> = {
  OPEN: 'ouverte',
  PARTIAL: 'partielle',
  PAID: 'réglée',
  CANCELLED: 'annulée',
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

/** Détail d'un tiers : ses dettes, une par une (clic sur la ligne du tiers). */
function PartyDebts({
  group,
  direction,
  status,
}: {
  group: DebtPartyGroup;
  direction: DebtDirection | '';
  status: DebtStatus | '';
}) {
  const debts = useDebts({
    direction,
    status,
    partyId: group.party.id ?? undefined,
    partyName: group.party.id ? undefined : group.party.name,
  });

  return (
    <View className="border-t border-slate-100 bg-slate-50 pt-3">
      <Text className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Dettes · {debts.total}
      </Text>
      <View className="mt-2 overflow-hidden bg-white">
        {debts.isPending ? (
          <ActivityIndicator className="py-4" color="#208AEF" />
        ) : debts.isError ? (
          <ErrorPanel
            isRetrying={debts.isRefetching}
            message="Impossible de charger les dettes de cette personne."
            onRetry={() => void debts.refetch()}
          />
        ) : debts.items.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucune dette pour cette personne.</Text>
        ) : (
          debts.items.map((debt) => (
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
      <ListFooter
        fetchNextPage={() => void debts.fetchNextPage()}
        hasMore={debts.hasMore}
        isFetchingNextPage={debts.isFetchingNextPage}
        shown={debts.items.length}
        total={debts.total}
      />
    </View>
  );
}

/** Une ligne par personne — le clic ouvre le détail de ses dettes. */
function PartyRow({
  group,
  expanded,
  direction,
  status,
  onPress,
}: {
  group: DebtPartyGroup;
  expanded: boolean;
  direction: DebtDirection | '';
  status: DebtStatus | '';
  onPress: () => void;
}) {
  const breakdown = (Object.keys(STATUS_LOWER) as DebtStatus[])
    .filter((key) => (group.statusCounts[key] ?? 0) > 0)
    .map((key) => `${group.statusCounts[key]} ${STATUS_LOWER[key]}`)
    .join(' · ');

  return (
    <View className="border-b border-slate-100 last:border-b-0">
      <Pressable className="flex-row items-center gap-3 px-3 py-3" onPress={onPress}>
        <View className="flex-1">
          <Text className="text-sm font-semibold text-slate-800">
            {group.party.name}
            <Text className="text-xs font-normal text-slate-400">
              {' '}
              · {TYPE_LABELS[group.type]}
            </Text>
          </Text>
          <Text className="text-xs text-slate-400">
            {group.count} dette(s)
            {breakdown ? ` · ${breakdown}` : ''}
          </Text>
        </View>
        <View className="items-end">
          <Text className="text-sm font-bold text-slate-900">
            {formatMoney(group.remainingAmount)}
          </Text>
          <Text className="text-xs text-slate-400">sur {formatMoney(group.initialAmount)}</Text>
        </View>
        <Ionicons
          color={expanded ? '#208AEF' : '#CBD5E1'}
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={16}
        />
      </Pressable>
      {expanded ? (
        <PartyDebts direction={direction} group={group} status={status} />
      ) : null}
    </View>
  );
}

/** §51 — filtre reçu dans l'URL par les raccourcis « Paiement client/fournisseur ». */
function parseDirection(value?: string): DebtDirection | '' {
  return DIRECTION_FILTERS.some((f) => f.key === value) ? (value as DebtDirection) : '';
}

function parseStatus(value?: string): DebtStatus | '' {
  return STATUS_FILTERS.some((f) => f.key === value) ? (value as DebtStatus) : '';
}

export default function DebtsScreen() {
  const params = useLocalSearchParams<{ direction?: string; status?: string }>();
  // La clé remet l'état local à zéro quand les paramètres changent : le
  // raccourci applique son filtre sans passer par un effet de synchronisation.
  return (
    <DebtsBody
      key={`${params.direction ?? ''}:${params.status ?? ''}`}
      initialStatus={params.status}
      initialDirection={params.direction}
    />
  );
}

function DebtsBody({
  initialDirection,
  initialStatus,
}: {
  initialDirection?: string;
  initialStatus?: string;
}) {
  const [direction, setDirection] = useState<DebtDirection | ''>(parseDirection(initialDirection));
  const [status, setStatus] = useState<DebtStatus | ''>(parseStatus(initialStatus));
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useDebtsByParty({ direction, status });
  const { onRefresh, refreshing } = useRefresh(() => groups.refetch());

  const openTotal = groups.items.reduce((sum, group) => sum + Number(group.remainingAmount), 0);

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ gap: 12, padding: 16 }}
        refreshControl={
          <RefreshControl colors={['#208AEF']} onRefresh={onRefresh} refreshing={refreshing} />
        }>
        <Text className="text-xl font-bold text-slate-900">Dettes</Text>

        <View className="flex-row items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
          <Text className="text-xs text-slate-500">Restant dû (liste affichée)</Text>
          <Text className="text-sm font-bold text-slate-900">{formatMoney(openTotal)}</Text>
        </View>

        <ScrollView
          contentContainerStyle={{ gap: 8 }}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {DIRECTION_FILTERS.map((filter) => (
            <Chip
              key={filter.key || 'all'}
              label={filter.label}
              selected={direction === filter.key}
              onPress={() => setDirection(filter.key)}
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
          {groups.isPending ? (
            <ActivityIndicator className="py-4" color="#208AEF" />
          ) : groups.isError ? (
            <ErrorPanel
              isRetrying={groups.isRefetching}
              message="Impossible de charger les dettes."
              onRetry={() => void groups.refetch()}
            />
          ) : groups.items.length === 0 ? (
            <View className="items-center gap-1 px-3 py-6">
              <Ionicons color="#CBD5E1" name="wallet-outline" size={28} />
              <Text className="text-sm text-slate-400">Aucune dette pour ce filtre.</Text>
            </View>
          ) : (
            groups.items.map((group) => (
              <PartyRow
                direction={direction}
                expanded={expanded === group.key}
                group={group}
                key={group.key}
                onPress={() =>
                  setExpanded((current) => (current === group.key ? null : group.key))
                }
                status={status}
              />
            ))
          )}
        </View>

        <ListFooter
          fetchNextPage={() => void groups.fetchNextPage()}
          hasMore={groups.hasMore}
          isFetchingNextPage={groups.isFetchingNextPage}
          shown={groups.items.length}
          total={groups.total}
        />
      </ScrollView>
    </View>
  );
}
