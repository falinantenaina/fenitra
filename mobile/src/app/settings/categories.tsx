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

import { apiMessage } from '@/lib/api';
import {
  useCreateCategory,
  useCreateMethod,
  useExpenseCategoryList,
  usePaymentMethodList,
  useUpdateCategory,
  useUpdateMethod,
} from '@/lib/queries';
import {
  buildCategoryPayload,
  buildCategoryUpdatePayload,
  buildMethodPayload,
  categoryFormSchema,
  methodFormSchema,
  type CategoryFormValues,
  type MethodFormValues,
} from '@/lib/settings';
import type { ExpenseCategory, PaymentMethod } from '@/lib/types';
import { useAuth } from '@/store/auth';

const inputClass =
  'h-11 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900';

function FieldError({ message }: { message?: string }) {
  return message ? <Text className="mt-1 text-xs text-red-600">{message}</Text> : null;
}

function SectionTitle({ count, title }: { count: number; title: string }) {
  return (
    <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
      {title} ({count})
    </Text>
  );
}

function Badge({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <Text
      className={`rounded-full px-2 py-0.5 text-xs ${
        muted ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'
      }`}>
      {label}
    </Text>
  );
}

/* ════════════ Catégorie de dépense ════════════ */

function CategoryForm({
  category,
  onDone,
}: {
  category: ExpenseCategory | null;
  onDone: () => void;
}) {
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    mode: 'onSubmit',
    defaultValues: { name: category?.name ?? '' },
  });

  const pending = createCategory.isPending || updateCategory.isPending;

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (category) {
        await updateCategory.mutateAsync({
          id: category.id,
          body: buildCategoryUpdatePayload(values),
        });
      } else {
        await createCategory.mutateAsync(buildCategoryPayload(values));
      }
      onDone();
    } catch (error) {
      Alert.alert('Catégorie refusée', apiMessage(error));
    }
  });

  const toggleActive = async () => {
    if (!category) return;
    try {
      await updateCategory.mutateAsync({ id: category.id, body: { active: !category.active } });
    } catch (error) {
      Alert.alert('Catégorie refusée', apiMessage(error));
    }
  };

  return (
    <View className="gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-sky-800">
        {category ? 'Modifier la catégorie' : 'Nouvelle catégorie'}
      </Text>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextInput
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Nom de la catégorie"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.name?.message} />
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
              {category ? 'Enregistrer' : 'Créer'}
            </Text>
          )}
        </Pressable>
        {category ? (
          <Pressable
            className={`h-10 items-center justify-center rounded-xl px-4 ${
              category.active ? 'bg-red-50' : 'bg-emerald-50'
            }`}
            disabled={updateCategory.isPending}
            onPress={() => void toggleActive()}>
            <Text
              className={`font-medium ${category.active ? 'text-red-600' : 'text-emerald-700'}`}>
              {category.active ? 'Désactiver' : 'Réactiver'}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          className="h-10 items-center justify-center rounded-xl bg-slate-100 px-4"
          onPress={onDone}>
          <Text className="font-medium text-slate-600">Fermer</Text>
        </Pressable>
      </View>
      {category ? (
        <Text className="text-xs text-slate-500">
          Une catégorie n’est jamais supprimée : la désactivation la retire des listes de saisie.
        </Text>
      ) : null}
    </View>
  );
}

/* ════════════ Mode de paiement ════════════ */

function MethodForm({ onDone }: { onDone: () => void }) {
  const createMethod = useCreateMethod();
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<MethodFormValues>({
    resolver: zodResolver(methodFormSchema),
    mode: 'onSubmit',
    defaultValues: { name: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createMethod.mutateAsync(buildMethodPayload(values));
      onDone();
    } catch (error) {
      Alert.alert('Mode de paiement refusé', apiMessage(error));
    }
  });

  return (
    <View className="gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-sky-800">
        Nouveau mode de paiement
      </Text>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextInput
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Nom (ex. Espèces)"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.name?.message} />
      <View className="flex-row gap-2">
        <Pressable
          className={`h-10 flex-1 items-center justify-center rounded-xl ${
            createMethod.isPending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={createMethod.isPending}
          onPress={() => void onSubmit()}>
          {createMethod.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Créer</Text>
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

/* ════════════ Écran ════════════ */

export default function CategoriesSettingsScreen() {
  const role = useAuth((state) => state.user?.role);
  const canManage = role === 'ADMIN' || role === 'MANAGER';

  const categories = useExpenseCategoryList();
  const methods = usePaymentMethodList();
  const updateMethod = useUpdateMethod();

  const [showNewCategory, setShowNewCategory] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [showNewMethod, setShowNewMethod] = useState(false);
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);

  const categoryItems = categories.data ?? [];
  const methodItems = methods.data ?? [];
  const selectedCategory = categoryItems.find((c) => c.id === selectedCategoryId) ?? null;
  const selectedMethod = methodItems.find((m) => m.id === selectedMethodId) ?? null;

  const toggleMethod = async (method: PaymentMethod) => {
    try {
      await updateMethod.mutateAsync({ id: method.id, body: { active: !method.active } });
    } catch (error) {
      Alert.alert('Mode de paiement refusé', apiMessage(error));
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled">
      {/* ── Catégories de dépenses ── */}
      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <SectionTitle count={categoryItems.length} title="Catégories de dépenses" />
          {canManage ? (
            <Pressable
              className="h-8 items-center justify-center rounded-lg bg-slate-100 px-3"
              onPress={() => {
                setSelectedCategoryId(null);
                setShowNewCategory((v) => !v);
              }}>
              <Text className="text-sm font-medium text-slate-700">
                {showNewCategory ? 'Fermer' : 'Ajouter'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {showNewCategory && canManage ? (
          <CategoryForm onDone={() => setShowNewCategory(false)} category={null} />
        ) : null}
        {selectedCategory && canManage ? (
          <CategoryForm
            key={selectedCategory.id}
            onDone={() => setSelectedCategoryId(null)}
            category={selectedCategory}
          />
        ) : null}

        <View className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {categories.isPending ? (
            <ActivityIndicator className="py-4" color="#208AEF" />
          ) : categoryItems.length === 0 ? (
            <Text className="px-3 py-4 text-sm text-slate-400">Aucune catégorie.</Text>
          ) : (
            categoryItems.map((category) => {
              const active = category.id === selectedCategoryId;
              return (
                <Pressable
                  key={category.id}
                  className={`flex-row items-center justify-between border-b border-slate-100 px-3 py-3 last:border-b-0 ${
                    active ? 'bg-sky-50' : ''
                  }`}
                  onPress={() => {
                    setShowNewCategory(false);
                    setSelectedCategoryId(active ? null : category.id);
                  }}>
                  <Text className="flex-1 text-sm font-semibold text-slate-800" numberOfLines={1}>
                    {category.name}
                  </Text>
                  <Badge label={category.active ? 'Active' : 'Inactive'} muted={!category.active} />
                </Pressable>
              );
            })
          )}
        </View>
      </View>

      {/* ── Modes de paiement ── */}
      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <SectionTitle count={methodItems.length} title="Modes de paiement" />
          {canManage ? (
            <Pressable
              className="h-8 items-center justify-center rounded-lg bg-slate-100 px-3"
              onPress={() => {
                setSelectedMethodId(null);
                setShowNewMethod((v) => !v);
              }}>
              <Text className="text-sm font-medium text-slate-700">
                {showNewMethod ? 'Fermer' : 'Ajouter'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {showNewMethod && canManage ? <MethodForm onDone={() => setShowNewMethod(false)} /> : null}
        {selectedMethod && canManage ? (
          <View className="gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
            <Text className="text-xs font-semibold uppercase tracking-wide text-sky-800">
              {selectedMethod.name}
            </Text>
            <View className="flex-row gap-2">
              <Pressable
                className={`h-10 flex-1 items-center justify-center rounded-xl ${
                  selectedMethod.active ? 'bg-red-50' : 'bg-emerald-50'
                }`}
                disabled={updateMethod.isPending}
                onPress={() => void toggleMethod(selectedMethod)}>
                <Text
                  className={`font-medium ${
                    selectedMethod.active ? 'text-red-600' : 'text-emerald-700'
                  }`}>
                  {selectedMethod.active ? 'Désactiver' : 'Réactiver'}
                </Text>
              </Pressable>
              <Pressable
                className="h-10 items-center justify-center rounded-xl bg-slate-100 px-4"
                onPress={() => setSelectedMethodId(null)}>
                <Text className="font-medium text-slate-600">Fermer</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {methods.isPending ? (
            <ActivityIndicator className="py-4" color="#208AEF" />
          ) : methodItems.length === 0 ? (
            <Text className="px-3 py-4 text-sm text-slate-400">Aucun mode de paiement.</Text>
          ) : (
            methodItems.map((method) => {
              const active = method.id === selectedMethodId;
              return (
                <Pressable
                  key={method.id}
                  className={`flex-row items-center justify-between border-b border-slate-100 px-3 py-3 last:border-b-0 ${
                    active ? 'bg-sky-50' : ''
                  }`}
                  onPress={() => {
                    setShowNewMethod(false);
                    setSelectedMethodId(active ? null : method.id);
                  }}>
                  <Text className="flex-1 text-sm font-semibold text-slate-800" numberOfLines={1}>
                    {method.name}
                  </Text>
                  <Badge label={method.active ? 'Actif' : 'Inactif'} muted={!method.active} />
                </Pressable>
              );
            })
          )}
        </View>
      </View>
    </ScrollView>
  );
}
