# Provisioning runbook — making `dev.volt-ai.dev` a usable product

The backend spine is **live** on `dev.volt-ai.dev` (deploy #8), but most SST secrets are `PLACEHOLDER_UNSET`,
so login / gateway / billing are inert. This is the exact list of external work to turn each on. Everything here
needs **you** (external accounts, keys, money) — the code + workflow wiring is already done.

## How "apply" works (the loop)
Every real secret is a **GitHub environment secret** in the `dev` environment, and `deploy.yml` already references
them (empty → `PLACEHOLDER_UNSET`, present → real). So the loop for any item is:

1. Add the secret: `gh secret set NAME --env dev --repo he-man86/volt` (paste value at prompt), or the GitHub UI
   (Settings → Environments → dev → Add secret).
2. Re-run the deploy: `gh workflow run deploy.yml --ref dev -f stage=dev` (or the Actions tab).

Secrets set from a laptop with `sst secret` do **not** reach CI (state is per-runner) — always go through GitHub
secrets + a redeploy. `set-models.ts` handles the gateway catalog the same way (via `ZEN_MODELS_JSON`).

---

## Tier 0 — SECURITY (do first)
- [x] **Deleted the exposed `cfat_` token** (2026-07-15). The working `cfut_` deploy token verified still active.

## Tier 1 — Login ✅ LIVE (deploy #11, 2026-07-15)
Callbacks (verified live): `https://auth.dev.volt-ai.dev/{github,google}/callback`.
- [x] **GitHub OAuth** — app created; creds stored as GitHub secrets **`GH_CLIENT_ID_CONSOLE` / `GH_CLIENT_SECRET_CONSOLE`**
      (the `GITHUB_` name prefix is reserved by Actions), mapped to `GITHUB_CLIENT_*_CONSOLE` in `deploy.yml`.
      `/github/authorize` → 302 to GitHub with real `client_id` + correct callback + scopes `read:user`,`user:email`.
      ⚠️ **The client SECRET was 20 chars** (GitHub secrets are usually 40) — if a real login bounces at the callback
      (token exchange), re-copy the full secret and reset `GH_CLIENT_SECRET_CONSOLE`.
- [x] **Google OAuth** — `GOOGLE_CLIENT_ID` set (OIDC, no secret needed); callback registered in Google Cloud.
      `/google/authorize` → 302. Functionally live.
- [x] **`ZEN_SESSION_SECRET`** set (real) — signs the console session; was the root of the earlier `503`s.

## Tier 2 — Gateway ✅ SERVING (deploy #18, 2026-07-15)
`/zen/v1/models` → 200 listing `deepseek-chat` + `claude-sonnet-4-5`; `/zen/v1/chat/completions` returns a clean
`401 AuthError` for a bad key (rate-limiter + auth + catalog all working). A real subscription key would complete.
- [x] **Provider keys** — DeepSeek + Anthropic keys live in `.env` (`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`) and as
      GitHub secrets. `models.json` (committed) references them as `${VAR}`; `set-models.ts` substitutes + chunks.
- [x] **Upstash Redis** — `UpstashRedisRestUrl` + `UpstashRedisRestToken` set (verified `PONG`).
- [x] **Gateway wiring** — the deploy's `Provision gateway model catalog` step always runs (NOT gated on a secret
      — GitHub masks secrets in `if:`, which silently skipped it and left placeholder `ZEN_MODELS` → the JSON.parse
      500). Fixed: no gate, keys passed to the step, catalog padded so all 30 chunks are non-empty.
- [ ] **`ZEN_LIMITS`** — still a zeroed default (valid JSON, no real allowances). Set real per-tier limits when
      pricing is finalized (schema in `console-core/subscription.ts`):
      ```json
      { "free":  { "promoTokens": <int>, "dailyRequests": <int>, "dailyRequestsFallback": <int>, "checkHeaders": {} },
        "lite":  { "rollingLimit": <cents>, "rollingWindow": <hours>, "weeklyLimit": <cents>, "monthlyLimit": <cents> },
        "black": { "20":  { "fixedLimit": <cents>, "rollingLimit": <cents>, "rollingWindow": <hours> },
                   "100": { "fixedLimit": <cents>, "rollingLimit": <cents>, "rollingWindow": <hours> },
                   "200": { "fixedLimit": <cents>, "rollingLimit": <cents>, "rollingWindow": <hours> } } }
      ```
- [ ] **`ZEN_LIMITS`** — per-tier limits JSON (schema in `console-core/subscription.ts`):
      ```json
      { "free":  { "promoTokens": <int>, "dailyRequests": <int>, "dailyRequestsFallback": <int>, "checkHeaders": {} },
        "lite":  { "rollingLimit": <cents>, "rollingWindow": <hours>, "weeklyLimit": <cents>, "monthlyLimit": <cents> },
        "black": { "20":  { "fixedLimit": <cents>, "rollingLimit": <cents>, "rollingWindow": <hours> },
                   "100": { "fixedLimit": <cents>, "rollingLimit": <cents>, "rollingWindow": <hours> },
                   "200": { "fixedLimit": <cents>, "rollingLimit": <cents>, "rollingWindow": <hours> } } }
      ```
      (This is opencode's free/lite/black shape; adapt to Volt's 3-tier spend-allowance pricing in the adapt phase.)
- [ ] Redeploy → `dev.volt-ai.dev/zen/v1/models` should stop 500'ing and list `deepseek-chat` + `claude-sonnet-4-5`.
- [ ] Test end-to-end: `opencode auth login` → Volt → paste a key minted by the backend → the agent's
      `volt/deepseek-chat` routes through the gateway.

## Tier 3 — Billing (checkout works)
- [ ] Add `STRIPE_SECRET_KEY` is already wired; add `STRIPE_PUBLISHABLE_KEY` (`pk_...`, Stripe dashboard) as a secret.
- [ ] Verify the Stripe products/prices the deploy created match the pricing model (rename Zen/Go/Black → Volt).
- [ ] Confirm the webhook: `dev.volt-ai.dev/stripe/webhook` wired to the Stripe account.

## Tier 4 — Monitoring (needs Workers Paid)
- [ ] **Upgrade to Workers Paid** ($5/mo) — required for Tail Workers (the log pipeline) and realistic gateway
      volume (Free is 100k req/day). Cloudflare → Workers → Plans.
- [ ] Add `DISCORD_INCIDENT_WEBHOOK_URL` (a Discord channel webhook) as a secret.
- [ ] Re-enable monitoring: add `HONEYCOMB_API_KEY` back to the `sst deploy` step env in `deploy.yml` (it's already
      a GitHub secret + real). This ungates `infra/monitoring.ts` and the console tail consumer.

## Production go-live (later)
- [ ] Create the `production` GitHub environment with **production** values (live Stripe key, prod OAuth callbacks
      at `auth.volt-ai.dev`, etc. — never reuse dev/test values).
- [ ] `gh workflow run deploy.yml -f stage=production` → deploys to the apex `volt-ai.dev`.
- [ ] (Optional) auto-deploy on push to `dev`/`production` like opencode — add `push:` triggers to `deploy.yml`.
- [ ] Spin up the `adapt-commercial-backend` change: rebrand `console/app`, swap Zen→Volt product, align pricing.
