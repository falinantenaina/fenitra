import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { idParamSchema } from '../../lib/zod';
import { resolveRange } from '../../services/period.service';
import {
  createProfitDrawingSchema,
  profitDrawingListQuery,
  reasonSchema,
} from './profit-drawings.schemas';
import {
  createProfitDrawing,
  deleteProfitDrawing,
  listProfitDrawings,
  loadDrawing,
} from './profit-drawings.service';

export const profitDrawingsRouter = Router();

/**
 * § A5 / §45 — RBAC : manager ou admin. Un retrait sort de la caisse et déplace
 * le bénéfice : le caissier n'en lit ni n'en écrit (403).
 */

/** GET /api/profit-drawings — §38 : filtres `period`, `from`/`to`, recherche `q` */
profitDrawingsRouter.get(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, profitDrawingListQuery);
    res.json(await listProfitDrawings({ ...query, ...resolveRange(query) }));
  }),
);

/** POST /api/profit-drawings — plafond = bénéfice encaissé non sorti, refus 409 au-delà */
profitDrawingsRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createProfitDrawing(parseBody(req, createProfitDrawingSchema), req.user!.id));
  }),
);

/** GET /api/profit-drawings/:id */
profitDrawingsRouter.get(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await loadDrawing(prisma, id));
  }),
);

/** DELETE /api/profit-drawings/:id — contre-passation du retrait */
profitDrawingsRouter.delete(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await deleteProfitDrawing(id, parseBody(req, reasonSchema).reason, req.user!.id));
  }),
);
