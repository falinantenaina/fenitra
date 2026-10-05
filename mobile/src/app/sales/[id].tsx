import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CancelPanel } from '@/components/cancel-panel';
import { Chip } from '@/components/chip';
import { Section } from '@/components/section';
import { apiMessage } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import {
  buildDebtPaymentPayload,
  debtPaymentFormSchema,
  type DebtPaymentFormValues,
} from '@/lib/finance';
import { pick } from '@/lib/params';
import { useCancelSale, usePaySale, usePaymentMethods, useSale } from '@/lib/queries';
import { SALE_STATUS } from '@/lib/status';
import { useAuth } from '@/store/auth';

export default function SaleDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = pick(params.id) || null;

  const user = useAuth((state) => state.user);
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const sale = useSale(id);
  const paySale = usePaySale();
  const cancelSale = useCancelSale();
  const methods = usePaymentMethods();
  const [method, setMethod] = useState<string | undefined>(undefined);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<DebtPaymentFormValues>({
    resolver: zodResolver(debtPaymentFormSchema),
    mode: 'onSubmit',
    defaultValues: { amount: 0, notes: '' },
  });

  const data = sale.data;
  const remaining = Number(data?.remainingAmount ?? 0);

  const onSubmit = handleSubmit(async (values) => {
    if (!id) return;
    if (values.amount > remaining) {
      Alert.alert('Montant trop élevé', `Le solde restant est de ${formatMoney(remaining)}.`);
      return;
    }
    try {
      await paySale.mutateAsync({
        id,
        body: buildDebtPaymentPayload({ ...values, method }),
      });
      Alert.alert('Règlement enregistré', `Reste ${formatMoney(remaining - values.amount)}`, [
        { text: 'OK' },
      ]);
      setValue('amount', 0);
    } catch (error) {
      Alert.alert('Règlement refusé', apiMessage(error));
    }
  });

  const onCancel = async (reason: string) => {
    if (!id) return;
    try {
      await cancelSale.mutateAsync({ id, reason });
      Alert.alert('Vente annulée', 'Le stock a été restitué et les écritures contre-passées.');
    } catch (error) {
      Alert.alert('Annulation refusée', apiMessage(error));
    }
  };

  if (sale.isPending) {
    return <ActivityIndicator className="mt-10 self-center" color="#208AEF" />;
  }

  if (sale.isError || !data) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-slate-50 px-6">
        <Ionicons color="#CBD5E1" name="alert-circle-outline" size={32} />
        <Text className="text-sm text-slate-500">Impossible de charger cette vente.</Text>
        <Pressable
          accessibilityRole="button"
          className="rounded-lg bg-slate-100 px-4 py-2"
          disabled={sale.isRefetching}
          onPress={() => void sale.refetch()}>
          <Text className="text-sm font-medium text-slate-700">Réessayer</Text>
        </Pressable>
      </View>
    );
  }

  const party = data.customer ?? data.onlineSeller;
  const status = SALE_STATUS[data.status];

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16 }}>
      {/* En-tête */}
      <View className="gap-1 rounded-xl border border-slate-200 bg-white p-4">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1">
            <Text className="text-lg font-bold text-slate-900">{data.reference}</Text>
            <Text className="text-xs text-slate-500">
              {party?.name ?? 'Comptoir'}
              {data.paymentMethod ? ` · ${data.paymentMethod}` : ''}
            </Text>
          </View>
          <View className={`rounded-full px-2.5 py-1 ${status.className}`}>
            <Text className={`text-xs font-semibold ${status.text}`}>{status.label}</Text>
          </View>
        </View>

        <View className="mt-3 flex-row flex-wrap gap-x-6 gap-y-1">
          <View>
            <Text className="text-xs text-slate-400">Total</Text>
            <Text className="text-sm font-semibold text-slate-800">
              {formatMoney(data.totalAmount)}
            </Text>
          </View>
          <View>
            <Text className="text-xs text-slate-400">Réglé</Text>
            <Text className="text-sm font-semibold text-slate-800">
              {formatMoney(data.paidAmount)}
            </Text>
          </View>
          <View>
            <Text className="text-xs text-slate-400">Reste</Text>
            <Text className="text-sm font-bold text-slate-900">
              {formatMoney(data.remainingAmount)}
            </Text>
          </View>
          <View>
            <Text className="text-xs text-slate-400">Marge</Text>
            <Text className="text-sm font-semibold text-slate-800">
              {formatMoney(data.margin)}
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
              Annulée le {formatDateTime(data.cancelledAt)} — {data.cancelReason}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Règlement */}
      {remaining > 0 && data.status !== 'CANCELLED' ? (
        <View className="mt-4 gap-2 rounded-xl border border-slate-200 bg-white p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-slate-800">Enregistrer un règlement</Text>
            <Pressable
              className="rounded-full bg-slate-100 px-3 py-1"
              onPress={() => setValue('amount', remaining)}>
              <Text className="text-xs font-semibold text-slate-600">
                Solde {formatMoney(remaining)}
              </Text>
            </Pressable>
          </View>

          <Controller
            control={control}
            name="amount"
            render={({ field }) => (
              <TextInput
                className="h-11 rounded-xl border border-slate-300 px-3 text-right text-base text-slate-900"
                keyboardType="numeric"
                onChangeText={(raw) => {
                  const digits = raw.replace(/[^0-9]/g, '');
                  field.onChange(digits === '' ? 0 : Number(digits));
                }}
                placeholder="Montant reçu"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={field.value ? String(field.value) : ''}
              />
            )}
          />
          {errors.amount ? (
            <Text className="text-xs text-red-600">{errors.amount.message}</Text>
          ) : null}

          <ScrollView
            contentContainerStyle={{ gap: 8 }}
            horizontal
            showsHorizontalScrollIndicator={false}>
            <Chip label="Sans mode" selected={!method} onPress={() => setMethod(undefined)} />
            {(methods.data ?? []).map((m) => (
              <Chip
                key={m.id}
                label={m.name}
                selected={method === m.name}
                onPress={() => setMethod(m.name)}
              />
            ))}
          </ScrollView>

          <Controller
            control={control}
            name="notes"
            render={({ field }) => (
              <TextInput
                className="min-h-[48px] rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-900"
                onChangeText={field.onChange}
                placeholder="Notes (facultatif)"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={field.value ?? ''}
              />
            )}
          />

          <Pressable
            className={`h-11 items-center justify-center rounded-xl ${
              paySale.isPending ? 'bg-slate-300' : 'bg-brand'
            }`}
            disabled={paySale.isPending}
            onPress={() => void onSubmit()}>
            {paySale.isPending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="font-semibold text-white">Encaisser</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {/* Annulation */}
      {canManage && data.status !== 'CANCELLED' ? (
        <View className="mt-4">
          <CancelPanel
            hint="L'annulation restitue les articles aux lots et contre-passe les écritures de cette vente."
            isPending={cancelSale.isPending}
            label="Annuler la vente"
            onConfirm={(reason) => void onCancel(reason)}
          />
        </View>
      ) : null}

      {/* Créance liée */}
      {data.debt ? (
        <Pressable
          className="mt-4 flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"
          onPress={() =>
            router.push({ pathname: '/dettes/[id]', params: { id: data.debt!.id } })
          }>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-slate-800">
              Créance client liée (à recevoir)
            </Text>
            <Text className="text-xs text-slate-400">
              {formatMoney(data.debt.paidAmount)} encaissé sur {formatMoney(data.debt.initialAmount)}
            </Text>
          </View>
          <Ionicons color="#94A3B8" name="chevron-forward" size={18} />
        </Pressable>
      ) : null}

      {/* Articles */}
      <Section title="Articles" count={data.items.length} />
      <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {data.items.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucun article.</Text>
        ) : (
          data.items.map((item) => (
            <View
              className="border-b border-slate-100 px-3 py-2.5 last:border-b-0"
              key={item.id}>
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-slate-800">
                    {item.product.name}
                    <Text className="text-xs font-normal text-slate-400">
                      {' '}
                      · Taille {item.size.label || item.size.value}
                    </Text>
                  </Text>
                  <Text className="text-xs text-slate-400">
                    {item.quantity} × {formatMoney(item.unitPrice)}
                    {item.sku ? ` · ${item.sku}` : ''}
                  </Text>
                  <Text className="text-xs text-slate-400">
                    Marge {formatMoney(item.margin)}
                  </Text>
                </View>
                <Text className="text-sm font-bold text-slate-900">
                  {formatMoney(item.lineTotal)}
                </Text>
              </View>
              {item.lots.length > 0 ? (
                <Text className="mt-1 text-[11px] text-slate-400">
                  {item.lots.map((lot) => `${lot.code} ×${lot.quantity}`).join(' · ')}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </View>

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
                {payment.notes ? (
                  <Text className="text-xs text-slate-400">{payment.notes}</Text>
                ) : null}
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
