import { Router } from 'express';

/**
 * Registre des routes de l'API. Chaque module ajoute son Router ici.
 * Phase 5 : auth, catalog, parties, arrivals, stock, sales, debts, payments,
 *           expenses, versements, personal-capital, trosa-sinoa, ledger,
 *           dashboard, reports, settings.
 */
export const apiRouter = Router();

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'gestion-vente-api',
    version: '1.0.0',
    docs: '/api',
  });
});
