import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError, badRequest } from '../lib/errors';

export interface Schemas<B extends ZodTypeAny = ZodTypeAny, Q extends ZodTypeAny = ZodTypeAny, P extends ZodTypeAny = ZodTypeAny> {
  body?: B;
  query?: Q;
  params?: P;
}

/**
 * Middleware de validation : valide et stocke les valeurs sur `req.validated`.
 * Les contrôleurs récupèrent les valeurs **typées** via `parseBody` / `parseQuery`.
 */
export function validate<B extends ZodTypeAny, Q extends ZodTypeAny, P extends ZodTypeAny>(
  schemas: Schemas<B, Q, P>,
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const validated: { body?: unknown; query?: unknown; params?: unknown } = {};
      if (schemas.body) validated.body = schemas.body.parse(req.body ?? {});
      if (schemas.query) validated.query = schemas.query.parse(req.query);
      if (schemas.params) validated.params = schemas.params.parse(req.params);
      req.validated = validated;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function resolve<T extends ZodTypeAny>(req: Request, key: 'body' | 'query' | 'params', schema: T): z.infer<T> {
  const pre = req.validated?.[key];
  const source = pre !== undefined ? pre : key === 'body' ? (req.body ?? {}) : (req as unknown as Record<string, unknown>)[key];
  return schema.parse(source) as z.infer<T>;
}

/** Récupère le corps de la requête typé (validé une seule fois). */
export const parseBody = <T extends ZodTypeAny>(req: Request, schema: T): z.infer<T> =>
  resolve(req, 'body', schema);

/** Récupère la query string typée. */
export const parseQuery = <T extends ZodTypeAny>(req: Request, schema: T): z.infer<T> =>
  resolve(req, 'query', schema);

/** Récupère les params d'URL typés. */
export const parseParams = <T extends ZodTypeAny>(req: Request, schema: T): z.infer<T> =>
  resolve(req, 'params', schema);

export function zodDetails(err: ZodError): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export { AppError, badRequest };
