import { Avatar, Panel, Pill, RadialScore } from '@/components/ui';
import {
  INDUSTRY_TEMPLATES,
  JOB_TEMPLATES,
  getJobTemplate,
} from '@/lib/industryTemplates';
import { DEFAULT_ENTITLEMENTS, PLAN_LABELS, PLANS } from '@/lib/planDefaults';
import { useTranslation } from 'next-i18next';
import Image from 'next/image';
import Link from 'next/link';
import app from '@/lib/app';
import type { ReactNode } from 'react';

export const Container = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">{children}</div>
);

const SectionHead = ({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text?: string;
}) => (
  <div className="mx-auto mb-10 max-w-2xl text-center">
    <p className="text-sm font-semibold uppercase tracking-wide text-secondary">
      {eyebrow}
    </p>
    <h2 className="mt-2 font-display text-3xl font-bold sm:text-4xl">
      {title}
    </h2>
    {text && <p className="mt-3 text-lg opacity-70">{text}</p>}
  </div>
);

export const Navbar = ({ themeToggle }: { themeToggle?: ReactNode }) => {
  const { t } = useTranslation('common');
  const links = [
    ['#solutions', t('landing-nav-solutions', 'Solutions')],
    ['#features', t('landing-nav-features', 'Features')],
    ['#pricing', t('landing-nav-pricing', 'Pricing')],
    ['#faq', t('landing-nav-faq', 'FAQ')],
  ];

  return (
    <header className="sticky top-0 z-40 border-b bg-base-100/90 backdrop-blur">
      <Container>
        <div className="flex h-16 items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 font-display text-lg font-bold"
          >
            <Image src="/logo.png" alt="" width={28} height={28} />
            {app.name}
          </Link>
          <nav
            aria-label={t('landing-nav', 'Main')}
            className="ml-4 hidden gap-6 text-sm md:flex"
          >
            {links.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="opacity-80 hover:opacity-100"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {themeToggle}
            <Link href="/auth/login" className="btn btn-ghost btn-sm">
              {t('sign-in')}
            </Link>
            <Link href="/auth/join" className="btn btn-primary btn-sm">
              {t('landing-get-started', 'Get started')}
            </Link>
          </div>
        </div>
      </Container>
    </header>
  );
};

/** A product mock: a clinician's application with a verified registration. */
const HeroCard = () => {
  const { t } = useTranslation('common');

  return (
    <Panel pad="lg" className="w-full max-w-md space-y-4 shadow-xl">
      <div className="flex items-center gap-3">
        <Avatar name="Priya Nair" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-semibold">{'Priya Nair'}</p>
          <p className="text-sm opacity-70">
            {t('landing-mock-role', 'Registered Nurse, ICU · 6 yrs · Pune')}
          </p>
        </div>
        <Pill tone="success">
          {t('landing-mock-verified', 'Registration verified')}
        </Pill>
      </div>
      <div className="flex items-center gap-4">
        <RadialScore value={89} size="5rem" />
        <ul className="flex-1 space-y-1 text-sm">
          <li className="flex justify-between">
            <span>{t('landing-mock-clinical', 'Clinical skills')}</span>
            <span className="opacity-70">92%</span>
          </li>
          <li className="flex justify-between">
            <span>{t('landing-mock-certs', 'Certifications')}</span>
            <span className="opacity-70">100%</span>
          </li>
          <li className="flex justify-between">
            <span>{t('landing-mock-shift', 'Shift fit')}</span>
            <span className="opacity-70">85%</span>
          </li>
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <Pill tone="primary">BLS</Pill>
        <Pill tone="primary">ACLS</Pill>
        <Pill>{t('landing-mock-rotating', 'Rotating shifts')}</Pill>
      </div>
      <p className="rounded-xl bg-secondary/10 p-3 text-sm text-secondary">
        {'✦ '}
        {t(
          'landing-mock-note',
          'AI suggests, people decide. Scores never reject a candidate.'
        )}
      </p>
    </Panel>
  );
};

export const Hero = () => {
  const { t } = useTranslation('common');

  return (
    <section className="bg-gradient-to-b from-primary/5 to-transparent">
      <Container>
        <div className="grid items-center gap-12 py-16 lg:grid-cols-2 lg:py-24">
          <div>
            <Pill tone="secondary" className="mb-4 text-sm">
              {t('landing-badge', 'New: hospital & medical templates')}
            </Pill>
            <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl">
              {t(
                'landing-title',
                'Hire clinicians and care teams with confidence'
              )}
            </h1>
            <p className="mt-5 max-w-xl text-lg opacity-80">
              {t(
                'landing-subtitle',
                'A branded careers portal, credential checks, interviews and offers in one place, with AI that helps your team decide faster and people always in control.'
              )}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/auth/join" className="btn btn-primary">
                {t('landing-cta', 'Start free')}
              </Link>
              <a href="#solutions" className="btn btn-outline">
                {t('landing-cta-templates', 'See healthcare templates')}
              </a>
            </div>
            <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 text-sm">
              {[
                [
                  String(JOB_TEMPLATES.length),
                  t('landing-stat-roles', 'ready role templates'),
                ],
                [
                  String(INDUSTRY_TEMPLATES.length - 1),
                  t('landing-stat-pipelines', 'healthcare pipelines'),
                ],
                ['0', t('landing-stat-auto', 'automatic rejections')],
              ].map(([n, l]) => (
                <div key={l}>
                  <dt className="font-display text-3xl font-bold">{n}</dt>
                  <dd className="opacity-70">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroCard />
          </div>
        </div>
      </Container>
    </section>
  );
};

export const Solutions = () => {
  const { t } = useTranslation('common');
  const healthcare = INDUSTRY_TEMPLATES.filter((x) => x.key !== 'general');

  return (
    <section id="solutions" className="scroll-mt-16 py-16">
      <Container>
        <SectionHead
          eyebrow={t('landing-solutions-eyebrow', 'Solutions')}
          title={t(
            'landing-solutions-title',
            'Templates for hospitals and medical teams'
          )}
          text={t(
            'landing-solutions-text',
            'Pick your kind of employer and start with the right pipeline, wording and roles. Change anything later.'
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {healthcare.map((tpl) => (
            <Panel key={tpl.key} pad="lg" className="flex flex-col gap-3">
              <span
                aria-hidden
                className="h-1.5 w-12 rounded-full"
                style={{ background: tpl.primaryColor }}
              />
              <h3 className="font-display text-lg font-semibold">
                {tpl.label}
              </h3>
              <p className="text-sm opacity-70">{tpl.tagline}</p>
              <ul className="mt-auto space-y-1 text-sm">
                {tpl.jobs.slice(0, 3).map((k) => (
                  <li key={k}>{`• ${getJobTemplate(k)?.title ?? k}`}</li>
                ))}
              </ul>
              <p className="text-xs opacity-60">
                {`${tpl.stages?.filter((s) => s.kind === 'ACTIVE').length ?? 0} ${t('landing-stages', 'pipeline stages')}`}
              </p>
            </Panel>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {JOB_TEMPLATES.map((j) => (
            <Pill key={j.key} className="text-sm">
              {j.title}
            </Pill>
          ))}
        </div>
      </Container>
    </section>
  );
};

export const Features = () => {
  const { t } = useTranslation('common');
  const items = [
    [
      t('landing-f1-title', 'Branded careers portal'),
      t(
        'landing-f1-text',
        'Your colours, your story and a fast, searchable job board that works on a phone.'
      ),
    ],
    [
      t('landing-f2-title', 'Credential and licence checks'),
      t(
        'landing-f2-text',
        'Ask for registration numbers, track certifications like BLS and ACLS, and verify before any offer.'
      ),
    ],
    [
      t('landing-f3-title', 'Shift-aware roles'),
      t(
        'landing-f3-text',
        'Day, night, rotating and on-call details on every posting, so candidates apply knowing the schedule.'
      ),
    ],
    [
      t('landing-f4-title', 'AI that suggests, not decides'),
      t(
        'landing-f4-text',
        'Explainable matches, résumé parsing and a copilot. Protected attributes are never used and nothing is rejected automatically.'
      ),
    ],
    [
      t('landing-f5-title', 'Interviews and scorecards'),
      t(
        'landing-f5-text',
        'Schedule panels, collect structured feedback and compare candidates side by side.'
      ),
    ],
    [
      t('landing-f6-title', 'Offers with approvals'),
      t(
        'landing-f6-text',
        'Salary band checks, an approval chain and letters that wait for a person to send them.'
      ),
    ],
  ];

  return (
    <section id="features" className="scroll-mt-16 bg-base-200/60 py-16">
      <Container>
        <SectionHead
          eyebrow={t('landing-features-eyebrow', 'Features')}
          title={t(
            'landing-features-title',
            'Everything from first look to signed offer'
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map(([title, text]) => (
            <Panel key={title} pad="lg" className="space-y-2">
              <h3 className="font-display text-lg font-semibold">{title}</h3>
              <p className="text-sm opacity-70">{text}</p>
            </Panel>
          ))}
        </div>
      </Container>
    </section>
  );
};

export const HowItWorks = () => {
  const { t } = useTranslation('common');
  const steps = [
    [
      t('landing-s1-title', 'Choose a template'),
      t(
        'landing-s1-text',
        'Hospital, clinic, lab or pharmacy: get the right pipeline and wording.'
      ),
    ],
    [
      t('landing-s2-title', 'Add roles in a click'),
      t(
        'landing-s2-text',
        'Start from a nurse, physician or technologist template and edit the details.'
      ),
    ],
    [
      t('landing-s3-title', 'Hire with confidence'),
      t(
        'landing-s3-text',
        'Verify registrations, interview and send offers with the approvals you need.'
      ),
    ],
  ];

  return (
    <section className="py-16">
      <Container>
        <SectionHead
          eyebrow={t('landing-how-eyebrow', 'How it works')}
          title={t('landing-how-title', 'Up and running in an afternoon')}
        />
        <ol className="grid gap-4 md:grid-cols-3">
          {steps.map(([title, text], i) => (
            <li key={title} className="flex gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-display font-bold text-primary-content">
                {i + 1}
              </span>
              <div>
                <h3 className="font-display text-lg font-semibold">{title}</h3>
                <p className="text-sm opacity-70">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
};

export const Pricing = () => {
  const { t } = useTranslation('common');
  const fmt = (n: number | null) =>
    n === null ? t('unlimited', 'Unlimited') : n.toLocaleString();

  return (
    <section id="pricing" className="scroll-mt-16 bg-base-200/60 py-16">
      <Container>
        <SectionHead
          eyebrow={t('landing-pricing-eyebrow', 'Pricing')}
          title={t(
            'landing-pricing-title',
            'Start free, grow when you are ready'
          )}
          text={t(
            'landing-pricing-text',
            'Limits are enforced by the server. Upgrade or downgrade any time from Settings.'
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p) => {
            const d = DEFAULT_ENTITLEMENTS[p];
            const featured = p === 'professional';

            return (
              <Panel
                key={p}
                pad="lg"
                selected={featured}
                className="flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-semibold">
                    {PLAN_LABELS[p]}
                  </h3>
                  {featured && (
                    <Pill tone="primary">
                      {t('landing-popular', 'Most popular')}
                    </Pill>
                  )}
                </div>
                <ul className="flex-1 space-y-1.5 text-sm">
                  <li>{`✓ ${fmt(d.limits.activeJobs)} ${t('plan-b-jobs', 'active jobs')}`}</li>
                  <li>{`✓ ${fmt(d.limits.seats)} ${t('plan-b-seats', 'team members')}`}</li>
                  <li>{`✓ ${fmt(d.limits.aiCreditsPerMonth)} ${t('plan-b-credits', 'AI credits / mo')}`}</li>
                  <li>{`✓ ${fmt(d.limits.storageGb)} GB ${t('landing-storage', 'candidate storage')}`}</li>
                  {d.features.includes('customDomain') && (
                    <li>{`✓ ${t('landing-enterprise-extras', 'Custom domain, SSO, SCIM, API')}`}</li>
                  )}
                </ul>
                <Link
                  href="/auth/join"
                  className={`btn ${featured ? 'btn-primary' : 'btn-outline'}`}
                >
                  {p === 'free'
                    ? t('landing-cta', 'Start free')
                    : t('landing-get-started', 'Get started')}
                </Link>
              </Panel>
            );
          })}
        </div>
      </Container>
    </section>
  );
};

export const Faq = ({
  items,
}: {
  items: { question: string; answer: string }[];
}) => {
  const { t } = useTranslation('common');

  return (
    <section id="faq" className="scroll-mt-16 py-16">
      <Container>
        <SectionHead
          eyebrow={t('landing-faq-eyebrow', 'FAQ')}
          title={t('frequently-asked')}
        />
        <div className="mx-auto max-w-3xl space-y-3">
          {items.map((f) => (
            <details
              key={f.question}
              className="group rounded-2xl border bg-base-100 p-5"
            >
              <summary className="cursor-pointer list-none font-display font-semibold">
                {f.question}
              </summary>
              <p className="mt-2 text-sm opacity-80">{f.answer}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
};

export const CtaBand = () => {
  const { t } = useTranslation('common');

  return (
    <section className="py-12">
      <Container>
        <div className="rounded-3xl bg-primary px-6 py-12 text-center text-primary-content">
          <h2 className="font-display text-3xl font-bold">
            {t('landing-final-title', 'Ready to hire your next care team?')}
          </h2>
          <p className="mx-auto mt-2 max-w-xl opacity-90">
            {t(
              'landing-final-text',
              'Create your portal in minutes. No card needed.'
            )}
          </p>
          <Link
            href="/auth/join"
            className="btn mt-6 border-0 bg-white text-primary hover:bg-white/90"
          >
            {t('landing-cta', 'Start free')}
          </Link>
        </div>
      </Container>
    </section>
  );
};

export const Footer = () => {
  const { t } = useTranslation('common');

  return (
    <footer className="border-t py-8 text-sm">
      <Container>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="flex items-center gap-2 font-display font-bold">
            <Image src="/logo.png" alt="" width={20} height={20} />
            {app.name}
          </span>
          <a href="#solutions" className="opacity-70">
            {t('landing-nav-solutions', 'Solutions')}
          </a>
          <a href="#pricing" className="opacity-70">
            {t('landing-nav-pricing', 'Pricing')}
          </a>
          <Link href="/auth/login" className="opacity-70">
            {t('sign-in')}
          </Link>
          <span className="ml-auto opacity-60">{`© ${new Date().getFullYear()} ${app.name}`}</span>
        </div>
      </Container>
    </footer>
  );
};
