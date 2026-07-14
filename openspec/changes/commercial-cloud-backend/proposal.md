## Why

Volt is a clean standalone repo now — all opencode source was stripped, including `packages/volt-landing`
and the vendored `packages/console` (git-recoverable from `db73e8d459`). We want the **commercial backend**
back: Stripe billing, the enterprise/teams app, the DB, and user/workspace management. Not to reinvent it —
opencode already built this and it's **public in their released repo** (verified at tag `v1.17.20`; the old
"console-* deps are private" note was stale). The play: vendor opencode's commercial packages **as-is**,
repoint the providers at Volt's own cloud accounts, deploy, get it running — *then* adapt (rewrite the
landing page, swap the billing product) as a follow-up.

## What opencode ships (the map, at `v1.17.20`)

The whole backend is one SST/Pulumi app (`sst.config.ts`, `home: "cloudflare"`) over five providers —
Cloudflare (Workers/R2/StaticSite), AWS, **Stripe** (`18.0.0`), **PlanetScale** (MySQL), Honeycomb.

| Piece | Package / file | What it is |
|---|---|---|
| **Core business logic** | `packages/console/core` (`@opencode-ai/console-core`) | drizzle DB layer + `account` `user` `workspace` `actor` (auth) `billing` (Stripe) `subscription` — and opencode-product bits `provider` `model` `key` `lite` `referral` |
| **DB schema (user managers)** | `console/core/src/schema/*.sql.ts` | `account` `auth` `user` `workspace` `billing` + product tables (`key` `model` `provider` `referral` `ip` `benchmark`) |
| **Auth issuer** | `console/function/auth.ts` + `@openauthjs/openauth` | OpenAuth issuer, clientID `app`, shared session cookie |
| **Secrets binding** | `packages/console/resource` (`@opencode-ai/console-resource`) | SST `Resource.*` (e.g. `ZEN_SESSION_SECRET`) |
| **Transactional mail** | `packages/console/mail` | jsx-email templates |
| **Frontend (site + dashboard)** | `packages/console/app` (`@opencode-ai/console-app`) | SolidStart — **is opencode.ai itself**: marketing home + `brand`/`changelog`/`legal`/`download` + signup/`stripe`/`zen` checkout + authed dashboard (`workspace`/`stats`/`bench`). Deploys to root `domain`. Depends on `@opencode-ai/ui`. |
| ~~Enterprise / Teams~~ | `packages/enterprise` | **DROP** — depends on `@opencode-ai/core` + `session-ui` + `ui`; it's opencode's *session-sharing* app (`share` routes) tied to the agent runtime, not generic enterprise infra. Rebuild teams/SSO on `console-core` (has workspace/user/role) later. |
| ~~API worker~~ | `packages/function` | **DROP** — octokit GitHub-app + sync durable object; opencode-product-specific. |
| **Docs** | `packages/web` | Astro docs site — optional, not part of as-is |
| *(NOT a frontend)* | `packages/app` (`@opencode-ai/app`) | opencode's agent **chat GUI** — already replaced by stock opencode; do not vendor |
| **API worker** | `packages/function/src/api.ts` + `infra/app.ts` | Cloudflare Worker (GitHub app, sync durable object, R2) |
| **DB infra** | `infra/console.ts` | PlanetScale MySQL cluster/branch/password |
| **Secrets** | `infra/secret.ts`, `infra/app.ts`, `sst.config.ts` | Stripe, R2, PlanetScale, Honeycomb, GitHub app, support bots, session secret |

## What Changes

Bring up a **minimum coherent subset** under `packages/console/*` + `infra/`, repointed to Volt's cloud:

- **Vendor the spine as-is, pinned to `v1.17.20`, each package WHOLE** (per-module exports, no barrel — unused
  LLM-gateway modules never load, so no risky file surgery): `console/{core,resource,mail,function}` + the infra it
  needs (`console.ts`, `secret.ts`, `stage.ts`, a trimmed `app.ts`, `sst.config.ts`, the `.sst` platform).
- **Repoint providers to Volt accounts:** Volt Cloudflare + AWS profile + **Volt Stripe account** + Volt
  PlanetScale DB + Volt domain. Set the SST secrets. `drizzle-kit` migrate the schema.
- **Frontend, two roles:** deploy `console/app` **as-is** (drags in `@opencode-ai/ui`; stub the `packages/opencode`
  schema build step) as a working *reference checkpoint* — proves signup → Stripe → dashboard. **But** the real
  "our frontend" is a thin app on `console-core` — revive `packages/volt-landing` (already ported to reuse
  `console-core` auth + `Billing.generateLiteCheckoutUrl`), not a fork of opencode.ai (a rip-out, not a reskin).
- **Do NOT vendor:** `packages/enterprise` (opencode-core coupled), `packages/function` (GitHub/sync worker), the
  `packages/app` GUI, docs `web`, lake/stats/benchmark. And don't *use* console-core's LLM-gateway modules
  (`provider`/`model`/`key`/`lite`/`referral`) — they carry opencode's Zen product, not Volt's.

## Impact

- **New:** `packages/console/*`, `packages/enterprise`, `infra/*`, `sst.config.ts` — a cloud-deploy surface the
  repo doesn't currently have. Root `package.json` gains the console workspaces + `stripe`/`drizzle`/`planetscale`
  catalog entries.
- **Load-bearing risk (call it now):** opencode's billing (`billing.ts` / `subscription.ts` / `lite.ts`) is wired
  to their **Zen LLM-subscription product** and its Stripe price IDs. "Deploy as-is" yields a *running* console
  that bills for opencode's product shape; making it bill for **Volt's** product is the named follow-up, not part
  of this bring-up.
- **Nothing in the existing Volt product depends on this** — the bridge/CLI/LSP/desktop are untouched. This is
  additive cloud infra that stands alone until the landing page and product are adapted onto it.
