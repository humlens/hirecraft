import { Panel, Tabs } from '@/components/ui';
import { useMyProfile, useMySavedJobs } from 'hooks/useCandidate';
import useApi, { send } from 'hooks/useApi';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { ApplicationList } from './Applications';
import Recommendations from './Recommendations';

const Dashboard = () => {
  const { t } = useTranslation('common');
  const { data: profile } = useMyProfile();
  const { data: saved } = useMySavedJobs();
  const { data: interviews } = useApi<
    {
      id: string;
      startsAt: string;
      durationMin: number;
      location: string | null;
      meetingUrl: string | null;
      job: string;
      portal: string;
    }[]
  >('/api/candidate/interviews');

  const [tab, setTab] = useState<'apps' | 'reco' | 'saved'>('apps');
  const { data: session } = useSession();
  const { data: notes, refresh } = useApi<{
    notifications: {
      id: string;
      title: string;
      link: string | null;
      readAt: string | null;
    }[];
    unread: number;
  }>('/api/notifications');
  const name = session?.user?.name?.split(' ')[0] ?? '';
  const done = profile?.completeness ?? 0;

  const markAll = async () => {
    await send('/api/notifications', 'POST', { all: true });
    refresh();
  };

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-display text-2xl font-bold">
          {`${t('hi', 'Hi')}${name ? ` ${name}` : ''}`}
        </h2>
        <p className="mt-1 text-sm opacity-70">
          {`${t('profile-completeness', 'Profile completeness')}: ${done}%`}{' '}
          {done < 100 && (
            <Link className="link" href="/me/profile">
              {t('complete-profile', 'Complete your profile')}
            </Link>
          )}
        </p>
        <progress
          className="progress progress-primary mt-2 w-full max-w-md"
          value={done}
          max={100}
        />
      </section>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'apps', label: t('applications', 'Applications') },
          { value: 'reco', label: t('ai-recommended', 'Recommended for you') },
          { value: 'saved', label: t('saved-jobs', 'Saved jobs') },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {tab === 'apps' && <ApplicationList limit={10} />}
          {tab === 'reco' && <Recommendations />}
          {tab === 'saved' && (
            <>
              {!saved?.length ? (
                <p className="text-sm opacity-70">
                  {t('no-saved-jobs', 'No saved jobs yet.')}
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {saved.map((j) => (
                    <Panel as="li" pad="sm" key={j.id}>
                      <Link
                        className="font-display font-semibold hover:underline"
                        href={`/p/${j.portal.slug}/jobs/${j.slug}`}
                      >
                        {j.title}
                      </Link>{' '}
                      <span className="opacity-60">{j.portal.name}</span>
                      {!j.open && (
                        <span className="badge badge-sm ml-2">
                          {t('closed', 'Closed')}
                        </span>
                      )}
                    </Panel>
                  ))}
                </ul>
              )}
            </>
          )}

          {!!interviews?.length && (
            <section>
              <h2 className="mb-3 font-display text-lg font-semibold">
                {t('upcoming-interviews', 'Upcoming interviews')}
              </h2>
              <ul className="space-y-2 text-sm">
                {interviews.map((i) => (
                  <Panel as="li" pad="sm" key={i.id}>
                    <span className="font-medium">{i.job}</span> - {i.portal}
                    <div>{`${new Date(i.startsAt).toLocaleString()} (${i.durationMin} ${t('minutes-short', 'min')})`}</div>
                    {i.location && <div>{i.location}</div>}
                    {i.meetingUrl && (
                      <a
                        className="link"
                        href={i.meetingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {i.meetingUrl}
                      </a>
                    )}
                  </Panel>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <Panel>
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold">
                {t('notifications', 'Notifications')}
              </h2>
              {!!notes?.unread && (
                <button
                  type="button"
                  className="link text-xs"
                  onClick={markAll}
                >
                  {t('mark-all-read', 'Mark all read')}
                </button>
              )}
            </div>
            {!notes?.notifications.length ? (
              <p className="mt-2 text-sm opacity-70">
                {t('no-notifications', 'No notifications.')}
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {notes.notifications.slice(0, 5).map((n) => (
                  <li key={n.id} className={n.readAt ? 'opacity-60' : ''}>
                    {n.link ? <Link href={n.link}>{n.title}</Link> : n.title}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel>
            <h2 className="font-display font-semibold">
              {t('my-privacy', 'Privacy')}
            </h2>
            <p className="mt-2 text-sm opacity-70">
              {t(
                'candidate-privacy-note',
                'Your data is only shared with companies you apply to. Export or erase it any time.'
              )}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/me/privacy" className="btn btn-sm btn-outline">
                {t('export-my-data', 'Export my data')}
              </Link>
              <Link href="/me/privacy" className="btn btn-sm btn-outline">
                {t('consent-settings', 'Consent settings')}
              </Link>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
};

export default Dashboard;
