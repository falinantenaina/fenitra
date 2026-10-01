import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin, requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { idParamSchema } from '../../lib/zod';
import { resolvePeriod } from '../../services/period.service';
import {
  createVersementSchema,
  reasonSchema,
  summaryQuery,
  updateVersementSchema,
  versementListQuery,
} from './versements.schemas';
import {
  createVersement,
  deleteVersement,
  listVersements,
  loadVersement,
  updateVersement,
  versementsSummary,
} from './versements.service';

export const versementsRouter = Router();

/** GET /api/versements */
versementsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listVersements(parseQuery(req, versementListQuery)));
  }),
);

/** GET /api/versements/summary?personName&period — §38 historique par personne */
versementsRouter.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, summaryQuery);
    const ranged =
      query.period && query.period !== 'custom'
        ? resolvePeriod(query.period, new Date())
        : null;

    res.json(
      await versementsSummary({
        ...query,
        from: ranged?.from ?? query.from,
        to: ranged?.to ?? query.to,
      }),
    );
  }),
);

/** POST /api/versements — A2 : CHARGE ou DEBT_SETTLEMENT */
versementsRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createVersement(parseBody(req, createVersementSchema), req.user!.id));
  }),
);

/** GET /api/versements/:id */
versementsRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await loadVersement(prisma, id));
  }),
);

/** PUT /api/versements/:id — métadonnées uniquement (montant/ traitement figés) */
versementsRouter.put(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await updateVersement(id, parseBody(req, updateVersementSchema)));
  }),
);

/** DELETE /api/versements/:id — contre-passation + annulation de l'effet sur la dette */
versementsRouter.delete(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await deleteVersement(id, parseBody(req, reasonSchema).reason, req.user!.id));
  }),
);
