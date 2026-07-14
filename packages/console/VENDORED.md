# Vendored commercial backend (from opencode)

Source: **`sst/opencode` @ tag `v1.17.20`** (MIT). Copied verbatim, un-modified. Plan + rationale:
`openspec/changes/commercial-cloud-backend/`.

## What's here (the spine)

- `core/` (`@opencode-ai/console-core`) — drizzle DB layer + `account`/`user`/`workspace`/`actor` (auth) +
  `billing`/`subscription` (Stripe). Kept **whole**; the LLM-gateway modules (`provider`/`model`/`key`/`lite`/
  `referral`) are present but unused (per-module exports → never loaded). Don't build on them.
- `resource/` (`@opencode-ai/console-resource`) — SST `Resource.*` secret bindings.
- `mail/` (`@opencode-ai/console-mail`) — jsx-email templates.
- `function/` (`@opencode-ai/console-function`) — OpenAuth issuer (`auth.ts`) + log/stat handlers.

**Deploy entrypoint:** `/sst.config.ts` + `/infra/*.ts` (also vendored verbatim). These are opencode-hardcoded
(domains `opencode.ai`, their Cloudflare zone, PlanetScale org `anomalyco`, AWS profiles, and `lake`/`stats`/
`monitoring`/`enterprise` deploys we don't use) — **rewrite for Volt at Stage 0**, don't deploy as-is.

## Not vendored (deliberately)

`packages/enterprise` (couples to opencode's agent `@opencode-ai/core` + `session-ui`), `packages/function` (api
worker: GitHub-app + sync), the `app`/`web` GUIs. See the proposal for why.

## Not green yet — ONE gate (these packages are OUT of the root `typecheck` gate on purpose)

**SST types.** The spine typechecks **clean except 3 `Cannot find module 'sst'` errors** (console/core ×2,
console/function ×1). `billing.ts`/`drizzle.config.ts`/`resource.node.ts` import `sst` and read
`Resource.Database`/`ZEN_SESSION_SECRET`, which SST provides only after `sst install` + the app is configured
with real secrets (it generates `sst-env.d.ts`). resource=0, mail=0 errors; nothing else is red.

Flip `packages/console/*` back into the typecheck gate at Stage 3 once SST is wired.

> Note: an earlier revision of this file also listed a `drizzle-orm@1.0.0-rc.2` resolution gate. That was a
> **false alarm** — a corrupted bun cache (from install-thrashing) extracted drizzle-orm as empty dirs, cascading
> ~196 phantom errors. `bun pm cache rm` + a clean reinstall fixed it; drizzle resolves fine. Not a code defect.
