import { Pressable, Text } from 'react-native';

/** Pastille s�lectionnable (filtres, m�thodes, segments). */
export function Chip({
  disabled = false,
  label,
  onPress,
  selected,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityState={{ disabled }}
      className={`h-9 items-center justify-center rounded-full border px-4 ${
        disabled
          ? 'border-slate-200 bg-slate-50'
          : selected
            ? 'border-brand bg-brand/10'
            : 'border-slate-300 bg-white'
      }`}
      disabled={disabled}
      onPress={onPress}>
      <Text
        className={`text-sm ${
          disabled ? 'text-slate-400' : selected ? 'font-semibold text-brand' : 'text-slate-600'
        }`}>
        {label}
      </Text>
    </Pressable>
  );
}
