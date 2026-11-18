import type { MessageKind, Prisma } from '@prisma/client';
import { ApiError } from '@/lib/errors';
import { deliverEmail } from '@/lib/mailer';
import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';
import { jobScope } from './job';

const select = {
  id: true,
  applicationId: true,
  recipientEmail: true,
  recipientName: true,
  kind: true,
  subject: true,
  body: true,
  createdById: true,
  createdByAi: true,
  status: true,
  approvedById: true,
  approvedAt: true,
  sentAt: true,
  error: true,
  createdAt: true,
  application: {
    select: { id: true, job: { select: { id: true, title: true } } },
  },
} satisfies Prisma.MessageDraftSelect;

const inScope = (ctx: TenantContext): Prisma.MessageDraftWhereInput => ({
  teamId: ctx.team.id,
  application: {
    teamId: ctx.team.id,
    job: { teamId: ctx.team.id, ...jobScope(ctx) },
  },
});

export async function listDrafts(
  ctx: TenantContext,
  f: { status?: string; applicationId?: string }
) {
  return prisma.messageDraft.findMany({
    where: {
      AND: [inScope(ctx)],
      teamId: ctx.team.id,
      ...(f.status ? { status: f.status as never } : {}),
      ...(f.applicationId ? { applicationId: f.applicationId } : {}),
    },
    select,
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
}

async function getDraft(ctx: TenantContext, id: string) {
  const d = await prisma.messageDraft.findFirst({
    where: { AND: [inScope(ctx)], teamId: ctx.team.id, id },
    select,
  });

  if (!d) {
    throw new ApiError(404, 'Message not found.');
  }

  return d;
}

export async function createDraft(
  ctx: TenantContext,
  input: {
    applicationId: string;
    kind: MessageKind;
    subject: string;
    body: string;
  }
) {
  const teamId = ctx.team.id;
  const app = await prisma.jobApplication.findFirst({
    where: {
      id: input.applicationId,
      teamId,
      job: { teamId, deletedAt: null, ...jobScope(ctx) },
    },
    include: { tenantCandidate: { select: { name: true, email: true } } },
  });

  if (!app) {
    throw new ApiError(404, 'Application not found.');
  }

  return prisma.messageDraft.create({
    data: {
      teamId,
      applicationId: app.id,
      recipientEmail: app.tenantCandidate.email,
      recipientName: app.tenantCandidate.name,
      kind: input.kind,
      subject: input.subject,
      body: input.body,
      createdById: ctx.user.id,
    },
    select,
  });
}

export async function updateDraft(
  ctx: TenantContext,
  id: string,
  input: { subject?: string; body?: string }
) {
  const d = await getDraft(ctx, id);

  if (d.status !== 'DRAFT') {
    throw new ApiError(
      409,
      'Only drafts can be edited. Approved messages are locked.'
    );
  }

  return prisma.messageDraft.update({
    where: { id, teamId: ctx.team.id },
    data: input,
    select,
  });
}

/** A human approves the exact text that will be sent. */
export async function approveDraft(ctx: TenantContext, id: string) {
  const d = await getDraft(ctx, id);

  if (d.status !== 'DRAFT') {
    throw new ApiError(
      409,
      `A ${d.status.toLowerCase()} message cannot be approved.`
    );
  }

  return prisma.messageDraft.update({
    where: { id, teamId: ctx.team.id },
    data: {
      status: 'APPROVED',
      approvedById: ctx.user.id,
      approvedAt: new Date(),
      error: null,
    },
    select,
  });
}

export async function discardDraft(ctx: TenantContext, id: string) {
  const d = await getDraft(ctx, id);

  if (d.status === 'SENT' || d.status === 'DISCARDED') {
    throw new ApiError(
      409,
      `A ${d.status.toLowerCase()} message cannot be discarded.`
    );
  }

  return prisma.messageDraft.update({
    where: { id, teamId: ctx.team.id },
    data: { status: 'DISCARDED' },
    select,
  });
}

/** Sends an APPROVED message. Unapproved messages are never sent. */
export async function sendDraft(ctx: TenantContext, id: string) {
  const d = await getDraft(ctx, id);

  if (d.status !== 'APPROVED') {
    throw new ApiError(409, 'Only approved messages can be sent.');
  }

  return deliverApproved(ctx.team.id, d.id, ctx.user.id);
}

/** Shared by the send endpoint and by flows whose approval already happened (offers). */
export async function deliverApproved(
  teamId: string,
  id: string,
  actorId: string | null
) {
  // Claim the message so concurrent sends cannot deliver it twice: only one
  // caller can flip `sentAt` from null (it is cleared again if delivery fails).
  const claimed = await prisma.messageDraft.updateMany({
    where: { id, teamId, status: 'APPROVED', sentAt: null },
    data: { sentAt: new Date(), error: null },
  });

  if (!claimed.count) {
    throw new ApiError(
      409,
      'This message was already sent or is not approved.'
    );
  }

  const d = await prisma.messageDraft.findFirstOrThrow({
    where: { id, teamId },
  });

  try {
    await deliverEmail({
      to: d.recipientEmail,
      subject: d.subject,
      body: d.body,
    });
  } catch (error: any) {
    await prisma.messageDraft.update({
      where: { id, teamId },
      data: { sentAt: null, error: error.message },
    });
    throw error;
  }

  await prisma.$transaction(async (tx) => {
    await tx.messageDraft.update({
      where: { id, teamId },
      data: { status: 'SENT', sentAt: new Date(), error: null },
    });

    if (d.applicationId) {
      await tx.applicationActivity.create({
        data: {
          teamId,
          applicationId: d.applicationId,
          actorUserId: actorId,
          type: 'EMAIL',
          payload: { draftId: d.id, kind: d.kind, subject: d.subject },
        },
      });
    }
  });

  return prisma.messageDraft.findFirstOrThrow({
    where: { id, teamId },
    select,
  });
}
