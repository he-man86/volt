## 1. The reconciler (pure, testable first)

- [x] 1.1 In `Volt.Cli.Connector.Core`, define the pure reconciler: `(sessions, forceOff, detected, nowUtc, startupGraceUntil) → { toBind[], toUnbind[] }` where `desired = ⋃ non-expired sessions' interests \ forceOff`, resolved to detected projects by vendor+name. No I/O. (`Reconciler.cs` + `Session.cs`.)
- [x] 1.2 Encode the hard rules: **bind is level-triggered, unbind is edge-triggered** — a bridge serves by default, so only the wanted→unwanted LEAVE edge (or force-off) gates a project; a never-wanted serving bridge is left alone (standalone `volt push` + untouched-neighbour). A shared host keeps its serving-wanted incumbent and never thrashes (cold-start picks one deterministically — no most-recent-wins machinery). Edge-triggering also removed the need for a startup-grace window.
- [x] 1.3 Unit-test the reconciler against all of §10/§11 cases, incl. the leave-edge, the never-wanted-neighbour guarantee, the post-restart "nothing gated", and the anti-thrash convergence invariant (a second pass over the applied plan is a no-op). 18 tests, no bridges. `ReconcilerTests.cs`.

## 2. ConnectionManager → sessions + reconcile loop

- [x] 2.1 Replaced the `Selected` (one-at-a-time) + serving-map state with `Sessions: {id → {interests, expiresAt}}` + `ForceOff` + `Wanted` (last pass's desired, for edge-gating), all inside the one immutable `State` behind the single gate.
- [x] 2.2 `OpenSessionAsync()`, `SyncAsync(id, interests)` (upsert + renew + reconcile), `CloseSessionAsync(id)`, `SetForceOffAsync(id, on)`, and a lease sweep folded into the periodic `RefreshAsync` tick.
- [x] 2.3 Bind/unbind route through the reconciler via the existing `IProjectSource` seam (no new interface needed — the sources ARE the per-vendor gate); reconcile (`CycleCoreAsync`) runs on each sync/close/force-off/refresh, serialized under the gate, best-effort with a re-scan to reflect actual serving.
- [x] 2.4 `Aggregate()` = serving ∧ wanted (an open-but-undeclared IDE never paints green); per-project serving is read from the bridge. The `ActiveConnection`/`SelectedOf` highlight survives only as the cosmetic legacy-facade pick. `ConnectAsync`/`DisconnectAsync` reimplemented as an implicit legacy session + highlight over the same loop — all existing `ConnectionManagerTests` + `DisconnectLifecycleTests` stay green (100 connector tests pass).

## 3. Control plane API + legacy shim

- [x] 3.1 `ControlServer` gained `POST /session` (→ `{sessionId, leaseSeconds}`), `POST /session/{id}/sync` (declare interests + renew + read → `ConnectorView`), `DELETE /session/{id}` (→ 204). Session handlers are OPTIONAL: null → those routes 404, which is exactly a pre-session connector and makes the task-4 client fallback testable. Wired in `TrayContext` to `OpenSessionAsync`/`SyncAsync`/`CloseSessionAsync`. 5 new `ControlServerTests`.
- [x] 3.2 Legacy shim: `GET /status`, `POST /connect`, `POST /disconnect`, `POST /workers/{id}/restart` all kept, unchanged, now driving the manager's implicit legacy session (§8) — so an OLD frontend keeps working. All prior `ControlServerTests` still green.
- [ ] 3.3 Tray Disconnect → `SetForceOffAsync` (supervisor override). **DEFERRED to land with the frontends (task 5).** The mechanism exists and is tested (`SetForceOffAsync`, `ConnectionManagerSessionTests.Force_off_*`); but the tray UI would target the highlight, which is null until a frontend drives a session — so wiring the (untested WinForms) tray menu to it now is premature. Doing it alongside task 5 lets the supervisor override be designed + verified against real session-driven connections.

## 4. @volt/control → session client

- [x] 4.1 New `session.ts` owns the ONE per-app session: opened lazily on the first `enterWorkspace` (`POST /session`), a ~4s sync poll (`ensurePolling`) that declares the FULL interest set + renews + reads the view back in one `POST /session/{id}/sync`, and `shutdownSession()` = stop poll + `DELETE /session/{id}` (exported for the shells to call on quit/deactivate — wired in task 5).
- [x] 4.2 `enterWorkspace`/`reconnectBound` → `declareInterest(root)` and `leaveWorkspace` → `dropInterest(root)` (in `actions.ts`). They mutate the local `interests` map (resolved from `readBoundProject`) and force an immediate sync, so a connect/disconnect lands without waiting for the poll. `declareInterest.ok` reflects whether the bound project is actually serving (so manual Reconnect can still message "not detected — open it").
- [x] 4.3 `connectorStatus` prefers the session's cached `/sync` view via a `registerSessionView` hook (no extra `GET /status`, no `session.ts`→`connector.ts` cycle); `boundStatus` reads through it. Legacy fallback: `POST /session` 404 → LEGACY mode maps enter→`/connect`, leave→`/disconnect`, status→`GET /status` (§8).
- [x] 4.4 `session.test.ts` (11 tests: open+declare, view-preferred, not-serving, unbound no-op, drop, two-interests, shutdown DELETE, and the 3 legacy-fallback cases) + `reconnect.test.ts` rewritten to the session model. Full `@volt/control` suite: 99 pass, typecheck clean.

## 5. Frontends (touch-ups only — call sites already exist)

- [x] 5.1 Desktop: `before-quit` now `leaveWorkspace(root).then(shutdownSession)` (bounded ~1.5s); the session poll starts on the first `enterWorkspace`. Call sites unchanged.
- [x] 5.2 VS Code: `deactivate` folds `shutdownSession()` after the per-workspace `leaveWorkspace`s into the returned thenable (beside `stopLsp`). Call sites unchanged.
- [x] 5.3 Manual Disconnect wording: `describeDisconnect` (the one shared place) now says "Stopped syncing this project here" — per-window, no longer implying a global gate.
- [x] 5.4 Tray force-off (the deferred 3.3): `ConnectionManager` exposes `ForceOffIds` + a batch `SetForceOffAsync`; the tray's serving rows are clickable to **pause** (force-off) a stuck bridge, paused rows to **resume**, and a "Resume all Volt sync" item clears every override. The single "active connection" Disconnect item is gone (there is no highlight in the session model). Batch + accessor covered by `ConnectionManagerSessionTests`; tray UI compiles (no WinForms tests, as before).

## 6. Docs

- [x] 6.1 Updated the connector `README.md` (session/interest/reconcile model, edge-triggered gating, per-pid parallelism + the one-XAE limit, the supervisor force-off) + `ARCHITECTURE.md` (no single "active connection"), and both frontend READMEs (declare/drop interest, `shutdownSession`, no more shared-project disconnect). Marked option A in `connection-follows-active-project` SUPERSEDED by this change.
