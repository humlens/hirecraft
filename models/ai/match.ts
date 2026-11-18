import type { Prisma } from '@prisma/client';
import { anonymisedProfileText } from '@/lib/ai/embeddings';
import type { MatchLLM } from '@/lib/ai/features';
import { scrubProtectedText } from '@/lib/ai/redact';
import { runAIFeature } from '@/lib/ai/run';
import { stripHtml } from '@/lib/jobs';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { buildTenantContext, type TenantContext } from '@/lib/tenant';
import { enqueue } from '@/lib/queue';
import { jobScope } from 'models/job';
import { aiContext } from './context';
import { experienceYears } from './resumeParse';

/**
 * Explainable candidate-to-job matching.
 *
 * Deterministic parts are computed in code from the profile (skills, years
 * from explicit dates, location, education, certifications). The model only
 * rates *technical depth* and writes the explanation, evidence quotes and
 * interview questions. The score is a weighted blend; it NEVER moves or
 * rejects an application: it is a suggestion for a human.
 */
export const WEIGHTS = {
  skills: 0.4,
  depth: 0.2,
  years: 0.2,
  location: 0.1,
  education: 0.05,
  certifications: 0.05,
} as const;

const ALIASES: Record<string, string> = {
  nodejs: 'node',
  node: 'node',
  reactjs: 'react',
  vuejs: 'vue',
  angularjs: 'angular',
  nextjs: 'next',
  postgres: 'postgresql',
  js: 'javascript',
  ts: 'typescript',
  golang: 'go',
  k8s: 'kubernetes',
  aws: 'aws',
  amazonwebservices: 'aws',
  gcp: 'googlecloud',
  csharp: 'c#',
};

export const normSkill = (s: string) => {
  const k = s
    .toLowerCase()
    .replace(/[.\s\-_/]/g, '')
    .replace(/\(.*?\)/g, '');

  return ALIASES[k] ?? k;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word match of a skill (or one of its aliases) in free text: "aws" must not match "laws". */
export function textHasSkill(text: string, skill: string) {
  const norm = normSkill(skill);
  const variants = new Set([skill.toLowerCase().trim(), norm]);

  for (const [alias, to] of Object.entries(ALIASES)) {
    if (to === norm) variants.add(alias);
  }

  const hay = text.toLowerCase();

  return Array.from(variants).some(
    (v) =>
      v.length >= 2 &&
      new RegExp(`(^|[^a-z0-9+#])${escapeRe(v)}([^a-z0-9+#]|$)`).test(hay)
  );
}

const collapse = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

type Component = {
  key: keyof typeof WEIGHTS;
  label: string;
  score: number | null;
  weight: number;
  applicable: boolean;
};

/** Pure scoring of the deterministic components + the model's depth score. */
export function scoreMatch(input: {
  required: string[];
  optional: string[];
  candidateSkills: string[];
  candidateText: string;
  years: number;
  job: {
    experienceMin: number | null;
    experienceMax: number | null;
    workMode: string;
    education: string | null;
    locations: {
      city: string | null;
      region: string | null;
      country: string | null;
    }[];
  };
  candidate: {
    location: string | null;
    preferredLocations: string[];
    educations: { degree: string; field: string | null }[];
    certifications: { name: string }[];
  };
  depth: number | null;
}) {
  const have = new Set(input.candidateSkills.map(normSkill));
  const has = (s: string) =>
    have.has(normSkill(s)) || textHasSkill(input.candidateText, s);
  const matchedRequired = input.required.filter(has);
  const missingRequired = input.required.filter((s) => !has(s));
  const matchedOptional = input.optional.filter(has);

  const components: Component[] = [];
  const add = (
    key: Component['key'],
    label: string,
    score: number | null,
    applicable: boolean
  ) =>
    components.push({
      key,
      label,
      score: score == null ? null : Math.round(score),
      weight: WEIGHTS[key],
      applicable: applicable && score != null,
    });

  const skillBase = input.required.length
    ? (matchedRequired.length / input.required.length) * 100
    : 100;
  const optionalBonus = input.optional.length
    ? (matchedOptional.length / input.optional.length) * 10
    : 0;

  add(
    'skills',
    'Required skills',
    Math.min(100, skillBase + optionalBonus),
    input.required.length + input.optional.length > 0
  );
  add('depth', 'Technical depth', input.depth, input.depth != null);

  const { experienceMin: min, experienceMax: max } = input.job;
  const yearsScore =
    min == null
      ? null
      : input.years >= min
        ? max != null && input.years > max + 3
          ? 85
          : 100
        : (input.years / Math.max(min, 0.5)) * 100;

  add('years', 'Years of experience', yearsScore, yearsScore != null);

  let loc: number;

  if (input.job.workMode === 'REMOTE') loc = 100;
  else {
    const cand = [
      input.candidate.location,
      ...input.candidate.preferredLocations,
    ]
      .filter(Boolean)
      .map((x) => collapse(x as string));
    const jobLocs = input.job.locations
      .flatMap((l) => [l.city, l.region, l.country])
      .filter(Boolean)
      .map((x) => collapse(x as string));

    loc = !cand.length
      ? 60
      : cand.some((c) => jobLocs.some((j) => c.includes(j) || j.includes(c)))
        ? 100
        : 40;
  }

  add('location', 'Location and work mode', loc, true);

  const eduReq = input.job.education?.trim();

  if (eduReq) {
    const tokens = collapse(eduReq)
      .split(/[^a-z0-9+]+/)
      .filter((t) => t.length >= 3);
    const edu = collapse(
      input.candidate.educations
        .map((e) => `${e.degree} ${e.field ?? ''}`)
        .join(' ')
    );

    add(
      'education',
      'Education',
      tokens.some((t) => edu.includes(t)) ? 100 : 30,
      true
    );
  } else {
    add('education', 'Education', null, false);
  }

  if (input.candidate.certifications.length) {
    const relevant = input.candidate.certifications.some((c) =>
      input.required.some(
        (r) =>
          normSkill(c.name).includes(normSkill(r)) && normSkill(r).length > 2
      )
    );

    add('certifications', 'Certifications', relevant ? 100 : 50, true);
  } else {
    add('certifications', 'Certifications', null, false);
  }

  const applicable = components.filter((c) => c.applicable);
  const totalWeight = applicable.reduce((s, c) => s + c.weight, 0) || 1;
  const score = Math.round(
    applicable.reduce((s, c) => s + (c.score as number) * c.weight, 0) /
      totalWeight
  );

  return {
    score,
    components,
    matchedRequired,
    missingRequired,
    matchedOptional,
  };
}

/** Keeps only evidence whose quote really appears in the candidate text. */
export function verifyEvidence(
  evidence: MatchLLM['evidence'],
  candidateText: string
) {
  const hay = collapse(candidateText);
  const kept = evidence.filter(
    (e) => collapse(e.quote).length >= 10 && hay.includes(collapse(e.quote))
  );

  return { kept, dropped: evidence.length - kept.length };
}

async function load(ctx: TenantContext, applicationId: string) {
  const teamId = ctx.team.id;
  const app = await prisma.jobApplication.findFirst({
    where: {
      id: applicationId,
      teamId,
      job: { teamId, deletedAt: null, ...jobScope(ctx) },
    },
    include: {
      tenantCandidate: { select: { userId: true } },
      job: { include: { skills: true, locations: true } },
    },
  });

  if (!app) {
    throw new ApiError(404, 'Application not found.');
  }

  return app;
}

export async function assessApplication(
  ctx: TenantContext,
  applicationId: string
) {
  const teamId = ctx.team.id;
  const app = await load(ctx, applicationId);
  const userId = app.tenantCandidate.userId;

  // The application is the candidate's consent to share this profile with the employer
  const profile = userId
    ? await prisma.candidateProfile.findUnique({
        where: { userId },
        include: {
          skills: true,
          experiences: true,
          educations: true,
          certifications: true,
        },
      })
    : null;

  if (!profile) {
    throw new ApiError(
      422,
      'This candidate has no profile to assess (imported or unregistered candidate).'
    );
  }

  const candidateText = anonymisedProfileText(profile);

  if (candidateText.trim().length < 20) {
    throw new ApiError(422, 'The candidate profile is too empty to assess.');
  }

  const required = app.job.skills.filter((s) => s.required).map((s) => s.skill);
  const optional = app.job.skills
    .filter((s) => !s.required)
    .map((s) => s.skill);
  const years = experienceYears(
    profile.experiences.map((e) => ({
      start: e.startDate,
      end: e.endDate,
      current: e.current,
    }))
  );

  // first pass without the model to know which skills matched / are missing
  const pre = scoreMatch({
    required,
    optional,
    candidateSkills: profile.skills.map((s) => s.skill),
    candidateText,
    years,
    job: app.job,
    candidate: profile,
    depth: null,
  });

  const {
    data: llm,
    model,
    promptVersion,
  } = await runAIFeature(aiContext(ctx), 'match.assess', {
    jobTitle: app.job.title,
    required,
    optional,
    jobDescription: stripHtml(app.job.descriptionHtml).slice(0, 4000),
    candidate: candidateText,
    matched: pre.matchedRequired.concat(pre.matchedOptional),
    missing: pre.missingRequired,
  });

  const final = scoreMatch({
    required,
    optional,
    candidateSkills: profile.skills.map((s) => s.skill),
    candidateText,
    years,
    job: app.job,
    candidate: profile,
    depth: llm.technicalDepth.score,
  });
  const { kept, dropped } = verifyEvidence(llm.evidence, candidateText);

  const row = await prisma.matchAssessment.create({
    data: {
      teamId,
      applicationId,
      score: final.score,
      breakdown: {
        components: final.components,
        experienceYears: years,
        depthRationale: scrubProtectedText(llm.technicalDepth.rationale),
        evidenceDropped: dropped,
      } as unknown as Prisma.InputJsonValue,
      matchedSkills: final.matchedRequired.concat(final.matchedOptional),
      missingSkills: final.missingRequired,
      explanation: scrubProtectedText(llm.explanation),
      evidence: kept as unknown as Prisma.InputJsonValue,
      suggestedQuestions: llm.suggestedQuestions,
      promptVersion,
      model,
    },
  });

  // Deliberately nothing else: no stage change, no rejection, no message.
  return toView(row);
}

type Row = Prisma.MatchAssessmentGetPayload<object>;

const toView = (r: Row) => ({
  id: r.id,
  applicationId: r.applicationId,
  score: r.score,
  breakdown: r.breakdown,
  matchedSkills: r.matchedSkills,
  missingSkills: r.missingSkills,
  explanation: r.explanation,
  evidence: r.evidence,
  suggestedQuestions: r.suggestedQuestions,
  promptVersion: r.promptVersion,
  model: r.model,
  createdAt: r.createdAt,
  note: 'A suggestion to help a human reviewer. It never decides an application.',
});

export async function listAssessments(
  ctx: TenantContext,
  applicationId: string
) {
  await load(ctx, applicationId);

  const rows = await prisma.matchAssessment.findMany({
    where: { teamId: ctx.team.id, applicationId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return rows.map(toView);
}

/** Queues an assessment for every application of a job that has none yet. */
export async function queueJobMatching(ctx: TenantContext, jobId: string) {
  const teamId = ctx.team.id;
  const apps = await prisma.jobApplication.findMany({
    where: {
      teamId,
      jobId,
      job: { teamId, deletedAt: null, ...jobScope(ctx) },
      stage: { kind: 'ACTIVE' },
      assessments: { none: { teamId } },
    },
    select: { id: true },
    take: 500,
  });

  for (const a of apps) {
    await enqueue('match.application', {
      teamId,
      applicationId: a.id,
      userId: ctx.user.id,
    });
  }

  return { queued: apps.length };
}

/** Job handler. The caller's permissions are rebuilt from the database. */
export async function matchApplicationJob(d: {
  teamId: string;
  applicationId: string;
  userId: string;
}) {
  const ctx = await buildTenantContext(d.teamId, d.userId);

  await assessApplication(ctx, d.applicationId);
}
