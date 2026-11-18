import { route } from '@/lib/apiRoute';
import { sendAudit } from '@/lib/retraced';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';
import {
  aiSettingsSchema,
  getAiSettings,
  saveAiSettings,
} from 'models/ai/settings';

// Settings never contain the API key: it is write-only and stored encrypted.
export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'ai.configure',
    });

    res.status(200).json({ data: await getAiSettings(ctx) });
  },
  PUT: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'ai.configure',
    });
    const input = validateWithSchema(aiSettingsSchema, req.body);
    const data = await saveAiSettings(ctx, input);

    sendAudit({
      action: 'ai.settings.update',
      crud: 'u',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(200).json({ data });
  },
});
