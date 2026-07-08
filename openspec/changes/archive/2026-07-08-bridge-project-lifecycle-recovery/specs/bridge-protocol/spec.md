## ADDED Requirements

### Requirement: The bridge recovers across project close/reopen and never reports a stale project as connected

The bridge's connection state SHALL track the currently-open project, not merely the IDE process. Liveness SHALL
be project-aware: when the IDE is running but the bound project has been closed, the bridge SHALL report the
`no-project` state and SHALL NOT report `connected` (nor a stale project name). When a project is reopened or the
user switches to the selected target while the IDE stays alive, the bridge SHALL re-resolve the project and
reconnect **without requiring the IDE to restart**. An IDE that is momentarily busy (mid-build, modal, reload)
SHALL surface as degraded-retry, distinct from both "connected" and a hard failure, so clients do not read
half-state. Both vendor bridges SHALL behave equivalently.

#### Scenario: A closed project is not reported as connected
- **WHEN** the IDE stays open but the bound project is closed
- **THEN** `/health` reports `no-project` (or degraded), never `connected` with the old project name

#### Scenario: Reopening a project reconnects without an IDE restart
- **WHEN** the user reopens the project (or switches to the selected target) with the IDE still running
- **THEN** the bridge re-resolves the project and returns to `connected` on its own, no IDE restart needed

#### Scenario: A busy IDE is degraded-retry, not a false connected
- **WHEN** the IDE is momentarily busy (a build, a modal dialog, a project reload)
- **THEN** the bridge reports degraded-retry and does not serve half-state to a pull/push

#### Scenario: Both vendors recover equivalently
- **WHEN** a close/reopen cycle runs against the CODESYS and the TwinCAT bridge
- **THEN** both recover to the correct attached project
