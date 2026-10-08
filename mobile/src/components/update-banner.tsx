import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bandeau de mise à jour OTA — mêmes conventions que `ToastHost` (overlay
 * racine, safe-area, `pointerEvents="box-none"`).
 *
 * Déroulé : la vérification `ON_LOAD` native trouve une maj → le téléchargement
 * démarre automatiquement avec une barre de progression → « Redémarrer »
 * applique la maj immédiatement (`Updates.reloadAsync()`), sans fermer l'app.
 * Une vérification complémentaire est déclenchée quand l'app revient au
 * premier plan (le `ON_LOAD` ne le fait qu'au lancement).
 *
 * Uniquement en release : `Updates.isEnabled` est `false` en dev/Expo Go et
 * les API `checkForUpdateAsync` / `fetchUpdateAsync` / `reloadAsync` y sont
 * refusées — le bandeau n'est jamais rendu.
 */
export function UpdateBanner() {
  const insets = useSafeAreaInsets();
  const {
    isUpdateAvailable,
    isUpdatePending,
    isDownloading,
    isRestarting,
    downloadProgress,
    downloadError,
    downloadedUpdate,
  } = Updates.useUpdates();
  // Rejet mémorisé par identifiant de maj : une nouvelle maj téléchargée a un
  // autre `updateId`, le bandeau réapparaît donc sans effet de remise à zéro.
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const pendingId = downloadedUpdate?.updateId ?? 'pending';
  const fetching = useRef(false);

  // Téléchargement automatique dès qu'une maj est détectée.
  useEffect(() => {
    if (!Updates.isEnabled || !isUpdateAvailable || isUpdatePending || isDownloading) return;
    if (fetching.current) return;
    fetching.current = true;
    void Updates.fetchUpdateAsync().catch(() => {
      fetching.current = false;
    });
  }, [isUpdateAvailable, isUpdatePending, isDownloading]);

  // ON_LOAD ne vérifie qu'au lancement : on relance au retour au premier plan.
  useEffect(() => {
    if (!Updates.isEnabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void Updates.checkForUpdateAsync().catch(() => undefined);
    });
    return () => subscription.remove();
  }, []);

  const stage = !Updates.isEnabled
    ? 'idle'
    : isDownloading
      ? 'downloading'
      : isUpdatePending
        ? 'ready'
        : isUpdateAvailable
          ? downloadError
            ? 'error'
            : 'available'
          : 'idle';

  if (stage === 'idle') return null;
  if (stage === 'ready' && dismissedId === pendingId) return null;

  const percent = Math.round((downloadProgress ?? 0) * 100);
  const tone =
    stage === 'ready'
      ? 'border-emerald-200 bg-emerald-50'
      : stage === 'error'
        ? 'border-red-200 bg-red-50'
        : 'border-sky-200 bg-sky-50';
  const icon =
    stage === 'ready'
      ? { name: 'checkmark-circle' as const, color: '#059669' }
      : stage === 'error'
        ? { name: 'alert-circle' as const, color: '#DC2626' }
        : { name: 'cloud-download-outline' as const, color: '#208AEF' };

  const startFetch = () => {
    if (fetching.current) return;
    fetching.current = true;
    void Updates.fetchUpdateAsync().catch(() => {
      fetching.current = false;
    });
  };

  return (
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 top-0 z-50 px-4"
      style={{ paddingTop: insets.top + 8 }}>
      <View className={`gap-2 rounded-2xl border px-4 py-3 shadow-lg ${tone}`}>
        <View className="flex-row items-center gap-2">
          <Ionicons color={icon.color} name={icon.name} size={20} />
          <View className="flex-1 gap-0.5">
            <Text className="text-sm font-semibold text-slate-800">
              {stage === 'ready'
                ? 'Mise à jour téléchargée'
                : stage === 'error'
                  ? 'Téléchargement échoué'
                  : stage === 'downloading'
                    ? 'Téléchargement de la mise à jour…'
                    : 'Mise à jour disponible'}
            </Text>
            <Text className="text-xs text-slate-600">
              {stage === 'ready'
                ? 'Appuyez sur Redémarrer pour l’appliquer.'
                : stage === 'error'
                  ? 'Vérifiez la connexion puis réessayez.'
                  : stage === 'downloading'
                    ? `${percent} %`
                    : 'Téléchargement en cours…'}
            </Text>
          </View>
        </View>

        {stage === 'downloading' ? (
          <View className="h-1.5 overflow-hidden rounded-full bg-white/70">
            <View
              className="h-full rounded-full bg-[#208AEF]"
              style={{ width: `${percent}%` }}
            />
          </View>
        ) : null}

        {stage === 'ready' ? (
          <View className="flex-row gap-2">
            <Pressable
              accessibilityRole="button"
              className="flex-1 items-center rounded-xl bg-emerald-600 px-3 py-2.5 active:bg-emerald-700"
              onPress={() => void Updates.reloadAsync()}>
              <Text className="text-xs font-semibold text-white">
                {isRestarting ? 'Redémarrage…' : 'Redémarrer'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              className="items-center rounded-xl bg-white px-3 py-2.5 active:bg-slate-100"
              onPress={() => setDismissedId(pendingId)}>
              <Text className="text-xs font-semibold text-slate-600">Plus tard</Text>
            </Pressable>
          </View>
        ) : null}

        {stage === 'error' ? (
          <Pressable
            accessibilityRole="button"
            className="items-center rounded-xl bg-red-600 px-3 py-2.5 active:bg-red-700"
            onPress={startFetch}>
            <Text className="text-xs font-semibold text-white">Réessayer</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
