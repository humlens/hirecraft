import { route, queryWithout } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { listInterviewsSchema, validateWithSchema } from '@/lib/zod';
import { listInterviews } from 'models/interview';

// Managers see interviews of their jobs; everyone else only the interviews
// they take part in.
export default route({
  GET: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      anyPermission: ['interviews.manage', 'feedback.submit'],
    });
    const f = validateWithSchema(
      listInterviewsSchema,
      queryWithout(req, 'slug')
    );

    res.status(200).json({ data: await listInterviews(ctx, f) });
  },
});
