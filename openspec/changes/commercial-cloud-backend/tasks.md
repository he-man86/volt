Bring opencode's commercial backend up on Volt's own cloud. Vendoring is pinned to opencode **`v1.17.20`**
(git-recoverable priors: `db73e8d459`).

**STATUS (2026-07-15): LIVE + working end-to-end on `dev.volt-ai.dev`.** Stages 0–4b are DONE — deployed, Google
login → **€24 Go subscription** → metered gateway completion, all proven. The product is **Go only** (€24/mo, 50%
margin via 2× markup, top-up for overage; Black dropped). Auto-deploys on merge to `dev`. **What genuinely remains:**
(1) **Stripe go-live** (test→live keys) to take real money; (2) **production stage** (live secrets — env shell + apex domain now DONE);
(3) ~~Discord webhook~~ **DONE** (server + webhook + prod secret + tested; needs Workers Paid + prod deploy to fire);
(4) **email/SES** for invites (not login);
(5) **Stage 5 rebrand** (deferred, own change). Everything below is marked to reality.

## Stage 0 — accounts & providers — NEARLY DONE (blocked only on DNS propagation)
- [x] **Infra rewired for Volt**: `sst.config.ts` name→`volt`, AWS profiles→`volt-*`, dropped `honeycomb` provider
      + `lake`/`stats`/`monitoring`/`enterprise`/`app` imports; deleted `infra/{lake,stats,monitoring,enterprise}.ts`;
      gutted `infra/app.ts` to its one used secret; `stage.ts` + `console.ts` → Volt values.
- [x] **TODO(volt) values filled**: domain `volt-ai.dev`, CF zone `ebac4f049c913d03ae11f89114379d6c` (`stage.ts`);
      PlanetScale `volt`/`mheijmans` (`console.ts`). AWS profiles left as `volt-*` (set if/when AWS SES is used).
- [x] **Accounts exist + creds in `.env`** (gitignored): Cloudflare (token verified for R2/Workers/KV/DNS +
      account/zone IDs), PlanetScale (DB `volt` reachable, `SELECT 1` ok, **0 tables — schema not migrated yet**),
      Stripe keys, GitHub+Google OAuth, generated `ZEN_SESSION_SECRET`. `.env.example` documents the required vars.
- [x] **`sst install` passed** + infra typechecks clean vs real SST/provider types (fixed a latent opencode bug:
      Stripe `appliesToProducts`→`appliesTos`).
- [x] **DNS propagated — domain LIVE.** Nameservers are Cloudflare's (`bob`/`kira.ns.cloudflare.com`), zone
      status = **`active`** (verified via CF API). The hard blocker is cleared.

## ▶ RESUME HERE (once `volt-ai.dev` is Active on Cloudflare)

### ⚠ Only the `console/app` WEB APP needs Unix — everything else is Windows-native
Scope this precisely (tested on Windows):
- ✅ **Windows works** for: the Volt product (`bun run dev` — opencode 1.17.18 + volt-config load, `tools.volt:
  true`), the **agent↔gateway login** (`provider.volt` + `volt-auth.ts` — `opencode models` shows `volt/deepseek-chat`
  + `volt/claude-sonnet-4-5`, auth plugin loads clean), the console **unit tests**, typecheck, and DB work.
- ❌ **Needs Unix (WSL/Linux/CI):** only `console/app`'s SolidStart web build/dev. The pinned `@solidjs/start`
  `pkg.pr.new` preview **mangles Windows paths** — `vite dev` AND `vite build` fail (`Rollup … "C:Usersmarce…"`,
  backslashes eaten). Since `sst deploy` runs `vite build` locally, the **deploy** must run on WSL/Linux/**CI**
  (opencode's approach). Local `dev:console` also needs WSL. That's the whole Unix requirement — nothing else.

### Pre-deploy blockers — clear these FIRST or `sst deploy` crashes
- [x] **PlanetScale token — done + verified.** New service token in `.env` can list databases and it
      **created + deleted a throwaway branch** (proved `create_branch`/`delete_branch`/`create_password` scope).
- [x] **PlanetScale branch — done.** `volt` uses PlanetScale's default `main` as its production branch (there was
      no `production` branch). `infra/console.ts` now targets `main` (prod stage uses `main`; other stages fork it).
- [x] **Schema migrated + migration path verified.** Ran the migrations against `main` — **24 tables created**
      (account/auth/user/workspace/billing/subscription/key/model/provider/usage/…). The `dev` branch forks from
      `main`, so it **inherits the schema**; `db:dev migrate` at deploy is then idempotent. **Use `drizzle-kit
      migrate` (applies the committed `migration.sql` files), NOT `drizzle-kit push`** — `push` on
      `drizzle-kit@1.0.0-rc.2` generates invalid PlanetScale SQL for the `ON UPDATE CURRENT_TIMESTAMP` columns
      (`DEFAULT (… ON UPDATE …)` — Vitess rejects it). `migrate` uses the correct committed SQL.
- [x] **AWS provider removed** — infra creates zero AWS resources (email is SES-over-HTTP, not the provider), so
      the unused `aws` provider is gone from `sst.config.ts` (no init-fail on a missing profile).
- [x] **All linked SST secrets set** — the 48 (incl. `ZEN_MODELS1..30`) are loaded per-stage via
      `deploy-secrets.ts` + `set-models.ts` in the deploy job. Real values now filled: Stripe, OAuth (Google +
      GitHub), `ZEN_SESSION_SECRET`, Upstash, DeepSeek + Anthropic (`ZEN_MODELS`), `ZEN_LIMITS`, Honeycomb. Still
      placeholder (feature inert): SES/email, Discord webhook, Salesforce.

### Then deploy — from CI (Windows can't build the web app) or WSL/Linux
- [x] **SST secrets set (dev) — done + Windows-verified.** `sst secret load` ran on Windows (exit 0, no build, not
      blocked), set all **48 secrets** for the `dev` stage, and bootstrapped the SST state. Confirmed:
      `sst secret list --stage dev` = 48.
- [x] **DEPLOYED — the spine is LIVE on `dev.volt-ai.dev`** (deploy #8, 2026-07-14). `https://dev.volt-ai.dev` → 200
      serving the console; workers `volt-dev-{authapi,consoleworker,logprocessor,stat}script` created; PlanetScale
      DB migrated. It took 8 runs, each failure root-caused (not guessed) — the load-bearing lessons:
    1. **Cloudflare token type** — a `cfat_` (account-owned) token verifies only at `/accounts/{id}/tokens/verify`
       and SST rejects it (`Authentication error 10000`). Must be a **`cfut_` user-owned** token (`/user/tokens/verify`).
    2. **RegionalHostname** — opencode pinned a US regional hostname (Data Localization Suite, paid add-on) → 403.
       Removed (`infra/stage.ts`); re-add only for EU/US residency.
    3. **Stripe provider** — `pulumi-stripe` is fetched from GitHub releases; unauthenticated CI hits the 60/hr
       rate limit. Pass `GITHUB_TOKEN: ${{ github.token }}` to the deploy step.
    4. **SST secrets are per-runner** — state is local + cloud-backed + passphrase-encrypted, so secrets set from a
       laptop are invisible to a fresh CI runner (CI saw 0/48). Fix: load them **in the deploy job** (deploy-secrets
       reads process.env → GitHub secrets → `PLACEHOLDER_UNSET`). This is THE key lesson for anyone re-running.
    5. **De-fork leftover** — `console/app` build ran `../../opencode/script/schema.ts` (deleted package). Dropped it.
    6. **Tail Workers need Workers Paid** — the console tail consumer (log pipeline) 403'd on Free. Gated on
       `HONEYCOMB_API_KEY` (monitoring flag), so Free deploys; returns with Workers Paid + monitoring.
    - Env from GitHub secrets: `CLOUDFLARE_API_TOKEN` (user-owned!), `PLANETSCALE_SERVICE_TOKEN`(+`_ID`),
      `STRIPE_SECRET_KEY`, `GITHUB_TOKEN`. No AWS/Sentry/Honeycomb (deferred).
- **Provisioning debt (deploy-as-is):** the stubbed (`PLACEHOLDER_UNSET`) secrets mean those features are INERT
  until real values are set (`sst secret set NAME <v> --stage dev`): OAuth login (`GITHUB_CLIENT_*_CONSOLE`,
  `GOOGLE_CLIENT_SECRET`), gateway rate-limit (`UpstashRedis*`, `ZEN_LIMITS`), gateway upstream keys (`ZEN_MODELS*`),
  email (`AWS_SES_*`, `EMAILOCTOPUS_API_KEY`), support portal, Salesforce, Discord alerts. Real today: Stripe,
  `ZEN_SESSION_SECRET`, `GOOGLE_CLIENT_ID`, Honeycomb. Deploy #1 proves the spine stands up; provisioning is next.
- [x] `bun run db:dev migrate` — schema on `main` (24 tables), dev inherits it; confirmed at deploy (idempotent).
      Re-run only after future schema changes.
- [x] Verify: sign up (Google OAuth — **no email needed for login**) writes account/user/workspace rows. Proven —
      the funnel is live end-to-end.
- Note: the workflow's *structure* is proven (mirrors opencode + verified adaptations). The **first real deploy**
  is the end-to-end proof — it needs the domain + secrets + first-run SST bootstrap, which can't be dry-run.

## Open process items (found in review — not deploy-blockers but required)
- [x] **Merged `commercial-cloud-backend` → `dev`.** The change shipped to `dev`; `dev` is now the protected trunk
      with auto-deploy on merge (see `.github/workflows/deploy.yml`).
- [~] **Production GitHub environment** — created as a **locked-down shell** (`gh api PUT …/environments/production`):
      required-reviewer approval (`he-man86`) on every live-money deploy + protected-branches-only (`dev`). Still
      **YOU:** set the `production` **secrets** with live/prod values (live Stripe key, prod OAuth, fresh session
      secret — never reuse dev/test). Full go-live runbook in PROVISIONING.md.
- [x] **Stage 5 rebrand spun up as its own change** — created as **`volt-branding`** (fulfills this deferred item:
      console reskin + volt-www landing + marketing-surface prune). Phase 1 done; Phase 2 built, pending the prod
      deploy. Not part of this change.
- [x] **`sst secret load` on Windows — verified working** (exit 0, 48 secrets set for dev). Not Windows-blocked.

## Stage 1 — vendor the console packages — DONE ✅ (green, committed)
- [x] Vendor all 6 console subpackages: `console/{core,resource,mail,function,app,support}` (byte-identical to
      opencode except the simplifications below). NOT `enterprise`/`function`/`web`/`app`(GUI) — see proposal.
- [x] Vendor `infra/*.ts` + `sst.config.ts` **verbatim as reference** (rewire at Stage 0).
- [x] Root wiring: `packages/console/*` in workspaces; catalog gains stripe/drizzle/planetscale/sst/solid deps.
- [x] Committed root **`sst-env.d.ts`** + `sst@4.13.1` → `Resource` types resolve → whole spine green in the
      normal `--filter='*'` gate. (The "drizzle rc.2" gate was a false alarm — corrupted bun cache.)
- [x] **Dropped `@opencode-ai/ui`**: inlined `createSimpleContext` + `Favicon` into `console/app/src/ui.tsx`,
      deleted the package (1642 files) + 15 ui-only catalog entries. Zero new deps.
- [x] **Dropped opencode publish tooling**: `ui/script/publish.ts` + `packages/script`.
- [x] **Neutralized favicon branding** (Volt title, opencode favicon assets deleted). Rest of `console/app`
      marketing branding left for the frontend rework.
- [x] `bun run typecheck` green (volt + console), `bun run lint` 0 errors.

## Stages 2–3 — DB + deploy → see **▶ RESUME HERE** above (consolidated; these were duplicates).

## Stage 4 — billing loop — DONE ✅ (subscription proven end-to-end)
- [x] `console/app` is the as-is feature-test frontend (opencode-branded — fine for now; rebrand at Stage 5). The
      **Zen tab is retired** and the workspace home redirects to **Go** (see DIVERGENCE.md).
- [x] We use the **Go / `lite`** product (Black dropped) — checkout goes through `Billing.generateLiteCheckoutUrl`
      → `ZenLite` €24 price (created by `infra/console.ts` on deploy).
- [x] Sign up → Go checkout → Stripe (test mode) → webhook (`/stripe/webhook`) writes the subscription row.
      **Verified end-to-end on `dev`:** Google login → €24 Go subscription → the `lite` row synced correctly.

## Pricing model — DECIDED + IMPLEMENTED ✅ (the inverse of the earlier Black plan below)
**One product: Go — €24/month, flat.** We use opencode's **`lite`** path (NOT `black` — the 3-tier idea was
reversed). DeepSeek + Claude are both available, no model gating. Margin is guaranteed **structurally by a 2×
markup**: `models.json` prices every model at double the provider's real rate and the gateway meters each request in
that marked-up cost — so every request nets ~50% regardless of model mix, no per-tier math needed. Live + proven
end-to-end (Google login → €24 Go subscription → metered DeepSeek completion on `dev.volt-ai.dev`).
- [x] **Price €24/mo** — `infra/console.ts` `zenLitePrice` (`unitAmount: 2400`, `currency: "eur"`).
- [x] **50% margin via 2× markup** — `models.json`: DeepSeek `5.4e-7/2.2e-6`, Claude `6e-6/3e-5` (exactly double the
      real rates). Margin-safe and model-agnostic by construction — the "unit economics" question is answered.
- [x] **Allowance + free trial** — `ZEN_LIMITS` set with real values: `lite` = `monthlyLimit 24` + rolling guards
      (rollingLimit 12 / window 24 / weekly 8); `free` = 1M promo tokens, 50 daily requests. `liteModels` =
      deepseek-chat + claude-sonnet-4-5.
- [x] **Overage = top-up** (decided) — beyond the allowance, users top up a Zen balance (PAYG, kept on the Billing
      tab). No hard stop; metered-on-top.
- [x] **Black dropped** — the 3-tier Black product + `zen/black` routes stay dormant/pristine (unlinked, unbilled);
      the Zen tab is already retired from the dashboard. Full route cleanup is a Stage 5 nicety, not a blocker.
- Config touch-points (all set): `infra/console.ts` (`ZenLite` €24 price), `models.json` (`liteModels` + 2× cost),
  `ZEN_LIMITS` (`lite`/`free`), `volt-config/opencode.json` (agent → `/zen/go/v1`).

> _Superseded plan (kept for context): the original design was one product with **three Black tiers** ($24/$59/$99)
> differentiated by `fixedLimit`, dropping `lite`/Go. We reversed it — single Go/`lite` tier + top-up for overage —
> because one flat price + PAYG overage is simpler to sell and the 2× markup makes tiering unnecessary for margin._

## Stage 4b — LLM gateway — DONE ✅ (serving, metered, proven)
The Zen gateway (`console/app/routes/zen/*`) is live. **Launch model set: DeepSeek (budget/margin) + Claude (premium
quality)** — lean, not opencode's 20-model catalog.
- [x] **Upstash Redis** — `UpstashRedisRestUrl` / `UpstashRedisRestToken` set (rate-limit + budget state).
- [x] **Provider keys** → `ZEN_MODELS*`: Anthropic + DeepSeek keys loaded (via `set-models.ts` from `models.json`,
      chunked into `ZEN_MODELS1..30`). `ZEN_LIMITS` set.
- [x] **Model catalog** — `models.json` carries the 2 entries (deepseek-chat `oa-compat`, claude-sonnet-4-5
      `anthropic`) at 2× cost; `liteModels` exposes both on Go. Provisioned into the gateway on every deploy.
- [ ] (Recommended, not a blocker) **Validate model quality on PLC tasks** — run real ST/FBD tasks through DeepSeek
      vs Claude via the corpus/conformance harness, to size the DeepSeek cost/quality story.
- [x] **Verified end-to-end** — a real DeepSeek completion flowed through the Go/`lite` endpoint (`/zen/go/v1`)
      honoring the subscription, metered + rate-limited. The agent (`volt-config`) is wired to it and proven.

## ⚠ Open gaps / decisions still needed (found in review — not yet in the plan)
- **THE LINCHPIN — agent ↔ gateway wiring — LARGELY BUILT** (commit adds it to `volt-config`):
      - [x] **`volt-config/opencode.json` `provider.volt` block** — `@ai-sdk/openai-compatible`, `baseURL:
            https://volt-ai.dev/zen/v1`, models `deepseek-chat` + `claude-sonnet-4-5`. Valid JSON.
      - [x] **`volt-config/plugins/volt-auth.ts` — the login** (opencode-native `AuthHook`): `opencode auth login`
            → Volt → paste the `sk-` key from the dashboard; loader feeds it to the provider. Typechecks against
            `@opencode-ai/plugin`. Credential stored by opencode's auth (no env var, survives config merges).
      - The paste-key method **is opencode's real flow** (confirmed via opencode.ai/docs/zen: "copy your API key"
        → "run `/connect` … paste your API key"). So this matches Zen 1:1 — not an MVP to replace.
      - [x] **Model IDs aligned** — `deepseek-chat`/`claude-sonnet-4-5` match what the Go endpoint serves (`liteModels`).
      - [ ] **Set opencode's default model** to the cheap tier (DeepSeek) so users don't accidentally burn Claude.
            (Small config nicety in `volt-config`; not blocking.)
      - [x] **Tested end-to-end** — sign up → subscribe → key → agent completion proven on `dev`.
      - Optional later: a browser device-flow (`type: "oauth"`) would remove the copy-paste, but it's a nicety —
        opencode itself doesn't do it for Zen. Not a gap.
- [x] **Unit economics — solved structurally.** The 2× markup makes every request ~50% margin regardless of model
      mix, so no per-tier allowance math is needed. `lite` `monthlyLimit` = $24 of (marked-up) usage.
- [x] **Free-trial terms — set.** `ZEN_LIMITS.free` = 1M promo tokens, 50 daily requests (10 fallback).
- [x] **Overage behavior — decided.** Metered top-up (Zen balance, PAYG) on the Billing tab; no hard stop.
- [ ] **Stripe go-live** — we deploy with **test** keys; real charging needs Stripe account activation + live keys
      + the live webhook. Separate from the dev deploy. **(The one true remaining gate to take real money.)**
      _Infra is ready: the code is fully key/stage-driven (webhook URL, products, provider key all follow the stage),
      no test-mode hardcoding, and the `production` env exists. Blocked only on Stripe account activation → live keys._
- [x] **Production apex domain freed** — deleted the 4 Hostnet records (apex A/AAAA, `www` CNAME, `*` wildcard) from
      the Cloudflare zone; kept SPF + DMARC (no MX existed). Apex is now free for SST to bind at the prod deploy;
      `dev.volt-ai.dev` unaffected (still 200). See PROVISIONING.md.
- [ ] **Email (SES)** — only needed for workspace invites + the enterprise-contact page, not login. Stub `AWS_SES_*`
      now; wire real SES keys if/when invites matter.

## Stage 4c — observability & success-rate monitoring (required, not day-1)
Goal: **see the success rate of the app** — gateway completion rate, API health, errors — plus alerting.
Three layers; #1 is the core "success rate" ask.

1. **Success-rate, errors & alerts — Honeycomb** — **`infra/monitoring.ts` + the `honeycomb` provider are re-added**
   (both gated on `HONEYCOMB_API_KEY` so a pre-Honeycomb deploy still works). Telemetry *send* is already coded
   (`function/src/log-processor.ts` → `api.honeycomb.io/1/batch/zen`); the event carries error signals too
   (`status`, `llm.error`, `error_type`, `error.response`), so **error visibility comes from Honeycomb — no
   separate error tracker needed**. To activate:
   - [x] Honeycomb account + `HONEYCOMB_API_KEY` set (`.env` + `dev` GitHub secret). **Note:** the deploy job still
         omits it *on purpose* — enabling it activates `monitoring.ts`, which needs a real `DISCORD_INCIDENT_WEBHOOK_URL`
         (still empty). Wire both together: add `HONEYCOMB_API_KEY` to the deploy env once Discord is provisioned.
   - [x] Alerts route via `honeycomb/webhook` route → Discord — **wired + tested.** Blanked opencode's hardcoded
         Discord role ID in `webhook.ts` (mention now opt-in via `DISCORD_ALERT_ROLE_ID`); `deploy.yml` passes
         `DISCORD_INCIDENT_WEBHOOK_URL` + activates `HONEYCOMB_API_KEY` **production-only** (dev stays Workers-Free —
         the tail pipeline needs Workers Paid). Discord server + webhook created; a live test message posted (HTTP
         204); `DISCORD_INCIDENT_WEBHOOK_URL` set in the **production** GitHub env. **Remaining to actually fire:**
         be on Workers Paid + the production deploy (alerts self-disable off-production).
   - Note: `monitoring.ts` alerts self-disable off-production (`alertsDisabled = stage !== "production"`).
2. **AI usage statistics** — **per-user usage is ALREADY built + vendored, not a gap.** The gateway meters every
   request into `UsageTable` (`input_tokens`/`output_tokens`/`cache_read_tokens`/`reasoning_tokens`/`cost`/model)
   and `BillingTable` (`monthly_usage`/`rolling_usage`), and `console/app`'s `workspace/[id]/billing/*` sections
   **display each subscriber their usage + limit** out of the box. That data path is in `console-core`, intact —
   dropping the lake did not remove it.
   - Only the **operator/aggregate rollup** (all users: total tokens, model mix, top consumers, success rate) is a
     choice. Out-of-the-box options, cheapest first: **SQL on the PlanetScale DB you already run** (`UsageTable`
     has it — a small admin view; MVP winner) · **Honeycomb** (the `inference.event` stream = live usage stats) ·
     **Tinybird** (managed dashboards, feed from `log-processor`). **Do NOT re-add** opencode's `infra/lake.ts`
     (AWS S3-Tables+Glue+Athena+Firehose) or `packages/stats` (2nd SolidStart app needing the removed `ui`) —
     a real project, not a flip-on package.
3. **Infra health — Cloudflare-native** — Workers logpush + Workers Analytics for worker/DB uptime + exception
   logs (free). Covers app-level errors alongside Honeycomb.

**Sentry: dropped.** opencode never used it (0 code references — the `SENTRY_*` .env keys are stale from an earlier
attempt). Honeycomb + Cloudflare Workers logs give error visibility without a new integration; add a dedicated
error tracker only if grouped stack traces / release health become worth the build.

**What "success rate" concretely means here** (all derivable once #1 is live):
- Gateway: successful completions ÷ total (from `inference.event` `status` + `llm.error`) — the headline metric.
- API/auth: 5xx rate on the console app + auth worker.
- Business funnel: signup → subscribe → active (DB + Stripe), for conversion health.

## Stage 5 — adapt branding/product (separate follow-up change)
- [ ] Replace `console/app`'s marketing/branding with Volt's (keep the functional app + gateway).
- [ ] Rename the Stripe products/pricing to Volt's real plans (the Zen/Go/Black structure stays — it's the sub
      product Volt is selling).
- [ ] (Future, optional) enterprise features — orgs/roles/seats/SSO — built on `console-core`. NOT by vendoring
      opencode's `enterprise` package (session-sharing app; opencode has no real SSO/SCIM code — see proposal).

## Reference: external providers the backend relies on
**Required:** Cloudflare (host/R2/KV/Workers), PlanetScale (DB), Stripe (billing), Anthropic + DeepSeek (LLM
upstreams), Upstash Redis (gateway limits), GitHub + Google OAuth (login).
**Optional/observability:** Honeycomb (metrics + errors + success-rate alerts), AWS SES (email — invites only, NOT
login), a lightweight analytics sink (Tinybird/ClickHouse/Postgres). *Sentry dropped* (opencode never used it).
**Prune (opencode-specific):** Discord (community + support bot), Feishu, EmailOctopus (newsletter), Salesforce (CRM).

### Analytics / "chat analysis" (gap)
- The gateway emits rich per-request **usage telemetry** (`inference.event`: model/tier/provider/tokens/cost/
  latency/status/errors/geo/session) — but **metadata only, no prompt/completion content** (content analysis
  would be a new build + a privacy decision).
- **Destination dropped:** telemetry flows via `function/src/log-processor.ts` → Honeycomb + a data **Lake**, but
  we deleted `infra/lake.ts` + `packages/stats`. So `log-processor` references a non-existent `Resource.LakeIngest`
  (skips it, Honeycomb-only) and the `stats`/`data`/`bench` dashboard routes in `console/app` are vestigial.
- **Decision (post-launch):** to get usage dashboards (per-user spend, model mix, margin), re-add a sink — Honeycomb
  for observability, or a simple ClickHouse/Tinybird/Postgres warehouse for product analytics. Not needed to launch.

## Reference: initial spine dependency manifest (from opencode `v1.17.20`)
Kept for the record — versions the vendored `console/{core,resource,mail,function}` pin (resolved against
opencode's catalog). `console/app` + `console/support` add solid/kobalte/stripe-js deps; `ui`-only catalog
entries were pruned when `ui` was dropped.
- **`console-core`**: `stripe@18.0.0`, `@planetscale/database@1.19.0`, `postgres@3.4.7`, `aws4fetch@1.0.20`,
  `@aws-sdk/client-sts@3.782.0`, `@jsx-email/render@1.1.1`, `drizzle-orm@1.0.0-rc.2`, `ulid@3.0.1`, `zod@4.1.8`;
  dev: `drizzle-kit@1.0.0-rc.2`, `@cloudflare/workers-types@4.20251008.0`, `mysql2@3.14.4`.
- **`console-function`**: `@openauthjs/openauth@0.0.0-20250322224806`, `ai@6.0.168`, `@ai-sdk/{anthropic,openai,openai-compatible}`.
- **Pinned RC/snapshot** (`drizzle@1.0.0-rc.2`, `openauth@0.0.0-2025…`): don't bump independently of the tag —
  the schema/migrations must match.
