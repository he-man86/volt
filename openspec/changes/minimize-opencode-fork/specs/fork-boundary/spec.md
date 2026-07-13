## ADDED Requirements

### Requirement: opencode's GUI and binary are reused unmodified

Volt SHALL NOT modify `packages/app`, `packages/ui`, or `packages/opencode/src`. Volt's product value is delivered
additively: the LSP + `volt` tool + agent + theme via the `OPENCODE_CONFIG_DIR` bundle, the bridge/connector +
`volt-git` + `volt-lsp-iec` as `volt-*` packages, and the IDE panel as a `volt-desktop` frontend over
`volt-control`. `check-divergence.ts` SHALL enforce this — its `ALLOWED_MODIFICATIONS` SHALL contain no
`packages/app`, `packages/ui`, or `packages/opencode/src` entry.

#### Scenario: A re-introduced GUI or binary seam fails the guard
- **WHEN** an edit to `packages/app/**`, `packages/ui/**`, or `packages/opencode/src/**` is committed
- **THEN** `check-divergence.ts` reports it as a violation and exits non-zero (it is not in `ALLOWED_MODIFICATIONS`)

#### Scenario: An upstream GUI update merges without conflict
- **WHEN** a new opencode release changes `packages/app` / `packages/ui`
- **THEN** the merge lands cleanly (Volt holds no edits there) and the updated GUI ships as-is

### Requirement: opencode is a user-provided runtime, configured additively

opencode SHALL be a user-installed prerequisite that Volt never bundles, downloads, updates, or uninstalls. The
installer SHALL make opencode Volt-aware by setting one persistent env var `OPENCODE_CONFIG_DIR` (→ the config
bundle) and adding the Volt bin dir to `PATH`. This SHALL merge **additively** — the user's own opencode config and
auth (stored in opencode's data dir) SHALL be preserved. The config bundle SHALL NOT set `autoupdate`, so opencode's
update behavior stays entirely opencode's.

#### Scenario: The user's opencode is Volt-aware with no manual setup
- **WHEN** Volt is installed and the user runs `opencode` (or the desktop spawns `opencode serve`)
- **THEN** opencode merges the Volt LSP + `volt` tool + agent + theme + permissions from `OPENCODE_CONFIG_DIR`, while
  the user's own settings and provider auth still work — with no manual configuration

### Requirement: The IDE panel is a desktop frontend over volt-control

The IDE-changes surface (drift vs. git + Pull/Push, diagnostics, bridge status) SHALL be rendered by `volt-desktop`
over `@opencode-ai/volt-control` — the same core the VS Code extension uses — not injected into opencode's GUI.
Bridge lifecycle control SHALL remain the connector's job; frontends observe + sync only (no `startBridge`).

#### Scenario: A desktop user with no VS Code sees IDE changes
- **WHEN** the live IDE has uncommitted changes and the user has only the Volt desktop app
- **THEN** the shell renders those changes over `volt-control` and offers Pull/Push through `volt-git`

### Requirement: The desktop serves stock opencode's GUI

`volt-desktop` SHALL serve a stock, user-provided opencode (`opencode serve`) and load its served GUI in a
`WebContentsView`; it SHALL NOT bundle `packages/app` or build a custom opencode binary. The **Desktop** installer
SHALL require opencode present (abort if absent); the **CLI** (`volt-git` + `volt-lsp-iec`) SHALL NOT require
opencode.

#### Scenario: The desktop runs on stock opencode
- **WHEN** the desktop launches
- **THEN** it spawns the user's opencode with the config bundle applied via the env var and shows the Volt-flavored
  GUI — with no edits to `packages/opencode/src` and no bundled opencode
