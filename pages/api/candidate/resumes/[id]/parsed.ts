import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { ApiError } from '@/lib/errors';
import { requireUser } from '@/lib/candidateAuth';
import { validateWithSchema } from '@/lib/zod';
import { getParsedForReview, reviewParsedFields } from 'models/ai/resumeParse';

const schema = z.object({
  confirm: z
    .array(
      z.object({ id: z.string().min(1).max(64), value: z.unknown().optional() })
    )
    .max(200)
    .default([]),
  reject: z.array(z.string().min(1).max(64)).max(200).default([]),
});

// What the AI read from a resume; the candidate confirms or rejects uncertain fields.
export default route({
  GET: async (req, res) => {
    const user = await requireUser(req, res);
    const r = await getParsedForReview(user.id, String(req.query.id ?? ''));

    if (!r) throw new ApiError(404, 'Resume not found.');

    res.status(200).json({ data: r });
  },
  PUT: async (req, res) => {
    const user = await requireUser(req, res);
    const input = validateWithSchema(schema, req.body);
    const r = await reviewParsedFields(
      user.id,
      String(req.query.id ?? ''),
      input
    );

    if (!r) throw new ApiError(404, 'Resume not found.');

    res.status(200).json({ data: r });
  },
});
