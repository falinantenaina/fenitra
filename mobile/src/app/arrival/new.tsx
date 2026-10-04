import { Ionicons } from '@expo/vector-icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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

import { PriceBulkModal } from '@/components/price-bulk-modal';
import { SizeGrid, type PriceClipboard } from '@/components/size-grid';
import { apiMessage } from '@/lib/api';
import {
  arrivalFormSchema,
  buildArrivalPayload,
  buildDraftPayload,
  cartonTotals,
  emptyCell,
  formTotals,
  todayISO,
  type ArrivalFormValues,
  type CartonDraft,
  type GridCell,
} from '@/lib/arrival';
import { formatMoney } from '@/lib/format';
import { pick } from '@/lib/params';
import {
  useArrival,
  useCreateArrival,
  useCreateArrivalDraft,
  useCreateProduct,
  useCreateVariantsBulk,
  usePaymentMethods,
  useProduct,
  useProductSearch,
  useProducts,
  useReceiveArrival,
  useSizeList,
  useSuppliers,
} from '@/lib/queries';
import type { FundingSource, ProductListItem } from '@/lib/types';
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

interface CartonCardProps {
  index: number;
  carton: CartonDraft;
  draft: boolean;
  products: ProductListItem[] | undefined;
  productsPending: boolean;
  onPatch: (patch: Partial<CartonDraft>) => void;
  onRemove: () => void;
  removable: boolean;
}

function CartonCard({
  index,
  carton,
  draft,
  products,
  productsPending,
  onPatch,
  onRemove,
  removable,
}: CartonCardProps) {
  const productQuery = useProduct(carton.activeProductId || null);
  const [clipboard, setClipboard] = useState<PriceClipboard | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  // Recherche de modèle avec création à la volée.
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [creating, setCreating] = useState(false);
  const results = useProductSearch(debounced);
  const sizes = useSizeList();
  const createProduct = useCreateProduct();
  const createVariants = useCreateVariantsBulk();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const term = debounced.trim();
  const searching = term.length > 0;
  const shown = searching ? (results.data?.items ?? []) : (products ?? []);
  const nameTaken = shown.some((p) => p.name.trim().toLowerCase() === term.toLowerCase());
  const canCreate =
    term.length >= 2 && searching && !nameTaken && !results.isPending && !sizes.isPending;

  const createModel = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      const product = await createProduct.mutateAsync({ name: term });
      const sizeValues = (sizes.data?.items ?? []).map((size) => size.value);
      if (sizeValues.length > 0) {
        await createVariants.mutateAsync({ productId: product.id, sizeValues });
      }
      onPatch({ activeProductId: product.id });
      setSearch('');
      setDebounced('');
    } catch (error) {
      Alert.alert('Création refusée', apiMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const variants = (productQuery.data?.variants ?? []).filter((variant) => variant.active);
  const totals = cartonTotals(carton);

  const changeCell = (variantId: string, patch: Partial<GridCell>) => {
    const previous = carton.items[variantId] ?? emptyCell();
    const items = { ...carton.items, [variantId]: { ...previous, ...patch } };
    let used = carton.usedProductIds;
    if ((patch.quantity ?? 0) > 0 && carton.activeProductId && !used.includes(carton.activeProductId)) {
      used = [...used, carton.activeProductId];
    }
    onPatch({ items, usedProductIds: used });
  };

  // Mode brouillon : montant déclaré par carton, sans modèle ni pointures.
  if (draft) {
    return (
      <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm font-bold text-slate-900">Carton {index + 1}</Text>
          <View className="flex-row items-center gap-3">
            <Text className="text-xs text-slate-400">{formatMoney(carton.amount)}</Text>
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

        <View className="gap-1.5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Montant déclaré (Ar)
          </Text>
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
            Sans pointures : le détail se saisira à la réception.
          </Text>
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

  return (
    <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-bold text-slate-900">
          Carton {index + 1}
          {carton.usedProductIds.length > 1 ? ` · ${carton.usedProductIds.length} modèles` : ''}
        </Text>
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

      <View>
        <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Modèle
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
              const used = carton.usedProductIds.includes(product.id);
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
                  {used && !active ? (
                    <View className="h-1.5 w-1.5 rounded-full bg-brand" />
                  ) : null}
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

      {!carton.activeProductId ? (
        <View className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4">
          <Text className="text-sm text-slate-500">
            Choisissez un modèle ci-dessus — ou créez-le avec la recherche.
          </Text>
        </View>
      ) : productQuery.isPending ? (
        <ActivityIndicator color="#208AEF" />
      ) : (
        <SizeGrid
          clipboard={clipboard}
          onCellChange={changeCell}
          onCopy={(variantId) =>
            setClipboard({ variantId, unitCost: carton.items[variantId]?.unitCost ?? 0 })
          }
          onPaste={(variantId) => {
            if (clipboard) changeCell(variantId, { unitCost: clipboard.unitCost });
          }}
          values={carton.items}
          variants={variants}
        />
      )}

      <View className="flex-row flex-wrap items-center gap-2">
        <Pressable
          className="flex-row items-center gap-1.5 rounded-lg bg-brand/10 px-3 py-2"
          onPress={() => setBulkOpen(true)}>
          <Ionicons color="#208AEF" name="layers-outline" size={15} />
          <Text className="text-sm font-medium text-brand">Appliquer le prix…</Text>
        </Pressable>

        {clipboard ? (
          <Pressable
            className="flex-row items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2"
            onPress={() => setClipboard(null)}>
            <Text className="text-xs text-slate-600">
              {formatMoney(clipboard.unitCost)} copié — coller, ou effacer
            </Text>
            <Ionicons color="#64748B" name="close" size={14} />
          </Pressable>
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

      <PriceBulkModal
        onClose={() => setBulkOpen(false)}
        onApply={(variantIds, unitCost) => {
          const items = { ...carton.items };
          for (const variantId of variantIds) {
            items[variantId] = { ...(items[variantId] ?? emptyCell()), unitCost };
          }
          onPatch({ items });
        }}
        quantities={Object.fromEntries(
          Object.entries(carton.items).map(([variantId, cell]) => [variantId, cell.quantity]),
        )}
        variants={variants}
        visible={bulkOpen}
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

export default function NewArrivalScreen() {
  const suppliers = useSuppliers();
  const products = useProducts();
  const methods = usePaymentMethods();
  const createArrival = useCreateArrival();
  const createDraft = useCreateArrivalDraft();
  const receiveArrival = useReceiveArrival();

  // Ventilation : ouverte depuis un brouillon (`arrivals/[id]` → `?draftId=`).
  const params = useLocalSearchParams<{ draftId?: string }>();
  const draftId = pick(params.draftId) || null;
  const receiving = draftId !== null;
  const draftArrival = useArrival(receiving ? draftId : null);
  const loadedDraftId = useRef<string | null>(null);

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
      cartons: [
        { reference: '', activeProductId: '', usedProductIds: [], items: {}, amount: 0 },
      ],
      draft: false,
      payment: { enabled: false, amount: 0, method: undefined },
      funding: { enabled: false, source: 'OWN_CAPITAL', amount: 0, notes: '' },
    },
    mode: 'onSubmit',
  });

  const { append, remove, fields } = useFieldArray({ control, name: 'cartons' });

  // Brouillon de saisie : reposé à l'ouverture, sauvegardé à chaque frappe.
  // En ventilation, la saisie suit le brouillon du serveur, pas la saisie locale.
  useEffect(() => {
    if (receiving) return;
    const saved = useArrivalDraft.getState().values;
    if (saved) reset(saved);
  }, [reset, receiving]);

  useEffect(() => {
    if (receiving) return;
    const subscription = watch((values) => {
      if (values) useArrivalDraft.getState().save(values as ArrivalFormValues);
    });
    return () => subscription.unsubscribe();
  }, [watch, receiving]);

  // Pré-remplissage du formulaire depuis le brouillon à ventiler.
  useEffect(() => {
    const draft = draftArrival.data;
    if (!draft || loadedDraftId.current === draft.id) return;
    loadedDraftId.current = draft.id;
    reset({
      supplierId: draft.supplier.id,
      date: todayISO(new Date(draft.date)),
      notes: draft.notes ?? '',
      draft: false,
      cartons: draft.cartons.map((carton) => ({
        reference: carton.reference,
        notes: carton.notes ?? '',
        amount: Math.round(Number(carton.totalCost)),
        activeProductId: products.data?.[0]?.id ?? '',
        usedProductIds: [],
        items: {},
      })),
      payment: { enabled: false, amount: 0, method: undefined },
      funding: { enabled: false, source: 'OWN_CAPITAL', amount: 0, notes: '' },
    });
  }, [draftArrival.data, reset, products.data]);

  // Brouillon injoignable (déjà ventilé/annulé) : on bloque la soumission.
  useEffect(() => {
    if (receiving && draftArrival.isError) setSubmitError(apiMessage(draftArrival.error));
  }, [receiving, draftArrival.isError, draftArrival.error]);

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
  const draftMode = values.draft && !receiving;
  const pending =
    isSubmitting ||
    createArrival.isPending ||
    createDraft.isPending ||
    receiveArrival.isPending ||
    (receiving && draftArrival.isPending);

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

  const toggleDraft = () => {
    const next = !values.draft;
    setValue('draft', next);
    if (next) {
      setValue('payment.enabled', false);
      setValue('funding.enabled', false);
    }
  };

  const onSubmit = handleSubmit(async (formValues) => {
    setSubmitError(null);
    try {
      if (receiving && draftId) {
        const created = await receiveArrival.mutateAsync({
          id: draftId,
          body: buildArrivalPayload(formValues),
        });
        useArrivalDraft.getState().clear();
        Alert.alert(
          'Brouillon ventilé',
          `${created.reference}\n${created.totalQty} pièce(s) — ${formatMoney(created.totalCost)}`,
          [{ text: 'OK', onPress: () => router.back() }],
        );
        return;
      }

      if (formValues.draft) {
        const created = await createDraft.mutateAsync(buildDraftPayload(formValues));
        useArrivalDraft.getState().clear();
        Alert.alert(
          'Brouillon enregistré',
          `${created.reference}\n${formValues.cartons.length} carton(s) — à ventiler depuis les arrivages`,
          [{ text: 'OK', onPress: () => router.back() }],
        );
        return;
      }

      const created = await createArrival.mutateAsync(buildArrivalPayload(formValues));
      useArrivalDraft.getState().clear();
      Alert.alert(
        'Arrivage enregistré',
        `${created.reference}\n${created.totalQty} pièce(s) — ${formatMoney(created.totalCost)}`,
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

          {!receiving ? (
            <Pressable
              className="flex-row items-center justify-between border-t border-slate-100 pt-3"
              onPress={toggleDraft}>
              <View className="flex-1 pr-3">
                <Text className="text-sm font-semibold text-slate-900">Brouillon (à ventiler)</Text>
                <Text className="text-xs text-slate-500">
                  Montant par carton, sans pointures — ni stock ni dette avant réception
                </Text>
              </View>
              <Ionicons
                color={values.draft ? '#16A34A' : '#CBD5E1'}
                name={values.draft ? 'checkbox-outline' : 'square-outline'}
                size={24}
              />
            </Pressable>
          ) : null}
        </View>

        <View className="gap-3">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {draftMode
              ? 'Cartons — montant déclaré par carton'
              : 'Cartons — quantité et prix d\'achat par pointure'}
          </Text>

          {fields.map((field, index) => {
            const carton = values.cartons[index];
            if (!carton) return null;
            return (
              <CartonCard
                carton={carton}
                draft={draftMode}
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
            onPress={() =>
              append({
                reference: '',
                activeProductId: products.data?.[0]?.id ?? '',
                usedProductIds: [],
                items: {},
                amount: 0,
              })
            }>
            <Ionicons color="#208AEF" name="add" size={18} />
            <Text className="font-semibold text-brand">Ajouter un carton</Text>
          </Pressable>
        </View>

        {draftMode ? null : (
        <View className="gap-3 rounded-2xl border border-slate-200 bg-white p-4">
          <Pressable className="flex-row items-center justify-between" onPress={togglePayment}>
            <View className="flex-1 pr-3">
              <Text className="text-sm font-semibold text-slate-900">Réglé au fournisseur</Text>
              <Text className="text-xs text-slate-500">
                Paiement partiel ou total encaissé à la réception
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
                  Total de l&apos;arrivage : {formatMoney(totals.cost)}
                </Text>
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
        )}
      </ScrollView>

      <View className="gap-3 border-t border-slate-200 bg-white px-4 py-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-sm text-slate-500">
            {draftMode
              ? `${values.cartons.length} carton(s) — brouillon`
              : `${totals.quantity} pièce(s) · ${values.cartons.length} carton(s)`}
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
            <Text className="text-base font-semibold text-white">
              {receiving
                ? 'Ventiler et réceptionner'
                : draftMode
                  ? 'Enregistrer le brouillon'
                  : 'Enregistrer l\'arrivage'}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
