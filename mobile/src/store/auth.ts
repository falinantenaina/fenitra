import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  api,
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
    try {
      const accessToken = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
      if (!accessToken) {
        set({ status: 'signedOut', user: null });
        return;
      }
      const { data } = await api.get<AuthUser>('/auth/me');
      set({ status: 'signedIn', user: data });
    } catch {
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
    await clearTokens();
    set({ status: 'signedOut', user: null });
  },
}));

setRefreshHandler(refreshAccessToken);
setUnauthorizedHandler(() => {
  void useAuth.getState().signOut();
});
