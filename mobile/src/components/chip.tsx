import { Pressable, Text } from 'react-native';

/** Pastille sélectionnable (filtres, méthodes, segments). */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      className={`h-9 items-center justify-center rounded-full border px-4 ${
        selected ? 'border-brand bg-brand/10' : 'border-slate-300 bg-white'
      }`}
      onPress={onPress}>
      <Text className={`text-sm ${selected ? 'font-semibold text-brand' : 'text-slate-600'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
