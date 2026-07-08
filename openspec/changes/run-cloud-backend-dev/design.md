# Design — running the reused cloud backend

## The shape in one sentence

Opencode's cloud is **SST-orchestrated**: fork-owned `infra/**` + `sst.config.ts` declare
Cloudflare/Stripe/PlanetScale resources, wire secrets into them, and deploy the
`packages/console/*` code as Workers + a SolidStart site. There is no local mode — `sst dev`
provisions real resources in *your* accounts.

## Two layers

```
  INFRA (fork-owned, declares + deploys)          RUNTIME (opencode code, unmodified)
  ─────────────────────────────────────           ──────────────────────────────────
  sst.config.ts   providers + run()          ─┐
  infra/stage.ts  domain/zone/deployAws        │  deploys ↓
  infra/console.ts auth+console+billing+DB     ├──────►  packages/console/app     (Console site)
  infra/secret.ts  shared secrets              │         packages/console/function (auth/stat/log Workers)
  infra/app.ts     Api+docs+GUI  (gated)       │         packages/console/core     (billing/db domain)
  infra/enterprise.ts Teams      (gated)       │         packages/console/resource  (SST link proxy)
  infra/lake/stats/monitoring    (AWS/later)  ─┘         packages/console/mail       (email templates)
                                                         packages/ui                 (shared components)
```

## Stage-1 package touch-map (console + auth + billing)

| Package | Role in this slice | Runs as |
|---|---|---|
| `packages/console/app` | **The app.** SolidStart UI + server routes: dashboard, checkout, `/stripe/webhook` | Cloudflare SolidStart site (`Console`) |
| `packages/console/core` | **Domain heart.** billing/subscription/account/user/workspace, Stripe client, drizzle→PlanetScale | imported by app + function |
| `packages/console/function` | **Workers.** `auth.ts` = OpenAuth (GitHub/Google) sign-in; `stat.ts`; `log-processor.ts` | Cloudflare Workers (`AuthApi`, `Stat`, `LogProcessor`) |
| `packages/console/resource` | **Config proxy.** `Resource.*` → SST links; `.cloudflare.ts` reads `SST_RESOURCE_*` bindings, `.node.ts` reads local | imported everywhere |
| `packages/console/mail` | Email templates (jsx-email) for auth/billing | imported; SES *sending* is a later stage |
| `packages/ui` | Shared GUI components used by `console/app` | bundled into the site |

## External providers this slice hits

| Provider | Used for | Configure-from-here |
|---|---|---|
| **Cloudflare** | home/**state** (auto R2 bucket), Workers, KV (auth), R2 (data) | ✅ MCP + `wrangler` + SST |
| **PlanetScale** | `volt` MySQL — accounts, billing, subscriptions | `pscale` CLI + SST provider |
| **Stripe** | products/prices/coupons/webhook (test mode) | ✅ MCP + `/stripe:*` + SST provider |
| **AWS** | provider init only in Stage 1 (SES/lake are later) | `aws` CLI + SST |

## The coupling that must be cut for a clean first stage

`sst.config.ts` `run()` imports `app` + `console` + `enterprise` unconditionally, and
`infra/console.ts` imports `infra/app.ts` for one secret. So *any* stage otherwise brings up the
sync `Api` worker (`packages/function`), the Astro docs (`packages/web`), the GUI static build
(`packages/app`, a heavy `turbo build`), and the `Teams` app (`packages/enterprise`) — none of
which are console+auth+billing, each wanting its own subdomain + build.

**Cut (fork-owned infra, ~10 lines):**
1. Move `EMAILOCTOPUS_API_KEY` from `infra/app.ts` → `infra/secret.ts` (breaks the transitive import).
2. `infra/stage.ts`: `export const deployFull = $app.stage === "dev" || $app.stage === "production"`.
3. `sst.config.ts` `run()`: wrap `import("./infra/app.js")` + `import("./infra/enterprise.js")` in `if (deployFull)`.

Result: a personal stage deploys exactly `Console` + `AuthApi` + `Stat`/`LogProcessor` + Stripe + DB.
`dev`/`production` still deploy everything.

## Minimal change set to deploy for yourself

The complete inventory of opencode-owned hardcodes (from `grep`) and the smallest edit that clears
each. **Nothing else needs to change to deploy** — `check-divergence` is a *pre-push* hook, not a
deploy gate, so the infra allowlist is a commit-time chore, not a prerequisite.

### Required — identity (2 files, ~5 lines)
| File · line | opencode value | → your value |
|---|---|---|
| `infra/stage.ts:2-4` | `*.opencode.ai` (domain) | your domain |
| `infra/stage.ts:7` | `zoneID = "430ba34c…"` | your Cloudflare zone id |
| `infra/console.ts:12` | `name: "opencode"` (PlanetScale db) | `"volt"` |
| `infra/console.ts:13` | `organization: "anomalyco"` | your PlanetScale org |

### Required — AWS profile (0–1 line)
`sst.config.ts:17-18` selects profile `opencode-dev` for any non-prod stage. Either **edit** it to
your profile name (clear), or **alias**: name your local SSO profile `opencode-dev` (zero code).

### Recommended — the cut, so a personal stage is *only* console+auth+billing (3 files, ~6 lines)
Without it, the same stage also builds+deploys `api.` / `docs.` / `app.` (a heavy GUI `turbo build`)
and the `Teams` app. With a personal stage AWS is already auto-skipped; the cut removes the rest:
1. `infra/app.ts` — delete `export const EMAILOCTOPUS_API_KEY`; declare it in `infra/secret.ts` instead.
2. `infra/console.ts:2` — import `EMAILOCTOPUS_API_KEY` from `./secret` (not `./app`).
3. `infra/stage.ts` — `export const deployFull = $app.stage === "dev" || $app.stage === "production"`.
4. `sst.config.ts` `run()` — wrap the `app` + `enterprise` imports in `if (stage.deployFull)`.

### Not a code change, but do it
- Ignore/delete `.env`'s `DATABASE_*` — dead (SST generates the real DB password).
- `sst.config.ts:6 name: "opencode"` — leave as-is; SST state is per `(app, stage)`, so it's harmless.
  Rename to `"volt"` only when you want Volt-branded state (later, with `deploy-revenue-cloud`).
- Rotate the Cloudflare token / PlanetScale password that sat in the scratch `.env` before relying on them.

**Bottom line:** ~5 lines across 2 files to deploy the full stack; ~11 lines across 4 files for a clean
console-only stage. No `packages/*` source changes either way.

## What is deliberately NOT touched in Stage 1

`infra/lake.ts`, `infra/stats.ts`, `infra/monitoring.ts`, `packages/stats/*` (AWS/observability),
`packages/app` (GUI — replaced later by our own frontend, `commercial-landing`),
`packages/enterprise`, `packages/web` (docs). The **ZEN LLM gateway** (`ZEN_MODELS*`) is
opencode-internal and cannot run here — billing/auth/console UI are unaffected.
