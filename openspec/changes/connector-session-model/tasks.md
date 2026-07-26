## 1. The reconciler (pure, testable first)

- [ ] 1.1 In `Volt.Cli.Connector.Core`, define the pure reconciler: `(sessions, forceOff, detected, nowUtc) → { toBind[], toUnbind[] }` where `desired = ⋃ non-expired sessions' interests \ forceOff`, resolved to detected projects by `matchesBinding`. No I/O.
- [ ] 1.2 Encode the hard rules: startup-grace suppresses UNBIND (not bind) for the window; contended host (one served project) picks the most-recently-declared; force-off keeps a project unbound; a lapsed lease drops its interests.
- [ ] 1.3 Unit-test the reconciler against all of §10/§11 cases (no bridges).

## 2. ConnectionManager → sessions + reconcile loop

- [ ] 2.1 Replace the `Selected` (one-at-a-time) + shared serving-bool state with `Sessions: {id → {interests, expiresAt}}` + `forceOff`, behind the existing single-volatile-State discipline.
- [ ] 2.2 `OpenSession()`, `Sync(id, interests)` (renew + set interests), `CloseSession(id)`, and a lease sweep on the existing tick.
- [ ] 2.3 Drive bind/unbind through the reconciler behind an injected `IBridgeGate` (bind/unbind a project on its host) so the manager is testable; run reconcile on each sync, sweep, and detected-project change; keep it serialized.
- [ ] 2.4 `Aggregate()` (tray colour) + per-project serving derive from the reconciled/actual state — no `ActiveConnection` highlight.

## 3. Control plane API + legacy shim

- [ ] 3.1 `ControlServer`: `POST /session`, `POST /session/{id}/sync` (→ `ConnectorView`), `DELETE /session/{id}`.
- [ ] 3.2 Legacy shim: keep `GET /status`, `POST /connect`, `POST /disconnect` mapped onto one implicit never-expiring "legacy session" so an OLD frontend keeps working against the new connector (§8).
- [ ] 3.3 Tray Disconnect → set/clear `forceOff` for the project id (supervisor override), not a mutation of interests.

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
