/**
 * @jest-environment node
 */
import { assertTenantScoped } from '../../lib/tenantGuard';

describe('tenant guard - assertTenantScoped', () => {
  it('ignores non-tenant models', () => {
    expect(assertTenantScoped('User', 'findMany', {})).toBeNull();
    expect(assertTenantScoped('Team', 'findUnique', { where: {} })).toBeNull();
  });

  it('rejects tenant reads without teamId', () => {
    for (const op of ['findMany', 'findFirst', 'count', 'deleteMany']) {
      expect(assertTenantScoped('PortalRole', op, {})).toMatch(/teamId/);
      expect(
        assertTenantScoped('PortalRole', op, { where: { id: 'x' } })
      ).toMatch(/teamId/);
    }
  });

  it('accepts teamId at the top level, in AND, and in compound uniques', () => {
    expect(
      assertTenantScoped('PortalRole', 'findMany', { where: { teamId: 't' } })
    ).toBeNull();
    expect(
      assertTenantScoped('PortalRole', 'findMany', {
        where: { AND: [{ name: 'x' }, { teamId: 't' }] },
      })
    ).toBeNull();
    expect(
      assertTenantScoped('PortalRole', 'findUnique', {
        where: { teamId_key: { teamId: 't', key: 'k' } },
      })
    ).toBeNull();
  });

  it('accepts an explicit null teamId (system templates)', () => {
    expect(
      assertTenantScoped('PortalRole', 'findMany', { where: { teamId: null } })
    ).toBeNull();
  });

  it('does not accept teamId hidden inside OR', () => {
    expect(
      assertTenantScoped('PortalRole', 'findMany', {
        where: { OR: [{ teamId: 'a' }, { name: 'x' }] },
      })
    ).toMatch(/teamId/);
  });

  it('rejects an undefined teamId value', () => {
    expect(
      assertTenantScoped('PortalProfile', 'findUnique', {
        where: { teamId: undefined },
      })
    ).toMatch(/teamId/);
  });

  it('requires teamId on create / createMany / upsert create', () => {
    expect(assertTenantScoped('PortalProfile', 'create', { data: {} })).toMatch(
      /teamId/
    );
    expect(
      assertTenantScoped('PortalProfile', 'create', { data: { teamId: 't' } })
    ).toBeNull();
    expect(
      assertTenantScoped('PortalRole', 'createMany', {
        data: [{ teamId: 't' }, { name: 'x' }],
      })
    ).toMatch(/teamId/);
    expect(
      assertTenantScoped('PortalBranding', 'upsert', {
        where: { teamId: 't' },
        create: {},
        update: {},
      })
    ).toMatch(/teamId/);
  });
});
