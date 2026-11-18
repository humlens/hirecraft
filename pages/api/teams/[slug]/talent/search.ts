import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { searchFiltersSchema } from '@/lib/ai/features';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';
import { searchTalent } from 'models/ai/search';

const schema = z.object({
  query: z.string().trim().max(300).optional(),
  filters: searchFiltersSchema.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

// Natural-language talent search. Send `filters` back (after removing a chip)
// to search again without another model call.
export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'candidates.search',
    });
    const input = validateWithSchema(schema, req.body);

    res.status(200).json({ data: await searchTalent(ctx, input) });
  },
});
