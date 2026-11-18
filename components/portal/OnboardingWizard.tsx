import { Card, InputWithLabel } from '@/components/shared';
import { defaultHeaders } from '@/lib/common';
import { slugify, slugifyInput } from '@/lib/slug';
import type { Team } from '@prisma/client';
import useTeams from 'hooks/useTeams';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';
import { useState } from 'react';
import useSWR from 'swr';
import fetcher from '@/lib/fetcher';
import { Button } from '@/components/ui/daisy';
import toast from 'react-hot-toast';
import type { ApiResponse } from 'types';

const STEPS = ['account', 'details', 'branding', 'done'] as const;

const OnboardingWizard = () => {
  const { t } = useTranslation('common');
  const router = useRouter();
  const { data: session } = useSession();
  const { mutateTeams } = useTeams();
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [form, setForm] = useState({
    name: '',
    slug: '',
    website: '',
    contactEmail: '',
    industry: '',
    description: '',
    primaryColor: '#3346D3',
    theme: 'SYSTEM',
    heroTitle: '',
    heroSubtitle: '',
  });

  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => {
      const next = { ...f, [key]: value };

      if (key === 'name' && !slugTouched) {
        next.slug = slugify(value);
      }

      return next;
    });

  const slugValue = slugify(form.slug);
  const { data: slugCheck } = useSWR<{ data: { available: boolean } }>(
    step === 1 && slugValue.length >= 3
      ? `/api/teams/slug-check?slug=${slugValue}`
      : null,
    fetcher
  );
  const available = slugCheck?.data?.available;

  const detailsValid =
    form.name.trim().length > 0 &&
    slugify(form.slug).length >= 3 &&
    available !== false;

  const create = async () => {
    setSubmitting(true);

    const response = await fetch('/api/teams', {
      method: 'POST',
      headers: defaultHeaders,
      body: JSON.stringify({
        name: form.name.trim(),
        slug: slugify(form.slug),
        completeOnboarding: true,
        profile: {
          companyName: form.name.trim(),
          website: form.website,
          contactEmail: form.contactEmail,
          industry: form.industry,
          description: form.description,
        },
        branding: {
          primaryColor: form.primaryColor,
          theme: form.theme,
          heroTitle: form.heroTitle,
          heroSubtitle: form.heroSubtitle,
        },
      }),
    });

    const json = (await response.json()) as ApiResponse<Team>;

    setSubmitting(false);

    if (!response.ok) {
      toast.error(json.error.message);
      return;
    }

    mutateTeams();
    toast.success(t('portal-created'));
    router.push(`/teams/${json.data.slug}/dashboard`);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-6">
      <ol
        className="flex flex-wrap gap-2 text-sm"
        aria-label={t('portal-onboarding')}
      >
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className={`rounded-full border px-4 py-2 font-medium ${
              i === step
                ? 'border-primary bg-primary text-primary-content'
                : i < step
                  ? 'border-secondary/30 bg-secondary/10 text-secondary'
                  : 'bg-base-100 text-base-content/60'
            }`}
          >
            {i + 1}. {t(`portal-step-${s}`)}
          </li>
        ))}
      </ol>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card>
            <Card.Body>
              {step === 0 && (
                <>
                  <Card.Header>
                    <Card.Title>{t('portal-step-account')}</Card.Title>
                    <Card.Description>
                      {t('portal-account-description')}
                    </Card.Description>
                  </Card.Header>
                  <p className="text-sm">
                    {session?.user?.name} ({session?.user?.email})
                  </p>
                </>
              )}

              {step === 1 && (
                <>
                  <Card.Header>
                    <Card.Title>{t('portal-step-details')}</Card.Title>
                    <Card.Description>
                      {t('portal-details-description')}
                    </Card.Description>
                  </Card.Header>
                  <InputWithLabel
                    name="name"
                    label={t('portal-company-name')}
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    required
                  />
                  <InputWithLabel
                    name="slug"
                    label={t('team-slug')}
                    value={form.slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      set('slug', slugifyInput(e.target.value));
                    }}
                    descriptionText={t('portal-slug-hint')}
                    required
                  />
                  <InputWithLabel
                    name="website"
                    label={t('portal-website')}
                    value={form.website}
                    onChange={(e) => set('website', e.target.value)}
                    placeholder="https://"
                  />
                  <InputWithLabel
                    name="contactEmail"
                    label={t('portal-contact-email')}
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => set('contactEmail', e.target.value)}
                  />
                  {slugValue.length >= 3 && (
                    <p
                      className="rounded-xl bg-base-200 p-3 text-sm"
                      aria-live="polite"
                    >
                      {t('portal-your-address', 'Your portal:')}{' '}
                      <strong>{`${typeof window !== 'undefined' ? window.location.host : ''}/p/${slugValue}`}</strong>{' '}
                      {available === true && (
                        <span className="font-semibold text-secondary">
                          {`✓ ${t('portal-available', 'available')}`}
                        </span>
                      )}
                      {available === false && (
                        <span className="font-semibold text-error">
                          {t('portal-taken', 'already taken')}
                        </span>
                      )}
                      <span className="mt-1 block text-base-content/70">
                        {t(
                          'portal-domain-later',
                          'A custom domain such as careers.example.com can be mapped later (Enterprise).'
                        )}
                      </span>
                    </p>
                  )}
                  <InputWithLabel
                    name="industry"
                    label={t('portal-industry')}
                    value={form.industry}
                    onChange={(e) => set('industry', e.target.value)}
                  />
                </>
              )}

              {step === 2 && (
                <>
                  <Card.Header>
                    <Card.Title>{t('portal-step-branding')}</Card.Title>
                    <Card.Description>
                      {t('portal-branding-description')}
                    </Card.Description>
                  </Card.Header>
                  <InputWithLabel
                    name="primaryColor"
                    label={t('portal-primary-color')}
                    type="color"
                    value={form.primaryColor}
                    onChange={(e) => set('primaryColor', e.target.value)}
                  />
                  <label className="flex flex-col w-full">
                    <span className="text-sm pb-2">{t('portal-theme')}</span>
                    <select
                      className="select "
                      name="theme"
                      value={form.theme}
                      onChange={(e) => set('theme', e.target.value)}
                    >
                      <option value="SYSTEM">{t('portal-theme-system')}</option>
                      <option value="LIGHT">{t('portal-theme-light')}</option>
                      <option value="DARK">{t('portal-theme-dark')}</option>
                    </select>
                  </label>
                  <InputWithLabel
                    name="heroTitle"
                    label={t('portal-hero-title')}
                    value={form.heroTitle}
                    onChange={(e) => set('heroTitle', e.target.value)}
                  />
                  <InputWithLabel
                    name="heroSubtitle"
                    label={t('portal-hero-subtitle')}
                    value={form.heroSubtitle}
                    onChange={(e) => set('heroSubtitle', e.target.value)}
                  />
                </>
              )}

              {step === 3 && (
                <>
                  <Card.Header>
                    <Card.Title>{t('portal-step-done')}</Card.Title>
                    <Card.Description>
                      {t('portal-done-description')}
                    </Card.Description>
                  </Card.Header>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <dt>{t('portal-company-name')}</dt>
                    <dd>{form.name}</dd>
                    <dt>{t('team-slug')}</dt>
                    <dd>{form.slug}</dd>
                    <dt>{t('portal-primary-color')}</dt>
                    <dd>
                      <span
                        className="inline-block h-3 w-3 rounded-full align-middle"
                        style={{ background: form.primaryColor }}
                      />{' '}
                      {form.primaryColor}
                    </dd>
                  </dl>
                </>
              )}
            </Card.Body>
          </Card>

          <div className="flex justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={step === 0 || submitting}
              onClick={() => setStep(step - 1)}
            >
              {t('portal-back')}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                color="primary"
                disabled={step === 1 && !detailsValid}
                onClick={() => setStep(step + 1)}
              >
                {t('portal-next')}
              </Button>
            ) : (
              <Button
                type="button"
                color="primary"
                loading={submitting}
                onClick={create}
              >
                {t('portal-create')}
              </Button>
            )}
          </div>
        </div>

        <aside
          aria-label={t('portal-preview', 'Live preview')}
          className="space-y-2 lg:sticky lg:top-24"
        >
          <span className="text-xs font-bold uppercase tracking-wide text-base-content/60">
            {t('portal-preview', 'Live preview')}
          </span>
          <div className="overflow-hidden rounded-2xl border bg-base-100">
            <div
              className="space-y-3 p-5 text-white"
              style={{ background: form.primaryColor }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold"
                  style={{ color: form.primaryColor }}
                >
                  {(form.name.trim()[0] ?? 'A').toUpperCase()}
                </span>
                <strong className="font-display">
                  {form.name.trim() || t('portal-preview-name', 'Your company')}
                </strong>
              </div>
              <p className="font-display text-2xl font-semibold leading-tight">
                {form.heroTitle.trim() ||
                  t('portal-preview-hero', 'Join our team')}
              </p>
              <div className="rounded-lg bg-white px-3 py-2 text-sm text-base-content/60">
                {t('portal-preview-search', 'Search open roles…')}
              </div>
            </div>
            <div className="space-y-2 p-4 text-sm">
              {[
                t('portal-preview-job1', 'Senior Engineer'),
                t('portal-preview-job2', 'Product Manager'),
              ].map((j) => (
                <div key={j} className="rounded-xl border p-3">
                  <strong className="block">{j}</strong>
                  <span className="text-base-content/70">
                    {t('portal-preview-meta', 'Remote · Full time')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default OnboardingWizard;
