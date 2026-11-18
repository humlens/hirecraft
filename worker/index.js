/**
 * Background worker: calls the app's /api/internal/tick endpoint on an
 * interval. It needs no database or code access of its own, only:
 *   APP_URL      base URL of the web app (default http://localhost:4002)
 *   CRON_SECRET  shared secret, must match the web app's CRON_SECRET
 *   TICK_SECONDS interval in seconds (default 60)
 *
 * Any other scheduler (Vercel Cron, Kubernetes CronJob, ...) can call the same
 * endpoint instead of running this process.
 */
const base = (process.env.APP_URL || 'http://localhost:4002').replace(
  /\/$/,
  ''
);
const secret = process.env.CRON_SECRET;
const every = (Number(process.env.TICK_SECONDS) || 60) * 1000;

if (!secret) {
  console.error('CRON_SECRET is required');
  process.exit(1);
}

async function tick() {
  try {
    const res = await fetch(`${base}/api/internal/tick`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}` },
    });
    const body = await res.text();

    console.log(new Date().toISOString(), res.status, body);
  } catch (error) {
    console.error(new Date().toISOString(), 'tick failed:', error.message);
  }
}

tick();
setInterval(tick, every);
