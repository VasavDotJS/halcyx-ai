# Security policy

## Reporting a vulnerability

Please report security issues **privately** through GitHub:
**Security ▸ Report a vulnerability** on this repository (GitHub private vulnerability reporting).
Do not open a public issue for anything that could put users' keys, tokens or code at risk.

Include what you found, how to reproduce it, and the impact you expect. You'll get an
acknowledgement within 7 days and a fix or mitigation plan within 30 days for confirmed issues.

## Scope

- The app (`app/`, `core/`, `ui/`, `public/`)
- The Supabase backend (`backend/supabase/` migrations and Edge Functions)
- Build and deploy configuration (`.github/workflows/`, `vercel.json`, `netlify.toml`)

## Design commitments

These are the guarantees a report can be measured against (details in `DECISIONS.md`):

- Provider API keys and source code never reach the HALCYX backend. GitHub user tokens transit
  only the `github-oauth` and `github-scoped-token` functions, which store and log nothing.
- Agent sandboxes only get a read-only token for one repository and, by default, can reach
  package registries and the repository host only.
- Pushes never force-push; detected secrets block a push unless the user overrides after review.
- Review workspaces are encrypted per task and crypto-shredded after a confirmed push or expiry.
