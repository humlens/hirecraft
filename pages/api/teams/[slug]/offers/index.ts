import { route, queryWithout } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { createOfferSchema, validateWithSchema } from '@/lib/zod';
import { z } from 'zod';
import { createOffer, listOffers } from 'models/offer';
import { sendAudit } from '@/lib/retraced';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      anyPermission: ['offers.manage', 'offers.approve'],
    });
    const f = validateWithSchema(
      z.object({
        status: z
          .enum([
            'DRAFT',
            'PENDING_APPROVAL',
            'APPROVED',
            'SENT',
            'ACCEPTED',
            'DECLINED',
            'EXPIRED',
          ])
          .optional(),
        applicationId: z.string().max(64).optional(),
      }),
      queryWithout(req, 'slug')
    );

    res.status(200).json({ data: await listOffers(ctx, f) });
  },
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'offers.manage',
    });
    const { applicationId, ...input } = validateWithSchema(
      createOfferSchema,
      req.body
    );
    const offer = await createOffer(ctx, applicationId, input);

    sendAudit({
      action: 'offer.create',
      crud: 'c',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(201).json({ data: offer });
  },
});
