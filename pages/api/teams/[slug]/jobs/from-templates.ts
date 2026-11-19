import { z } from 'zod';
import { route } from '@/lib/apiRoute';
import { requireTenantContext } from '@/lib/tenant';
import { validateWithSchema } from '@/lib/zod';
import { createJobsFromTemplates } from 'models/jobTemplates';
import { prisma } from '@/lib/prisma';

// Creates draft jobs from industry job templates (e.g. "Registered Nurse, ICU").
export default route({
  POST: async (req, res) => {
    const ctx = await requireTenantContext(req, res, {
      permission: 'jobs.create',
    });
    const { keys } = validateWithSchema(
      z.object({ keys: z.array(z.string().max(60)).min(1).max(20) }),
      req.body
    );
    const profile = await prisma.portalProfile.findUnique({
      where: { teamId: ctx.team.id },
      select: { industry: true },
    });
    const jobs = await createJobsFromTemplates(ctx, keys, profile?.industry);

    res
      .status(201)
      .json({ data: jobs.map((j) => ({ id: j.id, title: j.title })) });
  },
});
