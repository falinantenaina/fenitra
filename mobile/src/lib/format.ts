/** Groupe les milliers avec une espace insécable fine — sans dépendre d'Intl. */
function group(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** `"1915000.00"` → `1 915 000 Ar` (les montants arrivent en string, §11). */
export function formatMoney(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const whole = Math.floor(abs);
  const cents = Math.round((abs - whole) * 100);
  const main = `${sign}${group(String(whole))}`;
  return cents > 0 ? `${main},${String(cents).padStart(2, '0')} Ar` : `${main} Ar`;
}

/** ISO → `02/10/2026 09:15` (heure locale de l'appareil). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (v: number) => String(v).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Nombre entiel avec groupement (`31`). */
export function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return group(String(Math.round(value)));
}
