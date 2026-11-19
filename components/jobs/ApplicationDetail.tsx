import { Avatar } from '@/components/ui';
import { Card, Error, Loading } from '@/components/shared';
import { defaultHeaders } from '@/lib/common';
import { useApplication } from 'hooks/usePipeline';
import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import toast from 'react-hot-toast';
import type { ApiResponse } from 'types';
import useApi, { send } from 'hooks/useApi';
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

  const candidateId = application?.candidate.id;
  const notes = useApi<{
    notes: {
      id: string;
      body: string;
      author: string | null;
      createdAt: string;
    }[];
  }>(
    candidateId && can('candidates.read')
      ? `/api/teams/${slug}/talent/${candidateId}`
      : null
  );
  const [note, setNote] = useState('');

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

  const stages = application.stages;
  const rejectStage = stages.find((s) => s.kind === 'REJECTED');
  const activeStages = stages.filter((s) => s.kind === 'ACTIVE');
  const idx = activeStages.findIndex((s) => s.id === application.stage.id);
  const nextStage =
    application.stage.kind === 'ACTIVE' ? activeStages[idx + 1] : undefined;
  const canMove = can('applications.manage') && !application.withdrawnAt;

  const addNote = async () => {
    const r = await send(
      `/api/teams/${slug}/talent/${application.candidate.id}/notes`,
      'POST',
      { body: note }
    );

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    setNote('');
    notes.refresh();
  };

  return (
    <div className="space-y-6">
      <Link
        className="link text-sm"
        href={`/teams/${slug}/jobs/${application.job.id}/pipeline`}
      >
        {`← ${application.job.title} ${t('pipeline', 'pipeline')}`}
      </Link>

      <Card>
        <Card.Body>
          <div className="flex flex-wrap items-center gap-4">
            <Avatar name={application.candidate.name} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-semibold">
                  {application.candidate.name}
                </h2>
                <span className="badge badge-primary badge-soft">
                  {application.stage.name}
                </span>
              </div>
              <p className="text-sm opacity-70">
                {[
                  application.candidate.email,
                  application.candidate.phone,
                  `${t('applied-on', 'Applied on')} ${new Date(application.appliedAt).toLocaleDateString()}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {application.rejectionReason && (
                <p className="text-sm">
                  {`${t('rejection-reason-label', 'Rejection reason')}: ${application.rejectionReason}`}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {application.resume && (
              <button type="button" className="btn btn-sm" onClick={download}>
                {t('download-resume', 'Download resume')} (
                {application.resume.fileName})
              </button>
            )}
            {canMove &&
              rejectStage &&
              application.stage.kind !== 'REJECTED' && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline btn-error"
                  onClick={() => move(rejectStage.id)}
                >
                  {`${t('reject', 'Reject')}…`}
                </button>
              )}
            {canMove && nextStage && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => move(nextStage.id)}
              >
                {t('shortlist', 'Shortlist')}
              </button>
            )}
            {canMove && (
              <select
                className="select select-sm"
                aria-label={t('move-to', 'Move to...')}
                value=""
                onChange={(e) => e.target.value && move(e.target.value)}
              >
                <option value="" disabled>
                  {t('move-to', 'Move to...')}
                </option>
                {stages
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          {can('ai.use') && (
            <MatchPanel slug={slug} applicationId={applicationId} />
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
          {can('messages.send') && (
            <MessagesList slug={slug} applicationId={applicationId} />
          )}
        </div>

        <div className="space-y-6">
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
                    onClick={() =>
                      setPanel(panel === 'message' ? null : 'message')
                    }
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
                      <Link
                        className="link"
                        href={`/teams/${slug}/offers/${o.id}`}
                      >
                        {t('offer', 'Offer')}
                      </Link>{' '}
                      <span className="badge badge-sm">{o.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card.Body>
          </Card>

          <Card>
            <Card.Body>
              <Card.Header>
                <Card.Title>{t('internal-notes', 'Internal notes')}</Card.Title>
              </Card.Header>
              <ul className="space-y-2 text-sm">
                {notes.data?.notes.map((n) => (
                  <li key={n.id} className="rounded-xl bg-base-200 p-3">
                    <p className="whitespace-pre-line">{n.body}</p>
                    <p className="text-xs opacity-60">
                      {`${n.author ?? ''} · ${new Date(n.createdAt).toLocaleString()}`}
                    </p>
                  </li>
                ))}
              </ul>
              {can('candidates.update') && (
                <div className="space-y-2">
                  <textarea
                    className="textarea w-full"
                    rows={2}
                    aria-label={t('new-note', 'New note')}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!note.trim()}
                    onClick={addNote}
                  >
                    {t('add-note', 'Add note')}
                  </button>
                </div>
              )}
            </Card.Body>
          </Card>

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
      </div>
    </div>
  );
};

export default ApplicationDetail;
