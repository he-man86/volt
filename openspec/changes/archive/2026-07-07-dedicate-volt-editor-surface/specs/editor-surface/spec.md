## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: The IDE-sync surface is co-located in the host's native changes UI

**Reason**: Reversed by this change. Volt is a product surface in its own right (IDE sync, bridge
health, language reference, agent, LSP diagnostics), not "another kind of git." Co-locating it inside
the host's git changes UI buried the actionable controls and left the growing set of
non-version-control features no home. The IDE-sync surface now lives in a dedicated Volt area (see the
ADDED "Volt has a dedicated area on each editor surface" requirement).

**Migration**: VS Code — the native `SourceControl` group is removed; its incoming/outgoing groups and
Pull/Push/Build actions move to the Volt activity-bar view container's IDE Sync view. Desktop — the
`<VoltIdePanel/>` stays mounted through the single existing `session.tsx` seam line and expands into a
self-contained dedicated surface (no new `packages/app` seam is added). The last-synced-baseline diff refs
(`VOLTIDE↔BRIDGE`, `VOLTIDE↔WORKSPACE`) and the ref content provider are unchanged.

### Requirement: IDE-sync controls accompany the co-located view

**Reason**: The controls no longer accompany a *co-located* view; they now live in the dedicated Volt
area. Superseded by the ADDED "The dedicated area carries the IDE-sync controls and bridge health"
requirement.

**Migration**: Pull / Push / Build and the bridge-health indicator move from the VS Code SCM group
title / desktop panel header to the dedicated Volt area's view title / header.

## ADDED Requirements

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

#### Scenario: Agent launchers are reachable from the Volt area
- **WHEN** the user opens the Reference & Agent view
- **THEN** Open Agent, New Session, and the language-reference entry are available without the command palette

### Requirement: A diagnostics summary jumps to the native Problems panel

The Volt area SHALL show a lightweight **diagnostics summary** derived from the LSP's published
diagnostics — a count of errors and warnings, grouped per file — and SHALL jump to the host's native
Problems panel (pre-filtered to the Volt diagnostics) when invoked. The surface SHALL NOT re-implement
a standalone diagnostics tree: the language client already publishes diagnostics to the native panel,
which remains the source of truth.

#### Scenario: Summary reflects LSP diagnostics without opening the IDE
- **WHEN** the LSP has published errors/warnings for the project's ST files
- **THEN** the Volt area shows the per-file error/warning counts, giving the user the errors without opening CODESYS

#### Scenario: Clicking the summary opens the filtered Problems panel
- **WHEN** the user clicks the diagnostics summary
- **THEN** the host's native Problems panel opens, filtered to the Volt LSP diagnostics — no custom diagnostics tree is rendered

### Requirement: The extension configures the LSP from its declared settings

The VS Code extension's language client SHALL read the configuration keys it declares in the manifest
under the `volt.iec.*` namespace (the IEC LSP's settings — renamed from the legacy
`volt.structuredText.*`, which named the LSP after one language) — not a stale namespace — and forward
them to the server. It SHALL honor the `volt.iec.server` server-path override when resolving the server
module, launch the server over stdio with the required `--stdio` and vendor flag, and pass the declared
`diagnostics.*` toggles, `vendor`, and `trace` settings into the server `initializationOptions`. The
language id `structured-text` (a real IEC 61131-3 language) SHALL NOT be renamed.

#### Scenario: The server-path override is honored
- **WHEN** `volt.iec.server` is set to a path
- **THEN** the extension launches that server module instead of the auto-discovered one

#### Scenario: Declared diagnostics settings reach the server
- **WHEN** a `volt.iec.diagnostics.*` toggle or the `vendor` setting is changed
- **THEN** the client forwards the setting to the server via `initializationOptions`, and the client does not read any key the manifest does not declare

#### Scenario: No legacy structuredText product naming remains
- **WHEN** the app is scanned for the LSP's config/product naming
- **THEN** the `volt.structuredText.*` namespace and `lsp-st` references are gone (renamed to `volt.iec.*` / `volt-lsp-iec`), while the `structured-text` language id and "Structured Text" language labels remain
