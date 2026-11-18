import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import {
  offerIdSchema,
  updateOfferSchema,
  validateWithSchema,
} from '@/lib/zod';
import { getOffer, updateOffer } from 'models/offer';

export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      anyPermission: ['offers.manage', 'offers.approve'],
    });
    const { offerId } = validateWithSchema(offerIdSchema, req.query);

    res.status(200).json({ data: await getOffer(ctx, offerId) });
  },
  PUT: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'offers.manage',
    });
    const { offerId } = validateWithSchema(offerIdSchema, req.query);
    const input = validateWithSchema(updateOfferSchema, req.body);

    res.status(200).json({ data: await updateOffer(ctx, offerId, input) });
  },
});
