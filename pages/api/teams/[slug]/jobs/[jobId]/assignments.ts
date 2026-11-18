import type { NextApiRequest, NextApiResponse } from 'next';
import { requireTenantContext } from '@/lib/tenant';
import {
  jobAssignmentsSchema,
  jobIdSchema,
  validateWithSchema,
} from '@/lib/zod';
import { setAssignments } from 'models/job';
import { sendAudit } from '@/lib/retraced';
import { prisma } from '@/lib/prisma';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    if (req.method === 'GET') {
      // Members that can be assigned (needs only jobs.update, not members.*)
      const ctx = await requireTenantContext(req, res, {
        permission: 'jobs.update',
      });
      const members = await prisma.teamMember.findMany({
        where: { teamId: ctx.team.id },
        select: {
          userId: true,
          user: { select: { name: true, email: true } },
          portalRole: { select: { name: true } },
        },
      });

      res.status(200).json({
        data: members.map((m) => ({
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
          role: m.portalRole?.name ?? null,
        })),
      });

      return;
    }

    if (req.method !== 'PUT') {
      res.setHeader('Allow', 'GET, PUT');
      res.status(405).json({
        error: { message: `Method ${req.method} Not Allowed` },
      });

      return;
    }

    const ctx = await requireTenantContext(req, res, {
      permission: 'jobs.update',
    });
    const { jobId } = validateWithSchema(jobIdSchema, req.query);
    const { assignments } = validateWithSchema(jobAssignmentsSchema, req.body);

    const job = await setAssignments(ctx, jobId, assignments);

    sendAudit({
      action: 'job.update',
      crud: 'u',
      user: ctx.user as never,
      team: ctx.team,
    });

    res.status(200).json({ data: job });
  } catch (error: any) {
    const message = error.message || 'Something went wrong';
    const status = error.status || 500;

    res.status(status).json({ error: { message } });
  }
}
