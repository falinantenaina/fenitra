import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { apiMessage } from '@/lib/api';
import { useSizeList } from '@/lib/queries';

interface SizePickerProps {
  /** Pointures déjà actives sur le modèle — masquées des propositions. */
  takenValues: number[];
  /** Reçoit les valeurs à porter sur le modèle (`POST /products/:id/variants`). */
  onAdd: (values: number[]) => Promise<void>;
  /** Présent → affiche un bouton « Fermer ». */
  onCancel?: () => void;
  title?: string;
}

/**
 * Saisie libre → valeurs uniques triées.
 * Accepte une valeur (`43`), une liste (`36,40`) et une plage
 * (`36-40`, `36 à 40`, `36:40`) — borne serveur 1…100, 60 valeurs max par
 * envoi, plages bornées à 61 valeurs.
 */
function parseSizeExpression(raw: string): number[] {
  const values = new Set<number>();
  const text = raw.toLowerCase().replace(/\s+/g, '');
  for (const token of text.split(/[,;]/)) {
    if (!token) continue;
    const range =
      token.match(/^(\d{1,3})[-–—:](\d{1,3})$/) ?? token.match(/^(\d{1,3})(?:à|a)(\d{1,3})$/);
    if (range) {
      const first = Number(range[1]);
      const second = Number(range[2]);
      const from = Math.min(first, second);
      const to = Math.max(first, second);
      if (to - from > 60) continue;
      for (let value = from; value <= to; value += 1) values.add(value);
    } else if (/^\d{1,3}$/.test(token)) {
      values.add(Number(token));
    }
  }
  return [...values].filter((value) => value >= 1 && value <= 100).sort((a, b) => a - b);
}

/**
 * Sélecteur des pointures **d'un modèle** (§12 — chaque modèle porte ses
 * propres pointures) : chips issues du dictionnaire `GET /sizes`, plus une
 * saisie libre (valeur `43`, liste `36,40` ou plage `36-40`) pour des
 * pointures absentes (le backend les crée à la volée).
 */
export function SizePicker({
  takenValues,
  onAdd,
  onCancel,
  title = 'Pointures de ce modèle',
}: SizePickerProps) {
  const sizes = useSizeList();
  const [selected, setSelected] = useState<number[]>([]);
  const [extra, setExtra] = useState('');
  const [pending, setPending] = useState(false);

  const taken = new Set(takenValues);
  const dictionary = (sizes.data?.items ?? [])
    .map((size) => size.value)
    .filter((value) => !taken.has(value));
  const options = [...new Set([...dictionary, ...selected])].sort((a, b) => a - b);

  const toggle = (value: number) =>
    setSelected((current) =>
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );

  const addExtra = () => {
    const values = parseSizeExpression(extra).filter((value) => !taken.has(value));
    if (values.length === 0) {
      Alert.alert('Pointure invalide', 'Ex. 43, 36-40, 36 à 40 ou 36,40 (valeurs 1 à 100).');
      return;
    }
    setSelected((current) => [...new Set([...current, ...values])].sort((a, b) => a - b));
    setExtra('');
  };

  const submit = async () => {
    if (selected.length === 0 || pending) return;
    setPending(true);
    try {
      await onAdd([...selected].sort((a, b) => a - b));
      setSelected([]);
    } catch (error) {
      Alert.alert('Pointures refusées', apiMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <View className="gap-2 rounded-xl border border-dashed border-brand bg-brand/5 p-3">
      <Text className="text-xs font-semibold uppercase tracking-wide text-brand">{title}</Text>

      <ScrollView
        contentContainerStyle={{ gap: 8, flexDirection: 'row', flexWrap: 'wrap' }}
        horizontal={false}
        showsHorizontalScrollIndicator={false}>
        {sizes.isPending ? (
          <ActivityIndicator color="#208AEF" />
        ) : options.length === 0 ? (
          <Text className="text-sm text-slate-500">
            Aucune autre pointure dans le dictionnaire — saisissez une valeur,
            une liste ou une plage ci-dessous.
          </Text>
        ) : (
          options.map((value) => {
            const active = selected.includes(value);
            return (
              <Pressable
                key={value}
                className={`rounded-full border px-3 py-1.5 ${
                  active ? 'border-brand bg-brand' : 'border-slate-200 bg-white'
                }`}
                onPress={() => toggle(value)}>
                <Text className={`text-sm ${active ? 'font-semibold text-white' : 'text-slate-600'}`}>
                  {value}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <View className="flex-row items-center gap-2">
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
          keyboardType="numbers-and-punctuation"
          onChangeText={setExtra}
          onSubmitEditing={addExtra}
          placeholder="Ex. 43, 36-40 ou 36,40"
          placeholderTextColor="#94A3B8"
          returnKeyType="done"
          selectionColor="#208AEF"
          value={extra}
        />
        <Pressable
          className="h-9 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white"
          disabled={!extra.trim()}
          onPress={addExtra}>
          <Ionicons color={extra.trim() ? '#208AEF' : '#CBD5E1'} name="add" size={18} />
        </Pressable>
      </View>

      <View className="flex-row gap-2">
        <Pressable
          className={`h-10 flex-1 items-center justify-center rounded-xl ${
            pending || selected.length === 0 ? 'bg-slate-300' : 'bg-brand'
          }`}
          disabled={pending || selected.length === 0}
          onPress={() => void submit()}>
          {pending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">
              {selected.length === 0 ? 'Pointure à ajouter' : `Ajouter (${selected.length})`}
            </Text>
          )}
        </Pressable>
        {onCancel ? (
          <Pressable
            className="h-10 items-center justify-center rounded-xl bg-slate-100 px-4"
            disabled={pending}
            onPress={onCancel}>
            <Text className="font-medium text-slate-600">Fermer</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
