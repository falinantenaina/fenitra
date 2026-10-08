import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
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

import { ErrorText, Field } from '@/components/field';
import { toast } from '@/components/toast';
import { apiMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { buildGainPayload, gainFormSchema, type GainFormValues } from '@/lib/finance';
import { useCreateGain } from '@/lib/queries';

export default function NewGainScreen() {
  const createGain = useCreateGain();

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<GainFormValues>({
    resolver: zodResolver(gainFormSchema),
    mode: 'onSubmit',
    defaultValues: { amount: 0, description: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const gain = await createGain.mutateAsync(buildGainPayload(values));
      toast.success('Bénéfice enregistré', formatMoney(gain.amount));
      router.back();
    } catch (error) {
      toast.error('Bénéfice refusé', apiMessage(error));
    }
  });

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView className="flex-1 px-4 pb-32 pt-4" keyboardShouldPersistTaps="handled">
        <View className="gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <Text className="text-xs text-emerald-800">
            Enregistre un bénéfice gagné hors stock : ni vente, ni article. Le montant entre en
            caisse et augmente le bénéfice — idéal pour une paire vendue sans arrivage.
          </Text>
        </View>

        <Field label="Montant du bénéfice (Ar)">
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

        <Field label="Description (facultatif)">
          <Controller
            control={control}
            name="description"
            render={({ field }) => (
              <TextInput
                className="min-h-[48px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
                onChangeText={field.onChange}
                placeholder="Vente hors stock — modèle X…"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={field.value ?? ''}
              />
            )}
          />
          {errors.description ? <ErrorText message={errors.description.message} /> : null}
        </Field>
      </ScrollView>

      <View className="border-t border-slate-200 bg-white px-4 pb-6 pt-3">
        <Pressable
          className={`h-11 items-center justify-center rounded-xl ${
            createGain.isPending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={createGain.isPending}
          onPress={() => void onSubmit()}>
          {createGain.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Enregistrer</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
