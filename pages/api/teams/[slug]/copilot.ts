import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';
import { runCopilot } from 'models/ai/copilot';

const schema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(4000),
      })
    )
    .min(1)
    .max(20),
});

// The conversation is kept by the browser; each call is stateless.
export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, { permission: 'ai.use' });
    const { messages } = validateWithSchema(schema, req.body);

    res.status(200).json({ data: await runCopilot(ctx, messages) });
  },
});
