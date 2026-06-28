## Why

The `desktop-panel` capability was named for the desktop renderer, but the shipped reality is
that the **VS Code extension (`volt-vscode`) is a co-equal — arguably the primary — editor
surface**. Its contracts (workspace detection, explorer drift decorations, a worst-state status
bar, the `volt://` diff content provider, health probing) were never captured. Reopen the
capability to name it honestly and fold the VS Code extension in.

## What Changes

- **Rename** the capability `desktop-panel` → `editor-surface` (the shared editor-side IDE-sync
  surface across both renderers). **BREAKING** (spec rename): the 4 existing requirements are
  removed from `desktop-panel` and re-added, renderer-neutral, under `editor-surface`.
- **Add** the VS Code extension contracts: workspace detection by `.git/volt/config.json`,
  explorer drift decorations (`i`/`o`/`C`/`RO`), a worst-state-wins status item with Start-Bridge,
  the `volt://` ref content provider, and live health probing.

## Capabilities

### New Capabilities
- `editor-surface`: the editor-side IDE-sync surface, rendered by both `volt-vscode` and the desktop `volt-app` from one shared `volt-control` core — including the VS Code extension's full surface.

### Modified Capabilities
- `desktop-panel`: **removed** — its requirements move to `editor-surface` (see Migration in the delta).

## Impact

Spec/docs only — captures already-shipped `volt-vscode` + `volt-app` behavior. No runtime change.
Sources: `packages/volt-vscode/README.md`, `packages/volt-control/README.md`.
