import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, embedText, logger } = vi.hoisted(() => ({
  prisma: { message: { findMany: vi.fn() }, memoryChunk: { findMany: vi.fn() }, entity: { upsert: vi.fn() }, $transaction: vi.fn() },
  embedText: vi.fn(), logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}));
vi.mock('../../server/src/infrastructure/database/prisma.js', () => ({ prisma }));
vi.mock('../../server/src/infrastructure/llm/gemini.js', () => ({ embedText }));
vi.mock('../../server/src/infrastructure/logging/logger.js', () => ({ logger }));
vi.mock('../../server/src/infrastructure/metrics.js', () => ({ observeJob: vi.fn() }));
vi.mock('../../server/src/modules/chat/service.js', () => ({ processChatTurn: vi.fn() }));

const { indexConversation, loadConversationMessages } = await import('../../server/src/workers/memory-indexer.js');

function messageRows(count, start = 0) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${start + index + 1}`,
    conversationId: 'c1',
    createdAt: new Date(Date.UTC(2025, 0, 1) + (start + index) * 1000),
    role: 'user',
    content: `unique topic ${start + index + 1}`
  }));
}

function cursorReader(rows) {
  const byId = new Map(rows.map((row, index) => [row.id, index]));
  prisma.message.findMany.mockImplementation(async (args) => {
    const offset = args.cursor ? byId.get(args.cursor.id) + args.skip : 0;
    return rows.slice(offset, offset + args.take);
  });
}

function transactionHarness() {
  const tx = {
    entityMention: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), upsert: vi.fn().mockResolvedValue({}) },
    memoryChunk: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    conversationSummary: { upsert: vi.fn().mockResolvedValue({}) },
    $executeRaw: vi.fn().mockResolvedValue(1)
  };
  prisma.$transaction.mockImplementation(async (callback) => callback(tx));
  return tx;
}

beforeEach(() => {
  vi.clearAllMocks();
  embedText.mockResolvedValue([0.1, 0.2]);
  prisma.memoryChunk.findMany.mockResolvedValue([]);
  prisma.entity.upsert.mockImplementation(async ({ where }) => ({ id: `e-${where.normalizedName}` }));
});

describe('memory indexer historical indexing', () => {
  it('loads all 450 messages over multiple full pages and a partial page', async () => {
    const rows = messageRows(450);
    cursorReader(rows);
    const loaded = await loadConversationMessages('c1');
    expect(loaded).toEqual(rows);
    expect(prisma.message.findMany).toHaveBeenCalledTimes(3);
    expect(prisma.message.findMany.mock.calls.map(([args]) => args.take)).toEqual([200, 200, 200]);
    expect(prisma.message.findMany.mock.calls[0][0].orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    expect(prisma.message.findMany.mock.calls[1][0]).toMatchObject({ cursor: { id: 'm200' }, skip: 1 });
    expect(prisma.message.findMany.mock.calls[2][0]).toMatchObject({ cursor: { id: 'm400' }, skip: 1 });
  });

  it('handles an empty conversation with one bounded query', async () => {
    prisma.message.findMany.mockResolvedValueOnce([]);
    expect(await loadConversationMessages('c1')).toEqual([]);
    expect(prisma.message.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps historical chunks when reindexing 450 messages and embeds only new chunks', async () => {
    const rows = messageRows(450);
    cursorReader(rows);
    prisma.memoryChunk.findMany.mockResolvedValue(rows.slice(0, 450).map((row) => ({
      id: `chunk_c1_${row.id}`, content: `user: ${row.content}`
    })));
    const tx = transactionHarness();
    await indexConversation('c1');
    expect(embedText).not.toHaveBeenCalled();
    expect(tx.memoryChunk.deleteMany).toHaveBeenCalledWith({ where: { conversationId: 'c1', id: { notIn: rows.map((row) => `chunk_c1_${row.id}`) } } });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(450);
  });

  it('embeds only new chunks and removes stale chunks after successful preparation', async () => {
    const rows = messageRows(3);
    cursorReader(rows);
    prisma.memoryChunk.findMany.mockResolvedValue([
      { id: 'chunk_c1_m1', content: 'user: unique topic 1' },
      { id: 'chunk_c1_m2', content: 'user: unique topic 2' },
      { id: 'chunk_c1_old', content: 'stale' }
    ]);
    const tx = transactionHarness();
    await indexConversation('c1');
    expect(embedText).toHaveBeenCalledTimes(1);
    expect(tx.memoryChunk.deleteMany).toHaveBeenCalledWith({ where: { conversationId: 'c1', id: { notIn: ['chunk_c1_m1', 'chunk_c1_m2', 'chunk_c1_m3'] } } });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(3);
  });

  it('reconciles entity mentions across the entire conversation', async () => {
    const rows = messageRows(250);
    rows[0].content = 'PostgreSQL historical reference';
    rows[249].content = 'AWS recent reference';
    cursorReader(rows);
    transactionHarness();
    await indexConversation('c1');
    expect(prisma.entity.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { normalizedName: 'postgresql' } }));
    expect(prisma.entity.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { normalizedName: 'aws' } }));
  });

  it('does not delete existing memory when the indexing transaction fails', async () => {
    cursorReader(messageRows(2));
    prisma.memoryChunk.findMany.mockResolvedValue([{ id: 'chunk_c1_stale', content: 'old' }]);
    const failure = new Error('transaction failed');
    prisma.$transaction.mockRejectedValue(failure);
    await expect(indexConversation('c1')).rejects.toBe(failure);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps keyword indexing when embedding fails and safely reconciles an empty history', async () => {
    cursorReader(messageRows(1));
    embedText.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'OFFLINE' }));
    const tx = transactionHarness();
    await indexConversation('c1');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.calls[0]).toContain(null);
    vi.clearAllMocks();
    prisma.message.findMany.mockResolvedValueOnce([]);
    prisma.memoryChunk.findMany.mockResolvedValue([]);
    const emptyTx = transactionHarness();
    await indexConversation('c1');
    expect(emptyTx.entityMention.deleteMany).toHaveBeenCalledWith({ where: { conversationId: 'c1' } });
    expect(emptyTx.memoryChunk.deleteMany).toHaveBeenCalledWith({ where: { conversationId: 'c1' } });
    expect(emptyTx.conversationSummary.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { conversationId: 'c1', summary: '' } }));
  });
});
