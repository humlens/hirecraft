import type { JobData, JobName } from './queue';

/** What each queued job does. Shared by the BullMQ worker and the inline fallback. */
export const handlers: { [N in JobName]: (d: JobData[N]) => Promise<unknown> } =
  {
    'resume.parse': async ({ resumeId }) =>
      (await import('models/ai/resumeParse')).parseResume(resumeId),
    'embed.profile': async ({ userId }) =>
      (await import('./ai/embeddings')).embedProfile(userId),
    'embed.job': async ({ teamId, jobId }) =>
      (await import('./ai/embeddings')).embedJob(teamId, jobId),
    'match.application': async (d) =>
      (await import('models/ai/match')).matchApplicationJob(d),
    'match.job': async ({ teamId, jobId, userId }) => {
      const { buildTenantContext } = await import('./tenant');
      const { queueJobMatching } = await import('models/ai/match');

      return queueJobMatching(await buildTenantContext(teamId, userId), jobId);
    },
  };
