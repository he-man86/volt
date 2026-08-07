## ADDED Requirements

### Requirement: Interest resumes a bridge; the last leaver gates it; untouched bridges keep their default

A bridge serves by default (a loaded IDE host serves its project). The reconcile loop SHALL therefore be asymmetric:
bind is level-triggered — any WANTED project not currently serving is resumed — while unbind is edge-triggered — a
project is gated only when it was being served on a client's behalf and the LAST session declaring interest in it has
left (the wanted→unwanted edge), or when the tray force-offs it. `wanted = ⋃ interests over non-expired sessions \
forceOff`, resolved to detected projects. A project no session has ever declared MUST NOT be gated by the loop — it
keeps its default serving state, so standalone `volt push` and an un-connected neighbour are never cut off.

#### Scenario: Two clients on the same project; one leaves

- **WHEN** two sessions both declare interest in project X, and one of them stops declaring X (navigated away / closed)
- **THEN** X remains served, because the other session still declares interest in it

#### Scenario: Last client on a project leaves

- **WHEN** the only session declaring interest in X stops declaring it (empty sync, close, or lease expiry)
- **THEN** the connector unbinds X's bridge (X stops serving)

#### Scenario: A bridge no session ever declared

- **WHEN** a project's host is serving by default and no session has ever declared interest in it (e.g. another project
  is connected, or only a terminal `volt push` uses it)
- **THEN** the loop leaves it serving — it is never gated merely for being un-declared

#### Scenario: Different projects in different clients

- **WHEN** one session declares interest in X and another in Y (different hosts)
- **THEN** both X and Y are served, independently

### Requirement: Interest is the workspace binding identity, resolved connector-side

Interest SHALL be expressed as the workspace's `{vendor, projectName}` binding identity, and the connector MUST
resolve it to the currently-detected project every reconcile. It does NOT disambiguate same-name projects — that
collapse is inherited from the existing identity model and is out of scope.

#### Scenario: Interest declared before the IDE is open

- **WHEN** a session declares interest in `{codesys, MyMachine}` while CODESYS is not yet running
- **THEN** the connector binds MyMachine the moment it is detected, without the client needing to re-resolve or
  re-declare

#### Scenario: The IDE restarts under an active interest

- **WHEN** a session holds interest in `{codesys, MyMachine}` and the IDE is restarted
- **THEN** the reconciler re-resolves the interest to the re-detected project and re-binds its bridge, with no action
  required from the client beyond its normal sync

### Requirement: Presence via leases — going away is self-cleaning

Each session SHALL hold a lease renewed on every sync, with a TTL of a small multiple of the poll interval. A session
whose lease lapses MUST have its interests dropped from `desired`. No explicit disconnect is required for correctness.

#### Scenario: A client crashes

- **WHEN** a session stops renewing its lease (the client crashed) without sending `DELETE /session`
- **THEN** after the TTL its interests drop out and the connector unbinds any project no other session still wants

#### Scenario: Clean shutdown is immediate

- **WHEN** a client sends `DELETE /session/{id}` on shutdown
- **THEN** its interests drop immediately rather than after the TTL

### Requirement: Declaration is idempotent; the sync poll carries it

The connector's client-facing API SHALL be declarative: a session declares its FULL current interest set on each
`POST /session/{id}/sync`, which also renews the lease and returns the live `ConnectorView` in one round-trip.
Re-declaring the same set MUST be a no-op. There MUST be no add/remove delta, count, or ordering the client has to
maintain.

#### Scenario: Re-declaring the same interests

- **WHEN** a session sends the same `interests` set on consecutive syncs
- **THEN** nothing changes except the renewed lease

### Requirement: Reconciliation respects the one-project-per-host bridge limit and does not flap on restart

The reconciler MUST NOT attempt to make one host serve two projects at once (a bridge limit): for a host that can
serve only one project (e.g. a TwinCAT XAE worker), a wanted project already serving there holds it and wanted
siblings stay `idle` — no thrash, and no special most-recently-declared bookkeeping. On connector restart it MUST NOT
unbind serving projects; because unbind is edge-triggered and `previouslyWanted` is empty after a restart, there are
no leave-edges to act on, so serving projects are left alone while clients re-declare. Binds are never delayed.

#### Scenario: Connector restarts while projects are serving

- **WHEN** the connector restarts and the IDE hosts are still serving their projects, before any client has re-synced
- **THEN** the connector does not unbind any of them (no leave-edges exist yet); as clients re-sync, still-wanted
  projects simply stay serving

#### Scenario: Two projects contend for one worker

- **WHEN** two projects that share one TwinCAT worker are both wanted
- **THEN** the worker serves one and the other is reported `idle`, without error or oscillation

### Requirement: Manual controls fit the multi-client model

A frontend's Disconnect SHALL drop that project from its OWN interests (un-serving it only if no other live session
wants it), not force the bridge off for everyone. The tray's Disconnect SHALL set a connector-held force-off for a
project that keeps it unbound regardless of interests until cleared — the supervisor override.

#### Scenario: One window disconnects a shared project

- **WHEN** a VS Code window clicks Disconnect on a project the desktop is also using
- **THEN** the window stops seeing it as connected but the project keeps serving (the desktop still wants it)

#### Scenario: The tray force-disconnects a stuck bridge

- **WHEN** the tray Disconnect is used on a project
- **THEN** the connector keeps that project unbound regardless of any session's interest until the force-off is cleared

### Requirement: The session API is the only control surface — no legacy connect/disconnect

The control plane SHALL expose only the session API (`POST /session`, `POST /session/{id}/sync`, `DELETE /session/{id}`)
to drive serving, plus `GET /status` as the ambient detected-list read and `POST /workers/{id}/restart`. There SHALL
be no `POST /connect` / `POST /disconnect`, no implicit legacy session, no single-owner highlight, and no client-side
fallback. (The connector and frontends are all Volt's own and auto-update together; the transient version-skew window
is accepted rather than carried as a permanent second control plane.)

#### Scenario: An imperative connect is not a route

- **WHEN** any client `POST`s to `/connect` or `/disconnect`
- **THEN** the connector answers 404 — the only way to make a project serve is to declare interest in it via a session
