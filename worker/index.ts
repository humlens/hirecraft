/**
 * Background worker (run with `npm run worker`).
 *
 *  - BullMQ worker for AI / indexing jobs (needs REDIS_URL): resume parsing,
 *    embeddings, candidate matching. Retries with exponential backoff.
 *  - Interval for time-based tasks (scheduled jobs, reminders, offer expiry,
 *    AI request-log retention) by calling `runDueTasks` directly.
 *
 * Environment: DATABASE_URL, REDIS_URL, AI_* and the same variables as the web
 * app. TICK_SECONDS (default 60), WORKER_CONCURRENCY (default 4).
 */
import { Worker } from 'bullmq';
import { runDueTasks } from '../lib/ticker';
import { QUEUE_NAME, runHandler, type JobName } from '../lib/queue';
import { getRedis } from '../lib/redis';

const concurrency = Number(process.env.WORKER_CONCURRENCY) || 4;
const tickMs = (Number(process.env.TICK_SECONDS) || 60) * 1000;

async function tick() {
  try {
    const r = await runDueTasks();

    if (Object.values(r).some((n) => n > 0)) {
      console.log(new Date().toISOString(), 'tick', JSON.stringify(r));
    }
  } catch (error) {
    console.error(new Date().toISOString(), 'tick failed', error);
  }
}

const redis = getRedis();
let worker: Worker | null = null;

if (redis) {
  worker = new Worker(
    QUEUE_NAME,
    async (job) => runHandler(job.name as JobName, job.data),
    { connection: redis, concurrency }
  );
  worker.on('completed', (job) => console.log('done', job.name, job.id));
  worker.on('failed', (job, err) =>
    console.error('failed', job?.name, job?.id, `attempt ${job?.attemptsMade}`, err.message)
  );
  console.log(`BullMQ worker listening on "${QUEUE_NAME}" (concurrency ${concurrency})`);
} else {
  console.warn('REDIS_URL is not set: AI jobs run inline in the web app; this worker only runs the tick.');
}

void tick();
const timer = setInterval(tick, tickMs);

const stop = async () => {
  clearInterval(timer);
  await worker?.close();
  process.exit(0);
};

process.on('SIGTERM', stop);
process.on('SIGINT', stop);
