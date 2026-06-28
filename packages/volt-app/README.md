# @opencode-ai/volt-app

> The SolidJS "⚡ Volt" tab in the opencode desktop app — a thin IDE-sync surface over Electron IPC.

`VoltPanel` is the renderer for Volt's tab in the opencode desktop GUI: bridge health, the drift the
IDE introduced, and Pull/Push/Build. It is a pure view — every action calls `window.volt.*`; the
real work runs in the desktop main process via `@opencode-ai/volt-control`.

## Role in Volt

This is Volt's **desktop GUI front-end** — the one surface a user clicks rather than types. It is a
**pure renderer**: every action goes through `window.volt.*` (Electron IPC → `volt-control` in the
desktop main process), and it imports `@opencode-ai/volt-control` for **types only** (`import type`,
erased at build, so no Node code reaches the renderer). `VoltPanel` is mounted as a persistent tab in
opencode's session side panel — a deliberate seam in `packages/app` / `packages/desktop`, since
neither exposes a plugin hook for the changes panel.

## How it works

`VoltPanel` takes a `workspaceRoot` prop and renders four things grounded in `status()`:

- **Bridge health** — a dot + label from `status().health.kind` (`connected`/`degraded` count as
  online; otherwise `offline` or the error string).
- **Incoming drift** — what the IDE changed, the one axis plain git can't observe. Listed as
  added/modified/removed file rows (`Incoming (IDE)`).
- **Pull / Push / Build** — title-bar icon buttons; each calls `window.volt.{pull,push,build}` and
  surfaces the outcome (synced count, conflict count, rejection reason, or build result) in a status
  line, then refetches.
- **Merge state** — when a merge is in progress, it shows the conflict count and defers resolution to
  the editor's built-in Git tools.

Everything else is **delegated, not reimplemented**: outgoing (local) changes are summarized as a
count that points to opencode's **Review** tab; diffs, history, and conflict resolution are plain
**native git** in the editor.

`ipc.ts` declares the `window.volt` contract — a `VoltBridge` interface
(`detect/status/pull/push/build/show`) plus a `declare global` augmentation of `Window`. The Electron
path that fulfills it lives in `packages/desktop`: a preload exposes `window.volt`
(`contextBridge.exposeInMainWorld`), and the main process wires the handlers through
`@opencode-ai/volt-control`.

## Commands

This package is mounted by the desktop app; there is no standalone run target.

```bash
bun typecheck          # tsgo --noEmit
```

To see the panel live, run the desktop app from the repo root:

```bash
bun dev:desktop        # open a session → changes panel → the ⚡ Volt tab
```

## Layout

| Path | Role |
|---|---|
| `src/VoltPanel.tsx` | The tab's Solid component — toolbar, bridge health, incoming-drift rows, Pull/Push/Build. |
| `src/ipc.ts` | The `window.volt` (`VoltBridge`) contract + `Window` type augmentation; types only. |
| `src/index.ts` | Package entry — re-exports `VoltPanel` and the `VoltBridge` type. |
| `src/globals.d.ts` | Asset-module shims (`*.svg`, `*.css`) so `tsgo` typechecks through `@opencode-ai/ui`. |

## See also

- [`../volt-control/README.md`](../volt-control/README.md) — the Node side that the IPC handlers run.
- [`../../VOLT-DESIGN.md`](../../VOLT-DESIGN.md) — Phase 2/3 desktop integration and the delegation note.
- [`../../CLAUDE.md`](../../CLAUDE.md) — fork surface, the `packages/app`/`desktop` seams.
