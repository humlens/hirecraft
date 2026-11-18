<p align="center">
  <img src="public/logo-wordmark.png" alt="HireCraft" width="360">
</p>

<p align="center"><strong>An AI-enabled, multi-tenant job portal and applicant tracking system.</strong><br>
Every company gets a branded careers portal, a full hiring pipeline and AI help that suggests but never decides.</p>

---

## What it does

| For                     | You get                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Companies (portals)** | Branded careers site (own domain on Enterprise), jobs with screening questions, pipeline board, talent database and pools, interviews and scorecards, offers with approval chains, approved-before-sent candidate messages, analytics, automation rules |
| **Recruiters**          | A phone-first review queue, today's interviews, push notifications, AI match explanations, natural-language talent search, a permission-scoped copilot                                                                                                  |
| **Candidates**          | One profile across portals, resume upload with AI parsing you confirm, application tracking, consent controls, data export and deletion, opt-in job recommendations                                                                                     |
| **The platform**        | Plans and limits enforced on the server, Stripe billing with grace period, platform admin (suspend, plan overrides, audit log), integrations (calendar, partners, webhooks, SSO, SCIM)                                                                  |

**Principles**

- **Tenant isolation on the server.** A Prisma extension requires a `teamId` filter on every tenant table; portals can never read each other's data.
- **People decide.** AI results explain and suggest. They never move, reject, hire or message a candidate. Matching scores are computed in code, and the model sees only anonymised text.
- **Consent first.** Push, recommendations, talent pools and AI recommendations are opt-in, per portal or per device.

## Built with

Next.js 16 (Pages Router, webpack) · React 19 · TypeScript · Prisma 6 · PostgreSQL + pgvector · NextAuth · Tailwind + daisyUI · BullMQ + Redis (optional) · S3-compatible storage · Stripe · OpenAI / Anthropic / Gemini / OpenAI-compatible · Web Push (VAPID) · Playwright and Jest

## Quick start

```bash
git clone https://github.com/humlens/hirecraft.git && cd hirecraft
cp .env.example .env            # then edit it (see docs/setup.md)
docker compose up -d            # PostgreSQL + pgvector, Redis, MinIO
npm install
npx prisma migrate deploy
npm run dev                     # http://localhost:4002
```

Full instructions, environment variables and test commands: **[docs/setup.md](docs/setup.md)**.

## Deploy

| Target                                                | Guide                                                 |
| ----------------------------------------------------- | ----------------------------------------------------- |
| **Vercel** (web) + managed Postgres, Redis and S3     | [docs/deploy-vercel.md](docs/deploy-vercel.md)        |
| **AWS** (ECS Fargate, RDS, ElastiCache, S3, SES, ALB) | [docs/deploy-aws.md](docs/deploy-aws.md)              |
| Any container host                                    | `Dockerfile` (web, worker and migrate from one image) |

## Documentation

|                                                                 |                                                             |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| [setup.md](docs/setup.md)                                       | Local setup, environment, running tests                     |
| [env.md](docs/env.md)                                           | Every environment variable                                  |
| [architecture.md](docs/architecture.md) · [erd.md](docs/erd.md) | How it is built and the data model                          |
| [permissions.md](docs/permissions.md)                           | Roles, permission keys, who can call what                   |
| [ai.md](docs/ai.md)                                             | AI pipeline, providers, fairness rules                      |
| [mobile.md](docs/mobile.md)                                     | Phone layouts, PWA, Web Push, review queue                  |
| [enterprise.md](docs/enterprise.md)                             | Plans, limits, custom domains, integrations, platform admin |
| [deployment.md](docs/deployment.md)                             | Operational notes (migrations, worker, storage)             |

## Scripts

| Command                                                                |                                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`                                      | Develop, build (runs migrations) and serve on port 4002                      |
| `npm run worker`                                                       | Background worker (AI jobs, reminders, scheduled jobs, usage reconciliation) |
| `npm test`                                                             | Unit tests                                                                   |
| `npm run test:integration`                                             | Integration tests against PostgreSQL                                         |
| `npm run test:e2e`                                                     | Playwright end-to-end tests                                                  |
| `npm run check-types` · `check-lint` · `check-locale` · `check-format` | Quality gates                                                                |

## License

See [LICENSE](LICENSE).
