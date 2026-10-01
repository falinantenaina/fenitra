import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RoleName } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { forbidden, unauthorized } from '../lib/errors';
import { verifyAccessToken } from '../utils/jwt';

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}

/**
 * Vérifie le JWT d'accès et recharge l'utilisateur depuis la base
 * (un compte désactivé ou un rôle rétrogradé est immédiatement périmé).
 */
export const requireAuth: RequestHandler = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const token = extractBearer(req);
    if (!token) throw unauthorized('En-tête Authorization manquant');

    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });

    if (!user || !user.active) throw unauthorized('Compte introuvable ou désactivé');

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.name,
    };
    next();
  } catch (err) {
    next(err);
  }
};

/** Restreint l'accès à certains rôles (§57 — RBAC). */
export function requireRole(...roles: RoleName[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(forbidden(`Rôle ${req.user.role} non autorisé (requis : ${roles.join(', ')})`));
      return;
    }
    next();
  };
}

/** Combiné : authentifié + rôle autorisé. */
export const adminOnly = [requireAuth, requireRole('ADMIN')];
export const managerOrAdmin = [requireAuth, requireRole('ADMIN', 'MANAGER')];
