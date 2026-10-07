import { env } from '../config/env';

export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'last7d'
  | 'week'
  | 'month'
  | 'prevMonth'
  | 'year'
  | 'custom';

export interface PeriodRange {
  key: PeriodKey;
  /** Inclusif */
  from: Date;
  /** Exclusif */
  to: Date;
  label: string;
}

export const PERIOD_KEYS: PeriodKey[] = [
  'today',
  'yesterday',
  'last7d',
  'week',
  'month',
  'prevMonth',
  'year',
  'custom',
];

const TZ = env.BUSINESS_TIMEZONE;

/** Offset (en minutes) de la timezone cible par rapport à UTC, à un instant donné. */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** Convertit une heure locale (timezone du business) en instant UTC. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  timeZone = TZ,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ts = guess - tzOffsetMinutes(new Date(guess), timeZone) * 60_000;
  ts = guess - tzOffsetMinutes(new Date(ts), timeZone) * 60_000;
  return new Date(ts);
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0 = dimanche
  hours: number;
  minutes: number;
  seconds: number;
}

/** Décompose un instant UTC dans la timezone du business. */
export function toZonedParts(date: Date, timeZone = TZ): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: weekdayMap[map.weekday ?? 'Sun'] ?? 0,
    hours: Number(map.hour) % 24,
    minutes: Number(map.minute),
    seconds: Number(map.second),
  };
}

function startOfDay(d: Date): Date {
  const p = toZonedParts(d);
  return zonedToUtc(p.year, p.month, p.day);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

function fmtDate(d: Date): string {
  return toZonedParts(d).day.toString().padStart(2, '0');
}

function fmtMonthYear(d: Date): string {
  const p = toZonedParts(d);
  const months = [
    'janvier',
    'février',
    'mars',
    'avril',
    'mai',
    'juin',
    'juillet',
    'août',
    'septembre',
    'octobre',
    'novembre',
    'décembre',
  ];
  return `${months[p.month - 1]} ${p.year}`;
}

/**
 * Résout un preset de période en une plage UTC [from, to).
 * Les bornes sont calculées dans `BUSINESS_TIMEZONE` (§ A13).
 */
export function resolvePeriod(
  key: PeriodKey,
  now: Date = new Date(),
  custom?: { from?: string | Date; to?: string | Date },
): PeriodRange {
  const todayStart = startOfDay(now);

  switch (key) {
    case 'today': {
      const to = addDays(todayStart, 1);
      return { key, from: todayStart, to, label: 'Aujourd\'hui' };
    }
    case 'yesterday': {
      const from = addDays(todayStart, -1);
      return { key, from, to: todayStart, label: 'Hier' };
    }
    case 'last7d': {
      return { key, from: addDays(todayStart, -6), to: addDays(todayStart, 1), label: '7 derniers jours' };
    }
    case 'week': {
      const p = toZonedParts(todayStart);
      const mondayOffset = p.weekday === 0 ? -6 : 1 - p.weekday;
      const from = addDays(todayStart, mondayOffset);
      return { key, from, to: addDays(todayStart, 1), label: 'Semaine en cours' };
    }
    case 'month': {
      const p = toZonedParts(todayStart);
      return {
        key,
        from: zonedToUtc(p.year, p.month, 1),
        to: addDays(todayStart, 1),
        label: `Mois actuel (${fmtMonthYear(todayStart)})`,
      };
    }
    case 'prevMonth': {
      const p = toZonedParts(todayStart);
      const prev = p.month === 1 ? { year: p.year - 1, month: 12 } : { year: p.year, month: p.month - 1 };
      const from = zonedToUtc(prev.year, prev.month, 1);
      const to = zonedToUtc(p.year, p.month, 1);
      return { key, from, to, label: `Mois précédent (${fmtMonthYear(from)})` };
    }
    case 'year': {
      const p = toZonedParts(todayStart);
      return { key, from: zonedToUtc(p.year, 1, 1), to: addDays(todayStart, 1), label: `Année ${p.year}` };
    }
    case 'custom': {
      const fromRaw = custom?.from;
      const toRaw = custom?.to;
      if (!fromRaw || !toRaw) {
        throw new Error('La période personnalisée exige `from` et `to`');
      }
      const from = startOfDay(typeof fromRaw === 'string' ? new Date(fromRaw) : fromRaw);
      const toDate = typeof toRaw === 'string' ? new Date(toRaw) : toRaw;
      // `to` est inclusif en entrée → on le rend exclusif en ajoutant un jour.
      const to = addDays(startOfDay(toDate), 1);
      if (to.getTime() <= from.getTime()) {
        throw new Error('La date de fin doit être postérieure à la date de début');
      }
      return {
        key,
        from,
        to,
        label: `Du ${fmtDate(from)} au ${fmtDate(to)} personnalisé`,
      };
    }
    default: {
      throw new Error(`Période inconnue : ${String(key)}`);
    }
  }
}

/** Période englobante : de `from` jusqu'à la fin de `range` (pour les états à date). */
export function cumulativeUntil(range: PeriodRange): { from: Date; to: Date } {
  return { from: new Date(0), to: range.to };
}

/**
 * Une seule résolution de période pour les listes HTTP (§38) : un preset
 * nommé est résolu côté serveur, `custom` repose sur `from`/`to` (validés
 * par le schéma) dont la borne de fin devient exclusive.
 */
export function resolveRange(query: {
  period?: PeriodKey;
  from?: Date;
  to?: Date;
}): { from?: Date; to?: Date } {
  if (!query.period) return { from: query.from, to: query.to };
  const range = resolvePeriod(
    query.period,
    new Date(),
    query.period === 'custom' ? { from: query.from, to: query.to } : undefined,
  );
  return { from: range.from, to: range.to };
}
