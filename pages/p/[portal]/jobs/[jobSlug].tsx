import { formatLocation, formatSalary } from '@/components/public/JobCard';
import PortalLayout, {
  primaryButtonStyle,
} from '@/components/public/PortalLayout';
import {
  jobPostingJsonLd,
  safeJsonForScript,
  sanitizeJobHtml,
  stripHtml,
} from '@/lib/jobs';
import { getPortalProps, type PortalPageProps } from '@/lib/publicPage';
import type { GetServerSidePropsContext } from 'next';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { getPublicJob, type PublicJob } from 'models/publicPortal';
import type { NextPageWithLayout } from 'types';

type Props = PortalPageProps & { job?: PublicJob; jsonLd?: string };

const label = (s: string) =>
  s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

const JobPage: NextPageWithLayout<Props> = ({ job, jsonLd, ...layout }) => {
  const { t } = useTranslation('common');
  const { data: session } = useSession();
  const [saved, setSaved] = useState(false);
  const { portal } = layout;

  if (!job) {
    return <PortalLayout {...layout}>{null}</PortalLayout>;
  }

  const base = `/p/${portal.slug}`;
  const salary = formatSalary(job);

  const save = async () => {
    const r = await fetch('/api/candidate/saved-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: job.id }),
    });

    if (r.ok) {
      setSaved(true);
      toast.success(t('job-saved-for-later', 'Job saved.'));
    } else {
      toast.error(t('sign-in-to-save', 'Sign in to save jobs.'));
    }
  };

  return (
    <PortalLayout
      {...layout}
      title={`${job.title} - ${portal.name}`}
      description={stripHtml(job.descriptionHtml).slice(0, 160)}
      canonicalPath={`${base}/jobs/${job.slug}`}
      head={
        jsonLd ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: jsonLd }}
          />
        ) : null
      }
    >
      <article>
        <h1 className="text-3xl font-bold">{job.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="badge badge-outline">
            {label(job.employmentType)}
          </span>
          <span className="badge badge-outline">{label(job.workMode)}</span>
          {job.department && <span>{job.department}</span>}
          {formatLocation(job.locations) && (
            <span>{formatLocation(job.locations)}</span>
          )}
          {salary && <span>{salary}</span>}
          {job.experienceMin != null && (
            <span>
              {job.experienceMin}
              {job.experienceMax != null ? `-${job.experienceMax}` : '+'}{' '}
              {t('years', 'years')}
            </span>
          )}
        </div>

        <div className="my-6 flex flex-wrap gap-3">
          <Link
            href={`${base}/apply/${job.slug}`}
            className="btn"
            style={primaryButtonStyle(portal.branding.primaryColor)}
          >
            {t('apply-now', 'Apply now')}
          </Link>
          {session && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={save}
              disabled={saved}
            >
              {saved ? t('saved', 'Saved') : t('save-job', 'Save job')}
            </button>
          )}
        </div>

        <div
          className="prose max-w-none"
          dangerouslySetInnerHTML={{
            __html: sanitizeJobHtml(job.descriptionHtml),
          }}
        />

        {job.responsibilities.length > 0 && (
          <>
            <h2 className="mt-6 text-xl font-semibold">
              {t('responsibilities-title', 'Responsibilities')}
            </h2>
            <ul className="list-disc pl-6">
              {job.responsibilities.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}

        {job.skills.length > 0 && (
          <>
            <h2 className="mt-6 text-xl font-semibold">
              {t('skills', 'Skills')}
            </h2>
            <p className="flex flex-wrap gap-2">
              {job.skills.map((s) => (
                <span
                  key={s.skill}
                  className={`badge ${s.required ? 'badge-primary' : 'badge-outline'}`}
                >
                  {s.skill}
                </span>
              ))}
            </p>
          </>
        )}

        {job.benefits.length > 0 && (
          <>
            <h2 className="mt-6 text-xl font-semibold">
              {t('benefits-title', 'Benefits')}
            </h2>
            <ul className="list-disc pl-6">
              {job.benefits.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </>
        )}
      </article>
    </PortalLayout>
  );
};

JobPage.getLayout = (page) => page;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return getPortalProps(ctx, async (portal) => {
    const job = await getPublicJob(
      portal.team.id,
      String(ctx.params?.jobSlug ?? '')
    );

    if (!job) {
      return 'notFound' as const;
    }

    const name = portal.profile?.companyName ?? portal.team.name;
    const url = `${process.env.APP_URL}/p/${portal.team.slug}/jobs/${job.slug}`;

    return {
      job,
      jsonLd: safeJsonForScript(
        jobPostingJsonLd({
          job: { ...job, salaryVisible: job.salaryVisible },
          company: { name, website: portal.profile?.website },
          url,
        })
      ),
    };
  });
}

export default JobPage;
