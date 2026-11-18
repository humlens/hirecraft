# Architecture

Job-portal SaaS built on the BoxyHQ SaaS Starter Kit. The kit is the **SaaS
infrastructure layer** (auth, teams, invitations, RBAC, SSO, SCIM, audit logs,
webhooks, billing); the recruitment platform is its **business domain**.

This document covers Phase 1 (foundation and tenancy) and Phase 2 (recruitment core). Later phases extend it.

## 1. Verified facts about the starter kit

Verified against the code at the start of Phase 1 (commit `abc9b68` plus the
dependency upgrade). Differences from the build prompt are marked **Δ**.

| Area          | Finding                                                                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Framework     | Next.js **16.4** pages router, React 18, TypeScript, Tailwind 3 + daisyUI 4. **Δ** the prompt said 15.5; the upgrade was done first. The pages router is kept. Next 16 defaults to Turbopack, which cannot parse daisyUI 4's CSS, so `dev`/`build` use `--webpack`.                                    |
| DB            | PostgreSQL + Prisma (6.x). Migrations in `prisma/migrations`.                                                                                                                                                                                                                                          |
| Auth          | NextAuth 4 (`lib/nextAuth.ts`). Credentials, magic link, GitHub/Google, SAML via Jackson, account lockout, reCAPTCHA. Sessions: JWT (default) or database.                                                                                                                                             |
| Tenancy       | `Team` (`slug` unique, `domain` unique?).                                                                                                                                                                                                                                                              |
| `Team.domain` | **Existing meaning: an email domain associated with the team** (validated by `isValidDomain`, unique, shown in Team Settings; the error is "This domain is already associated with a team"). It is **not** a hostname. Custom portal domains therefore get a separate `PortalDomain` model in Phase 6. |
| Membership    | `TeamMember(teamId, userId, role: OWNER/ADMIN/MEMBER)`.                                                                                                                                                                                                                                                |
| Invitations   | `Invitation` (email or link, `allowedDomains`, 7-day expiry) accepted through `PUT /api/teams/[slug]/invitations`.                                                                                                                                                                                     |
| RBAC          | `lib/permissions.ts` (resource x action per `Role`), checked by `throwIfNotAllowed`; `throwIfNoTeamAccess` resolves the member from the `[slug]` param.                                                                                                                                                |
| API style     | One handler per route, `switch (method)`, zod via `validateWithSchema`, `ApiError`, `recordMetric`, `sendAudit` (Retraced), `sendEvent` (Svix).                                                                                                                                                        |
| Build         | `npm run build` ran `prisma db push`. **Δ** changed to `prisma migrate deploy` (see section 5).                                                                                                                                                                                                        |
| Existing e2e  | `tests/e2e` (Playwright); unit tests in `__tests__` (Jest).                                                                                                                                                                                                                                            |

## 2. Module map

```
pages/api/teams/...      tenant-scoped REST handlers  (existing + new)
pages/teams/[slug]/...   recruiter app screens         (existing + new)
models/                  Prisma data access            (existing + portal, portalRole)
lib/
  tenant.ts              requireTenantContext(): session -> tenant -> member -> permissions
  authz.ts               effective permissions, requirePermission, escalation guards
  portal-roles.ts        permission catalogue + system role templates (source of truth)
  tenantGuard.ts         Prisma extension refusing un-scoped tenant queries
  ownerGuard.ts          last-owner protection (row-locked, transactional)
  prisma.ts              guarded client (+ named `unguardedPrisma` escape hatch)
components/portal/       onboarding wizard, portal settings, roles matrix
```

### Reused unchanged

NextAuth (the only auth system, for recruiters and later candidates), SSO/SCIM
(`lib/jackson*`), Retraced audit (`sendAudit`), Svix webhooks (`sendEvent`),
Stripe billing, email (`lib/email`), feature flags (`lib/env.ts`), the UI kit
in `components/shared`, API-key, webhook and billing screens.

### Extended

`createTeam` (now creates a whole portal), members/invitations/permissions API
handlers, `TeamTab`, `Members`, invite forms, seed, Jest config.

## 3. Team = Portal = tenant

There is **no** parallel tenant or membership model.

| Job-portal concept | Starter-kit model                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Portal / tenant    | `Team` (+ 1:1 `PortalProfile`, `PortalBranding` keyed by `teamId @unique`)                                                   |
| Portal membership  | `TeamMember`                                                                                                                 |
| Base role          | `Role` enum OWNER / ADMIN / MEMBER (kept: the kit's SSO, webhook, API-key, billing screens still use it)                     |
| Portal role        | `PortalRole` (+ `PortalRolePermission`, `Permission`), referenced by `TeamMember.portalRoleId` and `Invitation.portalRoleId` |
| Portal Owner       | member with base role OWNER and the `portal_owner` role                                                                      |
| Suspension         | `Team.status` / `suspendedReason`                                                                                            |

### Roles and permissions

`Permission` keys are code (`lib/portal-roles.ts`) and mirrored into the DB.
Seven system roles are **copied into every portal** (rows with `teamId` set,
`isSystem = true`) on creation, or lazily for portals that predate them.
Custom roles are per-portal rows with `isSystem = false`.

`getEffectivePermissions(member)`:

1. base role **OWNER** -> every key;
2. otherwise, if a portal role is assigned -> exactly that role's keys;
3. otherwise (legacy member) -> what the base role implies
   (`ADMIN`: all but `billing.manage`/`roles.manage`; `MEMBER`: `portal.read`).

**Δ from the prompt:** the prompt says "plus whatever the base `Role` already
implies". Applying that implication on top of a portal role would let a custom
role with base ADMIN silently regain every admin permission, defeating the
point of fine-grained roles. The implication is therefore used only when no
portal role is assigned.

`PortalRole.baseRole` (**added**, not in the prompt's model list) records which
kit `Role` a member holding the role gets, so the kit's legacy screens keep
working. Custom roles may only be MEMBER or ADMIN.

Privilege escalation is blocked: you can only grant a role whose permissions
you hold yourself, only an OWNER can grant OWNER, and you cannot edit or remove
a member who holds permissions you lack.

Legacy resource-based checks (`lib/permissions.ts`, `throwIfNotAllowed`) still
guard the SSO, directory-sync, webhook, API-key and billing endpoints. They are
migrated to permission keys (`integrations.manage`, `billing.manage`, ...) in
Phase 6 together with plan gating.

## 4. Tenant isolation (the core rule)

1. **Tenant comes from the route.** `requireTenantContext(req, res, opts)`
   resolves the tenant from the `[slug]` query param only, loads the caller's
   membership, rejects non-members and suspended portals, attaches the
   effective permission set and optionally enforces a permission. A body-supplied
   `teamId` is never read. "No such portal" and "not a member" return the same
   403 (no slug probing). The only handler that does not use a slug is
   invitation _acceptance_, where the tenant is derived from the invitation
   token.
2. **Prisma guard.** `lib/tenantGuard.ts` is a client extension that refuses any
   query on a tenant model (`PortalProfile`, `PortalBranding`, `PortalRole`
   today; every new tenant model is added to `TENANT_MODELS`) that has no
   `teamId` filter (top level, inside `AND`, or a `teamId_*` compound unique) and
   any create without `teamId`. It **throws in development and test and logs an
   error in production.** `OR` does not count as a filter.
3. **Id confusion.** Every lookup by id also filters by the caller's `teamId`
   (`findFirst({ id, teamId })`), so another portal's role/member id yields 404.
4. **Permission checks are server-side.** The UI (`usePortalAccess`) only hides
   controls.
5. **Suspension.** `requireTenantContext` and the legacy `throwIfNoTeamAccess`
   return 403 for a suspended portal; invitations to it cannot be accepted.

## 5. Transactions

| Operation                                                                  | Where                                                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Create portal = team + role copies + owner membership + profile + branding | `createPortal` (one `$transaction`; a failing step leaves nothing behind) |
| Accept invitation = membership + delete the invitation (+ lazy role sync)  | `PUT .../invitations`                                                     |
| Remove / downgrade / leave                                                 | `assertNotLastOwner` inside the same transaction                          |
| Update role permissions + member/invitation base roles                     | `updatePortalRole`                                                        |

**Last owner guard.** `lockTeamOwners` does `SELECT ... FOR UPDATE` on the
team's owner rows, then counts. Two owners leaving at the same moment serialise:
exactly one succeeds (covered by a concurrency test).

An invitation can no longer silently change an existing member's role (it used to
`upsert`); accepting as an existing member returns 400.

## 6. Planned architectural changes (later phases)

| Change                                                 | Why                                                                                       | Phase |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ----- |
| Redis + BullMQ and a separate `worker/` process        | resume parsing, embeddings, bulk email, automation                                        | 3-4   |
| `lib/storage.ts` (S3-compatible, signed URLs)          | private resumes                                                                           | 2     |
| `pgvector` image/extension, `tsvector` columns         | hybrid search                                                                             | 4     |
| `lib/ai/` provider abstraction                         | AI features                                                                               | 4     |
| `lib/entitlements.ts`, `UsageCounter`                  | plan limits, 402/403 with upgrade hint                                                    | 6     |
| `PortalDomain`                                         | custom domains (cannot reuse `Team.domain`)                                               | 6     |
| Platform admin guard                                   | `/admin`; planned as env `PLATFORM_ADMIN_EMAILS` (documented in `docs/env.md` when added) | 6     |
| Public routes `/p/**`, host rewrite in `middleware.ts` | public portal                                                                             | 2 / 6 |

## 7. Deviations from the prompt (Phase 1)

- `PortalRole.baseRole` added; base-role implication only without a portal role (section 3).
- Custom roles are not plan-gated yet (Enterprise gate arrives with entitlements, Phase 6).
- `PortalDomain` and `PlatformAdmin` are deferred to Phase 6 (not needed by Phase 1).
- Next.js 16 / webpack instead of Next 15.5 / Turbopack (section 1).
- The 12 demo jobs and 20 candidates in the seed arrive with the models that need them (Phases 2-3).
- Retraced: `sendAudit` accepts new action names (`portal.update`, `portal.branding.update`, `role.create|update|delete`, `member.role.assign`).

---

# Phase 2: recruitment core

## 8. Modules added

```
lib/jobs.ts            effective status, open-job filter, publishability, JobPosting JSON-LD, HTML sanitiser
lib/pipeline.ts        the 13 default pipeline stages
lib/storage.ts         putObject / getSignedUrl / deleteObject (S3-compatible or local disk)
lib/uploadValidation.ts  MIME allow-list + magic-byte check, size cap, virus-scan hook
lib/rateLimit.ts       fixed-window limiter (in-memory) used by register / upload / apply
lib/candidateAuth.ts   session helper for candidate APIs
lib/publicPage.ts      getServerSideProps plumbing for public portal pages
models/job.ts          jobs: CRUD, state machine, duplicate, assignments, assignment scope
models/application.ts  pipeline board, stage moves (audited), resume access
models/apply.ts        apply flow, candidate dashboard data, withdraw, saved jobs
models/candidate.ts    registration, profile, resumes, privacy export / erasure
models/publicPortal.ts public reads (portal, job list + search, job detail, sitemap)
pages/api/teams/[slug]/jobs|applications/...   recruiter API
pages/api/candidate/...                         job-seeker API
pages/api/public/portals/[portal]/jobs/[jobSlug]/apply.ts
pages/p/[portal]/...                            public careers site (+ sitemap.xml, robots.txt)
pages/me/...                                    candidate dashboard
```

## 9. Data model (see `docs/erd.md`)

Tenant-owned (guarded; `teamId` required): `Job`, `JobSkill`, `JobLocation`,
`JobAssignment`, `ScreeningQuestion`, `PipelineStage`, `TenantCandidate`,
`JobApplication`, `ApplicationActivity`, `CandidateConsent`.

Global / user-owned (not tenant tables): `CandidateProfile` (+ skills, experience,
education, certifications), `CandidateResume`, `SavedJob`.

- **Candidates are global users with per-portal records.** A job seeker is a normal
  `User` (NextAuth, the only auth system) with one `CandidateProfile`. What a portal
  holds about them is a `TenantCandidate` (unique per `(teamId, email)`), their
  applications and consent records. A recruiter reaches a candidate only through an
  application to their portal.
- **`ApplicationActivity` is append-only.** The tenant guard refuses `update`,
  `updateMany`, `delete`, `deleteMany` and `upsert` on it, even in production.
  (DB cascades from deleting a team / application still apply.)
- Screening answers are stored as a snapshot
  `[{ questionId, prompt, type, value }]`, so they stay meaningful if the questions
  are edited later.
- Full-text search: `Job.search` is a **generated `tsvector` column** with a GIN
  index (migration SQL). Prisma cannot filter on it, so public search runs a raw,
  parameterised `websearch_to_tsquery` that returns ids scoped by `teamId`.

## 10. Request flows

**Recruiter** -> `requireTenantContext` (slug -> membership -> permissions ->
suspension) -> permission key -> assignment scope -> model function.
Assignment-scoped roles (Recruiter, Hiring Manager, Interviewer) only see jobs
they are assigned to (`jobScope`); a job outside the scope is a 404, never a 403, so
existence does not leak. Creators are auto-assigned as `RECRUITER`.

**Public portal** (no login): `/p/[portal]/...` pages call `getPortalProps`, which
returns 404 for an unknown portal and a 403 notice (with `noindex`, empty profile and
no job data) for a suspended one. Jobs are visible when
`status = PUBLISHED` (or `SCHEDULED` with `publishAt <= now`) and `closesAt` is not
past; `PUBLIC` jobs are listed, `UNLISTED` ones are reachable by link only,
`INTERNAL` never. Public models select explicit fields (no `createdById`,
`teamId`, assignments, ...).

**Apply** (`POST /api/public/portals/[portal]/jobs/[jobSlug]/apply`): signed-in user ->
rate limit -> portal active -> zod (consent is required) -> one transaction: find or
create `TenantCandidate`, reject duplicates, create the application in the first
ACTIVE stage, an `APPLIED` activity and the consent rows. The unique
`(jobId, tenantCandidateId)` constraint makes concurrent double submits safe (one
201, the rest 409). A candidate can only apply with their own resume.

**Stage change**: one transaction updates the application, writes the append-only
`STAGE_CHANGED` activity (actor, from, to, names, reason) and then emits the audit
event (`application.stage_change`) and Svix events (`application.stage_changed`,
`candidate.hired`). Candidates are the only ones who can withdraw; a withdrawn
application can no longer be moved. Bulk moves apply each application independently
and report per-id results (max 100).

## 11. Files and resumes

`lib/storage.ts` has two drivers behind one interface:

- **S3-compatible** when `S3_BUCKET` is set (AWS S3, MinIO, ...): private objects and
  pre-signed GET URLs.
- **Local disk** otherwise (development and tests): files in `STORAGE_LOCAL_DIR` and
  HMAC-signed URLs served by `/api/storage/local`.

Keys must match `candidates/{userId}/...` or `tenants/{teamId}/...` (path traversal
is rejected). Resumes are never public: `GET .../applications/[id]/resume` and
`GET /api/candidate/resumes/[id]` check permission, tenant and assignment scope
**first**, then return a URL that expires in 60 seconds. Uploads: PDF/DOCX only,
checked by declared type **and** magic bytes, capped at `MAX_RESUME_BYTES` (5 MB,
enforced while streaming), file names sanitised, per-user rate limit, a virus-scan
hook (`setUploadScanner`), at most 10 resumes per candidate. Parsing is manual until
Phase 4.

## 12. Privacy

- Consent rows (`APPLICATION`, `TALENT_POOL`) are stored per portal with the policy
  version (the privacy policy's last update) at the time of consent.
- `GET /api/candidate/privacy` exports the user's data as JSON (own data only; no
  password hash, storage keys or internal rejection reasons).
- `DELETE /api/candidate/privacy` erases the account: the profile, resumes (rows and
  files), saved jobs and the user are deleted; each portal's `TenantCandidate` is
  anonymised (`Deleted candidate`, no email/phone, no user link) and its applications
  keep only de-identified data (no resume, no answers); consents are marked revoked.
  Accounts that still belong to a portal must leave it first.
- Candidates never see recruiter notes or rejection reasons.

## 13. Deviations and assumptions (Phase 2)

- **The 13 default stages** are not listed in the prompt ("from the spec"); the
  assumed list is in `lib/pipeline.ts` (Applied, AI Shortlisted, Screening, Recruiter
  Review, Assessment, Hiring Manager Review, Technical/HR/Final Interview, Offer,
  Hired, Rejected, Withdrawn). Per-job and custom stages arrive in Phase 3.
- **Job children carry `teamId`** (the prompt keys them by `jobId` only), so they are
  covered by the tenant guard like every other tenant table.
- **`JobCategory` is omitted**; `department` / `industry` are free text. `ParsedField`,
  `SavedSearch`, notes, tags and talent pools belong to Phases 3-4.
- **Scheduled publishing and closing dates are evaluated lazily** at read time
  (`effectiveJobStatus`, `openJobWhere`); a worker will materialise them with the
  queue (Phase 3+). Public visibility is correct in the meantime.
- **Rate limiting is in-memory** (per process); the interface is ready for the Redis
  token bucket planned with BullMQ.
- **Entitlements are not enforced yet** (active-job and seat limits, Phase 6).
- **Candidate dashboard (screen 10)**: applications with a stage tracker, saved jobs,
  profile, resumes, and privacy (export / delete) are done. Recommendations, alerts
  and notifications need AI and the notification system (Phases 3-4).
- **Notifications**: only Svix webhooks fire in Phase 2; in-app / email / push come with
  Phase 3 and 5.
- **Interviewer scope** uses `JobAssignment` (kind `INTERVIEWER`) until interviews
  exist (Phase 3 adds `InterviewParticipant`).
- **No AI job-description panel** (Phase 4). Custom-domain host rewrite in
  `middleware.ts` is Phase 6; `/p/**` is public and gets the security headers.
- **Candidates reading across portals** (their own applications, export, erasure) use
  the explicit `unguardedPrisma` client, always filtered by the caller's user id.
