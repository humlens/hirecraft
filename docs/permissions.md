# Roles and permissions

Source of truth: `lib/portal-roles.ts`. Enforcement: `lib/authz.ts` and
`lib/tenant.ts`. The UI only hides controls; **every API checks on the server.**

## How a member's permissions are computed

1. Base role `OWNER` -> all permissions (always).
2. Else a portal role is assigned -> exactly that role's permissions.
3. Else (members that predate portal roles) -> implied by the base role:
   `ADMIN` = all except `billing.manage` and `roles.manage`; `MEMBER` = `portal.read`.

Portals created before portal roles get their role copies lazily (when roles are
listed or an invitation is accepted).

## System roles

| Permission            | Portal Owner | Admin | HR Manager | Recruiter* | Hiring Manager* | Interviewer* | Viewer / Analyst |
| --------------------- | :----------: | :---: | :--------: | :--------: | :-------------: | :----------: | :--------------: |
| Base `Role`           |    OWNER     | ADMIN |   MEMBER   |   MEMBER   |     MEMBER      |    MEMBER    |      MEMBER      |
| `portal.read`         |      x       |   x   |     x      |     x      |        x        |      x       |        x         |
| `portal.update`       |      x       |   x   |            |            |                 |              |                  |
| `branding.update`     |      x       |   x   |            |            |                 |              |                  |
| `domain.manage`       |      x       |   x   |            |            |                 |              |                  |
| `members.invite`      |      x       |   x   |     x      |            |                 |              |                  |
| `members.remove`      |      x       |   x   |            |            |                 |              |                  |
| `roles.manage`        |      x       |       |            |            |                 |              |                  |
| `jobs.create`         |      x       |   x   |     x      |     x      |                 |              |                  |
| `jobs.read`           |      x       |   x   |     x      |     x      |        x        |              |        x         |
| `jobs.update`         |      x       |   x   |     x      |     x      |                 |              |                  |
| `jobs.publish`        |      x       |   x   |     x      |     x      |                 |              |                  |
| `jobs.delete`         |      x       |   x   |     x      |            |                 |              |                  |
| `candidates.read`     |      x       |   x   |     x      |     x      |                 |              |                  |
| `candidates.search`   |      x       |   x   |     x      |     x      |                 |              |                  |
| `candidates.update`   |      x       |   x   |     x      |     x      |                 |              |                  |
| `candidates.import`   |      x       |   x   |     x      |            |                 |              |                  |
| `candidates.export`   |      x       |   x   |     x      |            |                 |              |                  |
| `applications.read`   |      x       |   x   |     x      |     x      |        x        |      x       |        x         |
| `applications.manage` |      x       |   x   |     x      |     x      |                 |              |                  |
| `interviews.manage`   |      x       |   x   |     x      |     x      |                 |              |                  |
| `feedback.submit`     |      x       |   x   |            |            |        x        |      x       |                  |
| `offers.manage`       |      x       |   x   |     x      |            |                 |              |                  |
| `offers.approve`      |      x       |   x   |            |            |        x        |              |                  |
| `messages.send`       |      x       |   x   |     x      |     x      |                 |              |                  |
| `automation.manage`   |      x       |   x   |     x      |            |                 |              |                  |
| `ai.use`              |      x       |   x   |     x      |     x      |        x        |              |                  |
| `ai.configure`        |      x       |   x   |            |            |                 |              |                  |
| `analytics.read`      |      x       |   x   |     x      |            |                 |              |        x         |
| `billing.manage`      |      x       |       |            |            |                 |              |                  |
| `integrations.manage` |      x       |   x   |            |            |                 |              |                  |
| `audit.read`          |      x       |   x   |            |            |                 |              |                  |

`*` = **assignment-scoped** (see below). `portal.read` is granted to every role
so any member can open the portal; it is an addition to the prompt's matrix
(read-only access to the portal's own settings).

> `HR Manager` receives `jobs.*`, `candidates.*` and `applications.*`
> (wildcards expanded). `applications.*` = `read` + `manage`.

## Record-level scope

`Recruiter`, `Hiring Manager` and `Interviewer` are _assignment-scoped_:
`requireTenantContext` returns `scope: 'assigned'` for them (`'all'` for everyone
else and for owners). From Phase 2 the data-access layer applies the scope as a
filter (jobs via `JobAssignment`, applications via `InterviewParticipant`), not
each page. A member who also holds a portal-wide permission through another
mechanism sees everything.

## Custom roles

- Created by an owner or anyone holding `roles.manage` (Phase 1 gives this to the
  owner only), at `/teams/[slug]/roles`.
- A custom role's base `Role` is `MEMBER` or `ADMIN` (`ADMIN` only if the creator
  is ADMIN/OWNER). It is used for the kit's legacy screens (SSO, webhooks, ...).
- System roles cannot be edited or deleted. A role in use cannot be deleted.

## Guards

| Guard                         | Rule                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No escalation                 | You can grant only roles/permissions you hold yourself.                                                                                                            |
| Owner is special              | Only an OWNER can grant the Owner role. Only ADMIN/OWNER can grant an ADMIN base role.                                                                             |
| Can't touch a stronger member | You cannot edit/remove a member whose permissions you do not fully hold.                                                                                           |
| No self role change           | You cannot change your own role.                                                                                                                                   |
| **Last owner**                | The last Portal Owner cannot be removed, leave or be downgraded. Enforced in the API inside a row-locking transaction, so concurrent attempts cannot both succeed. |
| Suspended portal              | Every tenant API returns 403.                                                                                                                                      |

## Who can call what (Phase 1)

| Endpoint                                        | Permission                                                      |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `GET /api/teams/[slug]/permissions`             | membership                                                      |
| `GET /api/teams/[slug]/portal`                  | `portal.read`                                                   |
| `PUT /api/teams/[slug]/portal`                  | `portal.update` for `profile`, `branding.update` for `branding` |
| `GET /api/teams/[slug]/roles[/id]`              | any of `members.invite`, `members.remove`, `roles.manage`       |
| `POST/PUT/DELETE /api/teams/[slug]/roles[/id]`  | `roles.manage`                                                  |
| `GET /api/teams/[slug]/members`                 | any of `members.invite`, `members.remove`, `roles.manage`       |
| `PATCH /api/teams/[slug]/members`               | `members.invite` (+ escalation guards)                          |
| `DELETE /api/teams/[slug]/members`              | `members.remove` (+ guards)                                     |
| `PUT /api/teams/[slug]/members` (leave)         | membership                                                      |
| `GET/POST/DELETE /api/teams/[slug]/invitations` | any of the above / `members.invite`                             |
| `POST /api/teams` (create portal)               | any signed-in user                                              |

## Phase 2 endpoints

| Endpoint                                                           | Permission / rule                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `GET /api/teams/[slug]/jobs`                                       | `jobs.read` (+ assignment scope)                                    |
| `POST /api/teams/[slug]/jobs`                                      | `jobs.create` (creator is auto-assigned)                            |
| `GET /api/teams/[slug]/jobs/[id]`                                  | `jobs.read` (+ scope; out of scope = 404)                           |
| `PUT /api/teams/[slug]/jobs/[id]`                                  | `jobs.update` (+ scope)                                             |
| `DELETE /api/teams/[slug]/jobs/[id]`                               | `jobs.delete` (soft delete)                                         |
| `POST .../jobs/[id]/actions` `publish` `schedule` `close` `reopen` | `jobs.publish`                                                      |
| `POST .../jobs/[id]/actions` `archive`                             | `jobs.delete`                                                       |
| `POST .../jobs/[id]/actions` `duplicate`                           | `jobs.create`                                                       |
| `GET/PUT .../jobs/[id]/assignments`                                | `jobs.update`; assignees must be members of the portal              |
| `GET .../jobs/[id]/pipeline`                                       | `applications.read` (+ scope)                                       |
| `GET .../applications/[id]`                                        | `applications.read` (+ scope)                                       |
| `GET .../applications/[id]/resume`                                 | `applications.read` (+ scope); returns a 60 s signed URL            |
| `POST .../applications/stage` (single or bulk)                     | `applications.manage` (+ scope)                                     |
| `POST /api/candidate/register`                                     | public (rate-limited)                                               |
| `/api/candidate/*`                                                 | signed-in user; every query is filtered by the caller's own user id |
| `POST /api/public/portals/[portal]/jobs/[jobSlug]/apply`           | signed-in user; rate-limited; portal must be active                 |
| `GET /api/storage/local`                                           | valid, unexpired HMAC signature (local driver only)                 |

Role consequences: a **Recruiter** can create, edit and publish their own jobs and
move candidates, but cannot archive/delete jobs; a **Viewer** can read jobs and
applications but not change anything; **Hiring Manager** and **Interviewer** can read
applications of their assigned jobs only.

## Phase 3 endpoints

| Endpoint                                                                                 | Permission / rule                                                                                                                                   |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET .../talent`, `.../talent/[id]`, `.../talent/tags`, `.../talent/pools`               | `candidates.read` or `candidates.search`; visibility rules (see architecture section 15); assignment-scoped roles see only applicants of their jobs |
| `POST .../talent/[id]/notes`, `PUT .../talent/[id]/tags`, pools create/delete/membership | `candidates.update`                                                                                                                                 |
| `POST .../talent/import`                                                                 | `candidates.import` (max 1000 rows / 1 MB)                                                                                                          |
| `GET .../talent/export`                                                                  | `candidates.export`, rate-limited, audited                                                                                                          |
| `GET .../talent/duplicates`, `POST .../talent/merge`                                     | `candidates.update`                                                                                                                                 |
| `GET/POST .../applications/[id]/interviews`                                              | `interviews.manage` (+ job scope)                                                                                                                   |
| `GET .../interviews`, `GET .../interviews/[id]`                                          | `interviews.manage` (jobs in scope) or `feedback.submit` (own interviews only)                                                                      |
| `PUT .../interviews/[id]` (reschedule / cancel / status)                                 | `interviews.manage`                                                                                                                                 |
| `PUT .../interviews/[id]/feedback`                                                       | `feedback.submit` and participant of that interview                                                                                                 |
| `GET/POST .../offers`, `PUT .../offers/[id]`                                             | `offers.manage`; `GET` also for the approvers of that offer                                                                                         |
| `POST .../offers/[id]/actions` `submit` / `send`                                         | `offers.manage`                                                                                                                                     |
| `POST .../offers/[id]/actions` `approve` / `reject`                                      | `offers.approve` and the next pending approver; never the submitter / creator                                                                       |
| `GET/POST .../messages`, `PUT .../messages/[id]`                                         | `messages.send` (+ job scope)                                                                                                                       |
| `POST .../messages/[id]/actions` `approve` / `send` / `discard`                          | `messages.send`                                                                                                                                     |
| `GET .../analytics`                                                                      | `analytics.read`                                                                                                                                    |
| `GET .../analytics/export`                                                               | `analytics.read` **and** `candidates.export`                                                                                                        |
| `GET .../people?permission=`                                                             | `interviews.manage` or `offers.manage` (`feedback.submit` / `offers.approve` holders only)                                                          |
| stages, per-job pipeline, automation rules                                               | `automation.manage`                                                                                                                                 |
| `GET/POST /api/notifications`, preferences                                               | signed-in user, own rows only                                                                                                                       |
| `GET /api/candidate/interviews`, `/offers`, `POST /offers/[id]/respond`                  | signed-in candidate, own data only                                                                                                                  |
| `POST /api/internal/tick`                                                                | `Authorization: Bearer $CRON_SECRET`                                                                                                                |

Role consequences: **Recruiter** schedules interviews and drafts messages for their jobs but cannot
approve offers, export, or see analytics; **HR Manager** runs the whole ATS (talent, offers,
messages, analytics, pipeline settings); **Hiring Manager** approves offers they are asked to
approve and gives interview feedback; **Interviewer** only sees their interviews and submits
scorecards; **Viewer** can read analytics but not export.
