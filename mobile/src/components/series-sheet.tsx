import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ErrorPanel } from '@/components/error-panel';
import { formatMoney } from '@/lib/format';
import { useProductVariants } from '@/lib/queries';
import type { VariantSearchItem } from '@/lib/types';

/** Ligne de panier produite par le volet « choisir série ». */
export type SeriesLine = {
  variantId: string;
  productName: string;
  sizeLabel: string;
  quantity: number;
  unitPrice: number;
};

type Props = {
  onClose: () => void;
  onConfirm: (lines: SeriesLine[]) => void;
  productId: string | null;
  productName: string;
};

const sizeLabelOf = (variant: VariantSearchItem): string =>
  variant.size.label || `${variant.size.value}`;

export function SeriesSheet({ onClose, onConfirm, productId, productName }: Props) {
  const variants = useProductVariants(productId);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const translateY = useMemo(() => new Animated.Value(0), []);

  const close = useMemo(
    () => () => {
      setQuantities({});
      translateY.setValue(0);
      onClose();
    },
    [onClose, translateY],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5,
        onPanResponderMove: (_event, gesture) => {
          if (gesture.dy > 0) translateY.setValue(gesture.dy);
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > 90 || gesture.vy > 0.9) {
            close();
            return;
          }
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [close, translateY],
  );

  const rows = [...(variants.data ?? [])].sort((a, b) => a.size.order - b.size.order);
  const totalPairs = rows.reduce((sum, variant) => sum + (quantities[variant.id] ?? 0), 0);

  const setQuantity = (variant: VariantSearchItem, raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '');
    const value = digits === '' ? 0 : Math.min(Number(digits), variant.stock);
    setQuantities((prev) => ({ ...prev, [variant.id]: value }));
  };

  const bump = (variant: VariantSearchItem, delta: number) =>
    setQuantities((prev) => {
      const current = prev[variant.id] ?? 0;
      return {
        ...prev,
        [variant.id]: Math.max(0, Math.min(current + delta, variant.stock)),
      };
    });

  const confirm = () => {
    const lines = rows
      .map((variant) => ({
        variantId: variant.id,
        productName,
        sizeLabel: sizeLabelOf(variant),
        quantity: quantities[variant.id] ?? 0,
        unitPrice: Number(variant.sellingPrice),
      }))
      .filter((line) => line.quantity > 0);
    if (lines.length === 0) return;
    setQuantities({});
    translateY.setValue(0);
    onConfirm(lines);
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={close}
      statusBarTranslucent
      transparent
      visible={Boolean(productId)}>
      <View className="flex-1 justify-end">
        <Pressable
          accessibilityRole="button"
          className="absolute inset-0 bg-slate-900/50"
          onPress={close}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View
            className="max-h-[70%] rounded-t-3xl bg-white"
            style={{ transform: [{ translateY }] }}>
            <View {...pan.panHandlers} className="px-4 pb-2 pt-3">
              <View className="items-center pb-2">
                <View className="h-1 w-10 rounded-full bg-slate-300" />
              </View>
              <View className="flex-row items-start justify-between gap-2">
                <View className="flex-1 pr-2">
                  <Text className="text-base font-bold text-slate-900" numberOfLines={1}>
                    {productName} — Sélection de la série
                  </Text>
                  <Text className="text-xs text-slate-400">
                    Glisser vers le bas pour fermer
                  </Text>
                </View>
                <Pressable accessibilityLabel="Fermer" hitSlop={8} onPress={close}>
                  <Ionicons color="#64748B" name="close" size={22} />
                </Pressable>
              </View>
            </View>

            <View className="flex-row border-y border-slate-200 bg-slate-50 px-4 py-2">
              <Text className="w-16 text-xs font-semibold uppercase text-slate-500">
                Pointure
              </Text>
              <Text className="flex-1 text-xs font-semibold uppercase text-slate-500">
                Stock
              </Text>
              <Text className="w-32 text-right text-xs font-semibold uppercase text-slate-500">
                Quantité
              </Text>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              {variants.isPending ? (
                <ActivityIndicator className="py-6" color="#208AEF" />
              ) : variants.isError ? (
                <ErrorPanel
                  isRetrying={variants.isRefetching}
                  message="Stock de ce modèle indisponible."
                  onRetry={() => void variants.refetch()}
                />
              ) : rows.length === 0 ? (
                <Text className="px-4 py-6 text-center text-sm text-slate-400">
                  Aucune pointure disponible pour ce modèle.
                </Text>
              ) : (
                rows.map((variant) => {
                  const quantity = quantities[variant.id] ?? 0;
                  const out = variant.stock <= 0;
                  return (
                    <View
                      className="flex-row items-center border-b border-slate-100 px-4 py-2 last:border-b-0"
                      key={variant.id}>
                      <View className="w-16">
                        <Text className="text-base font-semibold text-slate-800">
                          {sizeLabelOf(variant)}
                        </Text>
                        <Text className="text-[11px] text-slate-400">
                          {formatMoney(variant.sellingPrice)}
                        </Text>
                      </View>

                      <View className="flex-1">
                        {out ? (
                          <Text className="text-xs font-medium text-red-500">Épuisé</Text>
                        ) : (
                          <Text className="text-sm text-slate-500">({variant.stock} p.)</Text>
                        )}
                      </View>

                      {out ? (
                        <View className="h-9 items-center justify-center rounded-lg bg-red-50 px-3">
                          <Text className="text-xs font-semibold text-red-500">
                            Rupture de stock
                          </Text>
                        </View>
                      ) : (
                        <View className="flex-row items-center overflow-hidden rounded-lg border border-slate-300">
                          <Pressable
                            accessibilityRole="button"
                            className="h-9 w-8 items-center justify-center bg-slate-100"
                            disabled={quantity <= 0}
                            onPress={() => bump(variant, -1)}>
                            <Ionicons
                              color={quantity <= 0 ? '#CBD5E1' : '#334155'}
                              name="remove"
                              size={16}
                            />
                          </Pressable>
                          <TextInput
                            className="h-9 w-10 bg-white text-center text-sm font-semibold text-slate-900"
                            keyboardType="numeric"
                            onChangeText={(raw) => setQuantity(variant, raw)}
                            selectTextOnFocus
                            selectionColor="#208AEF"
                            value={String(quantity)}
                          />
                          <Pressable
                            accessibilityRole="button"
                            className="h-9 w-8 items-center justify-center bg-slate-100"
                            disabled={quantity >= variant.stock}
                            onPress={() => bump(variant, 1)}>
                            <Ionicons
                              color={quantity >= variant.stock ? '#CBD5E1' : '#334155'}
                              name="add"
                              size={16}
                            />
                          </Pressable>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </ScrollView>

            <View className="border-t border-slate-200 px-4 pb-6 pt-3">
              <Pressable
                accessibilityRole="button"
                className={`h-12 items-center justify-center rounded-xl ${
                  totalPairs > 0 ? 'bg-brand' : 'bg-slate-300'
                }`}
                disabled={totalPairs === 0}
                onPress={confirm}>
                <Text className="font-semibold text-white">
                  {totalPairs > 0
                    ? `AJOUTER ${totalPairs} PAIRE${totalPairs > 1 ? 'S' : ''} AU PANIER`
                    : 'SÉLECTIONNEZ DES POINTURES'}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
