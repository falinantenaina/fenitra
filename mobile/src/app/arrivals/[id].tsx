import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { CancelPanel } from '@/components/cancel-panel';
import { Section } from '@/components/section';
import { apiMessage } from '@/lib/api';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { pick } from '@/lib/params';
import { useArrival, useCancelArrival } from '@/lib/queries';
import { ARRIVAL_STATUS } from '@/lib/status';
import { useAuth } from '@/store/auth';

export default function ArrivalDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = pick(params.id) || null;

  const user = useAuth((state) => state.user);
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const arrival = useArrival(id);
  const cancelArrival = useCancelArrival();

  const onCancel = async (reason: string) => {
    if (!id) return;
    try {
      await cancelArrival.mutateAsync({ id, reason });
      Alert.alert('Arrivage annulé', 'Les lots et les écritures ont été contre-passés.');
    } catch (error) {
      Alert.alert('Annulation refusée', apiMessage(error));
    }
  };

  if (arrival.isPending) {
    return <ActivityIndicator className="mt-10 self-center" color="#208AEF" />;
  }

  if (arrival.isError || !arrival.data) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-slate-50 px-6">
        <Ionicons color="#CBD5E1" name="alert-circle-outline" size={32} />
        <Text className="text-sm text-slate-500">Impossible de charger cet arrivage.</Text>
      </View>
    );
  }

  const data = arrival.data;
  const status = ARRIVAL_STATUS[data.status];

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16 }}>
      {/* En-tête */}
      <View className="gap-1 rounded-xl border border-slate-200 bg-white p-4">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1">
            <Text className="text-lg font-bold text-slate-900">{data.reference}</Text>
            <Text className="text-xs text-slate-500">{data.supplier.name}</Text>
          </View>
          <View className={`rounded-full px-2.5 py-1 ${status.className}`}>
            <Text className={`text-xs font-semibold ${status.text}`}>{status.label}</Text>
          </View>
        </View>

        <View className="mt-3 flex-row flex-wrap gap-x-6 gap-y-1">
          <View>
            <Text className="text-xs text-slate-400">Coût total</Text>
            <Text className="text-sm font-semibold text-slate-800">
              {formatMoney(data.totalCost)}
            </Text>
          </View>
          <View>
            <Text className="text-xs text-slate-400">Quantité</Text>
            <Text className="text-sm font-semibold text-slate-800">
              {formatQuantity(data.totalQty)}
            </Text>
          </View>
          <View>
            <Text className="text-xs text-slate-400">Payé</Text>
            <Text className="text-sm font-semibold text-slate-800">
              {formatMoney(data.paidAmount)}
            </Text>
          </View>
          <View>
            <Text className="text-xs text-slate-400">Reste dû</Text>
            <Text className="text-sm font-bold text-slate-900">
              {formatMoney(data.unpaidAmount)}
            </Text>
          </View>
        </View>

        <View className="mt-2 gap-0.5 border-t border-slate-100 pt-2">
          <Text className="text-xs text-slate-400">{formatDateTime(data.date)}</Text>
          {data.createdBy ? (
            <Text className="text-xs text-slate-400">Saisie par {data.createdBy.name}</Text>
          ) : null}
          {data.notes ? <Text className="text-xs text-slate-500">{data.notes}</Text> : null}
          {data.cancelledAt ? (
            <Text className="text-xs text-red-600">
              Annulé le {formatDateTime(data.cancelledAt)} — {data.cancelReason}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Annulation */}
      {canManage && data.status !== 'CANCELLED' ? (
        <View className="mt-4">
          <CancelPanel
            hint="L'annulation exige que le stock soit intact : les lots doivent être vides d'une autre opération. Les écritures sont contre-passées."
            isPending={cancelArrival.isPending}
            label="Annuler l'arrivage"
            onConfirm={(reason) => void onCancel(reason)}
          />
        </View>
      ) : null}

      {/* Dette fournisseur */}
      {data.debt ? (
        <Pressable
          className="mt-4 flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"
          onPress={() =>
            router.push({ pathname: '/dettes/[id]', params: { id: data.debt!.id } })
          }>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-slate-800">Dette fournisseur</Text>
            <Text className="text-xs text-slate-400">
              {formatMoney(data.debt.paidAmount)} réglé sur {formatMoney(data.debt.initialAmount)}
            </Text>
          </View>
          <Ionicons color="#94A3B8" name="chevron-forward" size={18} />
        </Pressable>
      ) : null}

      {/* Cartons */}
      <Section title="Cartons" count={data.cartons.length} />
      <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {data.cartons.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucun carton.</Text>
        ) : (
          data.cartons.map((carton) => (
            <View className="border-b border-slate-100 px-3 py-2.5 last:border-b-0" key={carton.id}>
              <View className="flex-row items-center justify-between gap-3">
                <Text className="text-sm font-semibold text-slate-800">
                  {carton.reference}
                  <Text className="text-xs font-normal text-slate-400">
                    {' '}
                    · {formatQuantity(carton.totalQty)} art. · {formatMoney(carton.totalCost)}
                  </Text>
                </Text>
              </View>
              {carton.notes ? <Text className="text-xs text-slate-400">{carton.notes}</Text> : null}
              {carton.items.map((item) => (
                <View
                  className="mt-1 flex-row items-center justify-between gap-3"
                  key={item.id}>
                  <Text className="flex-1 text-xs text-slate-500">
                    {item.product.name} · Taille {item.size.label || item.size.value}
                    {item.sku ? ` · ${item.sku}` : ''}
                  </Text>
                  <Text className="text-xs text-slate-700">
                    {item.quantity} × {formatMoney(item.unitCost)}
                  </Text>
                </View>
              ))}
            </View>
          ))
        )}
      </View>

      {/* Lots créés */}
      <Section title="Lots" count={data.lots.length} />
      <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {data.lots.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucun lot.</Text>
        ) : (
          data.lots.map((lot) => (
            <View
              className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0"
              key={lot.id}>
              <View className="flex-1">
                <Text className="text-sm font-medium text-slate-800">
                  {lot.product.name} · Taille {lot.size.label || lot.size.value}
                </Text>
                <Text className="text-xs text-slate-400">
                  {lot.code} · achat {formatMoney(lot.unitCost)} · reste {lot.remainingQty}/
                  {lot.initialQty}
                </Text>
              </View>
              <Text className="text-sm font-semibold text-slate-800">
                {formatMoney(lot.value)}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Financements */}
      {data.fundings.length > 0 ? (
        <>
          <Section title="Financements" count={data.fundings.length} />
          <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {data.fundings.map((funding) => (
              <View
                className="border-b border-slate-100 px-3 py-2.5 last:border-b-0"
                key={funding.id}>
                <Text className="text-sm font-medium text-slate-800">
                  {funding.source} · {formatMoney(funding.amount)}
                </Text>
                {funding.notes ? (
                  <Text className="text-xs text-slate-400">{funding.notes}</Text>
                ) : null}
              </View>
            ))}
          </View>
        </>
      ) : null}

      {/* Paiements */}
      <Section title="Paiements" count={data.payments.length} />
      <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {data.payments.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucun paiement.</Text>
        ) : (
          data.payments.map((payment) => (
            <View
              className="flex-row items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5 last:border-b-0"
              key={payment.id}>
              <View className="flex-1">
                <Text className="text-sm font-medium text-slate-800">
                  {payment.reference} · {formatMoney(payment.amount)}
                </Text>
                <Text className="text-xs text-slate-400">
                  {formatDateTime(payment.date)}
                  {payment.method ? ` · ${payment.method}` : ''}
                </Text>
              </View>
              <Ionicons
                color={payment.direction === 'IN' ? '#059669' : '#DC2626'}
                name={payment.direction === 'IN' ? 'arrow-down' : 'arrow-up'}
                size={18}
              />
            </View>
          ))
        )}
      </View>

      <View className="h-8" />
    </ScrollView>
  );
}
