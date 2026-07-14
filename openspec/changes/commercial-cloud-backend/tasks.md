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
- [ ] `bunx sst deploy --stage dev` — provisions DB branch/password, auth issuer, Stripe products, console app on
      `dev.volt-ai.dev`. First real cloud deploy (creates resources).
- [ ] Migrate the schema into the (empty) DB — opencode's way: `sst shell` + `drizzle-kit` from `packages/console/core`.
- [ ] Verify sign-up writes account/user/workspace rows.
- Watch-outs surfaced during setup: PlanetScale service token could list the org but not databases — confirm it
  can create branch/password at deploy (the `planetscale.Branch`/`Password` step) or the deploy will fail there.
  The `dev` branch forks `parentBranch: "production"` — ensure a `production` branch exists on the `volt` DB.

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

## Stage 2 — DB up (needs Stage 0)
- [ ] Provision the PlanetScale branch via the rewired `infra/console.ts`; set DB secrets.
- [ ] `drizzle-kit` migrate the schema (`console/core/migrations`). Confirm tables exist.

## Stage 3 — auth + secrets deploy (needs Stage 0)
- [ ] Set the SST secrets (`sst secret set`): Stripe key, `ZEN_SESSION_SECRET`, R2 keys, PlanetScale creds,
      Honeycomb, support/email keys. Stub the ones the subset doesn't use.
- [ ] `sst install` (generates `.sst/platform` + regenerates `sst-env.d.ts` from Volt's resources).
- [ ] `sst deploy` to a `dev` stage. OpenAuth issuer + `console/app` (+ optionally `console/support`) come up on
      Volt's domain. Verify: sign up → account/user/workspace rows land in the Volt DB.

## Stage 4 — frontend + billing loop
- [ ] `console/app` is the as-is feature-test frontend. Stub the extra integrations it links that the subset
      doesn't need (Salesforce, SES, Discord, Upstash) so it boots.
- [ ] Create a placeholder Stripe product/price in the Volt Stripe account so `Billing.generateLiteCheckoutUrl`
      resolves; drive signup → Stripe Checkout → webhook → subscription row in DB.
- [ ] Verify the loop end-to-end on the `dev` stage. **This is "deployed and working."**

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
      vs Claude via the corpus/conformance harness; price/tier accordingly (budget=DeepSeek, pro=Claude).
- [ ] Verify end-to-end: subscribe → get API key → point a client at `zen/v1/{chat/completions,messages}` →
      request proxies upstream, metered + rate-limited.

## Stage 5 — adapt branding/product (separate follow-up change)
- [ ] Replace `console/app`'s marketing/branding with Volt's (keep the functional app + gateway).
- [ ] Rename the Stripe products/pricing to Volt's real plans (the Zen/Go/Black structure stays — it's the sub
      product Volt is selling).
- [ ] (Future, optional) enterprise features — orgs/roles/seats/SSO — built on `console-core`. NOT by vendoring
      opencode's `enterprise` package (session-sharing app; opencode has no real SSO/SCIM code — see proposal).

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
