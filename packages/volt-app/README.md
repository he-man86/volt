# @opencode-ai/volt-app

Volt's **Solid components for the opencode desktop app** — the `volt-vscode` SCM/history UX brought
*into* the desktop GUI. Holds **only** Volt-owned components — **never** a copy of `packages/app`
(which stays a synced upstream dependency). All Volt desktop UI grows here so the opencode seam is a
single mount line.

> **Status — panel built + mounted.** `VoltSidePanel` is Volt's own session column (a sibling of the
> git/review and file-explorer panels), mounted via one line in `packages/app/src/pages/session.tsx`.
> It bundles into the app build (`bun run dev:desktop` to view). Pure renderer UI. **Next:** the
> Electron IPC bridge (`window.volt.*` → `volt-control`) so the panel shows live data instead of the
> placeholder.

```
 packages/app (agent GUI, synced)        @opencode-ai/volt-app (fork-owned)
   session.tsx:                            VoltSidePanel  (panel chrome + width + ResizeHandle + header)
     <VoltSidePanel                          └─ VoltPanel (Status: health + incoming/outgoing/merge
        workspaceRoot={dir}/>  ◄── mount         + pull/push/build; History: volt log)
                                                   └─ window.volt.*  (ipc.ts contract; types only)
                                                        ▲ Electron IPC
                                   packages/desktop ────┘  main process runs @opencode-ai/volt-control
```

## Layout

- **`VoltSidePanel`** — the panel: card chrome (`bg-background-base`, rounded, shadow), a left
  `ResizeHandle` (native `@opencode-ai/ui`), a "Volt" header, and `VoltPanel` inside. Width is local
  (no `layout.tsx` seam). Built from opencode's **v2 components** + design tokens so it reads native.
- **`VoltPanel`** — Status (bridge health + Incoming/Changes/Merge lists + Pull/Push/Build/Refresh)
  and History (`volt log` snapshots). `SegmentedControlV2` sub-tabs, `ButtonV2` toolbar.
- **`ipc.ts`** — the `window.volt` contract (`detect/status/pull/push/build/log/show`). Types come
  from `@opencode-ai/volt-control` via `import type` (erased at build → no Node code in the renderer).

## The one opencode seam

`packages/app` has no plugin hook, so mounting is a deliberate (minimal) seam — just an import + one
`<VoltSidePanel workspaceRoot={sdk().directory}/>` line in `session.tsx`. Everything else lives here.
Allowlisted in `volt-scripts/check-divergence.ts`; see `CLAUDE.md` "Fork surface".

## Next — the IPC bridge (in `packages/desktop`, the deliberate-seam zone)

The renderer can't spawn the CLI. The desktop **main** process runs `@opencode-ai/volt-control`
(Node) and a preload exposes `window.volt` (`contextBridge.exposeInMainWorld("volt", …)`). The main
process must `setBundledCli(...)` to the bundled `volt` CLI (a PLC workspace has none in
`node_modules`). Verify: open a `.volt` workspace in the desktop app → the panel drives the CLI.
