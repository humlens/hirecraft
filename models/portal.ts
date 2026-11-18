import {
  Prisma,
  Role,
  type PortalBranding,
  type PortalProfile,
} from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { PERMISSIONS, RESERVED_SLUGS, SYSTEM_ROLES } from '@/lib/portal-roles';
import { DEFAULT_STAGES } from '@/lib/pipeline';

type Tx = Prisma.TransactionClient;

/** Ensures every permission key from the catalogue exists. Idempotent. */
export async function ensurePermissions(tx: Tx) {
  await tx.permission.createMany({
    data: PERMISSIONS.map((p) => ({ ...p })),
    skipDuplicates: true,
  });

  const rows = await tx.permission.findMany({
    select: { id: true, key: true },
  });

  return new Map(rows.map((r) => [r.key, r.id]));
}

/**
 * Copies the system role templates into a portal (only the missing ones).
 * Used on portal creation and lazily for portals that predate portal roles.
 */
export async function syncSystemRoles(tx: Tx, teamId: string) {
  const permissionIds = await ensurePermissions(tx);

  const existing = await tx.portalRole.findMany({
    where: { teamId, isSystem: true },
    select: { id: true, key: true },
  });
  const byKey = new Map(existing.map((r) => [r.key, r.id]));

  for (const def of SYSTEM_ROLES) {
    if (byKey.has(def.key)) {
      continue;
    }

    const role = await tx.portalRole.create({
      data: {
        teamId,
        key: def.key,
        name: def.name,
        description: def.description,
        baseRole: def.baseRole,
        isSystem: true,
        isOwnerRole: def.isOwnerRole,
        permissions: {
          create: def.permissions.map((key) => ({
            permissionId: permissionIds.get(key) as string,
          })),
        },
      },
    });

    byKey.set(def.key, role.id);
  }

  return byKey;
}

/** Creates the portal's default pipeline stages if it has none. Idempotent. */
export async function ensureDefaultStages(tx: Tx, teamId: string) {
  const existing = await tx.pipelineStage.count({
    where: { teamId, jobId: null },
  });

  if (existing > 0) {
    return;
  }

  await tx.pipelineStage.createMany({
    data: DEFAULT_STAGES.map((s, i) => ({
      teamId,
      jobId: null,
      name: s.name,
      kind: s.kind,
      order: i,
    })),
  });
}

export type PortalProfileInput = {
  companyName?: string;
  description?: string | null;
  website?: string | null;
  contactEmail?: string | null;
  industry?: string | null;
};

export type PortalBrandingInput = {
  primaryColor?: string;
  theme?: 'LIGHT' | 'DARK' | 'SYSTEM';
  heroTitle?: string | null;
  heroSubtitle?: string | null;
  aboutHtml?: string | null;
  privacyPolicyHtml?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

const ALLOWED_HTML: sanitizeHtml.IOptions = {
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

export const sanitizePortalHtml = (html: string | null | undefined) =>
  html ? sanitizeHtml(html, ALLOWED_HTML) : (html ?? null);

export const assertSlugAvailableForPortal = (slug: string) => {
  if (RESERVED_SLUGS.has(slug)) {
    throw new ApiError(400, 'This slug is reserved. Please choose another.');
  }
};

/**
 * Creates a portal (Team) with its profile, branding, role copies and the
 * owner membership in ONE transaction.
 */
export async function createPortal(params: {
  userId: string;
  name: string;
  slug: string;
  profile?: PortalProfileInput;
  branding?: PortalBrandingInput;
  completeOnboarding?: boolean;
}) {
  const { userId, name, slug, profile, branding } = params;

  assertSlugAvailableForPortal(slug);

  try {
    return await prisma.$transaction(async (tx) => {
      const team = await tx.team.create({ data: { name, slug } });

      const roleIds = await syncSystemRoles(tx, team.id);
      await ensureDefaultStages(tx, team.id);

      await tx.teamMember.create({
        data: {
          teamId: team.id,
          userId,
          role: Role.OWNER,
          portalRoleId: roleIds.get('portal_owner') as string,
        },
      });

      await tx.portalProfile.create({
        data: {
          teamId: team.id,
          companyName: profile?.companyName || name,
          description: profile?.description ?? null,
          website: profile?.website ?? null,
          contactEmail: profile?.contactEmail ?? null,
          industry: profile?.industry ?? null,
          onboardingCompletedAt: params.completeOnboarding ? new Date() : null,
        },
      });

      await tx.portalBranding.create({
        data: {
          teamId: team.id,
          ...branding,
          aboutHtml: sanitizePortalHtml(branding?.aboutHtml),
          privacyPolicyHtml: sanitizePortalHtml(branding?.privacyPolicyHtml),
        },
      });

      return team;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ApiError(400, 'A team with the slug already exists.');
    }

    throw error;
  }
}

export async function getPortal(teamId: string) {
  const [profile, branding] = await Promise.all([
    prisma.portalProfile.findUnique({ where: { teamId } }),
    prisma.portalBranding.findUnique({ where: { teamId } }),
  ]);

  return { profile, branding };
}

export async function updatePortal(
  teamId: string,
  teamName: string,
  data: { profile?: PortalProfileInput; branding?: PortalBrandingInput }
) {
  return await prisma.$transaction(async (tx) => {
    let profile: PortalProfile | null = null;
    let branding: PortalBranding | null = null;

    if (data.profile) {
      const { companyName, ...rest } = data.profile;

      profile = await tx.portalProfile.upsert({
        where: { teamId },
        create: { teamId, companyName: companyName || teamName, ...rest },
        update: { ...(companyName ? { companyName } : {}), ...rest },
      });
    }

    if (data.branding) {
      const clean = {
        ...data.branding,
        ...(data.branding.aboutHtml !== undefined && {
          aboutHtml: sanitizePortalHtml(data.branding.aboutHtml),
        }),
        ...(data.branding.privacyPolicyHtml !== undefined && {
          privacyPolicyHtml: sanitizePortalHtml(
            data.branding.privacyPolicyHtml
          ),
        }),
      };

      branding = await tx.portalBranding.upsert({
        where: { teamId },
        create: { teamId, ...clean },
        update: clean,
      });
    }

    return { profile, branding };
  });
}
