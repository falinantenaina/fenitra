import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { toast } from '@/components/toast';
import { apiMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  adjustFormSchema,
  buildAdjustPayload,
  todayISO,
  type AdjustFormValues,
} from '@/lib/finance';
import { useAdjustStock, useStockSummary, useVariantSearch } from '@/lib/queries';
import type { VariantSearchItem } from '@/lib/types';

export default function AdjustStockScreen() {
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<AdjustFormValues>({
    resolver: zodResolver(adjustFormSchema),
    mode: 'onSubmit',
    defaultValues: { variantId: '', qty: 1, reason: '', date: todayISO() },
  });

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<VariantSearchItem | null>(null);

  const results = useVariantSearch(debounced, { inStock: true });
  const adjust = useAdjustStock();
  const summary = useStockSummary(selected?.id ?? null);
  const qty = useWatch({ control, name: 'qty' }) ?? 1;

  const available = summary.data?.quantity ?? 0;
  const avgCost =
    summary.data && summary.data.quantity > 0 ? Number(summary.data.value) / summary.data.quantity : 0;
  const estimatedLoss = Math.round(avgCost * (qty || 0));

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const pickVariant = (variant: VariantSearchItem) => {
    setSelected(variant);
    setValue('variantId', variant.id, { shouldValidate: true });
    setTerm('');
    setDebounced('');
  };

  const onSubmit = handleSubmit(async (values) => {
    if (selected && values.qty > available) {
      toast.error('Stock insuffisant', `Seulement ${available} unité(s) en stock.`);
      return;
    }
    try {
      const result = await adjust.mutateAsync(buildAdjustPayload(values));
      toast.success(
        'Ajustement enregistré',
        `${result.quantity} unité(s) retirée(s) — perte ${formatMoney(result.lostValue)} · dépense de casse créée.`,
      );
      router.back();
    } catch (error) {
      toast.error('Ajustement refusé', apiMessage(error));
    }
  });

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView className="flex-1 px-4 pb-32 pt-4" keyboardShouldPersistTaps="handled">
        <View className="gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <Text className="text-xs font-medium text-amber-800">
            Casse ou perte : la quantité est retirée du stock en FIFO, la valeur devient une
            dépense (perte de marchandise).
          </Text>
        </View>

        {/* Recherche d'article */}
        <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Article
        </Text>
        <View className="mt-2 flex-row items-center gap-2 rounded-xl border border-slate-300 bg-white px-3">
          <Ionicons color="#94A3B8" name="search" size={18} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="h-11 flex-1 text-base text-slate-900"
            onChangeText={setTerm}
            placeholder="Modèle, pointure, SKU…"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={term}
          />
        </View>
        {errors.variantId ? (
          <Text className="mt-1 text-xs text-red-600">{errors.variantId.message}</Text>
        ) : null}

        {selected ? (
          <View className="mt-2 flex-row items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <View className="flex-1">
              <Text className="text-sm font-semibold text-slate-800">
                {selected.product.name}
              </Text>
              <Text className="text-xs text-slate-400">
                Pointure {selected.size.label || selected.size.value}
                {selected.sku ? ` · ${selected.sku}` : ''}
              </Text>
              <Text className="text-xs text-slate-400">
                {summary.isPending
                  ? 'Stock…'
                  : `Stock disponible : ${available} · vente ${formatMoney(selected.sellingPrice)}`}
              </Text>
            </View>
            <Pressable
              hitSlop={8}
              onPress={() => {
                setSelected(null);
                setValue('variantId', '');
              }}>
              <Ionicons color="#EF4444" name="close-circle" size={22} />
            </Pressable>
          </View>
        ) : debounced.trim().length >= 2 ? (
          <View className="mt-2 max-h-56 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {results.isPending ? (
              <ActivityIndicator className="py-4" color="#208AEF" />
            ) : (results.data ?? []).length === 0 ? (
              <Text className="px-3 py-4 text-sm text-slate-400">Aucun article trouvé.</Text>
            ) : (
              (results.data ?? []).map((variant) => (
                <Pressable
                  className="flex-row items-center justify-between border-b border-slate-100 px-3 py-3 last:border-b-0"
                  key={variant.id}
                  onPress={() => pickVariant(variant)}>
                  <View className="flex-1 pr-3">
                    <Text className="text-sm font-medium text-slate-800">
                      {variant.product.name}
                    </Text>
                    <Text className="text-xs text-slate-400">
                      Pointure {variant.size.label || variant.size.value}
                      {variant.sku ? ` · ${variant.sku}` : ''}
                    </Text>
                  </View>
                  <Text className="text-sm font-semibold text-slate-700">
                    {formatMoney(variant.sellingPrice)}
                  </Text>
                </Pressable>
              ))
            )}
          </View>
        ) : null}

        {/* Quantité perdue */}
        <View className="mt-5 gap-1.5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Quantité perdue
          </Text>
          <Controller
            control={control}
            name="qty"
            render={({ field }) => (
              <View className="flex-row items-center gap-3">
                <View className="flex-row items-center overflow-hidden rounded-lg border border-slate-300 bg-white">
                  <Pressable
                    className="h-10 w-10 items-center justify-center bg-slate-100"
                    onPress={() => field.onChange(Math.max(1, field.value - 1))}>
                    <Ionicons color="#334155" name="remove" size={18} />
                  </Pressable>
                  <TextInput
                    className="w-16 text-center text-base font-semibold text-slate-900"
                    keyboardType="numeric"
                    onChangeText={(raw) => {
                      const digits = raw.replace(/[^0-9]/g, '');
                      field.onChange(digits === '' ? 0 : Number(digits));
                    }}
                    value={field.value ? String(field.value) : ''}
                  />
                  <Pressable
                    className="h-10 w-10 items-center justify-center bg-slate-100"
                    onPress={() => field.onChange(field.value + 1)}>
                    <Ionicons color="#334155" name="add" size={18} />
                  </Pressable>
                </View>
                <Text className="text-sm text-slate-500">
                  {selected ? `sur ${available} en stock` : 'article à choisir'}
                </Text>
              </View>
            )}
          />
          {errors.qty ? (
            <Text className="text-xs text-red-600">{errors.qty.message}</Text>
          ) : null}
        </View>

        {/* Motif */}
        <View className="mt-5 gap-1.5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Motif
          </Text>
          <Controller
            control={control}
            name="reason"
            render={({ field }) => (
              <TextInput
                className="min-h-[72px] rounded-xl border border-slate-300 bg-white p-3 text-base text-slate-900"
                multiline
                onChangeText={field.onChange}
                placeholder="Casse, vol, pièce abîmée…"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={field.value}
              />
            )}
          />
          {errors.reason ? (
            <Text className="text-xs text-red-600">{errors.reason.message}</Text>
          ) : null}
        </View>

        {/* Date */}
        <View className="mt-5 flex-row items-end gap-3">
          <View className="flex-1 gap-1.5">
            <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Date (AAAA-MM-JJ)
            </Text>
            <Controller
              control={control}
              name="date"
              render={({ field }) => (
                <TextInput
                  autoCapitalize="none"
                  className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900"
                  keyboardType="numbers-and-punctuation"
                  onChangeText={(date) => field.onChange(date.trim())}
                  placeholder="2026-10-02"
                  placeholderTextColor="#94A3B8"
                  selectionColor="#208AEF"
                  value={field.value}
                />
              )}
            />
          </View>
          <Pressable
            className="h-11 items-center justify-center rounded-xl bg-slate-100 px-4"
            onPress={() => setValue('date', todayISO())}>
            <Text className="text-sm font-medium text-slate-700">Aujourd&apos;hui</Text>
          </Pressable>
        </View>
        {errors.date ? <Text className="mt-1 text-xs text-red-600">{errors.date.message}</Text> : null}
      </ScrollView>

      {/* Pied d'écran collant */}
      <View className="border-t border-slate-200 bg-white px-4 pb-6 pt-3">
        <View className="flex-row items-end justify-between">
          <View>
            <Text className="text-xs text-slate-400">
              {selected ? `${qty} × ${selected.product.name}` : 'Aucun article'}
            </Text>
            <Text className="text-xl font-bold text-slate-900">
              {selected ? formatMoney(estimatedLoss) : '—'}
            </Text>
          </View>
          <Pressable
            className={`h-11 items-center justify-center rounded-xl px-6 ${
              adjust.isPending || !selected ? 'bg-slate-300' : 'bg-brand'
            }`}
            disabled={adjust.isPending || !selected}
            onPress={() => void onSubmit()}>
            {adjust.isPending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="font-semibold text-white">Enregistrer</Text>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
