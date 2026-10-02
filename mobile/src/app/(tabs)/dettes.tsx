import { Text, View } from 'react-native';

export default function DettesScreen() {
  return (
    <View className="flex-1 gap-2 bg-white p-4">
      <Text className="text-xl font-bold text-slate-900">Dettes</Text>
      <Text className="text-sm text-slate-500">
        Trosa sinoa, créances clients et dettes fournisseurs. Écran à connecter en phase 6b.
      </Text>
    </View>
  );
}
