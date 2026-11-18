/**
 * @jest-environment node
 *
 * Phase 4 with a real Redis: the BullMQ queue + worker and the Lua token bucket.
 * Skipped unless REDIS_URL is set (and INTEGRATION=1, DATABASE_URL).
 *   redis-server --port 6390 &
 *   REDIS_URL=redis://localhost:6390 DATABASE_URL=... npm run test:integration
 */
import { Worker } from 'bullmq';
import Redis from 'ioredis';

const enabled =
  process.env.INTEGRATION === '1' &&
  !!process.env.DATABASE_URL &&
  !!process.env.REDIS_URL;
const suite = enabled ? describe : describe.skip;

process.env.AI_DEFAULT_PROVIDER = 'fake';
process.env.AI_KEYS_ENCRYPTION_SECRET = 'phase4-redis-secret';
delete process.env.QUEUE_INLINE_AWAIT;

/* eslint-disable @typescript-eslint/no-require-imports */
suite('phase 4: queue and rate limit with Redis', () => {
  const queue = require('@/lib/queue') as typeof import('@/lib/queue');
  const rate = require('@/lib/rateLimit') as typeof import('@/lib/rateLimit');
  const { prisma } = require('@/lib/prisma') as typeof import('@/lib/prisma');
  const redisLib = require('@/lib/redis') as typeof import('@/lib/redis');
  const { fakeProvider: fake } =
    require('@/lib/ai/providers/fake') as typeof import('@/lib/ai/providers/fake');
  const run = Date.now().toString(36);
  let worker: Worker;
  let other: Redis;
  const email = `redis-${run}@cand4.com`;
  let userId = '';

  beforeAll(async () => {
    const r = redisLib.getRedis()!;

    await r.flushdb();
    other = new Redis(process.env.REDIS_URL as string, {
      maxRetriesPerRequest: null,
    });

    const u = await prisma.user.create({
      data: { name: 'Redis Cand', email, emailVerified: new Date() },
    });

    userId = u.id;
    await prisma.candidateProfile.create({
      data: {
        userId,
        headline: 'Queue tester',
        skills: { create: [{ skill: 'Node.js' }] },
      },
    });

    worker = new Worker(
      queue.QUEUE_NAME,
      async (job) => queue.runHandler(job.name as never, job.data as never),
      { connection: other, concurrency: 2 }
    );
  });

  afterAll(async () => {
    await worker?.close();
    await queue.closeQueue();
    await other?.quit();
    await prisma.user.deleteMany({ where: { email } });
    await redisLib.closeRedis();
    await prisma.$disconnect();
  });

  beforeEach(() => fake.reset());

  const waitFor = async (fn: () => Promise<boolean>, ms = 15000) => {
    const end = Date.now() + ms;

    while (Date.now() < end) {
      if (await fn()) return;
      await new Promise((r) => setTimeout(r, 150));
    }

    throw new Error('timed out waiting for the job');
  };

  it('queues a job through Redis and the worker runs it', async () => {
    expect(await queue.enqueue('embed.profile', { userId })).toBe('queued');
    await waitFor(async () => {
      const r = await prisma.$queryRaw<
        { at: Date | null }[]
      >`SELECT "embeddedAt" at FROM "CandidateProfile" WHERE "userId" = ${userId}`;

      return r[0].at !== null;
    });
    expect(fake.calls.some((c) => c.kind === 'embed')).toBe(true);
  });

  it('retries a failing job with backoff and succeeds once the provider recovers', async () => {
    await prisma.$executeRaw`UPDATE "CandidateProfile" SET "embeddedAt" = NULL WHERE "userId" = ${userId}`;
    fake.failEmbed = true;
    await queue.enqueue('embed.profile', { userId });

    const q = queue.getQueue()!;

    await waitFor(async () => {
      const failed = await q.getJobs(['delayed', 'active', 'waiting']);

      return failed.some((j) => j.attemptsMade >= 1);
    });

    fake.failEmbed = false;
    await waitFor(async () => {
      const r = await prisma.$queryRaw<
        { at: Date | null }[]
      >`SELECT "embeddedAt" at FROM "CandidateProfile" WHERE "userId" = ${userId}`;

      return r[0].at !== null;
    }, 20000);
  });

  it('token bucket is shared across connections and refills over time', async () => {
    const key = `it-${run}`;
    const now = Date.now();
    let granted = 0;

    for (let i = 0; i < 12; i++) {
      if (await rate.takeToken(key, 10, now)) granted++;
    }

    expect(granted).toBe(10); // burst = limit, enforced in Redis, not per process

    // a second connection sees the same bucket
    const [shared] = (await other.hmget(`rl:${key}`, 'tokens')) as string[];

    expect(Number(shared)).toBeLessThan(1);

    // 6 seconds later at 10/min one token is back
    expect(await rate.takeToken(key, 10, now + 6000)).toBe(true);
    expect(await rate.takeToken(key, 10, now + 6000)).toBe(false);
  });
});
