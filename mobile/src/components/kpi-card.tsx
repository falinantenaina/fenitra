import { Pressable, Text, View } from 'react-native';

export type KpiTone = 'neutral' | 'positive' | 'negative' | 'brand';

interface KpiCardProps {
  title: string;
  value: string;
  hint?: string;
  tone?: KpiTone;
  /** Présent = la carte est cliquable et ouvre le dérillage de l'indicateur. */
  onPress?: () => void;
}

const VALUE_TONE: Record<KpiTone, string> = {
  neutral: 'text-slate-900',
  positive: 'text-emerald-600',
  negative: 'text-red-600',
  brand: 'text-brand',
};

export function KpiCard({ title, value, hint, tone = 'neutral', onPress }: KpiCardProps) {
  const actionable = Boolean(onPress);

  return (
    <Pressable
      accessibilityRole={actionable ? 'button' : undefined}
      className={`w-[48%] gap-1 rounded-2xl border bg-white p-3.5 ${
        actionable ? 'border-slate-200 active:bg-slate-50' : 'border-slate-200/80'
      }`}
      disabled={!actionable}
      onPress={onPress}>
      <View className="flex-row items-center justify-between gap-1">
        <Text className="flex-1 text-xs font-medium text-slate-500">{title}</Text>
        {actionable ? <Text className="text-[10px] text-slate-300">›</Text> : null}
      </View>
      <Text className={`text-lg font-bold ${VALUE_TONE[tone]}`} numberOfLines={1}>
        {value}
      </Text>
      {hint ? (
        <Text className="text-[11px] text-slate-400" numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}
