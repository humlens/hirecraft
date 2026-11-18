import { prisma } from './prisma';
import { sendEmail } from './email/sendEmail';
import { sendPushToUsers } from './push';

/**
 * Notification catalogue. `email` is the default for the email channel; users
 * override both channels per type (NotificationPreference). SMS goes through an
 * optional provider interface (not enabled).
 */
export const NOTIFICATION_TYPES = {
  'application.created': { label: 'New application', email: true, push: true },
  'application.shortlisted': {
    label: 'Candidate shortlisted',
    email: false,
    push: false,
  },
  'application.stage_changed': {
    label: 'Application stage changed',
    email: false,
    push: false,
  },
  'interview.scheduled': {
    label: 'Interview scheduled',
    email: true,
    push: true,
  },
  'interview.reminder': {
    label: 'Interview reminder',
    email: true,
    push: true,
  },
  'interview.cancelled': {
    label: 'Interview cancelled',
    email: true,
    push: true,
  },
  'job.published': { label: 'Job published', email: false, push: false },
  'job.expired': { label: 'Job expired', email: true, push: false },
  'recruiter.assigned': { label: 'Assigned to a job', email: true, push: true },
  'offer.approval_requested': {
    label: 'Offer needs your approval',
    email: true,
    push: true,
  },
  'offer.sent': { label: 'Offer sent', email: true, push: true },
  'offer.accepted': { label: 'Offer accepted', email: true, push: true },
  'offer.declined': { label: 'Offer declined', email: true, push: true },
  'message.draft_ready': {
    label: 'Message waiting for approval',
    email: false,
    push: false,
  },
  'ai.task_finished': { label: 'AI task finished', email: false, push: false },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const isNotificationType = (t: string): t is NotificationType =>
  t in NOTIFICATION_TYPES;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain-text mail body -> safe HTML (escaped, line breaks kept). */
export const textToHtml = (text: string) =>
  `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">${esc(
    text
  ).replace(/\r?\n/g, '<br />')}</div>`;

export type NotifyInput = {
  userIds: string[];
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  teamId?: string;
  /** Candidates: never email directly (consequential emails go through message drafts). */
  inAppOnly?: boolean;
};

/**
 * Creates in-app notifications and sends emails according to each user's
 * preferences. Never throws: a notification problem must not fail the
 * operation that triggered it.
 */
export async function notify(input: NotifyInput) {
  const ids = Array.from(new Set(input.userIds.filter(Boolean)));

  if (!ids.length) {
    return { inApp: 0, email: 0, push: 0 };
  }

  let inApp = 0;
  let email = 0;
  let push = 0;

  try {
    const [users, prefs] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, email: true },
      }),
      prisma.notificationPreference.findMany({
        where: { userId: { in: ids }, type: input.type },
      }),
    ]);
    const prefByUser = new Map(prefs.map((p) => [p.userId, p]));
    const pushIds: string[] = [];

    for (const user of users) {
      const pref = prefByUser.get(user.id);
      const wantsInApp = pref ? pref.inApp : true;
      const wantsEmail = pref
        ? pref.email
        : NOTIFICATION_TYPES[input.type].email;

      if (wantsInApp) {
        await prisma.notification.create({
          data: {
            userId: user.id,
            teamId: input.teamId ?? null,
            type: input.type,
            title: input.title,
            body: input.body ?? null,
            link: input.link ?? null,
          },
        });
        inApp++;
      }

      // Web Push only reaches users who subscribed a device (that is the consent)
      const wantsPush = pref ? pref.push : NOTIFICATION_TYPES[input.type].push;

      if (wantsPush) {
        pushIds.push(user.id);
      }

      if (wantsEmail && !input.inAppOnly) {
        try {
          await sendEmail({
            to: user.email,
            subject: input.title,
            html: textToHtml(
              [
                input.body,
                input.link ? `${process.env.APP_URL ?? ''}${input.link}` : '',
              ]
                .filter(Boolean)
                .join('\n\n') || input.title
            ),
          });
          email++;
        } catch (error) {
          console.error('notification email failed', error);
        }
      }
    }
    if (pushIds.length) {
      const r = await sendPushToUsers(pushIds, {
        title: input.title,
        body: input.body,
        url: input.link,
        tag: input.type,
      });

      push = r.sent;
    }
  } catch (error) {
    console.error('notify failed', error);
  }

  return { inApp, email, push };
}

/** Users of a portal holding the given role-assignments on a job. */
export async function jobStaffIds(
  teamId: string,
  jobId: string,
  kinds: ('RECRUITER' | 'HIRING_MANAGER' | 'INTERVIEWER')[] = [
    'RECRUITER',
    'HIRING_MANAGER',
  ]
) {
  const rows = await prisma.jobAssignment.findMany({
    where: { teamId, jobId, kind: { in: kinds } },
    select: { userId: true },
  });

  return rows.map((r) => r.userId);
}
