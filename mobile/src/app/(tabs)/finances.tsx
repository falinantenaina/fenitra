import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { Chip } from '@/components/chip';
import { ListFooter } from '@/components/list-footer';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useCapitalMovements, useDebts, useExpenses } from '@/lib/queries';
import type { CapitalItem, ExpenseItem } from '@/lib/types';
import { useAuth } from '@/store/auth';

type Segment = 'expenses' | 'capital' | 'debts';

const SEGMENTS: { key: Segment; label: string; route: Href }[] = [
  { key: 'expenses', label: 'Dépenses', route: '/finance/expense' },
  { key: 'capital', label: 'Argent propre', route: '/finance/capital' },
  { key: 'debts', label: 'Dettes à payer', route: '/finance/dette-fournisseur' },
];

function ListShell({
  isLoading,
  isEmpty,
  total,
  footer,
  children,
}: {
  isLoading: boolean;
  isEmpty: boolean;
  total: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View className="gap-2">
      <Text className="text-xs text-slate-400">{total} ligne(s)</Text>
      <View className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {isLoading ? (
          <ActivityIndicator className="py-4" color="#208AEF" />
        ) : isEmpty ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucune écriture.</Text>
        ) : (
          children
        )}
      </View>
      {footer}
    </View>
  );
}

function ExpenseList() {
  const expenses = useExpenses();

  return (
    <ListShell
      isLoading={expenses.isPending}
      isEmpty={expenses.items.length === 0}
      total={expenses.total}
      footer={
        <ListFooter
          fetchNextPage={() => void expenses.fetchNextPage()}
          hasMore={expenses.hasMore}
          isFetchingNextPage={expenses.isFetchingNextPage}
          shown={expenses.items.length}
          total={expenses.total}
        />
      }>
      {expenses.items.map((expense: ExpenseItem) => (
        <View
          className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0"
          key={expense.id}>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-slate-800" numberOfLines={1}>
              {expense.description}
            </Text>
            <Text className="text-xs text-slate-400">
              {expense.category?.name ?? '—'} · {formatDateTime(expense.date)}
            </Text>
          </View>
          <Text className="text-sm font-bold text-red-600">−{formatMoney(expense.amount)}</Text>
        </View>
      ))}
    </ListShell>
  );
}

function CapitalList() {
  const capital = useCapitalMovements();

  return (
    <ListShell
      isLoading={capital.isPending}
      isEmpty={capital.items.length === 0}
      total={capital.total}
      footer={
        <ListFooter
          fetchNextPage={() => void capital.fetchNextPage()}
          hasMore={capital.hasMore}
          isFetchingNextPage={capital.isFetchingNextPage}
          shown={capital.items.length}
          total={capital.total}
        />
      }>
      {capital.items.map((movement: CapitalItem) => {
        const isIn = movement.type === 'IN';
        return (
          <View
            className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0"
            key={movement.id}>
            <View className="flex-1">
              <Text className="text-sm font-semibold text-slate-800" numberOfLines={1}>
                {movement.motif}
              </Text>
              <Text className="text-xs text-slate-400">
                {formatDateTime(movement.date)}
                {movement.reference ? ` · ${movement.reference}` : ''}
              </Text>
              <View
                className={`mt-1 self-start rounded-full px-2 py-0.5 ${
                  isIn ? 'bg-emerald-50' : 'bg-slate-100'
                }`}>
                <Text
                  className={`text-[11px] font-semibold ${isIn ? 'text-emerald-700' : 'text-slate-500'}`}>
                  {isIn ? 'Injection' : 'Retrait'}
                </Text>
              </View>
            </View>
            <Text className={`text-sm font-bold ${isIn ? 'text-emerald-600' : 'text-red-600'}`}>
              {isIn ? '+' : '−'}
              {formatMoney(movement.amount)}
            </Text>
          </View>
        );
      })}
    </ListShell>
  );
}

/** Dettes que je dois payer (fournisseurs + emprunts). */
function PayableDebtList({ onPress }: { onPress: (id: string) => void }) {
  const debts = useDebts({ direction: 'PAYABLE' });

  return (
    <ListShell
      isLoading={debts.isPending}
      isEmpty={debts.items.length === 0}
      total={debts.total}
      footer={
        <ListFooter
          fetchNextPage={() => void debts.fetchNextPage()}
          hasMore={debts.hasMore}
          isFetchingNextPage={debts.isFetchingNextPage}
          shown={debts.items.length}
          total={debts.total}
        />
      }>
      {debts.items.map((debt) => (
        <Pressable
          className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0"
          key={debt.id}
          onPress={() => onPress(debt.id)}>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-slate-800">
              {debt.party?.name ?? '—'}
            </Text>
            <Text className="text-xs text-slate-400" numberOfLines={1}>
              {debt.reason ?? '—'} · {formatDateTime(debt.date)}
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-sm font-bold text-slate-900">
              {formatMoney(debt.remainingAmount)}
            </Text>
            <Text className="text-xs text-slate-400">
              {debt.status === 'PAID' ? 'Réglée' : debt.status === 'PARTIAL' ? 'Partielle' : 'Ouverte'}
            </Text>
          </View>
        </Pressable>
      ))}
    </ListShell>
  );
}

export default function FinancesScreen() {
  const user = useAuth((state) => state.user);
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [segment, setSegment] = useState<Segment>('expenses');

  const active = SEGMENTS.find((s) => s.key === segment) ?? SEGMENTS[0];

  return (
    <View className="flex-1 bg-white">
      <ScrollView contentContainerStyle={{ gap: 12, padding: 16 }}>
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-slate-900">Finances</Text>
          {canManage ? (
            <Pressable
              className="h-10 flex-row items-center justify-center gap-1.5 rounded-xl bg-brand px-4"
              onPress={() => router.push(active.route)}>
              <Ionicons color="#ffffff" name="add" size={18} />
              <Text className="font-semibold text-white">Nouveau</Text>
            </Pressable>
          ) : null}
        </View>

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

        {!canManage ? (
          <View className="rounded-xl bg-slate-50 px-3 py-2.5">
            <Text className="text-xs text-slate-500">
              La saisie des finances est réservée aux gestionnaires et administrateurs.
            </Text>
          </View>
        ) : null}

        {segment === 'expenses' ? <ExpenseList /> : null}
        {segment === 'capital' ? <CapitalList /> : null}
        {segment === 'debts' ? (
          <PayableDebtList
            onPress={(id) => router.push({ pathname: '/dettes/[id]', params: { id } })}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}
