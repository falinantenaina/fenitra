import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { conflict } from '../../lib/errors';
import { idempotencyKey, beginIdempotent, finishIdempotent, releaseIdempotent } from '../../services/idempotency';
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
  debtsByParty,
  debtsSummary,
  listDebts,
  listPayments,
  loadDebt,
  payDebt,
} from './debts.service';

export const debtsRouter = Router();
export const paymentsRouter = Router();

/** GET /api/debts — liste filtrée (type, statut, tiers, période, motif) */
debtsRouter.get(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    res.json(await listDebts(parseQuery(req, debtListQuery)));
  }),
);

/** GET /api/debts/summary — synthèse par type (créances / passifs) */
debtsRouter.get(
  '/summary',
  managerOrAdmin,
  asyncHandler(async (_req, res) => {
    res.json(await debtsSummary());
  }),
);

/** GET /api/debts/by-party — dettes regroupées par tiers (une ligne par personne) */
debtsRouter.get(
  '/by-party',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    res.json(await debtsByParty(parseQuery(req, debtListQuery)));
  }),
);

/** POST /api/debts — création manuelle, motif obligatoire (généré si absent) */
debtsRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, createDebtSchema);
    const key = idempotencyKey(req);
    const endpoint = 'POST /debts';
    const claim = key ? await beginIdempotent(key, endpoint, req.user!.id) : null;

    if (claim?.kind === 'replay') {
      res.status(claim.statusCode).json(claim.body);
      return;
    }
    if (claim?.kind === 'pending') {
      throw conflict('Une soumission identique est déjà en cours — réessayez.');
    }

    try {
      const debt = await createDebt(body, req.user!.id);
      if (key) await finishIdempotent(key, endpoint, 201, debt, req.user!.id);
      res.status(201).json(debt);
    } catch (error) {
      if (key) await releaseIdempotent(key, req.user!.id);
      throw error;
    }
  }),
);

/** GET /api/debts/:id — détail + historique des règlements (§50) */
debtsRouter.get(
  '/:id',
  managerOrAdmin,
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
    const endpoint = `POST /debts/${id}/payments`;
    const claim = key ? await beginIdempotent(key, endpoint, req.user!.id) : null;

    if (claim?.kind === 'replay') {
      res.status(claim.statusCode).json(claim.body);
      return;
    }
    if (claim?.kind === 'pending') {
      throw conflict('Une soumission identique est déjà en cours — réessayez.');
    }

    try {
      const debt = await payDebt(id, body, req.user!.id);
      if (key) await finishIdempotent(key, endpoint, 200, debt, req.user!.id);
      res.json(debt);
    } catch (error) {
      if (key) await releaseIdempotent(key, req.user!.id);
      throw error;
    }
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
  managerOrAdmin,
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
    const endpoint = 'POST /payments';
    const claim = key ? await beginIdempotent(key, endpoint, req.user!.id) : null;

    if (claim?.kind === 'replay') {
      res.status(claim.statusCode).json(claim.body);
      return;
    }
    if (claim?.kind === 'pending') {
      throw conflict('Une soumission identique est déjà en cours — réessayez.');
    }

    try {
      const debt = await payDebt(body.debtId, body, req.user!.id);
      if (key) await finishIdempotent(key, endpoint, 200, debt, req.user!.id);
      res.json(debt);
    } catch (error) {
      if (key) await releaseIdempotent(key, req.user!.id);
      throw error;
    }
  }),
);
