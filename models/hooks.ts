import { jobStaffIds, notify } from '@/lib/notifications';
import { prisma, unguardedPrisma } from '@/lib/prisma';
import { runAutomations } from './automation';

/** Side effects after a new application was committed (never throws). */
export async function onApplicationCreated(args: {
  teamId: string;
  applicationId: string;
  jobId: string;
  jobTitle: string;
  teamSlug: string;
  candidateName: string;
}) {
  try {
    await notify({
      userIds: await jobStaffIds(args.teamId, args.jobId),
      teamId: args.teamId,
      type: 'application.created',
      title: `New application: ${args.candidateName}`,
      body: args.jobTitle,
      link: `/teams/${args.teamSlug}/applications/${args.applicationId}`,
    });

    const app = await prisma.jobApplication.findFirst({
      where: { id: args.applicationId, teamId: args.teamId },
      select: { stageId: true },
    });

    await runAutomations({
      type: 'APPLICATION_CREATED',
      teamId: args.teamId,
      applicationId: args.applicationId,
      stageId: app?.stageId,
    });
  } catch (error) {
    console.error('onApplicationCreated failed', error);
  }
}

/** Side effects after an application changed stage (never throws). */
export async function onStageChanged(args: {
  teamId: string;
  teamSlug: string;
  applicationId: string;
  jobId: string;
  stageId: string;
  stageName: string;
  actorUserId: string | null;
}) {
  try {
    const app = await prisma.jobApplication.findFirst({
      where: { id: args.applicationId, teamId: args.teamId },
      select: {
        tenantCandidate: { select: { userId: true, name: true } },
        job: { select: { title: true } },
      },
    });

    if (app?.tenantCandidate.userId) {
      // In-app status only. Emails to candidates always go through message drafts.
      await notify({
        userIds: [app.tenantCandidate.userId],
        teamId: args.teamId,
        type: 'application.stage_changed',
        title: `Your application for ${app.job.title} moved to ${args.stageName}`,
        link: '/me/applications',
        inAppOnly: true,
      });
    }

    if (/shortlist/i.test(args.stageName) && app) {
      await notify({
        userIds: (await jobStaffIds(args.teamId, args.jobId)).filter(
          (u) => u !== args.actorUserId
        ),
        teamId: args.teamId,
        type: 'application.shortlisted',
        title: `Shortlisted: ${app.tenantCandidate.name}`,
        body: app.job.title,
        link: `/teams/${args.teamSlug}/applications/${args.applicationId}`,
      });
    }

    await runAutomations({
      type: 'STAGE_ENTERED',
      teamId: args.teamId,
      applicationId: args.applicationId,
      stageId: args.stageId,
      actorUserId: args.actorUserId,
    });
  } catch (error) {
    console.error('onStageChanged failed', error);
  }
}

export const slugOfTeam = async (teamId: string) =>
  (
    await unguardedPrisma.team.findUnique({
      where: { id: teamId },
      select: { slug: true },
    })
  )?.slug ?? '';
