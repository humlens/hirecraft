# Environment variables

# Storage (Phase 2)

| Variable                                   | Default           | Purpose                                                              |
| ------------------------------------------ | ----------------- | -------------------------------------------------------------------- |
| `S3_BUCKET`                                | empty             | Set to use S3-compatible storage. Empty = local disk (dev/test only) |
| `S3_ENDPOINT`                              | AWS               | Custom endpoint, e.g. MinIO `http://localhost:9000`                  |
| `S3_REGION`                                | `us-east-1`       |                                                                      |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |                   | Credentials                                                          |
| `S3_FORCE_PATH_STYLE`                      | `true`            | Needed for MinIO                                                     |
| `STORAGE_LOCAL_DIR`                        | `.storage`        | Local driver directory (git-ignored)                                 |
| `STORAGE_SIGNING_SECRET`                   | `NEXTAUTH_SECRET` | HMAC secret for local signed URLs                                    |
| `MAX_RESUME_BYTES`                         | `5242880`         | Resume size cap (5 MB)                                               |
| `DISABLE_RATE_LIMIT`                       | unset             | `true` disables the in-memory limiter (do not use in production)     |

# Worker (Phase 3)

| Variable            | Default                   | Purpose                                                                                                                                    |
| ------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `CRON_SECRET`       | empty (endpoint disabled) | Shared secret for `POST /api/internal/tick` and `npm run worker`                                                                           |
| `SALES_CONTACT_URL` | empty                     | Target of the "Talk to sales" button on the billing page (`mailto:` or `https:`)                                                           |
| `SAML_ISSUER`       | `urn:hirecraft:saml`      | SAML entity ID / audience used for SSO connections                                                                                         |
| `TICK_SECONDS`      | `60`                      | Worker interval                                                                                                                            |
| `SMTP_*`            |                           | Needed for any email (candidate messages, staff notification emails). Without `SMTP_HOST`, sending a message is refused with a clear error |

# AI and queue (Phase 4)

| Variable                                                  | Default                  | Purpose                                                                                    |
| --------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `FEATURE_AI`                                              | `true`                   | `false` switches every AI feature off                                                      |
| `AI_DEFAULT_PROVIDER`                                     | auto                     | `openai`, `anthropic`, `gemini`, `openai_compatible` (or `fake` in development / tests)    |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`   |                          | Platform keys. Portals without their own key use these and consume AI credits              |
| `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY` |                          | Self-hosted / other OpenAI-compatible endpoint                                             |
| `AI_MODEL_FAST`, `AI_MODEL_STANDARD`                      | per provider             | Override the default model per tier                                                        |
| `AI_EMBEDDING_MODEL`                                      | `text-embedding-3-small` | Must return 1536-dimension vectors                                                         |
| `AI_KEYS_ENCRYPTION_SECRET`                               | `NEXTAUTH_SECRET`        | Encrypts portal API keys (AES-256-GCM). Changing it makes saved keys unreadable            |
| `AI_DEFAULT_MONTHLY_CREDITS`                              | `500`                    | Platform-key credit limit per portal per month                                             |
| `AI_RATE_PER_MINUTE`                                      | `60`                     | Per-user token-bucket limit                                                                |
| `AI_ALLOW_FAKE`                                           | unset                    | Allows the deterministic fake provider in a production build (browser tests only)          |
| `AI_ALLOW_PRIVATE_BASE_URLS`                              | unset                    | `true` lets a portal point at localhost / private addresses (development only; SSRF guard) |
| `REDIS_URL`                                               | empty                    | BullMQ queue and shared rate limit. Empty = jobs run inline in the web process             |
| `QUEUE_INLINE_AWAIT`                                      | unset                    | Tests: wait for inline jobs to finish                                                      |

# Web Push and PWA (Phase 5)

| Variable            | Default                    | Purpose                                                                                      |
| ------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| `FEATURE_PUSH`      | `true`                     | `false` disables Web Push (subscribe returns 503, nothing is sent)                           |
| `VAPID_PUBLIC_KEY`  | empty (push off)           | Public VAPID key, sent to browsers so they can subscribe. `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | empty (push off)           | Private VAPID key. Server only, never returned by any API                                    |
| `VAPID_SUBJECT`     | `mailto:admin@example.com` | Contact URL or `mailto:` the push services may use                                           |

# Plans, domains, integrations and admin (Phase 6)

| Variable                                                                 | Default   | Purpose                                                                                                    |
| ------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------- |
| `ENTITLEMENTS_ENFORCEMENT`                                               | auto      | `on` / `off`. Auto = on when `STRIPE_SECRET_KEY` is set, so an install without billing has no limits       |
| `PLATFORM_ADMIN_EMAILS`                                                  | empty     | Comma-separated emails of platform super admins (the account's email must be verified)                     |
| `FEATURE_CUSTOM_DOMAINS`                                                 | `true`    | `false` turns custom domains off                                                                           |
| `PUBLIC_PORTAL_BASE_DOMAIN`                                              | empty     | Your own platform domain; hosts under it can never be claimed as a customer domain                         |
| `PORTAL_CNAME_TARGET`                                                    | empty     | What customers point their CNAME at (for example `portals.example.com`). Empty = TXT proof only            |
| `INTERNAL_APP_URL`                                                       | `APP_URL` | Where middleware asks which portal serves a custom host                                                    |
| `INTEGRATION_GOOGLE_CLIENT_ID`, `INTEGRATION_GOOGLE_CLIENT_SECRET`       | empty     | OAuth client for Google Calendar / Meet. Redirect URI: `APP_URL/api/integrations/callback/google_calendar` |
| `INTEGRATION_MICROSOFT_CLIENT_ID`, `INTEGRATION_MICROSOFT_CLIENT_SECRET` | empty     | OAuth app for Outlook / Teams. Redirect URI: `APP_URL/api/integrations/callback/microsoft_calendar`        |

`middleware.ts` runs on the edge runtime, which reads environment variables **when the app is built**:
`APP_URL`, `INTERNAL_APP_URL`, `FEATURE_CUSTOM_DOMAINS`, `PUBLIC_PORTAL_BASE_DOMAIN` must be present at build time.

Phase 1 added no environment variables. The variables below are added by
later phases (documented here when introduced, together with `.env.example` and
`lib/env.ts`): `FEATURE_CUSTOM_DOMAINS`,
`SMS_PROVIDER`.

Existing variables are documented in `.env.example`.
