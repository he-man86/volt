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

## Not green yet — two gates, both Stage-0/1 (these packages are OUT of the root `typecheck` gate on purpose)

1. **SST `Resource` types** — `billing.ts`/`drizzle.config.ts` read `Resource.Database`/`ZEN_SESSION_SECRET`,
   which SST only generates (`sst-env.d.ts`) after `sst install` + the app is configured with real secrets.
2. **`drizzle-orm@1.0.0-rc.2` type resolution** — the workspace symlink resolves, but `tsgo`/`bundler` doesn't
   resolve the RC's type exports (cascades TS2307 → the `eq`/`and` re-exports and implicit-`any`s). opencode
   typechecks the same version fine, so this is a bun-store/tsgo install nuance to reconcile at wiring time
   (pin/settings), not a code defect.

Until both clear, `bun install` works and the code is present, but `bun --filter=./packages/console/* typecheck`
is red. That's expected — flip console into the gate at Stage 3 once SST is wired.
