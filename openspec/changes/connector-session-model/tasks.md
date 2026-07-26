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

- [ ] 4.1 A single per-app session: open on first `enterWorkspace`, a sync poll (~4s) that declares the current interest set + renews the lease + returns `ConnectorView`, `DELETE` on shutdown.
- [ ] 4.2 `enterWorkspace(root)` / `leaveWorkspace(root)` mutate the local interest set (resolve root → `{vendor, projectName}` via `readBoundProject`); the poll ships it. Manual Connect forces an immediate sync.
- [ ] 4.3 `connectorStatus` / `boundStatus` read the `/sync` response. Fallback: if `POST /session` 404s (old connector), use the legacy `/connect`+`/status` path (§8) so new-frontend↔old-connector still works.
- [ ] 4.4 Unit-test the session client + the legacy fallback with the mock-fetch harness.

## 5. Frontends (touch-ups only — call sites already exist)

- [ ] 5.1 Desktop: ensure the session poll runs for the app lifetime (even on home, declaring `[]`), `DELETE` on quit; `enterWorkspace`/`leaveWorkspace` call sites unchanged.
- [ ] 5.2 VS Code: session opened in `activate`, `DELETE` folded into `deactivate`'s thenable; per-workspace `enter/leave` unchanged.
- [ ] 5.3 Manual Disconnect wording/behaviour: "stop syncing this project for me" (drops my interest); it no longer implies the bridge stops for everyone.

## 6. Docs

- [ ] 6.1 Update both frontend READMEs + the connector README/ARCHITECTURE to the session/interest/reconcile model; document the one-project-per-host constraint, the lease TTL, and the tray force-off. Mark the deferred counter (A) in `connection-follows-active-project` as SUPERSEDED by this change.
