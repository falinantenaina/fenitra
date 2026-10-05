import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm, type FieldPath } from 'react-hook-form';
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
import {
  arrivalFormSchema,
  buildArrivalPayload,
  cartonTotals,
  cartonsToVentilate,
  formTotals,
  listedQuantity,
  listedSizes,
  todayISO,
  unitCostOf,
  type ArrivalFormValues,
  type CartonDraft,
} from '@/lib/arrival';
import { formatMoney } from '@/lib/format';
import {
  useCreateArrival,
  useCreateProduct,
  usePaymentMethods,
  useProductSearch,
  useProducts,
  useSizeList,
  useSuppliers,
} from '@/lib/queries';
import type { FundingSource, ProductListItem, SizeListItem } from '@/lib/types';
import { useArrivalDraft } from '@/store/arrival-draft';

const FUNDING_SOURCES: { value: FundingSource; label: string }[] = [
  { value: 'OWN_CAPITAL', label: 'Argent propre' },
  { value: 'TROSA_SINOA', label: 'Emprunt (à payer)' },
  { value: 'SALES_CASH', label: 'Caisse des ventes' },
  { value: 'SUPPLIER_CREDIT', label: 'Crédit fournisseur' },
];

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      className={`rounded-full border px-3 py-1.5 ${
        active ? 'border-brand bg-brand' : 'border-slate-200 bg-white'
      }`}
      onPress={onPress}>
      <Text className={`text-sm ${active ? 'font-semibold text-white' : 'text-slate-600'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

const sizeLabel = (size: SizeListItem): string => size.label || `${size.value}`;

/** Ligne de pointure listée : quantité éditable + retrait. */
function SizeRow({
  size,
  quantity,
  onChange,
  onRemove,
}: {
  size: SizeListItem;
  quantity: number;
  onChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  return (
    <View className="flex-row items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
      <Text className="w-12 text-sm font-bold text-slate-800">{sizeLabel(size)}</Text>
      <TextInput
        className="h-9 w-16 rounded-lg border border-slate-200 bg-white px-2 text-center text-sm text-slate-900"
        keyboardType="numeric"
        onChangeText={(raw) => onChange(Number(raw.replace(/[^0-9]/g, '')) || 0)}
        placeholder="0"
        placeholderTextColor="#94A3B8"
        selectionColor="#208AEF"
        value={quantity ? String(quantity) : ''}
      />
      <Text className="text-xs text-slate-400">paire(s)</Text>
      <Pressable
        accessibilityLabel={`Retirer la pointure ${sizeLabel(size)}`}
        className="ml-auto h-7 w-7 items-center justify-center rounded-md bg-red-50"
        onPress={onRemove}>
        <Ionicons color="#DC2626" name="close" size={14} />
      </Pressable>
    </View>
  );
}

interface CartonCardProps {
  index: number;
  carton: CartonDraft;
  products: ProductListItem[] | undefined;
  productsPending: boolean;
  onPatch: (patch: Partial<CartonDraft>) => void;
  onRemove: () => void;
  removable: boolean;
}

function CartonCard({
  index,
  carton,
  products,
  productsPending,
  onPatch,
  onRemove,
  removable,
}: CartonCardProps) {
  // Recherche de modèle avec création à la volée.
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(false);
  const results = useProductSearch(debounced);
  const createProduct = useCreateProduct();

  // Dictionnaire des pointures — le serveur créera les variantes au besoin.
  const sizes = useSizeList();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const term = debounced.trim();
  const searching = term.length > 0;
  const shown = searching ? (results.data?.items ?? []) : (products ?? []);
  const nameTaken = shown.some((p) => p.name.trim().toLowerCase() === term.toLowerCase());
  const canCreate = term.length >= 2 && searching && !nameTaken && !results.isPending;

  const createModel = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      const product = await createProduct.mutateAsync({ name: term });
      onPatch({ activeProductId: product.id });
      setSearch('');
      setDebounced('');
    } catch (error) {
      Alert.alert('Création refusée', apiMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const totals = cartonTotals(carton);
  const unitCost = unitCostOf(carton);
  const listed = listedQuantity(carton);
  const rows = listedSizes(carton);
  const dictionary = sizes.data?.items ?? [];
  const rowIds = new Set(rows.map((row) => row.sizeId));
  const available = dictionary.filter((size) => !rowIds.has(size.id));
  const sumComplete = listed > 0 && listed === carton.quantity;

  const setSizeQuantity = (sizeId: string, quantity: number) =>
    onPatch({ sizes: { ...carton.sizes, [sizeId]: quantity } });

  return (
    <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-bold text-slate-900">Carton {index + 1}</Text>
        <View className="flex-row items-center gap-3">
          <Text className="text-xs text-slate-400">
            {totals.quantity} p. · {formatMoney(totals.cost)}
          </Text>
          {removable ? (
            <Pressable
              accessibilityLabel={`Supprimer le carton ${index + 1}`}
              className="h-7 w-7 items-center justify-center rounded-md bg-red-50"
              onPress={onRemove}>
              <Ionicons color="#DC2626" name="trash-outline" size={15} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Étape 1 — le modèle */}
      <View>
        <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          1 · Modèle
        </Text>
        <View className="mb-2 flex-row items-center gap-2">
          <TextInput
            className="h-10 flex-1 rounded-lg border border-slate-200 px-3 text-sm text-slate-800"
            onChangeText={setSearch}
            placeholder="Rechercher ou créer un modèle…"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={search}
          />
          {search ? (
            <Pressable
              accessibilityLabel="Effacer la recherche"
              className="h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white"
              onPress={() => setSearch('')}>
              <Ionicons color="#64748B" name="close" size={16} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView contentContainerStyle={{ gap: 8 }} horizontal showsHorizontalScrollIndicator={false}>
          {(searching && results.isPending) || (!searching && productsPending && !products) ? (
            <ActivityIndicator color="#208AEF" />
          ) : shown.length === 0 ? (
            <Text className="text-sm text-slate-500">
              {searching ? 'Aucun modèle trouvé.' : 'Aucun modèle actif — créez-en un d&apos;abord.'}
            </Text>
          ) : (
            shown.map((product) => {
              const active = product.id === carton.activeProductId;
              return (
                <Pressable
                  className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${
                    active ? 'border-brand bg-brand' : 'border-slate-200 bg-white'
                  }`}
                  key={product.id}
                  onPress={() => onPatch({ activeProductId: product.id })}>
                  <Text
                    className={`text-sm ${active ? 'font-semibold text-white' : 'text-slate-600'}`}>
                    {product.name}
                  </Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        {canCreate ? (
          <Pressable
            className="mt-2 flex-row items-center gap-1.5 self-start rounded-lg border border-dashed border-brand bg-brand/5 px-3 py-2"
            disabled={creating}
            onPress={() => void createModel()}>
            <Ionicons color="#208AEF" name="add" size={15} />
            <Text className="text-sm font-semibold text-brand">
              {creating ? 'Création…' : `Créer « ${term} »`}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* Étape 2 — quantité et montant du carton */}
      <View className="gap-3">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          2 · Quantité et montant
        </Text>
        <View className="gap-1.5">
          <Text className="text-xs font-semibold text-slate-500">Paires reçues</Text>
          <TextInput
            className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900"
            keyboardType="numeric"
            onChangeText={(raw) => onPatch({ quantity: Number(raw.replace(/[^0-9]/g, '')) || 0 })}
            placeholder="0"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={carton.quantity ? String(carton.quantity) : ''}
          />
        </View>

        <View className="gap-1.5">
          <Text className="text-xs font-semibold text-slate-500">Montant du carton (Ar)</Text>
          <TextInput
            className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900"
            keyboardType="numeric"
            onChangeText={(raw) => onPatch({ amount: Number(raw.replace(/[^0-9]/g, '')) || 0 })}
            placeholder="0"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={carton.amount ? String(carton.amount) : ''}
          />
          <Text className="text-xs text-slate-400">
            Prix d&apos;achat de la paire :{' '}
            {unitCost > 0 ? `${formatMoney(unitCost)} / paire` : '—'} (montant ÷ quantité, imposé
            partout).
          </Text>
        </View>
      </View>

      {/* Étape 3 — pointures, quand on les connaît */}
      <View className="gap-2">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          3 · Pointures (facultatif)
        </Text>

        {rows.length > 0 ? (
          <View className="gap-2">
            {rows.map((row) => {
              const size = dictionary.find((candidate) => candidate.id === row.sizeId);
              if (!size) return null;
              return (
                <SizeRow
                  key={row.sizeId}
                  onChange={(quantity) => setSizeQuantity(row.sizeId, quantity)}
                  onRemove={() => setSizeQuantity(row.sizeId, 0)}
                  quantity={row.quantity}
                  size={size}
                />
              );
            })}
          </View>
        ) : (
          <Text className="text-xs text-slate-400">
            Aucune pointure listée : le carton sera à ventiler après l&apos;enregistrement.
          </Text>
        )}

        {available.length > 0 ? (
          <ScrollView
            contentContainerStyle={{ gap: 8 }}
            horizontal
            showsHorizontalScrollIndicator={false}>
            {sizes.isPending ? (
              <ActivityIndicator color="#208AEF" />
            ) : (
              available.map((size) => (
                <Pressable
                  className="flex-row items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5"
                  key={size.id}
                  onPress={() => setSizeQuantity(size.id, 1)}>
                  <Ionicons color="#208AEF" name="add" size={13} />
                  <Text className="text-sm text-slate-600">{sizeLabel(size)}</Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        ) : null}

        {rows.length > 0 ? (
          <Text
            className={`text-xs ${sumComplete ? 'text-emerald-600' : 'text-red-600'}`}>
            Pointures : {listed} / {carton.quantity} paires
            {sumComplete ? ' — somme exacte.' : ' — complétez pour égaler la quantité du carton.'}
          </Text>
        ) : null}
      </View>

      <TextInput
        className="h-10 rounded-lg border border-slate-200 px-3 text-sm text-slate-800"
        onChangeText={(notes) => onPatch({ notes })}
        placeholder="Notes du carton (facultatif)"
        placeholderTextColor="#94A3B8"
        selectionColor="#208AEF"
        value={carton.notes ?? ''}
      />
    </View>
  );
}

/** Premier message d'erreur (Zod / superRefine) parmi les champs. */
function firstErrorMessage(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const record = node as Record<string, unknown>;
  if (typeof record.message === 'string') return record.message;
  for (const value of Object.values(record)) {
    const found = firstErrorMessage(value);
    if (found) return found;
  }
  return null;
}

const emptyCarton = (productId = ''): CartonDraft => ({
  reference: '',
  activeProductId: productId,
  quantity: 0,
  amount: 0,
  sizes: {},
});

export default function NewArrivalScreen() {
  const suppliers = useSuppliers();
  const products = useProducts();
  const methods = usePaymentMethods();
  const createArrival = useCreateArrival();

  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    control,
    getValues,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ArrivalFormValues>({
    resolver: zodResolver(arrivalFormSchema),
    defaultValues: {
      supplierId: '',
      date: todayISO(),
      notes: '',
      cartons: [emptyCarton()],
      payment: { enabled: false, amount: 0, method: undefined },
      funding: { enabled: false, source: 'OWN_CAPITAL', amount: 0, notes: '' },
    },
    mode: 'onSubmit',
  });

  const { append, remove, fields } = useFieldArray({ control, name: 'cartons' });

  // Brouillon de saisie : reposé à l'ouverture, sauvegardé à chaque frappe.
  useEffect(() => {
    const saved = useArrivalDraft.getState().values;
    if (saved) reset(saved);
  }, [reset]);

  useEffect(() => {
    const subscription = watch((values) => {
      if (values) useArrivalDraft.getState().save(values as ArrivalFormValues);
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  const values = watch();
  const supplierId = values.supplierId;

  // Pré-remplissage : premier fournisseur / premier modèle actif.
  useEffect(() => {
    if (!supplierId && suppliers.data?.length) {
      setValue('supplierId', suppliers.data[0]!.id);
    }
  }, [supplierId, suppliers.data, setValue]);

  useEffect(() => {
    const first = products.data?.[0];
    if (!first) return;
    getValues('cartons').forEach((carton, index) => {
      if (!carton.activeProductId) {
        setValue(
          `cartons.${index}.activeProductId` as FieldPath<ArrivalFormValues>,
          first.id as never,
        );
      }
    });
  }, [products.data, getValues, setValue]);

  const totals = formTotals(values);
  const formError = firstErrorMessage(errors) ?? submitError;
  const pending = isSubmitting || createArrival.isPending;

  const patchCarton = (index: number, patch: Partial<CartonDraft>) => {
    (Object.keys(patch) as (keyof CartonDraft)[]).forEach((key) => {
      setValue(
        `cartons.${index}.${key}` as unknown as FieldPath<ArrivalFormValues>,
        patch[key] as never,
        { shouldDirty: true },
      );
    });
  };

  const togglePayment = () => {
    const next = !values.payment.enabled;
    setValue('payment.enabled', next);
    if (next) setValue('payment.amount', totals.cost);
  };

  const toggleFunding = () => {
    const next = !values.funding.enabled;
    setValue('funding.enabled', next);
    if (next) setValue('funding.amount', totals.cost);
  };

  const onSubmit = handleSubmit(async (formValues) => {
    setSubmitError(null);
    try {
      const created = await createArrival.mutateAsync(buildArrivalPayload(formValues));
      useArrivalDraft.getState().clear();
      const toVentilate = cartonsToVentilate(formValues);
      Alert.alert(
        'Arrivage enregistré',
        `${created.reference}\n${created.totalQty} pièce(s) — ${formatMoney(created.totalCost)}` +
          (toVentilate > 0 ? `\n${toVentilate} carton(s) à ventiler (pointures)` : ''),
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (error) {
      setSubmitError(apiMessage(error));
    }
  });

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

        {/* Rappel du modèle de saisie — évite la recherche du « bon champ ». */}
        <View className="gap-1.5 rounded-xl border border-slate-200 bg-white p-4">
          <Text className="text-sm font-semibold text-slate-900">Comment ça marche</Text>
          <Text className="text-xs leading-5 text-slate-500">
            Un carton = <Text className="font-semibold text-slate-700">un modèle</Text>,{' '}
            <Text className="font-semibold text-slate-700">une quantité</Text> de paires et{' '}
            <Text className="font-semibold text-slate-700">un montant total</Text>. Le prix
            d&apos;achat de la paire en découle (montant ÷ quantité) : vous ne le saisissez jamais.
            {' '}
            <Text className="font-semibold text-slate-700">Les pointures sont facultatives</Text> :
            listez-les ici si vous les connaissez, sinon vous les répartirez après coup depuis
            l&apos;arrivage. Tout ce qui n&apos;est pas réglé reste dû au fournisseur.
          </Text>
        </View>

        <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <View className="gap-1.5">
            <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Fournisseur
            </Text>
            <ScrollView
              contentContainerStyle={{ gap: 8 }}
              horizontal
              showsHorizontalScrollIndicator={false}>
              {suppliers.isPending ? (
                <ActivityIndicator color="#208AEF" />
              ) : (suppliers.data ?? []).length === 0 ? (
                <Text className="text-sm text-slate-500">Aucun fournisseur actif.</Text>
              ) : (
                (suppliers.data ?? []).map((supplier) => (
                  <Chip
                    active={supplier.id === supplierId}
                    key={supplier.id}
                    label={supplier.name}
                    onPress={() => setValue('supplierId', supplier.id)}
                  />
                ))
              )}
            </ScrollView>
            {errors.supplierId ? (
              <Text className="text-xs text-red-600">{errors.supplierId.message}</Text>
            ) : null}
          </View>

          <View className="flex-row items-end gap-3">
            <View className="flex-1 gap-1.5">
              <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Date (AAAA-MM-JJ)
              </Text>
              <TextInput
                autoCapitalize="none"
                className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900"
                keyboardType="numbers-and-punctuation"
                onChangeText={(date) => setValue('date', date.trim())}
                placeholder="2026-10-02"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={values.date}
              />
            </View>
            <Pressable
              className="h-11 items-center justify-center rounded-xl bg-slate-100 px-4"
              onPress={() => setValue('date', todayISO())}>
              <Text className="text-sm font-medium text-slate-700">Aujourd&apos;hui</Text>
            </Pressable>
          </View>
          {errors.date ? <Text className="text-xs text-red-600">{errors.date.message}</Text> : null}

          <View className="gap-1.5">
            <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Notes
            </Text>
            <TextInput
              className="min-h-16 rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-900"
              multiline
              onChangeText={(notes) => setValue('notes', notes)}
              placeholder="Conteneur, référence fournisseur…"
              placeholderTextColor="#94A3B8"
              selectionColor="#208AEF"
              value={values.notes ?? ''}
            />
          </View>
        </View>

        <View className="gap-3">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Cartons — modèle, quantité, montant (+ pointures si connues)
          </Text>

          {fields.map((field, index) => {
            const carton = values.cartons[index];
            if (!carton) return null;
            return (
              <CartonCard
                carton={carton}
                index={index}
                key={field.id}
                onPatch={(patch) => patchCarton(index, patch)}
                onRemove={() => remove(index)}
                products={products.data}
                productsPending={products.isPending}
                removable={fields.length > 1}
              />
            );
          })}

          <Pressable
            className="h-11 flex-row items-center justify-center gap-2 rounded-xl border border-dashed border-brand bg-brand/5"
            onPress={() => append(emptyCarton(products.data?.[0]?.id ?? ''))}>
            <Ionicons color="#208AEF" name="add" size={18} />
            <Text className="font-semibold text-brand">Ajouter un carton</Text>
          </Pressable>
        </View>

        <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <Pressable className="flex-row items-center justify-between" onPress={togglePayment}>
            <View className="flex-1 pr-3">
              <Text className="text-sm font-semibold text-slate-900">Réglé au fournisseur</Text>
              <Text className="text-xs text-slate-500">
                Payé en totalité ou en partie — le reste reste dû au fournisseur
              </Text>
            </View>
            <Ionicons
              color={values.payment.enabled ? '#16A34A' : '#CBD5E1'}
              name={values.payment.enabled ? 'checkbox-outline' : 'square-outline'}
              size={24}
            />
          </Pressable>

          {values.payment.enabled ? (
            <View className="gap-3 border-t border-slate-100 pt-3">
              <View className="gap-1.5">
                <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Montant réglé (Ar)
                </Text>
                <TextInput
                  className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900"
                  keyboardType="numeric"
                  onChangeText={(raw) =>
                    setValue('payment.amount', Number(raw.replace(/[^0-9]/g, '')) || 0)
                  }
                  placeholder="0"
                  placeholderTextColor="#94A3B8"
                  selectionColor="#208AEF"
                  value={values.payment.amount ? String(values.payment.amount) : ''}
                />
                <Text className="text-xs text-slate-400">
                  Total de l&apos;arrivage : {formatMoney(totals.cost)} — solde fournisseur :{' '}
                  {formatMoney(Math.max(0, totals.cost - values.payment.amount))}
                </Text>
                <Pressable
                  className="self-start rounded-lg bg-brand/10 px-3 py-1.5"
                  onPress={() => setValue('payment.amount', totals.cost)}>
                  <Text className="text-sm font-medium text-brand">
                    Payer tout ({formatMoney(totals.cost)})
                  </Text>
                </Pressable>
              </View>

              <View className="gap-1.5">
                <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Mode de paiement
                </Text>
                <ScrollView
                  contentContainerStyle={{ gap: 8 }}
                  horizontal
                  showsHorizontalScrollIndicator={false}>
                  {(methods.data ?? []).map((method) => (
                    <Chip
                      active={values.payment.method === method.name}
                      key={method.id}
                      label={method.name}
                      onPress={() =>
                        setValue(
                          'payment.method',
                          values.payment.method === method.name ? undefined : method.name,
                        )
                      }
                    />
                  ))}
                </ScrollView>
              </View>
              {errors.payment?.amount ? (
                <Text className="text-xs text-red-600">{errors.payment.amount.message}</Text>
              ) : null}
            </View>
          ) : null}

          <Pressable
            className="flex-row items-center justify-between border-t border-slate-100 pt-3"
            onPress={toggleFunding}>
            <View className="flex-1 pr-3">
              <Text className="text-sm font-semibold text-slate-900">Financement</Text>
              <Text className="text-xs text-slate-500">
                Origine de l&apos;argent (argent propre, emprunt, caisse…)
              </Text>
            </View>
            <Ionicons
              color={values.funding.enabled ? '#16A34A' : '#CBD5E1'}
              name={values.funding.enabled ? 'checkbox-outline' : 'square-outline'}
              size={24}
            />
          </Pressable>

          {values.funding.enabled ? (
            <View className="gap-3 border-t border-slate-100 pt-3">
              <View className="flex-row flex-wrap gap-2">
                {FUNDING_SOURCES.map((source) => (
                  <Chip
                    active={values.funding.source === source.value}
                    key={source.value}
                    label={source.label}
                    onPress={() => setValue('funding.source', source.value)}
                  />
                ))}
              </View>
              <View className="gap-1.5">
                <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Montant financé (Ar)
                </Text>
                <TextInput
                  className="h-11 rounded-xl border border-slate-300 px-3 text-base text-slate-900"
                  keyboardType="numeric"
                  onChangeText={(raw) =>
                    setValue('funding.amount', Number(raw.replace(/[^0-9]/g, '')) || 0)
                  }
                  placeholder="0"
                  placeholderTextColor="#94A3B8"
                  selectionColor="#208AEF"
                  value={values.funding.amount ? String(values.funding.amount) : ''}
                />
              </View>
              {errors.funding?.amount ? (
                <Text className="text-xs text-red-600">{errors.funding.amount.message}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View className="gap-3 border-t border-slate-200 bg-white px-4 py-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-slate-500">
            {`${totals.quantity} pièce(s) · ${values.cartons.length} carton(s)`}
          </Text>
          <Text className="text-lg font-bold text-slate-900">{formatMoney(totals.cost)}</Text>
        </View>
        <Pressable
          className={`h-12 items-center justify-center rounded-xl ${
            pending ? 'bg-slate-400' : 'bg-brand'
          }`}
          disabled={pending}
          onPress={() => void onSubmit()}>
          {pending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="text-base font-semibold text-white">Enregistrer l&apos;arrivage</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
