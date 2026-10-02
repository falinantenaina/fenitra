import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '@/store/auth';

export default function StockScreen() {
  const user = useAuth((state) => state.user);
  const canManage = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  return (
    <View className="flex-1 gap-3 bg-white p-4">
      <Text className="text-xl font-bold text-slate-900">Stock</Text>
      <Text className="text-sm text-slate-500">
        Lots, valorisation, mouvements et ajustements. Écran à connecter à l&apos;API en phase 6e.
      </Text>

      {canManage ? (
        <Pressable
          className="h-11 flex-row items-center justify-center gap-2 rounded-xl bg-brand"
          onPress={() => router.push('/arrival/new')}>
          <Ionicons color="#ffffff" name="add" size={18} />
          <Text className="font-semibold text-white">Nouvel arrivage</Text>
        </Pressable>
      ) : (
        <View className="rounded-xl bg-slate-50 px-3 py-2.5">
          <Text className="text-xs text-slate-500">
            La saisie d&apos;arrivage est réservée aux gestionnaires et administrateurs.
          </Text>
        </View>
      )}
    </View>
  );
}
