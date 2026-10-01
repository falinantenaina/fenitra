import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { usersRouter } from '../modules/users/users.routes';

/**
 * Registre des routes de l'API. Chaque module ajoute son Router ici.
 * Phase 5 : auth ✓, users ✓, catalog, parties, arrivals, stock, sales,
 *           debts, payments, expenses, versements, personal-capital,
 *           trosa-sinoa, ledger, dashboard, reports, settings.
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'gestion-vente-api',
    version: '1.0.0',
    endpoints: ['/api/auth', '/api/users'],
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
