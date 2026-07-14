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
- `support/` (`@opencode-ai/console-support`) — small SolidStart support-lookup portal (`index` + `lookup`
  routes); depends only on `console-core`. Byte-identical to opencode; kept for completeness (usefulness TBD).

## Frontend (the app — vendored to run/test the backend as-is)

- `app/` (`@opencode-ai/console-app`) — opencode.ai's SolidStart site: **is both the marketing pages
  (`index`/`brand`/`zen`/`black`/`changelog`/`download`/`legal`…) AND the functional app** (`auth`/`stripe`/
  `workspace`/`workspace-picker`/`user-menu`). Test all backend features via the functional routes; the marketing
  pages tag along. It's opencode-branded — the plan is to replace it with Volt's own frontend on `console-core`.
`@opencode-ai/ui` is **NOT vendored.** `console/app` used only 8 of its 191 source files, and really just three
things: `createSimpleContext`, `Favicon`, and a no-op `Font`. The rest (all of `v2/`, 1210 icons, audio,
storybook, 183 agent-GUI components) was dead weight. So those bits are inlined into `console/app/src/ui.tsx`
(Font dropped — it returned `null`), the `@opencode-ai/ui` dependency + package are gone, and 15 catalog entries
that only `ui` needed were pruned. No new deps added to `console/app` (it already had `solid-js` + `@solidjs/meta`).

Also removed as dead opencode publish tooling: `ui/script/publish.ts` and `packages/script`
(`@opencode-ai/script`) — never ran in Volt.

The rest of the vendored tree (spine + `console/app` source) remains byte-identical to opencode `v1.17.20`, except
the handful of import lines in `console/app` that now point at the local `./ui` instead of `@opencode-ai/ui`.

> One build-time caveat (not a code diff): `console/app`'s `build` script ends with
> `bun ../../opencode/script/schema.ts …`, which reaches into `packages/opencode` (the CLI, not vendored). So
> `bun run build` on `console/app` needs that at Stage 3; `typecheck`/`dev` don't. The script line is kept
> verbatim — we did **not** patch it.

**Deploy entrypoint:** `/sst.config.ts` + `/infra/{console,stage,secret,app}.ts`. **Rewired for Volt** (no longer
verbatim): app name→`volt`, opencode domains/zone/PlanetScale-org/AWS-profiles → Volt placeholders marked
`TODO(volt)`; the `lake`/`stats`/`monitoring`/`enterprise` infra + the `app.ts` deploys of dropped packages are
removed. Fill the `TODO(volt)` markers + create the cloud accounts (Stage 0) before `sst deploy`.

**Gateway is IN scope** (Volt sells LLM subscriptions too): `ZEN_MODELS` (Volt's pooled upstream provider keys),
`Upstash*` (rate-limit/budget state), `ZEN_LIMITS`, and the Zen/Go/Black Stripe products are **kept and needed** —
fill them, don't prune. Only truly opencode-specific integrations (`Salesforce*`, `Discord*`, `AWS_SES_*`,
`EMAILOCTOPUS`, `Honeycomb*`) are prune-able placeholders.

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
