import { route } from '@/lib/apiRoute';
import { requireUser } from '@/lib/candidateAuth';
import { listMyOffers } from 'models/offer';

export default route({
  GET: async (req, res) => {
    const user = await requireUser(req, res);

    res.status(200).json({ data: await listMyOffers(user.id) });
  },
});
