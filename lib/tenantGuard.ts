import { Prisma } from '@prisma/client';

/**
 * Models whose rows belong to a tenant. Every query on them must be filtered
 * by `teamId` (or, for creates, carry it in `data`). `PortalRole.teamId` is
 * nullable (null = system template) but must still be stated explicitly.
 */
export const TENANT_MODELS = new Set<string>([
  'PortalProfile',
  'PortalBranding',
  'PortalRole',
  'Job',
  'JobSkill',
  'JobLocation',
  'JobAssignment',
  'ScreeningQuestion',
  'PipelineStage',
  'TenantCandidate',
  'JobApplication',
  'ApplicationActivity',
  'CandidateConsent',
  'CandidateNote',
  'CandidateTag',
  'CandidateTagLink',
  'TalentPool',
  'TalentPoolMember',
  'Interview',
  'InterviewParticipant',
  'InterviewFeedback',
  'InterviewReminder',
  'Offer',
  'OfferApproval',
  'MessageDraft',
  'AutomationRule',
  'MatchAssessment',
  // teamId may be null (platform level) but must always be stated
  'AIUsage',
  'AIRequestLog',
  'AIProviderConfig',
]);

/** Rows that may be created but never changed or removed by the app. */
export const APPEND_ONLY_MODELS = new Set<string>(['ApplicationActivity']);

const MUTATING_OPERATIONS = new Set([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
  'count',
  'aggregate',
  'groupBy',
]);

const hasTeamFilter = (where: unknown): boolean => {
  if (!where || typeof where !== 'object') {
    return false;
  }

  return Object.entries(where as Record<string, unknown>).some(
    ([key, value]) => {
      if (
        (key === 'teamId' || key.startsWith('teamId_')) &&
        value !== undefined
      ) {
        return true;
      }

      if (key === 'AND') {
        return Array.isArray(value)
          ? value.some(hasTeamFilter)
          : hasTeamFilter(value);
      }

      return false;
    }
  );
};

const hasTeamInData = (data: unknown): boolean => {
  const rows = Array.isArray(data) ? data : [data];

  return rows.every(
    (row) =>
      row &&
      typeof row === 'object' &&
      ((row as Record<string, unknown>).teamId !== undefined ||
        // nested connect form: team: { connect: { id } }
        (row as Record<string, unknown>).team !== undefined)
  );
};

export class TenantGuardError extends Error {}

export function assertTenantScoped(
  model: string,
  operation: string,
  args: any
): string | null {
  if (!TENANT_MODELS.has(model)) {
    return null;
  }

  if (APPEND_ONLY_MODELS.has(model) && MUTATING_OPERATIONS.has(operation)) {
    return `Tenant guard: ${model} is append-only; ${operation} is not allowed.`;
  }

  if (WHERE_OPERATIONS.has(operation)) {
    if (!hasTeamFilter(args?.where)) {
      return `Tenant guard: ${model}.${operation} must filter by teamId.`;
    }

    if (operation === 'upsert' && !hasTeamInData(args?.create)) {
      return `Tenant guard: ${model}.upsert create must include teamId.`;
    }

    return null;
  }

  if (operation === 'create' || operation === 'createMany') {
    if (!hasTeamInData(args?.data)) {
      return `Tenant guard: ${model}.${operation} must include teamId in data.`;
    }
  }

  return null;
}

/**
 * Prisma client extension that refuses tenant-model queries without a
 * `teamId` filter. Throws in development and test; logs in production.
 */
export const tenantGuard = Prisma.defineExtension({
  name: 'tenantGuard',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const problem = assertTenantScoped(model, operation, args);

        if (problem) {
          if (problem.includes('append-only')) {
            throw new TenantGuardError(problem);
          }

          if (process.env.NODE_ENV === 'production') {
            console.error(problem);
          } else {
            throw new TenantGuardError(problem);
          }
        }

        return query(args);
      },
    },
  },
});
