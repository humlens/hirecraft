import { Avatar } from '@/components/ui';
import { Error, Loading } from '@/components/shared';
import useApi, { send } from 'hooks/useApi';
import usePortalAccess from 'hooks/usePortalAccess';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';

type Item = {
  applicationId: string;
  job: { id: string; title: string };
  candidate: {
    name: string;
    headline: string | null;
    location: string | null;
    skills: string[];
  };
  match: {
    score: number;
    explanation: string;
    matchedSkills: string[];
    missingSkills: string[];
  } | null;
  nextStage: { id: string; name: string } | null;
};
type Queue = {
  counts: { toReview: number; shortlistedToday: number };
  items: Item[];
};
type Interview = {
  id: string;
  startsAt: string;
  round: number;
  candidate: { name: string };
  job: { title: string };
};

/**
 * Mobile-first recruiter review queue: one candidate at a time, with the AI
 * hint as a suggestion. Shortlisting uses the normal audited stage change;
 * "Later" only skips the card on this device.
 */
const ReviewQueue = ({ slug }: { slug: string }) => {
  const { t } = useTranslation('common');
  const { can, canAny } = usePortalAccess(slug);
  const queue = useApi<Queue>(`/api/teams/${slug}/review-queue`);
  const range = useMemo(() => {
    const a = new Date();
    const b = new Date();

    a.setHours(0, 0, 0, 0);
    b.setHours(23, 59, 59, 999);

    return `from=${a.toISOString()}&to=${b.toISOString()}`;
  }, []);
  const interviews = useApi<Interview[]>(
    canAny('interviews.manage', 'feedback.submit')
      ? `/api/teams/${slug}/interviews?${range}&status=SCHEDULED`
      : null
  );
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (queue.isLoading) return <Loading />;
  if (queue.isError) return <Error message={queue.isError.message} />;
  if (!queue.data) return null;

  const items = queue.data.items.filter(
    (i) => !skipped.includes(i.applicationId)
  );
  const card = items[0];

  const shortlist = async (i: Item) => {
    if (!i.nextStage) return;

    setBusy(true);

    const r = await send(`/api/teams/${slug}/applications/stage`, 'POST', {
      applicationId: i.applicationId,
      stageId: i.nextStage.id,
    });

    setBusy(false);

    if (!r.ok) {
      toast.error(r.error as string);
      return;
    }

    toast.success(
      t('review-shortlisted', 'Moved to {{stage}}.', {
        stage: i.nextStage.name,
      })
    );
    queue.refresh();
  };

  return (
    <div className="mx-auto max-w-md space-y-4 pb-24">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          [queue.data.counts.toReview, t('review-to-review', 'To review')],
          [
            queue.data.counts.shortlistedToday,
            t('review-shortlisted-today', 'Moved today'),
          ],
          [
            (interviews.data ?? []).length,
            t('review-interviews-today', 'Interviews today'),
          ],
        ].map(([n, label]) => (
          <div key={label as string} className="rounded-lg bg-base-200 p-2">
            <div className="text-xl font-semibold">{n}</div>
            <div className="text-xs opacity-70">{label}</div>
          </div>
        ))}
      </div>

      <h2 className="text-sm font-semibold">
        {t('review-queue', 'Review queue')}
      </h2>

      {card ? (
        <>
          <article
            className="space-y-3 rounded-2xl border p-4"
            aria-label={card.candidate.name}
          >
            <div className="flex items-center gap-3">
              <Avatar name={card.candidate.name} />
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-lg">
                  {card.candidate.name}
                </strong>
                <span className="block truncate text-sm opacity-70">
                  {[card.candidate.headline, card.candidate.location]
                    .filter(Boolean)
                    .join(' · ') || card.job.title}
                </span>
              </div>
              {card.match && (
                <span className="text-xl font-bold text-success">
                  {card.match.score}%
                </span>
              )}
            </div>
            <p className="text-xs opacity-70">{card.job.title}</p>
            {card.match && (
              <p className="rounded-lg bg-success/10 p-2 text-sm">
                {card.match.explanation}
                <span className="mt-1 block text-xs opacity-70">
                  {t('review-ai-note', 'An AI suggestion. You decide.')}
                </span>
              </p>
            )}
            <div className="flex flex-wrap gap-1">
              {card.candidate.skills.map((s) => (
                <span key={s} className="badge badge-outline badge-sm">
                  {s}
                </span>
              ))}
            </div>
            <Link
              className="link text-sm font-semibold"
              href={`/teams/${slug}/applications/${card.applicationId}`}
            >
              {t('review-open', 'Open full profile')}
            </Link>
          </article>
          <div className="flex gap-3">
            <button
              type="button"
              className="btn min-h-12 flex-1"
              onClick={() => setSkipped([...skipped, card.applicationId])}
            >
              {t('review-later', 'Later')}
            </button>
            {can('applications.manage') && (
              <button
                type="button"
                className="btn btn-primary min-h-12 flex-1"
                disabled={busy || !card.nextStage}
                onClick={() => shortlist(card)}
              >
                {t('review-shortlist', 'Shortlist')}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2 rounded-2xl border border-dashed p-6 text-center">
          <strong>{t('review-cleared', 'Queue cleared')}</strong>
          <p className="text-sm opacity-70">
            {t('review-cleared-note', 'Nothing is waiting for review.')}
          </p>
          {skipped.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setSkipped([])}
            >
              {t('review-start-over', 'Show skipped again')}
            </button>
          )}
        </div>
      )}

      {interviews.data && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">
            {t('review-todays-interviews', "Today's interviews")}
          </h2>
          {interviews.data.length === 0 && (
            <p className="text-sm opacity-70">
              {t('review-no-interviews', 'No interviews today.')}
            </p>
          )}
          {interviews.data.map((i) => (
            <Link
              key={i.id}
              href={`/teams/${slug}/interviews/${i.id}`}
              className="flex items-center justify-between rounded-xl border p-3 text-sm"
            >
              <span>
                <strong className="block">{i.candidate.name}</strong>
                <span className="opacity-70">
                  {i.job.title} · {t('round', 'Round')} {i.round}
                </span>
              </span>
              <span className="font-semibold">
                {new Date(i.startsAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
};

export default ReviewQueue;
