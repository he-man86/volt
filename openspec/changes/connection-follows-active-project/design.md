# Design — connection follows the active project

## The shared lifecycle (in `@volt/control`)

The connect/disconnect *primitives* already live in control (`reconnectBound`, `boundProjectId`, `disconnect`). What's
new is naming the **lifecycle intent** so both frontends share one implementation:

```ts
// bridge/actions.ts
/** The bridge connection follows the active project view. A frontend calls enterWorkspace when a project becomes the
 *  one it's showing, and leaveWorkspace when it stops — so the desktop and VS Code share one connect/disconnect
 *  lifecycle (only the "became active / inactive" trigger differs per frontend). */
export async function enterWorkspace(root: string): Promise<{ ok: boolean; message?: string }> {
  return reconnectBound(root) // connect the bridge to THIS workspace's bound project
}
export async function leaveWorkspace(root: string): Promise<DisconnectResult> {
  return disconnect(await boundProjectId(root)) // disconnect THIS workspace's project (not the tray's active one)
}
```

`leaveWorkspace` also **dedupes** the `disconnect(await boundProjectId(root))` combo that both frontends currently
inline (desktop `volt:disconnect` + before-quit; VS Code disconnect command).

## The per-frontend triggers

Only the "became active / inactive" edges are frontend-specific — everything past them is shared:

| | becomes active → `enterWorkspace` | becomes inactive → `leaveWorkspace` |
|---|---|---|
| **Desktop** | `bindWorkspace(root)` (opencode navigated to a project) | `unbindWorkspace` (home-route release) + app quit |
| **VS Code** | `activate` (workspace folder open) | `deactivate` (window close) |

Desktop: the calls go **inside** `bindWorkspace`/`unbindWorkspace` (panel.ts), so every desktop bind/unbind carries
the connection with it — no caller has to remember. Fire-and-forget the connect (don't block the panel on the
connector round-trip); the status poll reflects the result. `leaveWorkspace` is awaited best-effort inside
`unbindWorkspace` before the status feed is torn down.

VS Code: `activate` connects the bound folder; `deactivate` disconnects each bound workspace (best-effort, returned as
part of the `deactivate` thenable so the editor waits, like the LSP shutdown already does).

## Manual buttons

Connect/Disconnect stay as an **override/retry**, now calling the same `enterWorkspace`/`leaveWorkspace`. Their job
shrinks to "the bridge dropped (IDE restarted) and I want to reconnect without re-navigating," or "stop syncing this
project while I stay on it."

## The shared-connection caveat (accepted for B)

Connections are keyed by **project**, not by frontend. If one project is open in two UIs (editing in VS Code, chatting
in opencode-desktop), both are connected to the same bridge; `leaveWorkspace` from one **deselects the bridge for
both**. Under B, the other frontend re-connects on its next status poll (being-bound implies a connect), so it
self-heals with a brief flicker. The correct fix is **A (reference-count in the connector)** — deferred, because it's
a C# change outside `@volt/control`.

## Idempotence / safety

- `enterWorkspace` (`reconnectBound`) is idempotent — re-selecting an already-selected project is a cheap noop; safe
  to call on every bind.
- `leaveWorkspace` never throws (control's `disconnect` returns `{ok:false}` on a down connector); a missing
  `boundProjectId` (unbound / not detected) disconnects nothing.
- Neither touches the IDE or the bridge process — only the connector's selection, exactly as the manual buttons do.

## Test strategy

- Unit-test `enterWorkspace`/`leaveWorkspace` in `@volt/control` against the mocked connector (`enter` → connect
  POST; `leave` → resolves the bound id then disconnect POST; `leave` on an unbound/undetected root disconnects
  nothing) — the same mock-fetch harness `connector.test.ts` already uses.
- The frontend wiring (bind→enter, unbind→leave, activate→enter, deactivate→leave) is thin glue over the tested pair.
