## Why

The revenue path — the **complete** hosted product going live: the metered **Zen** gateway +
`console-core` billing + Stripe + auth + observability, under Volt's own `infra/`, on Volt's
accounts and domain. Mostly **config + deploy, not new code** — but "all features" is a large
surface, so it ships in **dependency-ordered phases**. The full feature inventory, the per-provider
setup channels (incl. which MCPs/provisioners we drive from here), and the phase map live in
`design.md`. (VOLT-PLAN phase **W6**.)

Relationship to the other changes:
- `run-cloud-backend-dev` — brings up the **console+auth+billing** slice on a personal stage first (de-risks this).
- `commercial-landing` — owns the `volt-landing` **landing/signup** frontend (skeleton now scaffolded).
- **this change** — everything else, on real `dev`/`production` stages: the gateway, the full console, peripheral workers, observability, analytics, enterprise.

## What Changes

Stand up Volt's `infra/` on real stages, phased by dependency (detail + resources-per-provider in `design.md`):

1. **Foundation** — PlanetScale DB, `AuthApi` worker + KV, `console-core` domain (account / workspace / user / actor).
2. **Billing & products** — Stripe products / prices / coupons / webhook; `billing`, `subscription`, `lite` (Go), `black`, `referral`.
3. **Zen gateway** — model catalog (`ZEN_MODELS*`) + `ZEN_LIMITS`, Upstash Redis, `zen/*` + `zen/go/*` routes, provider adapters, rate limiters, `Stat` worker. ⚠ see below.
4. **Console UI** — the SolidStart console: dashboard, billing hub, API keys, usage/charts, members/roles, settings, Black/Go management.
5. **Peripheral workers** — `Api` (session-share sync DO + GitHub App broker), docs `Web`, `WebApp` static site.
6. **Observability & analytics** — `LogProcessor` tail consumer → Honeycomb + lake; Honeycomb monitoring triggers; AWS data lake (S3 Tables / Glue / Athena / Kinesis / ECS); `stats` DB + ingest service + stats site.
7. **Enterprise & support** — `Teams` app + R2 storage, internal support/admin tool, Salesforce leads / EmailOctopus / SES email.

Cross-cutting: a **provider setup pass** using the connectors available here — Cloudflare + Stripe
MCP are live in-session; **Stripe Projects** provisions the empty stubs (Upstash Redis, email); CLIs
(`pscale`, `wrangler`, `aws`, `gh`) + SST cover the rest. CI/release wiring (`.github/`).

## The one thing that is NOT reusable

⚠ **The Zen model catalog is opencode-internal.** `ZEN_MODELS1..30` + `ZEN_LIMITS` — the pricing/routing
brain read by `console-core/model.ts` + `subscription.ts` — hold opencode's real provider keys, per-token
costs, and routing tables, values that exist only in opencode.ai infra. Phase 3 therefore requires Volt to
**author its own catalog** (own provider keys, own margins/limits) into those secrets. The gateway *code*
(`zen/util/handler.ts` + provider adapters) is reused as-is; the *catalog data* is Volt's to create.
Everything in phases 1–2 and 4–7 is config + deploy.

## Capabilities

### Modified Capabilities
- `monetization`: realizes the metered hosted-subscription model end-to-end across every billing source
  (anonymous / free / BYOK / subscription / Lite / balance).

## Impact

Parallel `infra/` (fork-owned — the same files `run-cloud-backend-dev` swaps to Volt's identity); config;
Stripe catalog authored on Volt's account; ⚠ `.github/` (CI). No `packages/*` source changes except one
known seam: the non-production `@anoma.ly` email gate in `console/function/auth.ts:141` must be widened if
Volt wants public signup on non-prod stages (production is already open).

Inputs, by phase: AWS (SSO + SES), Stripe live keys, Upstash, Honeycomb, Salesforce / EmailOctopus / Discord,
and — the long pole — **Volt's own model catalog + provider keys** for the gateway.
