## Why

Today the bridge **connection** (whether the IDE bridge is serving a project's sync) is decoupled from *where you
are*: the desktop only disconnects on full app-quit, VS Code's `deactivate` disposes the LSP but never disconnects,
and connecting is a manual button. So a bridge connection lingers after you've left a project, and closing VS Code
leaves it connected.

The cleaner mental model — the user's — is that **an opencode session/project ≈ a VS Code window == one active PLC
project**, and *the active project view owns the connection*: navigating to a project connects its bridge; leaving it
(desktop → home, VS Code → close) disconnects. Connection becomes a consequence of "where am I," not a separate manual
step, and it's identical across both frontends.

## What Changes

- **`@volt/control` gets the shared lifecycle pair** `enterWorkspace(root)` / `leaveWorkspace(root)` — thin wrappers
  over the existing primitives (`reconnectBound` to connect; `boundProjectId` + `disconnect` to disconnect) so BOTH
  frontends share one implementation of "became the active project → connect / stopped being it → disconnect". This
  also dedupes the `boundProjectId` + `disconnect` combo both frontends currently inline.
- **Desktop:** `bindWorkspace` → `enterWorkspace` (connect on bind); `unbindWorkspace` (home-route release) →
  `leaveWorkspace` (disconnect on leave). The manual disconnect + before-quit reuse `leaveWorkspace`.
- **VS Code:** `activate` (folder open) → `enterWorkspace`; `deactivate` (window close) → `leaveWorkspace`. The manual
  disconnect command reuses `leaveWorkspace`.
- **Manual Connect/Disconnect buttons stay** — demoted to an override/retry (e.g. the IDE dropped and you want to
  reconnect without re-navigating). "You always connect first" is now automatic.

## Non-goals

- **Reference-counted connections (option A)** — making two windows on the *same* project not disconnect each other
  is a **C# connector** change (the connector would track per-project interest and idle the bridge only when the last
  frontend leaves). It cannot live in `@volt/control`, so it's a separate follow-up. This change (B) accepts that if
  you genuinely have one project open in two UIs, leaving one disconnects it and the other reconnects on its next
  status poll.
- No change to the bridges, the sync engine, or the `volt` CLI.

## Capabilities

### New Capabilities
- `connection-follows-active-project`: the bridge connection lifecycle is driven by which project the frontend is
  actively showing — one shared `@volt/control` implementation, wired to each frontend's enter/leave triggers.

## Impact

- `packages/volt-control/src/bridge/actions.ts` (the `enterWorkspace`/`leaveWorkspace` pair).
- `packages/volt-desktop/src/panel.ts` (bind/unbind), `commands.ts` + `main.ts` (dedupe manual/quit disconnect).
- `packages/volt-vscode/src/extension.ts` (activate/deactivate), `commands.ts` (dedupe manual disconnect).
