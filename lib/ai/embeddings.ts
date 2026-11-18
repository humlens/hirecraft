import { Prisma } from '@prisma/client';
import { ApiError } from '../errors';
import env from '../env';
import { prisma } from '../prisma';
import { takeToken } from '../rateLimit';
import { resolveEmbedding } from './config';
import { scrubProtectedText } from './redact';
import { EMBEDDING_DIMENSIONS } from './types';

export const toVectorLiteral = (v: number[]) =>
  `[${v.map((x) => Number(x.toFixed(6))).join(',')}]`;

/** Embeds texts with the portal's (or the platform's) embedding provider and records usage. */
export async function embedTexts(
  ctx: { teamId: string | null; userId: string | null },
  texts: string[]
): Promise<number[][]> {
  if (!env.ai.enabled) {
    throw new ApiError(503, 'AI features are disabled on this server.');
  }

  if (
    !(await takeToken(
      `ai:${ctx.userId ?? ctx.teamId ?? 'system'}`,
      env.ai.ratePerMinute
    ))
  ) {
    throw new ApiError(429, 'Too many AI requests. Please wait a moment.');
  }

  const e = await resolveEmbedding(ctx.teamId);
  const started = Date.now();
  let r: Awaited<ReturnType<typeof e.provider.embed>>;

  try {
    r = await e.provider.embed({
      model: e.model,
      texts,
      dimensions: EMBEDDING_DIMENSIONS,
    });
  } catch (error) {
    console.error('embedding request failed', error);
    throw new ApiError(
      502,
      'The AI provider request failed. Please try again later.'
    );
  }

  if (
    r.vectors.length !== texts.length ||
    r.vectors.some((v) => v.length !== EMBEDDING_DIMENSIONS)
  ) {
    throw new ApiError(
      502,
      `The embedding model must return ${EMBEDDING_DIMENSIONS}-dimensional vectors.`
    );
  }

  await prisma.aIUsage.create({
    data: {
      teamId: ctx.teamId,
      userId: ctx.userId,
      feature: 'embed',
      provider: e.providerName,
      model: r.model,
      promptKey: 'embed',
      promptVersion: 1,
      inputTokens: Math.round(r.usage.inputTokens),
      outputTokens: 0,
      credits: 0,
      latencyMs: Date.now() - started,
      status: 'OK',
    },
  });

  return r.vectors;
}

/**
 * Text that represents a candidate for embedding / matching: skills, roles
 * and education, with protected attributes removed. Never contains the
 * name, contact details, photo, date of birth or institution names.
 */
export function anonymisedProfileText(p: {
  headline: string | null;
  summary: string | null;
  location: string | null;
  skills: { skill: string }[];
  experiences: {
    title: string;
    company: string;
    startDate: Date;
    endDate: Date | null;
    current: boolean;
    description: string | null;
  }[];
  educations: { degree: string; field: string | null }[];
  certifications: { name: string }[];
}) {
  const lines: string[] = [];

  if (p.headline) lines.push(`Headline: ${scrubProtectedText(p.headline)}`);
  if (p.summary) lines.push(`Summary: ${scrubProtectedText(p.summary)}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.skills.length)
    lines.push(`Skills: ${p.skills.map((s) => s.skill).join(', ')}`);

  for (const e of p.experiences) {
    const to =
      e.current || !e.endDate ? 'present' : String(e.endDate.getUTCFullYear());

    lines.push(
      `Role: ${scrubProtectedText(e.title)} at ${scrubProtectedText(e.company)} (${e.startDate.getUTCFullYear()}-${to}). ${scrubProtectedText(e.description)}`.trim()
    );
  }

  for (const d of p.educations) {
    lines.push(
      `Education: ${scrubProtectedText(d.degree)}${d.field ? `, ${scrubProtectedText(d.field)}` : ''}`
    );
  }

  if (p.certifications.length)
    lines.push(
      `Certifications: ${p.certifications.map((c) => c.name).join(', ')}`
    );

  return lines.join('\n');
}

/** (Re)computes the profile embedding of a candidate. Platform-level (no portal). */
export async function embedProfile(userId: string) {
  const profile = await prisma.candidateProfile.findUnique({
    where: { userId },
    include: {
      skills: true,
      experiences: true,
      educations: true,
      certifications: true,
    },
  });

  if (!profile) {
    return false;
  }

  const text = anonymisedProfileText(profile);

  if (text.trim().length < 10) {
    return false;
  }

  const [vec] = await embedTexts({ teamId: null, userId }, [text]);

  await prisma.$executeRaw`UPDATE "CandidateProfile" SET embedding = ${toVectorLiteral(vec)}::vector, "embeddedAt" = now() WHERE id = ${profile.id}`;

  return true;
}

export async function embedJob(teamId: string, jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, teamId, deletedAt: null },
    include: { skills: true, locations: true },
  });

  if (!job) {
    return false;
  }

  const text = [
    `Job: ${job.title}`,
    job.department ? `Department: ${job.department}` : '',
    `Skills: ${job.skills.map((s) => s.skill).join(', ')}`,
    job.descriptionHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 3000),
  ]
    .filter(Boolean)
    .join('\n');
  const [vec] = await embedTexts({ teamId, userId: null }, [text]);

  await prisma.$executeRaw(
    Prisma.sql`UPDATE "Job" SET embedding = ${toVectorLiteral(vec)}::vector, "embeddedAt" = now() WHERE id = ${jobId} AND "teamId" = ${teamId}`
  );

  return true;
}
