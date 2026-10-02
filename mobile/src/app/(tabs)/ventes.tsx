import { Text, View } from 'react-native';

export default function VentesScreen() {
  return (
    <View className="flex-1 gap-2 bg-white p-4">
      <Text className="text-xl font-bold text-slate-900">Ventes</Text>
      <Text className="text-sm text-slate-500">
        Saisie d&apos;une vente (cash, crédit ou en ligne), règlements et annulation. Écran à
        connecter en phase 6b.
      </Text>
    </View>
  );
}
