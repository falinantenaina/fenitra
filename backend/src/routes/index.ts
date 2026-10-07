import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { usersRouter } from '../modules/users/users.routes';
import { productsRouter, sizesRouter, variantsRouter } from '../modules/catalog/catalog.routes';
import { customersRouter, onlineSellersRouter, suppliersRouter } from '../modules/parties/parties.routes';
import { settingsRouter } from '../modules/settings/settings.routes';
import { arrivalsRouter } from '../modules/arrivals/arrivals.routes';
import { stockRouter } from '../modules/stock/stock.routes';
import { salesRouter } from '../modules/sales/sales.routes';
import { debtsRouter, paymentsRouter } from '../modules/debts/debts.routes';
import { expensesRouter } from '../modules/finances/expenses.routes';
import { versementsRouter } from '../modules/finances/versements.routes';
import { capitalRouter } from '../modules/finances/capital.routes';
import { profitDrawingsRouter } from '../modules/finances/profit-drawings.routes';
import { trosaRouter } from '../modules/finances/trosa.routes';
import { dashboardRouter, ledgerRouter, reportsRouter } from '../modules/reports/reports.routes';

/**
 * Registre des routes de l'API. Chaque module ajoute son Router ici.
 * Phase 5 : auth ✓, users ✓, catalog ✓, parties ✓, settings ✓,
 *           arrivals ✓, stock ✓, sales ✓, debts ✓, payments ✓,
 *           expenses ✓, versements ✓, personal-capital ✓, profit-drawings ✓,
 *           trosa-sinoa ✓, ledger ✓, dashboard ✓, reports ✓.
 */
export const apiRouter = Router();

/** GET /api/health — santé du service (public) */
apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'gestion-vente-api',
    version: '1.0.0',
    endpoints: [
      '/api/auth',
      '/api/users',
      '/api/products',
      '/api/sizes',
      '/api/variants',
      '/api/suppliers',
      '/api/customers',
      '/api/online-sellers',
      '/api/settings',
      '/api/expense-categories',
      '/api/payment-methods',
      '/api/arrivals',
      '/api/stock',
      '/api/sales',
      '/api/debts',
      '/api/payments',
      '/api/expenses',
      '/api/versements',
      '/api/personal-capital',
      '/api/profit-drawings',
      '/api/trosa-sinoa',
      '/api/ledger',
      '/api/dashboard',
      '/api/reports',
      '/api/health',
    ],
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/sizes', sizesRouter);
apiRouter.use('/variants', variantsRouter);
apiRouter.use('/suppliers', suppliersRouter);
apiRouter.use('/customers', customersRouter);
apiRouter.use('/online-sellers', onlineSellersRouter);
apiRouter.use('/arrivals', arrivalsRouter);
apiRouter.use('/stock', stockRouter);
apiRouter.use('/sales', salesRouter);
apiRouter.use('/debts', debtsRouter);
apiRouter.use('/payments', paymentsRouter);
apiRouter.use('/expenses', expensesRouter);
apiRouter.use('/versements', versementsRouter);
apiRouter.use('/personal-capital', capitalRouter);
apiRouter.use('/profit-drawings', profitDrawingsRouter);
apiRouter.use('/trosa-sinoa', trosaRouter);
apiRouter.use('/ledger', ledgerRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/', settingsRouter);
