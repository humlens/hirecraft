import { route } from '@/lib/apiRoute';
import { requireUser } from '@/lib/candidateAuth';
import { listMyInterviews } from 'models/interview';

export default route({
  GET: async (req, res) => {
    const user = await requireUser(req, res);

    res.status(200).json({ data: await listMyInterviews(user.id) });
  },
});
