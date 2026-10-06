import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin, requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { conflict } from '../../lib/errors';
import { idempotencyKey, beginIdempotent, finishIdempotent, releaseIdempotent } from '../../services/idempotency';
import {
  cancelSchema,
  createArrivalSchema,
  idParamSchema,
  arrivalListQuery,
  updateArrivalSchema,
  ventilateSchema,
} from './arrivals.schemas';
import {
  cancelArrival,
  createArrival,
  listArrivals,
  loadArrival,
  previewArrivalReference,
  updateArrival,
  ventilateArrival,
} from './arrivals.service';

export const arrivalsRouter = Router();

/** GET /api/arrivals/reference-preview — prochaine référence, sans la consommer */
arrivalsRouter.get(
  '/reference-preview',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ reference: await previewArrivalReference() });
  }),
);

/** GET /api/arrivals */
arrivalsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, arrivalListQuery);
    res.json(await listArrivals(query));
  }),
);

/** POST /api/arrivals — transaction complète (§55), idempotent si `Idempotency-Key` */
arrivalsRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, createArrivalSchema);
    const key = idempotencyKey(req);
    const endpoint = 'POST /arrivals';
    const claim = key ? await beginIdempotent(key, endpoint, req.user!.id) : null;

    if (claim?.kind === 'replay') {
      res.status(claim.statusCode).json(claim.body);
      return;
    }
    if (claim?.kind === 'pending') {
      throw conflict('Une soumission identique est déjà en cours — réessayez.');
    }

    try {
      const arrival = await createArrival(body, req.user!.id);
      if (key) await finishIdempotent(key, endpoint, 201, arrival, req.user!.id);
      res.status(201).json(arrival);
    } catch (error) {
      if (key) await releaseIdempotent(key, req.user!.id);
      throw error;
    }
  }),
);

/** GET /api/arrivals/:id — cartons + lignes + lots + dette + paiements + financements */
arrivalsRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await loadArrival(prisma, id));
  }),
);

/** PATCH /api/arrivals/:id — modification complète, stock intact requis */
arrivalsRouter.patch(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, updateArrivalSchema);
    res.json(await updateArrival(id, body, req.user!.id));
  }),
);

/** POST /api/arrivals/:id/ventilate — pointures d'un carton déjà enregistré */
arrivalsRouter.post(
  '/:id/ventilate',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, ventilateSchema);
    const key = idempotencyKey(req);
    const endpoint = 'POST /arrivals/:id/ventilate';
    const claim = key ? await beginIdempotent(key, endpoint, req.user!.id) : null;

    if (claim?.kind === 'replay') {
      res.status(claim.statusCode).json(claim.body);
      return;
    }
    if (claim?.kind === 'pending') {
      throw conflict('Une soumission identique est déjà en cours — réessayez.');
    }

    try {
      const arrival = await ventilateArrival(id, body, req.user!.id);
      if (key) await finishIdempotent(key, endpoint, 201, arrival, req.user!.id);
      res.status(201).json(arrival);
    } catch (error) {
      if (key) await releaseIdempotent(key, req.user!.id);
      throw error;
    }
  }),
);

/** POST /api/arrivals/:id/cancel — contre-passation, stock intact requis */
arrivalsRouter.post(
  '/:id/cancel',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, cancelSchema);
    res.json(await cancelArrival(id, body.reason, req.user!.id));
  }),
);
