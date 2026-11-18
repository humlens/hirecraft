import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import type { PublicJobSummary } from 'models/publicPortal';

const label = (s: string) =>
  s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

export const formatLocation = (
  locations: {
    city: string | null;
    region: string | null;
    country: string | null;
  }[]
) =>
  locations
    .map((l) => [l.city, l.region, l.country].filter(Boolean).join(', '))
    .filter(Boolean)
    .join(' | ');

export const formatSalary = (
  j: Pick<
    PublicJobSummary,
    'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryVisible'
  >
) => {
  if (!j.salaryVisible || (j.salaryMin == null && j.salaryMax == null)) {
    return null;
  }

  const f = (n: number | null) => (n == null ? '' : n.toLocaleString('en-IN'));

  return `${j.salaryCurrency} ${f(j.salaryMin)}${j.salaryMax != null ? ` - ${f(j.salaryMax)}` : '+'}`;
};

const JobCard = ({ slug, job }: { slug: string; job: PublicJobSummary }) => {
  const { t } = useTranslation('common');
  const salary = formatSalary(job);

  return (
    <li className="rounded border p-4">
      <Link
        href={`/p/${slug}/jobs/${job.slug}`}
        className="text-lg font-semibold hover:underline"
      >
        {job.title}
      </Link>
      <div className="mt-1 flex flex-wrap gap-2 text-sm opacity-80">
        <span className="badge badge-outline">{label(job.employmentType)}</span>
        <span className="badge badge-outline">{label(job.workMode)}</span>
        {job.department && <span>{job.department}</span>}
        {formatLocation(job.locations) && (
          <span>{formatLocation(job.locations)}</span>
        )}
        {salary && <span>{salary}</span>}
      </div>
      {job.skills.length > 0 && (
        <p className="mt-2 text-xs opacity-70">
          {t('skills', 'Skills')}: {job.skills.map((s) => s.skill).join(', ')}
        </p>
      )}
    </li>
  );
};

export default JobCard;
