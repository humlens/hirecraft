import type { MessageKind } from '@prisma/client';
import { runAIFeature } from '@/lib/ai/run';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';
import { jobScope } from 'models/job';
import { aiContext } from './context';

/**
 * AI-written email for a candidate. The model never sees the candidate's name
 * (it writes {candidate_name}); the result is saved as a DRAFT created by AI
 * that a person must review, approve and send (Phase 3 flow).
 */
export async function draftCandidateMessage(
  ctx: TenantContext,
  input: { applicationId: string; kind: MessageKind; instructions?: string }
) {
  const teamId = ctx.team.id;
  const app = await prisma.jobApplication.findFirst({
    where: {
      id: input.applicationId,
      teamId,
      job: { teamId, deletedAt: null, ...jobScope(ctx) },
    },
    include: {
      job: { select: { title: true } },
      stage: { select: { name: true } },
      tenantCandidate: { select: { name: true, email: true } },
    },
  });

  if (!app) {
    throw new ApiError(404, 'Application not found.');
  }

  const { data } = await runAIFeature(aiContext(ctx), 'comms.draft', {
    company: ctx.team.name,
    jobTitle: app.job.title,
    kind: input.kind,
    stage: app.stage.name,
    instructions: input.instructions ?? '',
  });
  const first = app.tenantCandidate.name.split(/\s+/)[0];
  const fill = (t: string) => t.replace(/\{\s*candidate_name\s*\}/gi, first);

  return prisma.messageDraft.create({
    data: {
      teamId,
      applicationId: app.id,
      recipientEmail: app.tenantCandidate.email,
      recipientName: app.tenantCandidate.name,
      kind: input.kind,
      subject: fill(data.subject),
      body: fill(data.body),
      createdById: ctx.user.id,
      createdByAi: true,
    },
    select: {
      id: true,
      kind: true,
      subject: true,
      body: true,
      status: true,
      createdByAi: true,
      applicationId: true,
    },
  });
}
