import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { idParamSchema } from '../../lib/zod';
import { badRequest } from '../../lib/errors';
import { debtListQuery, debtPaymentSchema, createDebtSchema } from '../debts/debts.schemas';
import {
  cancelDebt,
  createDebt,
  listDebts,
  loadDebt,
  payDebt,
} from '../debts/debts.service';

/**
 * `/trosa-sinoa` — vue dédiée des dettes de type `TROSA_SINOA` (§31).
 * Le type est forcé : aucun appelant ne peut créer une trosa qui n'est pas
 * une dette PAYABLE (A1).
 */
export const trosaRouter = Router();

const trosaCreateSchema = createDebtSchema.extend({
  type: z.literal('TROSA_SINOA'),
});

const trosaUpdateSchema = z.object({
  reason: z.string().trim().min(3, 'Motif requis').max(300),
  partyName: z.string().trim().min(2, 'Nom requis').max(120),
  dueDate: z.coerce.date().nullish(),
});

/** GET /api/trosa-sinoa */
trosaRouter.get(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const query = parseQuery(req, debtListQuery);
    res.json(await listDebts({ ...query, type: 'TROSA_SINOA' }));
  }),
);

/** POST /api/trosa-sinoa — encaissement `TROSA_BORROW` (A1) */
trosaRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const body = parseBody(req, trosaCreateSchema);
    if (body.customerId || body.onlineSellerId || body.supplierId) {
      throw badRequest('Une trosa sinoa n\'est liée à aucun tiers enregistré');
    }
    res.status(201).json(await createDebt(body, req.user!.id));
  }),
);

/** GET /api/trosa-sinoa/:id */
trosaRouter.get(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const debt = await loadDebt(prisma, id);
    if (debt.type !== 'TROSA_SINOA') throw badRequest('Ce n\'est pas une trosa sinoa');
    res.json(debt);
  }),
);

/** PUT /api/trosa-sinoa/:id — motif, nom, échéance */
trosaRouter.put(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, trosaUpdateSchema);

    const debt = await prisma.debt.findUnique({ where: { id } });
    if (!debt) throw badRequest('Dette introuvable');
    if (debt.type !== 'TROSA_SINOA') throw badRequest('Ce n\'est pas une trosa sinoa');

    await prisma.debt.update({
      where: { id },
      data: { reason: body.reason, partyName: body.partyName, dueDate: body.dueDate ?? null },
    });

    res.json(await loadDebt(prisma, id));
  }),
);

/** POST /api/trosa-sinoa/:id/payments — règlement (`TROSA_REPAY`) */
trosaRouter.post(
  '/:id/payments',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const debt = await loadDebt(prisma, id);
    if (debt.type !== 'TROSA_SINOA') throw badRequest('Ce n\'est pas une trosa sinoa');
    res.json(await payDebt(id, parseBody(req, debtPaymentSchema), req.user!.id));
  }),
);

/** DELETE /api/trosa-sinoa/:id — annulation (dette manuelle uniquement) */
trosaRouter.delete(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    const body = parseBody(req, z.object({ reason: z.string().trim().min(3).max(500) }));
    const debt = await loadDebt(prisma, id);
    if (debt.type !== 'TROSA_SINOA') throw badRequest('Ce n\'est pas une trosa sinoa');
    res.json(await cancelDebt(id, body.reason, req.user!.id));
  }),
);
