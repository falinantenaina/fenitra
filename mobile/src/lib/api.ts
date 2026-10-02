import {
  create as createAxios,
  isAxiosError,
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';
import * as SecureStore from 'expo-secure-store';

/** Clés de stockage des jetons (SecureStore, chiffré par le système). */
export const ACCESS_TOKEN_KEY = 'gv_access_token';
export const REFRESH_TOKEN_KEY = 'gv_refresh_token';

/** URL de base de l'API — voir `.env.example`. */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:4000/api';

/** Format d'erreur renvoyé par le backend (`errorHandler`). */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

type RetriableConfig = InternalAxiosRequestConfig & { __retried?: boolean };

export const api = createAxios({
  baseURL: API_BASE_URL,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

/** Instance nue (sans intercepteurs) pour le rafraîchissement du jeton. */
const rawApi = createAxios({ baseURL: API_BASE_URL, timeout: 15_000 });

let refreshHandler: (() => Promise<string | null>) | null = null;
let unauthorizedHandler: (() => void) | null = null;

/** Injecté par le store d'authentification (évite les dépendances circulaires). */
export function setRefreshHandler(handler: () => Promise<string | null>): void {
  refreshHandler = handler;
}

/** Appelé quand aucun rafraîchissement n'est possible : déconnexion locale. */
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

api.interceptors.request.use(async (config) => {
  const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const config = error.config as RetriableConfig | undefined;
    const url = config?.url ?? '';
    const skipRefresh = url.includes('/auth/login') || url.includes('/auth/refresh');

    if (error.response?.status === 401 && !skipRefresh && config && !config.__retried && refreshHandler) {
      config.__retried = true;
      const token = await refreshHandler();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        return api.request(config);
      }
    }

    if (error.response?.status === 401) unauthorizedHandler?.();
    return Promise.reject(error);
  },
);

/** Rafraîchit l'access token ; renvoie `null` si le refresh a échoué. */
export async function refreshAccessToken(): Promise<string | null> {
  try {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;
    const { data } = await rawApi.post<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
      refreshToken,
    });
    await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.accessToken);
    if (data.refreshToken) await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

/** Message lisible pour l'utilisateur, tiré du corps `{ error: { message } }`. */
export function apiMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as ApiErrorBody | undefined;
    if (data?.error?.message) return data.error.message;
    if (!error.response) return 'Serveur injoignable — vérifiez la connexion réseau.';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Erreur inattendue';
}
