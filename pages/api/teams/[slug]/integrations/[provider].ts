import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { sendAudit } from '@/lib/retraced';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';
import {
  disconnectIntegration,
  listIntegrations,
  saveWebhookIntegration,
  startOAuth,
  updateIntegrationConfig,
} from 'models/integration';

const provider = (req: { query: Record<string, unknown> }) =>
  String(req.query.provider ?? '');

// POST: start OAuth (returns the provider URL and sets a state cookie).
// PUT: save a webhook partner's URL + signing secret, or calendar options.
// DELETE: disconnect.
export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'integrations.manage',
    });
    const { url, nonce } = await startOAuth(ctx, provider(req));

    res.setHeader(
      'Set-Cookie',
      `hc_oauth=${nonce}; Path=/api/integrations; HttpOnly; SameSite=Lax; Max-Age=600${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
    );
    res.status(200).json({ data: { url } });
  },
  PUT: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'integrations.manage',
    });
    const key = provider(req);
    const body = validateWithSchema(
      z.object({ video: z.boolean().optional() }).passthrough(),
      req.body
    );

    if ('url' in body || 'secret' in body) {
      await saveWebhookIntegration(ctx, key, body);
    } else {
      await updateIntegrationConfig(ctx, key, { video: body.video });
    }

    sendAudit({
      action: 'integration.connect',
      crud: 'u',
      user: ctx.user as never,
      team: ctx.team,
    });
    res.status(200).json({ data: await listIntegrations(ctx) });
  },
  DELETE: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'integrations.manage',
    });

    await disconnectIntegration(ctx, provider(req));
    sendAudit({
      action: 'integration.disconnect',
      crud: 'd',
      user: ctx.user as never,
      team: ctx.team,
    });
    res.status(200).json({ data: await listIntegrations(ctx) });
  },
});
