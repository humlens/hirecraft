import type { JobAttributes } from '@/lib/industryTemplates';
import { assertEntitlement, recordUsage } from '@/lib/entitlements';
import { Prisma, type JobAssignmentKind } from '@prisma/client';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { effectiveJobStatus, isPublishable, sanitizeJobHtml } from '@/lib/jobs';
import { slugify } from '@/lib/slug';
import { notify } from '@/lib/notifications';
import type { TenantContext } from '@/lib/tenant';
import type { z } from 'zod';
import type { createJobSchema, updateJobSchema } from '@/lib/zod';

type CreateInput = z.infer<typeof createJobSchema>;
type UpdateInput = z.infer<typeof updateJobSchema>;

const jobInclude = {
  skills: true,
  locations: true,
  questions: { orderBy: { order: 'asc' } },
  assignments: {
    include: { user: { select: { id: true, name: true, email: true } } },
  },
  _count: { select: { applications: true } },
} satisfies Prisma.JobInclude;

type JobRow = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

export const toJobView = (job: JobRow, now = new Date()) => ({
  id: job.id,
  title: job.title,
  slug: job.slug,
  descriptionHtml: job.descriptionHtml,
  responsibilities: job.responsibilities,
  status: job.status,
  effectiveStatus: effectiveJobStatus(job, now),
  publishAt: job.publishAt,
  publishedAt: job.publishedAt,
  closesAt: job.closesAt,
  visibility: job.visibility,
  employmentType: job.employmentType,
  workMode: job.workMode,
  experienceMin: job.experienceMin,
  experienceMax: job.experienceMax,
  salaryMin: job.salaryMin,
  salaryMax: job.salaryMax,
  salaryCurrency: job.salaryCurrency,
  salaryVisible: job.salaryVisible,
  department: job.department,
  industry: job.industry,
  education: job.education,
  vacancies: job.vacancies,
  benefits: job.benefits,
  companyInfoOverride: job.companyInfoOverride,
  attributes: job.attributes as JobAttributes,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
  skills: job.skills.map((s) => ({ skill: s.skill, required: s.required })),
  locations: job.locations.map((l) => ({
    city: l.city,
    region: l.region,
    country: l.country,
  })),
  questions: job.questions.map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    options: q.options,
    required: q.required,
  })),
  assignments: job.assignments.map((a) => ({
    userId: a.userId,
    kind: a.kind,
    name: a.user.name,
    email: a.user.email,
  })),
  applicationCount: job._count.applications,
});

export type JobView = ReturnType<typeof toJobView>;

/** Recruiters, hiring managers and interviewers only see assigned jobs. */
export const jobScope = (ctx: TenantContext): Prisma.JobWhereInput =>
  ctx.scope === 'assigned'
    ? { assignments: { some: { userId: ctx.user.id } } }
    : {};

/** Loads a job of this tenant that the caller may see, or throws 404. */
export async function getJobOrThrow(ctx: TenantContext, jobId: string) {
  const job = await prisma.job.findFirst({
    where: {
      id: jobId,
      teamId: ctx.team.id,
      deletedAt: null,
      ...jobScope(ctx),
    },
    include: jobInclude,
  });

  if (!job) {
    throw new ApiError(404, 'Job not found.');
  }

  return job;
}

export async function getJob(ctx: TenantContext, jobId: string) {
  return toJobView(await getJobOrThrow(ctx, jobId));
}

export async function listJobs(
  ctx: TenantContext,
  f: { status?: string; q?: string; cursor?: string; limit: number }
) {
  const where: Prisma.JobWhereInput = {
    teamId: ctx.team.id,
    deletedAt: null,
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.q ? { title: { contains: f.q, mode: 'insensitive' } } : {}),
    ...jobScope(ctx),
  };

  const rows = await prisma.job.findMany({
    where,
    include: jobInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: f.limit + 1,
    ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
  });

  const page = rows.slice(0, f.limit);

  return {
    jobs: page.map((j) => toJobView(j)),
    nextCursor: rows.length > f.limit ? page[page.length - 1].id : null,
  };
}

async function uniqueSlug(
  tx: Prisma.TransactionClient,
  teamId: string,
  title: string
) {
  const base = slugify(title).slice(0, 60) || 'job';
  const taken = new Set(
    (
      await tx.job.findMany({
        where: { teamId, slug: { startsWith: base } },
        select: { slug: true },
      })
    ).map((j) => j.slug)
  );

  if (!taken.has(base)) {
    return base;
  }

  for (let i = 2; i < 1000; i++) {
    if (!taken.has(`${base}-${i}`)) {
      return `${base}-${i}`;
    }
  }

  return `${base}-${Date.now()}`;
}

const omit = <T extends object, K extends keyof T>(obj: T, keys: K[]) => {
  const copy = { ...obj };

  keys.forEach((k) => delete copy[k]);

  return copy as Omit<T, K>;
};

const dedupeSkills = (skills: { skill: string; required: boolean }[]) => {
  const seen = new Set<string>();

  return skills.filter((s) => {
    const k = s.skill.toLowerCase();

    if (seen.has(k)) {
      return false;
    }

    seen.add(k);

    return true;
  });
};

const nestedCreates = (teamId: string, input: Partial<CreateInput>) => ({
  skills: dedupeSkills(input.skills ?? []).map((s) => ({ teamId, ...s })),
  locations: (input.locations ?? []).map((l) => ({
    teamId,
    city: l.city ?? null,
    region: l.region ?? null,
    country: l.country ?? null,
  })),
  questions: (input.questions ?? []).map((q, i) => ({
    teamId,
    type: q.type,
    prompt: q.prompt,
    options: q.options,
    required: q.required,
    order: i,
  })),
});

export async function createJob(ctx: TenantContext, input: CreateInput) {
  const teamId = ctx.team.id;
  const { closesAt } = input;
  const scalar = omit(input, ['skills', 'locations', 'questions', 'closesAt']);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const job = await prisma.$transaction(async (tx) => {
        const slug = await uniqueSlug(tx, teamId, input.title);
        const nested = nestedCreates(teamId, input);

        return tx.job.create({
          data: {
            ...scalar,
            descriptionHtml: sanitizeJobHtml(scalar.descriptionHtml),
            teamId,
            slug,
            createdById: ctx.user.id,
            closesAt: closesAt ? new Date(closesAt) : null,
            skills: { create: nested.skills },
            locations: { create: nested.locations },
            questions: { create: nested.questions },
            // The creator is assigned so assignment-scoped roles see their own jobs
            assignments: {
              create: [{ teamId, userId: ctx.user.id, kind: 'RECRUITER' }],
            },
          },
          include: jobInclude,
        });
      });

      return toJobView(job);
    } catch (error) {
      const slugRace =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002';

      if (!slugRace || attempt === 2) {
        throw error;
      }
    }
  }

  throw new ApiError(500, 'Could not create the job.');
}

export async function updateJob(
  ctx: TenantContext,
  jobId: string,
  input: UpdateInput
) {
  const teamId = ctx.team.id;
  const existing = await getJobOrThrow(ctx, jobId);

  if (existing.status === 'ARCHIVED') {
    throw new ApiError(409, 'Archived jobs cannot be edited.');
  }

  const { skills, locations, questions, closesAt, descriptionHtml, ...scalar } =
    input;

  const updated = await prisma.$transaction(async (tx) => {
    const nested = nestedCreates(teamId, input);

    if (skills) {
      await tx.jobSkill.deleteMany({ where: { teamId, jobId } });
      await tx.jobSkill.createMany({
        data: nested.skills.map((s) => ({ ...s, jobId })),
      });
    }

    if (locations) {
      await tx.jobLocation.deleteMany({ where: { teamId, jobId } });
      await tx.jobLocation.createMany({
        data: nested.locations.map((l) => ({ ...l, jobId })),
      });
    }

    if (questions) {
      await tx.screeningQuestion.deleteMany({ where: { teamId, jobId } });
      await tx.screeningQuestion.createMany({
        data: nested.questions.map((q) => ({ ...q, jobId })),
      });
    }

    return tx.job.update({
      where: { id: jobId, teamId },
      data: {
        ...scalar,
        ...(descriptionHtml !== undefined && {
          descriptionHtml: sanitizeJobHtml(descriptionHtml),
        }),
        ...(closesAt !== undefined && {
          closesAt: closesAt ? new Date(closesAt) : null,
        }),
      },
      include: jobInclude,
    });
  });

  return toJobView(updated);
}

export type JobAction =
  | { action: 'publish' }
  | { action: 'schedule'; publishAt: string }
  | { action: 'close' }
  | { action: 'reopen' }
  | { action: 'archive' }
  | { action: 'duplicate' };

export async function runJobAction(
  ctx: TenantContext,
  jobId: string,
  input: JobAction
) {
  const teamId = ctx.team.id;
  const job = await getJobOrThrow(ctx, jobId);
  const now = new Date();

  const guardPublishable = () => {
    const problem = isPublishable(job);

    if (problem) {
      throw new ApiError(422, problem);
    }

    if (job.closesAt && job.closesAt <= now) {
      throw new ApiError(422, 'The closing date has already passed.');
    }
  };

  const set = async (data: Prisma.JobUpdateInput) =>
    toJobView(
      await prisma.job.update({
        where: { id: jobId, teamId },
        data,
        include: jobInclude,
      })
    );

  switch (input.action) {
    case 'publish': {
      if (!['DRAFT', 'SCHEDULED'].includes(job.status)) {
        throw new ApiError(
          409,
          `A ${job.status.toLowerCase()} job cannot be published.`
        );
      }

      guardPublishable();
      await assertEntitlement(teamId, {
        limit: 'activeJobs',
        adding: job.status === 'SCHEDULED' ? 0 : 1,
      });

      void recordUsage(teamId, 'jobs_published');

      return set({ status: 'PUBLISHED', publishedAt: now, publishAt: null });
    }

    case 'schedule': {
      if (job.status !== 'DRAFT') {
        throw new ApiError(409, 'Only draft jobs can be scheduled.');
      }

      const publishAt = new Date(input.publishAt);

      if (publishAt <= now) {
        throw new ApiError(422, 'The publish date must be in the future.');
      }

      guardPublishable();
      await assertEntitlement(teamId, { limit: 'activeJobs' });

      return set({ status: 'SCHEDULED', publishAt });
    }

    case 'close': {
      if (!['PUBLISHED', 'SCHEDULED'].includes(job.status)) {
        throw new ApiError(409, 'Only published jobs can be closed.');
      }

      return set({ status: 'CLOSED' });
    }

    case 'reopen': {
      if (job.status !== 'CLOSED') {
        throw new ApiError(409, 'Only closed jobs can be reopened.');
      }

      guardPublishable();
      await assertEntitlement(teamId, { limit: 'activeJobs' });

      return set({ status: 'PUBLISHED' });
    }

    case 'archive': {
      if (job.status === 'ARCHIVED') {
        throw new ApiError(409, 'The job is already archived.');
      }

      return set({ status: 'ARCHIVED' });
    }

    case 'duplicate': {
      const copy = await prisma.$transaction(async (tx) => {
        const slug = await uniqueSlug(tx, teamId, `${job.title} copy`);

        return tx.job.create({
          data: {
            teamId,
            slug,
            title: `${job.title} (Copy)`.slice(0, 120),
            descriptionHtml: job.descriptionHtml,
            responsibilities: job.responsibilities,
            visibility: job.visibility,
            employmentType: job.employmentType,
            workMode: job.workMode,
            experienceMin: job.experienceMin,
            experienceMax: job.experienceMax,
            salaryMin: job.salaryMin,
            salaryMax: job.salaryMax,
            salaryCurrency: job.salaryCurrency,
            salaryVisible: job.salaryVisible,
            department: job.department,
            industry: job.industry,
            education: job.education,
            vacancies: job.vacancies,
            benefits: job.benefits,
            companyInfoOverride: job.companyInfoOverride,
            attributes: job.attributes ?? {},
            createdById: ctx.user.id,
            skills: {
              create: job.skills.map((s) => ({
                teamId,
                skill: s.skill,
                required: s.required,
              })),
            },
            locations: {
              create: job.locations.map((l) => ({
                teamId,
                city: l.city,
                region: l.region,
                country: l.country,
              })),
            },
            questions: {
              create: job.questions.map((q) => ({
                teamId,
                type: q.type,
                prompt: q.prompt,
                options: q.options,
                required: q.required,
                order: q.order,
              })),
            },
            assignments: {
              create: [{ teamId, userId: ctx.user.id, kind: 'RECRUITER' }],
            },
          },
          include: jobInclude,
        });
      });

      return toJobView(copy);
    }
  }
}

/** Soft delete. */
export async function deleteJob(ctx: TenantContext, jobId: string) {
  await getJobOrThrow(ctx, jobId);

  await prisma.job.update({
    where: { id: jobId, teamId: ctx.team.id },
    data: { deletedAt: new Date(), status: 'ARCHIVED' },
  });
}

export async function setAssignments(
  ctx: TenantContext,
  jobId: string,
  assignments: { userId: string; kind: JobAssignmentKind }[]
) {
  const teamId = ctx.team.id;
  await getJobOrThrow(ctx, jobId);

  // Only members of THIS portal can be assigned.
  const userIds = Array.from(new Set(assignments.map((a) => a.userId)));
  const members = await prisma.teamMember.findMany({
    where: { teamId, userId: { in: userIds } },
    select: { userId: true },
  });

  if (members.length !== userIds.length) {
    throw new ApiError(422, 'Every assignee must be a member of this portal.');
  }

  const before = new Set(
    (
      await prisma.jobAssignment.findMany({
        where: { teamId, jobId },
        select: { userId: true },
      })
    ).map((a) => a.userId)
  );

  await prisma.$transaction(async (tx) => {
    await tx.jobAssignment.deleteMany({ where: { teamId, jobId } });
    await tx.jobAssignment.createMany({
      data: assignments.map((a) => ({ teamId, jobId, ...a })),
      skipDuplicates: true,
    });
  });

  const added = userIds.filter((u) => !before.has(u) && u !== ctx.user.id);

  if (added.length) {
    const job = await getJobOrThrow(ctx, jobId);

    await notify({
      userIds: added,
      teamId,
      type: 'recruiter.assigned',
      title: `You were assigned to ${job.title}`,
      link: `/teams/${ctx.team.slug}/jobs/${jobId}`,
    });
  }

  return getJob(ctx, jobId);
}
