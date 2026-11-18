import { route } from '@/lib/apiRoute';
import { requirePermission } from '@/lib/authz';
import { requireTenantContext } from '@/lib/tenant';
import {
  offerActionSchema,
  offerIdSchema,
  validateWithSchema,
} from '@/lib/zod';
import { decide, sendOffer, submitForApproval } from 'models/offer';
import { sendAudit } from '@/lib/retraced';
import { sendEvent } from '@/lib/svix';

// submit (offers.manage) | approve / reject (offers.approve) | send (offers.manage)
export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res);
    const { offerId } = validateWithSchema(offerIdSchema, req.query);
    const input = validateWithSchema(offerActionSchema, req.body);
    const audit = (action: string) =>
      sendAudit({
        action: action as never,
        crud: 'u',
        user: ctx.user as never,
        team: ctx.team,
      });

    switch (input.action) {
      case 'submit': {
        requirePermission(ctx, 'offers.manage');
        const o = await submitForApproval(ctx, offerId, input.approverIds);

        audit('offer.submit');
        res.status(200).json({ data: o });
        return;
      }
      case 'approve':
      case 'reject': {
        requirePermission(ctx, 'offers.approve');
        const o = await decide(
          ctx,
          offerId,
          input.action === 'approve' ? 'APPROVED' : 'REJECTED',
          input.comment
        );

        audit(input.action === 'approve' ? 'offer.approve' : 'offer.reject');
        res.status(200).json({ data: o });
        return;
      }
      case 'send': {
        requirePermission(ctx, 'offers.manage');
        const o = await sendOffer(ctx, offerId);

        audit('offer.send');
        await sendEvent(ctx.team.id, 'offer.sent', {
          offerId,
          applicationId: o.applicationId,
        });
        res.status(200).json({ data: o });
        return;
      }
    }
  },
});
