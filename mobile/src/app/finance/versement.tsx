import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import {
  buildVersementPayload,
  todayISO,
  versementFormSchema,
  type VersementFormValues,
} from '@/lib/finance';
import { useCreateVersement, usePaymentMethods } from '@/lib/queries';

export default function NewVersementScreen() {
  const methods = usePaymentMethods();
  const createVersement = useCreateVersement();
  const [method, setMethod] = useState<string | undefined>(undefined);

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<VersementFormValues>({
    resolver: zodResolver(versementFormSchema),
    mode: 'onSubmit',
    defaultValues: { personName: '', amount: 0, date: todayISO(), motif: '', comment: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const versement = await createVersement.mutateAsync(
        buildVersementPayload({ ...values, method }),
      );
      Alert.alert(
        'Versement enregistré',
        `${versement.personName} — ${Number(versement.amount).toLocaleString('fr-FR')} Ar`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (error) {
      Alert.alert('Versement refusé', apiMessage(error));
    }
  });

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView className="flex-1 px-4 pb-32 pt-4" keyboardShouldPersistTaps="handled">
        <View className="gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5">
          <Text className="text-xs text-indigo-800">
            Le traitement est détecté automatiquement : remboursement d&apos;une trosa sinoa
            ouverte pour cette personne, sinon dépense.
          </Text>
        </View>

        <Field label="Personne">
          <Controller
            control={control}
            name="personName"
            render={({ field }) => (
              <TextInput
                className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900"
                onChangeText={field.onChange}
                placeholder="Nom de la personne"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={field.value}
              />
            )}
          />
          {errors.personName ? <ErrorText message={errors.personName.message} /> : null}
        </Field>

        <Field label="Montant (Ar)">
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

        <Field label="Motif">
          <Controller
            control={control}
            name="motif"
            render={({ field }) => (
              <TextInput
                className="min-h-[48px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
                onChangeText={field.onChange}
                placeholder="Remboursement, achat personnel…"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={field.value}
              />
            )}
          />
          {errors.motif ? <ErrorText message={errors.motif.message} /> : null}
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
            createVersement.isPending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={createVersement.isPending}
          onPress={() => void onSubmit()}>
          {createVersement.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Enregistrer</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View className="mt-5 gap-1.5">
      <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</Text>
      {children}
    </View>
  );
}

function ErrorText({ message }: { message?: string }) {
  if (!message) return null;
  return <Text className="text-xs text-red-600">{message}</Text>;
}
