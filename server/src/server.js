import { app } from './app.js';
import { env } from './config/env.js';
import { logger } from './infrastructure/logging/logger.js';

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Minimi API listening');
});

async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down Minimi API');
  server.close(async () => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
