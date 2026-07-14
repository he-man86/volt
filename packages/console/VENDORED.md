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

## Frontend (the app — vendored to run/test the backend as-is)

- `app/` (`@opencode-ai/console-app`) — opencode.ai's SolidStart site: **is both the marketing pages
  (`index`/`brand`/`zen`/`black`/`changelog`/`download`/`legal`…) AND the functional app** (`auth`/`stripe`/
  `workspace`/`workspace-picker`/`user-menu`). Test all backend features via the functional routes; the marketing
  pages tag along. It's opencode-branded — the plan is to replace it with Volt's own frontend on `console-core`.
- `/packages/ui` (`@opencode-ai/ui`) — opencode's design system (`app` depends on it). Standalone — only
  third-party npm deps, **no opencode-core coupling**.

**Two minimal deviations from verbatim** (a verbatim copy can't reference packages we excluded):
1. `app/package.json` build — dropped the trailing `bun ../../opencode/script/schema.ts …` step (it generated
   opencode-CLI config JSON from `packages/opencode`, which we don't vendor). Sitemap + `vite build` remain.
2. Deleted `ui/script/publish.ts` — it imported `@opencode-ai/script` (opencode's internal npm-publish tool).
   Volt doesn't publish `@opencode-ai/ui`.

`diff -rq` vs opencode `v1.17.20` shows *only* these two. Everything else is byte-identical.

**Deploy entrypoint:** `/sst.config.ts` + `/infra/*.ts` (also vendored verbatim). These are opencode-hardcoded
(domains `opencode.ai`, their Cloudflare zone, PlanetScale org `anomalyco`, AWS profiles, and `lake`/`stats`/
`monitoring`/`enterprise` deploys we don't use) — **rewrite for Volt at Stage 0**, don't deploy as-is.

## Not vendored (deliberately)

`packages/enterprise` (couples to opencode's agent `@opencode-ai/core` + `session-ui`), `packages/function` (api
worker: GitHub-app + sync), `packages/web` (docs site). See the proposal for why.

## State: GREEN — everything typechecks clean, in the normal `*` gate

The whole vendored surface (spine `core`/`resource`/`mail`/`function` + frontend `app` + `ui`) typechecks with
**0 errors** and is byte-identical to opencode `v1.17.20` except the two documented tooling deviations above
(verified by full `diff -rq`). All in the standard root `typecheck` gate (`--filter='*'`), same as any volt package.

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
