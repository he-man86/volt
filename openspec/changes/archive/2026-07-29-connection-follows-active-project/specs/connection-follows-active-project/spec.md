## ADDED Requirements

### Requirement: The bridge connection follows the active project view

The bridge connection SHALL be driven by which project a frontend is actively showing: when a project becomes the
active one, the frontend connects its bridge; when it stops being active, the frontend disconnects. This lifecycle
MUST be implemented once in `@volt/control` (`enterWorkspace` / `leaveWorkspace`) and shared by both frontends — only
the "became active / inactive" trigger differs per frontend.

#### Scenario: Navigating to a project connects

- **WHEN** the desktop binds a project (opencode navigated to it) or the VS Code extension activates for an open
  workspace folder
- **THEN** the frontend calls `enterWorkspace(root)`, connecting the bridge to that workspace's bound project

#### Scenario: Leaving a project disconnects (desktop)

- **WHEN** the desktop releases its binding because opencode navigated to its home route
- **THEN** the frontend calls `leaveWorkspace(root)`, disconnecting that workspace's project from the bridge

#### Scenario: Closing the editor disconnects (VS Code)

- **WHEN** the VS Code extension deactivates (window closed)
- **THEN** it calls `leaveWorkspace(root)` for each bound workspace, and the disconnect is folded into the returned
  thenable so the editor waits for it (as it already does for the LSP shutdown)

### Requirement: The lifecycle logic is shared, the disconnect combo is deduped

`enterWorkspace` and `leaveWorkspace` SHALL live in `@volt/control` and wrap the existing primitives (`reconnectBound`
for connect; `boundProjectId` + `disconnect` for disconnect). Both frontends' manual disconnect paths and the
desktop's app-quit disconnect MUST call `leaveWorkspace` rather than inlining `disconnect(await boundProjectId(root))`.

#### Scenario: Both frontends and the manual paths use one implementation

- **WHEN** a disconnect happens — via leaving a project, closing the editor, app quit, or the manual Disconnect button
- **THEN** it goes through `leaveWorkspace(root)`, so there is a single implementation of "disconnect THIS workspace's
  bound project (not the tray's active one)"

#### Scenario: Safe on an unbound or undetected workspace

- **WHEN** `leaveWorkspace(root)` is called for a workspace that is unbound, or whose project the connector doesn't
  currently detect
- **THEN** it disconnects nothing and does not throw (a missing bound project id means there is nothing to disconnect)

### Requirement: Manual Connect/Disconnect remain as an override

The manual Connect and Disconnect affordances SHALL remain available and MUST call the same
`enterWorkspace`/`leaveWorkspace`. They serve as an override — reconnecting after the IDE bridge dropped without
re-navigating, or pausing sync for a project while staying on it.

#### Scenario: Reconnect after the bridge dropped

- **WHEN** the IDE was restarted so the bridge dropped, while the frontend is still showing that project
- **THEN** the manual Connect action calls `enterWorkspace(root)` and resumes sync without the user re-navigating
