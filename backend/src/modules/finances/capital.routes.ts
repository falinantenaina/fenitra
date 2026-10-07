import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { idParamSchema } from '../../lib/zod';
import {
  capitalListQuery,
  createCapitalSchema,
  reasonSchema,
  updateCapitalSchema,
} from './capital.schemas';
import {
  capitalDestinations,
  createCapital,
  deleteCapital,
  listCapital,
  loadCapital,
  updateCapital,
} from './capital.service';

export const capitalRouter = Router();

/** GET /api/personal-capital */
capitalRouter.get(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    res.json(await listCapital(parseQuery(req, capitalListQuery)));
  }),
);

/** POST /api/personal-capital — IN = injection, OUT = récupération (§34) */
capitalRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createCapital(parseBody(req, createCapitalSchema), req.user!.id));
  }),
);

/** GET /api/personal-capital/:id/destinations — §33 traçabilité (A7) */
capitalRouter.get(
  '/:id/destinations',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await capitalDestinations(id));
  }),
);

/** GET /api/personal-capital/:id */
capitalRouter.get(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await loadCapital(prisma, id));
  }),
);

/** PUT /api/personal-capital/:id — type figé, montant corrigé par contre-passation */
capitalRouter.put(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await updateCapital(id, parseBody(req, updateCapitalSchema), req.user!.id));
  }),
);

/** DELETE /api/personal-capital/:id */
capitalRouter.delete(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await deleteCapital(id, parseBody(req, reasonSchema).reason, req.user!.id));
  }),
);
