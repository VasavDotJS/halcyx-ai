# HALCYX — Decisions

Where the master prompt left something open, HALCYX takes **the most secure option, then the simplest**. Every such choice is
recorded here with the reason. Facts about third-party APIs were verified against vendor docs on 2026-11-01/02 (sources at the end).

---

## 1. Trust boundaries (the rules everything else follows)

| Data                                                                                       | Where it lives                                                                                                                                                                | Never goes to                                                                         |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Provider API keys (Gemini / Anthropic / OpenAI)                                            | Device keystore (`expo-secure-store`, Keychain / Android Keystore). Web: AES-GCM with a non-extractable WebCrypto key in IndexedDB, shown with a "less secure on web" warning | HALCYX backend, Sentry, logs, notifications                                           |
| Source code, diffs, agent output                                                           | Ephemeral encrypted workspace on device + the provider's sandbox                                                                                                              | HALCYX backend, Sentry                                                                |
| GitHub user token (refresh + access)                                                       | Device keystore                                                                                                                                                               | HALCYX backend storage (the token-exchange function forwards it once, stores nothing) |
| Preferences, device list, task **metadata** (status, repo name, model, token counts, cost) | Supabase, with RLS on every table                                                                                                                                             | —                                                                                     |

- **D-1.1 Backend can't receive secrets by construction.** All writes to Supabase go through `core/backend/metadata.ts`
  `assertMetadataOnly()` (an allow-list of fields and value shapes), and the database has a `looks_secret()` CHECK on every free-text
  column that rejects strings that look like API keys / tokens / private keys. `tests/noSecretsToBackend.test.ts` proves both layers.
- **D-1.2 Provider calls go directly from the device to the provider.** No proxy. This is the only way to honour "keys never touch
  HALCYX servers" while still using hosted sandboxes.
- **D-1.3 The sandbox never gets a push-capable token.** The `github-scoped-token` Edge Function calls GitHub's
  `POST /applications/{client_id}/token/scoped` to mint a token restricted to **one repository** with `contents:read, metadata:read`.
  The agent can clone but cannot push, force-push or open PRs. Every push happens from the device after review.
- **D-1.4 Force-push is impossible, not just disabled.** `core/github/push.ts` always creates a commit whose parent is the current head
  and updates the ref with `force: false`; if the branch moved, it throws `RemoteMovedError` and the user is offered an agent rebase.
  There is no code path or setting that sets `force: true` (asserted in `tests/workspace.shred.test.ts`).

## 2. Agents and providers

- **D-2.1 REST + SSE for model providers; Octokit for GitHub.** Provider SDKs pull in Node built-ins and don't stream on React
  Native, so providers use typed `fetch` wrappers (`core/providers/http.ts`, `sse.ts`) with `expo/fetch` for streaming bodies on
  native. GitHub uses `@octokit/rest`, which runs on `fetch` everywhere and covers pagination and ~15 endpoints; replacing it with a
  hand-rolled client was judged riskier than its bundle cost (audit M-15). `diff` stays for its proven Myers implementation.
- **D-2.2 Gemini runs Google Antigravity via the Interactions API** (`POST /v1beta/interactions`, agent
  `antigravity-preview-09-2026`, `environment: "remote"`). The repo is mounted with a `repository` source and the scoped read token
  injected through the environment's network `transform` headers for `github.com` only.
- **D-2.3 Effort for Antigravity maps to a token budget.** The agent config exposes `max_total_tokens` but no thinking-level knob, so
  Low/Med/High map to 400k / 1.5M / 4M total tokens (`GEMINI_AGENT_BUDGET`). Max is disabled for Gemini models because the docs list
  only low/medium/high thinking levels for them. The cost/speed estimate under the slider uses the same numbers.
- **D-2.4 Anthropic uses Managed Agents** (beta header `managed-agents-2026-04-01`): one agent per user, and a cloud environment +
  session **per task**, both deleted after push so nothing lingers (the shared environment older versions created is removed once
  unused). Model and effort via `agent_with_overrides`; the repo is a `github_repository` resource with the scoped read token.
  Output files are paginated; more than 1,000 fails loudly rather than truncating.
- **D-2.5 OpenAI has no hosted coding sandbox in the Responses API**, so the OpenAI adapter runs a tool-calling loop **on the device**
  (read/list/write/delete file tools over the workspace overlay, repo reads via the GitHub API). It sends `store: false` and uses
  encrypted reasoning items so nothing persists at OpenAI between turns. It can't run tests or shell commands; the model picker
  marks OpenAI models with a "no sandbox" badge.
- **D-2.6 Handoff contract.** Sandboxed agents finish by running one fixed command (`handoffCommand()` in `core/providers/handoff.ts`)
  that writes `summary.md`, `checks.json` (lint/test results), `changes.tar` and `deleted.txt` into an outputs folder. HALCYX downloads
  those files, verifies every path with `safeRepoPath()` (no `..`, no absolute paths, no `.git/`), and ingests them into the encrypted
  workspace. A deterministic contract is simpler and safer than parsing free-form tool output.
- **D-2.7 Approvals.** "Ask before running commands" uses the runtime's `always_ask` permission policy on Anthropic (enforced by the
  platform). Antigravity has no equivalent switch, so on Gemini the agent is given an `approval` custom tool and instructions to call it
  before commands (`approvalEnforcement: 'instructed'`); Settings ▸ Agent behaviour says so in plain words. Approval mode (ask before
  deleting files, migrations or rewriting history) is on by default.
- **D-2.8 Model list is remote config.** `config/models.json` ships in the app and is seeded into `model_config` (migration 005); the app
  fetches the newest version at launch and falls back to the bundled copy offline. Prices not confirmed on a vendor pricing page are
  flagged `verified: false` and shown with "≈".
- **D-2.9 Model + effort are remembered per project** (repo `owner/name`, `core/prompts/library.ts` `rememberModel`), on device,
  defaulting to the provider default.
- **D-2.10 Multi-agent compare** starts the same prompt on 2–3 provider/model pairs as a group; each gets its own workspace and branch
  suffix so they can't collide, and the compare screen shows them side by side.

- **D-2.11 Sandbox egress is default-deny** (audit H-3). Gemini: an exact-host allowlist of package registries plus `github.com`;
  Anthropic: `limited` networking with Anthropic's package-manager host list. The `url_context` tool is not offered (it fetches
  arbitrary URLs outside the allowlist). Neither API supports path prefixes, so GitHub access is limited by the token: read-only, one
  repository. Users can opt into unrestricted access per device in Settings ▸ Agent behaviour, with the exfiltration risk stated.
- **D-2.12 Sandbox output is bounded before it is held on the phone** (audit H-2): downloads stop at 50 MB (checked by
  Content-Length, then while streaming), archives at 5,000 entries, files over 10 MB are listed as skipped (never pushed), and the
  pre-push secret scan decodes at most 2 MB per file / 64 MB per run. Files it couldn't scan block the push like secrets do.
- **D-2.13 The hard cap is enforced before every model call** (audit H-5): the runner re-checks remaining budget before each turn
  (follow-ups and reattaches included) and passes only what's left; the OpenAI loop checks before every request and sizes
  `max_output_tokens` to the remainder. A task whose model is no longer priced is refused instead of running unmetered.

## 3. Ephemeral encrypted workspace

- **D-3.1 One AES-256-GCM key per workspace**, generated on device, stored in the keystore as `ws-key.<id>`. File contents and
  sensitive columns are sealed as `[version][iv][ciphertext]` with the workspace id + path as AAD, so a blob can't be swapped between
  files or workspaces.
- **D-3.2 Crypto-shredding.** After a confirmed push (the remote ref equals the pushed commit SHA), on expiry, on discard or on "wipe
  all": delete the key first, then the files and rows. Without the key the ciphertext is unrecoverable even if flash storage keeps old
  pages. SQLite runs with `secure_delete = ON` as defence in depth. `tests/workspace.shred.test.ts` scans the database and the file
  directory for plaintext after push and after expiry and checks the key is gone.
- **D-3.3 Retention** defaults to **72 h**, configurable 1 h–7 d. A local notification fires 12 h before expiry. Expiry is enforced at
  launch, on resume and in the background task.
- **D-3.4 Unchanged files are skipped by git blob SHA**, so only real changes are stored and reviewed.
- **D-3.5 Crash safety.** A push writes an intent row before calling GitHub; `recoverInterruptedPushes()` at launch checks the remote and
  either completes the shred or returns the workspace to review. Task state is persisted after each event.
- **D-3.6 Pre-push gate.** A gitleaks-style scanner (`core/security/secretRules.ts`) runs over the final content; findings (rule, file,
  line, masked match) **block** the push until the user explicitly overrides after seeing them. Files over 5 MB warn, files over
  100 MB block (GitHub's limit); lint/test status from `checks.json` is shown next to the push button.
- **D-3.7 Remote sandbox cleanup.** After a confirmed push the provider environment/session is deleted by default
  (`keepSandboxAfterPush: false`), so code doesn't linger at the provider either.
- **D-3.8 Device data key.** History, the offline queue, prompts and the sealed Supabase session use one device data key from the
  keystore. It is destroyed by "Wipe all local data".

## 4. GitHub

- **D-4.1 GitHub App, not an OAuth App**, for per-repository consent and short-lived user tokens. OAuth uses PKCE; the code exchange and
  refresh run in the `github-oauth` Edge Function only because they need the app's client secret. Redirect URIs are allow-listed.
- **D-4.2 Pushes use the Git Data API** (blobs → tree → commit → ref) from the device, so no git binary is needed on mobile.
- **D-4.3 Branch naming** `halcyx/<task-slug>`, with `-2`, `-3`… appended if it exists. PR creation is optional at push time.
- **D-4.4 Conflicts.** If the base branch moved, the user can ask the agent to rebase in its sandbox; the result comes back through the
  normal review flow.

## 5. App, UX and platform

- **D-5.1 Expo SDK 58 / React Native 0.88 / expo-router**, one codebase for iOS, iPadOS, Android and web (PWA, `web.output: "single"`
  with `public/index.html` for the CSP and manifest).
- **D-5.2 Theming is token-driven.** Themes are CSS variables consumed by NativeWind (`rgb(var(--c-*) / <alpha>)`), so switching between
  Midnight, Paper, Graphite, Aurora and High Contrast (or a custom accent) re-renders instantly without reloading. A test checks every
  theme's text/background pairs against WCAG AA, including with arbitrary custom accents (which are adjusted until readable).
- **D-5.3 Fonts:** Geist and Geist Mono via `@expo-google-fonts`. All text uses `allowFontScaling` and layouts wrap, for Dynamic Type up
  to 200%. Motion respects reduce-motion.
- **D-5.4 Tablet:** at widths ≥ 900 the tab bar moves to a side rail, a task shows its timeline and review side by side, and diffs
  default to split view. **Keyboard shortcuts:** ⌘/Ctrl+↵ sends from the composer on every platform with a hardware keyboard.
  Global shortcuts (⌘/Ctrl+1–4 tabs, ⌘/Ctrl+K new task, ⌘/Ctrl+, settings) are implemented for the PWA (including iPad Safari);
  React Native has no app-wide key-event API on iOS/Android without a custom native module, so native apps get composer shortcuts only.
- **D-5.5 Background work keeps keys on the device.** Agents run in the provider cloud; an OS background task (`expo-background-task`,
  ~15 min minimum) polls the provider directly and raises **local** notifications. Cross-device push (`notify` function) carries
  only generic text + repo name. The alternative — a server polling providers — would require giving the server the keys.
- **D-5.6 Voice input is on-device** (`expo-speech-recognition` with `requiresOnDeviceRecognition`); if the device can't recognise
  offline, the mic button explains why instead of falling back to cloud recognition.
- **D-5.7 Live preview.** The agent prints `HALCYX_PREVIEW_URL=<url>` when it starts a dev server with a public URL; the app shows it in
  a WebView (iframe on web) with a QR code. Preview URLs come from the provider sandbox, never from HALCYX servers.
- **D-5.8 Usage meter** is computed on device from token counts returned by providers × config prices. Budget alerts fire at a
  configurable % (80% default). The **hard cap is on by default**: once the user sets a monthly budget, new tasks are blocked when it
  is reached and running tasks stop at their next turn.
- **D-5.9 Offline mode.** Review, history and settings work offline; new tasks are queued (sealed with the device data key) and sent when
  connectivity returns.
- **D-5.10 Storage cleaner** only deletes caches (dependency folders, build output, preview caches, finished-task logs) and **never**
  deletes source files or unpushed work — pending workspaces are excluded by construction. Auto-clean is on, 14 days.
- **D-5.11 App lock** (Face ID / Touch ID / BiometricPrompt + passcode fallback) is optional and off by default; revealing or exporting
  a saved key and "wipe all" always require device authentication regardless.
- **D-5.12 Sentry** is optional (no DSN → disabled). `sendDefaultPii: false`; `beforeSend` scrubs messages and exception values and
  drops stack-frame source lines and locals (`context_line`, `pre/post_context`, `vars`). Background failures that must not interrupt
  the user (cross-device notify, metadata reporting, push recovery, pruning) go to one scrubbed error sink (`core/monitoring/report.ts`)
  instead of being swallowed; a failed pull request after a successful push is shown as a warning.
- **D-5.13 Email digest** (off by default) is sent by a `pg_cron` job → `email-digest` function via Resend, built only from metadata.

## 6. Web (PWA) specifics

- **D-6.1** SQLite on web is `expo-sqlite`'s WebAssembly build, which needs `SharedArrayBuffer`, so the site must be cross-origin isolated:
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` (set in `metro.config.js` for dev and in
  `vercel.json` / `netlify.toml` for hosting).
- **D-6.2** The web build has no exclusive SQLite transactions, so transactions are serialised with an in-process lock and WAL is not
  used (`core/platform/sqlite.ts`).
- **D-6.3** A strict CSP allows only the provider, GitHub, Supabase and Sentry origins. The service worker caches the app shell only;
  API traffic is never cached.
- **D-6.4** If local storage can't be initialised, the app shows a "HALCYX couldn't start" screen with the reason instead of a blank page.

- **D-6.5 Hosted on GitHub Pages** (free, deploys from the repo on every push to `main`). Pages serves the app under `/<repo>` and
  can't set headers, so: Expo's `experiments.baseUrl` is set from `HALCYX_WEB_BASE_URL`; auth redirect URLs are built with
  `appUrl()` because `Linking.createURL` drops the base path on web; the service worker adds COOP/COEP (`credentialless`, or
  `require-corp` on Safari, which lacks credentialless) to same-origin responses and the page reloads once; `404.html` is a copy of
  the app for deep links; `.nojekyll` keeps `/_expo` published. Hosts that can send headers (Vercel, Netlify) need none of this.
- **D-6.6 Supabase publishable key** (`sb_publishable_…`) is used by the web build instead of the legacy anon JWT; both are public
  client keys and RLS protects the data.

## 7. Backend

- **D-7.1 Supabase** (Auth, Postgres, Edge Functions). RLS is enabled on every table with `auth.uid()` ownership policies; the
  `model_config` table is read-only for clients. Account deletion (`delete-account`) removes the auth user and cascades.
- **D-7.2 Auth methods:** Apple, Google, GitHub, email + password and magic link, all through Supabase Auth with PKCE. The Supabase
  session is stored sealed in AsyncStorage (the Keychain item size limit is too small for the session JSON).
- **D-7.3 Edge Functions fail closed** (audit H-1): a browser request is answered only when its `Origin` is listed in `ALLOWED_ORIGIN`
  (exact match, `Vary: Origin`, never `*`); native apps send no Origin and are unaffected. Bodies are size-checked before reading,
  every function is rate-limited per user in Postgres (`hit_rate_limit`), and the two token-broker functions plus account deletion
  write a metadata-only audit row (`function_audit`, 30-day retention). Cross-device push is deduplicated per task and event.
- **D-7.4 Least-privilege data access** (audit M-11): users can delete their own settings, task log and devices; devices are written
  only through `register_device()`, which takes `user_id` and `session_id` from the JWT and never revives a revoked device; device
  names that look like secrets are rejected by the database. The client's generic function call is limited to the two token-broker
  functions, the one place GitHub tokens (not provider keys or code) transit the backend.
- **D-7.5 Email digest** mails only users whose preference is exactly `daily`/`weekly` (queried per period and re-validated per row),
  pages through users with bounded concurrency inside a time budget, and compares the cron secret in constant time.

## 8. Repository hygiene

- **D-8.1 No LICENSE file yet:** the code is all-rights-reserved until the owner chooses a license (a legal choice, not a technical
  default). `SECURITY.md` sets up private vulnerability reporting through GitHub.
- **D-8.2 CI** (`.github/workflows/ci.yml`) runs typecheck, ESLint (including `public/` and a rule that keeps `core/` free of UI/state
  imports), Prettier, Jest, and `deno check` + `deno lint` for the Edge Functions on every PR and push to `main`.

## 9. Testing

- Unit/integration tests run on Node with `node:sqlite` and an in-memory file/secret store standing in for the device, plus a fake
  GitHub (`tests/helpers/fakeGitHub.ts`). UI tests use `jest-expo` + React Native Testing Library. End-to-end flows use Maestro
  (`e2e/maestro`). GitHub OAuth and biometric prompts can't be driven by Maestro, so those flows verify the gates instead.

---

## Sources

- Gemini Antigravity agent, Interactions API, environments, credentials, streaming —
  https://ai.google.dev/gemini-api/docs/antigravity-agent · https://ai.google.dev/gemini-api/docs/interactions-overview ·
  https://ai.google.dev/gemini-api/docs/agent-environment · https://ai.google.dev/gemini-api/docs/agent-credentials ·
  https://ai.google.dev/gemini-api/docs/streaming
- Gemini models and pricing — https://ai.google.dev/gemini-api/docs/models · https://ai.google.dev/gemini-api/docs/pricing
- Claude Managed Agents — https://platform.claude.com/docs/en/managed-agents/overview ·
  https://platform.claude.com/docs/en/managed-agents/sessions · https://platform.claude.com/docs/en/managed-agents/environments ·
  https://platform.claude.com/docs/en/managed-agents/events-and-streaming · https://platform.claude.com/docs/en/managed-agents/tools
- OpenAI API changelog (models, reasoning effort) — https://developers.openai.com/api/docs/changelog
