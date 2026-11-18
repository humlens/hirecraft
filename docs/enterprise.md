# Plans, domains, integrations and platform admin (Phase 6)

## Plans and entitlements (`lib/entitlements.ts`)

|                                                                                                    | Free | Starter | Professional | Enterprise |
| -------------------------------------------------------------------------------------------------- | ---- | ------- | ------------ | ---------- |
| Active jobs                                                                                        | 2    | 5       | 15           | unlimited  |
| Team seats                                                                                         | 2    | 5       | 10           | unlimited  |
| AI credits / month                                                                                 | 500  | 5,000   | 50,000       | 500,000    |
| Candidate storage (GB, metered)                                                                    | 1    | 5       | 25           | 500        |
| AI assist (JD, search, interview, drafts)                                                          | yes  | yes     | yes          | yes        |
| AI matching, copilot, automation, custom branding, calendar integrations                           |      |         | yes          | yes        |
| Custom roles, custom domain, SAML SSO, SCIM, API keys, own AI key, assessments / background checks |      |         |              | yes        |

Limits and features live in code and can be changed per plan by the platform admin (`PlanEntitlement`).
Price values are configuration: they belong in Stripe, not here.

- The plan comes from the Stripe price (`metadata.plan` = `free|starter|professional|enterprise`). The webhook
  (`customer.subscription.*`, `invoice.payment_failed`, `invoice.paid`) keeps `Team.planKey` in sync (`models/billingPlan.ts`).
  A platform admin can override a portal's plan (`Team.planOverride`).
- **Enforcement is on the server.** `assertEntitlement(teamId, { feature } | { limit, adding })` returns
  `402 { code: plan_limit | plan_feature, upgradeTo, ... }` and runs when publishing / scheduling / reopening a job, inviting or
  accepting a member, every AI call (feature and monthly credits), custom roles, automation, branding, API keys, SSO, SCIM,
  own AI key, custom domain and integrations. It is off when billing is not configured (see `ENTITLEMENTS_ENFORCEMENT`).
- **Lifecycle:** the first failed payment starts a 7-day grace period (banner, everything works). After that the portal is
  read-only: every write to a tenant API answers `402 read_only`, reads and billing still work. A paid invoice clears it.
  Cancelling keeps all data; when Stripe ends the subscription the portal drops to Free (existing jobs stay, new ones are
  limited). A downgrade is refused while usage exceeds the target plan (`checkDowngrade`, previewed by `GET plan?target=`
  and enforced in `create-checkout-session`).
- **Metering:** `UsageCounter` rows per portal and month: `jobs_published`, `applications` (incremented) and the gauges
  `activeJobs`, `seats`, `aiCreditsPerMonth`, `storageGb` (set by the nightly reconciliation in the worker tick).

## Custom domains (`lib/domains.ts`, `lib/domainRouting.ts`, `middleware.ts`)

1. Enterprise portals add a hostname (`/teams/:slug/settings/integrations`). It is normalised and refused if it is an IP,
   `localhost`, a reserved TLD, or under the platform's own domain.
2. They create `_verify.<host>` TXT `hc-verify=<token>` and (when `PORTAL_CNAME_TARGET` is set) a CNAME / matching A record.
   **Check DNS** verifies both. Until then several portals may hold an unverified claim; the first to prove DNS wins and a
   partial unique index lets a hostname be verified by only one portal.
3. A nightly recheck releases a verified host after two consecutive failures, so a dropped domain cannot block its next owner.
4. Routing: `middleware.ts` treats any host that is not the platform as a custom domain, asks
   `/api/public/domains/resolve?host=` (cached 30 s) and rewrites `/`, `/jobs`, `/jobs/<slug>`, `/about`, `/sitemap.xml`,
   `/robots.txt` to `/p/<slug>/...`. Sign-in, apply and app routes are redirected to the platform host (cookies are per host).
   Another portal's pages are a 404. A suspended portal shows its notice (403).
5. TLS: put an on-demand-TLS proxy (for example Caddy) in front and point its `ask` URL at
   `/api/public/domains/resolve`: it answers 200 only for verified hosts, so certificates are never issued for unknown names.

## Integrations (`lib/integrations`, `models/integration.ts`)

Official APIs only; nothing is scraped and nothing is assumed without credentials.

- **Google Calendar + Meet / Outlook + Teams** (Professional+): OAuth 2.0 with a signed state, a cookie nonce, the user and
  permission re-checked at the callback, offline access, tokens stored AES-256-GCM encrypted and refreshed on demand. Scheduling,
  rescheduling or cancelling an interview creates, replaces or deletes the calendar event for the **staff participants only**
  and can add a meeting link. The candidate's invitation stays an approved message draft. A calendar failure never fails the
  interview; it shows on the integration.
- **Assessments and background checks** (Enterprise): provider interfaces (`PartnerProvider`) with a generic adapter that sends
  an HMAC-signed JSON request to a public https URL the portal configured (SSRF-checked on save and on every call). A person
  triggers it (`POST applications/:id/partner`); background checks also need `offers.manage` and an explicit consent
  confirmation, and every request is noted on the application.
- **HRMS:** use the kit's signed webhooks (`candidate.hired`, ...). **SSO / SCIM / API keys:** the kit's existing pages, now
  plan-gated.

## Platform admin (`/admin`, `lib/platformAdmin.ts`)

A separate platform-wide role: the account's **verified** email must be listed in `PLATFORM_ADMIN_EMAILS`; nothing inside a
portal can grant it, and everyone else gets the same 403. The page lists portals (plan, usage, status), suspends / activates
with a reason, overrides a plan, edits plan limits and features, sets the platform default AI provider (write-only key), and
shows the platform audit log (`PlatformAuditLog`, append-only: `tenant.suspend`, `tenant.activate`, `tenant.plan_override`,
`plan.update`, `ai.default.update`). A suspended portal answers 403 on every tenant API and shows a notice on its public pages.
