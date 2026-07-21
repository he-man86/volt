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
- [x] **`ZEN_LIMITS` set** (deploy #20) — spend allowances derived from provider cost + **50% gross margin**:
      black `fixedLimit` = $12/$29/$49 (whole $/mo) for the $24/$59/$99 tiers; `rollingLimit` ~half over 24h as an
      anti-burst cap; free = 1M-token trial + 50 req/day. Units verified: `centsToMicroCents(limit*100)` ⇒ whole $.
      Revisit if the input:output ratio (assumed ~4:1) or margin changes. Schema in `console-core/subscription.ts`:
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

## Production go-live runbook (Stripe live + apex)

**Code/infra is already prod-ready — nothing to write.** Everything is stage/key-driven: `stage.ts` `domain` →
`volt-ai.dev` for `production`; the Stripe provider reads `STRIPE_SECRET_KEY` from env; the webhook URL is
`https://${domain}/stripe/webhook` (→ apex in prod); Pulumi creates the products/prices/coupons/webhook in whatever
Stripe account the key points at. `deploy.yml` already exposes `production` as a `workflow_dispatch` choice and
resolves the `production` GitHub environment. No hardcoded test-mode anywhere in `console/*`.

- [x] **`production` GitHub environment created** (locked-down shell, no secrets yet): required-reviewer approval
      = `he-man86` (a human must approve every live-money deploy) + deployments restricted to protected branches
      (`dev`). Created via `gh api -X PUT repos/he-man86/volt/environments/production`.
- [ ] **YOU: activate the Stripe account** (business + bank + identity in the Stripe dashboard) and copy the **live**
      keys — `sk_live_…` / `pk_live_…`. Live charging is gated on activation; nothing below works until this is done.
- [ ] **YOU: set the `production` environment secrets** (live/prod values — NEVER reuse dev/test):
      `STRIPE_SECRET_KEY=sk_live_…`, `STRIPE_PUBLISHABLE_KEY=pk_live_…`, plus prod `CLOUDFLARE_API_TOKEN` (user-owned
      `cfut_`), `PLANETSCALE_SERVICE_TOKEN`(+`_ID`), a fresh `ZEN_SESSION_SECRET`, prod OAuth (`GOOGLE_CLIENT_*`,
      `GH_CLIENT_*_CONSOLE`), `Upstash*`, `ZEN_LIMITS`, `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`. e.g.
      `gh secret set STRIPE_SECRET_KEY --env production --repo he-man86/volt`.
- [x] **Apex DNS collision cleared** — deleted the 4 Hostnet records from the Cloudflare zone (`volt-ai.dev` A
      `91.184.0.200` + AAAA `2a02:2268:…`, `www.volt-ai.dev` CNAME, `*.volt-ai.dev` wildcard A). They only served a
      Hostnet parking page; no MX/inbound email existed, and the SPF + DMARC TXT records were kept. The apex is now
      free (returns 530 until the prod deploy binds it); `dev.volt-ai.dev` verified still 200. SST will create the
      apex / `www.` / `auth.volt-ai.dev` records at the prod deploy.
- [ ] **YOU: add prod OAuth redirect URIs** — `https://auth.volt-ai.dev/{github,google}/callback` to the Google +
      GitHub OAuth apps (login 401s otherwise).
- [ ] **Deploy:** `gh workflow run deploy.yml -f stage=production` → approve the environment gate → SST deploys the
      apex, creates the **live** Stripe products/prices + the live webhook (`volt-ai.dev/stripe/webhook`), whose
      signing secret flows into `STRIPE_WEBHOOK_SECRET` automatically.
- [ ] **Verify live:** a real card checkout → subscription row written; Stripe dashboard (live mode) shows the €24
      product + the webhook delivering 200s.
- [ ] (Optional) auto-deploy on push to `dev`/`production` like opencode — add `push:` triggers to `deploy.yml`.
- [ ] Spin up the `adapt-commercial-backend` change: rebrand `console/app`, swap Zen→Volt product, align pricing.
