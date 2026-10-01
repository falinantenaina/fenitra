import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin, requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { remember, replayIfSeen } from '../../services/idempotency';
import {
  cancelSchema,
  createArrivalSchema,
  idParamSchema,
  arrivalListQuery,
} from './arrivals.schemas';
import { cancelArrival, createArrival, listArrivals, loadArrival, previewArrivalReference } from './arrivals.service';

export const arrivalsRouter = Router();

function idempotencyKey(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const raw = req.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.trim() ? value.trim().slice(0, 120) : null;
}

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

    if (key) {
      const seen = await replayIfSeen(key, 'POST /arrivals');
      if (seen) {
        res.status(seen.statusCode).json(seen.body);
        return;
      }
    }

    const arrival = await createArrival(body, req.user!.id);

    if (key) await remember(key, 'POST /arrivals', 201, arrival);

    res.status(201).json(arrival);
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
