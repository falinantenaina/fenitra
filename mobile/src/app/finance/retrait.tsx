import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
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
import { ErrorText, Field } from '@/components/field';
import { toast } from '@/components/toast';
import { apiMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import {
  buildProfitDrawingPayload,
  profitDrawingFormSchema,
  todayISO,
  type ProfitDrawingFormValues,
} from '@/lib/finance';
import { useCreateProfitDrawing, useDashboard, usePaymentMethods } from '@/lib/queries';

export default function NewProfitDrawingScreen() {
  const createDrawing = useCreateProfitDrawing();
  const dashboard = useDashboard('today');
  const methods = usePaymentMethods();

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<ProfitDrawingFormValues>({
    resolver: zodResolver(profitDrawingFormSchema),
    mode: 'onSubmit',
    defaultValues: { amount: 0, date: todayISO(), notes: '' },
  });

  const method = useWatch({ control, name: 'method' });

  const available = dashboard.data ? Number(dashboard.data.money.disposableProfit) : null;

  const onSubmit = handleSubmit(async (values) => {
    // Plafond (bénéfice net non sorti) relu côté serveur : ce contrôle n'est
    // qu'un raccourci d'écran.
    if (available !== null && values.amount > available) {
      toast.error('Bénéfice disponible insuffisant', `Disponible : ${formatMoney(available)}`);
      return;
    }

    try {
      const drawing = await createDrawing.mutateAsync(buildProfitDrawingPayload(values));
      toast.success('Retrait enregistré', formatMoney(drawing.amount));
      router.back();
    } catch (error) {
      toast.error('Retrait refusé', apiMessage(error));
    }
  });

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-slate-50"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView className="flex-1 px-4 pb-32 pt-4" keyboardShouldPersistTaps="handled">
        <View className="gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <Text className="text-xs text-emerald-800">
            Le retrait sort un bénéfice déjà réalisé de la caisse : il ne crée aucun revenu, ne
            touche pas à l&apos;argent propre et ne se fait jamais au-delà du bénéfice net non sorti.
          </Text>
        </View>

        <View className="mt-3 flex-row items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5">
          <View>
            <Text className="text-xs text-slate-500">Bénéfice net non sorti (plafond)</Text>
            <Text className="text-base font-bold text-emerald-600">
              {dashboard.isPending ? '…' : available === null ? '—' : formatMoney(available)}
            </Text>
          </View>
          {createDrawing.isPending ? <ActivityIndicator color="#208AEF" /> : null}
        </View>

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

        <Text className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Mode de retrait
        </Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          <Chip
            label="Sans mode"
            selected={!method}
            onPress={() => setValue('method', undefined)}
          />
          {(methods.data ?? []).map((item) => (
            <Chip
              key={item.id}
              label={item.name}
              selected={method === item.name}
              onPress={() => setValue('method', item.name)}
            />
          ))}
        </View>

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

        <Field label="Notes (facultatif)">
          <Controller
            control={control}
            name="notes"
            render={({ field }) => (
              <TextInput
                className="min-h-[48px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
                onChangeText={field.onChange}
                placeholder="Retrait pour usage personnel…"
                placeholderTextColor="#94A3B8"
                selectionColor="#208AEF"
                value={field.value ?? ''}
              />
            )}
          />
          {errors.notes ? <ErrorText message={errors.notes.message} /> : null}
        </Field>
      </ScrollView>

      <View className="border-t border-slate-200 bg-white px-4 pb-6 pt-3">
        <Pressable
          className={`h-11 items-center justify-center rounded-xl ${
            createDrawing.isPending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={createDrawing.isPending}
          onPress={() => void onSubmit()}>
          {createDrawing.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Retirer</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
