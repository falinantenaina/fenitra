/**
 * Prisma stocke les `DateTime` dans des colonnes `timestamp WITHOUT time zone`
 * en **UTC**. Lorsqu'un paramètre `Date` est passé tel quel à `$queryRaw`,
 * PostgreSQL le reçoit en `timestamptz` et le convertit en `timestamp` en
 * appliquant le fuseau de la **session** (`SET TimeZone` — ici `Europe/Moscow`,
 * +03). Chaque frontière de période est alors décalée de 3 heures, et
 * `GET /stock/summary?to=…` devient inopérant.
 *
 * On passe donc une chaîne ISO en UTC avec une conversion explicite
 * `${utc(d)}::timestamp` (Prisma envoie les chaînes typées `text` : PostgreSQL
 * refuse sinon l'opérateur `timestamp < text`). Les comparaisons deviennent
 * alors indépendantes du serveur (A13 : les bornes restent calculées côté
 * serveur en `Indian/Antananarivo` via `period.service`, puis transmises en UTC).
 */
export const utc = (d: Date): string => d.toISOString();
