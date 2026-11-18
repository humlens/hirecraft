import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { requirePermission } from '@/lib/authz';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';
import { draftCandidateMessage } from 'models/ai/comms';

const schema = z.object({
  applicationId: z.string().min(1).max(64),
  kind: z.enum(['CUSTOM', 'STATUS_UPDATE', 'REJECTION', 'INTERVIEW_INVITE']),
  instructions: z.string().trim().max(500).optional(),
});

// Creates a DRAFT written by AI. A person must approve and send it.
export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'messages.send',
    });

    requirePermission(ctx, 'ai.use');

    const input = validateWithSchema(schema, req.body);

    res.status(201).json({ data: await draftCandidateMessage(ctx, input) });
  },
});
