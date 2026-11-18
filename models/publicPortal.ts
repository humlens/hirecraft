import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { openJobWhere } from '@/lib/jobs';

/** Public view of a portal by slug (null if it does not exist). */
export async function getPublicPortal(slug: string) {
  const team = await prisma.team.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, status: true },
  });

  if (!team) {
    return null;
  }

  const [profile, branding] = await Promise.all([
    prisma.portalProfile.findUnique({ where: { teamId: team.id } }),
    prisma.portalBranding.findUnique({ where: { teamId: team.id } }),
  ]);

  return {
    team,
    suspended: team.status === 'SUSPENDED',
    profile: profile && {
      companyName: profile.companyName,
      description: profile.description,
      website: profile.website,
      contactEmail: profile.contactEmail,
      industry: profile.industry,
    },
    branding: {
      primaryColor: branding?.primaryColor ?? '#3346D3',
      theme: branding?.theme ?? 'SYSTEM',
      heroTitle: branding?.heroTitle ?? null,
      heroSubtitle: branding?.heroSubtitle ?? null,
      aboutHtml: branding?.aboutHtml ?? null,
      privacyPolicyHtml: branding?.privacyPolicyHtml ?? null,
      seoTitle: branding?.seoTitle ?? null,
      seoDescription: branding?.seoDescription ?? null,
      updatedAt: branding?.updatedAt ?? null,
    },
  };
}

export type PublicPortal = NonNullable<
  Awaited<ReturnType<typeof getPublicPortal>>
>;

const publicJobSelect = {
  id: true,
  title: true,
  slug: true,
  employmentType: true,
  workMode: true,
  department: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryVisible: true,
  experienceMin: true,
  experienceMax: true,
  publishedAt: true,
  publishAt: true,
  createdAt: true,
  closesAt: true,
  locations: { select: { city: true, region: true, country: true } },
  skills: { select: { skill: true, required: true } },
} satisfies Prisma.JobSelect;

export type PublicJobSummary = Prisma.JobGetPayload<{
  select: typeof publicJobSelect;
}>;

export type PublicJobFilters = {
  q?: string;
  location?: string;
  workMode?: string;
  employmentType?: string;
  page?: number;
  pageSize?: number;
};

/** Open, PUBLIC-visibility jobs of a portal, filtered and paginated. */
export async function listPublicJobs(teamId: string, f: PublicJobFilters) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 10, 1), 50);
  const page = Math.max(f.page ?? 1, 1);
  const now = new Date();

  let ids: string[] | undefined;

  if (f.q?.trim()) {
    // Full-text search over title/department/industry/description
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Job"
      WHERE "teamId" = ${teamId}
        AND search @@ websearch_to_tsquery('english', ${f.q.trim().slice(0, 100)})
      LIMIT 500`;

    ids = rows.map((r) => r.id);
  }

  const where: Prisma.JobWhereInput = {
    teamId,
    visibility: 'PUBLIC',
    ...openJobWhere(now),
    ...(ids ? { id: { in: ids } } : {}),
    ...(f.workMode ? { workMode: f.workMode as never } : {}),
    ...(f.employmentType ? { employmentType: f.employmentType as never } : {}),
    ...(f.location
      ? {
          locations: {
            some: {
              OR: [
                { city: { contains: f.location, mode: 'insensitive' } },
                { region: { contains: f.location, mode: 'insensitive' } },
                { country: { contains: f.location, mode: 'insensitive' } },
              ],
            },
          },
        }
      : {}),
  };

  const [total, jobs] = await Promise.all([
    prisma.job.count({ where }),
    prisma.job.findMany({
      where,
      select: publicJobSelect,
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    jobs,
    total,
    page,
    pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** An open job by slug. UNLISTED jobs are reachable by link only. */
export async function getPublicJob(teamId: string, jobSlug: string) {
  return prisma.job.findFirst({
    where: {
      teamId,
      slug: jobSlug,
      visibility: { in: ['PUBLIC', 'UNLISTED'] },
      ...openJobWhere(),
    },
    select: {
      ...publicJobSelect,
      descriptionHtml: true,
      responsibilities: true,
      benefits: true,
      education: true,
      industry: true,
      vacancies: true,
      companyInfoOverride: true,
      questions: {
        orderBy: { order: 'asc' },
        select: {
          id: true,
          type: true,
          prompt: true,
          options: true,
          required: true,
        },
      },
    },
  });
}

export type PublicJob = NonNullable<Awaited<ReturnType<typeof getPublicJob>>>;

export async function listSitemapJobs(teamId: string) {
  return prisma.job.findMany({
    where: { teamId, visibility: 'PUBLIC', ...openJobWhere() },
    select: { slug: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
    take: 5000,
  });
}
