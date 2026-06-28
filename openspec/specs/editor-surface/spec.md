# editor-surface Specification

## Purpose
TBD - created by archiving change expand-editor-surface. Update Purpose after archive.
## Requirements
### Requirement: One shared control core, two renderers

The UI-agnostic CLI/bridge driver (`volt-control`) SHALL be the single core that spawns the `volt`
CLI, parses its outcomes, and polls bridge health. Both `volt-vscode` (VS Code views) and
`volt-app` (the desktop Solid panel) SHALL render that one core; the CLI-driving logic SHALL NOT be
reimplemented per surface. The AI agent does not use this core — it spawns the CLI directly.

#### Scenario: Both surfaces use the same core
- **WHEN** the VS Code view and the desktop panel both show sync status
- **THEN** each is rendering `volt-control`, not a per-surface reimplementation

### Requirement: A bound workspace is detected by its config

The editor surface SHALL treat a workspace folder containing `.git/volt/config.json` as a live
Volt workspace (`hasVoltConfig`) and light up the sync view, the status item, and file
decorations without a reload. Activation SHALL trigger on startup, on opening a registered PLC
language, or on a workspace that contains matching PLC files.

#### Scenario: Opening a bound folder activates the surface
- **WHEN** a folder containing `.git/volt/config.json` is opened
- **THEN** the Volt view, status item, and decorations activate without a reload

### Requirement: The surface shows live bridge health and drift

The surface SHALL show a bridge **health** row (connected / degraded / disconnected / unreachable)
and two drift groups — **Incoming (IDE → pull)** and **Outgoing (push → IDE)** — kept fresh by a
periodic health probe and a state poll. On a probe error it SHALL retain the last good status and
surface the message rather than blanking. It SHALL NOT add a custom git history or merge engine.

#### Scenario: A probe error keeps the last good status
- **WHEN** a health probe fails transiently
- **THEN** the surface keeps showing the last good status with the error surfaced, not an empty view

### Requirement: The two diffs are defined against the last-synced baseline

Each drift item SHALL be a diff against the last-synced baseline ref `refs/remotes/volt/ide`
(`VOLTIDE`): **Incoming** diffs `VOLTIDE ↔ BRIDGE` (baseline vs. the live IDE — what a pull
brings), **Outgoing** diffs `VOLTIDE ↔ WORKSPACE` (baseline vs. the working file — what a push sends).

#### Scenario: Incoming and outgoing use the defined refs
- **WHEN** a user opens a drift item's diff
- **THEN** an incoming item compares `VOLTIDE↔BRIDGE` and an outgoing item compares `VOLTIDE↔WORKSPACE`

### Requirement: Diff content is served by a ref content provider

Every diff SHALL be backed by a content provider that materializes a given ref's version of a file
via `volt show <ref> <path>`. An absent file at that ref SHALL render as empty so adds and deletes
diff cleanly.

#### Scenario: An added file diffs against an empty baseline
- **WHEN** a file exists in the working tree but not at `VOLTIDE`
- **THEN** the baseline side of the diff renders empty rather than erroring

### Requirement: Drift is decorated in the file explorer

The surface SHALL badge changed files in the editor's file explorer: `i` (incoming), `o`
(outgoing), `C` (merge conflict), and `RO` (read-only kinds — graphical/config files the AI reads
but can't push). These colors SHALL be deliberately distinct from the editor's own git colors.

#### Scenario: An IDE-changed file is badged incoming
- **WHEN** the IDE has changed a file relative to the baseline
- **THEN** that file shows an `i` badge in the explorer, in a color distinct from git's

### Requirement: One status item aggregates all workspaces

A single status item SHALL aggregate all bound workspaces worst-state-wins (merge in progress >
bridge offline > no project > degraded > `N↑ M↓` drift > in-sync). When the bridge is offline the
item SHALL retarget to a Start-Bridge action that ensures the Connector is running and starts the
configured bridge port.

#### Scenario: Offline retargets to Start Bridge
- **WHEN** the bridge is offline for a bound workspace
- **THEN** the status item shows the offline state and triggers the Start-Bridge action when invoked

### Requirement: The git axis is delegated to the editor

History, working-tree edits, local-change discard, and merge-conflict resolution SHALL be delegated
to the editor's built-in Git (VS Code's SCM + merge editor; opencode's Review tab). Volt owns only
the IDE axis git can't see.

#### Scenario: A pull conflict is resolved with the editor's own tools
- **WHEN** a pull hits conflicts
- **THEN** Volt opens the files and directs the user to resolve them with the editor's normal merge tools, then pull again

