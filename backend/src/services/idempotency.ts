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
 * client puisse réessayer avec la même clé.
 */
export type IdempotentClaim =
  | { kind: 'replay'; statusCode: number; body: unknown }
  | { kind: 'pending' }
  | { kind: 'fresh' };

const parse = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
};

export async function beginIdempotent(key: string, endpoint: string): Promise<IdempotentClaim> {
  const existing = await prisma.idempotencyRecord.findUnique({ where: { key } });

  if (!existing) {
    // `skipDuplicates` : si une soumission simultanée gagne la course, aucune
    // exception n'est levée — on relit simplement l'état de la clé.
    const created = await prisma.idempotencyRecord.createMany({
      data: { key, endpoint, statusCode: 0, body: '' },
      skipDuplicates: true,
    });
    if (created.count === 1) return { kind: 'fresh' };

    const raced = await prisma.idempotencyRecord.findUnique({ where: { key } });
    if (!raced) return { kind: 'fresh' };
    if (raced.endpoint !== endpoint) return { kind: 'fresh' };
    if (raced.statusCode === 0) return { kind: 'pending' };
    return { kind: 'replay', statusCode: raced.statusCode, body: parse(raced.body) };
  }

  // Clé réutilisée pour un autre endpoint : on se comporte comme sans clé.
  if (existing.endpoint !== endpoint) return { kind: 'fresh' };
  if (existing.statusCode === 0) return { kind: 'pending' };
  return { kind: 'replay', statusCode: existing.statusCode, body: parse(existing.body) };
}

/** Publie la réponse produite ; no-op si la clé a changé d'endpoint ou a été libérée. */
export async function finishIdempotent(
  key: string,
  endpoint: string,
  statusCode: number,
  body: unknown,
): Promise<void> {
  try {
    await prisma.idempotencyRecord.updateMany({
      where: { key, endpoint },
      data: { statusCode, body: JSON.stringify(body) },
    });
  } catch {
    // La réclamation a disparu entre-temps : rien à publier.
  }
}

/** Libère la réclamation après un échec : le client peut réessayer. */
export async function releaseIdempotent(key: string): Promise<void> {
  try {
    await prisma.idempotencyRecord.delete({ where: { key } });
  } catch {
    // Déjà absente.
  }
}
