## ADDED Requirements

### Requirement: opencode core and GUI are reused unmodified

Volt SHALL NOT modify `packages/app`, `packages/ui`, or `packages/opencode/src` — opencode's GUI and binary are
reused pristine and tracked from upstream releases. Volt's product value is delivered additively: the LSP +
`volt` tool + agent + theme via the `OPENCODE_CONFIG_DIR` bundle, the bridge/connector + `volt-git` as `volt-*`
packages, and the IDE-changes panel via the connector. `check-divergence.ts` SHALL enforce this — its
`ALLOWED_MODIFICATIONS` SHALL contain no `packages/app`, `packages/ui`, or `packages/opencode/src` entry.

#### Scenario: A re-introduced GUI or binary seam fails the guard
- **WHEN** an edit to `packages/app/**`, `packages/ui/**`, or `packages/opencode/src/**` is committed
- **THEN** `check-divergence.ts` reports it as a violation and exits non-zero (it is not in `ALLOWED_MODIFICATIONS`)

#### Scenario: An upstream GUI update merges without conflict
- **WHEN** a new opencode release changes `packages/app`/`packages/ui`
- **THEN** the merge lands cleanly (Volt holds no edits there) and the updated GUI ships as-is

### Requirement: The IDE-changes panel is served by the connector

The IDE-changes surface (files the live IDE changed vs git, with pull/push) SHALL be provided by the Volt
connector — not injected into opencode's GUI and not dependent on the VS Code extension. It SHALL be reachable by
any front-end (desktop, CLI-only, editor) via the always-on connector, and SHALL run pull/push through
`volt-git` against the bound workspace.

#### Scenario: A desktop user with no VS Code sees IDE changes
- **WHEN** the live IDE has uncommitted changes and the user has only the Volt desktop app (no VS Code)
- **THEN** the connector surfaces those changes (tray and/or shell button) and offers Pull/Push, working entirely
  through the connector + `volt-git`

### Requirement: The desktop is a branded shell over stock opencode

The desktop SHALL be a Volt-branded Electron shell that reuses a pinned, unmodified stock opencode as its GUI and
sidecar. Branding, window, protocol handling, and packaging live in `packages/desktop` (near-static shell seams);
no custom opencode binary is built. The `volt` CLI SHALL be the same stock opencode plus the config bundle,
launched by a wrapper that sets `OPENCODE_CONFIG_DIR` before the process starts.

#### Scenario: The toolchain runs on stock opencode
- **WHEN** the desktop launches or the `volt` CLI runs
- **THEN** it executes an unmodified stock opencode with the Volt config bundle applied via `OPENCODE_CONFIG_DIR`,
  and the TUI/GUI show the Volt LSP enabled — with no edits to `packages/opencode/src`
