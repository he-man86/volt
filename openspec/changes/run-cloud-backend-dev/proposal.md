## Why

Before white-labeling anything, we need to see the **reused opencode cloud** actually
run — console + auth + billing — on **our own accounts and domain**, not opencode's. This
is the dev bring-up that de-risks `deploy-revenue-cloud`: same code, our infra. The `.env`
already has our Cloudflare, PlanetScale (`volt`), and Stripe test keys; four values are still
hardcoded to opencode's accounts and block every run.

MVP intent (user): (1) get opencode's backend running on our domain, unchanged; (2) later
replace the frontend with our own design (→ `commercial-landing`); (3) maybe backend changes
later — **not** in scope now.

## What Changes

**Stage 1 — build now (console + auth + billing):**

- **Swap the 4 identity values** (currently opencode's) to ours:
  - `infra/stage.ts` — `domain` + `zoneID` → our domain + Cloudflare zone.
  - `sst.config.ts` — aws provider `profile` → our SSO profile.
  - `infra/console.ts` — PlanetScale `getDatabaseOutput({ name, organization })` → `volt` + our org.
- **Run under a personal stage name** (e.g. `--stage volt`). `deployAws` is true only for
  stage `dev`/`production`, so a personal stage **auto-skips** AWS lake/stats/monitoring — no
  infra edits needed to scope down. (AWS creds still init the provider; nothing AWS is provisioned.)
- **Decouple the console slice so the first stage is *only* console+auth+billing.** By default
  `sst.config.ts` `run()` unconditionally imports `app` + `enterprise` too, and
  `infra/console.ts` transitively imports `infra/app.ts` (for `EMAILOCTOPUS_API_KEY`) — so a
  naive stage also brings up the sync `Api` worker, the docs site, the GUI static build, and the
  `Teams` app. Fix (fork-owned infra): move `EMAILOCTOPUS_API_KEY` out of `app.ts` into
  `infra/secret.ts`; add `stage.deployFull` (true for `dev`/`production`); gate the
  `import("./infra/app.js")` + `import("./infra/enterprise.js")` calls in `run()` behind it. See
  `design.md`.
- **Reconcile `.env` → SST secrets.** SST doesn't read `.env` for `sst.Secret`s. One command
  loads them per stage: `bunx sst secret load .env --stage volt`. The few `process.env` direct
  reads (`DATABASE_*`, `CLOUDFLARE_*` under `$dev`) keep using `.env`.
- **Repoint OAuth apps.** GitHub + Google OAuth callback URLs → our `auth.<domain>`.
  (`GITHUB_CLIENT_SECRET_CONSOLE` in `.env` is currently a paste of the client id — fix it.)
- **DB bring-up.** PlanetScale `volt` needs a `production` branch (the stage branch forks from
  it); then `bun --cwd packages/console/core db push` (drizzle migrations already exist).
- **Allowlist infra as fork-owned** (commit-time, *not* deploy-time). `check-divergence` runs in
  the pre-push hook only, so it never blocks `sst dev` — but before you `git push`, add `infra/**` +
  `sst.config.ts` to `check-divergence.ts` (CLAUDE.md's "own the infra" already treats infra as
  fork-owned; the files just aren't allowlisted yet).
- **Run:** `bun sst dev --stage volt` → console at `volt.dev.<domain>`, auth worker, Stripe webhook.

**Planned but NOT built now (documented so nothing surprises us later):**

- **SES email / EmailOctopus** — needs AWS SES keys (empty in `.env`); auth emails degrade until set.
- **AWS lake / stats / monitoring** — only under stage `dev`/`production`; wire when we go live.
- **ZEN LLM gateway** — ⚠ **blocked**: `ZEN_MODELS*`/`ZEN_LIMITS` are opencode-internal (`.env`
  marks them `[stub]`). The metered *model-call* path can't run in our stage; billing/auth/console
  UI is unaffected. Our own gateway is `deploy-revenue-cloud`'s job.
- **Frontend replacement** — → `commercial-landing` (`volt-landing`).

## Provider config channels (the "MCP / configure-from-here" question)

| Provider | Config-from-here | Notes |
|---|---|---|
| **Cloudflare** | ✅ **MCP connected** (`cloudflare-bindings`, `cloudflare-observability`) + SST (`CLOUDFLARE_API_TOKEN`) + `wrangler` | Workers/KV/R2/logs manageable now |
| **Stripe** | ✅ **MCP connected** (`plugin_stripe_stripe`) + `/stripe:*` skills + SST `stripe` provider | products/prices/webhook already declared in `infra/console.ts` |
| **PlanetScale** | `pscale` CLI + service token (`.env`) + SST `planetscale` provider | no official MCP |
| **AWS (SES/lake)** | `aws` CLI + SST providers; official AWS MCP servers exist (not connected) | SES keys still empty |
| **Upstash Redis** | REST API (token empty); provisionable via **Stripe Projects** (`/stripe:stripe-projects`) | no MCP |
| **Sentry** | official Sentry MCP exists (not connected) + API | source-map upload only |
| **Honeycomb** | SST `honeycomb` provider + API | in `sst.config.ts` providers |
| **GitHub / Google / Salesforce / Feishu** | `gh` CLI (GitHub); others are OAuth-dashboard only | — |

Actionable takeaway: **Cloudflare + Stripe can be driven from this session today**; PlanetScale/AWS
go through their CLIs + SST; the rest are dashboard/API.

## Capabilities

### Added Capabilities
- `monetization`: first end-to-end bring-up of the reused billing/auth/console stack on our infra.
  (Sibling changes `deploy-revenue-cloud` / `commercial-landing` extend this same capability.)

## Impact

Fork-owned infra: `infra/**`, `sst.config.ts` (edit + allowlist in `check-divergence.ts`). No
`packages/*` source changes — opencode's backend runs unmodified. Precursor to
`deploy-revenue-cloud`; frontend swap is `commercial-landing`.

Inputs needed from user: a domain in a Cloudflare zone, AWS SSO profile name, PlanetScale org
name + a `production` branch on `volt`, GitHub/Google OAuth apps pointed at `auth.<domain>`.
Blocked input (unavailable): ZEN gateway values (opencode-internal).
