import type { TenantContext } from '@/lib/tenant';
import type { AIContext } from '@/lib/ai/run';

/** AI context for a portal request. */
export const aiContext = (ctx: TenantContext): AIContext => ({
  teamId: ctx.team.id,
  userId: ctx.user.id,
  permissions: ctx.permissions,
  team: ctx.team,
  user: ctx.user,
});
