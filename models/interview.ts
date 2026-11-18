import type { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/errors';
import { getEffectivePermissions } from '@/lib/authz';
import { prisma, unguardedPrisma } from '@/lib/prisma';
import { notify } from '@/lib/notifications';
import type { PermissionKey } from '@/lib/portal-roles';
import type { TenantContext } from '@/lib/tenant';
import { jobScope } from './job';

export const DEFAULT_COMPETENCIES = [
  'Technical skills',
  'Problem solving',
  'Communication',
  'Culture fit',
];

/** Effective permissions of any member of a portal (for validating assignees). */
export async function memberPermissions(teamId: string, userId: string) {
  const m = await prisma.teamMember.findFirst({
    where: { teamId, userId },
    include: {
      portalRole: {
        select: {
          key: true,
          permissions: { select: { permission: { select: { key: true } } } },
        },
      },
    },
  });

  return m ? getEffectivePermissions(m) : null;
}

export async function assertMembersWith(
  teamId: string,
  userIds: string[],
  key: PermissionKey,
  what: string
) {
  for (const id of userIds) {
    const perms = await memberPermissions(teamId, id);

    if (!perms) {
      throw new ApiError(422, 'Every person must be a member of this portal.');
    }

    if (!perms.has(key)) {
      throw new ApiError(422, `Someone selected cannot ${what}.`);
    }
  }
}

const interviewInclude = {
  participants: true,
  feedback: true,
  application: {
    select: {
      id: true,
      job: { select: { id: true, title: true } },
      tenantCandidate: {
        select: { id: true, name: true, email: true, userId: true },
      },
    },
  },
} satisfies Prisma.InterviewInclude;

type Row = Prisma.InterviewGetPayload<{ include: typeof interviewInclude }>;

async function names(ids: string[]) {
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });

  return new Map(users.map((u) => [u.id, u.name]));
}

const canManage = (ctx: TenantContext) =>
  ctx.permissions.has('interviews.manage');

/** Visibility: managers see interviews of jobs in their scope; others only their own. */
const visibleWhere = (ctx: TenantContext): Prisma.InterviewWhereInput => {
  const teamId = ctx.team.id;

  return canManage(ctx)
    ? { teamId, application: { teamId, job: { teamId, ...jobScope(ctx) } } }
    : { teamId, participants: { some: { teamId, userId: ctx.user.id } } };
};

async function toView(ctx: TenantContext, i: Row) {
  const people = await names(i.participants.map((p) => p.userId));
  const manager = canManage(ctx);

  return {
    id: i.id,
    applicationId: i.applicationId,
    round: i.round,
    startsAt: i.startsAt,
    durationMin: i.durationMin,
    location: i.location,
    meetingUrl: i.meetingUrl,
    status: i.status,
    job: i.application.job,
    candidate: {
      id: i.application.tenantCandidate.id,
      name: i.application.tenantCandidate.name,
    },
    participants: i.participants.map((p) => ({
      userId: p.userId,
      name: people.get(p.userId) ?? '',
      submitted: i.feedback.some((f) => f.userId === p.userId),
    })),
    // Feedback is private to its author unless you manage interviews.
    feedback: i.feedback
      .filter((f) => manager || f.userId === ctx.user.id)
      .map((f) => ({
        userId: f.userId,
        name: people.get(f.userId) ?? '',
        scores: f.scores,
        recommendation: f.recommendation,
        notes: f.notes,
        submittedAt: f.submittedAt,
      })),
  };
}

export async function listInterviews(
  ctx: TenantContext,
  f: { from?: Date; to?: Date; status?: string; applicationId?: string }
) {
  const rows = await prisma.interview.findMany({
    where: {
      AND: [visibleWhere(ctx)],
      teamId: ctx.team.id,
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.applicationId ? { applicationId: f.applicationId } : {}),
      ...(f.from || f.to
        ? {
            startsAt: {
              ...(f.from ? { gte: f.from } : {}),
              ...(f.to ? { lte: f.to } : {}),
            },
          }
        : {}),
    },
    include: interviewInclude,
    orderBy: { startsAt: 'asc' },
    take: 200,
  });

  return Promise.all(rows.map((r) => toView(ctx, r)));
}

async function getRow(ctx: TenantContext, id: string) {
  const row = await prisma.interview.findFirst({
    where: { AND: [visibleWhere(ctx)], teamId: ctx.team.id, id },
    include: interviewInclude,
  });

  if (!row) {
    throw new ApiError(404, 'Interview not found.');
  }

  return row;
}

export async function getInterview(ctx: TenantContext, id: string) {
  return toView(ctx, await getRow(ctx, id));
}

const inviteBody = (args: {
  name: string;
  job: string;
  company: string;
  startsAt: Date;
  durationMin: number;
  location?: string | null;
  meetingUrl?: string | null;
}) =>
  [
    `Hi ${args.name},`,
    '',
    `We would like to invite you to an interview for the ${args.job} role at ${args.company}.`,
    '',
    `When: ${args.startsAt.toUTCString()} (${args.durationMin} minutes)`,
    args.location ? `Where: ${args.location}` : '',
    args.meetingUrl ? `Join: ${args.meetingUrl}` : '',
    '',
    'Please reply to confirm that this time works for you.',
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');

export async function scheduleInterview(
  ctx: TenantContext,
  applicationId: string,
  input: {
    startsAt: Date;
    durationMin: number;
    location?: string | null;
    meetingUrl?: string | null;
    participantIds: string[];
  }
) {
  const teamId = ctx.team.id;

  if (input.startsAt.getTime() <= Date.now()) {
    throw new ApiError(422, 'The interview must be in the future.');
  }

  const participantIds = Array.from(new Set(input.participantIds));

  await assertMembersWith(
    teamId,
    participantIds,
    'feedback.submit',
    'submit interview feedback'
  );

  const created = await prisma.$transaction(async (tx) => {
    const app = await tx.jobApplication.findFirst({
      where: {
        id: applicationId,
        teamId,
        job: { teamId, deletedAt: null, ...jobScope(ctx) },
      },
      include: {
        stage: true,
        job: { select: { id: true, title: true } },
        tenantCandidate: { select: { name: true, email: true, userId: true } },
      },
    });

    if (!app) {
      throw new ApiError(404, 'Application not found.');
    }

    if (app.stage.kind !== 'ACTIVE') {
      throw new ApiError(
        409,
        'Interviews can only be scheduled for active applications.'
      );
    }

    const round =
      (await tx.interview.count({ where: { teamId, applicationId } })) + 1;

    const interview = await tx.interview.create({
      data: {
        teamId,
        applicationId,
        round,
        startsAt: input.startsAt,
        durationMin: input.durationMin,
        location: input.location ?? null,
        meetingUrl: input.meetingUrl ?? null,
        createdById: ctx.user.id,
        participants: {
          create: participantIds.map((userId) => ({ teamId, userId })),
        },
      },
    });

    await tx.applicationActivity.create({
      data: {
        teamId,
        applicationId,
        actorUserId: ctx.user.id,
        type: 'INTERVIEW',
        payload: {
          action: 'scheduled',
          interviewId: interview.id,
          round,
          startsAt: input.startsAt.toISOString(),
        },
      },
    });

    // The invitation to the candidate is a DRAFT: a human approves it before it is sent.
    const draft = await tx.messageDraft.create({
      data: {
        teamId,
        applicationId,
        recipientEmail: app.tenantCandidate.email,
        recipientName: app.tenantCandidate.name,
        kind: 'INTERVIEW_INVITE',
        subject: `Interview invitation: ${app.job.title}`,
        body: inviteBody({
          name: app.tenantCandidate.name,
          job: app.job.title,
          company: ctx.team.name,
          startsAt: input.startsAt,
          durationMin: input.durationMin,
          location: input.location,
          meetingUrl: input.meetingUrl,
        }),
        createdById: ctx.user.id,
      },
    });

    return { interview, draftId: draft.id, app };
  });

  const link = `/teams/${ctx.team.slug}/interviews/${created.interview.id}`;

  await notify({
    userIds: participantIds,
    teamId,
    type: 'interview.scheduled',
    title: `Interview scheduled: ${created.app.tenantCandidate.name}`,
    body: `${created.app.job.title}, round ${created.interview.round}, ${input.startsAt.toUTCString()}`,
    link,
  });

  if (created.app.tenantCandidate.userId) {
    await notify({
      userIds: [created.app.tenantCandidate.userId],
      teamId,
      type: 'interview.scheduled',
      title: `Interview scheduled: ${created.app.job.title}`,
      body: input.startsAt.toUTCString(),
      link: '/me/applications',
      inAppOnly: true,
    });
  }

  return {
    ...(await getInterview(ctx, created.interview.id)),
    inviteDraftId: created.draftId,
  };
}

export async function updateInterview(
  ctx: TenantContext,
  id: string,
  input: {
    startsAt?: Date;
    durationMin?: number;
    location?: string | null;
    meetingUrl?: string | null;
    participantIds?: string[];
    status?: 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
  }
) {
  const teamId = ctx.team.id;
  const row = await getRow(ctx, id);

  if (row.status !== 'SCHEDULED') {
    throw new ApiError(
      409,
      `A ${row.status.toLowerCase()} interview cannot be changed.`
    );
  }

  if (input.startsAt && input.startsAt.getTime() <= Date.now()) {
    throw new ApiError(422, 'The interview must be in the future.');
  }

  if (input.participantIds) {
    await assertMembersWith(
      teamId,
      input.participantIds,
      'feedback.submit',
      'submit interview feedback'
    );
  }

  const rescheduled =
    !!input.startsAt && input.startsAt.getTime() !== row.startsAt.getTime();

  await prisma.$transaction(async (tx) => {
    await tx.interview.update({
      where: { id, teamId },
      data: {
        ...(input.startsAt && { startsAt: input.startsAt }),
        ...(input.durationMin && { durationMin: input.durationMin }),
        ...(input.location !== undefined && { location: input.location }),
        ...(input.meetingUrl !== undefined && { meetingUrl: input.meetingUrl }),
        ...(input.status && { status: input.status }),
      },
    });

    if (input.participantIds) {
      const ids = Array.from(new Set(input.participantIds));

      await tx.interviewParticipant.deleteMany({
        where: { teamId, interviewId: id, userId: { notIn: ids } },
      });
      await tx.interviewParticipant.createMany({
        data: ids.map((userId) => ({ teamId, interviewId: id, userId })),
        skipDuplicates: true,
      });
    }

    if (rescheduled) {
      // reminders are relative to the start time, so they fire again
      await tx.interviewReminder.deleteMany({
        where: { teamId, interviewId: id },
      });
    }

    await tx.applicationActivity.create({
      data: {
        teamId,
        applicationId: row.applicationId,
        actorUserId: ctx.user.id,
        type: 'INTERVIEW',
        payload: {
          action: input.status ? input.status.toLowerCase() : 'updated',
          interviewId: id,
          ...(rescheduled ? { startsAt: input.startsAt!.toISOString() } : {}),
        },
      },
    });
  });

  const who = row.participants.map((p) => p.userId);

  if (input.status === 'CANCELLED') {
    await notify({
      userIds: who,
      teamId,
      type: 'interview.cancelled',
      title: `Interview cancelled: ${row.application.tenantCandidate.name}`,
      link: `/teams/${ctx.team.slug}/interviews/${id}`,
    });
  } else if (rescheduled) {
    await notify({
      userIds: input.participantIds ?? who,
      teamId,
      type: 'interview.scheduled',
      title: `Interview rescheduled: ${row.application.tenantCandidate.name}`,
      body: input.startsAt!.toUTCString(),
      link: `/teams/${ctx.team.slug}/interviews/${id}`,
    });
  }

  return getInterview(ctx, id);
}

export async function submitFeedback(
  ctx: TenantContext,
  interviewId: string,
  input: {
    scores: Record<string, number>;
    recommendation: 'STRONG_HIRE' | 'HIRE' | 'NO_HIRE' | 'STRONG_NO_HIRE';
    notes?: string | null;
  }
) {
  const teamId = ctx.team.id;
  const row = await getRow(ctx, interviewId);

  if (!row.participants.some((p) => p.userId === ctx.user.id)) {
    throw new ApiError(403, 'Only interview participants can submit feedback.');
  }

  if (row.status === 'CANCELLED') {
    throw new ApiError(409, 'This interview was cancelled.');
  }

  if (row.startsAt.getTime() > Date.now()) {
    throw new ApiError(409, 'The interview has not taken place yet.');
  }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.interviewFeedback.findFirst({
      where: { teamId, interviewId, userId: ctx.user.id },
    });

    if (existing) {
      await tx.interviewFeedback.update({
        where: { id: existing.id, teamId },
        data: {
          scores: input.scores,
          recommendation: input.recommendation,
          notes: input.notes ?? null,
          submittedAt: new Date(),
        },
      });
    } else {
      await tx.interviewFeedback.create({
        data: {
          teamId,
          interviewId,
          userId: ctx.user.id,
          scores: input.scores,
          recommendation: input.recommendation,
          notes: input.notes ?? null,
        },
      });
    }

    const submitted = await tx.interviewFeedback.count({
      where: { teamId, interviewId },
    });

    if (submitted >= row.participants.length && row.status === 'SCHEDULED') {
      await tx.interview.update({
        where: { id: interviewId, teamId },
        data: { status: 'COMPLETED' },
      });
    }

    await tx.applicationActivity.create({
      data: {
        teamId,
        applicationId: row.applicationId,
        actorUserId: ctx.user.id,
        type: 'INTERVIEW',
        payload: {
          action: 'feedback',
          interviewId,
          recommendation: input.recommendation,
        },
      },
    });
  });

  return getInterview(ctx, interviewId);
}

/** Interviews of one application (for the application page). */
export async function interviewsForApplication(
  ctx: TenantContext,
  applicationId: string
) {
  return listInterviews(ctx, { applicationId });
}

// ---------------------------------------------------------------------------
// Candidate side
// ---------------------------------------------------------------------------

/** Upcoming interviews of a user as a candidate, across portals. */
export async function listMyInterviews(userId: string) {
  const rows = await unguardedPrisma.interview.findMany({
    where: {
      status: 'SCHEDULED',
      startsAt: { gt: new Date() },
      application: { tenantCandidate: { userId } },
    },
    orderBy: { startsAt: 'asc' },
    select: {
      id: true,
      round: true,
      startsAt: true,
      durationMin: true,
      location: true,
      meetingUrl: true,
      application: {
        select: {
          job: { select: { title: true, team: { select: { name: true } } } },
        },
      },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    round: r.round,
    startsAt: r.startsAt,
    durationMin: r.durationMin,
    location: r.location,
    meetingUrl: r.meetingUrl,
    job: r.application.job.title,
    portal: r.application.job.team.name,
  }));
}
