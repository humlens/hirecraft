import type { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/errors';
import { prisma, unguardedPrisma } from '@/lib/prisma';
import { notify } from '@/lib/notifications';
import type { TenantContext } from '@/lib/tenant';
import { jobScope } from './job';
import { getStagesForJob } from './application';
import { assertMembersWith } from './interview';
import { deliverApproved } from './message';

const OPEN: ('DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'SENT')[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT',
];

const include = {
  approvals: { orderBy: [{ round: 'asc' }, { order: 'asc' }] },
  application: {
    select: {
      id: true,
      job: {
        select: {
          id: true,
          title: true,
          salaryMin: true,
          salaryMax: true,
          salaryCurrency: true,
        },
      },
      tenantCandidate: {
        select: { id: true, name: true, email: true, userId: true },
      },
    },
  },
} satisfies Prisma.OfferInclude;

type Row = Prisma.OfferGetPayload<{ include: typeof include }>;

const canManage = (ctx: TenantContext) => ctx.permissions.has('offers.manage');

/** Managers see offers of jobs in their scope; approvers see the offers they must decide. */
const visibleWhere = (ctx: TenantContext): Prisma.OfferWhereInput => {
  const teamId = ctx.team.id;
  const approver: Prisma.OfferWhereInput = {
    approvals: { some: { teamId, approverUserId: ctx.user.id } },
  };

  return canManage(ctx)
    ? {
        OR: [
          { application: { teamId, job: { teamId, ...jobScope(ctx) } } },
          approver,
        ],
      }
    : approver;
};

async function names(ids: string[]) {
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });

  return new Map(users.map((u) => [u.id, u.name]));
}

/** Compares the fixed pay with the job's approved salary band (advisory only). */
export function bandCheck(
  fixed: number,
  job: { salaryMin: number | null; salaryMax: number | null },
  expected: number | null
) {
  const { salaryMin: min, salaryMax: max } = job;

  if (min == null && max == null) {
    return { status: 'NONE' as const, min, max, expected };
  }

  const status =
    min != null && fixed < min
      ? ('BELOW' as const)
      : max != null && fixed > max
        ? ('ABOVE' as const)
        : ('WITHIN' as const);

  return { status, min, max, expected };
}

async function toView(o: Row) {
  const people = await names(o.approvals.map((a) => a.approverUserId));
  const profile = o.application.tenantCandidate.userId
    ? await prisma.candidateProfile.findUnique({
        where: { userId: o.application.tenantCandidate.userId },
        select: { expectedSalary: true },
      })
    : null;

  return {
    id: o.id,
    applicationId: o.applicationId,
    job: { id: o.application.job.id, title: o.application.job.title },
    band: bandCheck(
      o.fixed,
      o.application.job,
      profile?.expectedSalary ?? null
    ),
    templateKey: o.templateKey,
    candidate: {
      id: o.application.tenantCandidate.id,
      name: o.application.tenantCandidate.name,
    },
    fixed: o.fixed,
    variable: o.variable,
    joiningBonus: o.joiningBonus,
    currency: o.currency,
    equityNote: o.equityNote,
    startDate: o.startDate,
    expiresAt: o.expiresAt,
    terms: o.terms,
    status: o.status,
    round: o.round,
    sentAt: o.sentAt,
    respondedAt: o.respondedAt,
    createdAt: o.createdAt,
    approvals: o.approvals.map((a) => ({
      userId: a.approverUserId,
      name: people.get(a.approverUserId) ?? '',
      round: a.round,
      order: a.order,
      status: a.status,
      comment: a.comment,
      decidedAt: a.decidedAt,
    })),
  };
}

export type OfferView = Awaited<ReturnType<typeof toView>>;

export async function listOffers(
  ctx: TenantContext,
  f: { status?: string; applicationId?: string }
) {
  const rows = await prisma.offer.findMany({
    where: {
      AND: [visibleWhere(ctx)],
      teamId: ctx.team.id,
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.applicationId ? { applicationId: f.applicationId } : {}),
    },
    include,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return Promise.all(rows.map(toView));
}

async function getRow(ctx: TenantContext, id: string) {
  const o = await prisma.offer.findFirst({
    where: { AND: [visibleWhere(ctx)], teamId: ctx.team.id, id },
    include,
  });

  if (!o) {
    throw new ApiError(404, 'Offer not found.');
  }

  return o;
}

export const getOffer = async (ctx: TenantContext, id: string) =>
  toView(await getRow(ctx, id));

type OfferInput = {
  fixed: number;
  variable?: number;
  joiningBonus?: number;
  currency?: string;
  equityNote?: string | null;
  startDate?: Date | null;
  expiresAt?: Date | null;
  terms?: string | null;
  templateKey?: string | null;
};

export async function createOffer(
  ctx: TenantContext,
  applicationId: string,
  input: OfferInput
) {
  const teamId = ctx.team.id;

  const offer = await prisma.$transaction(async (tx) => {
    const app = await tx.jobApplication.findFirst({
      where: {
        id: applicationId,
        teamId,
        job: { teamId, deletedAt: null, ...jobScope(ctx) },
      },
      include: { stage: true },
    });

    if (!app) {
      throw new ApiError(404, 'Application not found.');
    }

    if (app.stage.kind !== 'ACTIVE') {
      throw new ApiError(
        409,
        'Offers can only be made to active applications.'
      );
    }

    const open = await tx.offer.count({
      where: { teamId, applicationId, status: { in: OPEN } },
    });

    if (open) {
      throw new ApiError(409, 'This application already has an open offer.');
    }

    return tx.offer.create({
      data: { teamId, applicationId, createdById: ctx.user.id, ...input },
    });
  });

  return getOffer(ctx, offer.id);
}

export async function updateOffer(
  ctx: TenantContext,
  id: string,
  input: Partial<OfferInput>
) {
  const o = await getRow(ctx, id);

  if (!canManage(ctx)) {
    throw new ApiError(403, 'You cannot edit offers.');
  }

  if (o.status !== 'DRAFT') {
    throw new ApiError(409, 'Only draft offers can be edited.');
  }

  await prisma.offer.update({
    where: { id, teamId: ctx.team.id },
    data: input,
  });

  return getOffer(ctx, id);
}

export async function submitForApproval(
  ctx: TenantContext,
  id: string,
  approverIds: string[]
) {
  const teamId = ctx.team.id;
  const ids = Array.from(new Set(approverIds));

  if (!ids.length || ids.length !== approverIds.length) {
    throw new ApiError(422, 'Choose at least one approver, each only once.');
  }

  if (ids.includes(ctx.user.id)) {
    throw new ApiError(
      422,
      'You cannot approve an offer you submit. Choose other approvers.'
    );
  }

  await assertMembersWith(teamId, ids, 'offers.approve', 'approve offers');

  const o = await getRow(ctx, id);

  if (o.createdById && ids.includes(o.createdById)) {
    throw new ApiError(
      422,
      'The offer creator cannot approve their own offer.'
    );
  }

  await prisma.$transaction(async (tx) => {
    const changed = await tx.offer.updateMany({
      where: { id, teamId, status: 'DRAFT' },
      data: { status: 'PENDING_APPROVAL', round: o.round + 1 },
    });

    if (!changed.count) {
      throw new ApiError(
        409,
        'Only draft offers can be submitted for approval.'
      );
    }

    await tx.offerApproval.createMany({
      data: ids.map((approverUserId, order) => ({
        teamId,
        offerId: id,
        approverUserId,
        round: o.round + 1,
        order,
      })),
    });
  });

  await notify({
    userIds: [ids[0]],
    teamId,
    type: 'offer.approval_requested',
    title: `Offer approval needed: ${o.application.tenantCandidate.name}`,
    body: o.application.job.title,
    link: `/teams/${ctx.team.slug}/offers/${id}`,
  });

  return getOffer(ctx, id);
}

/** Sequential approval chain: only the next pending approver can decide. */
export async function decide(
  ctx: TenantContext,
  id: string,
  decision: 'APPROVED' | 'REJECTED',
  comment?: string
) {
  const teamId = ctx.team.id;
  const o = await getRow(ctx, id);

  const result = await prisma.$transaction(async (tx) => {
    // Serialise concurrent decisions on the same offer.
    await tx.$queryRaw`SELECT id FROM "Offer" WHERE id = ${id} AND "teamId" = ${teamId} FOR UPDATE`;

    const fresh = await tx.offer.findFirstOrThrow({ where: { id, teamId } });

    if (fresh.status !== 'PENDING_APPROVAL') {
      throw new ApiError(409, 'This offer is not waiting for approval.');
    }

    const pending = await tx.offerApproval.findMany({
      where: { teamId, offerId: id, round: fresh.round, status: 'PENDING' },
      orderBy: { order: 'asc' },
    });
    const mine = pending.find((a) => a.approverUserId === ctx.user.id);

    if (!mine) {
      throw new ApiError(
        403,
        'You are not an approver of this offer, or you already decided.'
      );
    }

    if (pending[0].id !== mine.id) {
      throw new ApiError(409, 'An earlier approver has to decide first.');
    }

    await tx.offerApproval.update({
      where: { id: mine.id, teamId },
      data: {
        status: decision,
        comment: comment ?? null,
        decidedAt: new Date(),
      },
    });

    let next: 'APPROVED' | 'DRAFT' | null = null;
    let nextApprover: string | null = null;

    if (decision === 'REJECTED') {
      next = 'DRAFT'; // back to the creator for changes
    } else if (pending.length === 1) {
      next = 'APPROVED';
    } else {
      nextApprover = pending[1].approverUserId;
    }

    if (next) {
      await tx.offer.update({ where: { id, teamId }, data: { status: next } });
    }

    await tx.applicationActivity.create({
      data: {
        teamId,
        applicationId: fresh.applicationId,
        actorUserId: ctx.user.id,
        type: 'OFFER',
        payload: {
          action: decision === 'APPROVED' ? 'approved' : 'rejected',
          offerId: id,
        },
      },
    });

    return { next, nextApprover };
  });

  const link = `/teams/${ctx.team.slug}/offers/${id}`;

  if (result.nextApprover) {
    await notify({
      userIds: [result.nextApprover],
      teamId,
      type: 'offer.approval_requested',
      title: `Offer approval needed: ${o.application.tenantCandidate.name}`,
      link,
    });
  } else if (o.createdById) {
    await notify({
      userIds: [o.createdById],
      teamId,
      type: 'offer.approval_requested',
      title:
        decision === 'APPROVED'
          ? `Offer approved: ${o.application.tenantCandidate.name}`
          : `Offer rejected: ${o.application.tenantCandidate.name}`,
      body: comment,
      link,
    });
  }

  return getOffer(ctx, id);
}

export async function sendOffer(ctx: TenantContext, id: string) {
  const teamId = ctx.team.id;
  const o = await getRow(ctx, id);

  if (!canManage(ctx)) {
    throw new ApiError(403, 'You cannot send offers.');
  }

  if (o.expiresAt && o.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(
      422,
      'The offer has already expired. Update the expiry date first.'
    );
  }

  const lastApprover = o.approvals
    .filter((a) => a.round === o.round && a.status === 'APPROVED')
    .sort((a, b) => b.order - a.order)[0];

  const draft = await prisma.$transaction(async (tx) => {
    const changed = await tx.offer.updateMany({
      where: { id, teamId, status: 'APPROVED' },
      data: { status: 'SENT', sentAt: new Date() },
    });

    if (!changed.count) {
      throw new ApiError(409, 'Only approved offers can be sent.');
    }

    await tx.applicationActivity.create({
      data: {
        teamId,
        applicationId: o.applicationId,
        actorUserId: ctx.user.id,
        type: 'OFFER',
        payload: { action: 'sent', offerId: id },
      },
    });

    // The approval chain is the human approval of this message.
    return tx.messageDraft.create({
      data: {
        teamId,
        applicationId: o.applicationId,
        recipientEmail: o.application.tenantCandidate.email,
        recipientName: o.application.tenantCandidate.name,
        kind: 'OFFER',
        subject: `Your offer for ${o.application.job.title} at ${ctx.team.name}`,
        body: [
          `Hi ${o.application.tenantCandidate.name},`,
          '',
          `We are delighted to offer you the ${o.application.job.title} role at ${ctx.team.name}.`,
          'Please sign in to your candidate account to review the full offer and respond.',
        ].join('\n'),
        createdById: ctx.user.id,
        status: 'APPROVED',
        approvedById: lastApprover?.approverUserId ?? ctx.user.id,
        approvedAt: new Date(),
      },
    });
  });

  // Delivery failures do not undo the offer; the draft can be re-sent from Messages.
  await deliverApproved(teamId, draft.id, ctx.user.id).catch(() => undefined);

  if (o.application.tenantCandidate.userId) {
    await notify({
      userIds: [o.application.tenantCandidate.userId],
      teamId,
      type: 'offer.sent',
      title: `You have an offer: ${o.application.job.title}`,
      body: ctx.team.name,
      link: '/me/offers',
      inAppOnly: true, // the email goes out as an approved message
    });
  }

  return getOffer(ctx, id);
}

// ---------------------------------------------------------------------------
// Candidate side
// ---------------------------------------------------------------------------

export async function listMyOffers(userId: string) {
  const rows = await unguardedPrisma.offer.findMany({
    where: {
      status: { in: ['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED'] },
      sentAt: { not: null },
      application: { tenantCandidate: { userId } },
    },
    orderBy: { sentAt: 'desc' },
    include: {
      application: {
        select: {
          job: { select: { title: true, team: { select: { name: true } } } },
        },
      },
    },
  });

  return rows.map((o) => ({
    id: o.id,
    job: o.application.job.title,
    portal: o.application.job.team.name,
    fixed: o.fixed,
    variable: o.variable,
    joiningBonus: o.joiningBonus,
    currency: o.currency,
    equityNote: o.equityNote,
    startDate: o.startDate,
    expiresAt: o.expiresAt,
    terms: o.terms,
    status:
      o.expiresAt && o.status === 'SENT' && o.expiresAt <= new Date()
        ? 'EXPIRED'
        : o.status,
    sentAt: o.sentAt,
  }));
}

export async function respondToOffer(
  userId: string,
  offerId: string,
  accept: boolean
) {
  const found = await unguardedPrisma.offer.findFirst({
    where: { id: offerId, application: { tenantCandidate: { userId } } },
    select: { id: true, teamId: true },
  });

  if (!found) {
    throw new ApiError(404, 'Offer not found.');
  }

  const teamId = found.teamId;

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Offer" WHERE id = ${offerId} AND "teamId" = ${teamId} FOR UPDATE`;

    const o = await tx.offer.findFirstOrThrow({
      where: { id: offerId, teamId },
      include: { application: { include: { stage: true } } },
    });

    if (o.status !== 'SENT') {
      throw new ApiError(
        409,
        `This offer is ${o.status.toLowerCase().replace('_', ' ')} and cannot be answered.`
      );
    }

    if (o.expiresAt && o.expiresAt.getTime() <= Date.now()) {
      await tx.offer.update({
        where: { id: offerId, teamId },
        data: { status: 'EXPIRED' },
      });

      return { expired: true as const };
    }

    await tx.offer.update({
      where: { id: offerId, teamId },
      data: {
        status: accept ? 'ACCEPTED' : 'DECLINED',
        respondedAt: new Date(),
      },
    });

    await tx.applicationActivity.create({
      data: {
        teamId,
        applicationId: o.applicationId,
        actorUserId: userId,
        type: 'OFFER',
        payload: { action: accept ? 'accepted' : 'declined', offerId },
      },
    });

    let hired: { stageId: string; stageName: string } | null = null;

    if (accept) {
      const stages = await getStagesForJob(tx, teamId, o.application.jobId);
      const hiredStage = stages.find((s) => s.kind === 'HIRED');

      if (hiredStage && hiredStage.id !== o.application.stageId) {
        await tx.jobApplication.update({
          where: { id: o.applicationId, teamId },
          data: { stageId: hiredStage.id, rejectionReason: null },
        });
        await tx.applicationActivity.create({
          data: {
            teamId,
            applicationId: o.applicationId,
            actorUserId: userId,
            type: 'STAGE_CHANGED',
            fromStageId: o.application.stageId,
            toStageId: hiredStage.id,
            payload: {
              fromName: o.application.stage.name,
              toName: hiredStage.name,
              reason: 'offer accepted',
            },
          },
        });
        hired = { stageId: hiredStage.id, stageName: hiredStage.name };
      }
    }

    return {
      expired: false as const,
      accepted: accept,
      hired,
      teamId,
      offerId,
      applicationId: o.applicationId,
      jobId: o.application.jobId,
      createdById: o.createdById,
    };
  });
}
