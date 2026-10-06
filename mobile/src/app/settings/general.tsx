import { zodResolver } from '@hookform/resolvers/zod';
import { router } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ErrorPanel } from '@/components/error-panel';
import { FieldError } from '@/components/field';
import { toast } from '@/components/toast';
import { apiMessage } from '@/lib/api';
import { useChangePassword, useSettings, useUpdateSettings } from '@/lib/queries';
import {
  buildSettingsPayload,
  passwordFormSchema,
  settingFormSchema,
  type PasswordFormValues,
  type SettingFormValues,
} from '@/lib/settings';
import { useAuth } from '@/store/auth';

const inputClass =
  'h-11 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900';

/* ════════════ Mot de passe ════════════ */

function PasswordForm() {
  const changePassword = useChangePassword();
  const signOut = useAuth((state) => state.signOut);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordFormSchema),
    mode: 'onSubmit',
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await changePassword.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      reset({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success(
        'Mot de passe modifié',
        'Toutes vos sessions sont révoquées : reconnectez-vous.',
      );
      void signOut().then(() => router.replace('/login'));
    } catch (error) {
      toast.error('Changement refusé', apiMessage(error));
    }
  });

  return (
    <View className="gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Changer mon mot de passe
      </Text>
      <Controller
        control={control}
        name="currentPassword"
        render={({ field }) => (
          <TextInput
            autoCapitalize="none"
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Mot de passe actuel"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.currentPassword?.message} />
      <Controller
        control={control}
        name="newPassword"
        render={({ field }) => (
          <TextInput
            autoCapitalize="none"
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Nouveau mot de passe (8 caractères min.)"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.newPassword?.message} />
      <Controller
        control={control}
        name="confirm"
        render={({ field }) => (
          <TextInput
            autoCapitalize="none"
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Confirmer le nouveau mot de passe"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.confirm?.message} />
      <Pressable
        className={`h-10 items-center justify-center rounded-xl ${
          changePassword.isPending ? 'bg-slate-300' : 'bg-brand'
        }`}
        disabled={changePassword.isPending}
        onPress={() => void onSubmit()}>
        {changePassword.isPending ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="font-semibold text-white">Modifier le mot de passe</Text>
        )}
      </Pressable>
    </View>
  );
}

/* ════════════ Réglages clé / valeur ════════════ */

function SettingsForm({ presetKey }: { presetKey: { key: string; value: string } | null }) {
  const updateSettings = useUpdateSettings();
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SettingFormValues>({
    resolver: zodResolver(settingFormSchema),
    mode: 'onSubmit',
    defaultValues: { key: presetKey?.key ?? '', value: presetKey?.value ?? '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await updateSettings.mutateAsync(buildSettingsPayload(values));
      toast.success('Réglage enregistré', values.key);
    } catch (error) {
      toast.error('Réglage refusé', apiMessage(error));
    }
  });

  return (
    <View className="gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {presetKey ? `Modifier « ${presetKey.key} »` : 'Nouveau réglage'}
      </Text>
      <Controller
        control={control}
        name="key"
        render={({ field }) => (
          <TextInput
            autoCapitalize="none"
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Clé (ex. nom_entreprise)"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.key?.message} />
      <Controller
        control={control}
        name="value"
        render={({ field }) => (
          <TextInput
            className={`${inputClass} py-2`}
            onChangeText={field.onChange}
            placeholder="Valeur"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.value?.message} />
      <Pressable
        className={`h-10 items-center justify-center rounded-xl ${
          updateSettings.isPending ? 'bg-slate-300' : 'bg-brand'
        }`}
        disabled={updateSettings.isPending}
        onPress={() => void onSubmit()}>
        {updateSettings.isPending ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="font-semibold text-white">Enregistrer</Text>
        )}
      </Pressable>
      <Text className="text-xs text-slate-400">
        Les clés absentes ne sont pas modifiées : l’envoi fusionne avec les réglages existants.
      </Text>
    </View>
  );
}

/* ════════════ Écran ════════════ */

export default function GeneralSettingsScreen() {
  const settings = useSettings();
  const [selected, setSelected] = useState<{ key: string; value: string } | null>(null);

  const entries = Object.entries(settings.data ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <ScrollView
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled">
      <PasswordForm />

      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Réglages ({entries.length})
          </Text>
          {selected ? (
            <Pressable
              className="h-8 items-center justify-center rounded-lg bg-slate-100 px-3"
              onPress={() => setSelected(null)}>
              <Text className="text-sm font-medium text-slate-700">Fermer</Text>
            </Pressable>
          ) : null}
        </View>

        <SettingsForm key={`${selected?.key ?? 'new'}-${entries.length}`} presetKey={selected} />

        <View className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {settings.isPending ? (
            <ActivityIndicator className="py-4" color="#208AEF" />
          ) : settings.isError ? (
            <ErrorPanel
              isRetrying={settings.isRefetching}
              message="Impossible de charger les réglages."
              onRetry={() => void settings.refetch()}
            />
          ) : entries.length === 0 ? (
            <Text className="px-3 py-4 text-sm text-slate-400">Aucun réglage enregistré.</Text>
          ) : (
            entries.map(([key, value]) => (
              <Pressable
                key={key}
                className={`border-b border-slate-100 px-3 py-3 last:border-b-0 ${
                  selected?.key === key ? 'bg-sky-50' : ''
                }`}
                onPress={() => setSelected({ key, value })}>
                <Text className="text-xs uppercase tracking-wide text-slate-400">{key}</Text>
                <Text className="text-sm text-slate-800" numberOfLines={2}>
                  {value}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      </View>
    </ScrollView>
  );
}
