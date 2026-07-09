# bridge-connector Specification

## Purpose

The Volt Bridge Connector is the single system-tray application that owns every vendor bridge. It presents
one icon, one context menu, and one log window regardless of how many vendors are active. Bridges run as
headless worker processes (ExternalAttach, e.g. TwinCAT) or as in-IDE loads (InIdeLoad, e.g. CODESYS).
The connector is vendor-agnostic — it speaks only the HTTP wire to its workers and discovers IDE instances
through the per-vendor health endpoints.

## Requirements

### Requirement: The connector never attaches to a project the user did not choose

For an ExternalAttach vendor (TwinCAT), the connector's worker SHALL attach only to a target the user (or a test
harness) has explicitly selected. When no target is set, the worker SHALL start in a `no-project` degraded state
and SHALL NOT attach to an arbitrary running instance or project. The user selects a target through the tray menu
or the control-plane select route. An explicit target MAY be forced non-interactively via environment variables
(`VOLT_TC_INSTANCE` / `VOLT_TC_PROJECT` / `VOLT_TC_PLC`) or the control-plane select route, for tests and dev.
The in-proc (InIdeLoad) vendor is unaffected — it attaches to the IDE it is loaded into.

#### Scenario: No selection means no attach
- **WHEN** the TwinCAT worker starts and no target has been selected (no env, no prior selection)
- **THEN** it does not attach to any instance/project and reports the `no-project` state (aggregate icon orange)

#### Scenario: An explicit selection attaches
- **WHEN** the user picks an instance/project, or a target is forced via env / the control-plane select route
- **THEN** the worker attaches to exactly that instance/project and to no other

#### Scenario: Two open solutions do not cause an arbitrary bind
- **WHEN** two TwinCAT solutions are open and no target is selected
- **THEN** the worker stays unattached (it does not silently bind whichever the running-object table lists first)

### Requirement: The connector has no per-vendor enable toggle; the icon reflects only active-vendor faults

The connector SHALL NOT expose a per-vendor "enable/disable" control. The aggregate tray icon SHALL treat a
vendor with no IDE present or no project selected as **not-applicable** (neutral), and SHALL show a fault color
only for a genuine fault of an *active* vendor (an IDE is present / a project is selected but the bridge is
unreachable or unavailable).

#### Scenario: An unused vendor does not raise a fault color
- **WHEN** a vendor has no IDE running (nothing to attach to / launch)
- **THEN** it contributes a neutral state to the aggregate icon, not a fault color

#### Scenario: An active vendor's fault is shown
- **WHEN** a vendor has an IDE present / a project selected but its bridge is unreachable or unavailable
- **THEN** the aggregate icon shows the corresponding fault color

### Requirement: The tray menu shows active project names

The connector SHALL health-poll every vendor bridge every 4 seconds. When a bridge reports a connected project,
the tray menu label SHALL include the project name and PLC project name (e.g. "connected — MySolution / PLC1").
A `*` suffix SHALL indicate unsaved IDE changes (`projectDirty`). This applies to both ExternalAttach and
InIdeLoad vendors — when the CODESYS user runs "Start Volt Bridge" from the IDE's Tools menu, the tray picks
up the running bridge on the next poll and displays the project name.

#### Scenario: TwinCAT project name shown
- **WHEN** the TwinCAT worker attaches to a project via the tray picker
- **THEN** the tray menu item reads "TwinCAT — connected — MySolution / PLC1" (with `*` if dirty)

#### Scenario: CODESYS project name shown after manual script start
- **WHEN** the user opens CODESYS normally and runs Tools → Scripting → Start Volt Bridge
- **THEN** the tray picks up the bridge on the next health poll and shows the current project name

### Requirement: Neither the data plane nor the control plane is reachable from a browser origin

Both of Volt's local HTTP surfaces SHALL be usable only by local first-party clients (the CLI via `node:http`,
the LSP, Node/Electron) — the per-vendor bridge data plane and the connector control plane. Neither SHALL emit
a permissive `Access-Control-Allow-Origin` header, and both SHALL reject any request that carries a cross-origin
`Origin` header.

#### Scenario: A browser cannot inject PLC items via the data plane
- **WHEN** a `/push` request to a bridge data-plane port carries an `Origin` header
- **THEN** the bridge rejects it and creates no item

#### Scenario: A cross-origin browser request to the control plane is rejected
- **WHEN** a request to the control plane carries an `Origin` header
- **THEN** the control plane rejects it rather than launching or restarting anything

#### Scenario: A first-party local client succeeds
- **WHEN** a CLI/LSP/Node/Electron client on localhost calls either plane with no browser `Origin`
- **THEN** the request is served normally

### Requirement: All Volt bridge components log to one durable, rotated location through a shared seam

Every Volt bridge component SHALL write leveled, timestamped log lines to a single durable location that
survives a reboot (`%LOCALAPPDATA%\Volt\logs`) — the connector, each vendor worker, the in-proc bridge, and
the CLI where practical. Log files SHALL be rotated (per-source daily files) and pruned after a bounded
retention (14 days). Bridge Core SHALL emit its log points through a single `VoltLog` abstraction so both
vendors produce identical log output (**parity**); the concrete file sink is chosen per host, so the abstraction
remains safe to load inside the in-process (net48) IDE host.

`VoltLog` SHALL support configurable minimum level (`Debug`, `Info`, `Warn`, `Error`) defaulting to `Info`.
Lines below the configured level are suppressed.

#### Scenario: A worker crash is captured durably with context
- **WHEN** a vendor worker writes an error or crashes
- **THEN** the line is written to the shared durable log location with a timestamp, source, and level

#### Scenario: Both vendors log identically
- **WHEN** the same Core code path runs under CODESYS and under TwinCAT
- **THEN** the emitted log lines are identical in shape (same seam), differing only in the source tag

#### Scenario: Logs do not grow without bound
- **WHEN** the bridge has run for many days
- **THEN** old log files are pruned past the retention window and current files are rotated

### Requirement: Operational events are logged at the bridge boundary

Every data-plane operation (push, fetch, build) and every lifecycle event (worker start/stop/crash, COM
attach/detach, IDE launch) SHALL produce a log line at `Info` level. Each operation line SHALL include
the operation type, outcome, item count, and wall-clock duration. Lifecycle events SHALL include relevant
identifiers (process ID, IDE version, project name).

#### Scenario: A push is logged with outcome and timing
- **WHEN** the user pushes 15 items that are accepted
- **THEN** `push 15 ops — accepted (98 items) (1.2s)` appears in the log

#### Scenario: A rejected push is logged with conflict details
- **WHEN** the user pushes items that have version conflicts
- **THEN** `push 10 ops — REJECTED (2 conflicts: Motor1, Sensor2) (0.3s)` appears in the log

#### Scenario: A worker crash is logged
- **WHEN** a worker process exits unexpectedly
- **THEN** `worker twincat crashed (exit 1) — restarting` appears in the log at `Warn` level

#### Scenario: COM attach is logged
- **WHEN** the TwinCAT worker successfully attaches to a running IDE
- **THEN** `attached to TwinCAT 4.1.2.3 — MySolution / PLC1` appears in the log

### Requirement: The connector provides its own log window

The connector SHALL surface the logs in a window it owns (opened from the tray), NOT through a separate renderer
layer. The window SHALL show a live tail filterable by source and severity, support search, copy-selected-rows
via Ctrl+C, select-all via Ctrl+A, and color lines consistently with the tray status palette. The window SHALL
preserve row selection across auto-refresh cycles when the underlying log content has not changed.

#### Scenario: The connector's log window tails and filters logs
- **WHEN** a user opens the log window from the tray
- **THEN** it shows live log lines filterable by source and severity, colored consistently with the tray status
  palette, and supports Ctrl+A/Ctrl+C for selection and copy
