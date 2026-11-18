import Redis from 'ioredis';
import env from './env';

let client: Redis | null | undefined;

/** Shared Redis connection (null when REDIS_URL is not set). */
export function getRedis(): Redis | null {
  if (client !== undefined) {
    return client;
  }

  client = env.redisUrl
    ? new Redis(env.redisUrl, {
        maxRetriesPerRequest: null,
        lazyConnect: false,
      })
    : null;

  return client;
}

/** For tests: drop the cached connection. */
export async function closeRedis() {
  if (client) {
    await client.quit().catch(() => undefined);
  }

  client = undefined;
}
