import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { isProd } from '../config/env';
import { AppError, conflict, notFound } from '../lib/errors';
import { zodDetails } from './validate';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(notFound(`Route introuvable : ${req.method} ${req.originalUrl}`));
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Données invalides', details: zodDetails(err) },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        res.status(409).json({
          error: {
            code: 'CONFLICT',
            message: 'Contrainte d\'unicité violée',
            details: { target: (err.meta as { target?: unknown } | undefined)?.target },
          },
        });
        return;
      case 'P2025':
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable' } });
        return;
      case 'P2003':
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Référence étrangère invalide',
            details: { field: (err.meta as { field?: string } | undefined)?.field },
          },
        });
        return;
      case 'P2023':
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Identifiant invalide (forme incorrecte)' },
        });
        return;
      default:
        break;
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Requête invalide' } });
    return;
  }

  const message = err instanceof Error ? err.message : 'Erreur interne';

  if (!isProd) {
    // eslint-disable-next-line no-console
    console.error('[unhandled]', err);
  }

  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: isProd ? 'Erreur interne du serveur' : message },
  });
}

/** Wrapper pour les contrôleurs async — évite les try/catch répétés. */
export function asyncHandler<
  H extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
>(handler: H) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void handler(req, res, next).catch(next);
  };
}

export { conflict };
