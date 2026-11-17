import { prisma } from './infrastructure/database/prisma.js';
import { logger } from './infrastructure/logging/logger.js';
import { startMemoryIndexer, stopMemoryIndexer } from './workers/memory-indexer.js';

startMemoryIndexer();

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Shutting down outbox worker');
  await stopMemoryIndexer();
  await prisma?.$disconnect();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
