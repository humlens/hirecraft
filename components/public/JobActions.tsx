import { primaryButtonStyle } from '@/components/public/PortalLayout';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useState } from 'react';
import toast from 'react-hot-toast';

/** Apply now / Save job / Share, used by the job page and the jobs split view. */
const JobActions = ({
  portalSlug,
  jobId,
  jobSlug,
  color,
}: {
  portalSlug: string;
  jobId: string;
  jobSlug: string;
  color: string;
}) => {
  const { t } = useTranslation('common');
  const { data: session } = useSession();
  const [saved, setSaved] = useState(false);

  const save = async () => {
    const r = await fetch('/api/candidate/saved-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
    });

    if (r.ok) {
      setSaved(true);
      toast.success(t('job-saved-for-later', 'Job saved.'));
    } else {
      toast.error(t('sign-in-to-save', 'Sign in to save jobs.'));
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/p/${portalSlug}/jobs/${jobSlug}`;

    try {
      if (navigator.share) {
        await navigator.share({ url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success(t('link-copied', 'Link copied.'));
      }
    } catch {
      // user cancelled sharing
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Link
        href={`/p/${portalSlug}/apply/${jobSlug}`}
        className="btn"
        style={primaryButtonStyle(color)}
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
      <button type="button" className="btn btn-outline" onClick={share}>
        {t('share', 'Share')}
      </button>
    </div>
  );
};

export default JobActions;
