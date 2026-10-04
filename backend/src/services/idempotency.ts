import { prisma } from '../lib/prisma';

/**
 * Idempotence des écritures (anti double-soumission).
 *
 * Le client fournit une clé dans l'en-tête `Idempotency-Key`. La clé est
 * **réclamée avant** d'exécuter l'écriture : deux soumissions simultanées
 * avec la même clé ne peuvent donc pas toutes les deux créer un document.
 * Une soumission en cours répond `pending` (409 côté route) ; une réponse
 * déjà produite est rejouée telle quelle.
 *
 * `statusCode = 0` = réclamation posée, réponse pas encore produite.
 * Une écriture qui échoue libère la clé (`releaseIdempotent`) pour que le
 * client puisse rejouer avec la même clé.
 *
 * **Scopage par utilisateur** : la clé brute n'est pas la clé primaire, elle
 * est préfixée par son auteur. Deux comptes peuvent employer la même valeur
 * sans jamais recevoir la réponse de l'autre.
 *
 * **Réclamations périmées** : si le process plante entre la réclamation et la
 * publication, `statusCode` reste à 0 pour toujours. Une clé plus vieille que
 * `STALE_PENDING_MS` est reprise ; les enregistrements au-delà de
 * `RECORD_TTL_MS` sont supprimés (purge opportuniste).
 */
export type IdempotentClaim =
  | { kind: 'replay'; statusCode: number; body: unknown }
  | { kind: 'pending' }
  | { kind: 'fresh' };

/** Une réclamation jamais publiée au-delà de ce délai est considérée périmée. */
const STALE_PENDING_MS = 5 * 60_000;
/** Durée de rétention d'une clé publiée. */
const RECORD_TTL_MS = 30 * 24 * 60 * 60_000;

const parse = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
};

/** Clé physique = auteur + valeur fournie par le client. */
function scopedKey(key: string, userId: string): string {
  return `${userId}:${key}`;
}

/** Lit l'en-tête `Idempotency-Key` ; `null` si absent ou vide. */
export function idempotencyKey(req: {
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  const raw = req.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.trim() ? value.trim().slice(0, 120) : null;
}

export async function beginIdempotent(
  key: string,
  endpoint: string,
  userId: string,
): Promise<IdempotentClaim> {
  const physicalKey = scopedKey(key, userId);

  // Opportuniste : on éponge les très vieilles écritures (index sur createdAt).
  void purgeIdempotency();

  // Petit nombre d'itérations : chaque tour ne fait que relire après une course.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await prisma.idempotencyRecord.findUnique({ where: { key: physicalKey } });

    if (!existing) {
      // `skipDuplicates` : si une soumission simultanée gagne la course, aucune
      // exception n'est levée — on relit simplement l'état de la clé.
      const created = await prisma.idempotencyRecord.createMany({
        data: { key: physicalKey, userId, endpoint, statusCode: 0, body: '' },
        skipDuplicates: true,
      });
      if (created.count === 1) return { kind: 'fresh' };
      continue;
    }

    // Clé réutilisée pour un autre endpoint : on se comporte comme sans clé.
    if (existing.endpoint !== endpoint) return { kind: 'fresh' };

    if (existing.statusCode !== 0) {
      return { kind: 'replay', statusCode: existing.statusCode, body: parse(existing.body) };
    }

    if (Date.now() - existing.createdAt.getTime() > STALE_PENDING_MS) {
      // Comparaison sur `createdAt` : seul l'auteur du constat peut reprendre.
      const reclaimed = await prisma.idempotencyRecord.updateMany({
        where: { key: physicalKey, statusCode: 0, createdAt: exactDate(existing.createdAt) },
        data: { endpoint, body: '', createdAt: new Date() },
      });
      if (reclaimed.count === 1) return { kind: 'fresh' };
      continue;
    }

    return { kind: 'pending' };
  }

  // Improbable : on préfère repasser outre plutôt qu'un 409 définitif à tort.
  return { kind: 'fresh' };
}

/** Publie la réponse produite ; no-op si la clé a changé d'endpoint ou a été libérée. */
export async function finishIdempotent(
  key: string,
  endpoint: string,
  statusCode: number,
  body: unknown,
  userId: string,
): Promise<void> {
  try {
    await prisma.idempotencyRecord.updateMany({
      where: { key: scopedKey(key, userId), endpoint },
      data: { statusCode, body: JSON.stringify(body) },
    });
  } catch {
    // La réclamation a disparu entre-temps : rien à publier.
  }
}

/** Libère la réclamation après un échec : le client peut rejouer. */
export async function releaseIdempotent(key: string, userId: string): Promise<void> {
  try {
    await prisma.idempotencyRecord.delete({ where: { key: scopedKey(key, userId) } });
  } catch {
    // Déjà absente.
  }
}

/** Supprime les clés plus vieilles que la durée de rétention. */
async function purgeIdempotency(): Promise<void> {
  try {
    await prisma.idempotencyRecord.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - RECORD_TTL_MS) } },
    });
  } catch {
    // Best effort : la purge ne doit jamais faire échouer une écriture.
  }
}

/** Date à la milliseconde près, pour une condition atomique. */
function exactDate(value: Date): Date {
  return new Date(Math.floor(value.getTime()));
}
