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

## State: GREEN — the spine typechecks clean, in the normal `*` gate

All four packages typecheck with **0 errors** and are byte-identical to opencode `v1.17.20` (verified by full
`diff -rq`). They're in the standard root `typecheck` gate (`--filter='*'`), same as any volt package.

What makes it green (matching opencode exactly):
- Root **`/sst-env.d.ts`** — opencode's committed, auto-generated `declare module "sst"` + `Resource` interface.
  The per-package `sst-env.d.ts` files `/// <reference>` it. **It describes opencode's cloud resources**; when
  Volt wires its own SST (Stage 0), `sst dev`/`deploy` regenerates it with Volt's resources. Don't hand-edit it.
- **`sst@4.13.1`** (opencode's catalog version) as a root devDependency, so `import … from "sst"` resolves.

> The runtime is still gated on real cloud setup (a working DB/Stripe/secrets needs `sst deploy` with Volt's
> accounts — Stage 0). Typecheck is green because the committed `sst-env.d.ts` types the code; execution needs
> the actual provisioned resources.

> History: an earlier revision listed two "gates" (drizzle + SST). The drizzle one was a false alarm — a
> corrupted bun cache extracted `drizzle-orm@1.0.0-rc.2` as empty dirs, cascading ~196 phantom errors;
> `bun pm cache rm` fixed it. The SST one is closed by the two items above.
