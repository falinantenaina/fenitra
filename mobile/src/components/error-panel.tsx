import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

export function ErrorPanel({
  isRetrying = false,
  message,
  onRetry,
}: {
  isRetrying?: boolean;
  message: string;
  onRetry: () => void;
}) {
  return (
    <View className="items-center gap-2 px-3 py-6">
      <Ionicons color="#FCA5A5" name="alert-circle-outline" size={28} />
      <Text className="text-center text-sm text-slate-500">{message}</Text>
      <Pressable
        accessibilityRole="button"
        className={`mt-1 h-9 items-center justify-center rounded-xl px-4 ${
          isRetrying ? 'bg-slate-200' : 'bg-slate-100'
        }`}
        disabled={isRetrying}
        onPress={onRetry}>
        {isRetrying ? (
          <ActivityIndicator color="#208AEF" />
        ) : (
          <Text className="text-sm font-semibold text-slate-700">Réessayer</Text>
        )}
      </Pressable>
    </View>
  );
}
