import type { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';
import { ensureDefaultStages } from './portal';
import { getJobOrThrow, jobScope } from './job';

/** Stages available for a job: its own if it has any, else the portal's. */
export async function getStagesForJob(
  tx: Prisma.TransactionClient,
  teamId: string,
  jobId: string
) {
  const own = await tx.pipelineStage.findMany({
    where: { teamId, jobId },
    orderBy: { order: 'asc' },
  });

  if (own.length) {
    return own;
  }

  await ensureDefaultStages(tx, teamId);

  return tx.pipelineStage.findMany({
    where: { teamId, jobId: null },
    orderBy: { order: 'asc' },
  });
}

export async function getPipeline(ctx: TenantContext, jobId: string) {
  const teamId = ctx.team.id;
  const job = await getJobOrThrow(ctx, jobId);

  const stages = await prisma.$transaction((tx) =>
    getStagesForJob(tx, teamId, jobId)
  );

  const applications = await prisma.jobApplication.findMany({
    where: { teamId, jobId },
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      tenantCandidate: { select: { id: true, name: true, email: true } },
    },
  });

  return {
    job: { id: job.id, title: job.title, status: job.status },
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      order: s.order,
    })),
    applications: applications.map((a) => ({
      id: a.id,
      stageId: a.stageId,
      candidate: a.tenantCandidate,
      appliedAt: a.createdAt,
      withdrawnAt: a.withdrawnAt,
    })),
  };
}

export async function getApplication(
  ctx: TenantContext,
  applicationId: string
) {
  const teamId = ctx.team.id;

  const app = await prisma.jobApplication.findFirst({
    where: {
      id: applicationId,
      teamId,
      job: { teamId, deletedAt: null, ...jobScope(ctx) },
    },
    include: {
      job: { select: { id: true, title: true, slug: true } },
      stage: true,
      tenantCandidate: {
        select: { id: true, name: true, email: true, phone: true },
      },
      resume: { select: { id: true, fileName: true, mime: true, size: true } },
    },
  });

  if (!app) {
    throw new ApiError(404, 'Application not found.');
  }

  const [activities, stages] = await Promise.all([
    prisma.applicationActivity.findMany({
      where: { teamId, applicationId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.$transaction((tx) => getStagesForJob(tx, teamId, app.jobId)),
  ]);

  return {
    id: app.id,
    job: app.job,
    stage: { id: app.stage.id, name: app.stage.name, kind: app.stage.kind },
    stages: stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
    candidate: app.tenantCandidate,
    answers: app.answers,
    rejectionReason: app.rejectionReason,
    withdrawnAt: app.withdrawnAt,
    appliedAt: app.createdAt,
    resume: app.resume,
    activities: activities.map((a) => ({
      id: a.id,
      type: a.type,
      actorUserId: a.actorUserId,
      fromStageId: a.fromStageId,
      toStageId: a.toStageId,
      payload: a.payload,
      createdAt: a.createdAt,
    })),
  };
}

export type StageMoveResult = {
  applicationId: string;
  jobId: string;
  from: { id: string; name: string };
  to: { id: string; name: string; kind: string };
};

/**
 * Moves an application to another stage. The stage change, the append-only
 * activity record and the rejection reason are written in one transaction.
 */
export async function moveApplicationStage(
  ctx: TenantContext,
  applicationId: string,
  stageId: string,
  rejectionReason?: string
): Promise<StageMoveResult> {
  const teamId = ctx.team.id;

  return prisma.$transaction(async (tx) => {
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

    if (app.stage.kind === 'WITHDRAWN') {
      throw new ApiError(409, 'The candidate withdrew this application.');
    }

    const allowed = await getStagesForJob(tx, teamId, app.jobId);
    const target = allowed.find((s) => s.id === stageId);

    if (!target) {
      throw new ApiError(404, 'Stage not found for this job.');
    }

    if (target.kind === 'WITHDRAWN') {
      throw new ApiError(
        400,
        'Only the candidate can withdraw an application.'
      );
    }

    if (target.id === app.stageId) {
      throw new ApiError(400, 'The application is already in this stage.');
    }

    await tx.jobApplication.update({
      where: { id: app.id, teamId },
      data: {
        stageId: target.id,
        rejectionReason:
          target.kind === 'REJECTED' ? (rejectionReason ?? null) : null,
      },
    });

    await tx.applicationActivity.create({
      data: {
        teamId,
        applicationId: app.id,
        actorUserId: ctx.user.id,
        type: 'STAGE_CHANGED',
        fromStageId: app.stageId,
        toStageId: target.id,
        payload: {
          fromName: app.stage.name,
          toName: target.name,
          ...(target.kind === 'REJECTED' && rejectionReason
            ? { reason: rejectionReason }
            : {}),
        },
      },
    });

    return {
      applicationId: app.id,
      jobId: app.jobId,
      from: { id: app.stage.id, name: app.stage.name },
      to: { id: target.id, name: target.name, kind: target.kind },
    };
  });
}

/** Resume of an application, only for recruiters allowed to see it. */
export async function getApplicationResume(
  ctx: TenantContext,
  applicationId: string
) {
  const app = await prisma.jobApplication.findFirst({
    where: {
      id: applicationId,
      teamId: ctx.team.id,
      job: { teamId: ctx.team.id, deletedAt: null, ...jobScope(ctx) },
    },
    include: { resume: true },
  });

  if (!app?.resume) {
    throw new ApiError(404, 'Resume not found.');
  }

  return app.resume;
}
