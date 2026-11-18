import { Loading } from '@/components/shared';
import PortalLayout, {
  primaryButtonStyle,
} from '@/components/public/PortalLayout';
import { getPortalProps, type PortalPageProps } from '@/lib/publicPage';
import type { GetServerSidePropsContext } from 'next';
import { signIn, useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { getPublicJob, type PublicJob } from 'models/publicPortal';
import type { NextPageWithLayout } from 'types';

type Props = PortalPageProps & { job?: PublicJob };
type Resume = {
  id: string;
  fileName: string;
  size: number;
  isDefault: boolean;
};
type Answer = string | number | boolean | string[];

const json = { 'Content-Type': 'application/json' };

const ApplyPage: NextPageWithLayout<Props> = ({ job, ...layout }) => {
  const { t } = useTranslation('common');
  const { status } = useSession();
  const { portal } = layout;

  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [auth, setAuth] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [verifyNotice, setVerifyNotice] = useState(false);
  const [busy, setBusy] = useState(false);

  const [resumes, setResumes] = useState<Resume[]>([]);
  const [resumeId, setResumeId] = useState('');
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [consent, setConsent] = useState(false);
  const [talentPool, setTalentPool] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const loadResumes = useCallback(async () => {
    const r = await fetch('/api/candidate/resumes');

    if (r.ok) {
      const list = ((await r.json()).data ?? []) as Resume[];

      setResumes(list);
      setResumeId(
        (cur) => cur || list.find((x) => x.isDefault)?.id || list[0]?.id || ''
      );
    }
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      loadResumes();
    }
  }, [status, loadResumes]);

  if (!job) {
    return <PortalLayout {...layout}>{null}</PortalLayout>;
  }

  const base = `/p/${portal.slug}`;
  const primary = portal.branding.primaryColor;

  const submitAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setAuthError('');

    if (mode === 'register') {
      const r = await fetch('/api/candidate/register', {
        method: 'POST',
        headers: json,
        body: JSON.stringify(auth),
      });
      const body = await r.json();

      if (!r.ok) {
        setAuthError(body.error?.message ?? 'Error');
        setBusy(false);

        return;
      }

      if (body.data.confirmEmail) {
        setVerifyNotice(true);
        setMode('login');
        setBusy(false);

        return;
      }
    }

    const res = await signIn('credentials', {
      email: auth.email,
      password: auth.password,
      redirect: false,
    });

    if (res && !res.ok) {
      setAuthError(res.error ?? 'Sign in failed');
    }

    setBusy(false);
  };

  const upload = async (file: File) => {
    setError('');

    const r = await fetch('/api/candidate/resumes', {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: file,
    });
    const body = await r.json();

    if (!r.ok) {
      setError(body.error?.message ?? 'Upload failed');

      return;
    }

    setResumeId(body.data.id);
    loadResumes();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');

    const r = await fetch(
      `/api/public/portals/${portal.slug}/jobs/${job.slug}/apply`,
      {
        method: 'POST',
        headers: json,
        body: JSON.stringify({
          resumeId,
          answers,
          consent: { application: consent, talentPool },
        }),
      }
    );
    const body = await r.json();

    setBusy(false);

    if (!r.ok) {
      setError(body.error?.message ?? 'Error');

      return;
    }

    setDone(true);
  };

  const setAnswer = (id: string, v: Answer) =>
    setAnswers((a) => ({ ...a, [id]: v }));

  return (
    <PortalLayout
      {...layout}
      title={`${t('apply-to', 'Apply to')} ${job.title} - ${portal.name}`}
      noindex
    >
      <h1 className="mb-1 text-2xl font-bold">
        {t('apply-to', 'Apply to')} {job.title}
      </h1>
      <p className="mb-6 text-sm opacity-70">
        <Link className="link" href={`${base}/jobs/${job.slug}`}>
          {t('back-to-job', 'Back to the job')}
        </Link>
      </p>

      {status === 'loading' && <Loading />}

      {done && (
        <div role="status" className="alert alert-success">
          <span>
            {t('application-submitted', 'Application submitted.')}{' '}
            <Link className="link" href="/me/applications">
              {t('track-application', 'Track your application')}
            </Link>
          </span>
        </div>
      )}

      {!done && status === 'unauthenticated' && (
        <form onSubmit={submitAuth} className="max-w-md space-y-3">
          <div role="tablist" className="tabs tabs-boxed">
            <button
              type="button"
              role="tab"
              className={`tab ${mode === 'register' ? 'tab-active' : ''}`}
              onClick={() => setMode('register')}
            >
              {t('create-account', 'Create account')}
            </button>
            <button
              type="button"
              role="tab"
              className={`tab ${mode === 'login' ? 'tab-active' : ''}`}
              onClick={() => setMode('login')}
            >
              {t('sign-in', 'Sign in')}
            </button>
          </div>
          {verifyNotice && (
            <p role="status" className="alert alert-info text-sm">
              {t(
                'verify-email-then-sign-in',
                'Check your email to verify your account, then sign in.'
              )}
            </p>
          )}
          {mode === 'register' && (
            <input
              className="input input-bordered w-full"
              placeholder="Your name"
              aria-label={t('your-name', 'Your name')}
              required
              value={auth.name}
              onChange={(e) => setAuth({ ...auth, name: e.target.value })}
            />
          )}
          <input
            className="input input-bordered w-full"
            type="email"
            placeholder="Email"
            aria-label={t('email')}
            required
            value={auth.email}
            onChange={(e) => setAuth({ ...auth, email: e.target.value })}
          />
          <input
            className="input input-bordered w-full"
            type="password"
            placeholder="Password"
            aria-label={t('password', 'Password')}
            required
            minLength={mode === 'register' ? 8 : 1}
            value={auth.password}
            onChange={(e) => setAuth({ ...auth, password: e.target.value })}
          />
          {authError && (
            <p role="alert" className="text-sm text-error">
              {authError}
            </p>
          )}
          <button
            type="submit"
            className="btn"
            style={primaryButtonStyle(primary)}
            disabled={busy}
          >
            {mode === 'register'
              ? t('create-account-continue', 'Create account and continue')
              : t('sign-in', 'Sign in')}
          </button>
        </form>
      )}

      {!done && status === 'authenticated' && (
        <form onSubmit={submit} className="max-w-2xl space-y-6">
          <fieldset className="space-y-2">
            <legend className="font-semibold">{t('resume', 'Resume')}</legend>
            {resumes.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="resume"
                  className="radio radio-sm"
                  checked={resumeId === r.id}
                  onChange={() => setResumeId(r.id)}
                />
                {`${r.fileName} (${Math.round(r.size / 1024)} ${t('kb', 'KB')})`}
              </label>
            ))}
            <label className="block text-sm">
              <span className="mb-1 block">
                {t('upload-resume', 'Upload a resume (PDF or DOCX, max 5 MB)')}
              </span>
              <input
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="file-input file-input-bordered file-input-sm w-full"
                data-testid="resume-upload"
                onChange={(e) =>
                  e.target.files?.[0] && upload(e.target.files[0])
                }
              />
            </label>
          </fieldset>

          {job.questions.length > 0 && (
            <fieldset className="space-y-4">
              <legend className="font-semibold">
                {t('screening-questions', 'Screening questions')}
              </legend>
              {job.questions.map((q) => (
                <div key={q.id} className="space-y-1 text-sm">
                  <label className="font-medium" htmlFor={`q-${q.id}`}>
                    {q.prompt}
                    {q.required && <span aria-hidden="true"> *</span>}
                  </label>
                  {q.type === 'TEXT' && (
                    <textarea
                      id={`q-${q.id}`}
                      className="textarea textarea-bordered w-full"
                      required={q.required}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                    />
                  )}
                  {q.type === 'NUMBER' && (
                    <input
                      id={`q-${q.id}`}
                      type="number"
                      className="input input-bordered w-full"
                      required={q.required}
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                    />
                  )}
                  {q.type === 'BOOLEAN' && (
                    <select
                      id={`q-${q.id}`}
                      className="select select-bordered w-full"
                      required={q.required}
                      defaultValue=""
                      onChange={(e) =>
                        e.target.value &&
                        setAnswer(q.id, e.target.value === 'yes')
                      }
                    >
                      <option value="" disabled>
                        {t('choose', 'Choose')}
                      </option>
                      <option value="yes">{t('yes', 'Yes')}</option>
                      <option value="no">{t('no', 'No')}</option>
                    </select>
                  )}
                  {q.type === 'SINGLE' && (
                    <select
                      id={`q-${q.id}`}
                      className="select select-bordered w-full"
                      required={q.required}
                      defaultValue=""
                      onChange={(e) => setAnswer(q.id, e.target.value)}
                    >
                      <option value="" disabled>
                        {t('choose', 'Choose')}
                      </option>
                      {q.options.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  )}
                  {q.type === 'MULTI' &&
                    q.options.map((o) => (
                      <label key={o} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          onChange={(e) => {
                            const cur =
                              (answers[q.id] as string[] | undefined) ?? [];

                            setAnswer(
                              q.id,
                              e.target.checked
                                ? [...cur, o]
                                : cur.filter((x) => x !== o)
                            );
                          }}
                        />
                        {o}
                      </label>
                    ))}
                </div>
              ))}
            </fieldset>
          )}

          <fieldset className="space-y-2 text-sm">
            <legend className="font-semibold">{t('consent', 'Consent')}</legend>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm mt-0.5"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                {t(
                  'consent-application',
                  'I agree that my application and profile are shared with'
                )}{' '}
                {portal.name} {t('consent-privacy', 'as described in their')}{' '}
                <Link className="link" href={`${base}/privacy`} target="_blank">
                  {t('privacy-policy', 'Privacy policy')}
                </Link>
                .
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm mt-0.5"
                checked={talentPool}
                onChange={(e) => setTalentPool(e.target.checked)}
              />
              <span>
                {t(
                  'consent-talent-pool',
                  'Optional: keep me in their talent pool for future roles.'
                )}
              </span>
            </label>
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="btn"
            style={primaryButtonStyle(primary)}
            disabled={busy || !consent || !resumeId}
          >
            {t('submit-application', 'Submit application')}
          </button>
        </form>
      )}
    </PortalLayout>
  );
};

ApplyPage.getLayout = (page) => page;

export async function getServerSideProps(ctx: GetServerSidePropsContext) {
  return getPortalProps(ctx, async (portal) => {
    const job = await getPublicJob(
      portal.team.id,
      String(ctx.params?.jobSlug ?? '')
    );

    return job ? { job } : ('notFound' as const);
  });
}

export default ApplyPage;
