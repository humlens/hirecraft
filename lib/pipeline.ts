import type { StageKind } from '@prisma/client';

/**
 * Default pipeline stages created for every portal.
 * (The build prompt refers to "the 13 default stages from the spec" without
 * listing them; these are the assumed defaults and can be customised per
 * portal/job from Phase 3.)
 */
export const DEFAULT_STAGES: { name: string; kind: StageKind }[] = [
  { name: 'Applied', kind: 'ACTIVE' },
  { name: 'AI Shortlisted', kind: 'ACTIVE' }, // suggestion only; never auto-reject
  { name: 'Screening', kind: 'ACTIVE' },
  { name: 'Recruiter Review', kind: 'ACTIVE' },
  { name: 'Assessment', kind: 'ACTIVE' },
  { name: 'Hiring Manager Review', kind: 'ACTIVE' },
  { name: 'Technical Interview', kind: 'ACTIVE' },
  { name: 'HR Interview', kind: 'ACTIVE' },
  { name: 'Final Interview', kind: 'ACTIVE' },
  { name: 'Offer', kind: 'ACTIVE' },
  { name: 'Hired', kind: 'HIRED' },
  { name: 'Rejected', kind: 'REJECTED' },
  { name: 'Withdrawn', kind: 'WITHDRAWN' },
];
