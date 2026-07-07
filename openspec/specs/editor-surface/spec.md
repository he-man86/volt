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
(outgoing), `C` (merge conflict), and `RO` (read-only **config kinds** — opaque items such as the library
manager / task configuration / visualization that the AI reads but can't push, identified by item
kind). There is no build-excluded badge: excluded-from-build objects are omitted by the bridge (see
bridge-protocol "The bridge omits build-excluded objects and returns everything else"), so they never
reach the workspace to be badged. The `RO` badge SHALL reflect read-only config kinds only; graphical
POUs are NOT read-only and SHALL NOT be badged `RO`. These colors SHALL be deliberately distinct from the
editor's own git colors.

#### Scenario: An IDE-changed file is badged incoming
- **WHEN** the IDE has changed a file relative to the baseline
- **THEN** that file shows an `i` badge in the explorer, in a color distinct from git's

#### Scenario: A read-only config kind is badged RO
- **WHEN** an item is an opaque read-only config kind (e.g. a library manager or task configuration)
- **THEN** it shows the `RO` badge; a graphical CFC POU does not

### Requirement: One status item aggregates all workspaces

A single status item SHALL aggregate all bound workspaces worst-state-wins (merge in progress >
project mismatch > bridge offline > no project > degraded > `N↑ M↓` drift > in-sync). When the bridge
is offline the item SHALL retarget to a Start-Bridge action that ensures the Connector is running and
starts the configured bridge port; on a project mismatch it SHALL retarget to an Accept-Project-Rename
action.

#### Scenario: Offline retargets to Start Bridge
- **WHEN** the bridge is offline for a bound workspace
- **THEN** the status item shows the offline state and triggers the Start-Bridge action when invoked

#### Scenario: A project mismatch retargets to Accept Rename
- **WHEN** the bound IDE project's name no longer matches the workspace binding
- **THEN** the status item shows the mismatch and triggers the Accept-Project-Rename action when invoked

### Requirement: The git axis is delegated to the editor

History, working-tree edits, local-change discard, and merge-conflict resolution SHALL be delegated
to the editor's built-in Git (VS Code's SCM + merge editor; opencode's review pipeline). Volt owns
only the IDE axis git can't see, and SHALL present it in its **own dedicated area** — never
relocating or re-implementing git's own history/merge/staging. The git axis stays the editor's; Volt
does not absorb, wrap, or replace it.

#### Scenario: A pull conflict is resolved with the editor's own tools
- **WHEN** a pull hits conflicts
- **THEN** Volt opens the files and directs the user to resolve them with the editor's normal merge tools, then pull again

#### Scenario: The git axis stays the editor's; the IDE axis has its own area
- **WHEN** the user views version state
- **THEN** git history/merge/staging remain the editor's native Git UI, and the IDE (Volt) axis is presented in Volt's own dedicated area — Volt neither moves nor re-implements git's UI

### Requirement: Volt has a dedicated area on each editor surface

The editor-side Volt surface SHALL be presented in its **own dedicated area**, not inside the host's
git changes UI. In VS Code this SHALL be an activity-bar **view container** (`viewsContainers`)
holding Volt's views. In the desktop GUI the dedicated area SHALL be delivered by expanding what the
self-owned `VoltIdePanel` renders, mounted via the **single existing** `<VoltIdePanel/>` seam line in
`packages/app/src/pages/session.tsx` — the desktop SHALL NOT add a second `packages/app` seam (no new
nav/activity container), preserving the white-label invariant that the desktop is implementable with
one additive line. The dedicated area SHALL appear when a Volt workspace is detected
(`.git/volt/config.json`).

#### Scenario: VS Code shows a dedicated Volt activity-bar container
- **WHEN** a Volt workspace is bound and the user opens the Volt activity-bar icon
- **THEN** a dedicated Volt view container is shown, holding the IDE Sync, Bridge status, and Reference & Agent views — not a group inside the git Source Control view

#### Scenario: Desktop shows a dedicated Volt area through the single seam
- **WHEN** a Volt workspace is detected in the desktop GUI
- **THEN** `VoltIdePanel` renders a self-contained dedicated Volt surface (IDE Sync + Bridge status + Reference & Agent) through the one existing `session.tsx` seam line, with no additional `packages/app` seam added

### Requirement: The IDE Sync view lives in the dedicated area

The IDE Sync view SHALL present the two drift groups — **Incoming (IDE → pull)** and **Outgoing (push
→ IDE)** — with click-to-diff against the last-synced baseline `refs/remotes/volt/ide` (Incoming diffs
`VOLTIDE↔BRIDGE`, Outgoing diffs `VOLTIDE↔WORKSPACE`), inside the dedicated Volt area. It SHALL NOT
add a custom git history or merge engine.

#### Scenario: Drift groups render in the Volt area
- **WHEN** the IDE has changes relative to the baseline and the user opens the Volt area
- **THEN** the Incoming and Outgoing groups list the drifting items, each opening its baseline diff on click

### Requirement: The dedicated area carries the IDE-sync controls and bridge health

Pull, Push, Force-Pull, Force-Push, and Build SHALL be available in the dedicated Volt area so the
user can act on the IDE, not only read the diff. A bridge-health indicator (connected / degraded /
disconnected / unreachable) SHALL be visible in the area whenever a Volt workspace is bound.

#### Scenario: Controls appear in the Volt area
- **WHEN** the dedicated Volt area is shown for a bound workspace
- **THEN** Pull, Push, and Build actions are available there, and the bridge-health indicator is visible

### Requirement: The dedicated area shows a bridge-status view

The Volt area SHALL include a **Bridge status** view showing connection health, the bound project, and
the port, exposing the Start-Bridge action when the bridge is offline and the Accept-Project-Rename
action on a project mismatch. This surfaces state that previously lived only in the aggregate status
item.

#### Scenario: Offline bridge offers Start Bridge
- **WHEN** the bridge is offline for a bound workspace
- **THEN** the Bridge status view shows the offline state and offers the Start-Bridge action

### Requirement: The dedicated area shows a Reference & Agent view

The Volt area SHALL include a **Reference & Agent** view exposing the CODESYS language-reference entry
and the Open Agent / New Session launchers — actions that previously existed only as palette commands.
On hosts that are themselves the agent (the desktop GUI), the agent launchers MAY be omitted as not
applicable.

#### Scenario: Agent launchers are reachable from the Volt area
- **WHEN** the user opens the Reference & Agent view in VS Code
- **THEN** Open Agent, New Session, and the language-reference entry are available without the command palette

### Requirement: A diagnostics summary jumps to the native Problems panel

The Volt area SHALL show a lightweight **diagnostics summary** derived from the LSP's published
diagnostics (filtered on the LSP's own diagnostic `source`, `volt-lsp-iec`) — a count of errors and
warnings, grouped per file — and SHALL jump to the host's native Problems panel when invoked. The
surface SHALL NOT re-implement a standalone diagnostics tree: the language client already publishes
diagnostics to the native panel, which remains the source of truth.

#### Scenario: Summary reflects LSP diagnostics without opening the IDE
- **WHEN** the LSP has published errors/warnings for the project's ST files
- **THEN** the Volt area shows the per-file error/warning counts, giving the user the errors without opening CODESYS

#### Scenario: Clicking the summary opens the Problems panel
- **WHEN** the user clicks the diagnostics summary
- **THEN** the host's native Problems panel opens — no custom diagnostics tree is rendered

### Requirement: The extension configures the LSP from its declared settings

The VS Code extension's language client SHALL read the configuration keys it declares in the manifest
under the `volt.iec.*` namespace (the IEC LSP's settings — renamed from the legacy
`volt.structuredText.*`, which named the LSP after one language) and forward them to the server. It
SHALL honor the `volt.iec.server` server-path override when resolving the server module, launch the
stdio-only server over the editor's own runtime with the required `--stdio` and vendor flag, and pass
the declared `diagnostics.*` toggles, `vendor`, and `trace` settings into the server
`initializationOptions`. The language id `structured-text` (a real IEC 61131-3 language) SHALL NOT be
renamed.

#### Scenario: The server-path override is honored
- **WHEN** `volt.iec.server` is set to a path
- **THEN** the extension launches that server module instead of the auto-discovered one

#### Scenario: Declared diagnostics settings reach the server
- **WHEN** a `volt.iec.diagnostics.*` toggle or the `vendor` setting is changed
- **THEN** the client forwards the setting to the server via `initializationOptions`, and the client does not read any key the manifest does not declare

