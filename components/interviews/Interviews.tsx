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
        <h2 className="text-xl font-medium">
          {data.candidate.name} - {data.job.title}
        </h2>
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
          <section className="space-y-3 rounded border p-3">
            <h3 className="font-semibold">{t('scorecard', 'Scorecard')}</h3>
            {COMPETENCIES.map((c) => (
              <div key={c} className="flex items-center gap-3 text-sm">
                <span className="w-40">{c}</span>
                <select
                  className="select select-bordered select-sm"
                  aria-label={c}
                  value={scores[c] ?? ''}
                  onChange={(e) =>
                    setScores({ ...scores, [c]: Number(e.target.value) })
                  }
                >
                  <option value="" disabled>
                    -
                  </option>
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <select
              className="select select-bordered select-sm"
              aria-label={t('recommendation', 'Recommendation')}
              value={rec}
              onChange={(e) => setRec(e.target.value)}
            >
              {['STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE'].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <textarea
              className="textarea textarea-bordered w-full"
              rows={3}
              aria-label={t('notes', 'Notes')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
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
    <div className="space-y-2 rounded border p-3 text-sm">
      <h4 className="font-semibold">
        {t('schedule-interview', 'Schedule interview')}
      </h4>
      <input
        type="datetime-local"
        className="input input-bordered input-sm"
        aria-label={t('starts-at', 'Starts at')}
        value={startsAt}
        onChange={(e) => setStartsAt(e.target.value)}
      />
      <input
        type="number"
        className="input input-bordered input-sm ml-2 w-24"
        aria-label={t('duration-min', 'Duration (min)')}
        value={duration}
        onChange={(e) => setDuration(e.target.value)}
      />
      <input
        className="input input-bordered input-sm ml-2"
        placeholder="https://meet..."
        aria-label={t('meeting-link', 'Meeting link')}
        value={link}
        onChange={(e) => setLink(e.target.value)}
      />
      <div className="flex flex-wrap gap-3">
        {(people.data ?? []).map((p) => (
          <label key={p.userId} className="flex items-center gap-1">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={picked.includes(p.userId)}
              onChange={(e) =>
                setPicked(
                  e.target.checked
                    ? [...picked, p.userId]
                    : picked.filter((x) => x !== p.userId)
                )
              }
            />
            {p.name}
          </label>
        ))}
      </div>
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
