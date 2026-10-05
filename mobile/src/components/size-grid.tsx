import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import type { GridCell } from '@/lib/arrival';
import { formatMoney } from '@/lib/format';
import type { VariantItem } from '@/lib/types';

export interface PriceClipboard {
  variantId: string;
  unitCost: number;
}

interface SizeGridProps {
  variants: VariantItem[];
  values: Record<string, GridCell>;
  onCellChange: (variantId: string, patch: Partial<GridCell>) => void;
  clipboard: PriceClipboard | null;
  onCopy: (variantId: string) => void;
  onPaste: (variantId: string) => void;
}

/** Champ numérique contrôlé : accepte une valeur externe (coller, prix groupé). */
function NumericCell({
  value,
  onValue,
  placeholder,
  className,
}: {
  value: number;
  onValue: (value: number) => void;
  placeholder: string;
  className?: string;
}) {
  const [text, setText] = useState(value ? String(value) : '');
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(value ? String(value) : '');
    }
  }, [value]);

  return (
    <TextInput
      className={`rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-sm text-slate-900 ${className ?? ''}`}
      keyboardType="numeric"
      onChangeText={(raw) => {
        const clean = raw.replace(/[^0-9]/g, '');
        const next = clean === '' ? 0 : Number(clean);
        lastEmitted.current = next;
        setText(clean);
        onValue(next);
      }}
      placeholder={placeholder}
      placeholderTextColor="#94A3B8"
      selectionColor="#208AEF"
      value={text}
    />
  );
}

export function SizeGrid({
  variants,
  values,
  onCellChange,
  clipboard,
  onCopy,
  onPaste,
}: SizeGridProps) {
  if (variants.length === 0) {
    return (
      <Text className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
        Aucune pointure active pour ce modèle.
      </Text>
    );
  }

  return (
    <View className="gap-1.5">
      <View className="flex-row items-center gap-2 px-1">
        <Text className="w-14 text-[11px] font-semibold uppercase text-slate-400">Point.</Text>
        <Text className="flex-1 text-center text-[11px] font-semibold uppercase text-slate-400">
          Qté
        </Text>
        <Text className="flex-1 text-center text-[11px] font-semibold uppercase text-slate-400">
          Prix Ar
        </Text>
        <Text className="w-16 text-center text-[11px] font-semibold uppercase text-slate-400">
          Prix
        </Text>
      </View>

      {variants.map((variant) => {
        const cell = values[variant.id] ?? { quantity: 0, unitCost: 0 };
        const filled = cell.quantity > 0;
        const sizeLabel = variant.size.label || `${variant.size.value}`;

        return (
          <View
            className={`flex-row items-center gap-2 rounded-lg px-1 py-1 ${
              filled ? 'bg-brand/5' : ''
            }`}
            key={variant.id}>
            <View className="w-14">
              <Text className="text-sm font-semibold text-slate-900">{sizeLabel}</Text>
              <Text className="text-[10px] text-slate-400">{formatMoney(variant.sellingPrice)}</Text>
            </View>

            <NumericCell
              className="flex-1"
              onValue={(quantity) => onCellChange(variant.id, { quantity })}
              placeholder="0"
              value={cell.quantity}
            />

            <NumericCell
              className="flex-1"
              onValue={(unitCost) => onCellChange(variant.id, { unitCost })}
              placeholder="0"
              value={cell.unitCost}
            />

            <View className="w-16 flex-row items-center justify-center gap-1">
              <Pressable
                accessibilityLabel={`Copier le prix de la pointure ${sizeLabel}`}
                className="h-8 w-7 items-center justify-center rounded-md bg-slate-100"
                onPress={() => onCopy(variant.id)}>
                <Ionicons color="#475569" name="copy-outline" size={15} />
              </Pressable>
              {clipboard ? (
                <Pressable
                    accessibilityLabel={`Coller ${formatMoney(clipboard.unitCost)} sur la pointure ${sizeLabel}`}
                  className="h-8 w-7 items-center justify-center rounded-md bg-brand/15"
                  onPress={() => onPaste(variant.id)}>
                  <Ionicons color="#208AEF" name="clipboard-outline" size={15} />
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
