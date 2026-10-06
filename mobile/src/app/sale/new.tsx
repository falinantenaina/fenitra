import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chip } from '@/components/chip';
import { ErrorPanel } from '@/components/error-panel';
import { SelectField } from '@/components/select-field';
import { SeriesSheet, type SeriesLine } from '@/components/series-sheet';
import { toast } from '@/components/toast';
import { apiMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  useCreateParty,
  useCreateSale,
  useCustomers,
  usePaymentMethods,
  useSaleReference,
  useSaleVariants,
  useStockSummary,
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
  const paymentMethod = useWatch({ control, name: 'paymentMethod' });
  const paymentAmount = useWatch({ control, name: 'paymentAmount' }) ?? 0;
  const notes = useWatch({ control, name: 'notes' }) ?? '';

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [series, setSeries] = useState<{ productId: string; name: string } | null>(null);
  const [customerModal, setCustomerModal] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const createSale = useCreateSale();
  const createParty = useCreateParty();
  const reference = useSaleReference();
  const customers = useCustomers();
  const methods = usePaymentMethods();
  const results = useSaleVariants(debounced);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(timer);
  }, [term]);

  const cards = useMemo(() => {
    const byId = new Map<
      string,
      { productId: string; name: string; price: number; sizes: number; stock: number }
    >();
    for (const variant of results.data ?? []) {
      const card = byId.get(variant.product.id) ?? {
        productId: variant.product.id,
        name: variant.product.name,
        price: Number(variant.sellingPrice),
        sizes: 0,
        stock: 0,
      };
      card.price = Math.min(card.price, Number(variant.sellingPrice));
      card.sizes += 1;
      card.stock += variant.stock;
      byId.set(variant.product.id, card);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [results.data]);

  const total = saleTotal(items);
  const quantity = saleQuantity(items);
  const paid =
    paymentMode === 'FULL'
      ? total
      : paymentMode === 'PARTIAL'
        ? Math.min(paymentAmount, total)
        : 0;
  const needsParty = total - paid > 0 && !customerId;

  const addSeries = (lines: SeriesLine[]) => {
    for (const line of lines) {
      const index = fields.findIndex((field) => field.variantId === line.variantId);
      if (index >= 0) {
        const existing = fields[index];
        update(index, { ...existing, quantity: existing.quantity + line.quantity });
      } else {
        append({
          variantId: line.variantId,
          productName: line.productName,
          sizeLabel: line.sizeLabel,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        });
      }
    }
    setSeries(null);
    setTerm('');
    setDebounced('');
  };

  const selectCustomer = (id: string) => {
    setValue('customerId', id);
    if (!id) {
      setValue('paymentMode', 'FULL');
      setValue('paymentAmount', 0);
    }
  };

  const createCustomer = async () => {
    const name = customerName.trim();
    if (!name || createParty.isPending) return;
    try {
      const party = await createParty.mutateAsync({
        kind: 'customers',
        body: { name, ...(customerPhone.trim() ? { phone: customerPhone.trim() } : {}) },
      });
      setCustomerModal(false);
      setCustomerName('');
      setCustomerPhone('');
      setValue('customerId', party.id);
      toast.success('Client créé', `${party.name} est sélectionné pour cette vente.`);
    } catch (error) {
      toast.error('Création refusée', apiMessage(error));
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      const sale = await createSale.mutateAsync(buildSalePayload(values));
      toast.success(
        'Vente enregistrée',
        `${sale.reference} — total ${formatMoney(sale.totalAmount)}, réglé ${formatMoney(sale.paidAmount)}`,
      );
      router.back();
    } catch (error) {
      toast.error('Vente refusée', apiMessage(error));
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

        {/* Recherche de modèle */}
        <View className="mt-3 flex-row items-center gap-2 rounded-xl border border-slate-300 bg-white px-3">
          <Ionicons color="#94A3B8" name="search" size={18} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            className="h-11 flex-1 text-base text-slate-900"
            onChangeText={setTerm}
            placeholder="Modèle, SKU…"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={term}
          />
          {term ? (
            <Pressable
              accessibilityLabel="Effacer la recherche"
              hitSlop={8}
              onPress={() => {
                setTerm('');
                setDebounced('');
              }}>
              <Ionicons color="#94A3B8" name="close-circle" size={18} />
            </Pressable>
          ) : null}
        </View>

        {/* Grille de vente : 2 colonnes, une carte par modèle */}
        {results.isPending ? (
          <ActivityIndicator className="mt-6" color="#208AEF" />
        ) : results.isError ? (
          <View className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
            <ErrorPanel
              isRetrying={results.isRefetching}
              message="Impossible de charger les modèles en stock."
              onRetry={() => void results.refetch()}
            />
          </View>
        ) : cards.length === 0 ? (
          <View className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-6">
            <Text className="text-center text-sm text-slate-400">
              Aucun modèle en stock{debounced ? ` pour « ${debounced} »` : ''}.
            </Text>
          </View>
        ) : (
          <View className="mt-3 flex-row flex-wrap justify-between gap-y-3">
            {cards.map((card) => (
              <Pressable
                accessibilityRole="button"
                className="w-[48%] rounded-2xl border border-slate-200 bg-white p-3"
                key={card.productId}
                onPress={() => setSeries({ productId: card.productId, name: card.name })}>
                <Text className="text-sm font-semibold text-slate-800" numberOfLines={2}>
                  {card.name}
                </Text>
                <Text className="mt-1 text-base font-bold text-slate-900">
                  {formatMoney(card.price)}
                </Text>
                <Text className="text-xs text-slate-400">
                  {card.stock} paires · {card.sizes} pointure(s)
                </Text>
                <View className="mt-2 h-9 flex-row items-center justify-center gap-1 rounded-lg bg-brand">
                  <Ionicons color="#FFFFFF" name="add" size={16} />
                  <Text className="text-xs font-semibold text-white">CHOISIR SÉRIE</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {/* Panier */}
        <View className="mt-4">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Panier · {quantity} paire{quantity > 1 ? 's' : ''}
          </Text>
          {errors.items?.root?.message ? (
            <Text className="mt-1 text-xs text-red-600">{errors.items.root.message}</Text>
          ) : null}

          <View className="mt-2 gap-2">
            {fields.length === 0 ? (
              <View className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-6">
                <Text className="text-center text-sm text-slate-400">
                  Choisissez un modèle puis « CHOISIR SÉRIE » pour remplir le panier.
                </Text>
              </View>
            ) : (
              fields.map((fieldLine, index) => {
                const line = items[index] ?? fieldLine;
                return (
                  <View className="rounded-xl border border-slate-200 bg-white p-3" key={fieldLine.id}>
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
                            value={field.value ? String(field.value) : ''}
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
                );
              })
            )}
          </View>
        </View>

        {/* Client — le comptoir reste le défaut (partiel/crédit avec client uniquement) */}
        <View className="mt-5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Client
          </Text>
          <View className="mt-2">
            <SelectField
              createVerb="Nouveau client"
              emptyText="Aucun client trouvé."
              error={errors.customerId?.message ?? null}
              loading={customers.isPending}
              options={[
                { id: '', label: 'Comptoir' },
                ...(customers.data ?? []).map((customer) => ({
                  id: customer.id,
                  label: customer.name,
                })),
              ]}
              placeholder="Rechercher ou créer un client…"
              title="Client"
              value={customerId}
              onCreate={async (term) => {
                setCustomerName(term);
                setCustomerModal(true);
              }}
              onSelect={selectCustomer}
            />
          </View>
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
                disabled={mode !== 'FULL' && !customerId}
                label={PAYMENT_LABELS[mode]}
                selected={paymentMode === mode}
                onPress={() => setValue('paymentMode', mode)}
              />
            ))}
          </View>

          {!customerId ? (
            <Text className="mt-2 text-xs text-slate-400">
              Au comptoir, la vente est réglée en totalité. Sélectionnez ou créez un client pour
              un règlement partiel ou à crédit.
            </Text>
          ) : null}

          {needsParty ? (
            <Text className="mt-2 text-xs text-amber-600">
              Une vente réglée partiellement ou à crédit doit être rattachée à un client.
            </Text>
          ) : null}

          {errors.paymentMode?.message ? (
            <Text className="mt-2 text-xs text-red-600">{errors.paymentMode.message}</Text>
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
              {quantity} paire{quantity > 1 ? 's' : ''} ·{' '}
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

      {/* Volet « choisir série » : la grille des pointures du modèle */}
      <SeriesSheet
        onClose={() => setSeries(null)}
        onConfirm={addSeries}
        productId={series?.productId ?? null}
        productName={series?.name ?? ''}
      />

      {/* Création rapide d'un client depuis la vente */}
      <Modal
        animationType="fade"
        onRequestClose={() => setCustomerModal(false)}
        transparent
        visible={customerModal}>
        <View className="flex-1 items-center justify-center bg-slate-900/50 px-6">
          <View className="w-full gap-3 rounded-2xl bg-white p-5">
            <Text className="text-base font-bold text-slate-900">Nouveau client</Text>
            <TextInput
              autoCapitalize="words"
              autoCorrect={false}
              className="h-11 rounded-xl border border-slate-300 px-4 text-base text-slate-900"
              onChangeText={setCustomerName}
              placeholder="Nom du client"
              placeholderTextColor="#94A3B8"
              selectionColor="#208AEF"
              value={customerName}
            />
            <TextInput
              className="h-11 rounded-xl border border-slate-300 px-4 text-base text-slate-900"
              keyboardType="phone-pad"
              onChangeText={setCustomerPhone}
              placeholder="Téléphone (facultatif)"
              placeholderTextColor="#94A3B8"
              selectionColor="#208AEF"
              value={customerPhone}
            />
            <View className="mt-1 flex-row justify-end gap-2">
              <Pressable
                accessibilityRole="button"
                className="h-10 items-center justify-center rounded-xl px-4"
                onPress={() => setCustomerModal(false)}>
                <Text className="text-sm font-semibold text-slate-600">Annuler</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                className={`h-10 min-w-[96px] items-center justify-center rounded-xl px-4 ${
                  !customerName.trim() || createParty.isPending ? 'bg-slate-300' : 'bg-brand'
                }`}
                disabled={!customerName.trim() || createParty.isPending}
                onPress={() => void createCustomer()}>
                {createParty.isPending ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text className="text-sm font-semibold text-white">Créer</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
