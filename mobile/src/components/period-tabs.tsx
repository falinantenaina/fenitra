import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { DateField } from '@/components/date-field';
import { todayISO } from '@/lib/finance';
import { firstOfMonth } from '@/lib/report';
import type { CustomRange, PeriodKey } from '@/lib/types';

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Aujourd’hui' },
  { key: 'yesterday', label: 'Hier' },
  { key: 'last7d', label: '7 jours' },
  { key: 'week', label: 'Semaine' },
  { key: 'month', label: 'Mois' },
  { key: 'prevMonth', label: 'Mois précédent' },
  { key: 'year', label: 'Année' },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-02-31` est refusé : la conversion JS remonterait en mars. */
function isRealDay(value: string): boolean {
  if (!ISO_DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export interface PeriodTabsProps {
  value: PeriodKey;
  /** Bornes de `period=custom` — affichées dans l'éditeur et envoyées aux requêtes. */
  range?: CustomRange | null;
  /**
   * Un preset part immédiatement ; `custom` n'est émis qu'une fois les bornes
   * validées, sinon le backend rejetterait la requête sans `from`/`to`.
   */
  onChange: (next: { key: PeriodKey; range?: CustomRange }) => void;
}

export function PeriodTabs({ value, range, onChange }: PeriodTabsProps) {
  const [from, setFrom] = useState(range?.from ?? firstOfMonth());
  const [to, setTo] = useState(range?.to ?? todayISO());
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(value === 'custom');

  const activeCustom = value === 'custom';
  const showEditor = opened || activeCustom;

  const apply = () => {
    if (!isRealDay(from)) {
      setError('Date de début invalide (AAAA-MM-JJ)');
      return;
    }
    if (!isRealDay(to)) {
      setError('Date de fin invalide (AAAA-MM-JJ)');
      return;
    }
    if (from > to) {
      setError('La date de fin doit être postérieure à la date de début');
      return;
    }
    setError(null);
    onChange({ key: 'custom', range: { from, to } });
  };

  const chip = (key: PeriodKey, label: string, onPress: () => void, active: boolean) => (
    <Pressable
      accessibilityRole="button"
      className={`rounded-full px-3.5 py-2 ${active ? 'bg-brand' : 'bg-slate-100'}`}
      key={key}
      onPress={onPress}>
      <Text className={`text-sm font-medium ${active ? 'text-white' : 'text-slate-600'}`}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View className="bg-white">
      <ScrollView
        contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {PERIODS.map((p) =>
          chip(p.key, p.label, () => {
            setOpened(false);
            onChange({ key: p.key });
          }, p.key === value),
        )}
        {chip('custom', 'Personnalisé', () => setOpened(true), activeCustom)}
      </ScrollView>

      {showEditor ? (
        <View className="gap-2 border-b border-slate-200 px-4 pb-3">
          <View className="flex-row gap-2">
            <DateField label="Du" onChange={setFrom} value={from} />
            <DateField
              label="Au"
              onChange={setTo}
              onToday={() => setTo(todayISO())}
              value={to}
            />
          </View>
          {error ? <Text className="text-xs text-red-600">{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            className="h-10 items-center justify-center rounded-xl bg-brand"
            onPress={apply}>
            <Text className="text-sm font-semibold text-white">Afficher la période</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
