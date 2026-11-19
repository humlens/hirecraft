import { z } from 'zod';
import type { Tier } from './types';

const conf = z.number().min(0).max(1);
const str = (max: number) => z.string().trim().max(max);

export const parsedResumeSchema = z.object({
  headline: z
    .object({ value: str(150), confidence: conf })
    .nullable()
    .optional(),
  summary: z
    .object({ value: str(3000), confidence: conf })
    .nullable()
    .optional(),
  phone: z
    .object({ value: str(30), confidence: conf })
    .nullable()
    .optional(),
  location: z
    .object({ value: str(120), confidence: conf })
    .nullable()
    .optional(),
  skills: z
    .array(z.object({ value: str(60), confidence: conf }))
    .max(80)
    .default([]),
  experiences: z
    .array(
      z.object({
        company: str(120),
        title: str(120),
        // explicit dates only, as written in the resume (YYYY-MM or YYYY)
        startDate: str(20).nullable().optional(),
        endDate: str(20).nullable().optional(),
        current: z.boolean().default(false),
        description: str(3000).nullable().optional(),
        confidence: conf,
      })
    )
    .max(30)
    .default([]),
  educations: z
    .array(
      z.object({
        institution: str(120),
        degree: str(120),
        field: str(120).nullable().optional(),
        startYear: z.number().int().min(1950).max(2100).nullable().optional(),
        endYear: z.number().int().min(1950).max(2100).nullable().optional(),
        confidence: conf,
      })
    )
    .max(15)
    .default([]),
  certifications: z
    .array(
      z.object({
        name: str(120),
        issuer: str(120).nullable().optional(),
        year: z.number().int().min(1950).max(2100).nullable().optional(),
        confidence: conf,
      })
    )
    .max(20)
    .default([]),
});
export type ParsedResume = z.infer<typeof parsedResumeSchema>;

export const jdSchema = z.object({
  overview: str(2000),
  responsibilities: z.array(str(300)).min(1).max(15),
  requirements: z.array(str(300)).min(1).max(15),
  niceToHave: z.array(str(300)).max(10).default([]),
  benefits: z.array(str(200)).max(10).default([]),
});
export type JobDescription = z.infer<typeof jdSchema>;

export const matchSchema = z.object({
  technicalDepth: z.object({
    score: z.number().min(0).max(100),
    rationale: str(600),
  }),
  evidence: z
    .array(z.object({ claim: str(300), quote: str(400) }))
    .max(8)
    .default([]),
  explanation: str(1500),
  suggestedQuestions: z.array(str(300)).max(6).default([]),
});
export type MatchLLM = z.infer<typeof matchSchema>;

export const searchFiltersSchema = z.object({
  skills: z.array(str(60)).max(15).default([]),
  keywords: z.array(str(60)).max(15).default([]),
  location: str(100).nullable().default(null),
  minYears: z.number().min(0).max(60).nullable().default(null),
  maxYears: z.number().min(0).max(60).nullable().default(null),
  workMode: z.enum(['REMOTE', 'HYBRID', 'ONSITE']).nullable().default(null),
});
export type SearchFilters = z.infer<typeof searchFiltersSchema>;

export const interviewQuestionsSchema = z.object({
  competencies: z
    .array(
      z.object({
        name: str(80),
        questions: z
          .array(z.object({ question: str(400), whatToLookFor: str(400) }))
          .min(1)
          .max(5),
      })
    )
    .min(1)
    .max(8),
  evaluationTemplate: z
    .array(
      z.object({
        competency: str(80),
        indicators: z.array(str(200)).min(1).max(6),
      })
    )
    .max(8)
    .default([]),
});

export const feedbackSummarySchema = z.object({
  summary: str(2000),
  strengths: z
    .array(
      z.object({ point: str(300), quote: str(400).nullable().default(null) })
    )
    .max(8)
    .default([]),
  concerns: z
    .array(
      z.object({ point: str(300), quote: str(400).nullable().default(null) })
    )
    .max(8)
    .default([]),
  consensus: str(400),
});

export const commsSchema = z.object({ subject: str(200), body: str(6000) });

export const copilotStepSchema = z.union([
  z.object({
    type: z.literal('tool_call'),
    tool: str(60),
    args: z.record(z.string(), z.unknown()).default({}),
  }),
  z.object({ type: z.literal('final'), answer: str(8000) }),
]);
export type CopilotStep = z.infer<typeof copilotStepSchema>;

export type InterviewQuestions = z.infer<typeof interviewQuestionsSchema>;
export type FeedbackSummary = z.infer<typeof feedbackSummarySchema>;
export type CommsDraft = z.infer<typeof commsSchema>;

export type FeatureKey =
  | 'resume.parse'
  | 'jd.generate'
  | 'match.assess'
  | 'search.parse'
  | 'interview.questions'
  | 'interview.summary'
  | 'comms.draft'
  | 'copilot.step';

export type FeatureOutputs = {
  'resume.parse': ParsedResume;
  'jd.generate': JobDescription;
  'match.assess': MatchLLM;
  'search.parse': SearchFilters;
  'interview.questions': InterviewQuestions;
  'interview.summary': FeedbackSummary;
  'comms.draft': CommsDraft;
  'copilot.step': CopilotStep;
};

export type FeatureDef<T = unknown> = {
  key: string;
  /** The schema the model reply must satisfy */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  tier: Tier;
  /** AI credits charged per successful call (platform key only) */
  credits: number;
  /** Candidate-side features have no portal and no `ai.use` check */
  candidateSide?: boolean;
  label: string;
  /** who may use it, as shown on the AI settings page */
  roles: string;
};

export const FEATURES: { [K in FeatureKey]: FeatureDef<FeatureOutputs[K]> } = {
  'resume.parse': {
    key: 'resume.parse',
    schema: parsedResumeSchema,
    tier: 'standard',
    credits: 5,
    candidateSide: true,
    label: 'Resume parsing',
    roles: 'All',
  },
  'jd.generate': {
    key: 'jd.generate',
    schema: jdSchema,
    tier: 'fast',
    credits: 2,
    label: 'Job description generator',
    roles: 'Recruiter+',
  },
  'match.assess': {
    key: 'match.assess',
    schema: matchSchema,
    tier: 'standard',
    credits: 3,
    label: 'Candidate matching',
    roles: 'Recruiter+',
  },
  'search.parse': {
    key: 'search.parse',
    schema: searchFiltersSchema,
    tier: 'fast',
    credits: 1,
    label: 'Natural-language search',
    roles: 'Recruiter+',
  },
  'interview.questions': {
    key: 'interview.questions',
    schema: interviewQuestionsSchema,
    tier: 'fast',
    credits: 2,
    label: 'Interview assistant',
    roles: 'Hiring Mgr+',
  },
  'interview.summary': {
    key: 'interview.summary',
    schema: feedbackSummarySchema,
    tier: 'standard',
    credits: 2,
    label: 'Feedback summary',
    roles: 'Hiring Mgr+',
  },
  'comms.draft': {
    key: 'comms.draft',
    schema: commsSchema,
    tier: 'fast',
    credits: 2,
    label: 'Candidate communication drafts',
    roles: 'Recruiter+',
  },
  'copilot.step': {
    key: 'copilot.step',
    schema: copilotStepSchema,
    tier: 'standard',
    credits: 1,
    label: 'Copilot',
    roles: 'Recruiter+',
  },
};

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];
