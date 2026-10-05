import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { formatMoney } from '@/lib/format';
import type { VariantItem } from '@/lib/types';

interface PriceBulkModalProps {
  visible: boolean;
  variants: VariantItem[];
  /** Quantités par variante — sert à présélectionner les lignes déjà saisies. */
  quantities: Record<string, number>;
  onClose: () => void;
  onApply: (variantIds: string[], unitCost: number) => void;
}

function BulkContent({
  variants,
  quantities,
  onClose,
  onApply,
}: Omit<PriceBulkModalProps, 'visible'>) {
  const [price, setPrice] = useState('');
  /** `null` = la sélection suit encore la pré-sélection automatique. */
  const [manual, setManual] = useState<string[] | null>(null);

  const automatic = useMemo(() => {
    const preselected = variants.filter((v) => (quantities[v.id] ?? 0) > 0).map((v) => v.id);
    return preselected.length > 0 ? preselected : variants.map((v) => v.id);
  }, [variants, quantities]);

  const selected = manual ?? automatic;

  const toggle = (id: string) =>
    setManual(
      selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
    );

  const amount = Number(price.replace(/[^0-9]/g, ''));
  const canApply = selected.length > 0 && Number.isFinite(amount) && amount > 0;

  return (
    <View className="max-h-[85%] rounded-t-3xl bg-white px-5 pb-8 pt-5">
      <Text className="text-lg font-bold text-slate-900">Appliquer un prix d&apos;achat</Text>
      <Text className="mt-1 text-sm text-slate-500">
        Le prix est posé sur les pointures cochées — les quantités ne sont pas modifiées.
      </Text>

      <View className="mt-4 gap-1.5">
        <Text className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Prix d&apos;achat (Ar)
        </Text>
        <TextInput
          className="h-12 rounded-xl border border-slate-300 px-4 text-base text-slate-900"
          keyboardType="numeric"
          onChangeText={(raw) => setPrice(raw.replace(/[^0-9]/g, ''))}
          placeholder="30000"
          placeholderTextColor="#94A3B8"
          selectionColor="#208AEF"
          value={price}
        />
        {price ? <Text className="text-xs text-slate-400">{formatMoney(amount)}</Text> : null}
      </View>

      <View className="mt-4 flex-row gap-2">
        <Pressable
          className="rounded-lg bg-slate-100 px-3 py-2"
          onPress={() => setManual(variants.map((v) => v.id))}>
          <Text className="text-sm font-medium text-slate-700">Tout</Text>
        </Pressable>
        <Pressable className="rounded-lg bg-slate-100 px-3 py-2" onPress={() => setManual([])}>
          <Text className="text-sm font-medium text-slate-700">Aucun</Text>
        </Pressable>
        <Text className="ml-auto self-center text-xs text-slate-400">
          {selected.length}/{variants.length}
        </Text>
      </View>

      <ScrollView className="mt-3 max-h-64">
        {variants.map((variant) => {
          const checked = selected.includes(variant.id);
          return (
            <Pressable
              className="flex-row items-center gap-3 border-b border-slate-100 py-2.5"
              key={variant.id}
              onPress={() => toggle(variant.id)}>
              <Ionicons
                color={checked ? '#208AEF' : '#CBD5E1'}
                name={checked ? 'checkbox-outline' : 'square-outline'}
                size={22}
              />
              <Text className="flex-1 text-sm font-medium text-slate-800">
                {variant.size.label || variant.size.value}
              </Text>
              <Text className="text-xs text-slate-400">
                {quantities[variant.id] ? `${quantities[variant.id]} p.` : '—'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View className="mt-5 flex-row gap-3">
        <Pressable
          className="h-11 flex-1 items-center justify-center rounded-xl bg-slate-100"
          onPress={onClose}>
          <Text className="font-medium text-slate-700">Annuler</Text>
        </Pressable>
        <Pressable
          className={`h-11 flex-1 items-center justify-center rounded-xl ${
            canApply ? 'bg-brand' : 'bg-slate-300'
          }`}
          disabled={!canApply}
          onPress={() => {
            onApply(selected, amount);
            onClose();
          }}>
          <Text className="font-semibold text-white">Appliquer</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function PriceBulkModal(props: PriceBulkModalProps) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={props.onClose}
      transparent
      visible={props.visible}>
      <View className="flex-1 justify-end bg-black/40">
        {props.visible ? <BulkContent {...props} /> : null}
      </View>
    </Modal>
  );
}
