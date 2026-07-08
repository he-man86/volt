## ADDED Requirements

### Requirement: The connector never attaches to a project the user did not choose

For an ExternalAttach vendor (TwinCAT), the connector's worker SHALL attach only to a target the user (or a test
harness) has explicitly selected. When no target is set, the worker SHALL start in a `no-project` degraded state
and SHALL NOT attach to an arbitrary running instance or project. The user selects a target through the tray
"Connect to" submenu or the control-plane select route. An explicit target MAY be forced non-interactively via
environment variables (`VOLT_TC_INSTANCE` / `VOLT_TC_PROJECT` / `VOLT_TC_PLC`) or the control-plane select route,
for tests and dev. The in-proc (InIdeLoad) vendor is unaffected — it attaches to the IDE it is loaded into.

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

The connector SHALL NOT expose a per-vendor "enable/disable" control. A worker's lifecycle is start / stop /
restart. The aggregate tray icon SHALL treat a vendor with no IDE present or no project selected as
**not-applicable** (neutral), and SHALL show a fault color only for a genuine fault of an *active* vendor (an
IDE is present / a project is selected but the bridge is unreachable or unavailable).

#### Scenario: An unused vendor does not raise a fault color
- **WHEN** a vendor has no IDE running (nothing to attach to / launch)
- **THEN** it contributes a neutral state to the aggregate icon, not a fault color

#### Scenario: An active vendor's fault is shown
- **WHEN** a vendor has an IDE present / a project selected but its bridge is unreachable or unavailable
- **THEN** the aggregate icon shows the corresponding fault color

### Requirement: Neither the data plane nor the control plane is reachable from a browser origin

Both of Volt's local HTTP surfaces SHALL be usable only by local first-party clients (the CLI via `node:http`,
the LSP, Node/Electron) — the per-vendor bridge data plane (`/refs`, `/fetch`, `/push`, `/build`) and the
connector control plane (launch/restart/select). Neither SHALL emit a permissive `Access-Control-Allow-Origin`
header, and both SHALL reject any request that carries a cross-origin `Origin` header, so a web page loaded in a
browser on the same machine cannot invoke a state-changing route — in particular it cannot POST `/push` to inject
items into the live PLC project, nor launch/restart a bridge. The guard SHALL be shared (Core-level for the data
plane, so both vendors behave identically).

#### Scenario: A browser cannot inject PLC items via the data plane
- **WHEN** a `/push` request to a bridge data-plane port carries an `Origin` header (a browser cross-origin call,
  including a `text/plain` "simple request")
- **THEN** the bridge rejects it and creates no item

#### Scenario: A cross-origin browser request to the control plane is rejected
- **WHEN** a request to the control plane carries an `Origin` header
- **THEN** the control plane rejects it rather than launching or restarting anything

#### Scenario: A first-party local client succeeds
- **WHEN** a CLI/LSP/Node/Electron client on localhost calls either plane with no browser `Origin`
- **THEN** the request is served normally
