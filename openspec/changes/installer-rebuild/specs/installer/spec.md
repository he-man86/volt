## ADDED Requirements

### Requirement: a lean, declarative installer
The Volt installer SHALL install a flat per-user layout, put only `volt` and `volt-lsp-iec` on PATH (broadcast to running
shells), declare its shortcut, login item and PATH entry so uninstall removes exactly them, and never stop a running
`volt` CLI process.

#### Scenario: an update while a push runs
- **WHEN** a silent update starts while `volt push` is running
- **THEN** the CLI process is not killed and the update completes after it ends

#### Scenario: uninstall
- **WHEN** Volt is uninstalled
- **THEN** its install directory, shortcut, login item and PATH entry are gone and no other PATH entry is touched

### Requirement: a verified update
The connector SHALL run a downloaded installer only after its SHA-256 matches the one the release published.

#### Scenario: a tampered download
- **WHEN** the downloaded installer's hash differs from the published one
- **THEN** the update is refused by name and nothing is run
