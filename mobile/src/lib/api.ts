import {
  create as createAxios,
  isAxiosError,
  type AxiosError,
  type InternalAxiosRequestConfig,
} from "axios";
import { getItem, setItem } from "./storage";

/** Clés de stockage des jetons (SecureStore sur natif, localStorage sur web). */
export const ACCESS_TOKEN_KEY = "gv_access_token";
export const REFRESH_TOKEN_KEY = "gv_refresh_token";

/** URL de base de l'API — voir `.env.example`. */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:4000/api";

/** Format d'erreur renvoyé par le backend (`errorHandler`). */
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

type RetriableConfig = InternalAxiosRequestConfig & { __retried?: boolean };

/** Marque posée sur une erreur 401 dont le refresh a échoué pour raison réseau. */
interface RefreshMarkedError {
  __refreshInconclusive?: boolean;
}

/**
 * `true` quand un 401 provient d'un refresh impossible à réaliser (réseau) :
 * le refus du serveur n'est pas certain, il ne faut pas déconnecter l'utilisateur.
 */
export function isRefreshInconclusive(error: unknown): boolean {
  return Boolean(
    (error as RefreshMarkedError | null | undefined)?.__refreshInconclusive,
  );
}

export const api = createAxios({
  baseURL: API_BASE_URL,
  timeout: 20_000,
  headers: { "Content-Type": "application/json" },
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
  const token = await getItem(ACCESS_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const config = error.config as RetriableConfig | undefined;
    const url = config?.url ?? "";
    const skipRefresh =
      url.includes("/auth/login") || url.includes("/auth/refresh");

    if (
      error.response?.status === 401 &&
      !skipRefresh &&
      config &&
      !config.__retried &&
      refreshHandler
    ) {
      config.__retried = true;
      let token: string | null = null;
      try {
        token = await refreshHandler();
      } catch {
        // Erreur réseau pendant le refresh : le refus du serveur n'est pas
        // certain, on marque l'erreur pour que le caller ne déconnecte pas.
        (error as RefreshMarkedError).__refreshInconclusive = true;
        return Promise.reject(error);
      }
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
        return api.request(config);
      }
    }

    if (error.response?.status === 401) unauthorizedHandler?.();
    return Promise.reject(error);
  },
);

/** Refresh en cours : partagé par toutes les requêtes concurrentes (mutex). */
let refreshInFlight: Promise<string | null> | null = null;

async function runRefresh(): Promise<string | null> {
  const refreshToken = await getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;
  try {
    const { data } = await rawApi.post<{
      accessToken: string;
      refreshToken: string;
    }>("/auth/refresh", {
      refreshToken,
    });
    await setItem(ACCESS_TOKEN_KEY, data.accessToken);
    if (data.refreshToken) await setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    return data.accessToken;
  } catch (error) {
    // Refus définitif du serveur (401/403) : jeton révoqué ou expiré.
    if (isAxiosError(error) && error.response) return null;
    // Sinon (réseau, timeout) : on propage pour que le caller ne déconnecte pas.
    throw error;
  }
}

/**
 * Rafraîchit l'access token ; renvoie `null` si le serveur a refusé.
 * Plusieurs appels simultanés partagent un seul `POST /auth/refresh` — le
 * backend révoque le refresh token utilisé, un second appel échouerait.
 * Lève une erreur si le refresh a échoué pour raison réseau.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = runRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Message lisible pour l'utilisateur, tiré du corps `{ error: { message } }`. */
export function apiMessage(error: unknown): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as ApiErrorBody | undefined;
    if (data?.error?.message) return data.error.message;
    if (!error.response)
      return "Serveur injoignable — vérifiez la connexion réseau.";
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Erreur inattendue";
}
