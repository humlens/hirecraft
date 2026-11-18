import { route } from '@/lib/apiRoute';
import { requireUser } from '@/lib/candidateAuth';
import { recommendForCandidate } from 'models/ai/recommend';

// Job recommendations, only from portals the candidate agreed to (AI_RECOMMENDATIONS consent)
export default route({
  GET: async (req, res) => {
    const user = await requireUser(req, res);

    res.status(200).json({ data: await recommendForCandidate(user.id) });
  },
});
