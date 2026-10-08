import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { createGainSchema } from './profits.schemas';
import { createGain } from './profits.service';

export const profitsRouter = Router();

/**
 * A16 — POST /api/profits : bénéfice hors stock. Ouvert à tous les rôles,
 * caissier inclus : comme la dépense, c'est une saisie courante de caisse.
 */
profitsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(201).json(await createGain(parseBody(req, createGainSchema), req.user!.id));
  }),
);
