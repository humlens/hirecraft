import webpush from 'web-push';
import env from './env';
import { prisma } from './prisma';

/**
 * Web Push (VAPID). Nothing is ever pushed to a user who has not subscribed a
 * device: creating the PushSubscription row is the consent, deleting it
 * withdraws it. Payloads are short and carry only a relative link; the service
 * worker opens it, so the page itself still enforces authentication.
 */
export type PushPayload = {
  title: string;
  body?: string;
  /** Relative path, e.g. /teams/acme/interviews/123 */
  url?: string;
  tag?: string;
};

let configured = false;

export const pushEnabled = () =>
  env.push.enabled && !!env.push.publicKey && !!env.push.privateKey;

function configure() {
  if (!configured) {
    webpush.setVapidDetails(
      env.push.subject,
      env.push.publicKey,
      env.push.privateKey
    );
    configured = true;
  }
}

/** Only same-site relative paths may be opened from a notification. */
export const safeRelativeUrl = (url?: string | null) =>
  url && /^\/(?!\/)[^\s\\]*$/.test(url) ? url : '/';

export const clip = (s: string | undefined, n: number) =>
  s && s.length > n ? `${s.slice(0, n - 1)}…` : s;

export function buildPayload(p: PushPayload) {
  return JSON.stringify({
    title: clip(p.title, 80) ?? '',
    body: clip(p.body, 140) ?? '',
    url: safeRelativeUrl(p.url),
    tag: p.tag ?? undefined,
  });
}

/**
 * Sends to every device of the given users. Dead subscriptions (404/410) are
 * removed. Never throws.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
  const result = { sent: 0, removed: 0, failed: 0 };

  if (!pushEnabled() || !userIds.length) {
    return result;
  }

  try {
    configure();

    const subs = await prisma.pushSubscription.findMany({
      where: { userId: { in: userIds } },
    });
    const body = buildPayload(payload);

    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            { TTL: 60 * 60 * 24, timeout: 5000, urgency: 'normal' }
          );
          result.sent++;
          await prisma.pushSubscription
            .update({ where: { id: s.id }, data: { lastUsedAt: new Date() } })
            .catch(() => undefined);
        } catch (error: any) {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            result.removed++;
            await prisma.pushSubscription
              .delete({ where: { id: s.id } })
              .catch(() => undefined);
          } else {
            result.failed++;
            console.error('push failed', error?.statusCode ?? error?.message);
          }
        }
      })
    );
  } catch (error) {
    console.error('push failed', error);
  }

  return result;
}
