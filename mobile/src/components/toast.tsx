import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

type ToastTone = 'success' | 'error';

interface ToastData {
  title: string;
  detail?: string;
  tone: ToastTone;
}

interface ToastState {
  data: ToastData | null;
  show: (data: ToastData) => void;
  hide: () => void;
}

const useToastStore = create<ToastState>()((set) => ({
  data: null,
  show: (data) => set({ data }),
  hide: () => set({ data: null }),
}));

/**
 * Confirmation visible même si le `Alert` natif n'apparaît pas : le message
 * est rendu par l'app sur un bandeau racine, il survit donc à la navigation.
 * Le titre court + un détail optionnel, comme `Alert.alert(title, message)`.
 */
export const toast = {
  success: (title: string, detail?: string) =>
    useToastStore.getState().show({ title, detail, tone: 'success' }),
  error: (title: string, detail?: string) =>
    useToastStore.getState().show({ title, detail, tone: 'error' }),
};

const TONE = {
  success: { background: 'bg-emerald-600', icon: 'checkmark-circle' as const },
  error: { background: 'bg-red-600', icon: 'alert-circle' as const },
} satisfies Record<ToastTone, { background: string; icon: keyof typeof Ionicons.glyphMap }>;

/** Durée d'affichage : une erreur se lit plus lentement qu'une confirmation. */
const DURATION = { success: 3200, error: 6000 } as const;

export function ToastHost() {
  const insets = useSafeAreaInsets();
  const data = useToastStore((state) => state.data);
  const hide = useToastStore((state) => state.hide);
  const [opacity] = useState(() => new Animated.Value(0));
  const [offset] = useState(() => new Animated.Value(-12));

  useEffect(() => {
    if (!data) return;

    opacity.setValue(0);
    offset.setValue(-12);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(offset, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(offset, { toValue: -12, duration: 180, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) hide();
      });
    }, DURATION[data.tone]);

    return () => clearTimeout(timer);
  }, [data, hide, offset, opacity]);

  if (!data) return null;

  const tone = TONE[data.tone];

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      pointerEvents="box-none"
      style={{
        opacity,
        transform: [{ translateY: offset }],
        paddingTop: insets.top + 8,
      }}
      className="absolute inset-x-0 top-0 z-50 px-4">
      <Pressable
        accessibilityLabel="Masquer le message"
        onPress={hide}
        className={`gap-1 rounded-2xl px-4 py-3 shadow-lg ${tone.background}`}>
        <View className="flex-row items-center gap-2">
          <Ionicons color="#FFFFFF" name={tone.icon} size={20} />
          <Text className="flex-1 text-sm font-semibold text-white">{data.title}</Text>
        </View>
        {data.detail ? (
          <Text className="pl-7 text-xs text-white/90">{data.detail}</Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
