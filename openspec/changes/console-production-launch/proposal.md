## Why

The whole commercial backend — console, LLM gateway, marketing site, and the gated support portal — runs on the
**`dev` stage** (`dev.volt-ai.dev`) with test/placeholder secrets. It's proven end-to-end there, but it can't
serve real customers until it stands up on a **production stage** with production secrets, the production DB, live
Stripe keys, and production access-gating. `commercial-cloud-backend` named "production stage + provisioning the
still-placeholder secrets" as the remaining work; this change is exactly that.

## What Changes

- **Define the production SST stage** — the prod stage name + its domain/zone config (apex for the console, `www.`
  for marketing, `support.` for the gated portal on the production domain).
- **Provision the production DB** — a PlanetScale production branch, schema migrated via `drizzle-kit migrate`
  (never `push`).
- **Set the ~48 production SST secrets** — Cloudflare token, PlanetScale prod, **live Stripe keys + price**
  (from `stripe-go-live`), Google OAuth, session key, Zen prices/limits, Honeycomb, `SUPPORT_ALLOWED_EMAILS`.
- **Production DNS** — apex/www/support resolve on the production domain.
- **Deploy from CI (Linux)** — `console/app`, the gateway, `www`, and `support` (the `console/app` + `support`
  vite builds only run on Unix, so never the Windows dev box).
- **Production access-gating** — the Cloudflare Zero Trust Access app fronts `support.<prod-domain>` before it
  serves live customer data.
- **Flip opencode's default model to the cheap tier (DeepSeek)** so production users don't accidentally burn
  Claude (folds in the `commercial-cloud-backend` "set default model" gap).
- **Smoke-verify on prod**: Google login → Go subscription (a real charge) → metered gateway completion; and a
  gated support lookup returns for a known account.

## Impact

- **Infra / secrets / deploy only** — no vendored-source edits (the divergence footprint stays as declared in
  `DIVERGENCE.md`).
- **Depends on `stripe-go-live`** (prod uses the live Stripe secrets it stages).
- **Docs:** `PROVISIONING.md` gains the production runbook (the prod-secret list + the deploy/verify steps).
- Completing this + `stripe-go-live` clears the last non-optional threads in `commercial-cloud-backend`, so that
  epic can then be archived (its remaining items — model-quality validation, SES email, enterprise features, the
  usage dashboard — are all explicitly optional/post-launch).

## Non-goals

- Not the Stripe account activation / live-key creation itself (that's `stripe-go-live`; this consumes its output).
- Not the optional post-launch items (SES email, enterprise orgs/SSO, the live usage dashboard) — they stay
  deferred in `commercial-cloud-backend`.
- No new product features — this is a deployment/provisioning change.
