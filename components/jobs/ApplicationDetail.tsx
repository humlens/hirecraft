import { Card, Error, Loading } from '@/components/shared';
import { defaultHeaders } from '@/lib/common';
import { useApplication } from 'hooks/usePipeline';
import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import toast from 'react-hot-toast';
import type { ApiResponse } from 'types';
import useApi from 'hooks/useApi';
import { useState } from 'react';
import {
  ScheduleInterview,
  type InterviewView,
} from '@/components/interviews/Interviews';
import { CreateOffer, type OfferView } from '@/components/offers/Offers';
import { ComposeMessage, MessagesList } from '@/components/messages/Messages';
import { useRouter } from 'next/router';
import MatchPanel from '@/components/ai/MatchPanel';

type Answer = { questionId: string; prompt: string; value: unknown };

const ApplicationDetail = ({
  slug,
  applicationId,
}: {
  slug: string;
  applicationId: string;
}) => {
  const { t } = useTranslation('common');
  const { isLoading, isError, application, mutateApplication } = useApplication(
    slug,
    applicationId
  );
  const { can } = usePortalAccess(slug);
  const router = useRouter();
  const [panel, setPanel] = useState<'interview' | 'offer' | 'message' | null>(
    null
  );
  const interviews = useApi<InterviewView[]>(
    can('interviews.manage')
      ? `/api/teams/${slug}/applications/${applicationId}/interviews`
      : null
  );
  const offers = useApi<OfferView[]>(
    can('offers.manage')
      ? `/api/teams/${slug}/offers?applicationId=${applicationId}`
      : null
  );

  if (isLoading) {
    return <Loading />;
  }

  if (isError) {
    return <Error message={isError.message} />;
  }

  if (!application) {
    return null;
  }

  const stageName = (id: string | null) =>
    application.stages.find((s) => s.id === id)?.name ?? '-';

  const move = async (stageId: string) => {
    const target = application.stages.find((s) => s.id === stageId);
    const reason =
      target?.kind === 'REJECTED'
        ? (window.prompt(
            t('rejection-reason', 'Reason for rejection (optional)')
          ) ?? undefined)
        : undefined;

    const r = await fetch(`/api/teams/${slug}/applications/stage`, {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({ applicationId, stageId, rejectionReason: reason }),
    });

    if (!r.ok) {
      toast.error(((await r.json()) as ApiResponse).error.message);
      return;
    }

    toast.success(t('application-moved', 'Moved.'));
    mutateApplication();
  };

  const download = async () => {
    const r = await fetch(
      `/api/teams/${slug}/applications/${applicationId}/resume`
    );
    const json = (await r.json()) as ApiResponse<{ url: string }>;

    if (!r.ok) {
      toast.error(json.error.message);
      return;
    }

    window.location.href = json.data.url;
  };

  const answers = (
    Array.isArray(application.answers) ? application.answers : []
  ) as Answer[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-medium">{application.candidate.name}</h2>
        <span className="badge badge-lg">{application.stage.name}</span>
        <Link
          className="link text-sm"
          href={`/teams/${slug}/jobs/${application.job.id}/pipeline`}
        >
          {application.job.title}
        </Link>
      </div>

      <Card>
        <Card.Body>
          <dl className="grid grid-cols-[8rem_1fr] gap-2 text-sm">
            <dt className="opacity-60">{t('email')}</dt>
            <dd>{application.candidate.email}</dd>
            <dt className="opacity-60">{t('phone', 'Phone')}</dt>
            <dd>{application.candidate.phone ?? '-'}</dd>
            <dt className="opacity-60">{t('applied-on', 'Applied on')}</dt>
            <dd>{new Date(application.appliedAt).toLocaleString()}</dd>
            {application.rejectionReason && (
              <>
                <dt className="opacity-60">
                  {t('rejection-reason-label', 'Rejection reason')}
                </dt>
                <dd>{application.rejectionReason}</dd>
              </>
            )}
          </dl>
          <div className="flex flex-wrap gap-2">
            {application.resume && (
              <button type="button" className="btn btn-sm" onClick={download}>
                {t('download-resume', 'Download resume')} (
                {application.resume.fileName})
              </button>
            )}
            {can('applications.manage') && !application.withdrawnAt && (
              <select
                className="select  select-sm"
                aria-label={t('move-to', 'Move to...')}
                value=""
                onChange={(e) => e.target.value && move(e.target.value)}
              >
                <option value="" disabled>
                  {t('move-to', 'Move to...')}
                </option>
                {application.stages
                  .filter(
                    (s) =>
                      s.id !== application.stage.id && s.kind !== 'WITHDRAWN'
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <div className="flex flex-wrap gap-2">
            <Link
              className="btn btn-sm"
              href={`/teams/${slug}/talent/${application.candidate.id}`}
            >
              {t('candidate-profile', 'Candidate profile')}
            </Link>
            {can('interviews.manage') && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  setPanel(panel === 'interview' ? null : 'interview')
                }
              >
                {t('schedule-interview', 'Schedule interview')}
              </button>
            )}
            {can('offers.manage') && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPanel(panel === 'offer' ? null : 'offer')}
              >
                {t('create-offer', 'Create offer')}
              </button>
            )}
            {can('messages.send') && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setPanel(panel === 'message' ? null : 'message')}
              >
                {t('new-message', 'New message draft')}
              </button>
            )}
          </div>
          {panel === 'interview' && (
            <ScheduleInterview
              slug={slug}
              applicationId={applicationId}
              onDone={() => {
                setPanel(null);
                interviews.refresh();
                mutateApplication();
              }}
            />
          )}
          {panel === 'offer' && (
            <CreateOffer
              slug={slug}
              applicationId={applicationId}
              onDone={(id) => router.push(`/teams/${slug}/offers/${id}`)}
            />
          )}
          {panel === 'message' && (
            <ComposeMessage
              slug={slug}
              applicationId={applicationId}
              onDone={() => setPanel(null)}
            />
          )}
          {!!interviews.data?.length && (
            <ul className="text-sm">
              {interviews.data.map((i) => (
                <li key={i.id}>
                  <Link
                    className="link"
                    href={`/teams/${slug}/interviews/${i.id}`}
                  >
                    {t('round', 'Round')} {i.round}
                  </Link>{' '}
                  {new Date(i.startsAt).toLocaleString()}{' '}
                  <span className="badge badge-sm">{i.status}</span>
                </li>
              ))}
            </ul>
          )}
          {!!offers.data?.length && (
            <ul className="text-sm">
              {offers.data.map((o) => (
                <li key={o.id}>
                  <Link className="link" href={`/teams/${slug}/offers/${o.id}`}>
                    {t('offer', 'Offer')}
                  </Link>{' '}
                  <span className="badge badge-sm">{o.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card.Body>
      </Card>

      {can('ai.use') && (
        <MatchPanel slug={slug} applicationId={applicationId} />
      )}

      {can('messages.send') && (
        <MessagesList slug={slug} applicationId={applicationId} />
      )}

      {answers.length > 0 && (
        <Card>
          <Card.Body>
            <Card.Header>
              <Card.Title>
                {t('screening-answers', 'Screening answers')}
              </Card.Title>
            </Card.Header>
            {answers.map((a) => (
              <div key={a.questionId} className="text-sm">
                <div className="font-medium">{a.prompt}</div>
                <div>
                  {Array.isArray(a.value)
                    ? a.value.join(', ')
                    : String(a.value)}
                </div>
              </div>
            ))}
          </Card.Body>
        </Card>
      )}

      <Card>
        <Card.Body>
          <Card.Header>
            <Card.Title>{t('activity', 'Activity')}</Card.Title>
          </Card.Header>
          <ol className="space-y-2 text-sm">
            {application.activities.map((a) => (
              <li key={a.id}>
                <span className="opacity-60">
                  {new Date(a.createdAt).toLocaleString()}
                </span>{' '}
                {a.type === 'STAGE_CHANGED'
                  ? `${stageName(a.fromStageId)} → ${stageName(a.toStageId)}`
                  : a.type}
              </li>
            ))}
          </ol>
        </Card.Body>
      </Card>
    </div>
  );
};

export default ApplicationDetail;
