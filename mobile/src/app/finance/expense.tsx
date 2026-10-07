import { zodResolver } from '@hookform/resolvers/zod';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
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

import { CancelPanel } from '@/components/cancel-panel';
import { Chip } from '@/components/chip';
import { ErrorPanel } from '@/components/error-panel';
import { SelectField } from '@/components/select-field';
import { toast } from '@/components/toast';
import { apiMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  buildExpensePayload,
  expenseFormSchema,
  todayISO,
  type ExpenseFormValues,
} from '@/lib/finance';
import { pick } from '@/lib/params';
import {
  useCreateCategory,
  useCreateExpense,
  useDeleteExpense,
  useExpense,
  useExpenseCategories,
  usePaymentMethods,
  useUpdateCategory,
  useUpdateExpense,
} from '@/lib/queries';

export default function ExpenseScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = pick(params.id) || null;
  const expense = useExpense(editId);
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const categories = useExpenseCategories();
  const methods = usePaymentMethods();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const deleteExpense = useDeleteExpense();
  const [notice, setNotice] = useState<string | null>(null);

  const loaded = expense.data;
  // Mode correction : la dépense chargée pilote le formulaire (`values` de
  // react-hook-form) — pas d'effet, l'identité ne change qu'à la charge.
  const formValues = useMemo<ExpenseFormValues | undefined>(
    () =>
      loaded
        ? {
            categoryId: loaded.categoryId,
            amount: Number(loaded.amount),
            date: String(loaded.date).slice(0, 10),
            description: loaded.description,
            notes: loaded.notes ?? '',
            method: loaded.method ?? undefined,
          }
        : undefined,
    [loaded],
  );

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    mode: 'onSubmit',
    defaultValues: { categoryId: '', amount: 0, date: todayISO(), description: '', notes: '' },
    values: formValues,
  });

  const onSubmit = handleSubmit(async (values) => {
    const payload = buildExpensePayload(values);
    try {
      if (editId) {
        await updateExpense.mutateAsync({ id: editId, body: payload });
        toast.success('Dépense corrigée', formatMoney(values.amount));
      } else {
        const created = await createExpense.mutateAsync(payload);
        toast.success('Dépense enregistrée', formatMoney(created.amount));
      }
      router.back();
    } catch (error) {
      toast.error(editId ? 'Correction refusée' : 'Dépense refusée', apiMessage(error));
    }
  });

  const onDelete = async (reason: string) => {
    if (!editId) return;
    try {
      await deleteExpense.mutateAsync({ id: editId, reason });
      toast.success('Dépense supprimée', 'Écriture contre-passée, caisse recréditée.');
      router.back();
    } catch (error) {
      toast.error('Suppression refusée', apiMessage(error));
    }
  };

  const categoryId = useWatch({ control, name: 'categoryId' });
  const method = useWatch({ control, name: 'method' });
  const knownTitles = categories.data ?? [];

  const createTitle = async (term: string) => {
    try {
      const category = await createCategory.mutateAsync({ name: term });
      setValue('categoryId', category.id, { shouldValidate: true });
      setNotice(`Titre « ${category.name} » créé et sélectionné.`);
    } catch (error) {
      toast.error('Titre refusé', apiMessage(error));
    }
  };

  const renameTitle = async (name: string) => {
    if (!categoryId) return;
    try {
      await updateCategory.mutateAsync({ id: categoryId, body: { name } });
      setNotice(`Titre renommé « ${name} ».`);
    } catch (error) {
      toast.error('Renommage refusé', apiMessage(error));
    }
  };

  if (editId && expense.isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50">
        <ActivityIndicator color="#208AEF" />
      </View>
    );
  }

  if (editId && expense.isError) {
    return (
      <View className="flex-1 gap-4 bg-slate-50 px-4 pt-4">
        <ErrorPanel
          isRetrying={expense.isRefetching}
          message="Impossible de charger cette dépense."
          onRetry={() => void expense.refetch()}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: editId ? 'Modifier la dépense' : 'Nouvelle dépense' }} />
      <ScrollView className="flex-1 px-4 pb-32 pt-4" keyboardShouldPersistTaps="handled">
        <View className="gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
          <Text className="text-xs text-sky-800">
            {editId
              ? 'Correction : la caisse est ajustée par contre-passation puis nouvelle écriture, le journal garde la trace.'
              : 'Une dépense est toujours réglée : la caisse diminue immédiatement du montant saisi.'}
          </Text>
        </View>

        {/* Titre (recherche ou création — remplace la catégorie) */}
        <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Titre
        </Text>
        <View className="mt-2">
          <SelectField
            createPending={createCategory.isPending}
            emptyText="Aucun titre trouvé."
            error={errors.categoryId?.message ?? null}
            hint={notice}
            loading={categories.isPending}
            options={knownTitles.map((category) => ({ id: category.id, label: category.name }))}
            placeholder="Rechercher ou créer un titre…"
            renameTitle="Renommer le titre"
            title="Titre"
            value={categoryId}
            valueLabel={knownTitles.find((category) => category.id === categoryId)?.name}
            onCreate={createTitle}
            onRename={renameTitle}
            onSelect={(id) => {
              setValue('categoryId', id, { shouldValidate: true });
              setNotice(null);
            }}
          />
        </View>

        {/* Montant */}
        <View className="mt-5 gap-1.5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Montant (Ar)
          </Text>
          <Controller
            control={control}
            name="amount"
            render={({ field }) => (
              <TextInput
                className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-right text-base text-slate-900"
                keyboardType="numeric"
                onChangeText={(raw) => {
                  const digits = raw.replace(/[^0-9]/g, '');
                  field.onChange(digits === '' ? 0 : Number(digits));
                }}
                placeholder="0"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={field.value ? String(field.value) : ''}
              />
            )}
          />
          {errors.amount ? (
            <Text className="text-xs text-red-600">{errors.amount.message}</Text>
          ) : null}
        </View>

        {/* Description */}
        <View className="mt-5 gap-1.5">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Description (facultatif)
          </Text>
          <Controller
            control={control}
            name="description"
            render={({ field }) => (
              <TextInput
                className="min-h-[48px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
                onChangeText={field.onChange}
                placeholder="Carburant, réparation, snack…"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={field.value ?? ''}
              />
            )}
          />
          {errors.description ? (
            <Text className="text-xs text-red-600">{errors.description.message}</Text>
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
        {errors.date ? (
          <Text className="mt-1 text-xs text-red-600">{errors.date.message}</Text>
        ) : null}

        {/* Mode de paiement */}
        <Text className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Mode de paiement
        </Text>
        <ScrollView
          className="mt-2"
          contentContainerStyle={{ gap: 8 }}
          horizontal
          showsHorizontalScrollIndicator={false}>
          <Chip label="Sans mode" selected={!method} onPress={() => setValue('method', undefined)} />
          {(methods.data ?? []).map((item) => (
            <Chip
              key={item.id}
              label={item.name}
              selected={method === item.name}
              onPress={() => setValue('method', item.name)}
            />
          ))}
        </ScrollView>

        {/* Suppression (mode correction) */}
        {editId ? (
          <View className="mt-6">
            <CancelPanel
              hint="La suppression contre-passe l'écriture de cette dépense : la caisse est recréditée du montant saisi."
              isPending={deleteExpense.isPending}
              label="Supprimer la dépense"
              onConfirm={(reason) => void onDelete(reason)}
            />
          </View>
        ) : null}
      </ScrollView>

      <View className="border-t border-slate-200 bg-white px-4 pb-6 pt-3">
        <Pressable
          className={`h-11 items-center justify-center rounded-xl ${
            createExpense.isPending || updateExpense.isPending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={createExpense.isPending || updateExpense.isPending}
          onPress={() => void onSubmit()}>
          {createExpense.isPending || updateExpense.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">
              {editId ? 'Enregistrer les modifications' : 'Enregistrer'}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
