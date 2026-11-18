import { Prisma } from '@prisma/client';
import { hashPassword } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { prisma, unguardedPrisma } from '@/lib/prisma';
import { deleteObject } from '@/lib/storage';
import type { z } from 'zod';
import type { candidateProfileSchema } from '@/lib/zod';

type ProfileInput = z.infer<typeof candidateProfileSchema>;

/** Registers a job seeker: a normal User plus a global CandidateProfile. */
export async function registerCandidate(input: {
  name: string;
  email: string;
  password: string;
}) {
  const email = input.email.toLowerCase();

  if (await prisma.user.findUnique({ where: { email } })) {
    throw new ApiError(400, 'An user with this email already exists.');
  }

  const password = await hashPassword(input.password);

  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: input.name, email, password },
      });

      await tx.candidateProfile.create({ data: { userId: user.id } });

      return user;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ApiError(400, 'An user with this email already exists.');
    }

    throw error;
  }
}

export async function ensureProfile(userId: string) {
  return prisma.candidateProfile.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

const profileInclude = {
  skills: { orderBy: { skill: 'asc' } },
  experiences: { orderBy: { startDate: 'desc' } },
  educations: { orderBy: { endYear: 'desc' } },
  certifications: true,
} satisfies Prisma.CandidateProfileInclude;

export function computeCompleteness(p: {
  headline?: string | null;
  summary?: string | null;
  phone?: string | null;
  location?: string | null;
  skills: unknown[];
  experiences: unknown[];
  educations: unknown[];
  resumeCount: number;
}) {
  const checks = [
    !!p.headline,
    !!p.summary,
    !!p.phone,
    !!p.location,
    p.skills.length >= 3,
    p.experiences.length >= 1,
    p.educations.length >= 1,
    p.resumeCount >= 1,
  ];

  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

/** The user's candidate profile, or null if they never used the job-seeker side. */
export async function findProfile(userId: string) {
  const exists = await prisma.candidateProfile.findUnique({
    where: { userId },
    select: { id: true },
  });

  return exists ? getProfile(userId) : null;
}

export async function getProfile(userId: string) {
  await ensureProfile(userId);

  const profile = await prisma.candidateProfile.findUniqueOrThrow({
    where: { userId },
    include: profileInclude,
  });
  const resumeCount = await prisma.candidateResume.count({
    where: { profileId: profile.id, deletedAt: null },
  });

  return {
    ...profile,
    completeness: computeCompleteness({ ...profile, resumeCount }),
  };
}

export async function updateProfile(userId: string, input: ProfileInput) {
  const profile = await ensureProfile(userId);
  const { skills, experiences, educations, certifications, ...scalar } = input;

  await prisma.$transaction(async (tx) => {
    await tx.candidateProfile.update({
      where: { id: profile.id },
      data: scalar,
    });

    if (skills) {
      const unique = Array.from(new Set(skills.map((s) => s.trim())));

      await tx.candidateSkill.deleteMany({ where: { profileId: profile.id } });
      await tx.candidateSkill.createMany({
        data: unique.map((skill) => ({ profileId: profile.id, skill })),
        skipDuplicates: true,
      });
    }

    if (experiences) {
      await tx.candidateExperience.deleteMany({
        where: { profileId: profile.id },
      });
      await tx.candidateExperience.createMany({
        data: experiences.map((e) => ({
          profileId: profile.id,
          company: e.company,
          title: e.title,
          startDate: new Date(e.startDate),
          endDate: e.current || !e.endDate ? null : new Date(e.endDate),
          current: e.current,
          description: e.description ?? null,
        })),
      });
    }

    if (educations) {
      await tx.candidateEducation.deleteMany({
        where: { profileId: profile.id },
      });
      await tx.candidateEducation.createMany({
        data: educations.map((e) => ({
          profileId: profile.id,
          institution: e.institution,
          degree: e.degree,
          field: e.field ?? null,
          startYear: e.startYear ?? null,
          endYear: e.endYear ?? null,
        })),
      });
    }

    if (certifications) {
      await tx.candidateCertification.deleteMany({
        where: { profileId: profile.id },
      });
      await tx.candidateCertification.createMany({
        data: certifications.map((c) => ({
          profileId: profile.id,
          name: c.name,
          issuer: c.issuer ?? null,
          year: c.year ?? null,
        })),
      });
    }
  });

  const fresh = await getProfile(userId);

  await prisma.candidateProfile.update({
    where: { id: profile.id },
    data: { completeness: fresh.completeness },
  });

  return fresh;
}

// ---------------------------------------------------------------------------
// Resumes
// ---------------------------------------------------------------------------

export const MAX_RESUMES = 10;

export async function listResumes(userId: string) {
  const profile = await ensureProfile(userId);

  return prisma.candidateResume.findMany({
    where: { profileId: profile.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      fileName: true,
      mime: true,
      size: true,
      version: true,
      isDefault: true,
      parseStatus: true,
      createdAt: true,
    },
  });
}

export async function getOwnResume(userId: string, resumeId: string) {
  const resume = await prisma.candidateResume.findFirst({
    where: { id: resumeId, deletedAt: null, profile: { userId } },
  });

  if (!resume) {
    throw new ApiError(404, 'Resume not found.');
  }

  return resume;
}

export async function deleteOwnResume(userId: string, resumeId: string) {
  const resume = await getOwnResume(userId, resumeId);
  const used = await unguardedPrisma.jobApplication.count({
    where: { resumeId: resume.id },
  });

  if (used > 0) {
    // Employers you applied to keep access to what you sent them.
    await prisma.candidateResume.update({
      where: { id: resume.id },
      data: { deletedAt: new Date(), isDefault: false },
    });
  } else {
    await prisma.candidateResume.delete({ where: { id: resume.id } });
    await deleteObject(resume.storageKey);
  }
}

// ---------------------------------------------------------------------------
// Privacy: export and erasure
// ---------------------------------------------------------------------------

export async function exportCandidateData(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  const profile = await prisma.candidateProfile.findUnique({
    where: { userId },
    include: {
      ...profileInclude,
      resumes: {
        select: {
          id: true,
          fileName: true,
          mime: true,
          size: true,
          createdAt: true,
          deletedAt: true,
        },
      },
    },
  });

  // Cross-portal by design: this is the user's own data across tenants.
  const [candidates, consents, savedJobs] = await Promise.all([
    unguardedPrisma.tenantCandidate.findMany({
      where: { userId },
      include: {
        applications: {
          include: {
            job: { select: { title: true, team: { select: { name: true } } } },
            stage: { select: { name: true } },
          },
        },
      },
    }),
    unguardedPrisma.candidateConsent.findMany({ where: { userId } }),
    prisma.savedJob.findMany({
      where: { userId },
      include: { job: { select: { title: true } } },
    }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    account: user,
    profile,
    applications: candidates.flatMap((c) =>
      c.applications.map((a) => ({
        id: a.id,
        portal: a.job.team.name,
        job: a.job.title,
        stage: a.stage.name,
        appliedAt: a.createdAt,
        withdrawnAt: a.withdrawnAt,
        answers: a.answers,
      }))
    ),
    portalRecords: candidates.map((c) => ({
      portalCandidateId: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      source: c.source,
    })),
    consents: consents.map((c) => ({
      portalId: c.teamId,
      purpose: c.purpose,
      granted: c.granted,
      grantedAt: c.grantedAt,
      revokedAt: c.revokedAt,
      policyVersion: c.policyVersion,
    })),
    savedJobs: savedJobs.map((s) => ({
      job: s.job.title,
      savedAt: s.createdAt,
    })),
  };
}

/**
 * Erases a candidate account. Employers keep a de-identified application
 * record (needed for their own reporting) but lose every identifier, the
 * resume files and the account itself.
 */
export async function eraseCandidate(userId: string) {
  const memberships = await prisma.teamMember.count({ where: { userId } });

  if (memberships > 0) {
    throw new ApiError(
      400,
      'Leave or delete your portals before deleting this account.'
    );
  }

  const profile = await prisma.candidateProfile.findUnique({
    where: { userId },
    include: { resumes: { select: { id: true, storageKey: true } } },
  });

  // Cross-portal by design (the user's own records in every portal), so this
  // uses the unguarded client inside one transaction.
  await unguardedPrisma.$transaction(async (tx) => {
    const candidates = await tx.tenantCandidate.findMany({
      where: { userId },
      select: { id: true },
    });

    for (const c of candidates) {
      await tx.tenantCandidate.update({
        where: { id: c.id },
        data: {
          userId: null,
          name: 'Deleted candidate',
          email: `deleted+${c.id}@invalid.local`,
          phone: null,
        },
      });
    }

    await tx.jobApplication.updateMany({
      where: { tenantCandidateId: { in: candidates.map((c) => c.id) } },
      data: { resumeId: null, answers: [] },
    });

    await tx.candidateConsent.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Cascades profile, skills, experience, resumes, saved jobs, sessions.
    await tx.user.delete({ where: { id: userId } });
  });

  for (const r of profile?.resumes ?? []) {
    await deleteObject(r.storageKey).catch(() => undefined);
  }
}
