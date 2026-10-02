import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { apiMessage } from '@/lib/api';
import { useAuth } from '@/store/auth';

export default function LoginScreen() {
  const login = useAuth((state) => state.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    if (busy) return;
    setError(null);
    if (!email.trim() || !password) {
      setError('Email et mot de passe sont requis.');
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace('/');
    } catch (err) {
      setError(apiMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        className="flex-1 justify-center px-6"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View className="gap-1">
          <Text className="text-3xl font-bold text-slate-900">Gestion des ventes</Text>
          <Text className="text-sm text-slate-500">
            Chaussures, stock et finances — connectez-vous pour continuer.
          </Text>
        </View>

        <View className="mt-8 gap-4">
          <View className="gap-1.5">
            <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Email
            </Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900"
              keyboardType="email-address"
              onChangeText={setEmail}
              placeholder="vous@exemple.com"
              placeholderTextColor="#94A3B8"
              selectionColor="#208AEF"
              value={email}
            />
          </View>

          <View className="gap-1.5">
            <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Mot de passe
            </Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="password"
              className="h-12 rounded-xl border border-slate-300 bg-white px-4 text-base text-slate-900"
              onChangeText={setPassword}
              onSubmitEditing={onSubmit}
              placeholder="••••••••"
              placeholderTextColor="#94A3B8"
              secureTextEntry
              selectionColor="#208AEF"
              value={password}
            />
          </View>

          {error ? (
            <View className="rounded-lg bg-red-50 px-3 py-2">
              <Text className="text-sm text-red-600">{error}</Text>
            </View>
          ) : null}

          <Pressable
            className={`h-12 items-center justify-center rounded-xl ${
              busy ? 'bg-slate-400' : 'bg-brand'
            }`}
            disabled={busy}
            onPress={onSubmit}>
            {busy ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text className="text-base font-semibold text-white">Se connecter</Text>
            )}
          </Pressable>

          {__DEV__ ? (
            <Text className="text-center text-xs text-slate-400">
              Compte de démonstration : admin@test.local / admin1234
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
