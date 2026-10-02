import { Text, View } from 'react-native';

export default function StockScreen() {
  return (
    <View className="flex-1 gap-2 bg-white p-4">
      <Text className="text-xl font-bold text-slate-900">Stock</Text>
      <Text className="text-sm text-slate-500">
        Lots, valorisation, mouvements et ajustements. Écran à connecter à l&apos;API en phase 6b.
      </Text>
    </View>
  );
}
