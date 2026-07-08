## Detection investigated (RESOLVED via /debug?reflect=) ✓
- [x] Confirmed both IDEs expose real change events — event-driven, no polling. Kept the `/debug?reflect=`
      read-only probe as a future investigation tool.

## Detection seam (Core)
- [x] The seam is `DriverBase.ProjectChanged` (an `event Action` on `IIdeSession`) — cleaner than a separate
      `IProjectChangeSource` interface: the SSE layer subscribes to it and never knows whether the signal came
      from an IDE event or a probe. `RaiseProjectChanged()` coalesces bursts (trailing-edge, ~300 ms).
- [x] DESIGN REFINEMENT: the `change` event carries NO token/payload — a bare ping. The consumer just re-runs its
      existing status refresh (`/refs` + diff), so there's nothing new to hash or keep in sync. (Supersedes the
      earlier structureVersion+content-token plan — the token added no value once the trigger = the existing refresh.)

## Vendor detection (behind the seam)
- [x] CODESYS: `CodesysObjectModel.SubscribeChanges` binds our generic handler to the held `_objMgr`'s
      `ObjectModified`/`Added`/`Removed`/`Renamed`/`Moved`/`PropertyModified` events via
      `Delegate.CreateDelegate` (variance), raising `ProjectChanged`. **LIVE-VERIFIED**: a `/push` fired an SSE
      `change`.
- [x] TwinCAT: the existing probe is the change source — a dirty/project-identity transition raises
      `ProjectChanged` (behind the same wire). Coarser than CODESYS's per-edit events; DTE-event subscription
      via our late-bound COM isn't cleanly bindable and isn't headless-testable, so this is the pragmatic path
      (build-verified).

## Wire (Core)
- [x] `GET /events` (SSE): `event: change` on each debounced change + `: keep-alive` (which also serves as the
      client's liveness signal); served off the marshalled thread; thread-safe subscriber registry; dead peers
      pruned on a failed write.
- [x] Parity: the `/events` wire is identical for both vendors regardless of detection path.
- [x] No `/wait-change` long-poll — SSE covers both the GUI (persistent) and the CLI (`waitForChange` reads one
      event off the same stream), so the long-poll fallback was unnecessary.

## Client / GUI
- [x] `volt-control`: `subscribeChanges(port, onChange)` — SSE reader, auto-reconnect, unsubscribe.
- [x] `volt-vscode`: `VoltStatus` subscribes on start → `refresh()` on each `change` (auto-updates the drift
      view; the manual "refresh" is now rarely needed for IDE-side edits). No new poll added — reviewed: the
      existing 10 s timer is onboarding-liveness only, not drift, so it's untouched.

## CLI + AI
- [x] `volt wait-change [--timeout <s>]`: `BridgeClient.waitForChange` reads one `change` off `/events` and exits
      (non-zero on timeout). Read-only verb — the AI can block-until-IDE-change then pull; a script can gate on it.

## Docs
- [x] `packages/volt-bridge/openapi.yaml`: `GET /events` (`text/event-stream`, `change` + keep-alive) documented
      for `/swagger`.

## Tests
- [x] Wire: `/events` delivers a `change` after a fired IDE change (`ChangeEventsTests`); dead-peer prune covered
      by the broadcast path. Live end-to-end verified via a real `/push`.
- [x] `subscribeChanges` coverage: satisfied by the Core `/events` wire test (`ChangeEventsTests`) + the live
      end-to-end (`/push` → SSE `change`); a dedicated volt-control unit test for the thin SSE reader was judged
      redundant.

## Notes
- Scoped to GUI + `wait-change`; on-demand `volt status` unchanged.
- SSE only; no WebSocket, no long-poll, no change token — the event is a bare trigger for the existing refresh.
