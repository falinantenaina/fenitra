import { zodResolver } from '@hookform/resolvers/zod';
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

import { ErrorPanel } from '@/components/error-panel';
import { FieldError } from '@/components/field';
import { SizePicker } from '@/components/size-picker';
import { toast } from '@/components/toast';
import { apiMessage } from '@/lib/api';
import {
  useCreateProduct,
  useCreateSize,
  useCreateVariantsBulk,
  useDeleteSize,
  useProduct,
  useProductList,
  useSizeList,
  useUpdateProduct,
  useUpdateVariant,
} from '@/lib/queries';
import {
  buildProductPayload,
  buildProductUpdatePayload,
  buildSizePayload,
  productFormSchema,
  sizeFormSchema,
  type ProductFormValues,
  type SizeFormValues,
} from '@/lib/settings';
import type { ProductListItem, SizeListItem, VariantItem } from '@/lib/types';
import { useAuth } from '@/store/auth';

const inputClass =
  'h-11 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900';

/* ════════════ Pointure (création) ════════════ */

function SizeForm({ onDone }: { onDone: () => void }) {
  const createSize = useCreateSize();
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SizeFormValues>({
    resolver: zodResolver(sizeFormSchema),
    mode: 'onSubmit',
    defaultValues: { label: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createSize.mutateAsync(buildSizePayload(values));
      onDone();
      toast.success(
        'Pointure créée',
        values.label?.trim() ? `${values.value} — ${values.label}` : `${values.value}`,
      );
    } catch (error) {
      toast.error('Pointure refusée', apiMessage(error));
    }
  });

  return (
    <View className="gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Nouvelle pointure
      </Text>
      <Controller
        control={control}
        name="value"
        render={({ field }) => (
          <TextInput
            className={inputClass}
            keyboardType="numeric"
            onChangeText={(raw) => {
              const digits = raw.replace(/[^0-9]/g, '');
              field.onChange(digits === '' ? undefined : Number(digits));
            }}
            placeholder="Taille (ex. 38)"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value === undefined || Number.isNaN(field.value) ? '' : String(field.value)}
          />
        )}
      />
      <FieldError message={errors.value?.message} />
      <Controller
        control={control}
        name="label"
        render={({ field }) => (
          <TextInput
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Libellé (optionnel)"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value ?? ''}
          />
        )}
      />
      <FieldError message={errors.label?.message} />
      <View className="flex-row gap-2">
        <Pressable
          className={`h-10 flex-1 items-center justify-center rounded-xl ${
            createSize.isPending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={createSize.isPending}
          onPress={() => void onSubmit()}>
          {createSize.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Ajouter</Text>
          )}
        </Pressable>
        <Pressable
          className="h-10 items-center justify-center rounded-xl bg-slate-100 px-4"
          onPress={onDone}>
          <Text className="font-medium text-slate-600">Fermer</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ════════════ Produit (création / édition) ════════════ */

function ProductForm({
  product,
  onDone,
}: {
  product: ProductListItem | null;
  onDone: () => void;
}) {
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    mode: 'onSubmit',
    defaultValues: {
      name: product?.name ?? '',
      description: product?.description ?? '',
    },
  });

  const pending = createProduct.isPending || updateProduct.isPending;

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (product) {
        await updateProduct.mutateAsync({
          id: product.id,
          body: buildProductUpdatePayload(values),
        });
      } else {
        await createProduct.mutateAsync(buildProductPayload(values));
      }
      onDone();
      toast.success(product ? 'Produit modifié' : 'Produit créé', values.name);
    } catch (error) {
      toast.error('Produit refusé', apiMessage(error));
    }
  });

  const toggleActive = async () => {
    if (!product) return;
    try {
      await updateProduct.mutateAsync({ id: product.id, body: { active: !product.active } });
    } catch (error) {
      toast.error('Produit refusé', apiMessage(error));
    }
  };

  return (
    <View className="gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-sky-800">
        {product ? 'Modifier le produit' : 'Nouveau produit'}
      </Text>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextInput
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Nom du modèle"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.name?.message} />
      <Controller
        control={control}
        name="description"
        render={({ field }) => (
          <TextInput
            className={`${inputClass} py-2`}
            multiline
            onChangeText={field.onChange}
            placeholder="Description (optionnel)"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value ?? ''}
          />
        )}
      />
      <FieldError message={errors.description?.message} />
      <View className="flex-row gap-2">
        <Pressable
          className={`h-10 flex-1 items-center justify-center rounded-xl ${
            pending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={pending}
          onPress={() => void onSubmit()}>
          {pending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">
              {product ? 'Enregistrer' : 'Créer'}
            </Text>
          )}
        </Pressable>
        {product ? (
          <Pressable
            className={`h-10 items-center justify-center rounded-xl px-4 ${
              product.active ? 'bg-red-50' : 'bg-emerald-50'
            }`}
            disabled={updateProduct.isPending}
            onPress={() => void toggleActive()}>
            <Text className={`font-medium ${product.active ? 'text-red-600' : 'text-emerald-700'}`}>
              {product.active ? 'Désactiver' : 'Réactiver'}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          className="h-10 items-center justify-center rounded-xl bg-slate-100 px-4"
          onPress={onDone}>
          <Text className="font-medium text-slate-600">Fermer</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ════════════ Pointures d'un modèle ════════════ */

/**
 * §12 : chaque modèle porte **ses** propres pointures. Ce panneau les liste
 * (ajout via `SizePicker`, masquage = `active: false`, prix de vente saisi
 * par pointure).
 */
function ProductSizesPanel({ productId, canManage }: { productId: string; canManage: boolean }) {
  const product = useProduct(productId);
  const addSizes = useCreateVariantsBulk();
  const updateVariant = useUpdateVariant();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const variants = product.data?.variants ?? [];
  const pending = addSizes.isPending || updateVariant.isPending;

  const displayPrice = (variant: VariantItem) =>
    drafts[variant.id] ?? (Number(variant.sellingPrice) ? String(Number(variant.sellingPrice)) : '');

  const clearDraft = (id: string) =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

  const savePrice = (variant: VariantItem) => {
    const digits = displayPrice(variant).replace(/[^0-9]/g, '');
    const value = Number(digits);
    if (!digits || Number.isNaN(value) || value === Number(variant.sellingPrice)) {
      clearDraft(variant.id);
      return;
    }
    updateVariant.mutate(
      { id: variant.id, body: { sellingPrice: value } },
      {
        onSuccess: () => clearDraft(variant.id),
        onError: (error) => toast.error('Pointure refusée', apiMessage(error)),
      },
    );
  };

  const toggleVariant = (variant: VariantItem) => {
    updateVariant.mutate(
      { id: variant.id, body: { active: !variant.active } },
      { onError: (error) => toast.error('Pointure refusée', apiMessage(error)) },
    );
  };

  const addPointures = async (values: number[]) => {
    await addSizes.mutateAsync({ productId, sizeValues: values });
    setPickerOpen(false);
    toast.success('Pointures ajoutées', values.join(', '));
  };

  return (
    <View className="gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Pointures du modèle ({variants.length})
        </Text>
        {canManage ? (
          <Pressable
            className="h-8 items-center justify-center rounded-lg bg-slate-100 px-3"
            disabled={pending}
            onPress={() => setPickerOpen((open) => !open)}>
            <Text className="text-sm font-medium text-slate-700">
              {pickerOpen ? 'Fermer' : 'Ajouter'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {product.isPending ? (
        <ActivityIndicator color="#208AEF" />
      ) : variants.length === 0 ? (
        <Text className="text-sm text-slate-400">
          Aucune pointure sur ce modèle — ajoutez celles que vous vendez.
        </Text>
      ) : null}

      {variants.map((variant) => (
        <View
          className="flex-row items-center gap-2 border-t border-slate-100 py-2"
          key={variant.id}>
          <Text
            className={`w-10 text-sm font-semibold ${
              variant.active ? 'text-slate-800' : 'text-slate-400 line-through'
            }`}>
            {variant.size.value}
          </Text>
          <TextInput
            className="h-9 flex-1 rounded-lg border border-slate-200 px-2 text-sm text-slate-800"
            editable={canManage && !pending}
            keyboardType="numeric"
            onChangeText={(text) => setDrafts((current) => ({ ...current, [variant.id]: text }))}
            onEndEditing={() => savePrice(variant)}
            placeholder="Prix de vente"
            placeholderTextColor="#94A3B8"
            returnKeyType="done"
            selectionColor="#208AEF"
            value={displayPrice(variant)}
          />
          {canManage ? (
            <Pressable
              className={`h-9 items-center justify-center rounded-lg px-3 ${
                variant.active ? 'bg-red-50' : 'bg-emerald-50'
              }`}
              disabled={pending}
              onPress={() => toggleVariant(variant)}>
              <Text className={`text-sm font-medium ${variant.active ? 'text-red-600' : 'text-emerald-700'}`}>
                {variant.active ? 'Masquer' : 'Afficher'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}

      {pickerOpen && canManage ? (
        <SizePicker
          onCancel={() => setPickerOpen(false)}
          onAdd={addPointures}
          takenValues={variants.filter((variant) => variant.active).map((v) => v.size.value)}
          title="Pointures à ajouter"
        />
      ) : null}
    </View>
  );
}

/* ════════════ Écran ════════════ */

export default function CatalogueSettingsScreen() {
  const role = useAuth((state) => state.user?.role);
  const canManage = role === 'ADMIN' || role === 'MANAGER';

  const [term, setTerm] = useState('');
  const [showNewSize, setShowNewSize] = useState(false);
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedSizeId, setSelectedSizeId] = useState<string | null>(null);

  const products = useProductList(term);
  const sizes = useSizeList();
  const deleteSize = useDeleteSize();

  const productItems = products.data?.items ?? [];
  const sizeItems = sizes.data?.items ?? [];
  const selectedProduct =
    productItems.find((p) => p.id === selectedProductId) ?? null;

  const confirmDeleteSize = (size: SizeListItem) => {
    Alert.alert(
      'Supprimer la pointure',
      `Pointure ${size.value}${size.label ? ` (${size.label})` : ''} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            deleteSize.mutate(size.id, {
              onError: (error) => toast.error('Suppression refusée', apiMessage(error)),
            });
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled">
      {/* ── Pointures ── */}
      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Valeurs de pointures ({sizeItems.length})
          </Text>
          {canManage ? (
            <Pressable
              className="h-8 items-center justify-center rounded-lg bg-slate-100 px-3"
              onPress={() => setShowNewSize((v) => !v)}>
              <Text className="text-sm font-medium text-slate-700">
                {showNewSize ? 'Fermer' : 'Ajouter'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <Text className="text-xs text-slate-400">
          Dictionnaire des valeurs proposées par les sélecteurs — les pointures d&apos;un modèle
          se gèrent sur le modèle, dans la section Produits.
        </Text>

        {showNewSize && canManage ? <SizeForm onDone={() => setShowNewSize(false)} /> : null}

        <View className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {sizes.isPending ? (
            <ActivityIndicator className="py-4" color="#208AEF" />
          ) : sizes.isError ? (
            <ErrorPanel
              isRetrying={sizes.isRefetching}
              message="Impossible de charger les pointures."
              onRetry={() => void sizes.refetch()}
            />
          ) : sizeItems.length === 0 ? (
            <Text className="px-3 py-4 text-sm text-slate-400">Aucune pointure.</Text>
          ) : (
            sizeItems.map((size) => {
              const selected = size.id === selectedSizeId;
              return (
                <View key={size.id} className="border-b border-slate-100 last:border-b-0">
                  <Pressable
                    className="flex-row items-center justify-between px-3 py-3"
                    onPress={() => setSelectedSizeId(selected ? null : size.id)}>
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-slate-800">
                        Pointure {size.value}
                      </Text>
                      <Text className="text-xs text-slate-400">{size.label ?? '—'}</Text>
                    </View>
                    {canManage && selected && deleteSize.isPending ? (
                      <ActivityIndicator color="#208AEF" size="small" />
                    ) : (
                      <Text className="text-xs text-slate-400">{selected ? 'Sélectionnée' : ''}</Text>
                    )}
                  </Pressable>
                  {selected && canManage ? (
                    <View className="border-t border-slate-100 bg-slate-50 px-3 py-3">
                      <Pressable
                        className="h-9 items-center justify-center rounded-lg border border-red-200 bg-red-50"
                        onPress={() => confirmDeleteSize(size)}>
                        <Text className="text-sm font-medium text-red-600">
                          Supprimer la pointure
                        </Text>
                      </Pressable>
                      <Text className="mt-2 text-xs text-slate-400">
                        Refusé (409) si une variante l’utilise déjà.
                      </Text>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </View>

      {/* ── Produits ── */}
      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Produits ({productItems.length})
          </Text>
          {canManage ? (
            <Pressable
              className="h-8 items-center justify-center rounded-lg bg-slate-100 px-3"
              onPress={() => {
                setSelectedProductId(null);
                setShowNewProduct((v) => !v);
              }}>
              <Text className="text-sm font-medium text-slate-700">
                {showNewProduct ? 'Fermer' : 'Nouveau'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <TextInput
          className={inputClass}
          onChangeText={setTerm}
          placeholder="Rechercher un modèle…"
          placeholderTextColor="#94A3B8"
          selectionColor="#208AEF"
          value={term}
        />

        {showNewProduct && canManage ? (
          <ProductForm onDone={() => setShowNewProduct(false)} product={null} />
        ) : null}
        {selectedProduct && canManage ? (
          <ProductForm
            key={selectedProduct.id}
            onDone={() => setSelectedProductId(null)}
            product={selectedProduct}
          />
        ) : null}
        {selectedProduct ? (
          <ProductSizesPanel canManage={canManage} productId={selectedProduct.id} />
        ) : null}

        <View className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {products.isPending ? (
            <ActivityIndicator className="py-4" color="#208AEF" />
          ) : products.isError ? (
            <ErrorPanel
              isRetrying={products.isRefetching}
              message="Impossible de charger les produits."
              onRetry={() => void products.refetch()}
            />
          ) : productItems.length === 0 ? (
            <Text className="px-3 py-4 text-sm text-slate-400">Aucun produit.</Text>
          ) : (
            productItems.map((product) => {
              const selected = product.id === selectedProductId;
              return (
                <Pressable
                  key={product.id}
                  className={`flex-row items-center justify-between border-b border-slate-100 px-3 py-3 last:border-b-0 ${
                    selected ? 'bg-sky-50' : ''
                  }`}
                  onPress={() => {
                    setShowNewProduct(false);
                    setSelectedProductId(selected ? null : product.id);
                  }}>
                  <View className="flex-1 pr-2">
                    <Text className="text-sm font-semibold text-slate-800" numberOfLines={1}>
                      {product.name}
                    </Text>
                    <Text className="text-xs text-slate-400">
                      {product.variantsCount} pointure(s)
                      {product.description ? ` · ${product.description}` : ''}
                    </Text>
                  </View>
                  {!product.active ? (
                    <Text className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      Inactif
                    </Text>
                  ) : null}
                </Pressable>
              );
            })
          )}
        </View>
      </View>
    </ScrollView>
  );
}
