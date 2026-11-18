import { Queue, type JobsOptions } from 'bullmq';
import { getRedis } from './redis';

/**
 * Background jobs. With REDIS_URL set, jobs go to a BullMQ queue (retries with
 * exponential backoff) processed by `worker/index.ts`. Without Redis (local
 * development, tests) the job runs inline so features still work.
 */
export const QUEUE_NAME = 'hirecraft-ai';

export type JobName =
  | 'resume.parse'
  | 'embed.profile'
  | 'embed.job'
  | 'match.application'
  | 'match.job';

export type JobData = {
  'resume.parse': { resumeId: string };
  'embed.profile': { userId: string };
  'embed.job': { teamId: string; jobId: string };
  'match.application': {
    teamId: string;
    applicationId: string;
    userId: string;
  };
  'match.job': { teamId: string; jobId: string; userId: string };
};

let queue: Queue | null | undefined;

export function getQueue() {
  if (queue !== undefined) {
    return queue;
  }

  const redis = getRedis();

  queue = redis ? new Queue(QUEUE_NAME, { connection: redis }) : null;

  return queue;
}

export async function closeQueue() {
  if (queue) {
    await queue.close().catch(() => undefined);
  }

  queue = undefined;
}

export const JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

/** Runs a job handler (shared by the worker and the inline fallback). */
export async function runHandler<N extends JobName>(name: N, data: JobData[N]) {
  const { handlers } = await import('./jobHandlers');

  try {
    return await handlers[name](data as never);
  } catch (error: any) {
    // AI is not configured / switched off on this server: nothing to retry
    if (error?.status === 503) {
      return { skipped: true as const };
    }

    throw error;
  }
}

/**
 * Enqueues a job. Never throws: the user action that triggered it (an upload,
 * a profile edit) must not fail because background work could not be queued.
 */
export async function enqueue<N extends JobName>(name: N, data: JobData[N]) {
  try {
    const q = getQueue();

    if (q) {
      await q.add(name, data, JOB_OPTIONS);

      return 'queued' as const;
    }

    // No Redis: run in this process. In the background by default so an upload
    // or save does not wait for a model call; tests await it for determinism.
    const run = runHandler(name, data).catch((error) =>
      console.error(`inline job ${name} failed`, error)
    );

    if (process.env.QUEUE_INLINE_AWAIT === 'true') {
      await run;
    }

    return 'inline' as const;
  } catch (error) {
    console.error(`enqueue ${name} failed`, error);

    return 'failed' as const;
  }
}
