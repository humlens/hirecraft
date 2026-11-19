import { Loading } from '@/components/shared';
import useTeams from 'hooks/useTeams';
import type { GetStaticPropsContext } from 'next';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import Link from 'next/link';

type Card = {
  n?: string;
  title: string;
  text: string;
  href: string;
  ai?: boolean;
};

/** The product map: every journey and screen, one card each. Signed-in users only. */
const Flow = () => {
  const { t } = useTranslation('common');
  const { teams, isLoading } = useTeams();

  if (isLoading) return <Loading />;

  const slug = teams?.[0]?.slug;
  const portal = (path: string) =>
    slug ? `/teams/${slug}${path}` : '/onboarding';
  const groups: { title: string; hint: string; cards: Card[] }[] = [
    {
      title: t('flow-owner', 'Customer / Portal Owner'),
      hint: t('flow-owner-hint', 'Tenant setup, invites and roles'),
      cards: [
        {
          n: '01',
          title: t('flow-signup', 'Sign up'),
          text: t('flow-signup-t', 'Email, Google/GitHub or SAML'),
          href: '/auth/join',
        },
        {
          n: '02',
          title: t('flow-portal', 'Create branded portal'),
          text: t('flow-portal-t', 'Name, slug, colors, live preview'),
          href: '/onboarding',
        },
        {
          n: '03',
          title: t('flow-owner-role', 'Becomes Portal Owner'),
          text: t(
            'flow-owner-role-t',
            'Created in one transaction with the portal'
          ),
          href: portal('/settings'),
        },
        {
          n: '04',
          title: t('flow-team', 'Invite team, assign permissions'),
          text: t('flow-team-t', 'HR managers, recruiters, custom roles'),
          href: portal('/members'),
        },
      ],
    },
    {
      title: t('flow-recruiter', 'Recruiter team'),
      hint: t(
        'flow-recruiter-hint',
        'Every query is scoped to the active portal on the server'
      ),
      cards: [
        {
          n: '05',
          title: t('flow-job', 'Create & publish job'),
          text: t('flow-job-t', 'AI drafts the description'),
          href: portal('/jobs/new'),
          ai: true,
        },
        {
          n: '09',
          title: t('flow-review', 'Review match, shortlist'),
          text: t(
            'flow-review-t',
            'Explainable match score, never auto-reject'
          ),
          href: portal('/review'),
          ai: true,
        },
        {
          n: '10–11',
          title: t('flow-interview', 'Interview & feedback'),
          text: t('flow-interview-t', 'Schedule, scorecards'),
          href: portal('/interviews'),
        },
        {
          n: '12',
          title: t('flow-pipeline', 'Move through pipeline'),
          text: t('flow-pipeline-t', 'Each transition audited'),
          href: portal('/jobs'),
        },
      ],
    },
    {
      title: t('flow-candidate', 'Candidate'),
      hint: t('flow-candidate-hint', 'One identity, consent per portal'),
      cards: [
        {
          n: '06',
          title: t('flow-discover', 'Discover job'),
          text: t('flow-discover-t', 'Branded portal, search, SEO pages'),
          href: slug ? `/p/${slug}` : '/',
        },
        {
          n: '07',
          title: t('flow-resume', 'Sign up, upload resume'),
          text: t('flow-resume-t', 'AI extracts profile, candidate confirms'),
          href: '/me/profile',
          ai: true,
        },
        {
          n: '08',
          title: t('flow-apply', 'Apply'),
          text: t('flow-apply-t', 'Screening questions and consent'),
          href: slug ? `/p/${slug}/jobs` : '/',
        },
        {
          n: '13',
          title: t('flow-track', 'Track & get notified'),
          text: t('flow-track-t', 'Email, in-app and push'),
          href: '/me/applications',
        },
      ],
    },
    {
      title: t('flow-advanced', 'Advanced features'),
      hint: t('flow-advanced-hint', 'Power tools, governance and monetization'),
      cards: [
        {
          title: t('flow-talent', 'Talent search & pools'),
          text: t('flow-talent-t', 'Plain-language hybrid search'),
          href: portal('/talent'),
          ai: true,
        },
        {
          title: t('flow-copilot', 'AI copilot'),
          text: t('flow-copilot-t', 'Permission-aware answers'),
          href: portal('/copilot'),
          ai: true,
        },
        {
          title: t('flow-analytics', 'Analytics & reports'),
          text: t('flow-analytics-t', 'Time to hire, sources, workload'),
          href: portal('/analytics'),
        },
        {
          title: t('flow-offers', 'Offers & approvals'),
          text: t('flow-offers-t', 'Approval chain'),
          href: portal('/offers'),
        },
        {
          title: t('flow-automation', 'Automation & stages'),
          text: t('flow-automation-t', 'Rules with human approval'),
          href: portal('/settings/pipeline'),
        },
        {
          title: t('flow-ai-gov', 'AI governance'),
          text: t('flow-ai-gov-t', 'Providers, credits, retention'),
          href: portal('/ai'),
        },
        {
          title: t('flow-billing', 'Plans & billing'),
          text: t('flow-billing-t', 'Metering, limits, invoices'),
          href: portal('/billing'),
        },
        {
          title: t('flow-integrations', 'Integrations & domain'),
          text: t('flow-integrations-t', 'Calendars, webhooks, SSO'),
          href: portal('/settings/integrations'),
        },
        {
          title: t('flow-admin', 'Platform super admin'),
          text: t('flow-admin-t', 'Tenants, suspend, audit'),
          href: '/admin',
        },
        {
          title: t('flow-dashboard', 'Recruiter dashboard'),
          text: t('flow-dashboard-t', 'KPIs and assistant'),
          href: portal('/dashboard'),
        },
        {
          title: t('flow-mobile-c', 'Mobile: candidate'),
          text: t('flow-mobile-c-t', 'Installable PWA'),
          href: '/me',
        },
        {
          title: t('flow-mobile-r', 'Mobile: recruiter'),
          text: t('flow-mobile-r-t', 'Shortlist on the go'),
          href: portal('/review'),
        },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">
      <header className="space-y-2">
        <h1 className="font-display text-4xl font-semibold">
          {t(
            'flow-title',
            'One portal, three journeys: the complete hiring flow'
          )}
        </h1>
        <p className="max-w-3xl text-base-content/70">
          {t(
            'flow-sub',
            'Each card opens its screen. A customer creates a branded portal, the team hires through an AI-assisted ATS, and candidates apply and track progress on web and mobile.'
          )}
        </p>
        <p className="flex gap-4 text-sm">
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded bg-primary" aria-hidden="true" />
            {t('flow-legend-human', 'Human action')}
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded bg-secondary" aria-hidden="true" />
            {t('flow-legend-ai', 'AI assist (human approves)')}
          </span>
        </p>
      </header>
      {groups.map((g) => (
        <section key={g.title} className="space-y-3">
          <h2 className="text-2xl font-semibold">
            {g.title}{' '}
            <span className="text-sm font-normal text-base-content/60">
              {g.hint}
            </span>
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {g.cards.map((c) => (
              <li key={c.title}>
                <Link
                  href={c.href}
                  className="block h-full rounded-2xl border bg-base-100 p-4 transition-shadow hover:shadow-md"
                >
                  {c.n && (
                    <span className="text-xs font-bold text-primary">
                      {c.n}
                    </span>
                  )}
                  <strong className="block text-lg leading-snug">
                    {c.title}
                  </strong>
                  <span
                    className={`text-sm ${c.ai ? 'text-secondary' : 'text-base-content/70'}`}
                  >
                    {c.text}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

export async function getStaticProps({ locale }: GetStaticPropsContext) {
  return {
    props: {
      ...(locale ? await serverSideTranslations(locale, ['common']) : {}),
    },
  };
}

export default Flow;
