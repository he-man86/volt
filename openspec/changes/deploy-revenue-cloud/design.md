# Design — the full hosted product

Complete inventory of what "all features" means, the provider setup channels (incl. MCPs we can
drive from here), and the dependency-ordered phases. Nothing here is new product code — it's the
reused opencode cloud, deployed on Volt's accounts.

## 1. Feature inventory (everything that ships)

### Frontend — the SolidStart console (`packages/console/app`)
- **Public/marketing:** landing, Zen gateway page, Black + Go product pages, enterprise sales, brand,
  changelog (+JSON feed), downloads (+channel/platform resolver), legal, benchmark leaderboard.
- **Auth:** login / authorize / callback / logout / status (against the `AuthApi` worker).
- **Workspace dashboard** (`workspace/[id]/…`) — the authenticated app:
  - dashboard (models, providers, onboarding, balance/checkout)
  - **billing hub**: balance, payment method, auto-reload/top-up, redeem/coupons, monthly spend limit, Black management
  - **API keys**, **usage** (metering + charts), **members/roles** (admin/member), **settings**
  - **Go (Lite) subscription** + **Black subscription** management
- **Server API routes:** `stripe/webhook`, `honeycomb/webhook`, enterprise contact (SES+Salesforce+EmailOctopus),
  support actions, openapi.json, changelog.json, desktop-feedback, discord/feishu, docs/stats/data proxies, share-link resolver.
- **Zen gateway endpoints:** `zen/v1/{chat/completions,messages,responses,models}` + `zen/go/v1/*` (OpenAI/Anthropic-compatible).

### Backend domain (`packages/console/core/src`)
`account` · `actor` (authz) · `aws` (SES) · `billing` (money: credits, payments, usage, auto-reload, coupons) ·
`black` + `lite` (the two subscription products) · `key` (API keys) · `model` (**ZenData** catalog: costs +
routing) · `provider` (BYOK creds) · `referral` · `subscription` (tier limits engine, reads `ZEN_LIMITS`) ·
`user` (+invites) · `workspace` (lifecycle). Plus schema/`*.sql.ts`, identifiers, drizzle.

### Workers / services
- **`AuthApi`** — OpenAuth issuer (GitHub + Google), KV storage, creates account+workspace on first login.
- **`Console`** — the SolidStart site (main domain), tail-consumed by LogProcessor.
- **`Api`** (`packages/function`) — Hono worker + `SyncServer` Durable Object: session-share sync (WS), Feishu→Discord, GitHub App token broker.
- **`Stat`** — model TPS qualify/unqualify lookups.
- **`LogProcessor`** — Cloudflare tail consumer → Honeycomb + data-lake ingest.
- **`Stats`** ingest + site, **`Teams`** enterprise app, **support** admin tool.

### The Zen gateway (the metered LLM proxy — lives in `console/app/src/routes/zen/`, not `packages/llm`)
`zen/util/handler.ts` authenticates the key, resolves actor/workspace, picks a model from the **ZenData**
catalog, routes to a provider, streams, meters tokens, bills. Billing sources: anonymous / free / BYOK /
subscription / lite / balance. Controls: IP + key + model-TPM + model-TPS + trial rate limiters, provider
budget/sticky trackers, usage batcher, Upstash Redis. `packages/llm` is the reusable inference SDK
underneath; the gateway is the money/routing layer on top.

## 2. Provider setup channels — where MCPs / connectors help

SST *declares* most resources; the table is about the **account-level setup SST can't do** and where a
connector accelerates it. ✅ = connected in this session.

| Provider | What it backs | Best setup channel |
|---|---|---|
| **Cloudflare** | Workers · KV · R2 · DNS · Durable Objects · SST state | ✅ **MCP** (`cloudflare-bindings`, `cloudflare-observability`) to inspect/verify bindings + logs; SST declares; `wrangler` CLI; zone + API token = dashboard once |
| **Stripe** | products · prices · coupons · webhook · checkout | ✅ **MCP** (`plugin_stripe_stripe`) + `/stripe:*` skills to create/verify + explain errors + test cards; `stripe listen` CLI forwards webhooks in dev; SST `stripe` provider declares the catalog |
| **Stripe Projects** | **provisions the empty stubs** — Upstash Redis, Postgres, email, auth | `/stripe:stripe-projects` (projects.dev) — fills `UpstashRedisRestUrl/Token` and can back email; the fastest way to clear the blank `.env` infra pieces |
| **PlanetScale** | the `volt` MySQL DB (+ a separate stats DB) | `pscale` CLI + service token (in `.env`); SST `planetscale` provider declares branch/password; no MCP |
| **AWS** | SES email · the data lake (S3 Tables/Glue/Athena/Kinesis/ECS/VPC) | SSO for provider auth; SST declares lake/stats; official AWS MCP servers exist (add if wanted); SES creds are secrets |
| **Honeycomb** | observability + alert triggers | SST `honeycomb` provider declares triggers/webhook; API key = secret |
| **Upstash Redis** | gateway rate limiting | provision via **Stripe Projects** (above) or dashboard → REST url/token secrets |
| **GitHub** | OAuth (console login) + GitHub App (Api worker) | `gh` CLI / GitHub MCP (add) or dashboard; callback → `auth.<domain>` |
| **Google** | OAuth login | Google Cloud console; callback → `auth.<domain>` |
| **Sentry** | source maps / errors | official Sentry MCP exists (add); `SENTRY_*` in `.env` |
| **Salesforce · EmailOctopus · Discord** | enterprise leads · newsletter · incident/support | dashboards + API keys (phase 6–7) |

**Actionable:** Cloudflare + Stripe are drivable from this session now; **Stripe Projects clears the
Upstash/email stubs**; PlanetScale/AWS go through their CLIs + SST; the OAuth apps and dashboards are the
irreducible human setup.

## 3. Phases → resources → providers

| Phase | Deploys | Providers |
|---|---|---|
| **1 Foundation** | PlanetScale DB + branch, `AuthApi` + `AuthStorage` KV, `console-core` domain | Cloudflare, PlanetScale, GitHub/Google OAuth |
| **2 Billing** | Stripe products/prices/coupons/webhook; billing/subscription/lite/black/referral | Stripe |
| **3 Gateway** ⚠ | `ZEN_MODELS*`+`ZEN_LIMITS` (Volt-authored), Upstash Redis, `zen/*` routes, `Stat` worker | Upstash (Stripe Projects), Volt's model-provider keys |
| **4 Console UI** | `Console` SolidStart site (dashboard/billing/keys/usage/members/settings/black/go) | Cloudflare |
| **5 Peripheral** | `Api` worker (share sync DO + GitHub App), docs `Web`, `WebApp` static | Cloudflare, GitHub App, R2 |
| **6 Observability** | `LogProcessor`, Honeycomb triggers, AWS data lake, `stats` DB+ingest+site | Honeycomb, AWS, PlanetScale |
| **7 Enterprise** | `Teams` app + R2, support tool, Salesforce/EmailOctopus/SES | Cloudflare, AWS SES, Salesforce, EmailOctopus |

Phases 1–2 + 4 = the `run-cloud-backend-dev` slice, already de-risked on a personal stage. 3 is the long
pole (Volt's own catalog). 5–7 are additive and can trail the revenue launch.

## 4. Domain topology (the console-vs-landing split)

**Gap found in review:** `console/app` is deployed at the **root** `domain` (`infra/console.ts:249`) and
serves *both* the marketing landing (`index.tsx`) *and* the authenticated dashboard (`workspace/*`). When
`volt-landing` takes the root, the dashboard needs its own subdomain. Decide the map explicitly:

| Domain | Serves | Package | Change vs opencode |
|---|---|---|---|
| `volt.ai` (root) | landing + signup | **volt-landing** | new — takes the root |
| `console.volt.ai` | the dashboard | console/app | **move `Console` off root** → `console.${domain}` |
| `auth.volt.ai` | OpenAuth issuer | console/function | rename only |
| `app.volt.ai` | agent GUI | packages/app | rename only |
| `api.volt.ai` | share-sync + GitHub App | packages/function | rename only |
| `docs.volt.ai` | docs | packages/web | rename only |

The single edit: `infra/console.ts` `Console` `domain` root → `console.${domain}`. Two consequences to
handle: (a) console/app's other root pages (changelog/downloads/legal) move with it — add or link them from
volt-landing later; (b) **shared login** across `volt.ai` ↔ `console.volt.ai` needs the session cookie scoped
to `.volt.ai` (the scaffold is host-only) — or run separate sessions (both hit the same issuer, so re-auth is cheap).

**Sequencing:** `run-cloud-backend-dev` keeps console/app at root (no volt-landing yet — fine). The move
happens in `commercial-landing`, when volt-landing is ready to own the root.
