import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin, requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { remember, replayIfSeen } from '../../services/idempotency';
import {
  cancelDebtSchema,
  createDebtSchema,
  createPaymentSchema,
  debtListQuery,
  debtPaymentSchema,
  idParamSchema,
  paymentListQuery,
} from './debts.schemas';
import {
  cancelDebt,
  createDebt,
  debtsSummary,
  listDebts,
  listPayments,
  loadDebt,
  payDebt,
} from './debts.service';

export const debtsRouter = Router();
export const paymentsRouter = Router();

function idempotencyKey(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const raw = req.headers['idempotency-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.trim() ? value.trim().slice(0, 120) : null;
}

/** GET /api/debts — liste filtrée (type, statut, tiers, période, motif) */
debtsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listDebts(parseQuery(req, debtListQuery)));
  }),
);

/** GET /api/debts/summary — synthèse par type (créances / passifs) */
debtsRouter.get(
  '/summary',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await debtsSummary());
  }),
);

/** POST /api/debts — création manuelle, motif obligatoire (généré si absent) */
debtsRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, createDebtSchema);
    const key = idempotencyKey(req);

    if (key) {
      const seen = await replayIfSeen(key, 'POST /debts');
      if (seen) {
        res.status(seen.statusCode).json(seen.body);
        return;
      }
    }

    const debt = await createDebt(body, req.user!.id);
    if (key) await remember(key, 'POST /debts', 201, debt);

    res.status(201).json(debt);
  }),
);

/** GET /api/debts/:id — détail + historique des règlements (§50) */
debtsRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await loadDebt(prisma, id));
  }),
);

/** POST /api/debts/:id/payments — règlement partiel ou total */
debtsRouter.post(
  '/:id/payments',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, debtPaymentSchema);
    const key = idempotencyKey(req);

    if (key) {
      const seen = await replayIfSeen(key, `POST /debts/${id}/payments`);
      if (seen) {
        res.status(seen.statusCode).json(seen.body);
        return;
      }
    }

    const debt = await payDebt(id, body, req.user!.id);
    if (key) await remember(key, `POST /debts/${id}/payments`, 200, debt);

    res.json(debt);
  }),
);

/** POST /api/debts/:id/cancel — contre-passation des écritures (dette manuelle) */
debtsRouter.post(
  '/:id/cancel',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, cancelDebtSchema);
    res.json(await cancelDebt(id, body.reason, req.user!.id));
  }),
);

/** GET /api/payments — journal des règlements */
paymentsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listPayments(parseQuery(req, paymentListQuery)));
  }),
);

/** POST /api/payments — règlement rattaché à une dette */
paymentsRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, createPaymentSchema);
    const key = idempotencyKey(req);

    if (key) {
      const seen = await replayIfSeen(key, 'POST /payments');
      if (seen) {
        res.status(seen.statusCode).json(seen.body);
        return;
      }
    }

    const debt = await payDebt(body.debtId, body, req.user!.id);
    if (key) await remember(key, 'POST /payments', 200, debt);

    res.json(debt);
  }),
);
