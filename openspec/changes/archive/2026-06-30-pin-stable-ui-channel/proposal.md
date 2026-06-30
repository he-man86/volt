## Status: IMPLEMENTED (2026-06-30)

Shipped as designed: `OPENCODE_CHANNEL=prod` lives in the gitignored root `.env` (bun auto-loads it, so every
local build — the `volt` binary + the desktop renderer — defaults to prod/v1), and `volt-scripts/build-installer.ts`
forces it + rebuilds the renderer under prod as the CI-safe guarantee (a stale non-prod renderer was the actual
bug). The auto-follow holds: the default *is* opencode's own `VITE_OPENCODE_CHANNEL !== "prod"` rule, so a
prod-promoted v2 is inherited with no Volt change. `check-volt-integration.ts` now guards `app/vite.js`'s channel
`define` against an upstream drop (cf. opencode PR #28612). No new seam.

## Why

opencode gates its UI behind a runtime flag whose default keys off the build channel:

```ts
// packages/app/src/context/settings.tsx
export const newLayoutDesignsDefault = import.meta.env.VITE_OPENCODE_CHANNEL !== "prod"
```

Stable releases build `OPENCODE_CHANNEL=prod` → the polished **v1 legacy** layout. An unset/`beta`
channel → the in-progress **v2** layout (the 81-component `ui/src/v2` migration). Volt's from-source
build sets no channel, so it defaults to **v2** — rougher than opencode's stable download, which is
what "the app looks less polished" was. v2 is **not a separate package** — it's the same
`packages/app`, flag-gated at runtime; `ui/src/v2` are new components the app conditionally renders.

We want Volt to ship the **stable v1** today and adopt v2 **only when opencode promotes it to prod** —
with no migration work.

## What Changes

- Volt's desktop packaging sets **`OPENCODE_CHANNEL=prod`** (one build-time env var) → app name `Volt`
  (not `Volt Dev`), prod icons, and the **v1** layout by default.
- **Auto-follow:** because the default *is* opencode's own `OPENCODE_CHANNEL !== "prod"` rule, the day
  opencode makes v2 the prod default, Volt's prod build inherits v2 automatically — zero Volt change.
  We track opencode's *stable*, not its bleeding edge.
- **No new seam:** the channel is a build-time env var the desktop vite/electron-builder configs already
  read (`process.env.OPENCODE_CHANNEL`); it lives in Volt's packaging path (a `volt-scripts/` build
  wrapper / the Volt release workflow), never an edit to opencode source.

## Capabilities

### Modified Capabilities
- `upstream-sync`: add a requirement that Volt builds pin opencode's **prod** UI channel — ship stable, auto-follow promotions.

## Impact

Volt packaging only (interim: `OPENCODE_CHANNEL=prod bun run package:win`; permanent: the
`distribution` pipeline). No product-code change; orthogonal to the code-merge cadence.
