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
- [ ] Zen prices/limits (`ZEN_*`), `SUPPORT_ALLOWED_EMAILS`. Honeycomb takes TWO keys — see "Monitoring" below.
- [x] `SUPPORT_API_KEY` reaches the prod stage. It existed as a GitHub env secret but was never passed to the
      deploy-secrets step, so every production deploy overwrote it with `PLACEHOLDER_UNSET` (fixed 2026-07-27).
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

## Monitoring (Honeycomb → Discord) — DEFERRED, blocked upstream
Production runs with monitoring OFF: `HONEYCOMB_CONFIG_KEY` is absent from the prod GitHub environment, so
`sst.config.ts` skips `infra/monitoring.ts` and `infra/console.ts` skips the tail consumer. Everything else
(site, console, gateway, Cloudflare Web Analytics) is live and unaffected. Investigated 2026-07-27; four
production deploys failed on this before it was parked. Do NOT retry by "just setting the key" — two blockers
below are structural.

**Done and worth keeping:**
- [x] Workers **Paid** plan (tail Workers are a paid feature — `infra/console.ts:310`).
- [x] The two Honeycomb key types are wired to separate GitHub secrets, since both feed the env var
      `HONEYCOMB_API_KEY` and neither key can do the other's job:
      `HONEYCOMB_API_KEY` = **ingest** key → the SST secret the log-processor sends as `X-Honeycomb-Team`;
      `HONEYCOMB_CONFIG_KEY` = **configuration** key (needs *Manage Recipients* + *Manage Triggers*) → the
      honeycombio provider. Wrong way round gives "this API key isn't allowed to manage recipients" (config
      slot) or a silent ingest 401 (SST slot).
- [x] The Discord `WebhookRecipient` was created successfully in Honeycomb before the triggers failed, so that
      resource already exists on the account.

**Blocker 1 — the alert definitions and the vendored gateway are from different opencode revisions.**
`infra/monitoring.ts` filters on `isGoTier`, `isFreeTier` and `tps.output`; those strings have **zero matches**
anywhere in `packages/console`. Only `IncreasedProviderHttpErrors` (`provider`, `event_type`,
`llm.error.code`, `status`) uses fields this gateway actually emits. Honeycomb rejects a trigger naming an
unknown column, so 4 of 5 can never be created here regardless of traffic.

**Blocker 2 — bootstrap deadlock on a fresh Honeycomb account.**
Trigger creation validates against the live dataset schema, but the dataset only gains columns once the
log-processor ships events — and the tail consumer that produces them is gated on the *same*
`HONEYCOMB_CONFIG_KEY` (`infra/console.ts:310`). So the deploy that would create the data is the deploy that
fails. Confirmed: a real gateway request produced no dataset (`/1/datasets` returned `[]`).

**Plan when this is resumed — in order, no quick fixes:**
- [ ] Split the gate in `infra/console.ts` so the tail pipeline switches on independently of alerting, then
      deploy telemetry-only and let real gateway traffic populate the `zen` dataset. (Seeding synthetic events
      would work too, but it fixes column *types* from a guess — prefer real traffic.)
- [ ] Resolve the metric mismatch: either bump the vendored console to a revision that emits
      `isGoTier`/`isFreeTier`/`tps.output`, or trim `monitoring.ts` to the fields this gateway emits. Do NOT add
      the metrics to vendored source — that is a customization the vendored-console rule forbids.
- [ ] Re-add `HONEYCOMB_CONFIG_KEY`, deploy, verify the triggers create and a test alert reaches Discord.
- [ ] Only worth doing once the gateway has real users — these alerts watch model error rates and TPS, so on an
      empty dataset they would never fire anyway.

## Docs
- [ ] `PROVISIONING.md`: production runbook — the prod-secret list + deploy + verify steps.
- [ ] After this + `stripe-go-live` land, archive `commercial-cloud-backend` (only optional/post-launch items remain).
