Phases are dependency-ordered (see design.md §3). Phases 1–2 + 4 reuse the identity swap + cut from
`run-cloud-backend-dev`; here they run on real `dev`/`production` stages.

## 0. Provider setup pass (do first, unblocks the rest)

- [ ] 0.1 Cloudflare: zone + API token confirmed; verify bindings/logs via the connected MCP
- [ ] 0.2 Stripe: live keys; catalog authored (see phase 2). Use the Stripe MCP + `stripe listen` for dev
- [ ] 0.3 Provision the stubs via **Stripe Projects**: Upstash Redis (→ `UpstashRedisRestUrl/Token`), email
- [ ] 0.4 AWS SSO + SES identity/keys; PlanetScale org + `production` branch; GitHub App + Google OAuth apps

## 1. Foundation

- [ ] 1.1 PlanetScale DB + per-stage branch; run migrations (`console-core db push`)
- [ ] 1.2 `AuthApi` worker + `AuthStorage` KV; GitHub/Google OAuth callbacks → `auth.<domain>`
- [ ] 1.3 Verify: sign in → account + default workspace created

## 2. Billing & products

- [ ] 2.1 Stripe products/prices/coupons (Go/Lite + Black 20/100/200) + webhook endpoint
- [ ] 2.2 Verify: Lite checkout → webhook → `LiteTable` row; top-up → balance; Black setup-intent

## 3. Zen gateway ⚠ (long pole — Volt-authored)

- [ ] 3.1 Author Volt's model catalog into `ZEN_MODELS1..30` + `ZEN_LIMITS` (own provider keys, costs, limits)
- [ ] 3.2 Upstash Redis wired; deploy `zen/*` + `zen/go/*` routes + `Stat` worker
- [ ] 3.3 Verify: paid sub → metered model call bills correctly across billing sources

## 4. Console UI

- [ ] 4.1 Deploy the `Console` SolidStart site (dashboard, billing, keys, usage, members, settings, black/go)
- [ ] 4.2 Verify each surface against a seeded workspace

## 5. Peripheral workers

- [ ] 5.1 `Api` worker (SyncServer DO + GitHub App broker), docs `Web`, `WebApp` static site

## 6. Observability & analytics

- [ ] 6.1 `LogProcessor` tail consumer → Honeycomb + lake; Honeycomb monitoring triggers
- [ ] 6.2 AWS data lake (S3 Tables/Glue/Athena/Kinesis/ECS) + `stats` DB + ingest service + stats site

## 7. Enterprise & support

- [ ] 7.1 `Teams` app + R2 storage; support/admin tool; Salesforce/EmailOctopus/SES wiring

## 8. Release

- [ ] 8.1 CI/release wiring (`.github/`); promote `dev` → `production`
- [ ] 8.2 Widen the `@anoma.ly` non-prod email gate (`console/function/auth.ts:141`) if public non-prod signup is wanted
