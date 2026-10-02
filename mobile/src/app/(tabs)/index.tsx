import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { api, apiMessage } from '@/lib/api';
import { useAuth } from '@/store/auth';

interface HealthPayload {
  status?: string;
  uptime?: number;
}

export default function HomeScreen() {
  const user = useAuth((state) => state.user);
  const logout = useAuth((state) => state.logout);

  const health = useQuery<HealthPayload>({
    queryKey: ['health'],
    queryFn: async () => {
      const { data } = await api.get<HealthPayload>('/health');
      return data;
    },
  });

  const state = health.isPending
    ? 'Vérification…'
    : health.isError
      ? `Indisponible — ${apiMessage(health.error)}`
      : `Connecté (${health.data?.status ?? 'ok'})`;

  return (
    <View className="flex-1 gap-4 bg-white p-4">
      <View className="gap-1 rounded-2xl bg-slate-100 p-4">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Session
        </Text>
        <Text className="text-lg font-semibold text-slate-900">{user?.name ?? '—'}</Text>
        <Text className="text-sm text-slate-500">
          {user?.email} · {user?.role}
        </Text>
      </View>

      <View className="gap-1 rounded-2xl border border-slate-200 p-4">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          API
        </Text>
        <View className="mt-1 flex-row items-center gap-2">
          {health.isPending ? <ActivityIndicator color="#208AEF" /> : null}
          <Text className="text-sm text-slate-700">{state}</Text>
        </View>
        <Pressable className="mt-3 self-start rounded-lg bg-slate-100 px-3 py-2" onPress={() => void health.refetch()}>
          <Text className="text-sm font-medium text-slate-700">Réessayer</Text>
        </Pressable>
      </View>

      <View className="gap-1 rounded-2xl border border-slate-200 p-4">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Prochaines phases
        </Text>
        <Text className="text-sm text-slate-700">
          6b : connexion des écrans — tableaux de bord, stock, ventes, dettes et finances
          alimentés par l&apos;API.
        </Text>
      </View>

      <Pressable
        className="h-11 items-center justify-center rounded-xl border border-red-200 bg-red-50"
        onPress={() => void logout()}>
        <Text className="font-semibold text-red-600">Se déconnecter</Text>
      </Pressable>
    </View>
  );
}
