import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';

async function main(): Promise<void> {
  await prisma.$connect();

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`API démarrée sur http://127.0.0.1:${env.PORT}${env.API_PREFIX} [${env.NODE_ENV}]`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`\n${signal} reçu — arrêt propre…`);
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Impossible de démarrer le serveur :', err);
  process.exit(1);
});
