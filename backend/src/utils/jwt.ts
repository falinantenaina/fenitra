import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { RoleName } from '@prisma/client';
import { env } from '../config/env';
import { unauthorized } from '../lib/errors';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  role: RoleName;
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  typ: 'refresh';
}

export interface SignableUser {
  id: string;
  email: string;
  name: string;
  role: RoleName;
}

export function signAccessToken(user: SignableUser): string {
  const payload: AccessTokenPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: ttlSeconds(env.JWT_ACCESS_TTL),
    issuer: 'gestion-vente',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'gestion-vente' }) as AccessTokenPayload;
  } catch {
    throw unauthorized('Jeton invalide ou expiré');
  }
}

export function signRefreshToken(userId: string, sessionId: string): string {
  const payload: RefreshTokenPayload = { sub: userId, sid: sessionId, typ: 'refresh' };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: ttlSeconds(env.JWT_REFRESH_TTL),
    issuer: 'gestion-vente',
  });
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: 'gestion-vente',
    }) as RefreshTokenPayload;
    if (payload.typ !== 'refresh') throw new Error('wrong typ');
    return payload;
  } catch {
    throw unauthorized('Jeton de rafraîchissement invalide ou expiré');
  }
}

/** Empreinte d'un refresh token stockée en base (jamais le jeton lui-même). */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Durée de vie en secondes d'une chaîne ISO-8601 duration ('15m', '30d'). */
export function ttlSeconds(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) return 900;
  const value = Number(m[1]);
  switch (m[2]) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86_400;
    default:
      return 900;
  }
}
