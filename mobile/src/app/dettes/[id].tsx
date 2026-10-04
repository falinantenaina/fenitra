import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLocalSearchParams } from 'expo-router';
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
import { useCancelDebt, useDebt, usePayDebt, usePaymentMethods } from '@/lib/queries';
import type { DebtStatus, DebtType } from '@/lib/types';
import { useAuth } from '@/store/auth';

const TYPE_LABELS: Record<DebtType, string> = {
  CUSTOMER: 'Créance client (à recevoir)',
  ONLINE_SELLER: 'Créance vendeur en ligne (à recevoir)',
  SUPPLIER: 'Dette fournisseur (à payer)',
  TROSA_SINOA: 'Trosa sinoa — à payer au fournisseur',
};

const STATUS_LABELS: Record<DebtStatus, { label: string; className: string; text: string }> = {
  OPEN: { label: 'Ouverte', className: 'bg-amber-50', text: 'text-amber-700' },
  PARTIAL: { label: 'Partielle', className: 'bg-sky-50', text: 'text-sky-700' },
  PAID: { label: 'Réglée', className: 'bg-emerald-50', text: 'text-emerald-700' },
  CANCELLED: { label: 'Annulée', className: 'bg-slate-100', text: 'text-slate-500' },
};

export default function DebtDetailScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = pick(params.id) || null;

  const user = useAuth((state) => state.user);
  const canPay = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const debt = useDebt(id);
  const payDebt = usePayDebt();
  const cancelDebt = useCancelDebt();
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

  const data = debt.data;
  const remaining = Number(data?.remainingAmount ?? 0);
  const status = data ? STATUS_LABELS[data.status] : null;
  // Sens du règlement : une créance s'encaisse, une dette se décaisse.
  const receivable = data?.direction === 'RECEIVABLE';

  const onSubmit = handleSubmit(async (values) => {
    if (!id) return;
    if (values.amount > remaining) {
      Alert.alert('Montant trop élevé', `Le solde restant est de ${formatMoney(remaining)}.`);
      return;
    }
    try {
      await payDebt.mutateAsync({
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
      await cancelDebt.mutateAsync({ id, reason });
      Alert.alert('Dette annulée', 'Les écritures ont été contre-passées.');
    } catch (error) {
      Alert.alert('Annulation refusée', apiMessage(error));
    }
  };

  if (debt.isPending) {
    return <ActivityIndicator className="mt-10 self-center" color="#208AEF" />;
  }

  if (debt.isError || !data) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-slate-50 px-6">
        <Ionicons color="#CBD5E1" name="alert-circle-outline" size={32} />
        <Text className="text-sm text-slate-500">Impossible de charger cette dette.</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ gap: 0, padding: 16 }}>
      {/* En-tête */}
      <View className="gap-1 rounded-xl border border-slate-200 bg-white p-4">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1">
            <Text className="text-lg font-bold text-slate-900">{data.party?.name ?? '—'}</Text>
            <Text className="text-xs text-slate-500">{TYPE_LABELS[data.type]}</Text>
          </View>
          {status ? (
            <View className={`rounded-full px-2.5 py-1 ${status.className}`}>
              <Text className={`text-xs font-semibold ${status.text}`}>{status.label}</Text>
            </View>
          ) : null}
        </View>
        {data.reason ? <Text className="text-sm text-slate-600">{data.reason}</Text> : null}

        <View className="mt-3 flex-row flex-wrap gap-x-6 gap-y-1">
          <View>
            <Text className="text-xs text-slate-400">Montant initial</Text>
            <Text className="text-sm font-semibold text-slate-800">
              {formatMoney(data.initialAmount)}
            </Text>
          </View>
          <View>
            <Text className="text-xs text-slate-400">Payé</Text>
            <Text className="text-sm font-semibold text-slate-800">
              {formatMoney(data.paidAmount)}
            </Text>
          </View>
          <View>
            <Text className="text-xs text-slate-400">Restant</Text>
            <Text className="text-sm font-bold text-slate-900">
              {formatMoney(data.remainingAmount)}
            </Text>
          </View>
        </View>

        <View className="mt-2 gap-0.5 border-t border-slate-100 pt-2">
          <Text className="text-xs text-slate-400">Ouverte le {formatDateTime(data.date)}</Text>
          {data.dueDate ? (
            <Text className="text-xs text-slate-400">
              Échéance {formatDateTime(data.dueDate)}
            </Text>
          ) : null}
          {data.cancelledAt ? (
            <Text className="text-xs text-red-600">
              Annulée le {formatDateTime(data.cancelledAt)} — {data.cancelReason}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Règlement */}
      {canPay && data.status !== 'PAID' && data.status !== 'CANCELLED' ? (
        <View className="mt-4 gap-2 rounded-xl border border-slate-200 bg-white p-4">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-semibold text-slate-800">Enregistrer un règlement</Text>
            <Pressable
              className="rounded-full bg-slate-100 px-3 py-1"
              onPress={() => setValue('amount', remaining)}>
              <Text className="text-xs font-semibold text-slate-600">Solde {formatMoney(remaining)}</Text>
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
                placeholder={receivable ? 'Montant encaissé' : 'Montant décaissé'}
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
              payDebt.isPending ? 'bg-slate-300' : 'bg-brand'
            }`}
            disabled={payDebt.isPending}
            onPress={() => void onSubmit()}>
            {payDebt.isPending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="font-semibold text-white">
                {receivable ? 'Encaisser' : 'Décaisser'}
              </Text>
            )}
          </Pressable>
        </View>
      ) : canPay ? (
        <View className="mt-4 rounded-xl bg-emerald-50 px-3 py-2.5">
          <Text className="text-xs text-emerald-700">
            Cette dette est clôturée : aucun nouveau règlement possible.
          </Text>
        </View>
      ) : (
        <View className="mt-4 rounded-xl bg-slate-100 px-3 py-2.5">
          <Text className="text-xs text-slate-500">
            Le règlement est réservé aux gestionnaires et administrateurs.
          </Text>
        </View>
      )}

      {/* Annulation — dette créée manuellement uniquement */}
      {canPay && data.status !== 'CANCELLED' && data.origin === 'MANUAL' ? (
        <View className="mt-4">
          <CancelPanel
            hint="L'annulation contre-passe les écritures de cette dette. Une dette née d'une vente ou d'un arrivage s'annule depuis son document d'origine."
            isPending={cancelDebt.isPending}
            label="Annuler la dette"
            onConfirm={(reason) => void onCancel(reason)}
          />
        </View>
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
                  {payment.user ? ` · ${payment.user.name}` : ''}
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

      {/* Versements liés (A2) */}
      {data.versements.length > 0 ? (
        <>
          <Section title="Versements liés" count={data.versements.length} />
          <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {data.versements.map((versement) => (
              <View
                className="border-b border-slate-100 px-3 py-2.5 last:border-b-0"
                key={versement.id}>
                <Text className="text-sm font-medium text-slate-800">
                  {versement.personName} · {formatMoney(versement.amount)}
                </Text>
                <Text className="text-xs text-slate-400">
                  {formatDateTime(versement.date)} · {versement.motif}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {/* Journal */}
      <Section title="Écritures du journal" count={data.history.length} />
      <View className="mt-2 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {data.history.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucune écriture.</Text>
        ) : (
          data.history.map((line) => (
            <View
              className="border-b border-slate-100 px-3 py-2.5 last:border-b-0"
              key={line.id}>
              <View className="flex-row items-center justify-between gap-3">
                <Text className="text-sm font-medium text-slate-800">{line.kind}</Text>
                <Text className="text-sm font-semibold text-slate-800">
                  {formatMoney(line.amount)}
                </Text>
              </View>
              <Text className="text-xs text-slate-400" numberOfLines={2}>
                {formatDateTime(line.date)} · {line.description}
              </Text>
            </View>
          ))
        )}
      </View>

      <View className="h-8" />
    </ScrollView>
  );
}
