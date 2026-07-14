## Why

Volt is a clean standalone repo now — all opencode source was stripped, including the old `packages/console`
and `packages/volt-landing` (git-recoverable from `db73e8d459`). We want the **commercial backend** back:
Stripe billing, the DB, auth, and user/workspace management. Not to reinvent it — opencode already built this
and it's **public in their released repo** (verified at tag `v1.17.20`; the old "console-* deps are private"
note was stale). The play: vendor opencode's commercial packages, get them green in the monorepo, then repoint
providers at Volt's own cloud accounts and deploy — *then* adapt (own frontend, own billing product).

## Status: vendored + green (Stage 1 done). Not yet deployed (Stage 0 blocks).

The full console package set is in the repo, typechecks green, and installs. What remains is **cloud provisioning
+ infra rewire** (Stage 0/2/3), which is human-gated on Volt's accounts.

## What's vendored (from opencode `v1.17.20`, in `packages/console/*`)

The backend is one SST/Pulumi app (`sst.config.ts`, `home: "cloudflare"`) over five providers — Cloudflare
(Workers/R2), AWS, **Stripe** `18.0.0`, **PlanetScale** (MySQL), Honeycomb.

| Package | What it is | State |
|---|---|---|
| `console/core` (`@opencode-ai/console-core`) | drizzle DB layer + `account`/`user`/`workspace`/`actor` (auth) + `billing`/`subscription` (Stripe). Schema in `src/schema/*.sql.ts`. Kept **whole**; LLM-gateway modules (`provider`/`model`/`key`/`lite`/`referral`) present but unused (per-module exports → never loaded). | ✅ verbatim, green |
| `console/resource` | SST `Resource.*` secret bindings | ✅ verbatim |
| `console/mail` | jsx-email transactional templates | ✅ verbatim |
| `console/function` | OpenAuth **issuer** (`auth.ts`) + log/stat handlers | ✅ verbatim |
| `console/app` | opencode.ai's SolidStart site — marketing pages **+** the functional app (`auth`/`stripe`/`workspace`/`user-menu`). The feature-test frontend. | ✅ vendored, `@opencode-ai/ui` **inlined** (see below) |
| `console/support` | small support-lookup portal (`index`+`lookup`); depends only on `console-core`. Usefulness TBD. | ✅ verbatim |
| `infra/*.ts` + `sst.config.ts` + `sst-env.d.ts` | Deploy entrypoint. opencode-hardcoded (their domains/zone/PlanetScale org/AWS profiles + lake/stats/monitoring/enterprise deploys we don't use). | ✅ vendored **as reference** — rewire at Stage 0 |

**Green offline:** committed root `sst-env.d.ts` (opencode's, `declare module "sst"` + `Resource`) + `sst@4.13.1`
make the `Resource` types resolve, so the whole spine typechecks in the normal `--filter='*'` gate. (Runtime still
needs real provisioning — Stage 0/3.)

## Deliberately NOT vendored (decisions — don't revisit)

> **SCOPE UPDATE (gateway is IN — Volt will sell LLM subscriptions too).** The Zen LLM gateway
> (`console/app/routes/zen/` — OpenAI+Anthropic-compatible endpoints, multi-provider routing, IP/key/TPM/TPS rate
> limiting, provider-key pooling via `ZEN_MODELS`, budget/usage metering, Upstash-backed) + its `console-core`
> modules (`provider`/`model`/`key`/`lite`/`black`/`referral`) are a **kept, load-bearing part of the product**,
> not dead weight. This means: **keep** `UpstashRedisRedis*`, `ZEN_MODELS` (fill with Volt's own upstream provider
> keys), `ZEN_LIMITS`, the Zen/Go/Black Stripe products; configure the model catalog + pricing via console-core's
> `update-models`/`update-limits` scripts. Earlier notes calling these "strip in the adapt stage" are superseded.

- **`packages/ui` (`@opencode-ai/ui`)** — `console/app` used 8 of its 191 files, really just `createSimpleContext`
  + `Favicon` (+ a no-op `Font`). Inlined those into `console/app/src/ui.tsx`; dropped the package (1642 files,
  all `v2/`/icons/audio/agent-GUI components) + 15 catalog entries only it needed. No new deps.
- **`packages/enterprise`** — it's opencode's **session-sharing "Teams" app**, NOT enterprise infra. Depends on
  `@opencode-ai/core` (the agent runtime: 64 deps incl. every `@ai-sdk/*` provider + `llm`/`schema`/`plugin`/
  `effect-*`), `session-ui`, `ui`. Vendoring it = re-forking opencode's engine, reversing the de-fork. **Also
  confirmed: opencode has NO real SSO/SAML/SCIM code** — those strings appear only in i18n + tests; their
  "enterprise" is a marketing page (`console/app/routes/enterprise`) + self-hosting + sales. So there's nothing
  to copy. Enterprise features (orgs/roles/seats/SSO) get **built on `console-core`** (which already models
  workspace/user/role/account) when wanted — a future feature, not a vendor.
- **`packages/function`** (api worker: octokit GitHub-app + sync durable object), **`packages/app`** (agent chat
  GUI — already covered by stock opencode), **`packages/web`** (docs), **lake/stats/benchmark** infra.
- **opencode publish tooling** — `ui/script/publish.ts` + `packages/script` (`@opencode-ai/script`): opencode's
  npm-release helpers, never run in Volt.

## Simplifications applied (repo is NOT byte-identical to opencode, on purpose)

- `@opencode-ai/ui` inlined to `console/app/src/ui.tsx` (3 import paths in `console/app` changed).
- Favicon branding neutralized (Volt title, opencode favicon assets deleted). The **rest of `console/app` is still
  opencode's marketing site** (social cards, `/brand` wordmarks, `zen`/`black` product pages, "OpenCode" copy) —
  full de-brand is the frontend-replacement job, deferred.
- Everything else in the vendored spine is byte-identical to `v1.17.20`.

## Impact

- **New surface:** `packages/console/*` + `infra/*` + `sst.config.ts` + `sst-env.d.ts` — a cloud-deploy surface
  the repo didn't have. Root `package.json` gains the console workspaces + catalog (`stripe`/`drizzle`/`planetscale`/
  `sst`/solid + more).
- **Load-bearing risk:** opencode's billing (`billing.ts`/`subscription.ts`/`lite.ts`) is wired to their **Zen
  LLM-subscription product** + Stripe price IDs. A deploy bills for opencode's product shape; making it bill for
  **Volt's** product is the named follow-up.
- **Nothing in the existing Volt product depends on this** — bridge/CLI/LSP/desktop untouched. Additive cloud infra.
