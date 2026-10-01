import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams } from '../../middleware/validate';
import { adminOnly, requireAuth, requireRole } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { conflict, notFound } from '../../lib/errors';
import {
  changePasswordSchema,
  createUserSchema,
  idParamSchema,
  resetPasswordSchema,
  updateUserSchema,
} from '../auth/auth.schemas';

export const usersRouter = Router();

/** GET /api/users */
usersRouter.get(
  '/',
  adminOnly,
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, active: true, lastLoginAt: true, createdAt: true, role: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json(
      users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role.name, active: u.active, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt })),
    );
  }),
);

/** GET /api/users/roles — liste des rôles (ADMIN ou MANAGER) */
usersRouter.get(
  '/roles',
  requireAuth,
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (_req, res) => {
    const roles = await prisma.role.findMany({ orderBy: { name: 'asc' } });
    res.json(roles.map((r) => r.name));
  }),
);

/** POST /api/users/me/password — changement par l'utilisateur lui-même */
usersRouter.post(
  '/me/password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, changePasswordSchema);
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw notFound('Utilisateur introuvable');

    const ok = await bcrypt.compare(body.currentPassword, user.passwordHash);
    if (!ok) throw conflict('Mot de passe actuel incorrect');

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 10) },
    });
    await prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    res.status(204).end();
  }),
);

/** POST /api/users */
usersRouter.post(
  '/',
  adminOnly,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, createUserSchema);
    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) throw conflict(`Un utilisateur existe déjà avec l'email ${body.email}`);

    const role = await prisma.role.findUnique({ where: { name: body.role } });
    if (!role) throw notFound('Rôle inconnu');

    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        passwordHash: await bcrypt.hash(body.password, 10),
        roleId: role.id,
      },
      include: { role: true },
    });

    res.status(201).json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.name,
      active: user.active,
    });
  }),
);

/** PATCH /api/users/:id */
usersRouter.patch(
  '/:id',
  adminOnly,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, updateUserSchema);

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound('Utilisateur introuvable');

    // Un administrateur ne peut ni se désactiver seul ni perdre son propre rôle.
    if (id === req.user!.id && (body.active === false || (body.role && body.role !== 'ADMIN'))) {
      throw conflict('Impossible de modifier votre propre accès de cette manière');
    }

    const data: { name?: string; active?: boolean; roleId?: string } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.active !== undefined) data.active = body.active;
    if (body.role !== undefined) {
      const role = await prisma.role.findUnique({ where: { name: body.role } });
      if (!role) throw notFound('Rôle inconnu');
      data.roleId = role.id;
    }

    const user = await prisma.user.update({ where: { id }, data, include: { role: true } });
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role.name,
      active: user.active,
    });
  }),
);

/** POST /api/users/:id/password — réinitialisation par un administrateur */
usersRouter.post(
  '/:id/password',
  adminOnly,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, resetPasswordSchema);

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throw notFound('Utilisateur introuvable');

    await prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(body.newPassword, 10) },
    });
    await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });

    res.status(204).end();
  }),
);
