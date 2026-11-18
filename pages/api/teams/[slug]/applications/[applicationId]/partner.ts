import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { requirePermission } from '@/lib/authz';
import { requireTenantContext } from '@/lib/tenant';
import { applicationIdSchema, validateWithSchema } from '@/lib/zod';
import { requestPartner } from 'models/integration';

// Ask the connected assessment / background-check partner to start. A person
// triggers it; background checks also need an explicit consent confirmation.
export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'applications.manage',
    });
    const { applicationId } = validateWithSchema(
      applicationIdSchema,
      req.query
    );
    const body = validateWithSchema(
      z.object({
        kind: z.enum(['assessment', 'background_check']),
        consentConfirmed: z.boolean().default(false),
      }),
      req.body
    );

    if (body.kind === 'background_check') {
      requirePermission(ctx, 'offers.manage');
    }

    res.status(200).json({
      data: await requestPartner(
        ctx,
        applicationId,
        body.kind,
        body.consentConfirmed
      ),
    });
  },
});
