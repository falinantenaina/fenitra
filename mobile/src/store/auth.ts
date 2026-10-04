import { isAxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  api,
  isRefreshInconclusive,
  refreshAccessToken,
  setRefreshHandler,
  setUnauthorizedHandler,
} from '@/lib/api';

export type RoleName = 'ADMIN' | 'MANAGER' | 'CASHIER';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: RoleName;
}

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Relit les jetons stockés et restaure la session (`GET /auth/me`). */
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  /** Révoque le refresh token côté serveur puis efface la session locale. */
  logout: () => Promise<void>;
  /** Efface la session sans appel réseau (401, jeton expiré…). */
  signOut: () => Promise<void>;
}

async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
}

export const useAuth = create<AuthState>()((set, get) => ({
  status: 'loading',
  user: null,

  hydrate: async () => {
    const accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
    if (!accessToken) {
      set({ status: 'signedOut', user: null });
      return;
    }
    try {
      const { data } = await api.get<AuthUser>('/auth/me');
      set({ status: 'signedIn', user: data });
    } catch (error) {
      // Réseau indisponible (ou refresh impossible) : les jetons sont encore
      // bons, on ouvre la session sans profil et on retentera en arrière-plan.
      if (isAxiosError(error) && (!error.response || isRefreshInconclusive(error))) {
        set({ status: 'signedIn', user: null });
        scheduleUserRetry(set, get);
        return;
      }
      await clearTokens();
      set({ status: 'signedOut', user: null });
    }
  },

  login: async (email, password) => {
    const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
    await saveTokens(data.accessToken, data.refreshToken);
    set({ status: 'signedIn', user: data.user });
  },

  logout: async () => {
    stopUserRetry();
    const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    if (refreshToken) {
      try {
        await api.post('/auth/logout', { refreshToken });
      } catch {
        // La session est déjà révoquée ou le serveur est hors ligne : on part quand même.
      }
    }
    await clearTokens();
    set({ status: 'signedOut', user: null });
  },

  signOut: async () => {
    if (get().status === 'signedOut') return;
    stopUserRetry();
    await clearTokens();
    set({ status: 'signedOut', user: null });
  },
}));

/** Retente `GET /auth/me` tant que le profil est absent (démarrage hors-ligne). */
let userRetryTimer: ReturnType<typeof setTimeout> | null = null;
let userRetryCount = 0;
const USER_RETRY_DELAY_MS = 4_000;
const USER_RETRY_MAX = 15;

function stopUserRetry(): void {
  if (userRetryTimer) clearTimeout(userRetryTimer);
  userRetryTimer = null;
  userRetryCount = 0;
}

function scheduleUserRetry(
  set: (partial: Partial<AuthState>) => void,
  get: () => AuthState,
): void {
  if (userRetryTimer) {
    clearTimeout(userRetryTimer);
    userRetryTimer = null;
  }
  if (userRetryCount >= USER_RETRY_MAX) return;
  const delay = Math.min(USER_RETRY_DELAY_MS * (userRetryCount < 4 ? 1 : 2), 30_000);
  userRetryTimer = setTimeout(() => {
    userRetryTimer = null;
    userRetryCount += 1;
    void (async () => {
      if (get().status !== 'signedIn' || get().user) return;
      try {
        const { data } = await api.get<AuthUser>('/auth/me');
        stopUserRetry();
        set({ status: 'signedIn', user: data });
      } catch (error) {
        if (isAxiosError(error) && error.response && !isRefreshInconclusive(error)) {
          // Refus définitif du serveur : la session est morte.
          stopUserRetry();
          void useAuth.getState().signOut();
          return;
        }
        scheduleUserRetry(set, get);
      }
    })();
  }, delay);
}

setRefreshHandler(refreshAccessToken);
setUnauthorizedHandler(() => {
  void useAuth.getState().signOut();
});
