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
