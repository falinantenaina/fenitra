import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { RoleName, User } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { conflict, unauthorized } from '../../lib/errors';
import {
  hashToken,
  signAccessToken,
  signRefreshToken,
  ttlSeconds,
  verifyRefreshToken,
} from '../../utils/jwt';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: RoleName;
}

type UserWithRole = User & { role: { name: RoleName } };

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

const toPublic = (u: Pick<User, 'id' | 'email' | 'name'> & { role: { name: RoleName } }): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role.name,
});

/** Hash de comparaison quand l'utilisateur n'existe pas (protection timing). */
const DUMMY_HASH = bcrypt.hashSync('definitely-not-a-password', 10);

interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

async function issueTokens(user: UserWithRole, meta: RequestMeta): Promise<TokenPair> {
  const sessionId = crypto.randomUUID();
  const refreshToken = signRefreshToken(user.id, sessionId);

  await prisma.session.create({
    data: {
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + ttlSeconds(env.JWT_REFRESH_TTL) * 1000),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });

  return {
    accessToken: signAccessToken({ id: user.id, email: user.email, name: user.name, role: user.role.name }),
    refreshToken,
    user: toPublic(user),
  };
}

export async function login(
  email: string,
  password: string,
  meta: RequestMeta = {},
): Promise<TokenPair> {
  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });

  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Email ou mot de passe incorrect');
  if (!user.active) throw unauthorized('Ce compte est désactivé');

  const tokens = await issueTokens(user, meta);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  return tokens;
}

export async function refresh(refreshToken: string, meta: RequestMeta = {}): Promise<TokenPair> {
  const payload = verifyRefreshToken(refreshToken);

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: { user: { include: { role: true } } },
  });

  if (!session) throw unauthorized('Session introuvable');
  if (session.userId !== payload.sub) throw unauthorized('Session invalide');
  if (session.revokedAt) throw unauthorized('Session déjà révoquée');
  if (session.expiresAt.getTime() < Date.now()) throw unauthorized('Session expirée');
  if (session.refreshTokenHash !== hashToken(refreshToken)) throw unauthorized('Jeton inconnu');

  // Rotation : l'ancienne session est révoquée, une nouvelle est créée.
  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date(), lastUsedAt: new Date() },
  });

  if (!session.user.active) throw unauthorized('Ce compte est désactivé');

  return issueTokens(session.user, meta);
}

export async function logout(refreshToken: string): Promise<void> {
  const payload = verifyRefreshToken(refreshToken);
  const session = await prisma.session.findUnique({ where: { id: payload.sid } });
  if (!session || session.refreshTokenHash !== hashToken(refreshToken)) return;
  if (session.revokedAt) return;
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
}

export async function logoutAll(userId: string): Promise<number> {
  const res = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

export async function getMe(userId: string): Promise<PublicUser> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!user) throw unauthorized('Utilisateur introuvable');
  return toPublic(user);
}

export async function listSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, createdAt: true, lastUsedAt: true, ip: true, userAgent: true },
    orderBy: { createdAt: 'desc' },
  });
}

export { conflict };
