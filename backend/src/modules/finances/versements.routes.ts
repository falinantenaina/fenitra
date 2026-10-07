import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { idParamSchema } from '../../lib/zod';
import { resolveRange } from '../../services/period.service';
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

/** §38 — la résolution de période (`resolveRange`) est partagée avec les autres listes. */

/** GET /api/versements — §38 : filtres `period`, `from`/`to`, `personName` */
versementsRouter.get(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, versementListQuery);
    res.json(await listVersements({ ...query, ...resolveRange(query) }));
  }),
);

/** GET /api/versements/summary?personName&period — §38 historique par personne */
versementsRouter.get(
  '/summary',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, summaryQuery);
    res.json(await versementsSummary({ ...query, ...resolveRange(query) }));
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
  managerOrAdmin,
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
