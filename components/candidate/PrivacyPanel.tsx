import { defaultHeaders } from '@/lib/common';
import { signOut } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import toast from 'react-hot-toast';
import type { ApiResponse } from 'types';
import AiConsent from './AiConsent';

const PrivacyPanel = () => {
  const { t } = useTranslation('common');

  const exportData = async () => {
    const r = await fetch('/api/candidate/privacy');
    const body = await r.json();

    if (!r.ok) {
      toast.error(body.error.message);
      return;
    }

    const blob = new Blob([JSON.stringify(body.data, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');

    a.href = URL.createObjectURL(blob);
    a.download = 'my-data.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const erase = async () => {
    if (
      !window.confirm(
        t(
          'confirm-delete-account',
          'Permanently delete your account and personal data? This cannot be undone.'
        )
      )
    ) {
      return;
    }

    const r = await fetch('/api/candidate/privacy', {
      method: 'DELETE',
      headers: defaultHeaders,
    });

    if (!r.ok) {
      toast.error(((await r.json()) as ApiResponse).error.message);
      return;
    }

    await signOut({ callbackUrl: '/' });
  };

  return (
    <div className="space-y-8">
      <AiConsent />
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          {t('export-my-data', 'Export my data')}
        </h2>
        <p className="text-sm opacity-70">
          {t(
            'export-description',
            'Download everything we hold about you as a JSON file.'
          )}
        </p>
        <button type="button" className="btn btn-sm" onClick={exportData}>
          {t('download-my-data', 'Download my data')}
        </button>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold text-error">
          {t('delete-my-account', 'Delete my account')}
        </h2>
        <p className="text-sm opacity-70">
          {t(
            'delete-account-description',
            'Your profile, resumes and account are deleted. Employers keep only an anonymised application record.'
          )}
        </p>
        <button type="button" className="btn btn-sm btn-error" onClick={erase}>
          {t('delete-my-account', 'Delete my account')}
        </button>
      </section>
    </div>
  );
};

export default PrivacyPanel;
