import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import {
  candidateIdSchema,
  setTagsSchema,
  validateWithSchema,
} from '@/lib/zod';
import { getCandidate, setTags } from 'models/talent';

export default route({
  PUT: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'candidates.update',
    });
    const { candidateId } = validateWithSchema(candidateIdSchema, req.query);
    const { tags } = validateWithSchema(setTagsSchema, req.body);

    await setTags(ctx, candidateId, tags);

    res.status(200).json({ data: await getCandidate(ctx, candidateId) });
  },
});
