import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Chip } from '@/components/chip';
import { FieldError } from '@/components/field';
import { apiMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  useCreateUser,
  useResetUserPassword,
  useRoleList,
  useUpdateUser,
  useUserList,
} from '@/lib/queries';
import {
  buildUserPayload,
  resetPasswordFormSchema,
  userEditFormSchema,
  userFormSchema,
  type ResetPasswordFormValues,
  type UserEditFormValues,
  type UserFormValues,
} from '@/lib/settings';
import type { UserItem, UserRole } from '@/lib/types';
import { useAuth } from '@/store/auth';

const inputClass =
  'h-11 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900';

const FALLBACK_ROLES: UserRole[] = ['ADMIN', 'MANAGER', 'CASHIER'];

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrateur',
  MANAGER: 'Gestionnaire',
  CASHIER: 'Caisse',
};

function RoleChips({
  value,
  roles,
  onSelect,
}: {
  value: UserRole;
  roles: string[];
  onSelect: (role: UserRole) => void;
}) {
  return (
    <ScrollView
      horizontal
      contentContainerStyle={{ gap: 8 }}
      showsHorizontalScrollIndicator={false}>
      {roles.map((role) => (
        <Chip
          key={role}
          label={ROLE_LABELS[role as UserRole] ?? role}
          selected={value === role}
          onPress={() => onSelect(role as UserRole)}
        />
      ))}
    </ScrollView>
  );
}

/* ════════════ Création ════════════ */

function UserForm({ onDone }: { onDone: () => void }) {
  const createUser = useCreateUser();
  const roles = useRoleList();
  const roleList = roles.data ?? FALLBACK_ROLES;
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    mode: 'onSubmit',
    defaultValues: { name: '', email: '', password: '', role: 'CASHIER' },
  });

  const role = useWatch({ control, name: 'role' });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await createUser.mutateAsync(buildUserPayload(values));
      onDone();
    } catch (error) {
      Alert.alert('Utilisateur refusé', apiMessage(error));
    }
  });

  return (
    <View className="gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-sky-800">
        Nouvel utilisateur
      </Text>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextInput
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Nom"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.name?.message} />
      <Controller
        control={control}
        name="email"
        render={({ field }) => (
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            className={inputClass}
            keyboardType="email-address"
            onChangeText={field.onChange}
            placeholder="Email"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.email?.message} />
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <TextInput
            autoCapitalize="none"
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Mot de passe (8 caractères min.)"
            placeholderTextColor="#94A3B8"
            secureTextEntry
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.password?.message} />
      <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rôle</Text>
      <RoleChips
        onSelect={(next) => setValue('role', next, { shouldValidate: true })}
        roles={roleList}
        value={role}
      />
      <FieldError message={errors.role?.message} />
      <View className="flex-row gap-2">
        <Pressable
          className={`h-10 flex-1 items-center justify-center rounded-xl ${
            createUser.isPending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={createUser.isPending}
          onPress={() => void onSubmit()}>
          {createUser.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Créer le compte</Text>
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

/* ════════════ Édition ════════════ */

function UserEditForm({ user, onDone }: { user: UserItem; onDone: () => void }) {
  const updateUser = useUpdateUser();
  const resetPassword = useResetUserPassword();
  const roles = useRoleList();
  const roleList = roles.data ?? FALLBACK_ROLES;
  const [role, setRole] = useState<UserRole>(user.role);
  const [showReset, setShowReset] = useState(false);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<UserEditFormValues>({
    resolver: zodResolver(userEditFormSchema),
    mode: 'onSubmit',
    defaultValues: { name: user.name },
  });

  const resetForm = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordFormSchema),
    mode: 'onSubmit',
    defaultValues: { newPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await updateUser.mutateAsync({
        id: user.id,
        body: { name: values.name, role },
      });
      onDone();
    } catch (error) {
      Alert.alert('Utilisateur refusé', apiMessage(error));
    }
  });

  const toggleActive = async () => {
    try {
      await updateUser.mutateAsync({ id: user.id, body: { active: !user.active } });
    } catch (error) {
      Alert.alert('Utilisateur refusé', apiMessage(error));
    }
  };

  const onReset = resetForm.handleSubmit(async (values) => {
    try {
      await resetPassword.mutateAsync({ id: user.id, newPassword: values.newPassword });
      resetForm.reset({ newPassword: '' });
      setShowReset(false);
      Alert.alert('Mot de passe réinitialisé', 'Toutes les sessions de cet utilisateur sont révoquées.');
    } catch (error) {
      Alert.alert('Réinitialisation refusée', apiMessage(error));
    }
  });

  return (
    <View className="gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-sky-800">
        {user.email}
      </Text>
      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <TextInput
            className={inputClass}
            onChangeText={field.onChange}
            placeholder="Nom"
            placeholderTextColor="#94A3B8"
            selectionColor="#208AEF"
            value={field.value}
          />
        )}
      />
      <FieldError message={errors.name?.message} />
      <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rôle</Text>
      <RoleChips onSelect={setRole} roles={roleList} value={role} />
      <View className="flex-row gap-2">
        <Pressable
          className={`h-10 flex-1 items-center justify-center rounded-xl ${
            updateUser.isPending ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={updateUser.isPending}
          onPress={() => void onSubmit()}>
          {updateUser.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">Enregistrer</Text>
          )}
        </Pressable>
        <Pressable
          className={`h-10 items-center justify-center rounded-xl px-4 ${
            user.active ? 'bg-red-50' : 'bg-emerald-50'
          }`}
          disabled={updateUser.isPending}
          onPress={() => void toggleActive()}>
          <Text className={`font-medium ${user.active ? 'text-red-600' : 'text-emerald-700'}`}>
            {user.active ? 'Désactiver' : 'Réactiver'}
          </Text>
        </Pressable>
        <Pressable
          className="h-10 items-center justify-center rounded-xl bg-slate-100 px-4"
          onPress={onDone}>
          <Text className="font-medium text-slate-600">Fermer</Text>
        </Pressable>
      </View>

      <Pressable
        className="h-9 items-center justify-center rounded-lg border border-slate-300 bg-white"
        onPress={() => setShowReset((v) => !v)}>
        <Text className="text-sm font-medium text-slate-700">
          {showReset ? 'Fermer la réinitialisation' : 'Réinitialiser le mot de passe'}
        </Text>
      </Pressable>
      {showReset ? (
        <View className="gap-2">
          <Controller
            control={resetForm.control}
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
          <FieldError message={resetForm.formState.errors.newPassword?.message} />
          <Pressable
            className={`h-10 items-center justify-center rounded-xl ${
              resetPassword.isPending ? 'bg-slate-300' : 'bg-slate-800'
            }`}
            disabled={resetPassword.isPending}
            onPress={() => void onReset()}>
            {resetPassword.isPending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="font-semibold text-white">Réinitialiser</Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/* ════════════ Écran ════════════ */

export default function UsersSettingsScreen() {
  const role = useAuth((state) => state.user?.role);
  const users = useUserList();

  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (role !== 'ADMIN') {
    return (
      <View className="flex-1 items-center justify-center bg-slate-50 px-6">
        <Text className="text-center text-sm text-slate-500">
          La gestion des utilisateurs est réservée aux administrateurs.
        </Text>
      </View>
    );
  }

  const items = users.data ?? [];
  const selected = items.find((u) => u.id === selectedId) ?? null;

  return (
    <ScrollView
      className="flex-1 bg-slate-50"
      contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled">
      <Pressable
        className={`h-10 items-center justify-center rounded-xl ${
          showNew ? 'bg-slate-100' : 'bg-brand'
        }`}
        onPress={() => {
          setSelectedId(null);
          setShowNew((v) => !v);
        }}>
        <Text className={`font-semibold ${showNew ? 'text-slate-600' : 'text-white'}`}>
          {showNew ? 'Fermer' : 'Nouvel utilisateur'}
        </Text>
      </Pressable>

      {showNew ? <UserForm onDone={() => setShowNew(false)} /> : null}
      {selected ? (
        <UserEditForm key={selected.id} onDone={() => setSelectedId(null)} user={selected} />
      ) : null}

      <View className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {users.isPending ? (
          <ActivityIndicator className="py-4" color="#208AEF" />
        ) : items.length === 0 ? (
          <Text className="px-3 py-4 text-sm text-slate-400">Aucun utilisateur.</Text>
        ) : (
          items.map((user) => {
            const active = user.id === selectedId;
            return (
              <Pressable
                key={user.id}
                className={`border-b border-slate-100 px-3 py-3 last:border-b-0 ${
                  active ? 'bg-sky-50' : ''
                }`}
                onPress={() => {
                  setShowNew(false);
                  setSelectedId(active ? null : user.id);
                }}>
                <View className="flex-row items-center justify-between gap-2">
                  <View className="flex-1">
                    <Text className="text-sm font-semibold text-slate-800" numberOfLines={1}>
                      {user.name}
                    </Text>
                    <Text className="text-xs text-slate-400" numberOfLines={1}>
                      {user.email} · {formatDateTime(user.lastLoginAt ?? user.createdAt)}
                    </Text>
                  </View>
                  <View className="items-end gap-1">
                    <Text className="text-xs font-medium text-slate-600">
                      {ROLE_LABELS[user.role]}
                    </Text>
                    {!user.active ? (
                      <Text className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                        Désactivé
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}
