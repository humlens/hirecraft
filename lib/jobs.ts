import type { Job, JobStatus, Prisma } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';

/** HTML allowed in job descriptions (sanitised on write and on render). */
export const JOB_HTML: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'strong',
    'b',
    'em',
    'i',
    'u',
    'ul',
    'ol',
    'li',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'a',
    'hr',
  ],
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'noopener noreferrer nofollow',
    }),
  },
};

export const sanitizeJobHtml = (html: string) => sanitizeHtml(html, JOB_HTML);

export const stripHtml = (html: string) =>
  sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Status as visitors see it. Scheduled publishing and closing dates are
 * evaluated lazily at read time; a background worker (Phase 3+) will
 * materialise them.
 */
export function effectiveJobStatus(
  job: Pick<Job, 'status' | 'publishAt' | 'closesAt'>,
  now = new Date()
): JobStatus {
  let status = job.status;

  if (status === 'SCHEDULED' && job.publishAt && job.publishAt <= now) {
    status = 'PUBLISHED';
  }

  if (status === 'PUBLISHED' && job.closesAt && job.closesAt <= now) {
    status = 'CLOSED';
  }

  return status;
}

/** Prisma filter for jobs that are open to the public right now. */
export function openJobWhere(now = new Date()): Prisma.JobWhereInput {
  return {
    deletedAt: null,
    AND: [
      {
        OR: [
          { status: 'PUBLISHED' },
          { status: 'SCHEDULED', publishAt: { lte: now } },
        ],
      },
      { OR: [{ closesAt: null }, { closesAt: { gt: now } }] },
    ],
  };
}

export function isPublishable(job: {
  title: string;
  descriptionHtml: string;
  workMode: string;
  locations: unknown[];
}): string | null {
  if (job.title.trim().length < 3) {
    return 'A title is required to publish.';
  }

  if (stripHtml(job.descriptionHtml).length < 30) {
    return 'Add a job description (at least 30 characters) before publishing.';
  }

  if (job.workMode !== 'REMOTE' && job.locations.length === 0) {
    return 'Add at least one location (or mark the job as remote) before publishing.';
  }

  return null;
}

const EMPLOYMENT_TYPE_LD: Record<string, string> = {
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  CONTRACT: 'CONTRACTOR',
  INTERNSHIP: 'INTERN',
  TEMPORARY: 'TEMPORARY',
};

/** schema.org JobPosting for search engines (Google for Jobs). */
export function jobPostingJsonLd(args: {
  job: Pick<
    Job,
    | 'title'
    | 'descriptionHtml'
    | 'employmentType'
    | 'workMode'
    | 'salaryMin'
    | 'salaryMax'
    | 'salaryCurrency'
    | 'salaryVisible'
    | 'publishedAt'
    | 'publishAt'
    | 'createdAt'
    | 'closesAt'
  > & {
    locations: {
      city: string | null;
      region: string | null;
      country: string | null;
    }[];
  };
  company: { name: string; website?: string | null };
  url: string;
}) {
  const { job, company } = args;
  const posted = job.publishedAt ?? job.publishAt ?? job.createdAt;

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: job.title,
    description: sanitizeJobHtml(job.descriptionHtml),
    datePosted: posted.toISOString(),
    employmentType: EMPLOYMENT_TYPE_LD[job.employmentType],
    hiringOrganization: {
      '@type': 'Organization',
      name: company.name,
      ...(company.website ? { sameAs: company.website } : {}),
    },
    url: args.url,
  };

  if (job.closesAt) {
    ld.validThrough = job.closesAt.toISOString();
  }

  if (job.workMode === 'REMOTE') {
    ld.jobLocationType = 'TELECOMMUTE';
  }

  if (job.locations.length) {
    ld.jobLocation = job.locations.map((l) => ({
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        addressLocality: l.city ?? undefined,
        addressRegion: l.region ?? undefined,
        addressCountry: l.country ?? undefined,
      },
    }));
  }

  if (job.salaryVisible && (job.salaryMin != null || job.salaryMax != null)) {
    ld.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.salaryCurrency,
      value: {
        '@type': 'QuantitativeValue',
        minValue: job.salaryMin ?? undefined,
        maxValue: job.salaryMax ?? undefined,
        unitText: 'YEAR',
      },
    };
  }

  return ld;
}

/** JSON for an inline <script>: `<` is escaped so content cannot close it. */
export const safeJsonForScript = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));
