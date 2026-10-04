import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState, type PropsWithChildren } from 'react';

/**
 * On ne rejoue que les erreurs qui peuvent réussir au second essai :
 * coupure réseau, timeout, 5xx. Les 4xx (validation, 404, 403) sont définitifs.
 */
function shouldRetry(failureCount: number, error: Error): boolean {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status !== undefined && status >= 400 && status < 500) return false;
  }
  return failureCount < 1;
}

export function QueryProvider({ children }: PropsWithChildren) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: shouldRetry, refetchOnWindowFocus: false },
          mutations: { retry: 0 },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
