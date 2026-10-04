import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin, requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { conflict } from '../../lib/errors';
import { idempotencyKey, beginIdempotent, finishIdempotent, releaseIdempotent } from '../../services/idempotency';
import {
  cancelSaleSchema,
  createSaleSchema,
  idParamSchema,
  saleListQuery,
  salePaymentSchema,
} from './sales.schemas';
import {
  addSalePayment,
  cancelSale,
  createSale,
  listSales,
  loadSale,
  previewSaleReference,
} from './sales.service';

export const salesRouter = Router();

/** GET /api/sales/reference-preview — prochaine référence, sans la consommer */
salesRouter.get(
  '/reference-preview',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ reference: await previewSaleReference() });
  }),
);

/** GET /api/sales */
salesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, saleListQuery);
    res.json(await listSales(query));
  }),
);

/** POST /api/sales — vente FIFO complète (§55). Accessible à tous les rôles. */
salesRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, createSaleSchema);
    const key = idempotencyKey(req);
    const endpoint = 'POST /sales';
    const claim = key ? await beginIdempotent(key, endpoint, req.user!.id) : null;

    if (claim?.kind === 'replay') {
      res.status(claim.statusCode).json(claim.body);
      return;
    }
    if (claim?.kind === 'pending') {
      throw conflict('Une soumission identique est déjà en cours — réessayez.');
    }

    try {
      const sale = await createSale(body, req.user!.id, key);
      if (key) await finishIdempotent(key, endpoint, 201, sale, req.user!.id);
      res.status(201).json(sale);
    } catch (error) {
      if (key) await releaseIdempotent(key, req.user!.id);
      throw error;
    }
  }),
);

/** GET /api/sales/:id — détail complet (§49) */
salesRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await loadSale(prisma, id));
  }),
);

/** POST /api/sales/:id/payments — règlement partiel ou total */
salesRouter.post(
  '/:id/payments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, salePaymentSchema);
    const key = idempotencyKey(req);
    const endpoint = `POST /sales/${id}/payments`;
    const claim = key ? await beginIdempotent(key, endpoint, req.user!.id) : null;

    if (claim?.kind === 'replay') {
      res.status(claim.statusCode).json(claim.body);
      return;
    }
    if (claim?.kind === 'pending') {
      throw conflict('Une soumission identique est déjà en cours — réessayez.');
    }

    try {
      const sale = await addSalePayment(id, body, req.user!.id);
      if (key) await finishIdempotent(key, endpoint, 200, sale, req.user!.id);
      res.json(sale);
    } catch (error) {
      if (key) await releaseIdempotent(key, req.user!.id);
      throw error;
    }
  }),
);

/** POST /api/sales/:id/cancel — restitution des lots + contre-passation */
salesRouter.post(
  '/:id/cancel',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, cancelSaleSchema);
    res.json(await cancelSale(id, body.reason, req.user!.id));
  }),
);
