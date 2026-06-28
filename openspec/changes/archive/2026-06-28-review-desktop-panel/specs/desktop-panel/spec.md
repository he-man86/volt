## ADDED Requirements

### Requirement: One shared control core, two renderers

The UI-agnostic CLI/bridge driver (`volt-control`) SHALL be the single core that spawns the `volt`
CLI, parses its outcomes, and polls bridge health. Both `volt-vscode` (VS Code views) and
`volt-app` (the desktop Solid panel) SHALL render that one core; the CLI-driving logic SHALL NOT be
reimplemented per surface. The AI agent does not use this core — it spawns the CLI directly.

#### Scenario: Both surfaces use the same core
- **WHEN** the VS Code view and the desktop panel both show sync status
- **THEN** each is rendering `volt-control`, not a per-surface reimplementation

### Requirement: The panel is a thin IDE-sync surface

The Volt panel/view SHALL show only what git cannot see: a bridge **health** row and two drift
groups — **Incoming (IDE → pull)** and **Outgoing (push → IDE)**. It SHALL NOT add a custom git
history or merge engine.

#### Scenario: The surface shows health + the two drift groups
- **WHEN** a bound workspace is open and the bridge is reachable
- **THEN** the view shows a health row plus Incoming and Outgoing drift groups

### Requirement: The two diffs are defined against the last-synced baseline

Each drift item SHALL be a diff against the last-synced baseline ref `refs/remotes/volt/ide`
(`VOLTIDE`): **Incoming** diffs `VOLTIDE ↔ BRIDGE` (baseline vs. the live IDE — what a pull brings),
**Outgoing** diffs `VOLTIDE ↔ WORKSPACE` (baseline vs. the working file — what a push sends).

#### Scenario: Incoming and outgoing use the defined refs
- **WHEN** a user opens a drift item's diff
- **THEN** an incoming item compares `VOLTIDE↔BRIDGE` and an outgoing item compares `VOLTIDE↔WORKSPACE`

### Requirement: The git axis is delegated to the editor

History, working-tree edits, local-change discard, and merge-conflict resolution SHALL be delegated
to the editor's built-in Git (VS Code's SCM + merge editor; opencode's Review tab). Volt owns only
the IDE axis git can't see.

#### Scenario: A pull conflict is resolved with the editor's own tools
- **WHEN** a pull hits conflicts
- **THEN** Volt opens the files and directs the user to resolve them with the editor's normal merge tools, then pull again
