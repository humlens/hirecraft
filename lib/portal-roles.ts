import { Role } from '@prisma/client';

/**
 * Permission catalogue and system role templates for the job portal domain.
 * This file is the single source of truth; the `Permission` table and the
 * per-portal `PortalRole` copies are synchronised from it.
 */

export const PERMISSIONS = [
  // Portal and team
  { key: 'portal.read', group: 'Portal', description: 'View portal settings' },
  { key: 'portal.update', group: 'Portal', description: 'Edit portal details' },
  {
    key: 'branding.update',
    group: 'Portal',
    description: 'Edit portal branding',
  },
  {
    key: 'domain.manage',
    group: 'Portal',
    description: 'Manage custom domains',
  },
  {
    key: 'members.invite',
    group: 'Team',
    description: 'Invite team members and assign roles',
  },
  { key: 'members.remove', group: 'Team', description: 'Remove team members' },
  {
    key: 'roles.manage',
    group: 'Team',
    description: 'Create and edit custom roles',
  },
  // Jobs
  { key: 'jobs.create', group: 'Jobs', description: 'Create jobs' },
  { key: 'jobs.read', group: 'Jobs', description: 'View jobs' },
  { key: 'jobs.update', group: 'Jobs', description: 'Edit jobs' },
  { key: 'jobs.publish', group: 'Jobs', description: 'Publish and close jobs' },
  { key: 'jobs.delete', group: 'Jobs', description: 'Delete or archive jobs' },
  // Candidates
  {
    key: 'candidates.read',
    group: 'Candidates',
    description: 'View candidate profiles',
  },
  {
    key: 'candidates.search',
    group: 'Candidates',
    description: 'Search the talent database',
  },
  {
    key: 'candidates.update',
    group: 'Candidates',
    description: 'Edit candidates, tags and notes',
  },
  {
    key: 'candidates.import',
    group: 'Candidates',
    description: 'Import candidates',
  },
  {
    key: 'candidates.export',
    group: 'Candidates',
    description: 'Export candidates',
  },
  // Applications and hiring
  {
    key: 'applications.read',
    group: 'Hiring',
    description: 'View applications',
  },
  {
    key: 'applications.manage',
    group: 'Hiring',
    description: 'Move applications through the pipeline',
  },
  {
    key: 'interviews.manage',
    group: 'Hiring',
    description: 'Schedule interviews',
  },
  {
    key: 'feedback.submit',
    group: 'Hiring',
    description: 'Submit interview feedback',
  },
  {
    key: 'offers.manage',
    group: 'Hiring',
    description: 'Create and send offers',
  },
  { key: 'offers.approve', group: 'Hiring', description: 'Approve offers' },
  // Communication and automation
  {
    key: 'messages.send',
    group: 'Communication',
    description: 'Send candidate messages',
  },
  {
    key: 'automation.manage',
    group: 'Communication',
    description: 'Manage automation rules',
  },
  // AI
  { key: 'ai.use', group: 'AI', description: 'Use AI features' },
  { key: 'ai.configure', group: 'AI', description: 'Configure AI providers' },
  // Admin
  { key: 'analytics.read', group: 'Admin', description: 'View analytics' },
  {
    key: 'billing.manage',
    group: 'Admin',
    description: 'Manage billing and plans',
  },
  {
    key: 'integrations.manage',
    group: 'Admin',
    description: 'Manage integrations, SSO and webhooks',
  },
  { key: 'audit.read', group: 'Admin', description: 'View audit logs' },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSIONS.map(
  (p) => p.key
);

const permissionKeySet = new Set<string>(ALL_PERMISSION_KEYS);

export const isPermissionKey = (key: string): key is PermissionKey =>
  permissionKeySet.has(key);

/** Expands `group.*` wildcards and validates every key. */
export function expandPermissions(patterns: string[]): PermissionKey[] {
  const out = new Set<PermissionKey>();

  for (const pattern of patterns) {
    if (pattern === '*') {
      ALL_PERMISSION_KEYS.forEach((k) => out.add(k));
    } else if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -1);
      const matches = ALL_PERMISSION_KEYS.filter((k) => k.startsWith(prefix));

      if (!matches.length) {
        throw new Error(`Unknown permission pattern: ${pattern}`);
      }

      matches.forEach((k) => out.add(k));
    } else if (isPermissionKey(pattern)) {
      out.add(pattern);
    } else {
      throw new Error(`Unknown permission: ${pattern}`);
    }
  }

  return Array.from(out);
}

export type SystemRoleDefinition = {
  key: string;
  name: string;
  description: string;
  baseRole: Role;
  isOwnerRole: boolean;
  /** Recruiter-style roles see only jobs they are assigned to (Phase 2). */
  scope: 'all' | 'assigned';
  permissions: PermissionKey[];
};

const allExcept = (...excluded: PermissionKey[]) =>
  ALL_PERMISSION_KEYS.filter((k) => !excluded.includes(k));

export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    key: 'portal_owner',
    name: 'Portal Owner',
    description: 'Full control of the portal, including billing and roles.',
    baseRole: Role.OWNER,
    isOwnerRole: true,
    scope: 'all',
    permissions: allExcept(),
  },
  {
    key: 'admin',
    name: 'Admin',
    description: 'Everything except billing and role management.',
    baseRole: Role.ADMIN,
    isOwnerRole: false,
    scope: 'all',
    permissions: allExcept('billing.manage', 'roles.manage'),
  },
  {
    key: 'hr_manager',
    name: 'HR Manager',
    description: 'Runs hiring: jobs, candidates, applications and offers.',
    baseRole: Role.MEMBER,
    isOwnerRole: false,
    scope: 'all',
    permissions: expandPermissions([
      'portal.read',
      'jobs.*',
      'candidates.*',
      'applications.*',
      'interviews.manage',
      'offers.manage',
      'messages.send',
      'automation.manage',
      'analytics.read',
      'members.invite',
      'ai.use',
    ]),
  },
  {
    key: 'recruiter',
    name: 'Recruiter',
    description: 'Works on assigned jobs and their applications.',
    baseRole: Role.MEMBER,
    isOwnerRole: false,
    scope: 'assigned',
    permissions: expandPermissions([
      'portal.read',
      'jobs.create',
      'jobs.read',
      'jobs.update',
      'jobs.publish',
      'candidates.read',
      'candidates.search',
      'candidates.update',
      'applications.*',
      'interviews.manage',
      'messages.send',
      'ai.use',
    ]),
  },
  {
    key: 'hiring_manager',
    name: 'Hiring Manager',
    description: 'Reviews applications and approves offers for their jobs.',
    baseRole: Role.MEMBER,
    isOwnerRole: false,
    scope: 'assigned',
    permissions: expandPermissions([
      'portal.read',
      'jobs.read',
      'applications.read',
      'feedback.submit',
      'offers.approve',
      'ai.use',
    ]),
  },
  {
    key: 'interviewer',
    name: 'Interviewer',
    description: 'Sees applications for their interviews and submits feedback.',
    baseRole: Role.MEMBER,
    isOwnerRole: false,
    scope: 'assigned',
    permissions: expandPermissions([
      'portal.read',
      'applications.read',
      'feedback.submit',
    ]),
  },
  {
    key: 'viewer',
    name: 'Viewer / Analyst',
    description: 'Read-only access to jobs, applications and analytics.',
    baseRole: Role.MEMBER,
    isOwnerRole: false,
    scope: 'all',
    permissions: expandPermissions([
      'portal.read',
      'jobs.read',
      'applications.read',
      'analytics.read',
    ]),
  },
];

export const ASSIGNMENT_SCOPED_ROLE_KEYS = new Set(
  SYSTEM_ROLES.filter((r) => r.scope === 'assigned').map((r) => r.key)
);

/**
 * Permissions implied by the kit's base `Role` for members that have no
 * portal role assigned (e.g. members created before portal roles existed).
 */
export const BASE_ROLE_PERMISSIONS: Record<Role, PermissionKey[]> = {
  OWNER: allExcept(),
  ADMIN: allExcept('billing.manage', 'roles.manage'),
  MEMBER: ['portal.read'],
};

export const RESERVED_SLUGS = new Set([
  'new',
  'switch',
  'admin',
  'api',
  'www',
  'p',
  'me',
  'onboarding',
  'auth',
  'settings',
  'dashboard',
]);
