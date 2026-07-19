## ADDED Requirements

### Requirement: STATUS comes from the connector; COMMANDS go through the CLI

The Volt UIs SHALL get all live IDE/bridge **connection status** — the detected-project list and per-bridge
health (connected/degraded, dirty, active operation) — from the connector's control plane (`GET
http://127.0.0.1:8550/status`, the single always-on aggregator), and SHALL perform all git-native **workspace
commands** (`init`, `pull`, `push`, `merge`, `build`) through the `volt` CLI. `volt status` (git drift =
incoming/outgoing/conflicts against `volt/ide`) belongs to the CLI, because it requires the local git repo the
connector has no knowledge of; it SHALL NOT move to the connector. The UI composes the two: connection status from
the connector, git drift + actions from the CLI. The connection-status path SHALL NOT re-probe the bridge pipes
from `volt-control` (the connector is the one aggregator).

#### Scenario: Connection status is read from the connector, not re-probed
- **WHEN** the UI refreshes what IDEs/projects are connected and their health
- **THEN** it reads the connector's `/status` (one aggregated `ConnectorView`), not a per-vendor pipe fan-out in the UI

#### Scenario: git drift and actions still go through the CLI (headless-safe)
- **WHEN** the UI shows drift or runs pull/push/init
- **THEN** those go through the `volt` CLI (git + pipe), which works without the connector — only live IDE-connection status depends on the connector

### Requirement: The UI init/connect surface is a list of detected projects, not vendors

The Volt UIs (the desktop shell and the VS Code extension) SHALL present the connectable/init-able options as a
single list of DETECTED PROJECTS — each carrying its platform as a badge — sourced from the connector's
`ConnectorView.projects`, and the user SHALL init/connect by picking a project. The UI SHALL NOT present a vendor
chooser (no "Initialize for CODESYS" / "Initialize for TwinCAT" buttons). The vendor SHALL be derived from the
picked project (`volt init --vendor <derived>`), never selected as a separate step.

#### Scenario: The user inits by picking a detected project
- **WHEN** a CODESYS project and a TwinCAT project are detected and the user picks one in the desktop or VS Code UI
- **THEN** the workspace is initialized with that project's vendor and the bridge is bound to it — with no vendor button anywhere in the flow

#### Scenario: No project detected falls back to guidance, not failure
- **WHEN** the connector reports no detected projects (or is unreachable)
- **THEN** the UI shows the existing guidance (open a project / activate CODESYS in the tray) and does not hard-fail

### Requirement: Vendor is a derived detail across every layer

Across the product — the connector, the desktop shell, and the VS Code extension — the user SHALL never choose a
PLC vendor as a primary action; they choose a project, and the vendor rides along as a badge/derived field. The
LSP dialect setting (`volt.iec.vendor`) is exempt: it selects the language server's ST dialect, not init/connect,
and MAY be set from the picked project's vendor on init.

#### Scenario: No vendor picker in the init/connect path
- **WHEN** a user connects or initializes from any Volt UI
- **THEN** the action is picking a project; the vendor is shown as a badge and applied automatically, never a separate step
