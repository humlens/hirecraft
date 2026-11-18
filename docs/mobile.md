# Mobile, PWA and Web Push (Phase 5)

## Layouts

Every screen is checked on a phone-sized viewport by `tests/e2e/portal/mobile.spec.ts`:
no page may scroll horizontally. The kit's drawer shell is used for the staff app; on small
screens the portal tabs scroll sideways and a bottom bar offers Review, Jobs, Interviews,
Talent and Alerts. Candidates get a bottom bar (Dashboard, Applications, Profile, Notifications).
Tap targets are at least 44 px high on the new mobile screens.

## Recruiter review queue (`/teams/:slug/review`)

- `GET /api/teams/:slug/review-queue` (permission `applications.read`, job scope applies):
  applications waiting in the first active stage of their pipeline, oldest first, with the
  latest AI assessment as a hint and the next stage.
- **Shortlist** calls the normal `POST applications/stage` (needs `applications.manage`), so it is
  audited and fires the same hooks, notifications and webhooks as a move on the board.
  **Later** only hides the card on this device. The queue never rejects anyone.
- The page also shows today's interviews for the signed-in member.

## PWA

- `public/manifest.webmanifest` (standalone, maskable icon) and a per-portal manifest at
  `/api/public/portals/:slug/manifest` (company name, brand colour, start page `/p/:slug`).
- `public/sw.js` is registered in production builds. It caches only **non-sensitive** content:
  hashed `/_next/static` files, icons, the offline page and public careers pages
  (`/p/:portal`, `/jobs`, a job page, about, contact, privacy). It never touches `/api`,
  the apply page, or any signed-in page, never stores a response that sets a cookie, keeps at
  most 30 pages, and forgets them on sign-out.
- Public pages are server-rendered with `Cache-Control: private, no-store` by Next.js, so for them the
  path allow-list, not that header, decides what may be stored.
- `/sw.js` is served `no-cache` with `Service-Worker-Allowed: /`; `middleware.ts` lets the PWA files
  through unauthenticated and the CSP allows `worker-src 'self'` and `manifest-src 'self'`.

## Web Push

- Opt-in per device from Notifications (`/me/notifications`, `/notifications`): nothing is asked until
  the user taps "Turn on notifications". Subscribing (`POST /api/push/subscribe`) is the consent;
  turning it off (`DELETE`) or deleting the account removes the device. Max 10 devices per user.
- `notify()` pushes when the user has a device **and** the per-type Push preference is on
  (defaults on for interviews, offers, new applications and assignments; off for the rest).
  Candidates receive push for in-app-only notifications too, but never email.
- Payloads carry a short title/body and a same-site relative link only; the service worker refuses
  any other target. Dead subscriptions (404/410) are deleted; a push failure never fails the
  action that triggered it.
- VAPID keys: `npx web-push generate-vapid-keys`; set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`. Without keys push is simply off.
- iOS only delivers Web Push to an installed home-screen app (iOS 16.4+).
