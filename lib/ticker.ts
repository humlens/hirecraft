import { jobStaffIds, notify } from './notifications';
import { prisma, unguardedPrisma } from './prisma';
import { sendEvent } from './svix';

const H = 3600_000;

export type TickResult = {
  jobsPublished: number;
  jobsClosed: number;
  remindersSent: number;
  offersExpired: number;
  aiLogsDeleted: number;
};

const slugCache = new Map<string, string>();

async function teamSlug(teamId: string) {
  if (!slugCache.has(teamId)) {
    const t = await unguardedPrisma.team.findUnique({
      where: { id: teamId },
      select: { slug: true },
    });

    slugCache.set(teamId, t?.slug ?? '');
  }

  return slugCache.get(teamId) as string;
}

/**
 * Time-based work, safe to run as often as you like (idempotent):
 *  - publish scheduled jobs whose time has come
 *  - close published jobs past their closing date
 *  - interview reminders 24 h and 1 h before the start
 *  - expire unanswered offers
 *
 * It scans across portals with the unguarded client, then does every write
 * through the tenant-guarded client with an explicit teamId.
 * Driven by `worker/index.ts` or any scheduler calling POST /api/internal/tick.
 */
export async function runDueTasks(now = new Date()): Promise<TickResult> {
  const result: TickResult = {
    jobsPublished: 0,
    jobsClosed: 0,
    remindersSent: 0,
    offersExpired: 0,
    aiLogsDeleted: 0,
  };

  // 1. scheduled jobs go live (claimed with a conditional update: no double publish)
  for (const j of await unguardedPrisma.job.findMany({
    where: { status: 'SCHEDULED', publishAt: { lte: now }, deletedAt: null },
    select: { id: true, teamId: true, title: true, slug: true, closesAt: true },
    take: 200,
  })) {
    const claimed = await prisma.job.updateMany({
      where: { id: j.id, teamId: j.teamId, status: 'SCHEDULED' },
      data: { status: 'PUBLISHED', publishedAt: now },
    });

    if (!claimed.count) {
      continue;
    }

    result.jobsPublished++;
    await notify({
      userIds: await jobStaffIds(j.teamId, j.id),
      teamId: j.teamId,
      type: 'job.published',
      title: `Job published: ${j.title}`,
      link: `/teams/${await teamSlug(j.teamId)}/jobs/${j.id}`,
    });
    await sendEvent(j.teamId, 'job.published', {
      id: j.id,
      title: j.title,
      slug: j.slug,
    }).catch(() => undefined);
  }

  // 2. closing dates
  for (const j of await unguardedPrisma.job.findMany({
    where: { status: 'PUBLISHED', closesAt: { lte: now }, deletedAt: null },
    select: { id: true, teamId: true, title: true, slug: true },
    take: 200,
  })) {
    const claimed = await prisma.job.updateMany({
      where: { id: j.id, teamId: j.teamId, status: 'PUBLISHED' },
      data: { status: 'CLOSED' },
    });

    if (!claimed.count) {
      continue;
    }

    result.jobsClosed++;
    await notify({
      userIds: await jobStaffIds(j.teamId, j.id),
      teamId: j.teamId,
      type: 'job.expired',
      title: `Job closed (closing date reached): ${j.title}`,
      link: `/teams/${await teamSlug(j.teamId)}/jobs/${j.id}`,
    });
    await sendEvent(j.teamId, 'job.closed', {
      id: j.id,
      title: j.title,
      slug: j.slug,
    }).catch(() => undefined);
  }

  // 3. interview reminders (a reminder is skipped if the interview was booked
  //    after its window opened; the unique (interview, kind) row makes it send once)
  const upcoming = await unguardedPrisma.interview.findMany({
    where: {
      status: 'SCHEDULED',
      startsAt: { gt: now, lte: new Date(now.getTime() + 24 * H) },
    },
    include: {
      participants: { select: { userId: true } },
      application: {
        select: {
          job: { select: { title: true } },
          tenantCandidate: { select: { name: true, userId: true } },
        },
      },
    },
    take: 500,
  });

  for (const i of upcoming) {
    const windows: [string, number][] = [
      ['24h', 24 * H],
      ['1h', H],
    ];

    for (const [kind, ms] of windows) {
      const opened = i.startsAt.getTime() - ms;

      if (now.getTime() < opened || i.createdAt.getTime() > opened) {
        continue;
      }

      // 24h reminder is pointless once the 1h window is open
      if (kind === '24h' && now.getTime() >= i.startsAt.getTime() - H) {
        continue;
      }

      try {
        await prisma.interviewReminder.create({
          data: { teamId: i.teamId, interviewId: i.id, kind },
        });
      } catch {
        continue; // already sent
      }

      const when = kind === '24h' ? 'tomorrow' : 'in about an hour';
      const slug = await teamSlug(i.teamId);

      await notify({
        userIds: i.participants.map((p) => p.userId),
        teamId: i.teamId,
        type: 'interview.reminder',
        title: `Interview ${when}: ${i.application.tenantCandidate.name}`,
        body: `${i.application.job.title}, ${i.startsAt.toUTCString()}`,
        link: `/teams/${slug}/interviews/${i.id}`,
      });

      if (i.application.tenantCandidate.userId) {
        await notify({
          userIds: [i.application.tenantCandidate.userId],
          teamId: i.teamId,
          type: 'interview.reminder',
          title: `Interview ${when}: ${i.application.job.title}`,
          body: i.startsAt.toUTCString(),
          link: '/me/applications',
          inAppOnly: true,
        });
      }

      result.remindersSent++;
    }
  }

  // 4. offers nobody answered in time
  for (const o of await unguardedPrisma.offer.findMany({
    where: { status: 'SENT', expiresAt: { lte: now } },
    include: {
      application: { select: { tenantCandidate: { select: { name: true } } } },
    },
    take: 200,
  })) {
    const claimed = await prisma.offer.updateMany({
      where: { id: o.id, teamId: o.teamId, status: 'SENT' },
      data: { status: 'EXPIRED' },
    });

    if (claimed.count) {
      result.offersExpired++;

      if (o.createdById) {
        await notify({
          userIds: [o.createdById],
          teamId: o.teamId,
          type: 'offer.declined',
          title: `Offer expired: ${o.application.tenantCandidate.name}`,
          link: `/teams/${await teamSlug(o.teamId)}/offers/${o.id}`,
        });
      }
    }
  }

  // 5. AI request logs are kept only for the portal's retention period
  const purged = await unguardedPrisma.aIRequestLog.deleteMany({
    where: { expiresAt: { lte: now } },
  });

  result.aiLogsDeleted = purged.count;

  return result;
}
