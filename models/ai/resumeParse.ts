import { Prisma } from '@prisma/client';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { parsedResumeSchema, type ParsedResume } from '@/lib/ai/features';
import { redactForLog, scrubProtectedText } from '@/lib/ai/redact';
import { resolveAI } from '@/lib/ai/config';
import { runAIFeature } from '@/lib/ai/run';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { notify } from '@/lib/notifications';
import { getObjectBuffer } from '@/lib/storage';
import { enqueue } from '@/lib/queue';
import { computeCompleteness } from 'models/candidate';

export const CONFIDENCE_THRESHOLD = 0.75;
const MAX_TEXT = 30_000;

export async function extractResumeText(buffer: Buffer, mime: string) {
  let text = '';

  if (mime === 'application/pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });

    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } else {
    text = (await mammoth.extractRawText({ buffer })).value;
  }

  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

/** First email / phone found in the text (they are filled locally, never sent to the model). */
export function localContact(text: string) {
  return {
    email: text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null,
    phone: text.match(/\+?\d[\d\s().-]{8,}\d/)?.[0]?.trim() ?? null,
  };
}

/** What the model gets to see: no contact data, no protected-attribute lines. */
export const resumeTextForModel = (text: string) =>
  scrubProtectedText(
    redactForLog(text, MAX_TEXT).replace(/\[(email|url|number)\]/g, '')
  );

// ---------------------------------------------------------------------------
// Dates and experience: computed in code from explicit dates only
// ---------------------------------------------------------------------------

export function parseResumeDate(
  raw: string | null | undefined,
  endOfPeriod = false
): Date | null {
  const m = raw?.match(/(\d{4})(?:[-/](\d{1,2}))?/);

  if (!m) {
    return null;
  }

  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : endOfPeriod ? 12 : 1;

  if (
    year < 1950 ||
    year > new Date().getUTCFullYear() + 1 ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, 1));
}

/** Total years of experience from explicit employment dates (overlaps counted once). */
export function experienceYears(
  roles: { start: Date | null; end: Date | null; current: boolean }[],
  now = new Date()
) {
  const intervals = roles
    .filter((r) => r.start)
    .map(
      (r) =>
        [r.start as Date, r.current || !r.end ? now : r.end] as [Date, Date]
    )
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0].getTime() - b[0].getTime());
  const merged: [Date, Date][] = [];

  for (const iv of intervals) {
    const last = merged[merged.length - 1];

    if (last && iv[0] <= last[1]) {
      last[1] = iv[1] > last[1] ? iv[1] : last[1];
    } else {
      merged.push([iv[0], iv[1]]);
    }
  }

  const months = merged.reduce(
    (sum, [s, e]) => sum + (e.getTime() - s.getTime()) / (30.4375 * 86400_000),
    0
  );

  return Math.round((months / 12) * 10) / 10;
}

type Pending = {
  field: string;
  value: unknown;
  confidence: number;
  note?: string;
};

/**
 * Splits a model reply into what is applied automatically (high confidence,
 * dates present and visible in the resume) and what the candidate must
 * confirm.
 */
export function planFields(parsed: ParsedResume, resumeText: string) {
  const apply = {
    headline: null as string | null,
    summary: null as string | null,
    location: null as string | null,
    skills: [] as string[],
    experiences: [] as {
      company: string;
      title: string;
      startDate: Date;
      endDate: Date | null;
      current: boolean;
      description: string | null;
    }[],
    educations: [] as {
      institution: string;
      degree: string;
      field: string | null;
      startYear: number | null;
      endYear: number | null;
    }[],
    certifications: [] as {
      name: string;
      issuer: string | null;
      year: number | null;
    }[],
  };
  const pending: Pending[] = [];
  const high = (c: number) => c >= CONFIDENCE_THRESHOLD;

  for (const f of ['headline', 'summary', 'location'] as const) {
    const v = parsed[f];

    if (!v?.value) continue;

    if (high(v.confidence)) apply[f] = v.value;
    else pending.push({ field: f, value: v.value, confidence: v.confidence });
  }

  for (const s of parsed.skills) {
    if (high(s.confidence)) apply.skills.push(s.value);
    else
      pending.push({
        field: 'skill',
        value: s.value,
        confidence: s.confidence,
      });
  }

  for (const e of parsed.experiences) {
    const start = parseResumeDate(e.startDate);
    const end = parseResumeDate(e.endDate, true);
    // the year must literally appear in the resume text, otherwise the date is not "explicit"
    const verifiable =
      !!start && resumeText.includes(String(start.getUTCFullYear()));
    const confidence = verifiable ? e.confidence : Math.min(e.confidence, 0.5);
    const item = {
      company: e.company,
      title: e.title,
      startDate: start,
      endDate: e.current ? null : end,
      current: e.current,
      description: e.description ?? null,
    };

    if (start && verifiable && high(confidence)) {
      apply.experiences.push({ ...item, startDate: start });
    } else {
      pending.push({
        field: 'experience',
        value: {
          ...item,
          startDate: e.startDate ?? null,
          endDate: e.endDate ?? null,
        },
        confidence,
        note: !start
          ? 'No explicit start date'
          : !verifiable
            ? 'Date not found in the resume text'
            : undefined,
      });
    }
  }

  for (const d of parsed.educations) {
    const item = {
      institution: d.institution,
      degree: d.degree,
      field: d.field ?? null,
      startYear: d.startYear ?? null,
      endYear: d.endYear ?? null,
    };

    if (high(d.confidence)) apply.educations.push(item);
    else
      pending.push({
        field: 'education',
        value: item,
        confidence: d.confidence,
      });
  }

  for (const c of parsed.certifications) {
    const item = {
      name: c.name,
      issuer: c.issuer ?? null,
      year: c.year ?? null,
    };

    if (high(c.confidence)) apply.certifications.push(item);
    else
      pending.push({
        field: 'certification',
        value: item,
        confidence: c.confidence,
      });
  }

  return { apply, pending };
}

type Apply = ReturnType<typeof planFields>['apply'];

/** Writes parsed values into the candidate profile without overwriting what the candidate already entered. */
export async function applyToProfile(
  tx: Prisma.TransactionClient,
  profileId: string,
  a: Apply,
  extra: { phone?: string | null } = {}
) {
  const p = await tx.candidateProfile.findUniqueOrThrow({
    where: { id: profileId },
    include: {
      skills: true,
      experiences: true,
      educations: true,
      certifications: true,
    },
  });

  await tx.candidateProfile.update({
    where: { id: profileId },
    data: {
      ...(a.headline && !p.headline ? { headline: a.headline } : {}),
      ...(a.summary && !p.summary ? { summary: a.summary } : {}),
      ...(a.location && !p.location ? { location: a.location } : {}),
      ...(extra.phone && !p.phone ? { phone: extra.phone } : {}),
    },
  });

  const have = new Set(p.skills.map((s) => s.skill.toLowerCase()));
  const fresh = Array.from(
    new Set(a.skills.filter((s) => !have.has(s.toLowerCase())))
  );

  if (fresh.length) {
    await tx.candidateSkill.createMany({
      data: fresh.map((skill) => ({ profileId, skill })),
      skipDuplicates: true,
    });
  }

  // Lists are filled only when the candidate has none yet; otherwise additions are suggested, not forced.
  if (!p.experiences.length && a.experiences.length) {
    await tx.candidateExperience.createMany({
      data: a.experiences.map((e) => ({ profileId, ...e })),
    });
  }

  if (!p.educations.length && a.educations.length) {
    await tx.candidateEducation.createMany({
      data: a.educations.map((e) => ({ profileId, ...e })),
    });
  }

  if (!p.certifications.length && a.certifications.length) {
    await tx.candidateCertification.createMany({
      data: a.certifications.map((c) => ({ profileId, ...c })),
    });
  }
}

async function refreshCompleteness(profileId: string) {
  const p = await prisma.candidateProfile.findUniqueOrThrow({
    where: { id: profileId },
    include: { skills: true, experiences: true, educations: true },
  });
  const resumeCount = await prisma.candidateResume.count({
    where: { profileId, deletedAt: null },
  });

  await prisma.candidateProfile.update({
    where: { id: profileId },
    data: { completeness: computeCompleteness({ ...p, resumeCount }) },
  });
}

/** Job handler: parse one resume. The original file is never modified. */
export async function parseResume(resumeId: string) {
  const resume = await prisma.candidateResume.findFirst({
    where: { id: resumeId, deletedAt: null },
    include: { profile: { select: { id: true, userId: true } } },
  });

  if (!resume) {
    return { status: 'missing' as const };
  }

  const userId = resume.profile.userId;

  // AI not configured on this server: leave the resume PENDING (manual profile entry still works)
  try {
    await resolveAI(null);
  } catch (error) {
    if (error instanceof ApiError && error.status === 503) {
      return { status: 'skipped' as const };
    }

    throw error;
  }

  try {
    const buffer = await getObjectBuffer(resume.storageKey);
    const text = await extractResumeText(buffer, resume.mime);

    if (text.length < 50) {
      await prisma.candidateResume.update({
        where: { id: resume.id },
        data: {
          parseStatus: 'FAILED',
          parsedAt: new Date(),
          parsedJson: {
            error: 'No readable text (a scanned image?). OCR is not supported.',
          },
        },
      });

      return { status: 'failed' as const };
    }

    const contact = localContact(text);
    const { data: parsed } = await runAIFeature(
      { teamId: null, userId },
      'resume.parse',
      { resumeText: resumeTextForModel(text) }
    );
    const checked = parsedResumeSchema.parse(parsed);
    const { apply, pending } = planFields(checked, text);

    // Experience comes from explicit dates only, never from a number the model wrote
    const years = experienceYears(
      checked.experiences.map((e) => ({
        start: parseResumeDate(e.startDate),
        end: parseResumeDate(e.endDate, true),
        current: e.current,
      }))
    );

    await prisma.$transaction(async (tx) => {
      await applyToProfile(tx, resume.profile.id, apply, {
        phone: contact.phone,
      });
      await tx.parsedField.deleteMany({ where: { resumeId: resume.id } });

      if (pending.length) {
        await tx.parsedField.createMany({
          data: pending.map((p) => ({
            resumeId: resume.id,
            field: p.field,
            value: (p.note
              ? { value: p.value, note: p.note }
              : { value: p.value }) as Prisma.InputJsonValue,
            confidence: p.confidence,
          })),
        });
      }

      await tx.candidateResume.update({
        where: { id: resume.id },
        data: {
          parseStatus: pending.length ? 'NEEDS_REVIEW' : 'PARSED',
          parsedAt: new Date(),
          parsedJson: {
            parsed: checked,
            derived: { experienceYears: years },
            pending: pending.length,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });

    await refreshCompleteness(resume.profile.id);
    await enqueue('embed.profile', { userId });
    await notify({
      userIds: [userId],
      type: 'ai.task_finished',
      title: pending.length
        ? 'Your resume was read: please review a few details'
        : 'Your resume was read and your profile updated',
      link: '/me/profile',
      inAppOnly: true,
    });

    return {
      status: pending.length ? ('needs_review' as const) : ('parsed' as const),
      years,
    };
  } catch (error: any) {
    await prisma.candidateResume
      .update({
        where: { id: resume.id },
        data: {
          parseStatus: 'FAILED',
          parsedAt: new Date(),
          parsedJson: { error: String(error?.message ?? error).slice(0, 300) },
        },
      })
      .catch(() => undefined);

    throw error;
  }
}

// ---------------------------------------------------------------------------
// Candidate review of low-confidence fields
// ---------------------------------------------------------------------------

export async function getParsedForReview(userId: string, resumeId: string) {
  const resume = await prisma.candidateResume.findFirst({
    where: { id: resumeId, deletedAt: null, profile: { userId } },
    include: { parsedFields: { orderBy: { createdAt: 'asc' } } },
  });

  if (!resume) {
    return null;
  }

  return {
    status: resume.parseStatus,
    derived:
      (resume.parsedJson as { derived?: unknown } | null)?.derived ?? null,
    fields: resume.parsedFields.map((f) => ({
      id: f.id,
      field: f.field,
      value: (f.value as { value: unknown }).value,
      note: (f.value as { note?: string }).note ?? null,
      confidence: f.confidence,
      confirmedAt: f.confirmedAt,
    })),
  };
}

/** The candidate confirms (optionally edits) or rejects pending fields. */
export async function reviewParsedFields(
  userId: string,
  resumeId: string,
  input: { confirm: { id: string; value?: unknown }[]; reject: string[] }
) {
  const resume = await prisma.candidateResume.findFirst({
    where: { id: resumeId, deletedAt: null, profile: { userId } },
    include: { parsedFields: true },
  });

  if (!resume) {
    return null;
  }

  const apply: Apply = {
    headline: null,
    summary: null,
    location: null,
    skills: [],
    experiences: [],
    educations: [],
    certifications: [],
  };
  const confirmedIds: string[] = [];

  for (const c of input.confirm) {
    const f = resume.parsedFields.find((x) => x.id === c.id && !x.confirmedAt);

    if (!f) continue;

    const v = (c.value ?? (f.value as { value: unknown }).value) as any;

    confirmedIds.push(f.id);

    if (
      f.field === 'headline' ||
      f.field === 'summary' ||
      f.field === 'location'
    )
      apply[f.field] = String(v);
    else if (f.field === 'skill') apply.skills.push(String(v));
    else if (f.field === 'experience') {
      const start = parseResumeDate(v.startDate);

      if (start) {
        apply.experiences.push({
          company: String(v.company),
          title: String(v.title),
          startDate: start,
          endDate: v.current ? null : parseResumeDate(v.endDate, true),
          current: !!v.current,
          description: v.description ?? null,
        });
      }
    } else if (f.field === 'education') apply.educations.push(v);
    else if (f.field === 'certification') apply.certifications.push(v);
  }

  await prisma.$transaction(async (tx) => {
    const profile = await tx.candidateProfile.findUniqueOrThrow({
      where: { id: resume.profileId },
      include: { skills: true },
    });

    // what the candidate confirms is applied even where the profile already has a value
    await tx.candidateProfile.update({
      where: { id: profile.id },
      data: {
        ...(apply.headline ? { headline: apply.headline } : {}),
        ...(apply.summary ? { summary: apply.summary } : {}),
        ...(apply.location ? { location: apply.location } : {}),
      },
    });

    const have = new Set(profile.skills.map((s) => s.skill.toLowerCase()));
    const skills = Array.from(
      new Set(apply.skills.filter((s) => !have.has(s.toLowerCase())))
    );

    await tx.candidateSkill.createMany({
      data: skills.map((skill) => ({ profileId: profile.id, skill })),
      skipDuplicates: true,
    });
    await tx.candidateExperience.createMany({
      data: apply.experiences.map((e) => ({ profileId: profile.id, ...e })),
    });
    await tx.candidateEducation.createMany({
      data: apply.educations.map((e) => ({
        profileId: profile.id,
        institution: e.institution,
        degree: e.degree,
        field: e.field ?? null,
        startYear: e.startYear ?? null,
        endYear: e.endYear ?? null,
      })),
    });
    await tx.candidateCertification.createMany({
      data: apply.certifications.map((c) => ({
        profileId: profile.id,
        name: c.name,
        issuer: c.issuer ?? null,
        year: c.year ?? null,
      })),
    });

    if (confirmedIds.length) {
      await tx.parsedField.updateMany({
        where: { id: { in: confirmedIds }, resumeId },
        data: { confirmedAt: new Date() },
      });
    }

    const rejectIds = resume.parsedFields
      .filter((f) => input.reject.includes(f.id) && !f.confirmedAt)
      .map((f) => f.id);

    if (rejectIds.length) {
      await tx.parsedField.deleteMany({
        where: { id: { in: rejectIds }, resumeId },
      });
    }

    const left = await tx.parsedField.count({
      where: { resumeId, confirmedAt: null },
    });

    await tx.candidateResume.update({
      where: { id: resumeId },
      data: { parseStatus: left ? 'NEEDS_REVIEW' : 'PARSED' },
    });
  });

  await refreshCompleteness(resume.profileId);
  await enqueue('embed.profile', { userId });

  return getParsedForReview(userId, resumeId);
}
