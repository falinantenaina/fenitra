import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin, requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { remember, replayIfSeen } from '../../services/idempotency';
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

function idempotencyKey(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const raw = req.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.trim() ? value.trim().slice(0, 120) : null;
}

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

    if (key) {
      const seen = await replayIfSeen(key, 'POST /sales');
      if (seen) {
        res.status(seen.statusCode).json(seen.body);
        return;
      }
    }

    const sale = await createSale(body, req.user!.id, key);
    if (key) await remember(key, 'POST /sales', 201, sale);

    res.status(201).json(sale);
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

    if (key) {
      const seen = await replayIfSeen(key, `POST /sales/${id}/payments`);
      if (seen) {
        res.status(seen.statusCode).json(seen.body);
        return;
      }
    }

    const sale = await addSalePayment(id, body, req.user!.id);
    if (key) await remember(key, `POST /sales/${id}/payments`, 200, sale);

    res.json(sale);
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
