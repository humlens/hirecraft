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
