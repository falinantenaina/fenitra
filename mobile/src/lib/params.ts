/**
 * Normalise un paramètre d'URL : `expo-router` renvoie `string | string[]`
 * (un tableau si la route admet plusieurs segments). Tableau → 1re valeur.
 */
export function pick(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}
