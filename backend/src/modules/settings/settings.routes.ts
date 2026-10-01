import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin, requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { conflict, notFound } from '../../lib/errors';
import { boolFilter } from '../../lib/pagination';

const idParamSchema = z.object({ id: z.string().min(1, 'Identifiant requis') });

export const settingsRouter = Router();

/* ════════════════════ RÉGLAGES CLÉ/VALEUR ════════════════════ */

/** GET /api/settings → objet plat { cle: valeur } */
settingsRouter.get(
  '/settings',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  }),
);

const settingsSchema = z
  .record(z.string().trim().min(1).max(64), z.string().max(4000))
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun réglage à mettre à jour' });

/** PUT /api/settings — fusion (les clés absentes ne sont pas touchées) */
settingsRouter.put(
  '/settings',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, settingsSchema);
    const entries = Object.entries(body);

    await prisma.$transaction(
      entries.map(([key, value]) => prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } })),
    );

    const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  }),
);

/* ════════════════════ CATÉGORIES DE DÉPENSES ════════════════════ */

const categorySchema = z.object({
  name: z.string().trim().min(2, 'Nom requis').max(80),
  icon: z.string().trim().max(40).nullish(),
  order: z.number().int().min(0).optional(),
});

const categoryUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    icon: z.string().trim().max(40).nullish(),
    order: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ à mettre à jour' });

const categoryListQuery = z.object({
  active: z.enum(['true', 'false']).optional(),
});

const toCategory = (c: { id: string; name: string; icon: string | null; order: number; active: boolean }) => ({
  id: c.id,
  name: c.name,
  icon: c.icon,
  order: c.order,
  active: c.active,
});

/** GET /api/expense-categories */
settingsRouter.get(
  '/expense-categories',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = parseQuery(req, categoryListQuery);
    const items = await prisma.expenseCategory.findMany({
      where: boolFilter(q.active) !== undefined ? { active: boolFilter(q.active) } : {},
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    res.json({ items: items.map(toCategory), total: items.length });
  }),
);

/** POST /api/expense-categories */
settingsRouter.post(
  '/expense-categories',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, categorySchema);
    const exists = await prisma.expenseCategory.findUnique({ where: { name: body.name } });
    if (exists) throw conflict(`La catégorie ${body.name} existe déjà`);

    const category = await prisma.expenseCategory.create({
      data: { name: body.name, icon: body.icon ?? null, order: body.order ?? 0 },
    });
    res.status(201).json(toCategory(category));
  }),
);

/** PUT /api/expense-categories/:id — `active:false` = désactivation (§36, jamais de suppression) */
settingsRouter.put(
  '/expense-categories/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, categoryUpdateSchema);

    const existing = await prisma.expenseCategory.findUnique({ where: { id } });
    if (!existing) throw notFound('Catégorie introuvable');

    if (body.name !== undefined && body.name !== existing.name) {
      const taken = await prisma.expenseCategory.findUnique({ where: { name: body.name } });
      if (taken) throw conflict(`La catégorie ${body.name} existe déjà`);
    }

    const data: { name?: string; icon?: string | null; order?: number; active?: boolean } = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.icon !== undefined) data.icon = body.icon;
    if (body.order !== undefined) data.order = body.order;
    if (body.active !== undefined) data.active = body.active;

    const category = await prisma.expenseCategory.update({ where: { id }, data });
    res.json(toCategory(category));
  }),
);

/* ════════════════════ MODES DE PAIEMENT ════════════════════ */

const methodSchema = z.object({
  name: z.string().trim().min(2, 'Nom requis').max(40),
  order: z.number().int().min(0).optional(),
});

const methodUpdateSchema = z
  .object({ order: z.number().int().min(0).optional(), active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: 'Aucun champ à mettre à jour' });

const toMethod = (m: { id: string; name: string; order: number; active: boolean }) => ({
  id: m.id,
  name: m.name,
  order: m.order,
  active: m.active,
});

/** GET /api/payment-methods */
settingsRouter.get(
  '/payment-methods',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const items = await prisma.paymentMethod.findMany({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    res.json({ items: items.map(toMethod), total: items.length });
  }),
);

/** POST /api/payment-methods */
settingsRouter.post(
  '/payment-methods',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, methodSchema);
    const exists = await prisma.paymentMethod.findUnique({ where: { name: body.name } });
    if (exists) throw conflict(`Le mode de paiement ${body.name} existe déjà`);

    const method = await prisma.paymentMethod.create({
      data: { name: body.name, order: body.order ?? 0 },
    });
    res.status(201).json(toMethod(method));
  }),
);

/** PATCH /api/payment-methods/:id */
settingsRouter.patch(
  '/payment-methods/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, methodUpdateSchema);

    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing) throw notFound('Mode de paiement introuvable');

    const data: { order?: number; active?: boolean } = {};
    if (body.order !== undefined) data.order = body.order;
    if (body.active !== undefined) data.active = body.active;

    const method = await prisma.paymentMethod.update({ where: { id }, data });
    res.json(toMethod(method));
  }),
);
