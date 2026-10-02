import { Text, View } from 'react-native';

export default function FinancesScreen() {
  return (
    <View className="flex-1 gap-2 bg-white p-4">
      <Text className="text-xl font-bold text-slate-900">Finances</Text>
      <Text className="text-sm text-slate-500">
        Dépenses, versements, argent propre et capital personnel. Écran à connecter en phase 6b.
      </Text>
    </View>
  );
}
