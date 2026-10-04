import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
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
import { ErrorText, Field } from '@/components/field';
import { apiMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  buildSupplierDebtPayload,
  supplierDebtFormSchema,
  todayISO,
  type SupplierDebtFormValues,
} from '@/lib/finance';
import { useCreateSupplierDebt, useSuppliers } from '@/lib/queries';

export default function NewSupplierDebtScreen() {
  const createDebt = useCreateSupplierDebt();
  const suppliers = useSuppliers();

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<SupplierDebtFormValues>({
    resolver: zodResolver(supplierDebtFormSchema),
    mode: 'onSubmit',
    defaultValues: { supplierId: '', amount: 0, date: todayISO(), reason: '' },
  });

  const supplierId = useWatch({ control, name: 'supplierId' });

  // Pré-remplissage : premier fournisseur.
  useEffect(() => {
    if (!supplierId && suppliers.data?.length) {
      setValue('supplierId', suppliers.data[0]!.id);
    }
  }, [supplierId, suppliers.data, setValue]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const debt = await createDebt.mutateAsync(buildSupplierDebtPayload(values));
      Alert.alert(
        'Dette enregistrée',
        `${debt.party?.name ?? ''} — ${formatMoney(debt.initialAmount)}`,
        [
          {
            text: 'OK',
            onPress: () => router.replace({ pathname: '/dettes/[id]', params: { id: debt.id } }),
          },
        ],
      );
    } catch (error) {
      Alert.alert('Dette refusée', apiMessage(error));
    }
  });

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView className="flex-1 px-4 pb-32 pt-4" keyboardShouldPersistTaps="handled">
        <View className="gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <Text className="text-xs text-amber-800">
            Dette fournisseur : argent que je dois. La caisse augmente du montant acheté à crédit et
            la dette apparaît au passif jusqu&apos;au règlement.
          </Text>
        </View>

        <Field label="Fournisseur">
          <View className="flex-row flex-wrap gap-2">
            {(suppliers.data ?? []).map((supplier) => (
              <Chip
                key={supplier.id}
                label={supplier.name}
                selected={supplierId === supplier.id}
                onPress={() => setValue('supplierId', supplier.id, { shouldValidate: true })}
              />
            ))}
          </View>
          {suppliers.isPending ? <ActivityIndicator className="py-2" color="#208AEF" /> : null}
          {!suppliers.isPending && (suppliers.data ?? []).length === 0 ? (
            <Text className="text-xs text-slate-400">
              Aucun fournisseur enregistré — créez-le d&apos;abord depuis l&apos;arrivage.
            </Text>
          ) : null}
          {errors.supplierId ? <ErrorText message={errors.supplierId.message} /> : null}
        </Field>

        <Field label="Montant de la dette (Ar)">
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
          {errors.amount ? <ErrorText message={errors.amount.message} /> : null}
        </Field>

        <Field label="Motif (facultatif)">
          <Controller
            control={control}
            name="reason"
            render={({ field }) => (
              <TextInput
                className="min-h-[48px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
                onChangeText={field.onChange}
                placeholder="Achat de marchandise, besoin de caisse…"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={field.value}
              />
            )}
          />
          {errors.reason ? <ErrorText message={errors.reason.message} /> : null}
        </Field>

        <View className="mt-5 flex-row items-end gap-3">
          <View className="flex-1">
            <Field label="Date (AAAA-MM-JJ)">
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
            </Field>
            {errors.date ? <ErrorText message={errors.date.message} /> : null}
          </View>
          <Pressable
            className="h-11 items-center justify-center rounded-xl bg-slate-100 px-4"
            onPress={() => setValue('date', todayISO())}>
            <Text className="text-sm font-medium text-slate-700">Aujourd&apos;hui</Text>
          </Pressable>
        </View>
      </ScrollView>

      <View className="border-t border-slate-200 bg-white px-4 pb-6 pt-3">
        <Pressable
          className={`h-11 items-center justify-center rounded-xl ${
            createDebt.isPending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={createDebt.isPending}
          onPress={() => void onSubmit()}>
          {createDebt.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Enregistrer</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
