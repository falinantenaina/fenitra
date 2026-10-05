import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { apiMessage } from '@/lib/api';
import { formatMoney, formatQuantity } from '@/lib/format';
import { pick } from '@/lib/params';
import { useArrival, useSizeList, useVentilateArrival } from '@/lib/queries';
import { useAuth } from '@/store/auth';

/** Pointures saisies par carton : `cartonId → (sizeId → quantité)`. */
type VentilationGrid = Record<string, Record<string, number>>;

/**
 * `POST /arrivals/:id/ventilate` — répartition des pointures d'un carton déjà
 * enregistré : le prix d'achat unitaire n'est pas saisi, il vaut
 * `floor(montant du carton / quantité)` ; la somme doit être exacte.
 */
export default function VentilateArrivalScreen() {
  const params = useLocalSearchParams<{ arrivalId?: string }>();
  const arrivalId = pick(params.arrivalId) || null;

  const user = useAuth((state) => state.user);
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const arrival = useArrival(arrivalId);
  const sizes = useSizeList();
  const ventilate = useVentilateArrival();

  const [grid, setGrid] = useState<VentilationGrid>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const pending = useMemo(
    () => (arrival.data?.cartons ?? []).filter((carton) => !carton.ventilated),
    [arrival.data],
  );
  const sizeItems = sizes.data?.items ?? [];

  const entered = (cartonId: string) =>
    Object.values(grid[cartonId] ?? {}).reduce((sum, quantity) => sum + (quantity || 0), 0);

  const setQuantity = (cartonId: string, sizeId: string, raw: string) => {
    const quantity = Number(raw.replace(/[^0-9]/g, '')) || 0;
    setGrid((previous) => ({
      ...previous,
      [cartonId]: { ...(previous[cartonId] ?? {}), [sizeId]: quantity },
    }));
  };

  const toggleSize = (cartonId: string, sizeId: string) => {
    setGrid((previous) => {
      const current = { ...(previous[cartonId] ?? {}) };
      if (sizeId in current) delete current[sizeId];
      else current[sizeId] = 0;
      return { ...previous, [cartonId]: current };
    });
  };

  const ready =
    pending.length > 0 && pending.every((carton) => entered(carton.id) === carton.totalQty);

  const onSubmit = async () => {
    if (!arrivalId || !ready || ventilate.isPending) return;
    setSubmitError(null);
    try {
      await ventilate.mutateAsync({
        id: arrivalId,
        body: {
          cartons: pending.map((carton) => ({
            cartonId: carton.id,
            lines: Object.entries(grid[carton.id] ?? {})
              .filter(([, quantity]) => quantity > 0)
              .map(([sizeId, quantity]) => ({ sizeId, quantity })),
          })),
        },
      });
      Alert.alert(
        'Pointures ventilées',
        `${pending.length} carton(s) réparti(s) — les lots sont créés.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (error) {
      setSubmitError(apiMessage(error));
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
  const formError = submitError;

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled">
        {formError ? (
          <View className="rounded-xl bg-red-50 px-3 py-2.5">
            <Text className="text-sm text-red-600">{formError}</Text>
          </View>
        ) : null}

        <View className="gap-1 rounded-xl border border-slate-200 bg-white p-4">
          <Text className="text-lg font-bold text-slate-900">{data.reference}</Text>
          <Text className="text-xs text-slate-500">{data.supplier.name}</Text>
          <Text className="mt-2 text-xs text-slate-500">
            {formatQuantity(data.totalQty)} pièce(s) · {formatMoney(data.totalCost)} — le prix
            d&apos;achat unitaire de chaque pointure vaut montant ÷ quantité (arrondi à
            l&apos;unité inférieure) : il n&apos;est pas saisi ici. Aucune écriture comptable :
            caisse et dette datent de l&apos;enregistrement.
          </Text>
        </View>

        {!canManage ? (
          <View className="rounded-xl bg-amber-50 px-3 py-2.5">
            <Text className="text-sm text-amber-700">
              La ventilation est réservée aux gestionnaires.
            </Text>
          </View>
        ) : null}

        {pending.length === 0 ? (
          <View className="items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-6">
            <Ionicons color="#CBD5E1" name="cube-outline" size={28} />
            <Text className="text-sm text-slate-400">
              Tous les cartons ont déjà leurs pointures.
            </Text>
          </View>
        ) : (
          pending.map((carton) => {
            const rows = Object.entries(grid[carton.id] ?? {}).filter(
              ([, quantity]) => quantity > 0,
            );
            const done = entered(carton.id);
            const exact = done === carton.totalQty;
            const unitCost = Math.floor(Number(carton.totalCost) / Math.max(carton.totalQty, 1));

            return (
              <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4" key={carton.id}>
                <View className="flex-row items-start justify-between gap-2">
                  <View className="flex-1">
                    <Text className="text-sm font-bold text-slate-900">
                      {carton.reference}
                      <Text className="text-xs font-normal text-slate-400">
                        {' '}
                        · {carton.product.name}
                      </Text>
                    </Text>
                    <Text className="text-xs text-slate-400">
                      {formatQuantity(carton.totalQty)} p. · {formatMoney(carton.totalCost)} ·
                      unitaire {formatMoney(unitCost)}
                    </Text>
                  </View>
                  <View
                    className={`rounded-full px-2 py-0.5 ${exact ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                    <Text
                      className={`text-[11px] font-semibold ${exact ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {done}/{carton.totalQty} p.
                    </Text>
                  </View>
                </View>

                {sizeItems.length === 0 ? (
                  <Text className="text-sm text-slate-500">
                    Aucune pointure dans le dictionnaire — ajoutez-en depuis le catalogue.
                  </Text>
                ) : (
                  <ScrollView
                    contentContainerStyle={{ gap: 8 }}
                    horizontal
                    showsHorizontalScrollIndicator={false}>
                    {sizeItems.map((size) => {
                      const active = size.id in (grid[carton.id] ?? {});
                      return (
                        <Pressable
                          key={size.id}
                          className={`rounded-full border px-3 py-1.5 ${
                            active ? 'border-brand bg-brand' : 'border-slate-200 bg-white'
                          }`}
                          onPress={() => toggleSize(carton.id, size.id)}>
                          <Text
                            className={`text-sm ${active ? 'font-semibold text-white' : 'text-slate-600'}`}>
                            {size.label || size.value}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}

                {rows.length === 0 ? (
                  <Text className="text-xs text-slate-400">
                    Touchez les pointures reçues ci-dessus, puis saisissez les quantités.
                  </Text>
                ) : (
                  rows.map(([sizeId, quantity]) => {
                    const size = sizeItems.find((item) => item.id === sizeId);
                    return (
                      <View className="flex-row items-center gap-2" key={sizeId}>
                        <View className="w-16 items-center rounded-lg bg-slate-100 py-2">
                          <Text className="text-sm font-semibold text-slate-700">
                            {size ? size.label || size.value : '?'}
                          </Text>
                        </View>
                        <TextInput
                          className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-base text-slate-900"
                          keyboardType="numeric"
                          onChangeText={(raw) => setQuantity(carton.id, sizeId, raw)}
                          placeholder="0"
                          placeholderTextColor="#94A3B8"
                          selectionColor="#208AEF"
                          value={quantity ? String(quantity) : ''}
                        />
                        <Pressable
                          accessibilityLabel="Retirer la pointure"
                          className="h-10 w-10 items-center justify-center rounded-lg bg-red-50"
                          onPress={() => toggleSize(carton.id, sizeId)}>
                          <Ionicons color="#DC2626" name="trash-outline" size={16} />
                        </Pressable>
                      </View>
                    );
                  })
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      <View className="gap-3 border-t border-slate-200 bg-white px-4 py-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-slate-500">
            {pending.length} carton(s) à ventiler
          </Text>
          <Text className="text-sm font-semibold text-slate-900">
            {ready ? 'Somme exacte ✓' : 'Saisie incomplète'}
          </Text>
        </View>
        <Pressable
          className={`h-12 items-center justify-center rounded-xl ${
            !ready || ventilate.isPending ? 'bg-slate-400' : 'bg-brand'
          }`}
          disabled={!ready || ventilate.isPending}
          onPress={() => void onSubmit()}>
          {ventilate.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-base font-semibold text-white">Ventiler les pointures</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
