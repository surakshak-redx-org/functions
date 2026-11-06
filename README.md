# Surakshak Functions

Firebase Cloud Functions for the Surakshak women's safety app.

Separate from the app repo (`surakshak-redx-org/app`). Runtime: Node 22,
`firebase-functions` v6 (2nd-gen API).

## Setup

```bash
corepack enable
yarn install
```

## Local development

```bash
yarn serve   # builds, then starts the functions + firestore emulators
```

## Deploy

Deploys run in CI on push to `staging` / `production` (see
`.github/workflows/deploy.yml`). There is a **single Firebase project**,
`surakshak-2869a`, behind every tier — `surakshak-staging` /
`surakshak-production` are labels, not real project IDs — so both branches
deploy the same functions to the same project and a `production` push is the
authoritative, idempotent promote.

```bash
yarn deploy  # break-glass only; prefer CI
```

## Structure

```
src/
  index.ts            ← global options + exports every function
  moderation/         ← community moderation (Phase 5)
  live-tracking/      ← public live-location share link API + schedulers
  notifications/      ← push notifications (Phase 6+, placeholder)
  admin/             ← admin-triggered functions (Phase 9, placeholder)
  types/             ← Firestore document types, mirrored from the app repo
  utils/firebase.ts  ← Admin SDK init (db / messaging / auth)
tests/               ← Jest + firebase-functions-test
```

## Live tracking

Backs the live-location share link that contacts receive by SMS
(`https://landing-surakshak.vercel.app/track/<token>`). The app writes
`liveLocationSessions`; Firestore stays owner-only and `liveTrack` is the
**only public read path**. Code lives in `src/live-tracking/`; tunables are in
`src/live-tracking/constants.ts`.

| Function              | Trigger                    | Purpose                                                                                           |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `liveTrack`           | HTTPS, public, `GET`       | Token-gated, read-only position + route trail. Allow-listed body; never exposes ids or the token. |
| `detectLostContact`   | every 1 minute             | Flips stale `active` sessions to `lost_contact`; self-heals those with a fresh fix.               |
| `cleanupLiveTracking` | daily 03:00 `Asia/Kolkata` | Deletes `points` of sessions expired 24 h – 7 d ago. Session docs are kept.                       |

Endpoint: `https://asia-south1-surakshak-2869a.cloudfunctions.net/liveTrack?t=<token>`

Responses: `200` (`active` / `lost_contact` / `arrived`), `404 {error:'not_found'}`
(malformed, unknown **and** revoked tokens look identical), `405`,
`410 {state:'ended'}` (no coordinates), `429` + `Retry-After`, `500`.

Constants: `LOST_CONTACT_SECONDS` 300, `TRAIL_MAX_POINTS` 500,
`RATE_LIMIT_PER_IP` 30/min, `RATE_LIMIT_PER_TOKEN` 20/min,
`LIVE_TRACK_MAX_INSTANCES` 5, `SCHEDULER_BATCH_LIMIT` 200,
`POINTS_RETENTION_HOURS` 24, `POINTS_SWEEP_WINDOW_DAYS` 7.

Notes:

- Rate limits are per instance (in memory), so they are a best-effort brake;
  `maxInstances` bounds the total.
- `ALLOWED_ORIGINS` (CORS) lists the landing origin(s). **Add Vercel preview
  origins to it if previews should be able to call the API.**
- `detectLostContact` does **not** escalate (no SMS or push). Sessions hold
  only local contact ids, not phone numbers; the channel is an open product
  decision.
- ETA is not computed here (no Directions API call). `eta` / `destination` are
  passed through when the session already has them.

### Firestore rules (not in this repo)

Rules live only in the Firebase Console. The Admin SDK bypasses them, but the
app needs owner-only access to sessions and trail points. Add to the existing
rules (don't replace unrelated ones; source: app repo
`docs/live-tracking/functions-spec.md`, section 5):

```
match /liveLocationSessions/{sessionId} {
  allow create: if request.auth != null && request.resource.data.userId == request.auth.uid;
  allow read, update, delete: if request.auth != null && resource.data.userId == request.auth.uid;

  match /points/{pointId} {
    allow create: if request.auth != null
      && get(/databases/$(database)/documents/liveLocationSessions/$(sessionId)).data.userId == request.auth.uid;
    allow read: if request.auth != null
      && get(/databases/$(database)/documents/liveLocationSessions/$(sessionId)).data.userId == request.auth.uid;
    allow update, delete: if false;
  }
}
```

## Notes

- TypeScript strict mode — no `any`, no `eslint-disable` / `@ts-ignore` in `src/`.
- All functions documented with JSDoc; all service logic has unit tests.
- `onPostReported` notifies admins via FCM tokens stored in Firestore
  `admins/{uid}`. That collection is owned by the Phase 9 admin dashboard and
  does not exist yet — until it does, the function detects hidden posts and
  logs, but sends nothing.
- Never deploy directly from a laptop for a real release — use CI.

## Manual setup required

- **GitHub secret** `FIREBASE_SERVICE_ACCOUNT` — JSON key for a service account
  in `surakshak-2869a` with: Firebase Admin, Cloud Functions Admin, Service
  Account User, Cloud Build Editor, Artifact Registry Administrator.
- **Google Cloud APIs** in `surakshak-2869a`: Cloud Functions, Cloud Build,
  Artifact Registry, Eventarc, Cloud Run, Pub/Sub.
- **Branch protection** on `develop` / `staging` / `production` mirroring the
  app repo (no direct push, PR + 1 approval + passing checks).
- **OneSignal (for `checkOverdueJourneys`)** — the app registers pushes with
  OneSignal only, so this function pushes through OneSignal's REST API:
  - `firebase functions:secrets:set ONESIGNAL_REST_API_KEY` (OneSignal →
    Settings → Keys & IDs → REST API key)
  - `ONESIGNAL_APP_ID` param — the same app id the mobile app uses. CI
    deploys non-interactively and `.env.*` is gitignored, so set it as a
    GitHub **repository variable** `ONESIGNAL_APP_ID` (Settings → Secrets
    and variables → Actions → Variables); the deploy workflow writes
    `.env.surakshak-2869a` from it. For a local `yarn deploy`, create that
    file yourself or answer the prompt.
  - The CI service account needs **Secret Manager Admin** (the deploy binds
    the secret to the function), and the Secret Manager API must be enabled.
- **Firestore index** for `checkOverdueJourneys`: composite on
  `safeJourneySessions` — `status` ASC, `expectedArrivalAt` ASC.
- **Firestore index** for `detectLostContact`: composite on
  `liveLocationSessions` — `isActive` ASC, `status` ASC, `lastFixAt` ASC.
  (Serves both of its queries. `liveTrack` and `cleanupLiveTracking` use
  automatic single-field indexes.)
- **Firestore rules** for `liveLocationSessions` + `points` — see
  [Live tracking](#live-tracking).
