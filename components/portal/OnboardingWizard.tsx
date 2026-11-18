import { Card, InputWithLabel } from '@/components/shared';
import { defaultHeaders } from '@/lib/common';
import { slugify, slugifyInput } from '@/lib/slug';
import type { Team } from '@prisma/client';
import useTeams from 'hooks/useTeams';
import { useSession } from 'next-auth/react';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';
import { useState } from 'react';
import { Button } from 'react-daisyui';
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

  const detailsValid =
    form.name.trim().length > 0 && slugify(form.slug).length >= 3;

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
    router.push(`/teams/${json.data.slug}/settings`);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <ol className="flex gap-2 text-sm" aria-label={t('portal-onboarding')}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className={`flex-1 rounded border px-3 py-2 ${
              i === step ? 'border-primary font-medium' : 'opacity-60'
            }`}
          >
            {i + 1}. {t(`portal-step-${s}`)}
          </li>
        ))}
      </ol>

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
              <label className="form-control w-full">
                <span className="label-text pb-2">{t('portal-theme')}</span>
                <select
                  className="select select-bordered"
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
  );
};

export default OnboardingWizard;
