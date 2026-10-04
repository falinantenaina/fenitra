import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Stockage des jetons d'authentification.
 *
 * - **Android / iOS / Expo Go** : `expo-secure-store`, chiffré par le système
 *   (Keystore / Keychain). C'est le seul supporté par la bibliothèque.
 * - **Web** : `expo-secure-store` n'a *aucune* implémentation web — son module
 *   `ExpoSecureStore.web.js` exporte `{}`, et `getItemAsync` s'écrase sur
 *   `ExpoSecureStore.getValueWithKeyAsync is not a function`. On retombe donc
 *   sur `localStorage`.
 *
 * `localStorage` peut être indisponible (navigation privée, SSR) : dans ce cas
 * on mémoire les valeurs le temps de la session plutôt que de planter.
 */
const memory = new Map<string, string>();

const WEB = Platform.OS === 'web';

function readWeb(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeWeb(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

function removeWeb(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    memory.delete(key);
  }
}

/** Lit une valeur stockée, ou `null` si elle est absente. */
export async function getItem(key: string): Promise<string | null> {
  if (WEB) return readWeb(key);
  return SecureStore.getItemAsync(key);
}

/** Écrit une valeur. */
export async function setItem(key: string, value: string): Promise<void> {
  if (WEB) {
    writeWeb(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

/** Supprime une valeur (sans erreur si elle n'existe pas). */
export async function removeItem(key: string): Promise<void> {
  if (WEB) {
    removeWeb(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
