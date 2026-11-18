import type { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';
import { ensureDefaultStages } from './portal';
import { getJobOrThrow } from './job';

const view = (s: {
  id: string;
  name: string;
  kind: string;
  order: number;
  jobId: string | null;
}) => ({
  id: s.id,
  name: s.name,
  kind: s.kind,
  order: s.order,
  jobId: s.jobId,
});

/** Stages of the portal pipeline (jobId = null) or of one job's own pipeline. */
export async function listStages(ctx: TenantContext, jobId?: string) {
  const teamId = ctx.team.id;

  if (jobId) {
    await getJobOrThrow(ctx, jobId);

    const own = await prisma.pipelineStage.findMany({
      where: { teamId, jobId },
      orderBy: { order: 'asc' },
    });

    if (own.length) {
      return { custom: true, stages: own.map(view) };
    }
  }

  await prisma.$transaction((tx) => ensureDefaultStages(tx, teamId));

  const defaults = await prisma.pipelineStage.findMany({
    where: { teamId, jobId: null },
    orderBy: { order: 'asc' },
  });

  return { custom: false, stages: defaults.map(view) };
}

async function scopeStages(
  tx: Prisma.TransactionClient,
  teamId: string,
  jobId: string | null
) {
  return tx.pipelineStage.findMany({
    where: { teamId, jobId },
    orderBy: { order: 'asc' },
  });
}

async function renumber(
  tx: Prisma.TransactionClient,
  teamId: string,
  ids: string[]
) {
  for (let i = 0; i < ids.length; i++) {
    await tx.pipelineStage.updateMany({
      where: { teamId, id: ids[i] },
      data: { order: i },
    });
  }
}

/** Inserts a custom ACTIVE stage after `afterStageId` (default: last active stage). */
export async function createStage(
  ctx: TenantContext,
  input: { name: string; jobId?: string; afterStageId?: string }
) {
  const teamId = ctx.team.id;
  const jobId = input.jobId ?? null;

  if (jobId) {
    await getJobOrThrow(ctx, jobId);
  }

  return prisma.$transaction(async (tx) => {
    if (!jobId) {
      await ensureDefaultStages(tx, teamId);
    }

    const stages = await scopeStages(tx, teamId, jobId);

    if (jobId && !stages.length) {
      throw new ApiError(
        409,
        'This job uses the portal pipeline. Customise it first.'
      );
    }

    if (stages.some((s) => s.name.toLowerCase() === input.name.toLowerCase())) {
      throw new ApiError(409, 'A stage with this name already exists.');
    }

    const active = stages.filter((s) => s.kind === 'ACTIVE');
    const terminal = stages.filter((s) => s.kind !== 'ACTIVE');
    let at = active.length;

    if (input.afterStageId) {
      const idx = active.findIndex((s) => s.id === input.afterStageId);

      if (idx < 0) {
        throw new ApiError(404, 'Stage not found.');
      }

      at = idx + 1;
    }

    const created = await tx.pipelineStage.create({
      data: { teamId, jobId, name: input.name, kind: 'ACTIVE', order: 0 },
    });

    const ordered = [
      ...active.slice(0, at),
      created,
      ...active.slice(at),
      ...terminal,
    ];

    await renumber(
      tx,
      teamId,
      ordered.map((s) => s.id)
    );

    return view({ ...created, order: at });
  });
}

export async function renameStage(
  ctx: TenantContext,
  stageId: string,
  name: string
) {
  const teamId = ctx.team.id;
  const s = await prisma.pipelineStage.findFirst({
    where: { id: stageId, teamId },
  });

  if (!s) {
    throw new ApiError(404, 'Stage not found.');
  }

  const clash = await prisma.pipelineStage.count({
    where: {
      teamId,
      jobId: s.jobId,
      id: { not: s.id },
      name: { equals: name, mode: 'insensitive' },
    },
  });

  if (clash) {
    throw new ApiError(409, 'A stage with this name already exists.');
  }

  const updated = await prisma.pipelineStage.update({
    where: { id: s.id, teamId },
    data: { name },
  });

  return view(updated);
}

/** Reorders the ACTIVE stages; the terminal stages always stay at the end. */
export async function reorderStages(
  ctx: TenantContext,
  orderedIds: string[],
  jobId?: string
) {
  const teamId = ctx.team.id;

  if (jobId) {
    await getJobOrThrow(ctx, jobId);
  }

  return prisma.$transaction(async (tx) => {
    const stages = await scopeStages(tx, teamId, jobId ?? null);
    const active = stages.filter((s) => s.kind === 'ACTIVE');
    const terminal = stages.filter((s) => s.kind !== 'ACTIVE');

    const same =
      orderedIds.length === active.length &&
      new Set(orderedIds).size === active.length &&
      orderedIds.every((id) => active.some((s) => s.id === id));

    if (!same) {
      throw new ApiError(
        422,
        'Send every active stage of this pipeline exactly once.'
      );
    }

    await renumber(tx, teamId, [...orderedIds, ...terminal.map((s) => s.id)]);

    return (await scopeStages(tx, teamId, jobId ?? null)).map(view);
  });
}

export async function deleteStage(ctx: TenantContext, stageId: string) {
  const teamId = ctx.team.id;

  await prisma.$transaction(async (tx) => {
    const s = await tx.pipelineStage.findFirst({
      where: { id: stageId, teamId },
    });

    if (!s) {
      throw new ApiError(404, 'Stage not found.');
    }

    if (s.kind !== 'ACTIVE') {
      throw new ApiError(
        409,
        'The Hired, Rejected and Withdrawn stages cannot be deleted.'
      );
    }

    const siblings = await scopeStages(tx, teamId, s.jobId);

    if (siblings.filter((x) => x.kind === 'ACTIVE').length <= 1) {
      throw new ApiError(409, 'A pipeline needs at least one active stage.');
    }

    if (await tx.jobApplication.count({ where: { teamId, stageId } })) {
      throw new ApiError(
        409,
        'Move the applications out of this stage before deleting it.'
      );
    }

    const rules = await tx.automationRule.findMany({
      where: { teamId },
      select: { name: true, trigger: true },
    });
    const used = rules.find(
      (r) => (r.trigger as { stageId?: string }).stageId === stageId
    );

    if (used) {
      throw new ApiError(
        409,
        `The automation rule "${used.name}" uses this stage.`
      );
    }

    await tx.pipelineStage.deleteMany({ where: { id: stageId, teamId } });
    await renumber(
      tx,
      teamId,
      siblings.filter((x) => x.id !== stageId).map((x) => x.id)
    );
  });
}

/** Gives a job its own copy of the portal pipeline (only before it has applications). */
export async function customizeJobPipeline(ctx: TenantContext, jobId: string) {
  const teamId = ctx.team.id;

  await getJobOrThrow(ctx, jobId);

  return prisma.$transaction(async (tx) => {
    if ((await scopeStages(tx, teamId, jobId)).length) {
      throw new ApiError(409, 'This job already has its own pipeline.');
    }

    if (await tx.jobApplication.count({ where: { teamId, jobId } })) {
      throw new ApiError(
        409,
        'A job that already has applications cannot switch pipeline.'
      );
    }

    await ensureDefaultStages(tx, teamId);

    const defaults = await scopeStages(tx, teamId, null);

    await tx.pipelineStage.createMany({
      data: defaults.map((s) => ({
        teamId,
        jobId,
        name: s.name,
        kind: s.kind,
        order: s.order,
      })),
    });

    return (await scopeStages(tx, teamId, jobId)).map(view);
  });
}

export async function resetJobPipeline(ctx: TenantContext, jobId: string) {
  const teamId = ctx.team.id;

  await getJobOrThrow(ctx, jobId);

  await prisma.$transaction(async (tx) => {
    if (await tx.jobApplication.count({ where: { teamId, jobId } })) {
      throw new ApiError(
        409,
        'A job that already has applications cannot switch pipeline.'
      );
    }

    await tx.pipelineStage.deleteMany({ where: { teamId, jobId } });
  });
}
