import { Pressable, ScrollView, Text } from 'react-native';

import type { PeriodKey } from '@/lib/types';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Aujourd’hui' },
  { key: 'yesterday', label: 'Hier' },
  { key: 'last7d', label: '7 jours' },
  { key: 'week', label: 'Semaine' },
  { key: 'month', label: 'Mois' },
  { key: 'year', label: 'Année' },
];

export function PeriodTabs({
  value,
  onChange,
}: {
  value: PeriodKey;
  onChange: (key: PeriodKey) => void;
}) {
  return (
    <ScrollView
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}
      horizontal
      showsHorizontalScrollIndicator={false}>
      {PERIODS.map((p) => {
        const active = p.key === value;
        return (
          <Pressable
            accessibilityRole="button"
            className={`rounded-full px-3.5 py-2 ${active ? 'bg-brand' : 'bg-slate-100'}`}
            key={p.key}
            onPress={() => onChange(p.key)}>
            <Text className={`text-sm font-medium ${active ? 'text-white' : 'text-slate-600'}`}>
              {p.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
