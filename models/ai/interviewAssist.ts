import { runAIFeature } from '@/lib/ai/run';
import { stripHtml } from '@/lib/jobs';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';
import { jobScope } from 'models/job';
import { getInterview } from 'models/interview';
import { aiContext } from './context';

const collapse = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Questions and an evaluation template per competency. Only job data and skill GAPS are sent, no candidate identity. */
export async function suggestInterviewQuestions(
  ctx: TenantContext,
  applicationId: string,
  competencies: string[]
) {
  const teamId = ctx.team.id;
  const app = await prisma.jobApplication.findFirst({
    where: {
      id: applicationId,
      teamId,
      job: { teamId, deletedAt: null, ...jobScope(ctx) },
    },
    include: { job: { include: { skills: true } } },
  });

  if (!app) {
    throw new ApiError(404, 'Application not found.');
  }

  const latest = await prisma.matchAssessment.findFirst({
    where: { teamId, applicationId },
    orderBy: { createdAt: 'desc' },
    select: { missingSkills: true },
  });

  const { data } = await runAIFeature(aiContext(ctx), 'interview.questions', {
    jobTitle: app.job.title,
    required: app.job.skills.filter((s) => s.required).map((s) => s.skill),
    competencies: competencies.length
      ? competencies
      : ['Technical skills', 'Problem solving', 'Communication', 'Culture fit'],
    gaps: latest?.missingSkills ?? [],
    jobDescription: stripHtml(app.job.descriptionHtml).slice(0, 3000),
  });

  return data;
}

/**
 * Summarises the feedback this user may see. Interviewers appear as
 * "Interviewer A/B" (no names). Every quote the model returns is checked
 * against the real notes; unverifiable quotes are removed.
 */
export async function summarizeFeedback(
  ctx: TenantContext,
  interviewId: string
) {
  const interview = await getInterview(ctx, interviewId); // enforces visibility and blind feedback

  if (!interview.feedback.length) {
    throw new ApiError(422, 'There is no feedback to summarise yet.');
  }

  const labels = interview.feedback.map(
    (_, i) => `Interviewer ${String.fromCharCode(65 + i)}`
  );
  const feedbackText = interview.feedback
    .map(
      (f, i) =>
        `${labels[i]} | recommendation: ${f.recommendation} | scores: ${Object.entries(
          f.scores as Record<string, number>
        )
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}\nNotes: ${f.notes ?? '(none)'}`
    )
    .join('\n\n');
  const corpus = collapse(
    interview.feedback.map((f) => f.notes ?? '').join(' ')
  );

  const { data } = await runAIFeature(aiContext(ctx), 'interview.summary', {
    jobTitle: interview.job.title,
    count: interview.feedback.length,
    feedback: feedbackText,
  });

  const verify = <T extends { quote: string | null }>(items: T[]) =>
    items.map((i) => ({
      ...i,
      quote:
        i.quote &&
        collapse(i.quote).length >= 8 &&
        corpus.includes(collapse(i.quote))
          ? i.quote
          : null,
    }));

  return {
    ...data,
    strengths: verify(data.strengths),
    concerns: verify(data.concerns),
  };
}
