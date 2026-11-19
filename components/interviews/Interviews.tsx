import InterviewAssist from '@/components/ai/InterviewAssist';
import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useState } from 'react';
import toast from 'react-hot-toast';

export type InterviewView = {
  id: string;
  applicationId: string;
  round: number;
  startsAt: string;
  durationMin: number;
  location: string | null;
  meetingUrl: string | null;
  status: string;
  job: { id: string; title: string };
  candidate: { id: string; name: string };
  participants: { userId: string; name: string; submitted: boolean }[];
  feedback: {
    userId: string;
    name: string;
    scores: Record<string, number>;
    recommendation: string;
    notes: string | null;
  }[];
};

export const COMPETENCIES = [
  'Technical skills',
  'Problem solving',
  'Communication',
  'Culture fit',
];

export const InterviewsList = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const { data, isLoading, isError } = useApi<InterviewView[]>(
    `/api/teams/${slug}/interviews`
  );

  if (isLoading) return <Loading />;
  if (isError) return <Error message={isError.message} />;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-medium">{t('interviews', 'Interviews')}</h2>
      {data?.length === 0 && (
        <p className="text-sm opacity-70">
          {t('no-interviews', 'No interviews.')}
        </p>
      )}
      <ul className="space-y-2">
        {(data ?? []).map((i) => (
          <li
            key={i.id}
            className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm"
          >
            <Link
              className="link font-medium"
              href={`/teams/${slug}/interviews/${i.id}`}
            >
              {i.candidate.name}
            </Link>
            <span>{i.job.title}</span>
            <span>{new Date(i.startsAt).toLocaleString()}</span>
            <span className="badge">{i.status}</span>
            <span className="opacity-60">
              {i.participants.map((p) => p.name).join(', ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const InterviewDetail = ({
  slug,
  interviewId,
}: {
  slug: string;
  interviewId: string;
}) => {
  const { t } = useTranslation('common');
  const { can } = usePortalAccess(slug);
  const { data, isLoading, isError, refresh } = useApi<InterviewView>(
    `/api/teams/${slug}/interviews/${interviewId}`
  );
  const [scores, setScores] = useState<Record<string, number>>({});
  const [rec, setRec] = useState('HIRE');
  const [notes, setNotes] = useState('');

  if (isLoading) return <Loading />;
  if (isError) return <Error message={isError.message} />;
  if (!data) return null;

  const submit = async () => {
    const r = await send(
      `/api/teams/${slug}/interviews/${interviewId}/feedback`,
      'PUT',
      {
        scores,
        recommendation: rec,
        notes: notes || null,
      }
    );

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    toast.success(t('feedback-saved', 'Feedback saved.'));
    refresh();
  };

  const cancel = async () => {
    const r = await send(
      `/api/teams/${slug}/interviews/${interviewId}`,
      'PUT',
      { status: 'CANCELLED' }
    );

    if (r.ok) refresh();
    else toast.error(r.error as string);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold">
          {t('interview-feedback', 'Interview & feedback')}
        </h2>
        <p className="text-sm opacity-70">{`${data.candidate.name} · ${data.job.title}`}</p>
        <p className="text-sm opacity-70">
          {t('round', 'Round')} {data.round} |{' '}
          {new Date(data.startsAt).toLocaleString()} | {data.durationMin}{' '}
          {t('minutes-short', 'min')} |{' '}
          <span className="badge">{data.status}</span>
        </p>
        <p className="text-sm">
          {data.location}{' '}
          {data.meetingUrl && (
            <a
              className="link"
              href={data.meetingUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {data.meetingUrl}
            </a>
          )}
        </p>
        <p className="text-sm">
          {data.participants
            .map((p) => `${p.name}${p.submitted ? ' ✓' : ''}`)
            .join(', ')}
        </p>
        {can('interviews.manage') && data.status === 'SCHEDULED' && (
          <button
            type="button"
            className="btn btn-sm btn-error btn-outline mt-2"
            onClick={cancel}
          >
            {t('cancel-interview', 'Cancel interview')}
          </button>
        )}
      </div>

      {can('feedback.submit') &&
        data.participants.length > 0 &&
        data.status !== 'CANCELLED' && (
          <section className="space-y-3 rounded-2xl border bg-base-100 p-5">
            <h3 className="font-display font-semibold">
              {`2 · ${t('hm-scorecard', 'Hiring manager scorecard')}`}
            </h3>
            {COMPETENCIES.map((c) => (
              <div
                key={c}
                className="flex flex-wrap items-center gap-3 text-sm"
              >
                <span className="w-40">{c}</span>
                <div role="radiogroup" aria-label={c} className="flex gap-1">
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={scores[c] === n}
                      onClick={() => setScores({ ...scores, [c]: n })}
                      className={`h-9 w-9 rounded-lg border text-sm ${
                        scores[c] === n
                          ? 'border-primary bg-primary font-semibold text-primary-content'
                          : 'hover:bg-base-200'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div
              role="radiogroup"
              aria-label={t('recommendation', 'Recommendation')}
              className="flex flex-wrap gap-2"
            >
              {[
                ['STRONG_HIRE', t('strong-hire', 'Strong hire')],
                ['HIRE', t('hire', 'Hire')],
                ['NO_HIRE', t('no-hire', 'No hire')],
                ['STRONG_NO_HIRE', t('strong-no-hire', 'Strong no hire')],
              ].map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={rec === v}
                  onClick={() => setRec(v)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    rec === v
                      ? 'border-primary bg-primary text-primary-content'
                      : 'hover:bg-base-200'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            <label className="block text-sm">
              <span className="mb-1 block">
                {t('evidence-notes', 'Evidence & notes')}
              </span>
              <textarea
                className="textarea w-full"
                rows={4}
                aria-label={t('notes', 'Notes')}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={Object.keys(scores).length === 0}
              onClick={submit}
            >
              {t('submit-feedback', 'Submit feedback')}
            </button>
          </section>
        )}

      {can('ai.use') && can('interviews.manage') && (
        <InterviewAssist
          slug={slug}
          interviewId={interviewId}
          applicationId={data.applicationId}
          canQuestions={can('interviews.manage')}
          canSummary={can('interviews.manage')}
        />
      )}

      <section className="space-y-2">
        <h3 className="font-semibold">{t('feedback', 'Feedback')}</h3>
        {data.feedback.length === 0 && (
          <p className="text-sm opacity-70">
            {t('no-feedback', 'No feedback visible yet.')}
          </p>
        )}
        {data.feedback.map((f) => (
          <div key={f.userId} className="rounded border p-3 text-sm">
            <p className="font-medium">
              {f.name} <span className="badge ml-2">{f.recommendation}</span>
            </p>
            <p>
              {Object.entries(f.scores)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' | ')}
            </p>
            {f.notes && <p className="whitespace-pre-line">{f.notes}</p>}
          </div>
        ))}
      </section>
    </div>
  );
};

type Person = {
  userId: string;
  name: string;
  email: string;
  role: string | null;
};

/** Schedule an interview (used on the application page). */
export const ScheduleInterview = ({
  slug,
  applicationId,
  onDone,
}: {
  slug: string;
  applicationId: string;
  onDone: () => void;
}) => {
  const { t } = useTranslation('common');
  const people = useApi<Person[]>(
    `/api/teams/${slug}/people?permission=feedback.submit`
  );
  const [startsAt, setStartsAt] = useState('');
  const [duration, setDuration] = useState('45');
  const [link, setLink] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const submit = async () => {
    const r = await send(
      `/api/teams/${slug}/applications/${applicationId}/interviews`,
      'POST',
      {
        startsAt: new Date(startsAt).toISOString(),
        durationMin: Number(duration) || 45,
        meetingUrl: link || null,
        participantIds: picked,
      }
    );

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    toast.success(
      t(
        'interview-scheduled',
        'Interview scheduled. An invitation draft was created in Messages.'
      )
    );
    onDone();
  };

  return (
    <div className="space-y-3 rounded-2xl border bg-base-100 p-5 text-sm">
      <h4 className="font-display font-semibold">
        {`1 · ${t('schedule-interview', 'Schedule interview')}`}
      </h4>
      <div className="flex flex-wrap gap-3">
        <label className="block">
          <span className="mb-1 block opacity-70">
            {t('starts-at', 'Starts at')}
          </span>
          <input
            type="datetime-local"
            className="input input-sm"
            aria-label={t('starts-at', 'Starts at')}
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-1 block opacity-70">
            {t('duration-min', 'Duration (min)')}
          </span>
          <select
            className="select select-sm"
            aria-label={t('duration-min', 'Duration (min)')}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          >
            {['30', '45', '60', '90'].map((d) => (
              <option key={d} value={d}>
                {`${d} ${t('minutes-short', 'min')}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <span className="mb-1 block opacity-70">
          {t('interviewers', 'Interviewers')}
        </span>
        <div className="flex flex-wrap gap-2">
          {(people.data ?? []).map((p) => {
            const on = picked.includes(p.userId);

            return (
              <label
                key={p.userId}
                className={`flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1 ${
                  on ? 'border-primary bg-primary/10 text-primary' : ''
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked
                        ? [...picked, p.userId]
                        : picked.filter((x) => x !== p.userId)
                    )
                  }
                />
                {`${on ? '✓ ' : ''}${p.name}`}
              </label>
            );
          })}
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block opacity-70">
          {t('meeting-link', 'Meeting link')}
        </span>
        <input
          className="input input-sm w-full"
          placeholder="https://meet..."
          aria-label={t('meeting-link', 'Meeting link')}
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
      </label>
      <p className="text-xs opacity-70">
        {t(
          'invite-approval-note',
          'The candidate gets an invitation that you approve first.'
        )}
      </p>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={!startsAt || picked.length === 0}
        onClick={submit}
      >
        {t('schedule', 'Schedule')}
      </button>
    </div>
  );
};
