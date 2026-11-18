import { route } from '@/lib/apiRoute';
import { requireUser } from '@/lib/candidateAuth';
import { notify } from '@/lib/notifications';
import { respondOfferSchema, validateWithSchema } from '@/lib/zod';
import { ApiError } from '@/lib/errors';
import { respondToOffer } from 'models/offer';
import { onStageChanged, slugOfTeam } from 'models/hooks';
import { sendEvent } from '@/lib/svix';

export default route({
  POST: async (req, res) => {
    const user = await requireUser(req, res);
    const { accept } = validateWithSchema(respondOfferSchema, req.body);
    const r = await respondToOffer(user.id, String(req.query.id ?? ''), accept);

    if (r.expired) {
      throw new ApiError(409, 'This offer has expired.');
    }

    const slug = await slugOfTeam(r.teamId);

    if (r.createdById) {
      await notify({
        userIds: [r.createdById],
        teamId: r.teamId,
        type: accept ? 'offer.accepted' : 'offer.declined',
        title: accept ? 'Offer accepted' : 'Offer declined',
        link: `/teams/${slug}/offers/${r.offerId}`,
      });
    }

    if (accept) {
      await sendEvent(r.teamId, 'offer.accepted', {
        offerId: r.offerId,
        applicationId: r.applicationId,
      });
    }

    if (r.hired) {
      await sendEvent(r.teamId, 'candidate.hired', {
        applicationId: r.applicationId,
      });
      await onStageChanged({
        teamId: r.teamId,
        teamSlug: slug,
        applicationId: r.applicationId,
        jobId: r.jobId,
        stageId: r.hired.stageId,
        stageName: r.hired.stageName,
        actorUserId: user.id,
      });
    }

    res.status(200).json({ data: { accepted: accept } });
  },
});
