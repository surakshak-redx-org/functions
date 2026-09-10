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
  notifications/      ← push notifications (Phase 6+, placeholder)
  admin/             ← admin-triggered functions (Phase 9, placeholder)
  types/             ← Firestore document types, mirrored from the app repo
  utils/firebase.ts  ← Admin SDK init (db / messaging / auth)
tests/               ← Jest + firebase-functions-test
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
