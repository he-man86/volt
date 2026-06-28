# @opencode-ai/volt-app

> Volt's SolidJS pieces for the opencode desktop app's session **changes panel** — a thin IDE-sync surface over Electron IPC.

Two components render Volt's IDE-sync into opencode's native session changes panel (no separate tab):
`VoltOnboard` (bind an unbound folder to a live PLC IDE) and `VoltIdeHeader` (Pull/Push/Build + bridge
health above the IDE diff). Both are pure views — every action calls `window.volt.*`; the real work runs
in the desktop main process via `@opencode-ai/volt-control`.

## Role in Volt

This is Volt's **desktop GUI front-end** — the surface a user clicks rather than types. It is a **pure
renderer**: every action goes through `window.volt.*` (Electron IPC → `volt-control` in the desktop main
process), and it imports `@opencode-ai/volt-control` for **types only** (`import type`, erased at build —
no Node code reaches the renderer). Volt mounts into opencode's session changes panel as an **"IDE"
changes-source** in the existing changes dropdown — a minimal seam in `packages/app/src/pages/session.tsx`,
since neither `packages/app` nor `packages/desktop` exposes a plugin hook for the changes panel.

## How it works

The session changes dropdown (git / branch / turn) gains an **"IDE"** source for a bound Volt workspace;
selecting it renders the outgoing PLC drift (working tree ↔ the IDE baseline `refs/remotes/volt/ide`, from
`volt diff`) through opencode's normal review pipeline. The two Volt components sit around it:

- **`VoltIdeHeader`** — shown above the diff when "IDE" is selected: a **bridge-health** dot + label and
  **Pull / Push / Build / Refresh** icon buttons. Each calls `window.volt.{pull,push,build}`, surfaces the
  outcome, refetches, and signals the host (`onChanged`) to invalidate the IDE diff so the list updates.
- **`VoltOnboard`** — shown when the folder **isn't** a Volt workspace yet: it probes the configured bridge
  ports (`window.volt.probe`) and, for each **live** PLC IDE, offers an `Initialize — <IDE> · <project>`
  button (`window.volt.init`). Mirrors the VS Code SCM welcome; nothing shows when no bridge is connected.

Everything else is **delegated, not reimplemented**: local git changes (and their diffs), history, and
conflict resolution are plain **native git** in the editor (opencode's Review tab + built-in Git tools).

`ipc.ts` declares the `window.volt` contract — a `VoltBridge` interface
(`detect/status/pull/push/build/show/diff/probe/init`) plus a `declare global` augmentation of `Window`.
The Electron path that fulfills it lives in `packages/desktop`: a preload exposes `window.volt`
(`contextBridge.exposeInMainWorld`), and the main process wires the handlers through `@opencode-ai/volt-control`.

## Commands

Mounted by the desktop app; there is no standalone run target.

```bash
bun typecheck          # tsgo --noEmit
```

To see it live, run the desktop app from the repo root:

```bash
bun dev:desktop        # open a session → changes panel → the "IDE" source (or the onboarding buttons)
```

## Layout

| Path | Role |
|---|---|
| `src/VoltIdeHeader.tsx` | The Pull/Push/Build + bridge-health strip shown above the IDE diff. |
| `src/VoltOnboard.tsx` | The per-vendor `Initialize — <IDE> · <project>` buttons for an unbound folder (live-gated). |
| `src/ipc.ts` | The `window.volt` (`VoltBridge`) contract + `Window` augmentation; types only (incl. `IdeDiff`, `VendorProbe`). |
| `src/index.ts` | Package entry — re-exports `VoltIdeHeader`, `VoltOnboard`, and the IPC types. |
| `src/globals.d.ts` | Asset-module shims (`*.svg`, `*.css`) so `tsgo` typechecks through `@opencode-ai/ui`. |

## See also

- [`../volt-control/README.md`](../volt-control/README.md) — the Node side the IPC handlers run.
- [`../volt-vscode/README.md`](../volt-vscode/README.md) — the VS Code renderer of the same IDE-sync.
- [`../../CLAUDE.md`](../../CLAUDE.md) — fork surface and the `packages/app`/`desktop` seams.
