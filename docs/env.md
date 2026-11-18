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

| Variable       | Default                   | Purpose                                                                                                                                    |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `CRON_SECRET`  | empty (endpoint disabled) | Shared secret for `POST /api/internal/tick` and `npm run worker`                                                                           |
| `TICK_SECONDS` | `60`                      | Worker interval                                                                                                                            |
| `SMTP_*`       |                           | Needed for any email (candidate messages, staff notification emails). Without `SMTP_HOST`, sending a message is refused with a clear error |

Phase 1 added no environment variables. The variables below are added by
later phases (documented here when introduced, together with `.env.example` and
`lib/env.ts`): `REDIS_URL`, `AI_*`, `VAPID_*`, `PLATFORM_ADMIN_EMAILS`,
`PUBLIC_PORTAL_BASE_DOMAIN`, `FEATURE_AI`, `FEATURE_CUSTOM_DOMAINS`,
`FEATURE_PUSH`, `SMS_PROVIDER`.

Existing variables are documented in `.env.example`.
