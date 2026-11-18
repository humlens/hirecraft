import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { requireAnyPermission } from '@/lib/authz';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';
import { generateJobDescription } from 'models/ai/jd';

const schema = z.object({
  title: z.string().trim().min(3).max(120),
  tone: z.enum(['professional', 'friendly', 'concise']).default('professional'),
  workMode: z.enum(['REMOTE', 'HYBRID', 'ONSITE']).optional(),
  location: z.string().trim().max(120).optional(),
  experience: z.string().trim().max(60).optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  notes: z.string().trim().max(2000).optional(),
});

export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, { permission: 'ai.use' });

    requireAnyPermission(ctx, ['jobs.create', 'jobs.update']);

    const input = validateWithSchema(schema, req.body);

    res.status(200).json({ data: await generateJobDescription(ctx, input) });
  },
});
