## Why

The connector's connect/disconnect API is imperative: a client POSTs "connect X" / "disconnect X" and the connector
flips ONE shared per-project serving bool. That was correct when connecting was a **manual, single-owner** action.
After the pivot to *the connection follows the active project view* (openspec `connection-follows-active-project`),
connects are **automatic and can overlap** — the desktop and a VS Code window can both be on one project — and the
imperative model has no correct answer: the first client to leave un-serves a project another is still using. Every
patch on top of it (a counter, then client-ids for the counter, then crash-cleanup for the ids) is a symptom fix on
the wrong primitive.

The connector is now a **shared-resource coordinator**: N ephemeral clients (desktop instances, VS Code windows)
contend for M bridges (live IDE hosts that can serve a PLC project). The correct pattern for that — the one used by
Kubernetes, DHCP, etcd leases, and multiplayer presence — is **declared desired-state + presence + reconciliation**:
clients declare *what they're using* (not connect/disconnect actions), hold a **lease** that proves they're alive, and
the connector **reconciles** the bridges to match the union of live interests. A project serves **iff ≥1 live client
is using it** — derived, not manually maintained. Crashes, races, and multi-client sharing all fall out of one model
instead of three patches.

## What Changes

- **The connector (C#) gains a session/interest model + a reconcile loop.** `ConnectionManager` stops storing a
  one-at-a-time `Selected` and a shared serving bool; it stores **sessions** (each with a lease TTL and a set of
  **interests**) and drives bridges toward `desired = ⋃ interests over live sessions` (best-effort within the bridge's
  one-project-per-host limit).
- **The control plane gains a declarative, lease-renewing API** — `POST /session`, `POST /session/{id}/sync`
  (declare interests + renew lease + read status in one call), `DELETE /session/{id}` — folded into the poll the
  clients already make, so no new traffic.
- **`@volt/control` switches its lifecycle to the session model.** `enterWorkspace` / `leaveWorkspace` keep their call
  sites in both frontends (from `connection-follows-active-project`) but now **add/remove an interest** in the local
  session set that the sync poll declares — no more `POST /connect` / `POST /disconnect`.
- **Interest is the workspace's binding identity `{vendor, projectName}`** (what `readBoundProject` returns),
  resolved connector-side — so a workspace can declare interest *before* its IDE is open (bound the moment the project
  appears) and re-resolves across an IDE restart. It does NOT disambiguate same-name projects; that collapse (a
  CODESYS "Main" + a TwinCAT "Main", or two CODESYS instances both "Main") is an existing, out-of-scope gap that needs
  a per-instance identity — see design §1.
- **Manual Disconnect is redefined, correctly for multi-client:** a frontend's Disconnect drops *its own* interest
  (only un-serves if no other client wants it); the **tray's** Disconnect becomes a connector-held **force-off**
  override (the supervisor escape hatch for a stuck bridge), the one place an override belongs.

## Non-goals

- Not changing the **bridges** or the sync engine. The connector can only gate at the bridge's granularity — a host
  serves **one project at a time** (CODESYS per-pid hosts avoid contention; a TwinCAT XAE worker shares one). The
  reconciler is best-effort within that hardware limit; it does not make a single host serve two projects at once.
- Not a persistent-transport (SSE/WebSocket) rewrite. Presence is via **lease-on-poll** over the existing HTTP
  request/response plane. (A socket-based presence model is noted as a purer future option, not this change.)

## Capabilities

### New Capabilities
- `connector-session-model`: the connector coordinates bridge serving from clients' declared interests + leases via a
  reconcile loop — replacing the imperative connect/disconnect + single-selection model.

## Impact

- `packages/volt-cli/src/Volt.Cli.Connector.Core/ConnectionManager.cs` (sessions + reconcile), `ControlServer.cs`
  (the session API + a legacy shim), the tray (`TrayContext.cs`, force-off override + derived status).
- `packages/volt-control/src/bridge/*` (`enterWorkspace`/`leaveWorkspace` → interest set; a session sync poll replaces
  the connect/disconnect calls; `boundStatus`/`connectorStatus` read the sync response).
- Supersedes the deferred option A (the counter) in `connection-follows-active-project`.
