import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';
import { jobStaffIds, notify } from '@/lib/notifications';
import { unguardedPrisma } from '@/lib/prisma';

/**
 * Automation rules: WHEN (trigger) THEN (action).
 *
 * Safety rules built into the schema:
 *  - there is no "move stage" or "reject" action, so automation can never
 *    reject a candidate or loop through stage changes;
 *  - message actions only ever create a DRAFT that a human must approve.
 */
export const triggerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('APPLICATION_CREATED'),
    jobId: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal('STAGE_ENTERED'), stageId: z.string().min(1) }),
  // After an AI match assessment: fires once per application and rule.
  z.object({
    type: z.literal('MATCH_SCORED'),
    minScore: z.number().int().min(1).max(100),
    jobId: z.string().min(1).optional(),
  }),
  // Time based (run by the scheduler): an application sat in an active stage.
  z.object({
    type: z.literal('STAGE_STALE'),
    days: z.number().int().min(1).max(90),
    stageId: z.string().min(1).optional(),
  }),
  // Time based: a published job has too few applicants after some days.
  z.object({
    type: z.literal('JOB_LOW_APPLICANTS'),
    maxApplicants: z.number().int().min(1).max(1000),
    afterDays: z.number().int().min(1).max(90),
  }),
]);

export const JOB_LEVEL_TRIGGERS = ['JOB_LOW_APPLICANTS'];

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('CREATE_MESSAGE_DRAFT'),
    kind: z.enum(['INTERVIEW_INVITE', 'REJECTION', 'STATUS_UPDATE', 'CUSTOM']),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
  }),
  z.object({
    type: z.literal('NOTIFY_USERS'),
    userIds: z.array(z.string().min(1)).min(1).max(20),
    title: z.string().trim().min(1).max(200),
  }),
  z.object({
    type: z.literal('ADD_TAG'),
    tag: z.string().trim().min(1).max(40),
  }),
  // Notify the recruiter and hiring manager assigned to the job
  z.object({
    type: z.literal('NOTIFY_ASSIGNED'),
    title: z.string().trim().min(1).max(200),
  }),
]);

export const ruleSchema = z.object({
  name: z.string().trim().min(2).max(100),
  trigger: triggerSchema,
  action: actionSchema,
  requiresApproval: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

export type RuleInput = z.infer<typeof ruleSchema>;

async function validateRule(ctx: TenantContext, r: RuleInput) {
  const teamId = ctx.team.id;

  if (r.action.type === 'CREATE_MESSAGE_DRAFT' && !r.requiresApproval) {
    throw new ApiError(
      422,
      'Messages to candidates always need human approval.'
    );
  }

  if (
    JOB_LEVEL_TRIGGERS.includes(r.trigger.type) &&
    !['NOTIFY_USERS', 'NOTIFY_ASSIGNED'].includes(r.action.type)
  ) {
    throw new ApiError(422, 'Job-level rules can only send notifications.');
  }

  if (
    (r.trigger.type === 'STAGE_STALE' && r.trigger.stageId) ||
    r.trigger.type === 'STAGE_ENTERED'
  ) {
    const stageId =
      r.trigger.type === 'STAGE_ENTERED'
        ? r.trigger.stageId
        : (r.trigger as { stageId?: string }).stageId;
    const s = await prisma.pipelineStage.findFirst({
      where: { id: stageId, teamId },
    });

    if (!s) {
      throw new ApiError(422, 'The stage does not exist in this portal.');
    }
  }

  if (r.trigger.type === 'APPLICATION_CREATED' && r.trigger.jobId) {
    const j = await prisma.job.findFirst({
      where: { id: r.trigger.jobId, teamId, deletedAt: null },
    });

    if (!j) {
      throw new ApiError(422, 'The job does not exist in this portal.');
    }
  }

  if (r.action.type === 'NOTIFY_USERS') {
    const members = await prisma.teamMember.count({
      where: { teamId, userId: { in: r.action.userIds } },
    });

    if (members !== new Set(r.action.userIds).size) {
      throw new ApiError(
        422,
        'Every person to notify must be a member of this portal.'
      );
    }
  }
}

export const listRules = (teamId: string) =>
  prisma.automationRule.findMany({
    where: { teamId },
    orderBy: { createdAt: 'asc' },
  });

export async function createRule(ctx: TenantContext, input: RuleInput) {
  await validateRule(ctx, input);

  return prisma.automationRule.create({
    data: {
      teamId: ctx.team.id,
      name: input.name,
      trigger: input.trigger,
      action: input.action,
      requiresApproval: input.requiresApproval,
      enabled: input.enabled,
      createdById: ctx.user.id,
    },
  });
}

export async function updateRule(
  ctx: TenantContext,
  id: string,
  input: RuleInput
) {
  await validateRule(ctx, input);

  const r = await prisma.automationRule.updateMany({
    where: { id, teamId: ctx.team.id },
    data: {
      name: input.name,
      trigger: input.trigger,
      action: input.action,
      requiresApproval: input.requiresApproval,
      enabled: input.enabled,
    },
  });

  if (!r.count) {
    throw new ApiError(404, 'Rule not found.');
  }

  return prisma.automationRule.findFirstOrThrow({
    where: { id, teamId: ctx.team.id },
  });
}

export async function deleteRule(ctx: TenantContext, id: string) {
  const r = await prisma.automationRule.deleteMany({
    where: { id, teamId: ctx.team.id },
  });

  if (!r.count) {
    throw new ApiError(404, 'Rule not found.');
  }
}

export type AutomationEvent = {
  type: 'APPLICATION_CREATED' | 'STAGE_ENTERED' | 'MATCH_SCORED';
  teamId: string;
  applicationId: string;
  stageId?: string;
  score?: number;
  actorUserId?: string | null;
};

const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');

type AppFacts = {
  id: string;
  job: { id: string; title: string };
  tenantCandidate: { id: string; name: string; email: string };
  stage: { id: string; name: string };
};

const loadApp = (teamId: string, applicationId: string) =>
  prisma.jobApplication.findFirst({
    where: { id: applicationId, teamId },
    include: {
      job: { select: { id: true, title: true } },
      tenantCandidate: { select: { id: true, name: true, email: true } },
      stage: { select: { id: true, name: true } },
    },
  });

/** Performs one rule action for one application and records it in the audit trail. */
async function applyAction(
  rule: { id: string; name: string },
  a: z.infer<typeof actionSchema>,
  teamId: string,
  team: { name: string; slug: string },
  app: AppFacts
) {
  const vars = {
    candidate_name: app.tenantCandidate.name,
    job_title: app.job.title,
    company: team.name,
    stage: app.stage.name,
  };
  const link = `/teams/${team.slug}/applications/${app.id}`;

  if (a.type === 'CREATE_MESSAGE_DRAFT') {
    await prisma.messageDraft.create({
      data: {
        teamId,
        applicationId: app.id,
        recipientEmail: app.tenantCandidate.email,
        recipientName: app.tenantCandidate.name,
        kind: a.kind,
        subject: fill(a.subject, vars),
        body: fill(a.body, vars),
        createdByAi: false,
        automationRuleId: rule.id,
      },
    });
  } else if (a.type === 'NOTIFY_USERS' || a.type === 'NOTIFY_ASSIGNED') {
    await notify({
      userIds:
        a.type === 'NOTIFY_USERS'
          ? a.userIds
          : await jobStaffIds(teamId, app.job.id),
      teamId,
      type:
        a.type === 'NOTIFY_USERS' ? 'message.draft_ready' : 'automation.alert',
      title: fill(a.title, vars),
      body: app.job.title,
      link,
    });
  } else if (a.type === 'ADD_TAG') {
    const tag = await prisma.candidateTag.upsert({
      where: { teamId_name: { teamId, name: a.tag } },
      create: { teamId, name: a.tag },
      update: {},
    });

    await prisma.candidateTagLink.createMany({
      data: [
        { teamId, tenantCandidateId: app.tenantCandidate.id, tagId: tag.id },
      ],
      skipDuplicates: true,
    });
  }

  await prisma.applicationActivity.create({
    data: {
      teamId,
      applicationId: app.id,
      actorUserId: null,
      type: 'NOTE',
      payload: {
        automation: rule.name,
        ruleId: rule.id,
        action: a.type,
      } as Prisma.InputJsonValue,
    },
  });
}

const alreadyRan = async (
  teamId: string,
  applicationId: string,
  ruleId: string,
  since?: Date
) =>
  (await prisma.applicationActivity.count({
    where: {
      teamId,
      applicationId,
      type: 'NOTE',
      payload: { path: ['ruleId'], equals: ruleId },
      ...(since ? { createdAt: { gt: since } } : {}),
    },
  })) > 0;

/**
 * Runs the enabled rules matching an event. Called after the triggering
 * transaction has committed; a failing rule is recorded and never breaks the
 * operation that triggered it.
 */
export async function runAutomations(event: AutomationEvent) {
  const { teamId } = event;
  const results: { ruleId: string; ok: boolean; error?: string }[] = [];

  try {
    const app = await loadApp(teamId, event.applicationId);
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { name: true, slug: true },
    });

    if (!app || !team) {
      return results;
    }

    const rules = await prisma.automationRule.findMany({
      where: { teamId, enabled: true },
    });

    for (const rule of rules) {
      const trigger = triggerSchema.safeParse(rule.trigger);
      const action = actionSchema.safeParse(rule.action);

      if (
        !trigger.success ||
        !action.success ||
        trigger.data.type !== event.type
      ) {
        continue;
      }

      const t = trigger.data;

      if (t.type === 'STAGE_ENTERED' && t.stageId !== event.stageId) {
        continue;
      }

      if (
        (t.type === 'APPLICATION_CREATED' || t.type === 'MATCH_SCORED') &&
        t.jobId &&
        t.jobId !== app.job.id
      ) {
        continue;
      }

      if (t.type === 'MATCH_SCORED') {
        if ((event.score ?? 0) < t.minScore) {
          continue;
        }

        // once per application and rule, however often it is re-assessed
        if (await alreadyRan(teamId, app.id, rule.id)) {
          continue;
        }
      }

      try {
        await applyAction(rule, action.data, teamId, team, app);
        results.push({ ruleId: rule.id, ok: true });
      } catch (error: any) {
        console.error('automation rule failed', rule.id, error);
        results.push({ ruleId: rule.id, ok: false, error: error?.message });
      }
    }
  } catch (error) {
    console.error('automation run failed', error);
  }

  return results;
}

/**
 * Time-based rules (STAGE_STALE, JOB_LOW_APPLICANTS). Idempotent: every rule
 * acts at most once per application stay / per job, so the scheduler can run
 * it as often as it likes.
 */
export async function runAutomationSweeps(now = new Date()) {
  let fired = 0;
  const rules = await unguardedPrisma.automationRule.findMany({
    where: { enabled: true },
  });
  const slugs = new Map<string, { name: string; slug: string }>();

  for (const rule of rules) {
    const trigger = triggerSchema.safeParse(rule.trigger);
    const action = actionSchema.safeParse(rule.action);

    if (
      !trigger.success ||
      !action.success ||
      !['STAGE_STALE', 'JOB_LOW_APPLICANTS'].includes(trigger.data.type)
    ) {
      continue;
    }

    const { teamId } = rule;

    if (!slugs.has(teamId)) {
      const team = await unguardedPrisma.team.findUnique({
        where: { id: teamId },
        select: { name: true, slug: true, status: true },
      });

      slugs.set(
        teamId,
        team && team.status !== 'SUSPENDED'
          ? { name: team.name, slug: team.slug }
          : { name: '', slug: '' }
      );
    }

    const team = slugs.get(teamId) as { name: string; slug: string };

    if (!team.slug) {
      continue;
    }

    try {
      const t = trigger.data;

      if (t.type === 'STAGE_STALE') {
        const cutoff = new Date(now.getTime() - t.days * 86400_000);
        const apps = await prisma.jobApplication.findMany({
          where: {
            teamId,
            updatedAt: { lt: cutoff },
            withdrawnAt: null,
            stage: { kind: 'ACTIVE' },
            ...(t.stageId ? { stageId: t.stageId } : {}),
            job: { teamId, deletedAt: null, status: 'PUBLISHED' },
          },
          include: {
            job: { select: { id: true, title: true } },
            tenantCandidate: { select: { id: true, name: true, email: true } },
            stage: { select: { id: true, name: true } },
          },
          take: 200,
        });

        for (const app of apps) {
          if (await alreadyRan(teamId, app.id, rule.id, app.updatedAt)) {
            continue;
          }

          await applyAction(rule, action.data, teamId, team, app);
          fired++;
        }
      } else if (t.type === 'JOB_LOW_APPLICANTS') {
        const cutoff = new Date(now.getTime() - t.afterDays * 86400_000);
        const jobs = await prisma.job.findMany({
          where: {
            teamId,
            deletedAt: null,
            status: 'PUBLISHED',
            publishedAt: { lt: cutoff },
          },
          select: {
            id: true,
            title: true,
            publishedAt: true,
            _count: { select: { applications: true } },
          },
          take: 200,
        });

        for (const job of jobs) {
          if (job._count.applications >= t.maxApplicants) {
            continue;
          }

          const link = `/teams/${team.slug}/jobs/${job.id}?rule=${rule.id}`;
          const done = await prisma.notification.count({
            where: {
              teamId,
              link,
              createdAt: { gt: job.publishedAt ?? new Date(0) },
            },
          });

          if (done) {
            continue;
          }

          const a = action.data;

          await notify({
            userIds:
              a.type === 'NOTIFY_USERS'
                ? a.userIds
                : await jobStaffIds(teamId, job.id),
            teamId,
            type: 'automation.alert',
            title: fill(
              a.type === 'NOTIFY_USERS' || a.type === 'NOTIFY_ASSIGNED'
                ? a.title
                : rule.name,
              {
                job_title: job.title,
                company: team.name,
              }
            ),
            body: job.title,
            link,
          });
          fired++;
        }
      }
    } catch (error) {
      console.error('automation sweep failed', rule.id, error);
    }
  }

  return fired;
}
