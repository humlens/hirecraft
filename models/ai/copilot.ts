import { z } from 'zod';
import { runAIFeature } from '@/lib/ai/run';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { TenantContext } from '@/lib/tenant';
import { stripHtml } from '@/lib/jobs';
import { getJob, jobScope } from 'models/job';
import { getInterview } from 'models/interview';
import { aiContext } from './context';
import { draftCandidateMessage } from './comms';
import { searchTalent } from './search';
import { scrubProtectedText } from '@/lib/ai/redact';

export const MAX_STEPS = 5;

type Source = {
  type: 'candidate' | 'application' | 'job' | 'interview' | 'message';
  id: string;
  label: string;
};
type ToolOut = { data: unknown; sources?: Source[]; error?: string };

/**
 * The copilot's only way to touch data: a fixed set of read functions that run
 * with the caller's own permissions and scope. The model receives candidate
 * HANDLES (C1, C2...) instead of names or emails; the server maps them back for
 * the user. The only write is `draft_email`, which creates a DRAFT for human
 * approval.
 */
class Session {
  handles = new Map<string, { id: string; name: string }>();
  reverse = new Map<string, string>();
  sources = new Map<string, Source>();
  seq = 0;

  handle(candidateId: string, name: string) {
    let h = this.reverse.get(candidateId);

    if (!h) {
      h = `C${++this.seq}`;
      this.reverse.set(candidateId, h);
      this.handles.set(h, { id: candidateId, name });
    }

    return h;
  }

  resolve(h: string) {
    return this.handles.get(h.toUpperCase().replace(/[^C0-9]/g, ''));
  }

  src(s: Source) {
    this.sources.set(`${s.type}:${s.id}`, s);
  }

  /** Replace handles in text for display. */
  display(text: string) {
    return text.replace(/\bC(\d+)\b/g, (m) => this.handles.get(m)?.name ?? m);
  }
}

type ToolDef = {
  description: string;
  args: z.ZodTypeAny;
  permission: Parameters<TenantContext['permissions']['has']>[0];
  run: (ctx: TenantContext, s: Session, args: any) => Promise<ToolOut>;
};

const TOOLS: Record<string, ToolDef> = {
  search_candidates: {
    description:
      'search_candidates {query: string, limit?: number<=10}: find candidates you may see.',
    args: z.object({
      query: z.string().min(2).max(300),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    permission: 'candidates.search',
    run: async (ctx, s, a) => {
      const r = await searchTalent(ctx, { query: a.query, limit: a.limit });

      for (const c of r.results)
        s.src({ type: 'candidate', id: c.candidateId, label: c.name });

      return {
        data: r.results.map((c) => ({
          handle: s.handle(c.candidateId, c.name),
          headline: c.headline,
          location: c.location,
          skills: c.skills.slice(0, 12),
          years: c.years,
        })),
      };
    },
  },
  list_applications: {
    description:
      'list_applications {jobId?: string, stage?: string}: applications of jobs you may see (max 15).',
    args: z.object({
      jobId: z.string().max(64).optional(),
      stage: z.string().max(60).optional(),
    }),
    permission: 'applications.read',
    run: async (ctx, s, a) => {
      const teamId = ctx.team.id;
      const apps = await prisma.jobApplication.findMany({
        where: {
          teamId,
          job: { teamId, deletedAt: null, ...jobScope(ctx) },
          ...(a.jobId ? { jobId: a.jobId } : {}),
          ...(a.stage
            ? { stage: { name: { equals: a.stage, mode: 'insensitive' } } }
            : {}),
        },
        include: {
          job: { select: { title: true } },
          stage: { select: { name: true } },
          tenantCandidate: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 15,
      });

      apps.forEach((x) => {
        s.src({
          type: 'application',
          id: x.id,
          label: `${x.tenantCandidate.name} - ${x.job.title}`,
        });
      });

      return {
        data: apps.map((x) => ({
          applicationId: x.id,
          candidate: s.handle(x.tenantCandidate.id, x.tenantCandidate.name),
          job: x.job.title,
          stage: x.stage.name,
        })),
      };
    },
  },
  summarize_job: {
    description: 'summarize_job {jobId: string}: key facts about a job.',
    args: z.object({ jobId: z.string().min(1).max(64) }),
    permission: 'jobs.read',
    run: async (ctx, s, a) => {
      const j = await getJob(ctx, a.jobId);

      s.src({ type: 'job', id: j.id, label: j.title });

      return {
        data: {
          title: j.title,
          status: j.effectiveStatus,
          workMode: j.workMode,
          experience: [j.experienceMin, j.experienceMax],
          requiredSkills: j.skills
            .filter((x) => x.required)
            .map((x) => x.skill),
          applicants: j.applicationCount,
          description: stripHtml(j.descriptionHtml).slice(0, 1200),
        },
      };
    },
  },
  compare_candidates: {
    description:
      'compare_candidates {applicationIds: string[2-4]}: latest match assessments side by side.',
    args: z.object({
      applicationIds: z.array(z.string().max(64)).min(2).max(4),
    }),
    permission: 'applications.read',
    run: async (ctx, s, a) => {
      const teamId = ctx.team.id;
      const out: Record<string, unknown>[] = [];

      for (const id of a.applicationIds) {
        const app = await prisma.jobApplication.findFirst({
          where: {
            id,
            teamId,
            job: { teamId, deletedAt: null, ...jobScope(ctx) },
          },
          include: {
            job: { select: { title: true } },
            tenantCandidate: { select: { id: true, name: true } },
            stage: { select: { name: true } },
          },
        });

        if (!app) {
          out.push({ applicationId: id, error: 'not found or not allowed' });
          continue;
        }

        const m = await prisma.matchAssessment.findFirst({
          where: { teamId, applicationId: id },
          orderBy: { createdAt: 'desc' },
        });

        s.src({
          type: 'application',
          id,
          label: `${app.tenantCandidate.name} - ${app.job.title}`,
        });
        out.push({
          candidate: s.handle(app.tenantCandidate.id, app.tenantCandidate.name),
          job: app.job.title,
          stage: app.stage.name,
          matchScore: m?.score ?? null,
          matchedSkills: m?.matchedSkills ?? [],
          missingSkills: m?.missingSkills ?? [],
        });
      }

      return { data: out };
    },
  },
  summarize_feedback: {
    description:
      'summarize_feedback {interviewId: string}: scores and notes you are allowed to see.',
    args: z.object({ interviewId: z.string().min(1).max(64) }),
    permission: 'feedback.submit',
    run: async (ctx, s, a) => {
      const i = await getInterview(ctx, a.interviewId);

      s.src({
        type: 'interview',
        id: i.id,
        label: `${i.candidate.name} round ${i.round}`,
      });

      return {
        data: {
          candidate: s.handle(i.candidate.id, i.candidate.name),
          job: i.job.title,
          feedback: i.feedback.map((f, k) => ({
            interviewer: `Interviewer ${String.fromCharCode(65 + k)}`,
            recommendation: f.recommendation,
            scores: f.scores,
            notes: scrubProtectedText(f.notes),
          })),
        },
      };
    },
  },
  draft_email: {
    description:
      'draft_email {applicationId: string, kind: CUSTOM|STATUS_UPDATE|REJECTION|INTERVIEW_INVITE, instructions?: string}: creates a DRAFT (a person must approve and send it).',
    args: z.object({
      applicationId: z.string().min(1).max(64),
      kind: z.enum([
        'CUSTOM',
        'STATUS_UPDATE',
        'REJECTION',
        'INTERVIEW_INVITE',
      ]),
      instructions: z.string().max(500).optional(),
    }),
    permission: 'messages.send',
    run: async (ctx, s, a) => {
      const d = await draftCandidateMessage(ctx, a);

      s.src({ type: 'message', id: d.id, label: `Draft: ${d.subject}` });

      return {
        data: {
          draftId: d.id,
          status: 'DRAFT - waiting for a person to approve and send',
        },
      };
    },
  },
};

const toolList = (ctx: TenantContext) =>
  Object.entries(TOOLS)
    .filter(([, t]) => ctx.permissions.has(t.permission))
    .map(([, t]) => `- ${t.description}`)
    .join('\n');

export async function runCopilot(
  ctx: TenantContext,
  messages: { role: 'user' | 'assistant'; content: string }[]
) {
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    throw new ApiError(422, 'The last message must be from the user.');
  }

  const s = new Session();
  // history shows handles only (the model never sees names it did not look up)
  const convo: string[] = messages.map(
    (m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
  );
  const steps: { tool: string; ok: boolean }[] = [];

  for (let i = 0; i <= MAX_STEPS; i++) {
    const { data: step } = await runAIFeature(aiContext(ctx), 'copilot.step', {
      tools: toolList(ctx) || '(none: you can only answer in general terms)',
      conversation: convo.join('\n'),
    });

    if (step.type === 'final') {
      return {
        answer: s.display(step.answer),
        sources: Array.from(s.sources.values()),
        steps,
      };
    }

    if (i === MAX_STEPS) {
      break;
    }

    const tool = TOOLS[step.tool];
    let result: ToolOut;

    if (!tool || !ctx.permissions.has(tool.permission)) {
      // same answer for "does not exist" and "not allowed": nothing leaks
      result = {
        data: null,
        error: tool
          ? 'You do not have permission to use this tool.'
          : 'Unknown tool.',
      };
    } else {
      const parsed = tool.args.safeParse(step.args);

      if (!parsed.success) {
        result = {
          data: null,
          error: `Invalid arguments: ${parsed.error.issues[0]?.message}`,
        };
      } else {
        try {
          result = await tool.run(ctx, s, parsed.data);
        } catch (error: any) {
          result = {
            data: null,
            error:
              error?.status === 404
                ? 'Not found or not allowed.'
                : error?.status
                  ? String(error.message)
                  : 'The tool failed.',
          };
        }
      }
    }

    steps.push({ tool: step.tool, ok: !result.error });
    convo.push(
      `Assistant: (called ${step.tool})`,
      `Tool result: <data>${JSON.stringify(result.error ? { error: result.error } : result.data)}</data>`
    );
  }

  return {
    answer:
      'I could not finish within the allowed number of steps. Please ask a narrower question.',
    sources: Array.from(s.sources.values()),
    steps,
  };
}
