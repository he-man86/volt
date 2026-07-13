## Why

Volt is a fork of opencode. The costly divergence edits opencode's **fast-moving GUI** (`packages/app`,
`packages/ui`) and its **binary** (`packages/opencode/src`) — they conflict on nearly every upstream release,
and the fork buys nothing a user can see. The fix: **stop forking opencode's GUI/binary** and ship Volt as an
additive layer over **stock, user-provided opencode**.

## What changes

- **`volt-desktop`** serves stock opencode's GUI (`opencode serve` → a `WebContentsView`) with Volt chrome + the
  IDE panel — so no `packages/app` / `packages/desktop` fork is shipped.
- **opencode is a user prerequisite**, made Volt-aware by **one env var** (`OPENCODE_CONFIG_DIR`, additive) the
  installer sets. Volt never bundles, downloads, updates, or uninstalls opencode.
- **Two lean installers** (CLI / Desktop, shared install home, Desktop = superset); the **VS Code extension** ships
  via the **Marketplace**, not the installer.
- The forked `packages/app` / `packages/desktop` / `packages/opencode/src` seams **revert to pristine**;
  `check-divergence` shrinks to the `volt-*` surface.

## Impact

- The highest-churn merge conflicts (opencode GUI/core) disappear; upstream improvements land for free.
- Ongoing cost: keep the config/LSP/tool compatible with opencode's API (a light runtime version check), not a
  source merge.
- Related: **`extract-clean-repo`** (the standalone `volt` repo this enables), `consolidate-app-runtime`,
  `distribution` (its "bundle/mirror opencode's distribution" premise is superseded — opencode is provisioned by
  the user).
