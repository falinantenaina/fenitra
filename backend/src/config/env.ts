import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('/api'),

  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  CORS_ORIGINS: z.string().default('*'),

  ACCESS_TOKEN_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  DEFAULT_PAGE_SIZE: z.coerce.number().int().positive().default(25),
  MAX_PAGE_SIZE: z.coerce.number().int().positive().default(100),

  BUSINESS_CURRENCY: z.string().default('Ariary'),
  BUSINESS_TIMEZONE: z.string().default('Indian/Antananarivo'),
  OPENING_CASH_BALANCE: z.coerce.number().int().default(0),
  WORKING_RESERVE: z.coerce.number().int().default(0),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Configuration invalide (.env) :\n${issues}`);
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

export const corsOrigins =
  env.CORS_ORIGINS === '*'
    ? true
    : env.CORS_ORIGINS.split(',')
        .map((o) => o.trim())
        .filter(Boolean);

export const pagination = {
  defaultPageSize: env.DEFAULT_PAGE_SIZE,
  maxPageSize: env.MAX_PAGE_SIZE,
} as const;
