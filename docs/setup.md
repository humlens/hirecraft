# Local setup

## Requirements

- Node.js 22 and npm
- Docker (for PostgreSQL with pgvector, Redis and MinIO), or your own PostgreSQL 15+ with the `vector` extension
- Optional: an AI provider key (OpenAI, Anthropic, Gemini or an OpenAI-compatible endpoint)

## 1. Get the code and services

```bash
git clone https://github.com/humlens/hirecraft.git
cd hirecraft
npm install
docker compose up -d
```

`docker-compose.yml` starts PostgreSQL 16 with pgvector (`admin` / `admin`, database `saas-starter-kit`), Redis, and MinIO
(S3-compatible, console on http://localhost:9001, bucket `resumes`).

## 2. Configure

```bash
cp .env.example .env
```

Minimum for local development:

```bash
NEXTAUTH_URL=http://localhost:4002
APP_URL=http://localhost:4002
NEXTAUTH_SECRET=$(openssl rand -base64 32)
DATABASE_URL=postgresql://admin:admin@localhost:5432/saas-starter-kit
AUTH_PROVIDERS=credentials          # add github, google, email, saml as you configure them
```

Optional, each unlocks a feature (all are documented in [env.md](env.md)):

| Feature                                     | Variables                                                                                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email (invites, magic links, notifications) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`                                                                                                           |
| Resume storage in S3/MinIO                  | `S3_ENDPOINT=http://localhost:9000`, `S3_BUCKET=resumes`, `S3_ACCESS_KEY_ID=minioadmin`, `S3_SECRET_ACCESS_KEY=minioadmin` (empty bucket = local disk, development only)      |
| AI                                          | `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` or `GEMINI_API_KEY`, `AI_KEYS_ENCRYPTION_SECRET`. For no key at all use `AI_DEFAULT_PROVIDER=fake` (canned answers, development only) |
| Background queue                            | `REDIS_URL=redis://localhost:6379` (without it jobs run inside the web process)                                                                                               |
| Web Push                                    | `npx web-push generate-vapid-keys`, then `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                                                                             |
| Worker and cron                             | `CRON_SECRET`                                                                                                                                                                 |
| Billing                                     | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, then `npm run sync-stripe`                                                                                                      |
| Platform admin                              | `PLATFORM_ADMIN_EMAILS=you@example.com` (account email must be verified)                                                                                                      |
| Webhooks, audit log                         | `SVIX_*`, `RETRACED_*` (set `FEATURE_TEAM_WEBHOOK=false` if you have no Svix)                                                                                                 |

## 3. Create the database schema

```bash
npx prisma migrate deploy      # applies prisma/migrations (creates the pgvector extension too)
```

The pgvector extension needs a database role that may run `CREATE EXTENSION` (the `admin` user in Docker can).

## 4. Run

```bash
npm run dev                    # http://localhost:4002
npm run worker                 # in a second terminal, if you set REDIS_URL or want reminders and scheduled jobs
```

Create an account at `/auth/join`, then **create your portal** (the onboarding wizard). The creator becomes the Portal Owner.
Open the careers site at `/p/<your-slug>`.

## 5. Tests and checks

```bash
npm test                                                     # unit tests
DATABASE_URL=postgresql://admin:admin@localhost:5432/hirecraft_test \
  npm run test:integration                                   # real PostgreSQL (create the database first)
npm run check-types && npm run check-lint && npm run check-locale && npm run check-format
```

Browser tests (Playwright):

```bash
npm run playwright:update                                    # once: browsers and system deps
npm run build && FEATURE_TEAM_WEBHOOK=false AI_DEFAULT_PROVIDER=fake AI_ALLOW_FAKE=true \
  VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... npm run start &
npm run test:e2e
```

Some specs need extra switches, documented at the top of each file: `tests/e2e/portal/enterprise.spec.ts` needs
`ENTITLEMENTS_ENFORCEMENT=on` and `PLATFORM_ADMIN_EMAILS=jackson@example.com`. Run the enterprise spec in its own session,
because the other specs assume limits are off.

## Troubleshooting

| Symptom                                      | Fix                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `extension "vector" is not available`        | Use the `pgvector/pgvector` image (see `docker-compose.yml`) or install pgvector     |
| Pages load but sign-in fails                 | `NEXTAUTH_URL` must equal the URL you open, and `NEXTAUTH_SECRET` must be set        |
| Resume upload says storage is not configured | Set the `S3_*` variables or leave `S3_BUCKET` empty for local disk                   |
| AI features answer 503                       | No provider key and `AI_DEFAULT_PROVIDER` unset: set a key or `fake` for development |
| Emails are not sent                          | `SMTP_HOST` is empty; messages are drafted but sending is refused with a clear error |
| Port 4002 in use                             | Another `next` process is running: stop it                                           |
