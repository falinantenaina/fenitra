import { Pressable, Text, TextInput, View } from 'react-native';

/** Champ de date libre `AAAA-MM-JJ` — saisi en locale, validé par le serveur. */
export function DateField({
  label,
  value,
  onChange,
  onToday,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  onToday?: () => void;
}) {
  return (
    <View className="flex-1 flex-row items-end gap-2">
      <View className="flex-1 gap-1">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</Text>
        <TextInput
          autoCapitalize="none"
          className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900"
          keyboardType="numbers-and-punctuation"
          onChangeText={(next) => onChange(next.trim())}
          placeholder="AAAA-MM-JJ"
          placeholderTextColor="#94A3B8"
          selectionColor="#208AEF"
          value={value}
        />
      </View>
      {onToday ? (
        <Pressable
          className="h-10 items-center justify-center rounded-xl bg-slate-100 px-3"
          onPress={onToday}>
          <Text className="text-sm font-medium text-slate-700">Aujourd&apos;hui</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
