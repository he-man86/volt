Bring opencode's commercial backend up on Volt's own cloud. Vendoring is pinned to opencode **`v1.17.20`**
(git-recoverable priors: `db73e8d459`). Stages 0/2/3/4 remain; Stage 1 (vendor + green) is done.

## Stage 0 — accounts & providers
- [x] **Infra rewired for Volt** (done): `sst.config.ts` app `name`→`volt`, AWS profiles→`volt-*`, dropped the
      `honeycomb` provider + `lake`/`stats`/`monitoring`/`enterprise`/`app` imports; deleted `infra/{lake,stats,
      monitoring,enterprise}.ts`; gutted `infra/app.ts` (deployed only dropped packages) to just its one used
      secret; `stage.ts` domain/zone → Volt placeholders; `console.ts` PlanetScale name/org + Stripe product
      names → Volt. All values only Volt can fill are marked `TODO(volt)`.
- [ ] **Fill the `TODO(volt)` markers** (`grep -rn "TODO(volt)" infra/ sst.config.ts`): domain + Cloudflare zone
      ID (`stage.ts`), PlanetScale db name + org (`console.ts`), AWS profile names (`sst.config.ts`).
- [ ] **Create the accounts** — HUMAN-GATED, blocks deploy: Cloudflare (Workers + R2) + domain on it, AWS profile,
      PlanetScale org/DB, **Volt Stripe account** (test mode to start).

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

## Stage 5 — adapt to Volt's product (separate follow-up change)
- [ ] Replace `console/app` with a thin Volt frontend on `console-core` (the `volt-landing` shape) — full
      de-brand of opencode's marketing site happens here, not piecemeal.
- [ ] Swap opencode's Zen/lite billing product + Stripe price IDs for Volt's.
- [ ] (Future, optional) Build enterprise features — orgs/roles/seats/SSO — on `console-core` (it already models
      workspace/user/role/account). NOT by vendoring opencode's `enterprise` package (it's a session-sharing app,
      and opencode has no real SSO/SCIM code — see proposal).

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
