import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { api } from '@/lib/api';

/** Types d'export acceptés par `GET /reports/export.pdf?type=`. */
export type ReportExportType = 'daily' | 'monthly';

export interface ReportExportParams {
  type: ReportExportType;
  date?: string;
  year?: number;
  month?: number;
}

function fileName(params: ReportExportParams): string {
  if (params.type === 'monthly') {
    return `rapport-mensuel-${params.year}-${String(params.month).padStart(2, '0')}.pdf`;
  }
  return `rapport-quotidien-${params.date}.pdf`;
}

/**
 * Télécharge le PDF du rapport (jeton porté par l'instance axios), l'écrit
 * dans le cache de l'appareil puis ouvre la feuille de partage système.
 */
export async function exportAndShareReport(params: ReportExportParams): Promise<string> {
  const { data } = await api.get<ArrayBuffer>('/reports/export.pdf', {
    params,
    responseType: 'arraybuffer',
    timeout: 60_000,
  });

  const file = new File(Paths.cache, fileName(params));
  if (file.exists) file.delete();
  file.create();
  file.write(new Uint8Array(data));

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Le partage de fichiers n'est pas disponible sur cet appareil.");
  }

  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/pdf',
    dialogTitle: 'Partager le rapport',
    UTI: 'com.adobe.pdf',
  });

  return file.uri;
}

/** Premier jour du mois : `2026-10-01`. */
export function firstOfMonth(now: Date = new Date()): string {
  const p = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`;
}
