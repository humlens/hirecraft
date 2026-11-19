import type { SessionStrategy } from 'next-auth';

const env = {
  databaseUrl: `${process.env.DATABASE_URL}`,
  appUrl: `${process.env.APP_URL}`,
  redirectIfAuthenticated: '/dashboard',
  securityHeadersEnabled: process.env.SECURITY_HEADERS_ENABLED ?? false,

  // SMTP configuration for NextAuth
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.SMTP_FROM,
  },

  // NextAuth configuration
  nextAuth: {
    secret: process.env.NEXTAUTH_SECRET,
    sessionStrategy: (process.env.NEXTAUTH_SESSION_STRATEGY ||
      'jwt') as SessionStrategy,
  },

  // Svix
  svix: {
    url: `${process.env.SVIX_URL}`,
    apiKey: `${process.env.SVIX_API_KEY}`,
  },

  //Social login: Github
  github: {
    clientId: `${process.env.GITHUB_CLIENT_ID}`,
    clientSecret: `${process.env.GITHUB_CLIENT_SECRET}`,
  },

  //Social login: Google
  google: {
    clientId: `${process.env.GOOGLE_CLIENT_ID}`,
    clientSecret: `${process.env.GOOGLE_CLIENT_SECRET}`,
  },

  // Retraced configuration
  retraced: {
    url: process.env.RETRACED_URL
      ? `${process.env.RETRACED_URL}/auditlog`
      : undefined,
    apiKey: process.env.RETRACED_API_KEY,
    projectId: process.env.RETRACED_PROJECT_ID,
  },

  groupPrefix: process.env.GROUP_PREFIX,

  // SAML Jackson configuration
  jackson: {
    url: process.env.JACKSON_URL,
    externalUrl: process.env.JACKSON_EXTERNAL_URL || process.env.JACKSON_URL,
    apiKey: process.env.JACKSON_API_KEY,
    productId: process.env.JACKSON_PRODUCT_ID || 'hirecraft',
    selfHosted: process.env.JACKSON_URL !== undefined,
    sso: {
      callback: `${process.env.APP_URL}`,
      issuer: process.env.SAML_ISSUER || 'urn:hirecraft:saml',
      path: '/api/oauth/saml',
      oidcPath: '/api/oauth/oidc',
      idpLoginPath: '/auth/idp-login',
    },
    dsync: {
      webhook_url: `${process.env.APP_URL}/api/webhooks/dsync`,
      webhook_secret: process.env.JACKSON_WEBHOOK_SECRET,
    },
  },

  // Users will need to confirm their email before accessing the app feature
  confirmEmail: process.env.CONFIRM_EMAIL === 'true',

  // Mixpanel configuration
  mixpanel: {
    token: process.env.NEXT_PUBLIC_MIXPANEL_TOKEN,
  },

  disableNonBusinessEmailSignup:
    process.env.DISABLE_NON_BUSINESS_EMAIL_SIGNUP === 'true',

  authProviders: process.env.AUTH_PROVIDERS || 'github,credentials',

  otel: {
    prefix: process.env.OTEL_PREFIX || 'hirecraft',
  },

  hideLandingPage: process.env.HIDE_LANDING_PAGE === 'true',

  darkModeEnabled: process.env.NEXT_PUBLIC_DARK_MODE !== 'false',

  teamFeatures: {
    sso: process.env.FEATURE_TEAM_SSO !== 'false',
    dsync: process.env.FEATURE_TEAM_DSYNC !== 'false',
    webhook: process.env.FEATURE_TEAM_WEBHOOK !== 'false',
    apiKey: process.env.FEATURE_TEAM_API_KEY !== 'false',
    auditLog: process.env.FEATURE_TEAM_AUDIT_LOG !== 'false',
    payments:
      process.env.FEATURE_TEAM_PAYMENTS === 'false'
        ? false
        : Boolean(
            process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET
          ),
    deleteTeam: process.env.FEATURE_TEAM_DELETION !== 'false',
  },

  recaptcha: {
    siteKey: process.env.RECAPTCHA_SITE_KEY || null,
    secretKey: process.env.RECAPTCHA_SECRET_KEY || null,
  },

  maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS) || 5,

  // File storage. With S3_BUCKET set, S3-compatible storage is used; otherwise
  // files go to a local directory (development and tests only).
  storage: {
    s3: {
      endpoint: process.env.S3_ENDPOINT || undefined,
      region: process.env.S3_REGION || 'us-east-1',
      bucket: process.env.S3_BUCKET || '',
      accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    },
    localDir: process.env.STORAGE_LOCAL_DIR || '.storage',
    signingSecret:
      process.env.STORAGE_SIGNING_SECRET || process.env.NEXTAUTH_SECRET || '',
    maxResumeBytes: Number(process.env.MAX_RESUME_BYTES) || 5 * 1024 * 1024,
  },

  // Redis (queue + shared rate limits). Optional: without it jobs run inline.
  redisUrl: process.env.REDIS_URL || '',

  // AI
  ai: {
    enabled: process.env.FEATURE_AI !== 'false',
    defaultProvider: (process.env.AI_DEFAULT_PROVIDER || '').toLowerCase(),
    embeddingModel: process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small',
    monthlyCredits: Number(process.env.AI_DEFAULT_MONTHLY_CREDITS) || 500,
    ratePerMinute: Number(process.env.AI_RATE_PER_MINUTE) || 60,
  },

  // Web Push (Phase 5). Generate keys with: npx web-push generate-vapid-keys
  push: {
    enabled: process.env.FEATURE_PUSH !== 'false',
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },

  // Custom domains (Phase 6)
  customDomains: {
    enabled: process.env.FEATURE_CUSTOM_DOMAINS !== 'false',
    // hosts that are the platform itself, never a customer's domain
    baseDomain: (process.env.PUBLIC_PORTAL_BASE_DOMAIN || '').toLowerCase(),
    // what customers point their CNAME at, e.g. portals.example.com
    cnameTarget: (process.env.PORTAL_CNAME_TARGET || '').toLowerCase(),
  },

  // Platform super admins (comma-separated, matched against verified account emails)
  platformAdminEmails: (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

  // Shared secret for POST /api/internal/tick (worker / scheduler)
  cronSecret: process.env.CRON_SECRET || '',

  // Where "Talk to sales" leads on the billing page (mailto: or https:)
  salesContactUrl: process.env.SALES_CONTACT_URL || '',

  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
};

export default env;
