## ADDED Requirements

### Requirement: The volt CLI is the sole bridge-data abstraction

All bridge *data* operations (fetch, push, init, build, status) SHALL flow through the volt CLI (`volt-git`). A frontend package (`volt-vscode`, `volt-desktop`) MUST NOT construct any bridge HTTP call. `volt-control` MUST NOT construct any bridge *data-plane* call; its only sanctioned direct-to-bridge request is the cheap `GET /health` probe, which drives the health indicator, change detection, vendor probing, and init gating.

#### Scenario: no bridge data call outside the CLI

- **WHEN** a frontend performs pull, push, init, build, or status
- **THEN** it invokes the volt CLI via `volt-control`, and neither the shell nor `volt-control` opens a bridge `/fetch`, `/push`, `/init`, `/build`, or `/refs` connection of its own

#### Scenario: health is the only direct bridge read

- **WHEN** the frontend needs live IDE state for its health dot or change detection
- **THEN** the only direct-to-bridge request issued is `GET /health`, and no `/refs` (or other data-plane) polling occurs

### Requirement: One bridge call per action

Each user action SHALL make exactly one heavy bridge call on its normal (non-force, non-dry-run) path. `pull` SHALL derive incoming drift and the up-to-date short-circuit from its single `/fetch` response (no preceding `/refs`). `push` SHALL send its single `/push` — using the sidecar's versions as the concurrency guards — and read the new baseline (`newProjectVersion`/`newItems`/`newFolders`) from the `/push` response, with no preceding guard `/refs` and no following re-read `/refs`. The `/push` accepted response SHALL carry `newFolders` alongside the existing `newProjectVersion`/`newItems`, added as an additive optional field (no wire-version bump), identically on both bridges.

#### Scenario: pull makes one heavy call

- **WHEN** a pull runs against the bridge
- **THEN** exactly one `/fetch` is issued and no `/refs` precedes it

#### Scenario: push makes one heavy call

- **WHEN** a push with changes runs against the bridge on the normal path
- **THEN** exactly one `/push` is issued, its accepted response carries `newProjectVersion`/`newItems`/`newFolders`, and no `/refs` is issued before or after it

#### Scenario: stale push still rejects with pull-first

- **WHEN** the IDE moved since the client's baseline and a non-force push is sent with the stale sidecar guards
- **THEN** the bridge rejects on the version guard and the CLI surfaces the "pull first" outcome, without the client having issued a pre-push `/refs`

#### Scenario: both bridges stay byte-identical on the new field

- **WHEN** the same push is applied on CODESYS and on Beckhoff
- **THEN** both return `newFolders` identically and neither changes the wire version

### Requirement: volt-control owns all sync state and shaping

`volt-control` SHALL be the single source of sync state, drift projection, outcome orchestration, and vendor/port mapping consumed by both frontends. A frontend package (`volt-vscode`, `volt-desktop`) MUST NOT re-derive user-facing state from `StatusJson`, `HealthState`, pull/push outcomes, or vendor/port literals; it may only translate `volt-control`'s neutral models into its native widgets and own its framework lifecycle.

#### Scenario: no StatusJson shaping in a shell

- **WHEN** a frontend renders the incoming/outgoing drift list, the paused state, or the bridge/port line
- **THEN** it consumes a `volt-control` view-model and performs no field-level derivation from `StatusJson` (no A/M/D tagging, no `mismatch‖merging` paused computation, no `src/` prefix stripping) of its own

#### Scenario: single vendor/port source

- **WHEN** any code needs the bridge port for a vendor, or the vendor for a bridge port
- **THEN** it calls one `volt-control` helper, and no vendor↔port literal (`8555`/`8556`) appears in a frontend package

### Requirement: Shared per-workspace drift view-model

`volt-control` SHALL expose a framework-neutral per-workspace view-model derived from a `VoltStatus`, carrying: bound/initialized flags, workspace root, bridge port, health display (label/tone/online), a paused reason that distinguishes project-mismatch from merging (not a bare boolean), and the incoming/outgoing item lists each tagged added/modified/removed with the on-disk-relative path. Both frontends SHALL render this model.

#### Scenario: both shells render identical drift data

- **WHEN** the same `VoltStatus` is projected for the VS Code panel and the desktop panel
- **THEN** both receive the same items, A/M/D tags, paused reason, and port from the shared projection, with only widget construction differing between them

#### Scenario: paused reason drives distinct bridge affordances

- **WHEN** the workspace is paused for a project mismatch versus a merge in progress
- **THEN** the view-model reports the distinct reason so a shell can offer "Accept project rename" for a mismatch and a resolve-in-Git affordance for a merge, without inspecting `StatusJson` itself

### Requirement: Shared outcome orchestration

`volt-control` SHALL expose the pull/push outcome → next-action decision as a neutral descriptor (a user-facing message plus a list of available follow-up actions such as open-conflicts, force-pull, pull-first, force-push). Both frontends SHALL render that descriptor with their native dialogs and MUST NOT re-implement the outcome decision tree.

#### Scenario: pull conflict offers the same actions in both shells

- **WHEN** a pull returns a conflict outcome
- **THEN** `volt-control` yields a descriptor whose actions include opening the conflicts, and both the VS Code and desktop shells present exactly those actions from the descriptor

#### Scenario: push rejection offers pull-first and force

- **WHEN** a push returns a rejected outcome
- **THEN** the shared descriptor lists the pull-first and force-push follow-ups, and neither shell hard-codes that pairing itself

### Requirement: IDE-change detection does not poll the heavy /refs endpoint

Change detection for IDE-side edits SHALL NOT poll the full-project `GET /refs` endpoint on a fixed timer. `volt-control` SHALL drive change detection from the cheap `GET /health` signal so that an idle bound workspace performs no repeated full-project scans on the bridge's IDE thread.

#### Scenario: idle workspace issues no periodic /refs scans

- **WHEN** a workspace is bound and no edits occur
- **THEN** the bridge logs no recurring `refs:` full-scan lines caused by `volt-control` change detection

#### Scenario: an IDE edit still triggers a refresh

- **WHEN** the engineer changes the project in the IDE
- **THEN** `volt-control`'s health-driven detection observes the change signal and triggers exactly one status refresh

#### Scenario: a single health poller drives both health and change detection

- **WHEN** a workspace is bound
- **THEN** one `/health` poll (not a separate change-detection timer and a separate slow health heartbeat) updates the health indicator and detects the change edge, at a cadence that keeps IDE-edit latency comparable to the prior `/refs` poll (not degraded to a multi-tens-of-seconds heartbeat)

### Requirement: init reports live progress to both frontends

`volt-control`'s `init` action SHALL support streamed progress the same way `pull`/`push`/`build` do, and both frontends SHALL surface that progress in their init toast/notification.

#### Scenario: init toast shows phase/percentage

- **WHEN** a user runs init on a large project through either frontend
- **THEN** the init notification advances with the streamed progress frames rather than showing a static spinner
