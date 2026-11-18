# Deploy on Vercel

Vercel runs the **web app** (pages, API routes, middleware). Everything stateful lives in managed services, and the long-running
**worker** cannot run on Vercel (see step 6).

```
Browser ──> Vercel (Next.js)  ──> PostgreSQL + pgvector   (Neon, Supabase, RDS ...)
                │           ├──> S3 / R2 bucket           (resumes)
                │           ├──> SMTP                     (SES, Resend, Postmark ...)
                │           ├──> AI provider              (OpenAI, Anthropic, Gemini ...)
                │           └──> Redis (optional)         (Upstash) ──> worker on another host
                └── Vercel Cron ──> /api/internal/cron
```

## 0. What you need

| Need                               | Notes                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Vercel account, the repo on GitHub | Project Node.js version: **22.x** (Settings → General)                      |
| PostgreSQL 15+ with **pgvector**   | Neon (also via the Vercel Marketplace), Supabase and AWS RDS all support it |
| S3-compatible bucket               | AWS S3 or Cloudflare R2. **Local disk does not work on Vercel**             |
| SMTP account                       | SES, Resend, Postmark, ... for invitations, magic links and notifications   |
| Optional                           | AI provider key, Stripe, Upstash Redis, Sentry                              |

## 1. Database

1. Create a PostgreSQL database and run once: `CREATE EXTENSION IF NOT EXISTS vector;`
2. Keep **two** connection strings:
   - **Pooled** (PgBouncer / "pooler" host): used by the app at runtime. Add `?pgbouncer=true&connection_limit=5` for Prisma.
   - **Direct**: used only to apply migrations (migrations need a session-level connection).
3. Apply the migrations from your machine or CI. **Do not** put this in the Vercel build, `vercel.json` skips it on purpose:

   ```bash
   DATABASE_URL="<direct connection string>" npx prisma migrate deploy
   ```

   Run it again for every release that adds a migration, **before** promoting the deployment.

## 2. Resume storage

1. Create a private bucket (block all public access, enable default encryption).
2. Create an IAM user (or R2 token) allowed `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `arn:aws:s3:::<bucket>/*`.
3. Environment: `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and **`S3_FORCE_PATH_STYLE=false`** for AWS S3.
   For R2 also set `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com` and `S3_REGION=auto`.
4. Vercel limits request bodies to 4.5 MB, so set **`MAX_RESUME_BYTES=4000000`**.

## 3. Import the project

1. Vercel → **Add New → Project** → import the GitHub repo. Framework preset: Next.js.
2. `vercel.json` already sets the build command (`prisma generate && next build --webpack`) and longer timeouts for the resume
   upload, copilot and match routes.
3. Do not deploy yet: add the environment variables first (step 4).

## 4. Environment variables

Set them for **Production** (and Preview with separate resources). Vercel passes project variables to the build, which matters:
**`middleware.ts` runs on the edge runtime and inlines `APP_URL`, `INTERNAL_APP_URL`, `FEATURE_CUSTOM_DOMAINS`,
`PUBLIC_PORTAL_BASE_DOMAIN` when the app is built**, so changing them needs a redeploy.

| Variable                                                            | Value                                                                                  |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                      | the **pooled** connection string                                                       |
| `NEXTAUTH_URL`, `APP_URL`                                           | your production URL, e.g. `https://careers.example.com` (no trailing slash)            |
| `NEXTAUTH_SECRET`                                                   | `openssl rand -base64 32`                                                              |
| `AUTH_PROVIDERS`                                                    | e.g. `credentials,email,google`                                                        |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | your mail provider                                                                     |
| `S3_*`, `MAX_RESUME_BYTES`                                          | step 2                                                                                 |
| `AI_KEYS_ENCRYPTION_SECRET`                                         | `openssl rand -base64 32` (never change it later: saved portal keys become unreadable) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`           | at least one, or portals bring their own key                                           |
| `CRON_SECRET`                                                       | `openssl rand -hex 32` (step 7)                                                        |
| `QUEUE_INLINE_AWAIT`                                                | `true` unless you run a worker (step 6)                                                |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`            | `npx web-push generate-vapid-keys` (push is off without them)                          |
| `PLATFORM_ADMIN_EMAILS`                                             | your email, to get `/admin`                                                            |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`                        | enables billing **and** plan limits                                                    |
| `FEATURE_TEAM_WEBHOOK`                                              | `false` unless you configured Svix                                                     |
| `PUBLIC_PORTAL_BASE_DOMAIN`, `PORTAL_CNAME_TARGET`                  | only for customer custom domains (step 9)                                              |

The full list is in [env.md](env.md).

## 5. Deploy

Push to the production branch (or click **Deploy**). Then check:

```bash
curl https://careers.example.com/api/health
```

Open the site, create an account at `/auth/join`, complete the portal wizard, and publish a job. Open `/p/<slug>` to see the
public portal.

## 6. Background work: choose one

`npm run worker` is a long-running process, which Vercel functions are not. Pick one:

| Option                   | When           | How                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Inline (simplest)** | Small installs | Leave `REDIS_URL` **unset** and set `QUEUE_INLINE_AWAIT=true`. Resume parsing and embeddings then finish inside the request (the upload waits a few seconds). Rate limits are per instance.                                                                                                                                                                                     |
| **B. Worker elsewhere**  | Real traffic   | Add `REDIS_URL` (Upstash `rediss://...`, TCP, not the REST URL) **and run `npm run worker` on a separate host** (a small Fly.io, Railway, Render or ECS container using the repo's `Dockerfile` with command `npm run worker`). The worker needs the same `DATABASE_URL`, `REDIS_URL`, S3, AI and `AI_KEYS_ENCRYPTION_SECRET`. Without a running worker, queued jobs just wait. |

> Setting `REDIS_URL` without a worker means uploads are queued and never processed. Set both or neither.

## 7. Scheduled tasks (reminders, scheduled jobs, offer expiry)

With option B the worker already does this. With option A use **Vercel Cron**. Add to `vercel.json`:

```json
"crons": [{ "path": "/api/internal/cron", "schedule": "*/10 * * * *" }]
```

Vercel sends `Authorization: Bearer $CRON_SECRET` automatically, and the endpoint checks it. The Hobby plan only allows daily
schedules; interview reminders (24 h and 1 h before) need at least hourly runs, so use Pro, or call it from an external
scheduler:

```bash
curl -X POST https://careers.example.com/api/internal/tick -H "Authorization: Bearer $CRON_SECRET"
```

## 8. Stripe (optional)

1. In Stripe create products and prices; set `metadata.plan` on each price to `starter`, `professional` or `enterprise`.
2. Webhook endpoint: `https://careers.example.com/api/webhooks/stripe`, events `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`.
3. `STRIPE_WEBHOOK_SECRET` from that endpoint; then `npm run sync-stripe` once (uses a local `.env`).

Plan limits are enforced as soon as `STRIPE_SECRET_KEY` is set (or `ENTITLEMENTS_ENFORCEMENT=on`).

## 9. Customer custom domains (Enterprise, optional)

1. Set `PORTAL_CNAME_TARGET=cname.vercel-dns.com` and `PUBLIC_PORTAL_BASE_DOMAIN` (your own domain) and redeploy.
2. A portal owner adds their hostname under **Integrations** and creates the TXT record shown there, plus a CNAME to
   `cname.vercel-dns.com`. Clicking **Check DNS** verifies ownership.
3. **Vercel must also know the hostname** to serve it and issue its certificate: add it to the project (Settings → Domains, or
   the Vercel API `POST /v10/projects/{id}/domains`). This step is manual (or scripted by you) on Vercel.
4. Sign-in and apply pages always open on your main domain, because session cookies are per host.

## 10. Post-deploy checklist

- [ ] `/api/health` returns 200
- [ ] Sign up, create a portal, publish a job, apply as a candidate in a private window
- [ ] Upload a resume (storage works) and see the parsed fields
- [ ] Invite a teammate (email works)
- [ ] `/admin` opens for the address in `PLATFORM_ADMIN_EMAILS`
- [ ] A cron call returns 200: `curl -H "Authorization: Bearer $CRON_SECRET" https://.../api/internal/cron`
- [ ] Stripe test checkout flips the plan (if enabled)

## Known limits on Vercel

| Limit                                                                                  | What to do                                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 4.5 MB request body                                                                    | `MAX_RESUME_BYTES=4000000`                                          |
| Function duration (10 s default, 60 s configured for the heavy routes, plan-dependent) | Use the worker (option B) for large volumes                         |
| No persistent disk                                                                     | S3 or R2 for files; `S3_BUCKET` is required                         |
| Per-instance memory for rate limits                                                    | Set `REDIS_URL` together with a worker if you need shared limits    |
| Preview deployments                                                                    | Give them their own database and bucket (Neon branching works well) |
