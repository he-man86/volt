Bring opencode's commercial backend up on Volt's own cloud. Vendoring is pinned to opencode **`v1.17.20`**
(git-recoverable priors: `db73e8d459`). Stages 0/2/3/4 remain; Stage 1 (vendor + green) is done.

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
- [ ] **Set ALL linked SST secrets** — `sst deploy` errors on the first *unset* one (the Console worker links 48,
      incl. `ZEN_MODELS1..30`). **Tooling ready:** `bun volt-scripts/deploy-secrets.ts` expands `.env` → a complete
      `.env.deploy` (real where present, `""` stubbed), then `bunx sst secret load .env.deploy --stage <stage>` (or
      the script's `--apply <stage>`). Verified: generates all 48 (7 filled today; Upstash/ZEN_MODELS/SES get real
      values later at Stage 4b/invites).

### Then deploy — from CI (Windows can't build the web app) or WSL/Linux
- [x] **SST secrets set (dev) — done + Windows-verified.** `sst secret load` ran on Windows (exit 0, no build, not
      blocked), set all **48 secrets** for the `dev` stage, and bootstrapped the SST state. Confirmed:
      `sst secret list --stage dev` = 48.
- [ ] **Deploy via `.github/workflows/deploy.yml`** (workflow_dispatch → pick stage). Mirrors opencode's proven
      deploy.yml — ubuntu, `bunx sst deploy`, provider-auth env from GitHub environment secrets
      (`CLOUDFLARE_API_TOKEN`, `PLANETSCALE_SERVICE_TOKEN`(+`_ID`), `STRIPE_SECRET_KEY`, `HONEYCOMB_API_KEY`). No
      AWS/Sentry. **Prereqs:** domain Active + secrets set + create `dev`/`production` GitHub environments with
      those secrets. (Or run `bun run deploy:dev` from WSL/Linux — same thing, not Windows.)
- [ ] `bun run db:dev migrate` — schema already on `main` (24 tables) and the dev branch inherits it, so this is a
      no-op confirm for the first dev deploy; run it after future schema changes.
- [ ] Verify: sign up (GitHub/Google OAuth — **no email needed for login**) writes account/user/workspace rows.
- Note: the workflow's *structure* is proven (mirrors opencode + verified adaptations). The **first real deploy**
  is the end-to-end proof — it needs the domain + secrets + first-run SST bootstrap, which can't be dry-run.

## Open process items (found in review — not deploy-blockers but required)
- [ ] **Merge `commercial-cloud-backend` → `dev`** (43 commits). Required twice over: `deploy.yml` is only
      dispatchable from the **default branch** (`dev`), and none of this ships until merged. Big diff — review
      first (the volt product surface is untouched; the change is additive `packages/console/*` + `infra/*` +
      config). The volt `--filter='*'` gate + console tests are green, so CI should pass.
- [ ] **Production GitHub environment + secrets** — only `dev` is set. Create the `production` environment with
      **production** values (live Stripe key, etc.) when going live — do NOT reuse dev/test values.
- [ ] **`adapt-commercial-backend`** — the Stage 5 rebrand + billing-product swap is referenced as its own change
      but not yet created. Spin it up when the first deploy is proven (rebrand `console/app`, swap Zen→Volt product,
      align model IDs, prune the marketing integrations). Not part of this change.
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

## Stage 4 — billing loop (prove a subscription end-to-end)
- [ ] `console/app` is the as-is feature-test frontend (opencode-branded — fine for now; rebrand at Stage 5).
- [ ] Since we use the **`black`** product (Go/`lite` dropped), drive the checkout via the **black plan** path
      (`BlackData.planToPriceID`, not `Billing.generateLiteCheckoutUrl`). Make sure `ZenBlack`'s 3 prices exist
      (they're created by `infra/console.ts` on deploy).
- [ ] Sign up → pick a plan → Stripe Checkout (**test mode**) → webhook (`/stripe/webhook`) writes a subscription
      row. Verify the loop end-to-end on `dev`. **This is "billing works."** Gateway serving = Stage 4b.

## Pricing model (decided — configure at Stage 4b)
**One product, three flat tiers, same models on all, differentiated by a monthly spend allowance.** Use opencode's
`black` structure only (drop `lite`/Go) — every tier shares one clean limit mechanic: `fixedLimit` (the $ allowance)
+ `rollingLimit`/`rollingWindow` (burst guard). The gateway meters each request in real model cost
(`costInfo.totalCostInCent`), so allowances are in **dollars of model usage** → margin-safe and model-agnostic.
- **3 tiers**, e.g. **$24 / $59 / $99** (start with 2 rungs if simpler; switch the 3rd on later — no rework).
- All tiers can use **DeepSeek + Claude**. No model gating — cost-metering does the upselling: Claude costs ~10×
  DeepSeek/token, so Claude-heavy users burn their allowance faster and climb the ladder; DeepSeek users stay low.
- **Keep the DB enum keys `"20"/"100"/"200"` as internal plan IDs** (`BlackPlans`, `mysqlEnum("subscription_plan")`
  — renaming is a schema change, not worth it). Remap each key's **Stripe price** + **`fixedLimit`** to your
  numbers. Customer-facing names ("Starter/Pro/Max") come from Stripe, not the enum.
- **Drop `lite`/Go**: the `zen/go/v1/*` routes + Go pricing UI become vestigial (cleanup at Stage 5, not a blocker).
  The **free trial tier** (`free` limits) stays regardless.
- **Overage at the cap** — decide: hard stop ("upgrade to continue", stronger upsell) vs. metered pay-as-you-go on
  top (opencode's "Zen" model — more revenue, weaker upgrade pressure).
- Config touch-points: `infra/console.ts` (3 Stripe prices under `ZenBlack`), `ZEN_LIMITS` (the `black.{20,100,200}`
  `fixedLimit`/rolling values), `Subscription.LimitsSchema`.

## Stage 4b — LLM gateway (IN scope — Volt sells subscriptions too)
The Zen gateway (`console/app/routes/zen/*`) is kept and functional. **Launch model set: DeepSeek (budget/margin)
+ Claude (premium quality)** — start lean, not opencode's 20-model catalog. To make it serve/resell:
- [ ] **Upstash Redis** account → `UpstashRedisRestUrl` / `UpstashRedisRestToken` (rate-limit + budget state).
- [ ] **Provider keys** → `ZEN_MODELS*` secrets: your **Anthropic** key + your **DeepSeek** key (the pool the
      gateway rotates). Set `ZEN_LIMITS`.
- [ ] **Model catalog** (DB `model` table, edited via `update-models` against the live DB — post-migration): add
      **2 entries** — Claude (`format: "anthropic"`, cost = Claude pricing) and DeepSeek (`format: "oa-compat"`,
      DeepSeek endpoint, cost = DeepSeek pricing). Schema: `console/core/src/model.ts` `ZenData.ModelSchema`.
- [ ] (Recommended) **Validate model quality on PLC tasks** before launch — run real ST/FBD tasks through DeepSeek
      vs Claude via the corpus/conformance harness. (Both models are on every tier — this is to size the DeepSeek
      cost/quality story and set allowances, not to gate models per tier.)
- [ ] Verify end-to-end: subscribe → get API key → point a client at `zen/v1/{chat/completions,messages}` →
      request proxies upstream, metered + rate-limited.

## ⚠ Open gaps / decisions still needed (found in review — not yet in the plan)
- **THE LINCHPIN — agent ↔ gateway wiring — LARGELY BUILT** (commit adds it to `volt-config`):
      - [x] **`volt-config/opencode.json` `provider.volt` block** — `@ai-sdk/openai-compatible`, `baseURL:
            https://volt-ai.dev/zen/v1`, models `deepseek-chat` + `claude-sonnet-4-5`. Valid JSON.
      - [x] **`volt-config/plugins/volt-auth.ts` — the login** (opencode-native `AuthHook`): `opencode auth login`
            → Volt → paste the `sk-` key from the dashboard; loader feeds it to the provider. Typechecks against
            `@opencode-ai/plugin`. Credential stored by opencode's auth (no env var, survives config merges).
      - The paste-key method **is opencode's real flow** (confirmed via opencode.ai/docs/zen: "copy your API key"
        → "run `/connect` … paste your API key"). So this matches Zen 1:1 — not an MVP to replace.
      - [ ] **Align model IDs** with the gateway catalog at Stage 4b (`deepseek-chat`/`claude-sonnet-4-5` must
            match what `/v1/models` serves).
      - [ ] **Set opencode's default model** to the cheap tier (DeepSeek) so users don't accidentally burn Claude.
      - [ ] **Test end-to-end** once the backend is deployed + a subscription key exists (sign up → keys page →
            copy → `/connect` → Volt → paste → `/models`).
      - Optional later: a browser device-flow (`type: "oauth"`) would remove the copy-paste, but it's a nicety —
        opencode itself doesn't do it for Zen. Not a gap.
- [ ] **Unit economics — do the math.** Set each tier's `fixedLimit` allowance vs. real DeepSeek/Claude token
      costs vs. the $24/$59/$99 price so every tier is margin-positive at max usage. No numbers exist yet.
- [ ] **Free-trial terms** — define `free` limits (`promoTokens`, `dailyRequests`): what a non-subscriber gets.
- [ ] **Overage behavior** — decide hard-stop vs. metered pay-as-you-go at the cap (affects churn vs. revenue).
- [ ] **Stripe go-live** — we deploy with **test** keys; real charging needs Stripe account activation + live keys
      + the live webhook. Separate from the dev deploy.
- [ ] **Production apex domain** — `volt-ai.dev` apex still has Hostnet's A record; a prod deploy (vs `dev.`) will
      collide. Resolve when going past the `dev` stage.
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
   - [ ] Create a Honeycomb account → set `HONEYCOMB_API_KEY` (env, for the provider) + the secret (for the send).
         Then `sst install` pulls the honeycomb provider → `monitoring.ts` typechecks → `sst deploy` creates the
         error-rate SLOs + triggers (Increased Model/Provider HTTP Errors, Low TPS, Free-tier abuse).
   - [ ] Alerts route via `honeycomb/webhook` route → set `DISCORD_INCIDENT_WEBHOOK_URL` (Discord/Slack) for Volt.
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
