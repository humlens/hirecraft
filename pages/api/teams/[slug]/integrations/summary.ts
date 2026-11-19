import { route } from '@/lib/apiRoute';
import env from '@/lib/env';
import { dsyncManager } from '@/lib/jackson/dsync';
import { ssoManager } from '@/lib/jackson/sso/index';
import { prisma } from '@/lib/prisma';
import { findOrCreateApp, listWebhooks } from '@/lib/svix';
import { requireTenantContext } from '@/lib/tenant';

const attempt = async <T>(fn: () => Promise<T>, fallback: T) => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

// Read-only overview for the integrations page: webhook endpoints, SSO and
// directory sync state and the number of API keys. Each part degrades to
// "off" when its service is not configured on this server.
export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'integrations.manage',
    });
    const teamId = ctx.team.id;

    const webhooks = env.teamFeatures.webhook
      ? await attempt(async () => {
          const app = await findOrCreateApp(ctx.team.name, teamId);
          const list = app ? await listWebhooks(app.id) : null;

          return (list?.data ?? []).map((e) => ({
            id: e.id,
            url: e.url,
            description: e.description,
            eventTypes: e.filterTypes ?? [],
          }));
        }, [])
      : [];
    const sso = env.teamFeatures.sso
      ? await attempt(async () => {
          const c = await ssoManager().getConnections({
            tenant: teamId,
            product: env.jackson.productId,
          });

          return { active: c.length > 0, provider: c[0]?.name ?? null };
        }, null)
      : null;
    const dsync = env.teamFeatures.dsync
      ? await attempt(async () => {
          const d = await dsyncManager().getConnections({ tenant: teamId });
          const rows = (d as { data?: unknown[] }).data ?? [];

          return { active: rows.length > 0 };
        }, null)
      : null;
    const apiKeys = env.teamFeatures.apiKey
      ? await prisma.apiKey.count({ where: { teamId } })
      : null;

    res.status(200).json({ data: { webhooks, sso, dsync, apiKeys } });
  },
});
