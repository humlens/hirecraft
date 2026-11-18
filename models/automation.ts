import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';
import { notify } from '@/lib/notifications';

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
]);

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

  if (r.trigger.type === 'STAGE_ENTERED') {
    const s = await prisma.pipelineStage.findFirst({
      where: { id: r.trigger.stageId, teamId },
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
  type: 'APPLICATION_CREATED' | 'STAGE_ENTERED';
  teamId: string;
  applicationId: string;
  stageId?: string;
  actorUserId?: string | null;
};

const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '');

/**
 * Runs the enabled rules matching an event. Called after the triggering
 * transaction has committed; a failing rule is recorded and never breaks the
 * operation that triggered it.
 */
export async function runAutomations(event: AutomationEvent) {
  const { teamId } = event;
  const results: { ruleId: string; ok: boolean; error?: string }[] = [];

  try {
    const app = await prisma.jobApplication.findFirst({
      where: { id: event.applicationId, teamId },
      include: {
        job: { select: { id: true, title: true } },
        tenantCandidate: { select: { id: true, name: true, email: true } },
        stage: { select: { id: true, name: true } },
      },
    });
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
    const vars = {
      candidate_name: app.tenantCandidate.name,
      job_title: app.job.title,
      company: team.name,
      stage: app.stage.name,
    };

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

      if (
        trigger.data.type === 'STAGE_ENTERED' &&
        trigger.data.stageId !== event.stageId
      ) {
        continue;
      }

      if (
        trigger.data.type === 'APPLICATION_CREATED' &&
        trigger.data.jobId &&
        trigger.data.jobId !== app.job.id
      ) {
        continue;
      }

      try {
        const a = action.data;

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
        } else if (a.type === 'NOTIFY_USERS') {
          await notify({
            userIds: a.userIds,
            teamId,
            type: 'message.draft_ready',
            title: fill(a.title, vars),
            body: app.job.title,
            link: `/teams/${team.slug}/applications/${app.id}`,
          });
        } else if (a.type === 'ADD_TAG') {
          const tag = await prisma.candidateTag.upsert({
            where: { teamId_name: { teamId, name: a.tag } },
            create: { teamId, name: a.tag },
            update: {},
          });

          await prisma.candidateTagLink.createMany({
            data: [
              {
                teamId,
                tenantCandidateId: app.tenantCandidate.id,
                tagId: tag.id,
              },
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
