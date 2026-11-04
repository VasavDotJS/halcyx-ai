# HALCYX

Run Google Antigravity and other coding agents on your repositories from your phone, tablet or browser. Review every change, push to
GitHub, and the workspace erases itself.

- **Bring your own key.** Gemini (default, runs the Antigravity agent), Anthropic (Claude Managed Agents) or OpenAI. Keys stay on
  your device. The HALCYX backend never receives provider keys or source code.
- **Hosted sandboxes.** Agents run in the provider's cloud and keep going when the app is closed; you get a notification when they
  finish or need you.
- **Ephemeral, encrypted review.** Changes land in a per-task workspace encrypted with its own AES-256-GCM key. Accept or reject per
  file or per hunk, push to a `halcyx/<task>` branch (never force-push), and the key is destroyed after GitHub confirms the push.

Platforms: iOS, iPadOS, Android and web (installable PWA), from one Expo codebase.
Design decisions and their reasons are in [`DECISIONS.md`](DECISIONS.md).

---

## Contents

1. [Architecture](#architecture)
2. [Requirements](#requirements)
3. [Environment variables](#environment-variables)
4. [Backend setup (Supabase)](#backend-setup-supabase)
5. [GitHub App](#github-app)
6. [Run locally](#run-locally)
7. [Build and release with EAS](#build-and-release-with-eas)
8. [Deploy the PWA](#deploy-the-pwa)
9. [Tests](#tests)
10. [Build phases](#build-phases)
11. [Folder tree](#folder-tree)

---

## Architecture

```
 Device (iOS / Android / PWA)                                   Provider cloud
 ┌──────────────────────────────────────────────┐   API key    ┌───────────────────────────────┐
 │ Keystore: provider keys, GitHub token,       │ ───────────▶ │ Gemini Interactions API       │
 │           per-workspace keys, device key     │  (direct)    │  (Antigravity agent, sandbox) │
 │ SQLite + files: encrypted workspaces,        │ ◀─────────── │ Claude Managed Agents         │
 │           history, offline queue             │  SSE events  │ OpenAI Responses (on-device   │
 │ Review ▸ secret scan ▸ push (Git Data API)   │              │  tool loop, no sandbox)       │
 └───────┬──────────────────────────┬───────────┘              └──────────────┬────────────────┘
         │ metadata only (RLS)      │ push from device                          │ clone with scoped
         ▼                          ▼                                           │ read-only token
 ┌──────────────────────────┐  ┌──────────────────────┐                         │
 │ Supabase                 │  │ GitHub               │ ◀───────────────────────┘
 │ auth, settings, devices, │  │ repos, branches, PRs │
 │ task metadata, functions │  └──────────────────────┘
 └──────────────────────────┘
```

| Layer                  | Where                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Screens (expo-router)  | `app/`                                                                                        |
| Domain logic, no UI    | `core/` — providers, agent runner, workspace, GitHub, security, cleaner, usage, offline queue |
| Platform adapters      | `core/platform/` (SQLite, files, secrets; `.web.ts` variants for the PWA)                     |
| Components and theming | `ui/`                                                                                         |
| State                  | `state/` (zustand), TanStack Query for server data                                            |
| Backend                | `backend/supabase/` — migrations and Edge Functions                                           |
| Remote model list      | `config/models.json` (seeded into `model_config`)                                             |

---

## Requirements

- Node.js 22 LTS and npm 10+
- Expo SDK 58 (installed by `npm install`), EAS CLI ≥ 16 (`npm i -g eas-cli`)
- Xcode 17+ for iOS, Android Studio with SDK 36 for Android (only for local native builds; EAS builds in the cloud)
- Supabase CLI ≥ 2 (`npm i -g supabase`) and a Supabase project
- A GitHub account to register the GitHub App
- Optional: Maestro for E2E, a Sentry project, a Resend account for the email digest

---

## Environment variables

### App — `.env` (copy from `.env.example`)

These are public values bundled into the client. Provider API keys are **not** configured here; each user adds their own in the app.

| Variable                                          | Required       | Purpose                                                          |
| ------------------------------------------------- | -------------- | ---------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`                        | yes            | `https://<project-ref>.supabase.co`                              |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`                   | yes            | Supabase anon / publishable key (RLS protects the data)          |
| `EXPO_PUBLIC_GITHUB_APP_CLIENT_ID`                | yes            | Client ID of your GitHub App                                     |
| `EXPO_PUBLIC_GITHUB_APP_SLUG`                     | yes            | GitHub App slug, used for the "choose repositories" install link |
| `EXPO_PUBLIC_SENTRY_DSN`                          | no             | Crash reporting; leave empty to disable Sentry                   |
| `EAS_PROJECT_ID`                                  | for EAS        | From `eas init`                                                  |
| `EAS_UPDATE_URL`                                  | for EAS Update | `https://u.expo.dev/<EAS_PROJECT_ID>`                            |
| `HALCYX_IOS_BUNDLE_ID` / `HALCYX_ANDROID_PACKAGE` | no             | Defaults to `app.halcyx.mobile`                                  |
| `SENTRY_ORG` / `SENTRY_PROJECT`                   | with Sentry    | Source-map upload; `SENTRY_AUTH_TOKEN` goes in EAS secrets only  |

### Edge Functions — `backend/supabase/functions/.env` (copy from `.env.example`)

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase automatically.

| Variable                                            | Used by                               | Purpose                                                                                             |
| --------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` | `github-oauth`, `github-scoped-token` | Token exchange/refresh and minting scoped read-only tokens                                          |
| `GITHUB_REDIRECT_URIS`                              | `github-oauth`                        | Comma-separated allow-list, e.g. `halcyx://github-callback,https://app.example.com/github-callback` |
| `ALLOWED_ORIGIN`                                    | all                                   | CORS origin of your PWA (e.g. `https://app.example.com`)                                            |
| `DIGEST_SECRET`                                     | `email-digest`                        | Shared secret with the cron job (random 32+ chars)                                                  |
| `RESEND_API_KEY` / `DIGEST_FROM`                    | `email-digest`                        | Only if you enable the email digest                                                                 |

---

## Backend setup (Supabase)

```bash
cd backend
supabase login
supabase link --project-ref <project-ref>

# 1. Database: tables, RLS, functions, digest cron, model config seed
supabase db push

# 2. Edge Functions
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy            # all functions; JWT verification per config.toml
                                     # (email-digest has it off and checks DIGEST_SECRET instead)
```

**Auth providers** (Dashboard ▸ Authentication):

- Enable Email (confirmations on), Apple, Google and GitHub. For local development, `config.toml` reads their client IDs/secrets
  from `SUPABASE_AUTH_{APPLE,GOOGLE,GITHUB}_{CLIENT_ID,SECRET}`.
- Site URL `halcyx://`; redirect URLs `halcyx://auth-callback`, `halcyx://github-callback` and
  `https://<your-pwa-domain>/auth-callback`.
- Native Sign in with Apple on iOS uses `signInWithIdToken`; add your bundle ID to the Apple provider's client IDs.

**Email digest** (optional). The cron job in migration 004 reads two Vault secrets:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<same value as DIGEST_SECRET>', 'digest_secret');
```

**Updating the model list.** Edit `config/models.json`, bump `version`, and insert it into `model_config` (or add a migration). Apps
pick up the newest version on next launch; the bundled copy is the offline fallback.

---

## GitHub App

Create one at **GitHub ▸ Settings ▸ Developer settings ▸ GitHub Apps ▸ New GitHub App**:

| Setting                                                | Value                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Callback URLs                                          | `halcyx://github-callback` and `https://<your-pwa-domain>/github-callback`                                                       |
| Request user authorization (OAuth) during installation | on                                                                                                                               |
| Expire user authorization tokens                       | on                                                                                                                               |
| Enable Device Flow                                     | off                                                                                                                              |
| Webhook                                                | off (HALCYX doesn't use webhooks)                                                                                                |
| Repository permissions                                 | Contents: **Read & write** · Pull requests: **Read & write** · Checks: **Read** · Commit statuses: **Read** · Metadata: **Read** |
| Account permissions                                    | none                                                                                                                             |
| Where can it be installed                              | Any account                                                                                                                      |

Copy the **Client ID** into `EXPO_PUBLIC_GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_ID`, generate a **client secret** into
`GITHUB_APP_CLIENT_SECRET`, and put the app's slug into `EXPO_PUBLIC_GITHUB_APP_SLUG`.

The user token (read & write) never leaves the device except for the one-time exchange through `github-oauth`. Sandboxes only ever
get a token from `github-scoped-token`, narrowed to one repository with `contents: read` — so agents can't push or force-push.

---

## Run locally

```bash
npm install
cp .env.example .env              # fill in the values above
npx expo start                     # press i / a / w

# Native modules (secure store, speech recognition, background tasks) need a development build:
eas build --profile development --platform ios     # or android
```

The web dev server already sends the cross-origin isolation headers SQLite needs (`metro.config.js`).

---

## Build and release with EAS

```bash
eas login
eas init                                         # writes the project ID; put it in EAS_PROJECT_ID / EAS_UPDATE_URL

# Secrets for cloud builds (never commit these)
eas env:create --name SENTRY_AUTH_TOKEN --value <token> --visibility secret --environment production
eas env:create --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --environment production
eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon-key> --environment production
eas env:create --name EXPO_PUBLIC_GITHUB_APP_CLIENT_ID --value <client-id> --environment production
eas env:create --name EXPO_PUBLIC_GITHUB_APP_SLUG --value <slug> --environment production

# Builds
eas build --profile preview --platform all       # internal testing (APK + ad-hoc iOS)
eas build --profile production --platform all    # store builds, auto-incremented versions

# Store submission (set ASC_APP_ID / APPLE_TEAM_ID; place the Play service-account JSON at secrets/)
eas submit --profile production --platform ios
eas submit --profile production --platform android

# Over-the-air JS updates (runtime version uses the fingerprint policy, so native changes require a new build)
eas update --channel production --message "…"
```

Profiles live in `eas.json`: `development` (dev client), `preview` (internal distribution), `production` (store, `autoIncrement`).

---

## Deploy the PWA

### GitHub Pages (set up in this repo)

Every push to `main` runs `.github/workflows/pages.yml`: typecheck, lint and tests, then `expo export` with
`HALCYX_WEB_BASE_URL=/<repo-name>`, then `scripts/prepare-pages.mjs` and a Pages deploy. The site is served at
`https://<owner>.github.io/<repo-name>/`.

- One-time: **Settings ▸ Pages ▸ Build and deployment ▸ Source: GitHub Actions**.
- Client values come from repository **variables** (Settings ▸ Secrets and variables ▸ Actions ▸ Variables):
  `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (defaults to the project this repo was set up with),
  `EXPO_PUBLIC_GITHUB_APP_CLIENT_ID`, `EXPO_PUBLIC_GITHUB_APP_SLUG`, `EXPO_PUBLIC_SENTRY_DSN`. Re-run the workflow after changing them.
- GitHub Pages can't send custom headers, so the service worker adds the cross-origin isolation headers itself and the page
  reloads once on the first visit. Unknown paths fall back to `404.html` (a copy of the app), so deep links work.

### Any other static host

```bash
npx expo export --platform web      # outputs dist/
# serving from a sub-path?  HALCYX_WEB_BASE_URL=/sub npx expo export … && node scripts/prepare-pages.mjs dist /sub
```

`dist/` is a static single-page app. Serve it over HTTPS with an SPA fallback to `index.html`. Hosts that can set headers should send
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (SQLite on the web needs
`SharedArrayBuffer`); `vercel.json` and `netlify.toml` already do this plus security headers and caching.

On the web, saved keys are protected by a non-extractable WebCrypto key in IndexedDB, which is weaker than a device keystore; the app
tells users this when they save a key in a browser.

### Supabase auth URLs for the web app

In **Authentication ▸ URL Configuration**, set the Site URL to the PWA address and add
`https://<owner>.github.io/<repo-name>/auth-callback` (and `/github-callback` if you use GitHub sign-in from the web) to the
redirect URLs. Add the same `…/github-callback` URL to `GITHUB_REDIRECT_URIS` and to the GitHub App's callback URLs.

---

## Tests

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint, zero warnings
npm test               # jest: core (Node) + ui (jest-expo) projects
npm run test:ci        # with coverage
npm run e2e            # Maestro, on a running simulator/emulator with a dev or preview build
```

Highlights:

| Test                               | Proves                                                                                                                                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/workspace.shred.test.ts`    | After a confirmed push or on expiry no plaintext remains in the database or files and the workspace key is destroyed; force-push is never used; secrets block the push unless overridden; per-hunk decisions apply; interrupted pushes recover |
| `tests/noSecretsToBackend.test.ts` | Nothing resembling a key, token or source code can be sent to Supabase                                                                                                                                                                         |
| `tests/secretScanner.test.ts`      | The pre-push scanner finds provider keys, GitHub tokens, private keys, `.env` files; respects allow rules                                                                                                                                      |
| `tests/providers.test.ts`          | Request shapes and event parsing for Gemini Antigravity, Claude Managed Agents and OpenAI; effort mapping and cost estimates                                                                                                                   |
| `tests/themes.contrast.test.ts`    | Every theme and any custom accent meet WCAG AA contrast                                                                                                                                                                                        |
| `tests/ui.test.tsx`                | Diff view is screen-reader friendly, hunk toggling, keyboard shortcuts                                                                                                                                                                         |

**E2E (Maestro)** — `e2e/maestro/`. Use a dedicated test account:

```bash
HALCYX_E2E_EMAIL=e2e@example.com HALCYX_E2E_PASSWORD=… HALCYX_E2E_GEMINI_KEY=… \
  maestro test e2e/maestro            # APP_ID=… to override the bundle ID
```

Flows: cold launch → sign-in screen; sign-in and onboarding with key validation; live theme switching; storage cleaner; the privacy
wipe's authentication gate. GitHub OAuth (system browser) and biometric prompts can't be automated by Maestro, so those are covered by
unit tests instead.

---

## Build phases

1. **Foundation** — Expo SDK 58 + expo-router, strict TypeScript, NativeWind with CSS-variable tokens, Geist fonts, five themes with
   live switching, platform adapters (SQLite / files / secrets, web variants), crypto primitives, Sentry with scrubbing.
2. **Accounts and keys** — Supabase auth (Apple, Google, GitHub, email + password, magic link), device registration, BYOK vault with
   biometric reveal, the six-step Google key concierge, key validation per provider.
3. **Providers and agents** — `ProviderAdapter` for Gemini Antigravity, Claude Managed Agents and OpenAI; remote model config; effort
   slider with live cost/speed estimate; task runner with streaming timeline, stop / pause / follow-up / approvals, background polling
   and notifications, multi-agent compare.
4. **Workspace and review** — encrypted per-task workspace, diff engine (unified/split, per-file/per-hunk), AI summary, countdown and
   expiry warnings, secret scan, large-file and CI gates, push via Git Data API, PRs, crypto-shred after confirmed push.
5. **GitHub** — GitHub App OAuth + PKCE through an Edge Function, repo/branch/commit browsing, PRs, CI status, merge, scoped
   read-only sandbox tokens, rebase on conflict.
6. **Everything around it** — storage cleaner, usage meter with budget alerts and hard cap, offline queue, prompt library and slash
   commands, per-repo instructions, task history, notifications centre and email digest, privacy dashboard, live preview with QR,
   on-device voice and image input, tablet split view, keyboard shortcuts, accessibility.
7. **Backend** — migrations (schema, RLS, functions, digest cron, model seed) and Edge Functions.
8. **Quality** — unit, integration, UI and E2E tests; web export verified in headless Chrome.

---

## Folder tree

```
halcyx/
├── app/
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   ├── forgot.tsx
│   │   ├── sign-in.tsx
│   │   ├── sign-up.tsx
│   │   └── verify.tsx
│   ├── (tabs)/
│   │   ├── chat/
│   │   │   ├── [taskId].tsx
│   │   │   ├── _layout.tsx
│   │   │   └── index.tsx
│   │   ├── projects/
│   │   │   ├── [owner]/
│   │   │   │   └── [repo].tsx
│   │   │   ├── _layout.tsx
│   │   │   └── index.tsx
│   │   ├── review/
│   │   │   ├── [workspaceId].tsx
│   │   │   ├── _layout.tsx
│   │   │   └── index.tsx
│   │   ├── settings/
│   │   │   ├── _layout.tsx
│   │   │   ├── account.tsx
│   │   │   ├── agent.tsx
│   │   │   ├── appearance.tsx
│   │   │   ├── devices.tsx
│   │   │   ├── history.tsx
│   │   │   ├── index.tsx
│   │   │   ├── keys.tsx
│   │   │   ├── notifications.tsx
│   │   │   ├── privacy.tsx
│   │   │   ├── prompts.tsx
│   │   │   ├── security.tsx
│   │   │   ├── storage.tsx
│   │   │   └── usage.tsx
│   │   └── _layout.tsx
│   ├── compare/
│   │   └── [groupId].tsx
│   ├── keys/
│   │   └── [provider].tsx
│   ├── onboarding/
│   │   ├── _layout.tsx
│   │   ├── first-task.tsx
│   │   ├── github.tsx
│   │   ├── index.tsx
│   │   ├── key.tsx
│   │   └── repo.tsx
│   ├── _layout.tsx
│   ├── auth-callback.tsx
│   ├── github-callback.tsx
│   ├── index.tsx
│   ├── preview.tsx
│   └── reset-password.tsx
├── assets/
│   ├── adaptive-icon.png
│   ├── favicon.png
│   ├── icon.png
│   ├── notification-icon.png
│   ├── pwa-192.png
│   ├── pwa-512.png
│   ├── splash.png
│   ├── wordmark-dark.png
│   └── wordmark-light.png
├── backend/
│   └── supabase/
│       ├── functions/
│       │   ├── _shared/
│       │   │   └── http.ts
│       │   ├── delete-account/
│       │   │   └── index.ts
│       │   ├── email-digest/
│       │   │   └── index.ts
│       │   ├── github-oauth/
│       │   │   └── index.ts
│       │   ├── github-scoped-token/
│       │   │   └── index.ts
│       │   ├── notify/
│       │   │   └── index.ts
│       │   └── .env.example
│       ├── migrations/
│       │   ├── 20261102000001_schema.sql
│       │   ├── 20261102000002_rls.sql
│       │   ├── 20261102000003_functions.sql
│       │   ├── 20261102000004_digest_cron.sql
│       │   └── 20261102000005_model_config_seed.sql
│       └── config.toml
├── config/
│   └── models.json
├── core/
│   ├── agent/
│   │   ├── background.ts
│   │   ├── runner.ts
│   │   ├── taskStore.ts
│   │   └── timeline.ts
│   ├── app/
│   │   └── services.ts
│   ├── auth/
│   │   └── auth.ts
│   ├── backend/
│   │   ├── api.ts
│   │   ├── metadata.ts
│   │   └── supabase.ts
│   ├── cleaner/
│   │   ├── cleaner.ts
│   │   └── patterns.ts
│   ├── db/
│   │   └── migrations.ts
│   ├── github/
│   │   ├── checks.ts
│   │   ├── client.ts
│   │   ├── connect.ts
│   │   ├── oauth.ts
│   │   ├── pulls.ts
│   │   ├── push.ts
│   │   ├── repos.ts
│   │   └── tokens.ts
│   ├── monitoring/
│   │   └── sentry.ts
│   ├── notifications/
│   │   └── notify.ts
│   ├── offline/
│   │   └── queue.ts
│   ├── platform/
│   │   ├── files.ts
│   │   ├── files.web.ts
│   │   ├── idb.web.ts
│   │   ├── secrets.ts
│   │   ├── secrets.web.ts
│   │   ├── sqlite.ts
│   │   └── types.ts
│   ├── prompts/
│   │   ├── library.ts
│   │   └── slash.ts
│   ├── providers/
│   │   ├── anthropic.ts
│   │   ├── effort.ts
│   │   ├── gemini.ts
│   │   ├── handoff.ts
│   │   ├── http.ts
│   │   ├── modelConfig.ts
│   │   ├── openai.ts
│   │   ├── registry.ts
│   │   ├── sse.ts
│   │   └── types.ts
│   ├── security/
│   │   ├── biometrics.ts
│   │   ├── crypto.ts
│   │   ├── dataKey.ts
│   │   ├── installCrypto.ts
│   │   ├── installCrypto.web.ts
│   │   ├── keyFormat.ts
│   │   ├── keyVault.ts
│   │   ├── scrub.ts
│   │   ├── secretRules.ts
│   │   └── secretScanner.ts
│   ├── settings/
│   │   └── types.ts
│   ├── usage/
│   │   └── meter.ts
│   ├── workspace/
│   │   ├── diff.ts
│   │   ├── preflight.ts
│   │   ├── pushFlow.ts
│   │   ├── store.ts
│   │   └── tar.ts
│   └── types.ts
├── e2e/
│   └── maestro/
│       ├── subflows/
│       │   └── sign-in.yaml
│       ├── 01-launch.yaml
│       ├── 02-sign-in-onboarding.yaml
│       ├── 03-themes.yaml
│       ├── 04-storage-cleaner.yaml
│       ├── 05-privacy-wipe.yaml
│       └── config.yaml
├── hooks/
│   ├── useAppLifecycle.ts
│   ├── useAuthBootstrap.ts
│   ├── useKeyboardShortcuts.ts
│   ├── useKeys.ts
│   ├── useServices.ts
│   └── useTaskStream.ts
├── public/
│   ├── favicon.png
│   ├── index.html
│   ├── manifest.json
│   ├── pwa-192.png
│   ├── pwa-512.png
│   ├── register-sw.js
│   └── sw.js
├── state/
│   ├── session.ts
│   └── settings.ts
├── tests/
│   ├── helpers/
│   │   ├── fakeGitHub.ts
│   │   └── platform.ts
│   ├── setup/
│   │   ├── node.ts
│   │   └── ui.ts
│   ├── diff.test.ts
│   ├── noSecretsToBackend.test.ts
│   ├── providers.test.ts
│   ├── secretScanner.test.ts
│   ├── services.test.ts
│   ├── themes.contrast.test.ts
│   ├── ui.test.tsx
│   └── workspace.shred.test.ts
├── ui/
│   ├── primitives/
│   │   ├── Button.tsx
│   │   ├── Controls.tsx
│   │   ├── IconButton.tsx
│   │   ├── index.ts
│   │   ├── Layout.tsx
│   │   ├── Sheet.tsx
│   │   └── Text.tsx
│   ├── BootError.tsx
│   ├── CodeBlock.tsx
│   ├── color.ts
│   ├── Composer.tsx
│   ├── Countdown.tsx
│   ├── DiffView.tsx
│   ├── FileTree.tsx
│   ├── haptics.ts
│   ├── KeyConcierge.tsx
│   ├── LockScreen.tsx
│   ├── Logo.tsx
│   ├── MessageText.tsx
│   ├── ModelControls.tsx
│   ├── PreviewFrame.tsx
│   ├── PreviewFrame.web.tsx
│   ├── RepoList.tsx
│   ├── ReviewPanel.tsx
│   ├── StackLayout.tsx
│   ├── syntax.ts
│   ├── TaskList.tsx
│   ├── ThemeProvider.tsx
│   ├── themes.ts
│   ├── Timeline.tsx
│   └── useDictation.ts
├── .env.example
├── .gitignore
├── .prettierignore
├── .prettierrc
├── app.config.ts
├── babel.config.js
├── DECISIONS.md
├── eas.json
├── eslint.config.js
├── global.css
├── jest.config.js
├── metro.config.js
├── nativewind-env.d.ts
├── netlify.toml
├── package.json
├── README.md
├── tailwind.config.js
├── tsconfig.json
└── vercel.json
```
