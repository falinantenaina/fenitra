import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

export default function VentesScreen() {
  return (
    <View className="flex-1 gap-3 bg-white p-4">
      <Text className="text-xl font-bold text-slate-900">Ventes</Text>
      <Text className="text-sm text-slate-500">
        Saisie d&apos;une vente (cash, crédit ou en ligne), règlements et annulation. Liste des
        ventes à connecter en phase 6f.
      </Text>

      <Pressable
        className="h-11 flex-row items-center justify-center gap-2 rounded-xl bg-brand"
        onPress={() => router.push('/sale/new')}>
        <Ionicons color="#ffffff" name="add" size={18} />
        <Text className="font-semibold text-white">Nouvelle vente</Text>
      </Pressable>
    </View>
  );
}
