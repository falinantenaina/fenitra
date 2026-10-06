import { zodResolver } from '@hookform/resolvers/zod';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
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

import { Chip } from '@/components/chip';
import { toast } from '@/components/toast';
import { apiMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  buildExpensePayload,
  expenseFormSchema,
  todayISO,
  type ExpenseFormValues,
} from '@/lib/finance';
import {
  useCreateCategory,
  useCreateExpense,
  useExpenseCategories,
  usePaymentMethods,
} from '@/lib/queries';

export default function NewExpenseScreen() {
  const categories = useExpenseCategories();
  const createCategory = useCreateCategory();
  const methods = usePaymentMethods();
  const createExpense = useCreateExpense();
  const [method, setMethod] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [createdTitle, setCreatedTitle] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseFormSchema),
    mode: 'onSubmit',
    defaultValues: { categoryId: '', amount: 0, date: todayISO(), description: '', notes: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const expense = await createExpense.mutateAsync(
        buildExpensePayload({ ...values, method }),
      );
      toast.success('Dépense enregistrée', formatMoney(expense.amount));
      router.back();
    } catch (error) {
      toast.error('Dépense refusée', apiMessage(error));
    }
  });

  const categoryId = useWatch({ control, name: 'categoryId' });

  const term = search.trim();
  const knownTitles = categories.data ?? [];
  const suggestions = term
    ? knownTitles.filter((item) => item.name.toLowerCase().includes(term.toLowerCase()))
    : knownTitles;
  const titleExists = knownTitles.some((item) => item.name.toLowerCase() === term.toLowerCase());
  const canCreate = term.length > 0 && !titleExists;

  const createTitle = async () => {
    try {
      const category = await createCategory.mutateAsync({ name: term });
      setValue('categoryId', category.id, { shouldValidate: true });
      setSearch('');
      setCreatedTitle(term);
    } catch (error) {
      toast.error('Titre refusé', apiMessage(error));
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView className="flex-1 px-4 pb-32 pt-4" keyboardShouldPersistTaps="handled">
        <View className="gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
          <Text className="text-xs text-sky-800">
            Une dépense est toujours réglée : la caisse diminue immédiatement du montant saisi.
          </Text>
        </View>

        {/* Titre (recherche ou création — remplace la catégorie) */}
        <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Titre
        </Text>
        <View className="mt-2 flex-row items-center gap-2">
          <TextInput
            className="h-11 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900"
            onChangeText={setSearch}
            placeholder="Rechercher ou créer un titre…"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={search}
          />
          {search ? (
            <Pressable
              accessibilityLabel="Effacer la recherche"
              className="h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white"
              onPress={() => setSearch('')}>
              <Ionicons color="#64748B" name="close" size={16} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView
          className="mt-2"
          contentContainerStyle={{ gap: 8 }}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {categories.isPending ? (
            <ActivityIndicator color="#208AEF" />
          ) : suggestions.length === 0 ? (
            <Text className="text-sm text-slate-500">Aucun titre trouvé.</Text>
          ) : (
            suggestions.map((category) => (
              <Chip
                key={category.id}
                label={category.name}
                selected={categoryId === category.id}
                onPress={() => {
                  setValue('categoryId', category.id, { shouldValidate: true });
                  setSearch('');
                  setCreatedTitle(null);
                }}
              />
            ))
          )}
        </ScrollView>
        {canCreate ? (
          <Pressable
            className="mt-2 flex-row items-center gap-1.5 self-start rounded-lg border border-dashed border-brand bg-brand/5 px-3 py-2"
            disabled={createCategory.isPending}
            onPress={() => void createTitle()}>
            <Ionicons color="#208AEF" name="add" size={15} />
            <Text className="text-sm font-semibold text-brand">
              {createCategory.isPending ? 'Création…' : `Créer « ${term} »`}
            </Text>
          </Pressable>
        ) : null}
        {createdTitle ? (
          <Text className="mt-2 text-xs font-semibold text-emerald-600">
            Titre « {createdTitle} » créé et sélectionné.
          </Text>
        ) : null}
        {errors.categoryId ? (
          <Text className="mt-1 text-xs text-red-600">{errors.categoryId.message}</Text>
        ) : null}

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
          <Chip label="Sans mode" selected={!method} onPress={() => setMethod(undefined)} />
          {(methods.data ?? []).map((item) => (
            <Chip
              key={item.id}
              label={item.name}
              selected={method === item.name}
              onPress={() => setMethod(item.name)}
            />
          ))}
        </ScrollView>
      </ScrollView>

      <View className="border-t border-slate-200 bg-white px-4 pb-6 pt-3">
        <Pressable
          className={`h-11 items-center justify-center rounded-xl ${
            createExpense.isPending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={createExpense.isPending}
          onPress={() => void onSubmit()}>
          {createExpense.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Enregistrer</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
