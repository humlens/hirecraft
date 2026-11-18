import { Prisma } from '@prisma/client';
import { ApiError } from '@/lib/errors';
import { effectiveJobStatus, openJobWhere } from '@/lib/jobs';
import { prisma, unguardedPrisma } from '@/lib/prisma';
import type { z } from 'zod';
import type { applySchema } from '@/lib/zod';
import { getStagesForJob } from './application';

type ApplyInput = z.infer<typeof applySchema>;

type Question = {
  id: string;
  type: 'TEXT' | 'SINGLE' | 'MULTI' | 'NUMBER' | 'BOOLEAN';
  prompt: string;
  options: string[];
  required: boolean;
};

/**
 * Validates answers against the job's screening questions and returns a
 * snapshot that stays meaningful even if the questions are edited later.
 */
export function validateAnswers(
  questions: Question[],
  answers: ApplyInput['answers']
) {
  const snapshot: {
    questionId: string;
    prompt: string;
    type: string;
    value: Prisma.InputJsonValue;
  }[] = [];

  for (const q of questions) {
    const raw = answers[q.id];
    const empty =
      raw === undefined ||
      raw === '' ||
      (Array.isArray(raw) && raw.length === 0);

    if (empty) {
      if (q.required) {
        throw new ApiError(422, `Please answer: ${q.prompt}`);
      }

      continue;
    }

    let value: Prisma.InputJsonValue = raw;

    switch (q.type) {
      case 'TEXT':
        if (typeof raw !== 'string') {
          throw new ApiError(422, `Invalid answer for: ${q.prompt}`);
        }
        break;
      case 'NUMBER': {
        const n = typeof raw === 'number' ? raw : Number(raw);

        if (
          typeof raw === 'boolean' ||
          Array.isArray(raw) ||
          !Number.isFinite(n)
        ) {
          throw new ApiError(422, `Enter a number for: ${q.prompt}`);
        }

        value = n;
        break;
      }
      case 'BOOLEAN':
        if (typeof raw !== 'boolean') {
          throw new ApiError(422, `Answer yes or no for: ${q.prompt}`);
        }
        break;
      case 'SINGLE':
        if (typeof raw !== 'string' || !q.options.includes(raw)) {
          throw new ApiError(422, `Choose one of the options for: ${q.prompt}`);
        }
        break;
      case 'MULTI':
        if (!Array.isArray(raw) || raw.some((v) => !q.options.includes(v))) {
          throw new ApiError(422, `Choose from the options for: ${q.prompt}`);
        }
        break;
    }

    snapshot.push({ questionId: q.id, prompt: q.prompt, type: q.type, value });
  }

  return snapshot;
}

export async function applyToJob(args: {
  user: { id: string; email: string; name: string };
  teamId: string;
  jobSlug: string;
  policyVersion: string;
  input: ApplyInput;
}) {
  const { user, teamId, jobSlug, input } = args;

  const job = await prisma.job.findFirst({
    where: {
      teamId,
      slug: jobSlug,
      visibility: { in: ['PUBLIC', 'UNLISTED'] },
      ...openJobWhere(),
    },
    include: { questions: { orderBy: { order: 'asc' } } },
  });

  if (!job) {
    throw new ApiError(404, 'This job is not open for applications.');
  }

  // A candidate can only apply with their own resume.
  const resume = await prisma.candidateResume.findFirst({
    where: {
      id: input.resumeId,
      deletedAt: null,
      profile: { userId: user.id },
    },
  });

  if (!resume) {
    throw new ApiError(422, 'Choose one of your uploaded resumes.');
  }

  const answers = validateAnswers(job.questions, input.answers);
  const profile = await prisma.candidateProfile.findUnique({
    where: { userId: user.id },
    select: { phone: true },
  });
  const email = user.email.toLowerCase();

  try {
    return await prisma.$transaction(async (tx) => {
      let candidate = await tx.tenantCandidate.findFirst({
        where: { teamId, email },
      });

      if (candidate?.userId && candidate.userId !== user.id) {
        throw new ApiError(
          409,
          'This email is already linked to another account.'
        );
      }

      if (!candidate) {
        candidate = await tx.tenantCandidate.create({
          data: {
            teamId,
            userId: user.id,
            name: user.name,
            email,
            phone: profile?.phone ?? null,
            source: 'portal',
          },
        });
      } else if (!candidate.userId) {
        candidate = await tx.tenantCandidate.update({
          where: { id: candidate.id, teamId },
          data: { userId: user.id },
        });
      }

      const already = await tx.jobApplication.findFirst({
        where: { teamId, jobId: job.id, tenantCandidateId: candidate.id },
      });

      if (already) {
        throw new ApiError(409, 'You have already applied to this job.');
      }

      const stages = await getStagesForJob(tx, teamId, job.id);
      const first = stages.find((s) => s.kind === 'ACTIVE');

      if (!first) {
        throw new ApiError(500, 'This portal has no pipeline configured.');
      }

      const application = await tx.jobApplication.create({
        data: {
          teamId,
          jobId: job.id,
          tenantCandidateId: candidate.id,
          resumeId: resume.id,
          stageId: first.id,
          source: 'portal',
          answers,
        },
      });

      await tx.applicationActivity.create({
        data: {
          teamId,
          applicationId: application.id,
          actorUserId: user.id,
          type: 'APPLIED',
          toStageId: first.id,
          payload: { toName: first.name },
        },
      });

      await tx.candidateConsent.createMany({
        data: [
          { purpose: 'APPLICATION' as const, granted: true },
          {
            purpose: 'TALENT_POOL' as const,
            granted: input.consent.talentPool,
          },
          // recorded only when given (declining = no row)
          ...(input.consent.aiRecommendations
            ? [{ purpose: 'AI_RECOMMENDATIONS' as const, granted: true }]
            : []),
        ].map((c) => ({
          userId: user.id,
          teamId,
          purpose: c.purpose,
          granted: c.granted,
          policyVersion: args.policyVersion,
        })),
      });

      return {
        applicationId: application.id,
        jobId: job.id,
        jobTitle: job.title,
        stage: first.name,
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      // Concurrent double submit: the unique (jobId, tenantCandidateId) won.
      throw new ApiError(409, 'You have already applied to this job.');
    }

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Candidate dashboard
// ---------------------------------------------------------------------------

/** All applications of a user, across portals (their own data only). */
export async function listMyApplications(userId: string) {
  const apps = await unguardedPrisma.jobApplication.findMany({
    where: { tenantCandidate: { userId } },
    orderBy: { createdAt: 'desc' },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          slug: true,
          team: { select: { name: true, slug: true } },
        },
      },
      stage: { select: { id: true, name: true, kind: true } },
    },
  });

  const tracker = new Map<
    string,
    { id: string; name: string; kind: string }[]
  >();

  for (const a of apps) {
    const key = `${a.teamId}:${a.jobId}`;

    if (!tracker.has(key)) {
      const stages = await prisma.$transaction((tx) =>
        getStagesForJob(tx, a.teamId, a.jobId)
      );

      // Candidates see the active path plus the stages they can end in.
      tracker.set(
        key,
        stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind }))
      );
    }
  }

  const activities = await unguardedPrisma.applicationActivity.findMany({
    where: {
      applicationId: { in: apps.map((a) => a.id) },
      type: { in: ['APPLIED', 'STAGE_CHANGED', 'WITHDRAWN'] },
    },
    orderBy: { createdAt: 'asc' },
    select: { applicationId: true, type: true, payload: true, createdAt: true },
  });

  return apps.map((a) => ({
    id: a.id,
    portal: a.job.team,
    job: { id: a.job.id, title: a.job.title, slug: a.job.slug },
    stage: a.stage,
    appliedAt: a.createdAt,
    withdrawnAt: a.withdrawnAt,
    stages: tracker.get(`${a.teamId}:${a.jobId}`) ?? [],
    // Internal notes and rejection reasons are never exposed to candidates.
    history: activities
      .filter((x) => x.applicationId === a.id)
      .map((x) => ({
        type: x.type,
        stage: (x.payload as { toName?: string } | null)?.toName ?? null,
        at: x.createdAt,
      })),
  }));
}

export async function withdrawMyApplication(
  userId: string,
  applicationId: string
) {
  const app = await unguardedPrisma.jobApplication.findFirst({
    where: { id: applicationId, tenantCandidate: { userId } },
    include: { stage: true },
  });

  if (!app) {
    throw new ApiError(404, 'Application not found.');
  }

  if (app.stage.kind === 'WITHDRAWN') {
    throw new ApiError(409, 'You already withdrew this application.');
  }

  return prisma.$transaction(async (tx) => {
    const stages = await getStagesForJob(tx, app.teamId, app.jobId);
    const withdrawn = stages.find((s) => s.kind === 'WITHDRAWN');

    if (!withdrawn) {
      throw new ApiError(500, 'This portal has no withdrawn stage.');
    }

    await tx.jobApplication.update({
      where: { id: app.id, teamId: app.teamId },
      data: { stageId: withdrawn.id, withdrawnAt: new Date() },
    });

    await tx.applicationActivity.create({
      data: {
        teamId: app.teamId,
        applicationId: app.id,
        actorUserId: userId,
        type: 'WITHDRAWN',
        fromStageId: app.stageId,
        toStageId: withdrawn.id,
        payload: { fromName: app.stage.name, toName: withdrawn.name },
      },
    });

    return { applicationId: app.id, teamId: app.teamId, jobId: app.jobId };
  });
}

// ---------------------------------------------------------------------------
// Saved jobs
// ---------------------------------------------------------------------------

export async function saveJob(userId: string, jobId: string) {
  const job = await unguardedPrisma.job.findFirst({
    where: {
      id: jobId,
      visibility: { in: ['PUBLIC', 'UNLISTED'] },
      ...openJobWhere(),
    },
    select: { id: true, team: { select: { status: true } } },
  });

  if (!job || job.team.status !== 'ACTIVE') {
    throw new ApiError(404, 'Job not found.');
  }

  await prisma.savedJob.upsert({
    where: { userId_jobId: { userId, jobId } },
    create: { userId, jobId },
    update: {},
  });
}

export async function listSavedJobs(userId: string) {
  const rows = await unguardedPrisma.savedJob.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          publishAt: true,
          closesAt: true,
          deletedAt: true,
          team: { select: { name: true, slug: true } },
        },
      },
    },
  });

  return rows
    .filter((r) => !r.job.deletedAt)
    .map((r) => ({
      id: r.job.id,
      title: r.job.title,
      slug: r.job.slug,
      portal: r.job.team,
      open: effectiveJobStatus(r.job) === 'PUBLISHED',
      savedAt: r.createdAt,
    }));
}

export async function unsaveJob(userId: string, jobId: string) {
  await prisma.savedJob.deleteMany({ where: { userId, jobId } });
}
