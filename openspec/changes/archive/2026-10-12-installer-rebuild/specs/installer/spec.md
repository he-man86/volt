## ADDED Requirements

### Requirement: a lean, declarative installer
The Volt installer SHALL install a flat per-user layout (`bin\`, `desktop\`, `connector\`, `codesys\` under
`%LOCALAPPDATA%\Programs\Volt`), put only `volt` and `volt-lsp-iec` on PATH through one exact `{app}\bin` entry
(broadcast to running shells on install and uninstall), declare its Start Menu shortcut and login item in Inno so
uninstall removes exactly them, write no environment variable but PATH, and never stop a running `volt` CLI process —
neither in setup nor in the uninstaller — nor any Volt process before that CLI has ended.

#### Scenario: an update while a push runs
- **WHEN** a silent update starts while `volt push` is running
- **THEN** the CLI process is not killed, nothing of Volt's is stopped (the tray and its TwinCAT worker keep running),
  and the update completes after the CLI ends
- **AND WHEN** the CLI is still running when the wait (`/VOLTWAIT`, default 3600 s) runs out
- **THEN** setup exits non-zero with every installed file unchanged, and the next update check retries

#### Scenario: an elevated CLI
- **WHEN** the running `volt.exe` is one whose executable path cannot be read (an admin terminal)
- **THEN** it is waited on as the CLI, not skipped

#### Scenario: uninstall while a push runs
- **WHEN** Volt is uninstalled while the CLI runs and the wait runs out
- **THEN** the uninstaller exits non-zero, every file stays in place and the tray keeps running

#### Scenario: uninstall
- **WHEN** Volt is uninstalled
- **THEN** its install directory, shortcut, login item, Documents\Volt scripts and PATH entry are gone and the user PATH
  value is byte- and type-identical to the one before the install

### Requirement: a verified update
The connector SHALL run a downloaded installer only after its SHA-256 matches the asset `digest` the GitHub release
publishes.

#### Scenario: a tampered download
- **WHEN** the downloaded installer's hash differs from the published one
- **THEN** the update is refused by name and nothing is run or left on disk

#### Scenario: an undigested release
- **WHEN** the release asset carries no digest
- **THEN** the update is refused by name and nothing is downloaded for launch
