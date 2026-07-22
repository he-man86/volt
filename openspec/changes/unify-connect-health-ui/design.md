## Context

Volt has two frontends over one UI-agnostic core (`@volt/control`): the VS Code extension (`volt-vscode`) and the Electron desktop (`volt-desktop`). Both render a bound workspace's IDE-sync state, but each re-derives its own connect/health branching. A four-agent review found the branching has diverged and, worse, is dishonest about connectivity:

- The cross-workspace `aggregate()` (`volt-control/src/view/display.ts`) initializes `conn = "ok"` and its switch handles `unreachable`/`disconnected`/`degraded` but not `unknown`. During the pre-probe window it therefore returns `severity: "insync"` / "Connected and in sync with the IDE", and leaves `volt.bridgeOffline` false (so the extension's Connect welcome does not render → blank Sync view).
- Neither UI gates pull/push/build on `health.online` (extension `when: workspaceInitialized`; desktop `s.initialized`). They dispatch offline and fail late.
- Connect/disconnect are always-present small icons; there are up to three Connect surfaces with two verbs; disconnect only toggles the connector's active-connection highlight, which the CLI never consults.
- Desktop shows "✓ In sync with the IDE." while offline; the big Connect lives in the Bridge section, not beside Init.

`healthDisplay()` itself is faithful (`unknown`/`disconnected`/`unreachable` all → `online: false`); the dishonesty is only in `aggregate()` and in the shells not gating on `online`.

## Goals / Non-Goals

**Goals:**
- One shared state machine (`WorkspaceView.mode`) that both shells switch on, so the extension and desktop behave identically.
- Never present pull/push/build while offline; the only offline action is Connect.
- A single Connect affordance, in the same place/style as Init; no Disconnect button; no persistent small connect icon.
- `aggregate()` never reads as connected/in-sync before a probe returns.
- Consistent per-shell loading indicators.
- A round-trip test pinning the connector's mirrored wire contracts.

**Non-Goals:**
- No wire/protocol changes, no data-path changes.
- Not changing the connector's "active connection is a UI highlight" model (the CLI still talks to the pipe directly).
- Not adding a "start bridge" action to a frontend — bridge lifecycle stays the connector's job.
- Not touching `healthDisplay()` (already honest).

## Decisions

**D1 — Put the state machine in the shared layer, as `WorkspaceView.mode`.**
Add `syncMode(initialized, paused, online, hasProject)` in `workspace.ts` returning `unbound | init | offline | merging | mismatch | ready`, and expose it as `WorkspaceView.mode`. Both shells `switch (view.mode)`. *Alternative considered:* fix each UI in place — rejected because the two UIs already drifted; a shared field is the only durable guarantee of identical behavior.

**D2 — Precedence `merging > mismatch > offline > ready`.**
Merge and mismatch are local git/binding states that must be resolvable even when the bridge is down, so they outrank `offline`. `init`/`unbound` are orthogonal (only when not initialized).

**D3 — Gate actions by `mode`, not by ad-hoc `when`/`if` per button.**
Extension: introduce a `volt.bridgeOnline` context key (or reuse `!volt.bridgeOffline` once the aggregate is fixed) and add it to the `when` of pull/push/build/forcePull/forcePush; remove `volt.connect`/`volt.disconnect` from the Sync title menu. Desktop: render the action row only in `ready` mode. *Alternative:* disable (grey) offline buttons instead of hiding — rejected; hiding + a prominent Connect matches "when not connected, pull/push are not possible" and removes clutter.

**D4 — `unknown` collapses to the offline branch in `aggregate()`.**
Add `case "unknown"` alongside `disconnected` so `conn` becomes a not-connected severity (probing/offline). This both stops the false "in sync" label and makes `volt.bridgeOffline` true during probing so the Connect affordance renders. The `insync` branch is then reachable only from a genuine `connected` state. *Alternative:* a distinct `probing` severity with its own label — deferred; reusing the offline branch is the minimal correct fix and avoids a brief "connected" flash.

**D5 — One Connect surface, in the Init location; remove Disconnect.**
Extension already renders the big Connect via `viewsWelcome` gated on `bridgeOffline` (correct location). Desktop moves "Connect to the IDE" from the Bridge section into the Sync body's `offline` branch, reusing the `.init-row`/`.btn.primary` markup the Init buttons use. Both remove the small connect/disconnect icons. `volt.disconnect` stays registered (palette-only) but contributes no button.

**D6 — Indicator parity per shell.**
Extension: every bridge action uses `ProgressLocation.Notification` (fills the gaps at disconnect/abortMerge/takeSide). Desktop: the `busy` note is the one indicator for dispatched actions; refresh keeps its dedicated spinner (already isolated). No cross-shell unification of the *widget* — each uses its native idiom — only intra-shell consistency.

**D7 — Pin the connector wire contracts with a round-trip test.**
Add a test where the bridge serializes `InstancesResult`/`HealthResponse` via `Volt.Engine.Wire` and the connector's `WireProjects`/`HealthProbe.FromWire` parse it; assert every field the connector uses survives. This is the cheapest guard given the deliberate "connector references only the transport" boundary.

## Risks / Trade-offs

- [Hiding offline actions changes muscle memory] → The prominent Connect button in the same spot as Init makes the next step obvious; merge-resolution actions remain available in `merging` mode.
- [`aggregate()` change ripples to `volt.bridgeOffline` and the status-bar label] → Covered by `display.test.ts` cases for every kind including the new `unknown`; verify the extension welcome + desktop rail dot in the same pass.
- [`degraded` still counts as online, so Connect hides during a degraded channel] → Intentional (degraded is read-only-safe); the health label/tone still shows the warning. Out of scope to change here.
- [Two removed buttons could be referenced by tests/docs] → Grep `volt.disconnect`/`i-disconnect`/`i-connect` and update panel tests; keep the command registered so palette/keybindings don't break.

## Migration Plan

1. Land the shared `mode` + `aggregate()` fix in `volt-control` with unit tests (no UI change yet).
2. Update the extension (`package.json` `when` clauses, `panel.ts`, `commands.ts`) to consume `mode`/the online gate; update `panel.test.ts`.
3. Update the desktop `shell.html` to switch on `mode` and relocate Connect.
4. Add the connector wire round-trip test.
5. Ships via the normal dev-channel prerelease; no persisted state or protocol migration. Rollback is a straight revert (presentation-only).

## Open Questions

- Should `volt.disconnect` be dropped entirely rather than kept palette-only? (Current decision: keep palette-only; revisit if it proves unused.)
- Should `degraded` surface a distinct "reconnect anyway" affordance, or is the warning tone enough? (Deferred.)
