import { PrismaClient } from '@prisma/client';
import { isTest } from '../config/env';

export const prisma = new PrismaClient({
  log: isTest ? ['error'] : ['warn', 'error'],
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
