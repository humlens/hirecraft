/**
 * @jest-environment node
 */
import {
  assertCanGrant,
  assertCanGrantBaseRole,
  getDataScope,
  getEffectivePermissions,
  requirePermission,
} from '../../lib/authz';
import {
  ALL_PERMISSION_KEYS,
  SYSTEM_ROLES,
  expandPermissions,
  type PermissionKey,
} from '../../lib/portal-roles';

const member = (
  role: 'OWNER' | 'ADMIN' | 'MEMBER',
  roleKey?: string,
  keys: string[] = []
) => ({
  role,
  portalRole: roleKey
    ? {
        key: roleKey,
        permissions: keys.map((key) => ({ permission: { key } })),
      }
    : null,
});

const sys = (key: string) => SYSTEM_ROLES.find((r) => r.key === key)!;

describe('portal roles - catalogue', () => {
  it('has unique permission keys', () => {
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('expands wildcards and rejects unknown patterns', () => {
    expect(expandPermissions(['jobs.*'])).toEqual(
      expect.arrayContaining([
        'jobs.create',
        'jobs.read',
        'jobs.update',
        'jobs.publish',
        'jobs.delete',
      ])
    );
    expect(() => expandPermissions(['nope.*'])).toThrow();
    expect(() => expandPermissions(['jobs.fly'])).toThrow();
  });

  it('defines the seven system roles', () => {
    expect(SYSTEM_ROLES.map((r) => r.key)).toEqual([
      'portal_owner',
      'admin',
      'hr_manager',
      'recruiter',
      'hiring_manager',
      'interviewer',
      'viewer',
    ]);
  });

  it('Portal Owner has every permission', () => {
    expect(sys('portal_owner').permissions.sort()).toEqual(
      [...ALL_PERMISSION_KEYS].sort()
    );
  });

  it('Admin has everything except billing.manage and roles.manage', () => {
    const missing = ALL_PERMISSION_KEYS.filter(
      (k) => !sys('admin').permissions.includes(k)
    );
    expect(missing.sort()).toEqual(['billing.manage', 'roles.manage']);
  });

  it('Recruiter cannot manage billing, roles, members or offers', () => {
    const p = sys('recruiter').permissions;
    for (const k of [
      'billing.manage',
      'roles.manage',
      'members.invite',
      'members.remove',
      'offers.manage',
      'offers.approve',
    ] as PermissionKey[]) {
      expect(p).not.toContain(k);
    }
    expect(p).toEqual(
      expect.arrayContaining(['jobs.publish', 'applications.manage'])
    );
  });

  it('Interviewer and Hiring Manager are limited', () => {
    expect(sys('interviewer').permissions.sort()).toEqual(
      ['applications.read', 'feedback.submit', 'portal.read'].sort()
    );
    expect(sys('hiring_manager').permissions).toContain('offers.approve');
    expect(sys('hiring_manager').permissions).not.toContain('jobs.update');
  });

  it('only OWNER base role is used by the owner role', () => {
    expect(SYSTEM_ROLES.filter((r) => r.baseRole === 'OWNER')).toHaveLength(1);
    expect(SYSTEM_ROLES.filter((r) => r.isOwnerRole)).toHaveLength(1);
  });
});

describe('authz - effective permissions', () => {
  it('OWNER gets all keys even with a restrictive portal role', () => {
    const perms = getEffectivePermissions(
      member('OWNER', 'viewer', ['portal.read'])
    );
    expect(perms.size).toBe(ALL_PERMISSION_KEYS.length);
  });

  it('a portal role grants exactly its keys', () => {
    const perms = getEffectivePermissions(
      member('MEMBER', 'recruiter', ['jobs.read', 'jobs.create'])
    );
    expect(Array.from(perms).sort()).toEqual(['jobs.create', 'jobs.read']);
  });

  it('a base ADMIN with a limited portal role is NOT widened', () => {
    const perms = getEffectivePermissions(
      member('ADMIN', 'custom_limited', ['jobs.read'])
    );
    expect(Array.from(perms)).toEqual(['jobs.read']);
  });

  it('legacy members without portal role fall back to the base role', () => {
    expect(getEffectivePermissions(member('MEMBER')).has('portal.read')).toBe(
      true
    );
    expect(getEffectivePermissions(member('MEMBER')).has('jobs.read')).toBe(
      false
    );
    const admin = getEffectivePermissions(member('ADMIN'));
    expect(admin.has('members.invite')).toBe(true);
    expect(admin.has('billing.manage')).toBe(false);
    expect(admin.has('roles.manage')).toBe(false);
  });

  it('ignores unknown keys stored on a role', () => {
    const perms = getEffectivePermissions(
      member('MEMBER', 'x', ['jobs.read', 'made.up'])
    );
    expect(Array.from(perms)).toEqual(['jobs.read']);
  });

  it('requirePermission throws 403', () => {
    const ctx = { permissions: new Set<PermissionKey>(['jobs.read']) };
    expect(() => requirePermission(ctx, 'jobs.read')).not.toThrow();
    expect(() => requirePermission(ctx, 'jobs.delete')).toThrow(
      expect.objectContaining({ status: 403 })
    );
  });

  it('assignment scope applies to recruiter-style roles only', () => {
    expect(getDataScope(member('MEMBER', 'recruiter'))).toBe('assigned');
    expect(getDataScope(member('MEMBER', 'interviewer'))).toBe('assigned');
    expect(getDataScope(member('MEMBER', 'hr_manager'))).toBe('all');
    expect(getDataScope(member('OWNER', 'recruiter'))).toBe('all');
    expect(getDataScope(member('MEMBER'))).toBe('all');
  });
});

describe('authz - escalation guards', () => {
  const hr = { permissions: new Set(sys('hr_manager').permissions) };

  it('cannot grant permissions the actor does not hold', () => {
    expect(() => assertCanGrant(hr, ['jobs.read'])).not.toThrow();
    expect(() => assertCanGrant(hr, ['billing.manage'])).toThrow(
      expect.objectContaining({ status: 403 })
    );
  });

  it('base role grants', () => {
    expect(() => assertCanGrantBaseRole('OWNER', 'OWNER')).not.toThrow();
    expect(() => assertCanGrantBaseRole('ADMIN', 'OWNER')).toThrow();
    expect(() => assertCanGrantBaseRole('ADMIN', 'ADMIN')).not.toThrow();
    expect(() => assertCanGrantBaseRole('MEMBER', 'ADMIN')).toThrow();
    expect(() => assertCanGrantBaseRole('MEMBER', 'MEMBER')).not.toThrow();
  });
});
