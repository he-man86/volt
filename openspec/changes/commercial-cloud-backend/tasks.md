Bring opencode's commercial backend up on Volt's own cloud, **as-is first**, then adapt. All vendoring is
pinned to opencode **`v1.17.20`** (git-recoverable priors: `db73e8d459`). Do the stages in order — each is a
usable checkpoint.

## Stage 0 — accounts & providers (no code)
- [ ] Volt Cloudflare account (Workers + R2 enabled), AWS profile, PlanetScale org/DB, **Volt Stripe account**, domain.
- [ ] Record which provider settings in `sst.config.ts` change (app `name`, aws `profile`, planetscale org, domain).

## Stage 1 — vendor the spine (pinned v1.17.20) — DONE ✅ (green)
- [x] Vendor `packages/console/{core,resource,mail,function}` — each whole. NOT `enterprise`/`function`.
- [x] Vendor `infra/*.ts` + `sst.config.ts` **verbatim as reference** (opencode-hardcoded; rewire at Stage 0).
- [x] Keep `@opencode-ai/console-*` naming; add `packages/console/*` to workspaces + catalog (incl. `sst@4.13.1`).
- [x] Vendor opencode's committed root **`sst-env.d.ts`** + `sst` package → `Resource` types resolve.
- [x] **Verified byte-identical to opencode** (`diff -rq`, 0 drift) AND **typechecks green** (0 errors, whole
      spine, in the normal `--filter='*'` gate). The "drizzle rc.2" gate was a false alarm (corrupted bun cache).
- [x] Full gate green: 6 volt packages + console-core + console-function (resource/mail have no typecheck script,
      same as opencode). `bun install` resolves everything.
- Runtime (not typecheck) still needs real cloud provisioning — that's Stage 0/3 below.

## Stage 2 — DB up
- [ ] Provision the PlanetScale branch via `infra/console.ts`; set DB secrets.
- [ ] `drizzle-kit` migrate the trimmed schema (`account/auth/user/workspace/billing`). Confirm tables exist.

## Stage 3 — auth + secrets deploy
- [ ] Set the ~15 SST secrets (`sst secret set`): Stripe key, `ZEN_SESSION_SECRET`, R2 keys, PlanetScale creds,
      Honeycomb, support/email keys. Stub the ones the subset doesn't use.
- [ ] `sst deploy` to a `dev` stage. OpenAuth issuer + console/enterprise apps come up on Volt's domain.
- [ ] Verify: sign up → account/user/workspace rows land in the Volt DB.

## Stage 4 — frontend + billing loop (as-is)
- [ ] Deploy `console/app` **as-is** (root domain) as the reference checkpoint. Stub the extra integrations it
      links that the subset doesn't need (Salesforce, SES, Discord, Upstash) so it boots.
- [ ] Create a placeholder Stripe product/price in the Volt Stripe account so `Billing.generateLiteCheckoutUrl`
      resolves; drive signup → Stripe Checkout → webhook → subscription row in DB.
- [ ] Verify the full loop end-to-end on the `dev` stage. **This is "deployed as-is and working."**

## Dependency manifest (turn-key — from opencode `v1.17.20`)

Vendor each package's `package.json` as-is; resolve every `catalog:` entry to these pinned versions (copy the
matching entries into Volt's root `workspaces.catalog`). Verified against opencode's root catalog + package.jsons.

- **`console-core`**: `stripe@18.0.0`, `@planetscale/database@1.19.0`, `postgres@3.4.7`, `aws4fetch@1.0.20`,
  `@aws-sdk/client-sts@3.782.0`, `@jsx-email/render@1.1.1`, `drizzle-orm@1.0.0-rc.2`, `ulid@3.0.1`, `zod@4.1.8`;
  dev: `drizzle-kit@1.0.0-rc.2`, `@cloudflare/workers-types@4.20251008.0`, `mysql2@3.14.4`.
- **`console-resource`**: `@cloudflare/workers-types@4.20251008.0`.
- **`console-mail`**: `@jsx-email/all@2.2.3`, `@jsx-email/cli@1.4.3`, `react@18.2.0`, `@types/react@18.0.25`, `solid-js` (catalog).
- **`console-function`**: `@openauthjs/openauth@0.0.0-20250322224806`, `ai@6.0.168`, `@ai-sdk/{anthropic@3.0.82,openai@3.0.48,openai-compatible@2.0.37}`, `zod@4.1.8`.
- **Note:** `drizzle@1.0.0-rc.2` and `openauth@0.0.0-2025…` are pinned RC/snapshot versions — do not bump them
  independently of the tag, or the schema/migrations may not match.
- **Blocked verification:** `bun typecheck` on the spine needs `Resource` types, which only exist after `sst install`
  + the app is configured (Stage 0/3). Vendoring + `bun install` is offline; full green typecheck is not.

## Stage 5 — record what's opencode-shaped (hand-off to the adapt follow-up)
- [ ] Document the coupling that must be rewritten to become Volt's product: Zen/lite billing product + price IDs,
      any opencode branding in `console/app` + mail templates, the stripped LLM-gateway assumptions.
- [ ] Land as a separate `adapt-commercial-backend` change: replace `console/app` with a thin Volt frontend on
      `console-core` (revive `volt-landing`), swap the billing product. **Not** here.
