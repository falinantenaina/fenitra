import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate';
import { managerOrAdmin, requireAuth } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { idParamSchema } from '../../lib/zod';
import {
  createExpenseSchema,
  expenseListQuery,
  reasonSchema,
  updateExpenseSchema,
} from './expenses.schemas';
import {
  createExpense,
  deleteExpense,
  expensesSummary,
  listExpenses,
  loadExpense,
  updateExpense,
} from './expenses.service';

export const expensesRouter = Router();

/** GET /api/expenses */
expensesRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listExpenses(parseQuery(req, expenseListQuery)));
  }),
);

/** GET /api/expenses/summary — total par catégorie */
expensesRouter.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await expensesSummary(parseQuery(req, expenseListQuery)));
  }),
);

/** POST /api/expenses — dépense réglée immédiatement (A8) */
expensesRouter.post(
  '/',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createExpense(parseBody(req, createExpenseSchema), req.user!.id));
  }),
);

/** GET /api/expenses/:id */
expensesRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await loadExpense(prisma, id));
  }),
);

/** PUT /api/expenses/:id — correction par contre-passation */
expensesRouter.put(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await updateExpense(id, parseBody(req, updateExpenseSchema), req.user!.id));
  }),
);

/** DELETE /api/expenses/:id — suppression + contre-passation */
expensesRouter.delete(
  '/:id',
  managerOrAdmin,
  asyncHandler(async (req, res) => {
    const { id } = parseParams(req, idParamSchema);
    res.json(await deleteExpense(id, parseBody(req, reasonSchema).reason, req.user!.id));
  }),
);
