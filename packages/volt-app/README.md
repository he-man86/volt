# @opencode-ai/volt-app

Volt's **Solid components for the opencode desktop app** — the `volt-vscode` SCM/history UX brought
*into* the desktop GUI. Holds **only** Volt-owned components — **never** a copy of `packages/app`
(which stays a synced upstream dependency). All Volt desktop UI grows here so the opencode seam is
tiny.

> **Status — mounted as a tab.** `VoltPanel` is a persistent **"⚡ Volt" tab** in the session's
> changes panel (next to Review / Context), via a trigger + content line in
> `packages/app/src/pages/session/session-side-panel.tsx` (+ two lines in `helpers.ts` to treat
> `volt` as a persistent tab). It bundles into the app build (`bun run dev:desktop` → open the
> changes panel → the Volt tab). **Live data** flows over Electron IPC (`window.volt.*`).

```
 packages/app (agent GUI, synced)            @opencode-ai/volt-app (fork-owned)
   session-side-panel.tsx:                    VoltPanel  (title toolbar: Pull/Push/Build/Refresh;
     <Tabs.Trigger value="volt">                Status: health + incoming/outgoing/merge;
     <Tabs.Content value="volt">                History: volt log)
        <VoltPanel workspaceRoot={dir}/>          └─ window.volt.*  (ipc.ts contract; types only)
                                                       ▲ Electron IPC
                                   packages/desktop ───┘  main runs @opencode-ai/volt-control
```

## Pieces

- **`VoltPanel`** — the tab content. A title toolbar (Pull/Push/Build/Refresh icon buttons, VS Code
  SCM style), then `Status` (bridge health + Incoming/Changes/Merge file rows) and `History`
  (`volt log` snapshots as an Accordion). Built from opencode's **v2 components** + design tokens
  (FileIcon, Accordion, SegmentedControlV2, IconButtonV2) so it reads native.
- **`ipc.ts`** — the `window.volt` contract (`detect/status/pull/push/build/log/show`). Types come
  from `@opencode-ai/volt-control` via `import type` (erased at build → no Node in the renderer).

## The opencode seam (the changes panel has no plugin hook)

A persistent "Volt" tab needs ~4 small insertions, all wiring (no Volt logic):
`session-side-panel.tsx` (a `<Tabs.Trigger value="volt">` + a `<Tabs.Content value="volt">` rendering
`<VoltPanel>`, + the `useSDK` import) and `helpers.ts` (treat `"volt"` as persistent in
`openedTabs`/`activeTab`). Allowlisted in `volt-scripts/check-divergence.ts`; see CLAUDE.md "Fork surface".

## The IPC bridge (in `packages/desktop`, the deliberate-seam zone)

The renderer can't spawn the CLI. The desktop **main** process runs `@opencode-ai/volt-control`
(Node) via `registerVoltIpcHandlers(ipcMain, cliPath)`, and a preload exposes `window.volt`
(`contextBridge.exposeInMainWorld("volt", …)`, channel names from `@opencode-ai/volt-control/channels`).
The volt CLI is bundled beside the main bundle (`out/main/volt.js`, an electron.vite input),
resolved at runtime like the sidecar — a PLC workspace has no volt CLI in `node_modules`.
