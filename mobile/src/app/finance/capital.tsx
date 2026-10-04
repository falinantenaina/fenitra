import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
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
  buildCapitalPayload,
  capitalFormSchema,
  todayISO,
  type CapitalFormValues,
} from '@/lib/finance';
import { useCreateCapital } from '@/lib/queries';

export default function NewCapitalScreen() {
  const createCapital = useCreateCapital();

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CapitalFormValues>({
    resolver: zodResolver(capitalFormSchema),
    mode: 'onSubmit',
    defaultValues: { type: 'IN', amount: 0, date: todayISO(), motif: '', reference: '', comment: '' },
  });

  const type = useWatch({ control, name: 'type' });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const movement = await createCapital.mutateAsync(buildCapitalPayload(values));
      Alert.alert(
        'Mouvement enregistré',
        `${movement.type === 'IN' ? 'Injection' : 'Retrait'} — ${formatMoney(movement.amount)}`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (error) {
      Alert.alert('Mouvement refusé', apiMessage(error));
    }
  });

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView className="flex-1 px-4 pb-32 pt-4" keyboardShouldPersistTaps="handled">
        <View className="gap-1 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
          <Text className="text-xs text-violet-800">
            L&apos;argent propre est personnel : injection (je mets) ou retrait (je sors). Ce
            n&apos;est ni un bénéfice, ni une dette à payer.
          </Text>
        </View>

        {/* Type */}
        <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Sens du mouvement
        </Text>
        <View className="mt-2 flex-row gap-2">
          <Chip
            label="Injection (je mets)"
            selected={type === 'IN'}
            onPress={() => setValue('type', 'IN', { shouldValidate: true })}
          />
          <Chip
            label="Retrait (je sors)"
            selected={type === 'OUT'}
            onPress={() => setValue('type', 'OUT', { shouldValidate: true })}
          />
        </View>
        {errors.type ? (
          <Text className="mt-1 text-xs text-red-600">{errors.type.message}</Text>
        ) : null}

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
                placeholder="Apport personnel, retrait bancaire…"
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

        <Field label="Référence (facultatif)">
          <Controller
            control={control}
            name="reference"
            render={({ field }) => (
              <TextInput
                className="h-11 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900"
                onChangeText={field.onChange}
                placeholder="N° virement, reçu…"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={field.value ?? ''}
              />
            )}
          />
          {errors.reference ? <ErrorText message={errors.reference.message} /> : null}
        </Field>
      </ScrollView>

      <View className="border-t border-slate-200 bg-white px-4 pb-6 pt-3">
        <Pressable
          className={`h-11 items-center justify-center rounded-xl ${
            createCapital.isPending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={createCapital.isPending}
          onPress={() => void onSubmit()}>
          {createCapital.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Enregistrer</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
