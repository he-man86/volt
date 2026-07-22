## ADDED Requirements

### Requirement: Shared sync-view mode

The system SHALL derive a single `mode` for each bound workspace in the shared `@volt/control` layer, and both frontends (VS Code extension and desktop) SHALL render from that `mode` rather than re-deriving their own connect/health branching. The mode values are `unbound`, `init`, `offline`, `merging`, `mismatch`, and `ready`, with precedence `merging` > `mismatch` > `offline` > `ready`.

#### Scenario: Not initialized

- **WHEN** a workspace folder has no Volt binding (not initialized)
- **THEN** `mode` is `init` when a PLC project is open/detected, else `unbound`

#### Scenario: Initialized and online with no local git state

- **WHEN** a workspace is initialized, its bridge is online, and no merge or project mismatch is in progress
- **THEN** `mode` is `ready`

#### Scenario: Initialized but offline

- **WHEN** a workspace is initialized but its bridge is not online
- **THEN** `mode` is `offline`

#### Scenario: Merge or mismatch outranks offline

- **WHEN** a merge is in progress or the IDE's project name mismatches the binding
- **THEN** `mode` is `merging` or `mismatch` respectively, even if the bridge is also offline

### Requirement: Actions gated on bridge online

The system SHALL NOT present or dispatch pull, push, or build while the bridge is not online. These actions SHALL be available only in `ready` mode. Merge-resolution actions (finish/abort/take-side) remain available in `merging` mode because they operate on local git state.

#### Scenario: Offline hides mutating actions

- **WHEN** the sync view renders in `offline` mode
- **THEN** no pull, push, or build affordance is shown, and invoking them is not possible from the sync view

#### Scenario: Online restores the action row

- **WHEN** the sync view renders in `ready` mode
- **THEN** the action row shows pull, push, build, and refresh

### Requirement: Single Connect surface in the init location

The system SHALL offer exactly one primary Connect affordance for an initialized-but-offline workspace, rendered in the same location and style as the Init affordance (the sync-view body). The system SHALL NOT show a persistent small connect icon, and SHALL NOT show a Disconnect button in either frontend.

#### Scenario: Offline shows the big Connect button

- **WHEN** the sync view renders in `offline` mode
- **THEN** a single primary Connect button appears in the sync-view body, in the same location/style as the Init button

#### Scenario: No Disconnect button

- **WHEN** the sync view renders in any mode
- **THEN** no Disconnect button is shown in either frontend

#### Scenario: No persistent small connect icon

- **WHEN** the sync view renders in `ready` mode
- **THEN** the action row contains no connect or disconnect icon

### Requirement: Honest health aggregate

The cross-workspace health aggregate SHALL treat the pre-probe `unknown` health kind as not-connected, so no surface reports "connected"/"in sync" before a bridge probe has returned, and the offline/Connect affordance renders during the probing window instead of a blank view.

#### Scenario: Probing does not read as connected

- **WHEN** a workspace's health is `unknown` (no probe has returned yet)
- **THEN** the aggregate severity is not `insync`, and no surface labels the state "Connected and in sync with the IDE"

#### Scenario: Probing shows the offline/connect affordance

- **WHEN** a workspace is initialized and its health is `unknown`
- **THEN** the offline context is active so the Connect affordance renders (the sync view is not blank)

### Requirement: Consistent loading indicators

Every bridge action in a given frontend SHALL surface the same loading indicator as its peers in that frontend; no bridge action is left with no feedback. In the VS Code extension this is `ProgressLocation.Notification`; in the desktop this is the shared `busy` progress note.

#### Scenario: Extension actions all use the notification toast

- **WHEN** the user invokes any bridge action in the extension (pull, push, build, connect, status, refresh, merge resolution)
- **THEN** a `ProgressLocation.Notification` progress indicator is shown while it runs

#### Scenario: No action without feedback

- **WHEN** the user invokes a bridge action that performs a round-trip
- **THEN** a loading indicator is shown for its full duration

### Requirement: No stray onboarding or status artifacts

The VS Code extension SHALL NOT present the "Download Volt" onboarding link, and SHALL NOT contribute a status-bar item. Volt's ambient presence is the activity-bar container and its views; connectivity is surfaced in the sync/bridge views, not a status-bar section that can show a stale "connected" label.

#### Scenario: No Download Volt link

- **WHEN** a folder is not an initialized Volt workspace and the connector is not running
- **THEN** the sync view's welcome does not show a "Download Volt" link

#### Scenario: No status-bar item

- **WHEN** the extension is active with a bound workspace in any state
- **THEN** no Volt status-bar item is shown

### Requirement: Outgoing changes are auto-detected

The system SHALL detect a workspace source-file change as an outgoing change without a manual refresh, regardless of how the change was made (the AI agent's tools, a terminal, git, an external editor) and in both frontends. Detection SHALL NOT depend solely on the editor's save event.

#### Scenario: Non-editor edit is detected

- **WHEN** a tracked source file under the workspace `src/` tree changes by any means
- **THEN** the tracker refreshes and the change appears as outgoing within a short debounce, without the user pressing refresh

#### Scenario: Non-source files are ignored

- **WHEN** a non-source file (e.g. a README) changes under `src/`
- **THEN** no refresh is triggered by that change

### Requirement: Diff compare renders an absent side as empty

When one side of a compare is an item that does not exist at that ref (an added or removed item), the system SHALL render that side as an empty pane, not as an error message. `volt show` SHALL signal this absent case distinctly (exit code 2) from a genuine error (exit code 1).

#### Scenario: Added incoming item shows a blank left pane

- **WHEN** the incoming diff of an item that is not in the repo's last commit is opened (`HEAD` side)
- **THEN** the `HEAD` pane is empty (not "volt show failed: … not found at HEAD"), and the live-IDE pane shows the new content

#### Scenario: Genuine error still surfaces

- **WHEN** `volt show` is asked for a path that maps to no item
- **THEN** it exits non-2 (error), and the pane shows the error rather than silently blanking

### Requirement: Connector wire contracts are pinned

The system SHALL guard the connector's hand-mirrored wire contracts (`instances` result, `select` request, and `health` status vocabulary) against the authoritative `Volt.Engine.Wire` definitions with an automated round-trip test, so a bridge-side rename cannot silently degrade the connector.

#### Scenario: Round-trip parity

- **WHEN** the bridge serializes an `instances` result and a `health` response using `Volt.Engine.Wire`
- **THEN** the connector's parser reproduces every field the connector relies on, and a mismatch fails the test
