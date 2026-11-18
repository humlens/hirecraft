import type { FeatureKey } from '../entitlements';

/**
 * Catalogue of integrations. Everything goes through official, authorised APIs
 * (OAuth for Google and Microsoft, signed webhooks for partners). Nothing is
 * scraped, and a provider is only usable when this server has its credentials.
 */
export type ProviderKind =
  'calendar' | 'assessment' | 'background_check' | 'hrms';

export type ProviderDef = {
  key: string;
  kind: ProviderKind;
  name: string;
  description: string;
  auth: 'oauth' | 'webhook' | 'link';
  feature: FeatureKey;
  /** server-side credentials needed for OAuth providers */
  env?: { clientId: string; clientSecret: string };
  /** where the user manages it, for providers that live in an existing page */
  href?: string;
};

export const PROVIDERS: ProviderDef[] = [
  {
    key: 'google_calendar',
    kind: 'calendar',
    name: 'Google Calendar + Meet',
    description:
      'Creates interview events and Google Meet links for your team.',
    auth: 'oauth',
    feature: 'integrations',
    env: {
      clientId: 'INTEGRATION_GOOGLE_CLIENT_ID',
      clientSecret: 'INTEGRATION_GOOGLE_CLIENT_SECRET',
    },
  },
  {
    key: 'microsoft_calendar',
    kind: 'calendar',
    name: 'Outlook Calendar + Teams',
    description:
      'Creates interview events and Teams meeting links through Microsoft 365.',
    auth: 'oauth',
    feature: 'integrations',
    env: {
      clientId: 'INTEGRATION_MICROSOFT_CLIENT_ID',
      clientSecret: 'INTEGRATION_MICROSOFT_CLIENT_SECRET',
    },
  },
  {
    key: 'assessment',
    kind: 'assessment',
    name: 'Assessments',
    description:
      'Send a coding or skills test through your assessment partner (signed webhook).',
    auth: 'webhook',
    feature: 'integrations.advanced',
  },
  {
    key: 'background_check',
    kind: 'background_check',
    name: 'Background checks',
    description:
      "Start verification after an offer, only with the candidate's consent.",
    auth: 'webhook',
    feature: 'integrations.advanced',
  },
  {
    key: 'hrms',
    kind: 'hrms',
    name: 'HRMS',
    description:
      'Push hires to your HR system with the signed webhooks (candidate.hired).',
    auth: 'link',
    feature: 'integrations',
    href: 'webhooks',
  },
];

export const getProvider = (key: string) =>
  PROVIDERS.find((p) => p.key === key);

export const oauthConfigured = (p: ProviderDef) =>
  !!p.env && !!process.env[p.env.clientId] && !!process.env[p.env.clientSecret];
