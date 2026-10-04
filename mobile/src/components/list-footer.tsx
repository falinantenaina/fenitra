import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

/** Pied de liste des listes paginées : compteur + « Charger plus ». */
export function ListFooter({
  shown,
  total,
  hasMore,
  isFetchingNextPage,
  fetchNextPage,
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}) {
  return (
    <View className="items-center gap-2 py-3">
      <Text className="text-xs text-slate-400">
        {shown} sur {total}
      </Text>
      {hasMore ? (
        <Pressable
          className={`h-10 flex-row items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 ${
            isFetchingNextPage ? 'opacity-60' : ''
          }`}
          disabled={isFetchingNextPage}
          onPress={fetchNextPage}>
          {isFetchingNextPage ? (
            <ActivityIndicator color="#208AEF" size="small" />
          ) : (
            <>
              <Ionicons color="#334155" name="chevron-down" size={16} />
              <Text className="font-semibold text-slate-700">Charger plus</Text>
            </>
          )}
        </Pressable>
      ) : (
        <Ionicons color="#CBD5E1" name="checkmark-done" size={16} />
      )}
    </View>
  );
}
