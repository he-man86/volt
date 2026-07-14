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
- [ ] **BLOCKED — DNS propagation.** Nameservers still `ns01/ns02.hostnet.nl`; changed to CF's `bob/kira.ns.
      cloudflare.com` but Hostnet locked further edits for ~24h and it hasn't propagated. Zone status = `pending`.
      Re-check: `nslookup -type=ns volt-ai.dev 1.1.1.1` — when it shows `cloudflare.com`, the zone goes Active.

## ▶ RESUME HERE (once `volt-ai.dev` is Active on Cloudflare)

### Pre-deploy blockers — clear these FIRST or `sst deploy` crashes
- [ ] **PlanetScale token perms (HIGH RISK).** The current service token can't even list databases/branches
      (`not_found`) → it can't create the branch/password the deploy needs. Issue a new token with **create
      branch + create password** (DB-admin) scope on `mheijmans/volt`, update `.env`.
- [ ] **PlanetScale `production` branch.** The `dev` stage forks `parentBranch: "production"` (`infra/console.ts`).
      PlanetScale's default branch is usually `main` — create/rename a `production` branch on `volt`, or change
      `parentBranch` to the DB's actual default.
- [ ] **AWS provider.** `sst.config.ts` declares the `aws` provider but the infra creates **zero** AWS resources
      (email uses SES-over-HTTP with `AWS_SES_*` keys, not the provider). Pulumi may still try to init it and fail
      on a missing `volt-dev` profile → **remove the `aws` provider from `sst.config.ts`** (cleanest) unless/until
      SES is wired.
- [ ] **Set ALL linked SST secrets (even to dummy values).** `sst deploy` errors on the first *unset* linked
      secret, and the Console worker links ~20 (`Salesforce*`, `Discord*`, `AWS_SES_*`, `EmailOctopus`, `Upstash*`,
      `ZEN_MODELS1..30`, `ZEN_LIMITS`, `SUPPORT_API_KEY`, `HONEYCOMB_API_KEY`, `R2*`, …). Script it: set real values
      where we have them (Stripe, OAuth, session, DB), **stub the rest with `""`** so deploy runs. (SES/Upstash/
      ZEN_MODELS get real values later — SES at invites, Upstash+ZEN_MODELS at Stage 4b.)

### Then deploy
- [ ] `bunx sst deploy --stage dev` — auth issuer, Stripe products, console app on `dev.volt-ai.dev`.
- [ ] Migrate the schema into the (empty) DB via `sst shell` + `drizzle-kit` from `packages/console/core`.
- [ ] Verify: sign up (GitHub/Google OAuth — **no email needed for login**) writes account/user/workspace rows.

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
- [ ] **THE LINCHPIN — agent ↔ gateway wiring (design sketched).** The gateway is OpenAI-compatible
      (`zen/v1/chat/completions`), auths via `sk-…` bearer keys (`Key.create`). Wire it in 3 pieces:
      1. **`volt-config/opencode.json` provider block** — add `provider.volt` (`@ai-sdk/openai-compatible`,
         `baseURL: https://volt-ai.dev/zen/v1`, `apiKey: {env:VOLT_API_KEY}`, models = deepseek + claude, IDs
         matching the gateway's `/v1/models`). Set opencode's default model to the cheap tier (DeepSeek).
      2. **Key onto the user's machine** — MVP: subscribe on web → copy key → set `VOLT_API_KEY`. Polished:
         a `volt login` (CLI/desktop) OAuth → fetch/create `sk-` key → store (opencode auth store or env).
      3. Metering headers (`x-opencode-*`) are read-if-present, key-based limiting works regardless — nothing to build.
      - Decisions: key storage (env MVP → auth store), model IDs alignment, default model = DeepSeek.
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
