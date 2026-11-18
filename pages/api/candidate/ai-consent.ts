import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { requireUser } from '@/lib/candidateAuth';
import { validateWithSchema } from '@/lib/zod';
import {
  listRecommendationConsents,
  setRecommendationConsent,
} from 'models/ai/recommend';

export default route({
  GET: async (req, res) => {
    const user = await requireUser(req, res);

    res.status(200).json({ data: await listRecommendationConsents(user.id) });
  },
  PUT: async (req, res) => {
    const user = await requireUser(req, res);
    const { teamId, granted } = validateWithSchema(
      z.object({ teamId: z.string().min(1).max(64), granted: z.boolean() }),
      req.body
    );

    await setRecommendationConsent(user.id, teamId, granted);

    res.status(200).json({ data: await listRecommendationConsents(user.id) });
  },
});
