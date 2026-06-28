## ADDED Requirements

### Requirement: The IDE-sync surface is co-located in the host's native changes UI

The editor-side IDE-sync surface SHALL be presented inside the host editor's native
changes/source-control UI, not as a separate panel, tab, or activity-bar view. In VS Code it SHALL
be a full native `SourceControl` provider group rendered beside Git in the Source Control view. In
the desktop GUI it SHALL be a selectable "IDE" source in the existing session changes selector,
rendering IDE drift through the same diff/review pipeline as the other sources. The user SHALL NOT
have to switch to a separate icon or tab to see or act on IDE drift.

#### Scenario: VS Code shows the IDE group beside Git
- **WHEN** the user opens the Source Control view
- **THEN** a Volt IDE-sync group appears alongside Git, with its own incoming/outgoing items

#### Scenario: Desktop offers IDE as a changes source
- **WHEN** the user opens the session changes selector
- **THEN** an "IDE" source is offered that renders IDE drift through the standard review pipeline

### Requirement: IDE-sync controls accompany the co-located view

Pull, Push, and Build SHALL be available wherever the IDE-sync view is presented — when the IDE
group/source is active — so the user can act on the IDE, not only read the diff. A bridge-health
indicator SHALL remain visible alongside the changes selector regardless of which source is selected.

#### Scenario: Controls appear with the IDE source
- **WHEN** the IDE group (VS Code) or the "IDE" source (desktop) is active
- **THEN** Pull, Push, and Build actions are available in that context

#### Scenario: Health is visible independent of source
- **WHEN** any changes source is selected
- **THEN** the bridge-health indicator is visible by the changes selector

## MODIFIED Requirements

### Requirement: The git axis is delegated to the editor

History, working-tree edits, local-change discard, and merge-conflict resolution SHALL be delegated
to the editor's built-in Git (VS Code's SCM + merge editor; opencode's review pipeline). Volt owns
only the IDE axis git can't see. The IDE-sync surface SHALL sit **alongside** that native git UI in
the same panel/selector — presenting the IDE axis as a peer of git, never relocating or
re-implementing git's own history/merge/staging.

#### Scenario: A pull conflict is resolved with the editor's own tools
- **WHEN** a pull hits conflicts
- **THEN** Volt opens the files and directs the user to resolve them with the editor's normal merge tools, then pull again

#### Scenario: The IDE axis sits beside git, not in a separate location
- **WHEN** the user views version state
- **THEN** the git axis and the IDE axis are both reachable in the host's native changes UI, without a separate Volt panel
