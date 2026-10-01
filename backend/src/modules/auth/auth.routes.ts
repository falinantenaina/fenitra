import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { parseBody } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import * as schemas from './auth.schemas';
import * as service from './auth.service';

export const authRouter = Router();

const metaOf = (req: { ip?: string; headers: Record<string, unknown> }) => ({
  ip: req.ip ?? undefined,
  userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
});

/** POST /api/auth/login */
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = parseBody(req, schemas.loginSchema);
    const tokens = await service.login(body.email, body.password, metaOf(req));
    res.status(200).json(tokens);
  }),
);

/** POST /api/auth/refresh — rotation du refresh token */
authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const body = parseBody(req, schemas.refreshSchema);
    const tokens = await service.refresh(body.refreshToken, metaOf(req));
    res.status(200).json(tokens);
  }),
);

/** POST /api/auth/logout */
authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const body = parseBody(req, schemas.refreshSchema);
    await service.logout(body.refreshToken);
    res.status(204).end();
  }),
);

/** POST /api/auth/logout-all */
authRouter.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    const count = await service.logoutAll(req.user!.id);
    res.status(200).json({ revoked: count });
  }),
);

/** GET /api/auth/me */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await service.getMe(req.user!.id));
  }),
);

/** GET /api/auth/sessions */
authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await service.listSessions(req.user!.id));
  }),
);
