import { route } from '@/lib/apiRoute';
import { slugify } from '@/lib/slug';
import { unguardedPrisma } from '@/lib/prisma';
import { requireUser } from '@/lib/candidateAuth';

// Is this portal address still free? (signed-in users only; answers nothing else)
export default route({
  GET: async (req, res) => {
    await requireUser(req, res);

    const slug = slugify(String(req.query.slug ?? '')).slice(0, 60);
    const taken =
      slug.length >= 3
        ? !!(await unguardedPrisma.team.findUnique({
            where: { slug },
            select: { id: true },
          }))
        : false;

    res
      .status(200)
      .json({ data: { slug, available: slug.length >= 3 && !taken } });
  },
});
