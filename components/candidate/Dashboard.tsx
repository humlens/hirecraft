import { useMyProfile, useMySavedJobs } from 'hooks/useCandidate';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { ApplicationList } from './Applications';

const Dashboard = () => {
  const { t } = useTranslation('common');
  const { data: profile } = useMyProfile();
  const { data: saved } = useMySavedJobs();

  return (
    <div className="space-y-8">
      <section className="rounded border p-4">
        <h2 className="font-semibold">
          {t('profile-completeness', 'Profile completeness')}
        </h2>
        <progress
          className="progress progress-primary my-2 w-full"
          value={profile?.completeness ?? 0}
          max={100}
        />
        <p className="text-sm">
          {profile?.completeness ?? 0}%{' '}
          <Link className="link" href="/me/profile">
            {t('complete-profile', 'Complete your profile')}
          </Link>
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          {t('recent-applications', 'Recent applications')}
        </h2>
        <ApplicationList limit={3} />
        <Link
          className="link mt-2 inline-block text-sm"
          href="/me/applications"
        >
          {t('all-applications', 'All applications')}
        </Link>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">
          {t('saved-jobs', 'Saved jobs')}
        </h2>
        {!saved?.length ? (
          <p className="text-sm opacity-70">
            {t('no-saved-jobs', 'No saved jobs yet.')}
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {saved.map((j) => (
              <li key={j.id}>
                <Link
                  className="link"
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
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default Dashboard;
