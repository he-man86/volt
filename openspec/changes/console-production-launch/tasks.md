Stand up the PRODUCTION stage for the commercial backend (dev is already live). Infra + secrets + deploy only;
no vendored-source edits. Depends on `stripe-go-live` for the live Stripe secrets.

## Production stage + domain
- [ ] Define the prod SST stage (stage name) and its domain/zone in `infra/stage.ts` — apex (console), `www.`
      (marketing), `support.` (gated portal) on the production domain.
- [ ] Production DNS: apex / `www.` / `support.` resolve on the prod domain (nameservers delegated to Cloudflare).

## Production database
- [ ] PlanetScale **production** branch created; connection secret set.
- [ ] Migrate the schema with `drizzle-kit migrate` (NOT `push`) — same 24-table schema as dev.

## Production secrets (~48)
- [ ] Cloudflare API token (R2/Workers/KV/DNS + Access edit), account id.
- [ ] PlanetScale prod DB URL/creds.
- [ ] **Stripe live** secret/publishable/webhook + live price id (from `stripe-go-live`).
- [ ] Google OAuth (prod client id/secret + redirect), OpenAuth session key.
- [ ] Zen prices/limits (`ZEN_*`), `SUPPORT_ALLOWED_EMAILS`, Honeycomb key (if monitoring).
- [ ] Sanity: `sst secret list` on the prod stage matches the console's `Resource.*` reads (no missing secret → no boot 500).

## Deploy (CI / Linux)
- [ ] Deploy the prod stage from CI (ubuntu) — `console/app`, gateway, `www`, `support`. Never the Windows dev box
      (SolidStart vite build mangles Windows paths).
- [ ] Production Cloudflare Zero Trust Access fronts `support.<prod-domain>` (email SSO) — no ungated exposure window.

## Config
- [ ] Set opencode's **default model to the cheap tier (DeepSeek)** so prod users don't default onto Claude.

## Smoke-verify (prod)
- [ ] Google login → Go subscription (**a real charge** via live Stripe) → a metered gateway completion succeeds.
- [ ] A gated support lookup at `support.<prod-domain>` returns for a known account (behind Access).
- [ ] `console models` / the agent shows `volt/deepseek-chat` + `volt/claude-sonnet-4-5` against the prod gateway.

## Docs
- [ ] `PROVISIONING.md`: production runbook — the prod-secret list + deploy + verify steps.
- [ ] After this + `stripe-go-live` land, archive `commercial-cloud-backend` (only optional/post-launch items remain).
