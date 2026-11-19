import { z } from 'zod';
import { slugify } from '../server-common';
import { isPermissionKey } from '../portal-roles';
import {
  teamName,
  apiKeyId,
  slug,
  domain,
  email,
  password,
  token,
  role,
  sentViaEmail,
  domains,
  expiredToken,
  sessionId,
  recaptchaToken,
  priceId,
  quantity,
  memberId,
  inviteToken,
  url,
  endpointId,
  sentViaEmailString,
  invitationId,
  name,
  image,
  eventTypes,
} from './primitives';

export const createApiKeySchema = z.object({
  name: name(50),
});

export const deleteApiKeySchema = z.object({
  apiKeyId,
});

export const teamSlugSchema = z.object({
  slug,
});

export const updateTeamSchema = z.object({
  name: teamName,
  slug: slug.transform((slug) => slugify(slug)),
  domain,
});

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim() || null)
    .nullable()
    .optional();

export const portalProfileSchema = z.object({
  companyName: z.string().trim().min(1).max(100).optional(),
  description: optionalText(2000),
  website: z
    .string()
    .max(300)
    .url('Enter a valid URL')
    .refine((v) => /^https?:\/\//i.test(v), 'Website must be http(s)')
    .or(z.literal(''))
    .transform((v) => v || null)
    .nullable()
    .optional(),
  contactEmail: email
    .or(z.literal(''))
    .transform((v) => v || null)
    .nullable()
    .optional(),
  industry: optionalText(100),
});

export const portalBrandingSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #3346D3')
    .optional(),
  theme: z.enum(['LIGHT', 'DARK', 'SYSTEM']).optional(),
  heroTitle: optionalText(120),
  heroSubtitle: optionalText(300),
  aboutHtml: z.string().max(20000).nullable().optional(),
  privacyPolicyHtml: z.string().max(50000).nullable().optional(),
  seoTitle: optionalText(70),
  seoDescription: optionalText(160),
});

export const updatePortalSchema = z
  .object({
    profile: portalProfileSchema.optional(),
    branding: portalBrandingSchema.optional(),
  })
  .refine((v) => v.profile || v.branding, 'Nothing to update');

export const createTeamSchema = z.object({
  name: teamName,
  slug: slug.transform((v) => slugify(v)).optional(),
  profile: portalProfileSchema.optional(),
  branding: portalBrandingSchema.optional(),
  completeOnboarding: z.boolean().optional(),
});

const permissionKeys = z
  .array(z.string().max(64))
  .max(100)
  .refine(
    (keys) => keys.every(isPermissionKey),
    'One or more permission keys are invalid'
  );

export const createPortalRoleSchema = z.object({
  name: z.string().trim().min(2).max(50),
  description: z.string().trim().max(200).optional(),
  baseRole: z.enum(['MEMBER', 'ADMIN']).default('MEMBER'),
  permissions: permissionKeys,
});

export const updatePortalRoleSchema = createPortalRoleSchema.partial();

export const portalRoleIdSchema = z.object({
  roleId: z.string().min(1).max(64),
});

export const updateAccountSchema = z.union([
  z.object({
    email,
  }),
  z.object({
    name: name(),
  }),
  z.object({
    image,
  }),
]);

export const updatePasswordSchema = z.object({
  currentPassword: password,
  newPassword: password,
});

export const userJoinSchema = z.union([
  z.object({
    team: teamName,
    slug,
  }),
  z.object({
    name: name(),
    email,
    password,
  }),
]);

export const resetPasswordSchema = z.object({
  password,
  token,
});

const portalRoleId = z.string().min(1).max(64).optional();

export const inviteViaEmailSchema = z.union([
  z.object({
    email,
    role: role.optional(),
    portalRoleId,
    sentViaEmail,
  }),
  z.object({
    role: role.optional(),
    portalRoleId,
    sentViaEmail,
    domains,
  }),
]);

export const resendLinkRequestSchema = z.object({
  email,
  expiredToken,
});

export const deleteSessionSchema = z.object({
  id: sessionId,
});

export const forgotPasswordSchema = z.object({
  email,
  recaptchaToken: recaptchaToken.optional(),
});

export const resendEmailToken = z.object({
  email,
});

export const checkoutSessionSchema = z.object({
  price: priceId,
  quantity: quantity.optional(),
});

export const updateMemberSchema = z
  .object({
    role: role.optional(),
    portalRoleId: z.string().min(1).max(64).nullable().optional(),
    memberId,
  })
  .refine(
    (v) => v.role !== undefined || v.portalRoleId !== undefined,
    'A role is required'
  );

export const acceptInvitationSchema = z.object({
  inviteToken,
});

export const getInvitationSchema = z.object({
  token: inviteToken,
});

export const webhookEndpointSchema = z.object({
  name: name(),
  url,
  eventTypes,
});

export const updateWebhookEndpointSchema = webhookEndpointSchema.extend({
  endpointId,
});

export const getInvitationsSchema = z.object({
  sentViaEmail: sentViaEmailString,
});

export const deleteInvitationSchema = z.object({
  id: invitationId,
});

export const getWebhookSchema = z.object({
  endpointId,
});

export const deleteWebhookSchema = z.object({
  webhookId: endpointId,
});

export const deleteMemberSchema = z.object({
  memberId,
});

// email or slug
export const ssoVerifySchema = z
  .object({
    email: email.optional().or(z.literal('')),
    slug: slug.optional().or(z.literal('')),
  })
  .refine((data) => data.email || data.slug, {
    message: 'At least one of email or slug is required',
  });

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

const optStr = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

const optInt = (min: number, max: number) =>
  z.number().int().min(min).max(max).nullable().optional();

export const jobQuestionSchema = z
  .object({
    type: z.enum(['TEXT', 'SINGLE', 'MULTI', 'NUMBER', 'BOOLEAN']),
    prompt: z.string().trim().min(3).max(300),
    options: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    required: z.boolean().default(false),
  })
  .refine(
    (q) =>
      !['SINGLE', 'MULTI'].includes(q.type) || new Set(q.options).size >= 2,
    'Choice questions need at least two distinct options'
  );

const jobBase = z.object({
  title: z.string().trim().min(3).max(120),
  descriptionHtml: z.string().max(50000).default(''),
  responsibilities: z
    .array(z.string().trim().min(1).max(300))
    .max(20)
    .default([]),
  visibility: z.enum(['PUBLIC', 'UNLISTED', 'INTERNAL']).default('PUBLIC'),
  employmentType: z
    .enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY'])
    .default('FULL_TIME'),
  workMode: z.enum(['REMOTE', 'HYBRID', 'ONSITE']).default('ONSITE'),
  experienceMin: optInt(0, 60),
  experienceMax: optInt(0, 60),
  salaryMin: optInt(0, 1_000_000_000),
  salaryMax: optInt(0, 1_000_000_000),
  salaryCurrency: z.string().trim().length(3).toUpperCase().default('INR'),
  salaryVisible: z.boolean().default(false),
  department: optStr(100),
  industry: optStr(100),
  education: optStr(100),
  vacancies: z.number().int().min(1).max(1000).default(1),
  benefits: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  companyInfoOverride: optStr(5000),
  closesAt: z.string().datetime().nullable().optional(),
  skills: z
    .array(
      z.object({
        skill: z.string().trim().min(1).max(60),
        required: z.boolean().default(true),
      })
    )
    .max(50)
    .default([]),
  locations: z
    .array(
      z.object({
        city: optStr(100),
        region: optStr(100),
        country: optStr(100),
      })
    )
    .max(10)
    .default([]),
  questions: z.array(jobQuestionSchema).max(20).default([]),
});

const jobRanges = (
  v: Partial<{
    experienceMin: number | null;
    experienceMax: number | null;
    salaryMin: number | null;
    salaryMax: number | null;
  }>
) =>
  (v.experienceMin == null ||
    v.experienceMax == null ||
    v.experienceMin <= v.experienceMax) &&
  (v.salaryMin == null || v.salaryMax == null || v.salaryMin <= v.salaryMax);

export const createJobSchema = jobBase.refine(
  jobRanges,
  'Minimum cannot exceed maximum'
);

export const updateJobSchema = jobBase
  .partial()
  .refine(jobRanges, 'Minimum cannot exceed maximum');

export const jobIdSchema = z.object({ jobId: z.string().min(1).max(64) });

export const listJobsSchema = z.object({
  status: z
    .enum(['DRAFT', 'SCHEDULED', 'PUBLISHED', 'CLOSED', 'ARCHIVED'])
    .optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const jobActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('publish') }),
  z.object({ action: z.literal('schedule'), publishAt: z.string().datetime() }),
  z.object({ action: z.literal('close') }),
  z.object({ action: z.literal('reopen') }),
  z.object({ action: z.literal('archive') }),
  z.object({ action: z.literal('duplicate') }),
]);

export const jobAssignmentsSchema = z.object({
  assignments: z
    .array(
      z.object({
        userId: z.string().min(1).max(64),
        kind: z.enum(['RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER']),
      })
    )
    .max(50),
});

// ---------------------------------------------------------------------------
// Applications and candidates
// ---------------------------------------------------------------------------

export const applicationIdSchema = z.object({
  applicationId: z.string().min(1).max(64),
});

export const moveStageSchema = z.object({
  stageId: z.string().min(1).max(64),
  rejectionReason: z.string().trim().max(500).optional(),
});

export const bulkMoveStageSchema = moveStageSchema.extend({
  applicationIds: z.array(z.string().min(1).max(64)).min(1).max(100),
});

export const candidateRegisterSchema = z.object({
  name: name(),
  email,
  password,
});

export const applySchema = z.object({
  resumeId: z.string().min(1).max(64),
  answers: z
    .record(
      z.string().max(64),
      z.union([
        z.string().max(5000),
        z.number(),
        z.boolean(),
        z.array(z.string().max(200)).max(20),
      ])
    )
    .default({}),
  consent: z.object({
    application: z.literal(true, {
      errorMap: () => ({
        message:
          'You must consent to the application being shared with the employer',
      }),
    }),
    talentPool: z.boolean().default(false),
    aiRecommendations: z.boolean().default(false),
  }),
});

export const candidateProfileSchema = z.object({
  headline: optStr(150),
  summary: optStr(3000),
  phone: optStr(30),
  location: optStr(120),
  preferredLocations: z
    .array(z.string().trim().min(1).max(100))
    .max(20)
    .optional(),
  expectedSalary: optInt(0, 1_000_000_000),
  noticePeriodDays: optInt(0, 365),
  employmentStatus: optStr(60),
  linkedinUrl: optStr(300),
  githubUrl: optStr(300),
  portfolioUrl: optStr(300),
  skills: z.array(z.string().trim().min(1).max(60)).max(60).optional(),
  experiences: z
    .array(
      z.object({
        company: z.string().trim().min(1).max(120),
        title: z.string().trim().min(1).max(120),
        startDate: z.string().date(),
        endDate: z.string().date().nullable().optional(),
        current: z.boolean().default(false),
        description: optStr(3000),
      })
    )
    .max(30)
    .optional(),
  educations: z
    .array(
      z.object({
        institution: z.string().trim().min(1).max(120),
        degree: z.string().trim().min(1).max(120),
        field: optStr(120),
        startYear: optInt(1950, 2100),
        endYear: optInt(1950, 2100),
      })
    )
    .max(15)
    .optional(),
  certifications: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        issuer: optStr(120),
        year: optInt(1950, 2100),
      })
    )
    .max(20)
    .optional(),
});

export const savedJobSchema = z.object({ jobId: z.string().min(1).max(64) });

// ---------------------------------------------------------------------------
// Phase 3
// ---------------------------------------------------------------------------

const id64 = z.string().min(1).max(64);

export const listCandidatesSchema = z.object({
  q: z.string().trim().max(100).optional(),
  tagId: id64.optional(),
  poolId: id64.optional(),
  source: z.string().trim().max(30).optional(),
  cursor: id64.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const candidateIdSchema = z.object({ candidateId: id64 });
export const noteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
});
export const setTagsSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
});
export const poolSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
});
export const poolMemberSchema = z.object({
  candidateId: id64,
  member: z.boolean(),
});
export const importSchema = z.object({
  csv: z
    .string()
    .min(1)
    .max(1024 * 1024),
  poolId: id64.optional(),
});
export const mergeSchema = z.object({ sourceId: id64, targetId: id64 });

const isoDate = z.string().datetime();

export const scheduleInterviewSchema = z.object({
  startsAt: isoDate.transform((v) => new Date(v)),
  durationMin: z.number().int().min(10).max(480).default(45),
  location: z.string().trim().max(200).nullable().optional(),
  meetingUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), 'Meeting link must be http(s)')
    .nullable()
    .optional(),
  participantIds: z.array(id64).min(1).max(10),
});

export const updateInterviewSchema = z.object({
  startsAt: isoDate.transform((v) => new Date(v)).optional(),
  durationMin: z.number().int().min(10).max(480).optional(),
  location: z.string().trim().max(200).nullable().optional(),
  meetingUrl: z
    .string()
    .trim()
    .url()
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), 'Meeting link must be http(s)')
    .nullable()
    .optional(),
  participantIds: z.array(id64).min(1).max(10).optional(),
  status: z.enum(['CANCELLED', 'COMPLETED', 'NO_SHOW']).optional(),
});

export const interviewIdSchema = z.object({ interviewId: id64 });

export const listInterviewsSchema = z.object({
  from: isoDate.transform((v) => new Date(v)).optional(),
  to: isoDate.transform((v) => new Date(v)).optional(),
  status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']).optional(),
});

export const feedbackSchema = z.object({
  scores: z
    .record(z.string().trim().min(1).max(60), z.number().int().min(1).max(4))
    .refine(
      (s) => Object.keys(s).length >= 1 && Object.keys(s).length <= 20,
      'Score 1 to 20 competencies'
    ),
  recommendation: z.enum(['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE']),
  notes: z.string().trim().max(5000).nullable().optional(),
});

const money = z.number().int().min(0).max(10_000_000_000);

const offerFields = {
  fixed: money,
  variable: money.optional(),
  joiningBonus: money.optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  equityNote: z.string().trim().max(300).nullable().optional(),
  startDate: isoDate
    .transform((v) => new Date(v))
    .nullable()
    .optional(),
  expiresAt: isoDate
    .transform((v) => new Date(v))
    .nullable()
    .optional(),
  terms: z.string().trim().max(5000).nullable().optional(),
  templateKey: z
    .enum(['india-full-time-v4', 'india-contract-v2', 'global-full-time-v1'])
    .nullable()
    .optional(),
};

export const createOfferSchema = z.object({
  applicationId: id64,
  ...offerFields,
});
export const updateOfferSchema = z.object(offerFields).partial();
export const offerIdSchema = z.object({ offerId: id64 });
export const offerActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('submit'),
    approverIds: z.array(id64).min(1).max(5),
  }),
  z.object({
    action: z.literal('approve'),
    comment: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal('reject'),
    comment: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal('send') }),
]);
export const respondOfferSchema = z.object({ accept: z.boolean() });

export const createMessageSchema = z.object({
  applicationId: id64,
  kind: z.enum([
    'INTERVIEW_INVITE',
    'REJECTION',
    'OFFER',
    'STATUS_UPDATE',
    'CUSTOM',
  ]),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
});
export const updateMessageSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10000),
  })
  .partial();
export const messageIdSchema = z.object({ messageId: id64 });
export const messageActionSchema = z.object({
  action: z.enum(['approve', 'send', 'discard']),
});
export const listMessagesSchema = z.object({
  status: z.enum(['DRAFT', 'APPROVED', 'SENT', 'DISCARDED']).optional(),
  applicationId: id64.optional(),
});

export const analyticsQuerySchema = z.object({
  from: isoDate.transform((v) => new Date(v)).optional(),
  to: isoDate.transform((v) => new Date(v)).optional(),
  jobId: id64.optional(),
  recruiterId: id64.optional(),
});

export const createStageSchema = z.object({
  name: z.string().trim().min(2).max(40),
  jobId: id64.optional(),
  afterStageId: id64.optional(),
});
export const renameStageSchema = z.object({
  name: z.string().trim().min(2).max(40),
});
export const reorderStagesSchema = z.object({
  orderedIds: z.array(id64).min(1).max(40),
  jobId: id64.optional(),
});
export const stageIdSchema = z.object({ stageId: id64 });
export const stagesQuerySchema = z.object({ jobId: id64.optional() });
export const ruleIdSchema = z.object({ ruleId: id64 });

export const notificationsQuerySchema = z.object({
  unread: z.enum(['1', 'true']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: id64.optional(),
});
export const markReadSchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ ids: z.array(id64).min(1).max(100) }),
]);
export const preferencesSchema = z.object({
  preferences: z
    .array(
      z.object({
        type: z.string().min(1).max(60),
        inApp: z.boolean(),
        email: z.boolean(),
        push: z.boolean().optional(),
      })
    )
    .max(40),
});
