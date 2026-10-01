import { prisma } from '../lib/prisma';

/**
 * Idempotence des écritures (§— anti double-soumission).
 * Clé fournie par le client via l'en-tête `Idempotency-Key` ; la réponse
 * initialement produite est rejouée telle quelle en cas de resoumission.
 */
export interface Replay {
  statusCode: number;
  body: unknown;
}

export async function replayIfSeen(key: string, endpoint: string): Promise<Replay | null> {
  const record = await prisma.idempotencyRecord.findUnique({ where: { key } });
  if (!record || record.endpoint !== endpoint) return null;
  return { statusCode: record.statusCode, body: JSON.parse(record.body) as unknown };
}

export async function remember(key: string, endpoint: string, statusCode: number, body: unknown): Promise<void> {
  try {
    await prisma.idempotencyRecord.create({
      data: { key, endpoint, statusCode, body: JSON.stringify(body) },
    });
  } catch {
    // Course avec une soumission simultanée : la première réponse gagne, on ignore.
  }
}
