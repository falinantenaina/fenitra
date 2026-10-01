export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'IDEMPOTENCY_REPLAY'
  | 'BUSINESS_RULE_VIOLATION'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);

export const unauthorized = (message = 'Authentification requise') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'Accès refusé') => new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Ressource introuvable') =>
  new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);

export const insufficientStock = (message: string, details?: unknown) =>
  new AppError(409, 'INSUFFICIENT_STOCK', message, details);

export const businessRule = (message: string, details?: unknown) =>
  new AppError(422, 'BUSINESS_RULE_VIOLATION', message, details);
