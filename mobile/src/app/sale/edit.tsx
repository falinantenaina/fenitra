import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { toast } from '@/components/toast';
import { apiMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { pick } from '@/lib/params';
import { useSale, useUpdateSale } from '@/lib/queries';
import { useAuth } from '@/store/auth';

export default function SaleEditPricesScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = pick(params.id) || null;

  const user = useAuth((state) => state.user);
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const sale = useSale(id);
  const updateSale = useUpdateSale();

  const data = sale.data;
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const initializedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!data || initializedFor.current === data.id) return;
    const initial: Record<string, number> = {};
    for (const item of data.items) initial[item.id] = Number(item.unitPrice);
    setPrices(initial);
    initializedFor.current = data.id;
  }, [data]);

  const draft = useMemo(() => {
    if (!data) return null;
    const lines = data.items.map((item) => ({
      item,
      price: prices[item.id] ?? Number(item.unitPrice),
    }));
    const total = lines.reduce((sum, line) => sum + line.item.quantity * line.price, 0);
    const oldTotal = Number(data.totalAmount);
    const paid = Number(data.paidAmount);
    return {
      lines,
      total,
      oldTotal,
      paid,
      delta: total - oldTotal,
      refund: total < paid ? paid - total : 0,
      credit: total > paid ? total - paid : 0,
    };
  }, [data, prices]);

  const missingParty =
    draft !== null && draft.credit > 0 && !data?.customer && !data?.onlineSeller;
  const zeroTotal = draft !== null && draft.total < 1;
  const unchanged = draft !== null && draft.delta === 0;
  const blocked = draft === null || missingParty || zeroTotal || unchanged || updateSale.isPending;

  const setPrice = (itemId: string, raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '');
    setPrices((prev) => ({ ...prev, [itemId]: digits === '' ? 0 : Number(digits) }));
  };

  const onSave = async () => {
    if (!id || !data || !draft) return;
    const items = draft.lines
      .filter((line) => line.price !== Number(line.item.unitPrice))
      .map((line) => ({ id: line.item.id, unitPrice: line.price }));
    if (items.length === 0) return;
    try {
      await updateSale.mutateAsync({ id, items, reason: reason.trim() || null });
      toast.success('Prix corrigés', `Nouveau total ${formatMoney(draft.total)}`);
      router.back();
    } catch (error) {
      toast.error('Correction refusée', apiMessage(error));
    }
  };

  if (!canManage) {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-slate-50 px-6">
        <Ionicons color="#CBD5E1" name="lock-closed-outline" size={32} />
        <Text className="text-sm text-slate-500">
          La correction des prix est réservée aux gestionnaires.
        </Text>
      </View>
    );
  }

  if (sale.isPending) {
    return <ActivityIndicator className="mt-10 self-center" color="#208AEF" />;
  }

  if (sale.isError || !data || !draft) {
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

  if (data.status === 'CANCELLED') {
    return (
      <View className="flex-1 items-center justify-center gap-2 bg-slate-50 px-6">
        <Ionicons color="#CBD5E1" name="close-circle-outline" size={32} />
        <Text className="text-center text-sm text-slate-500">
          Cette vente est annulée — ses prix ne peuvent plus être modifiés.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-slate-50" contentContainerStyle={{ padding: 16 }}>
      {/* Récapitulatif */}
      <View className="gap-1.5 rounded-xl border border-slate-200 bg-white p-4">
        <Text className="text-xs text-slate-400">{data.reference}</Text>
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-slate-500">Total actuel</Text>
          <Text className="text-sm font-semibold text-slate-700">
            {formatMoney(draft.oldTotal)}
          </Text>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-semibold text-slate-800">Nouveau total</Text>
          <View className="items-end">
            <Text
              className={`text-base font-bold ${
                draft.delta < 0
                  ? 'text-red-600'
                  : draft.delta > 0
                    ? 'text-emerald-600'
                    : 'text-slate-900'
              }`}>
              {formatMoney(draft.total)}
            </Text>
            {draft.delta !== 0 ? (
              <Text
                className={`text-xs font-semibold ${
                  draft.delta < 0 ? 'text-red-600' : 'text-emerald-600'
                }`}>
                {draft.delta > 0 ? '+' : ''}
                {formatMoney(draft.delta)}
              </Text>
            ) : null}
          </View>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-slate-500">Déjà encaissé</Text>
          <Text className="text-sm font-semibold text-slate-700">
            {formatMoney(draft.paid)}
          </Text>
        </View>

        {draft.credit > 0 ? (
          <View className="mt-1 gap-0.5 rounded-lg bg-brand/5 p-2.5">
            <Text className="text-xs font-semibold text-brand">
              Reste à payer : {formatMoney(draft.credit)}
            </Text>
            <Text className="text-xs text-slate-500">
              {missingParty
                ? 'Vente sans client ni vendeur en ligne : annulez et recréez la vente avec un client pour ouvrir ce crédit.'
                : 'La créance du client ou du vendeur en ligne sera mise à jour.'}
            </Text>
          </View>
        ) : null}

        {draft.refund > 0 ? (
          <View className="mt-1 gap-0.5 rounded-lg bg-amber-50 p-2.5">
            <Text className="text-xs font-semibold text-amber-700">
              Remboursement : {formatMoney(draft.refund)}
            </Text>
            <Text className="text-xs text-slate-500">
              Le nouveau total passe sous l&apos;encaissé : cette somme sortira de la caisse.
            </Text>
          </View>
        ) : null}
      </View>

      {/* Prix par ligne */}
      <Text className="mb-2 mt-4 text-sm font-semibold text-slate-700">Prix par ligne</Text>
      <View className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {draft.lines.map(({ item, price }, index) => (
          <View
            className={`px-3 py-2.5 ${index < draft.lines.length - 1 ? 'border-b border-slate-100' : ''}`}
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
                <Text className="text-xs text-slate-400">{item.quantity} ×</Text>
              </View>
              <Text className="w-24 text-right text-sm font-bold text-slate-900">
                {formatMoney(item.quantity * price)}
              </Text>
            </View>
            <View className="mt-1.5 flex-row items-center gap-2">
              <Text className="text-xs text-slate-400">Prix unitaire</Text>
              <TextInput
                className="min-h-9 flex-1 rounded-lg border border-slate-300 px-3 py-1 text-right text-sm text-slate-900"
                keyboardType="numeric"
                onChangeText={(raw) => setPrice(item.id, raw)}
                placeholder="Prix"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={price ? String(price) : ''}
              />
            </View>
          </View>
        ))}
      </View>

      {/* Motif */}
      <Text className="mb-2 mt-4 text-sm font-semibold text-slate-700">Motif (facultatif)</Text>
      <TextInput
        className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
        onChangeText={setReason}
        placeholder="Prix négocié, saisie erronée…"
        placeholderTextColor="#94A3B8"
        selectionColor="#208AEF"
        value={reason}
      />

      {zeroTotal ? (
        <Text className="mt-2 text-xs text-red-600">
          Le total de la vente doit rester strictement positif.
        </Text>
      ) : null}
      {unchanged && !zeroTotal ? (
        <Text className="mt-2 text-xs text-slate-400">Aucun prix modifié.</Text>
      ) : null}

      <Pressable
        className={`mt-4 h-11 items-center justify-center rounded-xl ${
          blocked ? 'bg-slate-300' : 'bg-brand'
        }`}
        disabled={blocked}
        onPress={() => void onSave()}>
        {updateSale.isPending ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="font-semibold text-white">Enregistrer la correction</Text>
        )}
      </Pressable>

      <View className="h-8" />
    </ScrollView>
  );
}
