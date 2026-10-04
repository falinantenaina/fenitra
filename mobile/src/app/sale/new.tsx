import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
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

import { Chip } from '@/components/chip';
import { apiMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  useCreateSale,
  useCustomers,
  useOnlineSellers,
  usePaymentMethods,
  useSaleReference,
  useStockSummary,
  useVariantSearch,
} from '@/lib/queries';
import {
  PAYMENT_MODES,
  buildSalePayload,
  saleFormSchema,
  saleQuantity,
  saleTotal,
  type PaymentMode,
  type SaleFormValues,
} from '@/lib/sale';
import type { VariantSearchItem } from '@/lib/types';

const PAYMENT_LABELS: Record<PaymentMode, string> = {
  FULL: 'Total',
  PARTIAL: 'Partiel',
  CREDIT: 'Crédit',
};

function StockHint({ variantId, quantity }: { variantId: string; quantity: number }) {
  const summary = useStockSummary(variantId);
  if (summary.isPending) return null;

  const available = summary.data?.quantity ?? 0;
  const short = quantity > available;

  return (
    <Text className={`text-xs ${short ? 'font-medium text-red-600' : 'text-slate-400'}`}>
      {short ? `Stock insuffisant : ${available} disponible(s)` : `${available} en stock`}
    </Text>
  );
}

export default function NewSaleScreen() {
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<SaleFormValues>({
    resolver: zodResolver(saleFormSchema),
    mode: 'onSubmit',
    defaultValues: {
      items: [],
      customerId: '',
      onlineSellerId: '',
      paymentMode: 'FULL',
      paymentAmount: 0,
      paymentMethod: undefined,
      notes: '',
    },
  });

  const { fields, append, update, remove } = useFieldArray({ control, name: 'items' });
  const items = useWatch({ control, name: 'items' }) ?? [];
  const paymentMode = useWatch({ control, name: 'paymentMode' }) ?? 'FULL';
  const customerId = useWatch({ control, name: 'customerId' }) ?? '';
  const onlineSellerId = useWatch({ control, name: 'onlineSellerId' }) ?? '';
  const paymentMethod = useWatch({ control, name: 'paymentMethod' });
  const paymentAmount = useWatch({ control, name: 'paymentAmount' }) ?? 0;
  const notes = useWatch({ control, name: 'notes' }) ?? '';

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  const createSale = useCreateSale();
  const reference = useSaleReference();
  const customers = useCustomers();
  const onlineSellers = useOnlineSellers();
  const methods = usePaymentMethods();
  const results = useVariantSearch(debounced);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const total = saleTotal(items);
  const quantity = saleQuantity(items);
  const paid =
    paymentMode === 'FULL'
      ? total
      : paymentMode === 'PARTIAL'
        ? Math.min(paymentAmount, total)
        : 0;
  const needsParty = total - paid > 0 && !customerId && !onlineSellerId;

  const addVariant = (variant: VariantSearchItem) => {
    const index = fields.findIndex((line) => line.variantId === variant.id);
    if (index >= 0) {
      const line = fields[index];
      update(index, { ...line, quantity: line.quantity + 1 });
    } else {
      append({
        variantId: variant.id,
        productName: variant.product.name,
        sizeLabel: variant.size.label || `${variant.size.value}`,
        quantity: 1,
        unitPrice: Number(variant.sellingPrice),
      });
    }
    setTerm('');
    setDebounced('');
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      const sale = await createSale.mutateAsync(buildSalePayload(values));
      Alert.alert(
        'Vente enregistrée',
        `${sale.reference}\nTotal ${formatMoney(sale.totalAmount)} — réglé ${formatMoney(sale.paidAmount)}`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (error) {
      Alert.alert('Vente refusée', apiMessage(error));
    }
  });

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView className="flex-1 px-4 pb-32 pt-4" keyboardShouldPersistTaps="handled">
        {reference.data ? (
          <Text className="text-xs text-slate-400">
            Prochaine référence : {reference.data.reference}
          </Text>
        ) : null}

        {/* Recherche d'article */}
        <View className="mt-3 flex-row items-center gap-2 rounded-xl border border-slate-300 bg-white px-3">
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

        {debounced.trim().length >= 2 ? (
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
                  onPress={() => addVariant(variant)}>
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

        {/* Panier */}
        <View className="mt-4">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Panier · {quantity} article{quantity > 1 ? 's' : ''}
          </Text>
          {errors.items?.root?.message ? (
            <Text className="mt-1 text-xs text-red-600">{errors.items.root.message}</Text>
          ) : null}

          <View className="mt-2 gap-2">
            {fields.length === 0 ? (
              <View className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-6">
                <Text className="text-center text-sm text-slate-400">
                  Cherchez un modèle pour ajouter une pointure.
                </Text>
              </View>
            ) : (
              fields.map((line, index) => (
                <View className="rounded-xl border border-slate-200 bg-white p-3" key={line.id}>
                  <View className="flex-row items-start justify-between gap-2">
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-slate-800">
                        {line.productName}
                      </Text>
                      <Text className="text-xs text-slate-400">Pointure {line.sizeLabel}</Text>
                      <StockHint quantity={line.quantity} variantId={line.variantId} />
                    </View>
                    <Pressable hitSlop={8} onPress={() => remove(index)}>
                      <Ionicons color="#EF4444" name="trash-outline" size={20} />
                    </Pressable>
                  </View>

                  <View className="mt-2 flex-row items-center gap-3">
                    <View className="flex-row items-center overflow-hidden rounded-lg border border-slate-300">
                      <Pressable
                        className="h-8 w-8 items-center justify-center bg-slate-100"
                        onPress={() =>
                          update(index, { ...line, quantity: Math.max(1, line.quantity - 1) })
                        }>
                        <Ionicons color="#334155" name="remove" size={16} />
                      </Pressable>
                      <Text className="w-9 text-center text-sm font-semibold text-slate-800">
                        {line.quantity}
                      </Text>
                      <Pressable
                        className="h-8 w-8 items-center justify-center bg-slate-100"
                        onPress={() => update(index, { ...line, quantity: line.quantity + 1 })}>
                        <Ionicons color="#334155" name="add" size={16} />
                      </Pressable>
                    </View>

                    <Controller
                      control={control}
                      name={`items.${index}.unitPrice`}
                      render={({ field }) => (
                        <TextInput
                          className="h-9 flex-1 rounded-lg border border-slate-300 px-3 text-right text-sm text-slate-900"
                          keyboardType="numeric"
                          onChangeText={(raw) => {
                            const digits = raw.replace(/[^0-9]/g, '');
                            field.onChange(digits === '' ? 0 : Number(digits));
                          }}
                          placeholder="Prix"
                          placeholderTextColor="#94A3B8"
                          selectionColor="#208AEF"
                          value={line.unitPrice ? String(line.unitPrice) : ''}
                        />
                      )}
                    />
                    <Text className="w-24 text-right text-sm font-semibold text-slate-800">
                      {formatMoney(line.quantity * line.unitPrice)}
                    </Text>
                  </View>

                  {errors.items?.[index]?.unitPrice?.message ? (
                    <Text className="mt-1 text-xs text-red-600">
                      {errors.items[index]?.unitPrice?.message}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
          </View>
        </View>

        {/* Tiers — client ou vendeur en ligne (mutuellement exclusifs) */}
        <View className="mt-5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Client
          </Text>
          <ScrollView
            className="mt-2"
            contentContainerStyle={{ gap: 8 }}
            horizontal
            showsHorizontalScrollIndicator={false}>
            <Chip
              label="Comptoir"
              selected={customerId === ''}
              onPress={() => {
                setValue('customerId', '');
                setValue('onlineSellerId', '');
              }}
            />
            {(customers.data ?? []).map((customer) => (
              <Chip
                key={customer.id}
                label={customer.name}
                selected={customerId === customer.id}
                onPress={() => {
                  setValue('customerId', customer.id);
                  setValue('onlineSellerId', '');
                }}
              />
            ))}
          </ScrollView>

          <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Vendeur en ligne
          </Text>
          <ScrollView
            className="mt-2"
            contentContainerStyle={{ gap: 8 }}
            horizontal
            showsHorizontalScrollIndicator={false}>
            <Chip
              label="Aucun"
              selected={onlineSellerId === ''}
              onPress={() => {
                setValue('onlineSellerId', '');
                setValue('customerId', '');
              }}
            />
            {(onlineSellers.data ?? []).map((seller) => (
              <Chip
                key={seller.id}
                label={seller.name}
                selected={onlineSellerId === seller.id}
                onPress={() => {
                  setValue('onlineSellerId', seller.id);
                  setValue('customerId', '');
                }}
              />
            ))}
          </ScrollView>

          {errors.customerId?.message || errors.onlineSellerId?.message ? (
            <Text className="mt-2 text-xs text-red-600">
              {errors.customerId?.message ?? errors.onlineSellerId?.message}
            </Text>
          ) : null}
        </View>

        {/* Règlement */}
        <View className="mt-5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Règlement
          </Text>
          <View className="mt-2 flex-row gap-2">
            {PAYMENT_MODES.map((mode) => (
              <Chip
                key={mode}
                label={PAYMENT_LABELS[mode]}
                selected={paymentMode === mode}
                onPress={() => setValue('paymentMode', mode)}
              />
            ))}
          </View>

          {needsParty ? (
            <Text className="mt-2 text-xs text-amber-600">
              Une vente réglée partiellement ou à crédit doit être rattachée à un client ou à un
              vendeur en ligne.
            </Text>
          ) : null}

          {paymentMode === 'PARTIAL' ? (
            <Controller
              control={control}
              name="paymentAmount"
              render={({ field }) => (
                <View className="mt-3">
                  <TextInput
                    className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-right text-base text-slate-900"
                    keyboardType="numeric"
                    onChangeText={(raw) => {
                      const digits = raw.replace(/[^0-9]/g, '');
                      field.onChange(digits === '' ? 0 : Number(digits));
                    }}
                    placeholder={`Montant réglé sur ${formatMoney(total)}`}
                    placeholderTextColor="#94A3B8"
                    selectionColor="#208AEF"
                    value={field.value ? String(field.value) : ''}
                  />
                  {errors.paymentAmount?.message ? (
                    <Text className="mt-1 text-xs text-red-600">
                      {errors.paymentAmount.message}
                    </Text>
                  ) : null}
                </View>
              )}
            />
          ) : null}

          {paymentMode !== 'CREDIT' ? (
            <ScrollView
              className="mt-3"
              contentContainerStyle={{ gap: 8 }}
              horizontal
              showsHorizontalScrollIndicator={false}>
              {(methods.data ?? []).map((method) => (
                <Chip
                  key={method.id}
                  label={method.name}
                  selected={paymentMethod === method.name}
                  onPress={() => setValue('paymentMethod', method.name)}
                />
              ))}
            </ScrollView>
          ) : null}
        </View>

        {/* Notes */}
        <View className="mt-5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Notes
          </Text>
          <TextInput
            className="mt-2 min-h-[72px] rounded-xl border border-slate-300 bg-white p-3 text-base text-slate-900"
            multiline
            onChangeText={(text) => setValue('notes', text)}
            placeholder="Facultatif"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={notes}
          />
        </View>
      </ScrollView>

      {/* Pied d'écran collant */}
      <View className="border-t border-slate-200 bg-white px-4 pb-6 pt-3">
        <View className="flex-row items-end justify-between">
          <View>
            <Text className="text-xs text-slate-400">
              {quantity} article{quantity > 1 ? 's' : ''} ·{' '}
              {paymentMode === 'CREDIT'
                ? 'crédit'
                : paymentMode === 'PARTIAL'
                  ? 'partiel'
                  : 'réglé'}
            </Text>
            <Text className="text-xl font-bold text-slate-900">{formatMoney(total)}</Text>
          </View>
          <Pressable
            className={`h-11 items-center justify-center rounded-xl px-6 ${
              createSale.isPending || fields.length === 0 ? 'bg-slate-300' : 'bg-brand'
            }`}
            disabled={createSale.isPending || fields.length === 0}
            onPress={() => void onSubmit()}>
            {createSale.isPending ? (
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
