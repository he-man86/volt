## ADDED Requirements

### Requirement: Payload lands in a version-scoped directory

The installer SHALL write every payload file into `{app}\app-<version>\`, never directly into `{app}`. A given version's directory MUST NOT be written to by an install of a different version, so an update cannot touch a file another version's running processes hold open.

#### Scenario: Installing a new version beside a running one

- **WHEN** an update is installed while the connector, the TwinCAT worker, the desktop app and `volt-lsp-iec.exe` are all running from the previous version's directory
- **THEN** every payload file is written into the new version's directory, no file in the previous version's directory is opened for write, and setup completes without a retry loop, an abort, or a rollback

#### Scenario: An update that fails leaves the previous version usable

- **WHEN** an install of a new version fails partway for any reason
- **THEN** the previous version's directory is untouched and `{app}\current` still resolves to it, so the previously installed Volt remains fully runnable

### Requirement: `current` is the only path anything outside the install may reference

`{app}\current` SHALL be a junction resolving to the active version directory, and it MUST be the sole path recorded anywhere outside `{app}` — `PATH`, `OPENCODE_CONFIG_DIR`, the Start Menu shortcut, and the login item. No recorded path may contain a version number, so an update never rewrites environment variables, shortcuts, or registry values.

#### Scenario: Environment survives an update untouched

- **WHEN** a version is installed over an existing install
- **THEN** `PATH`, `OPENCODE_CONFIG_DIR`, the Start Menu shortcut target and the login item command are byte-identical before and after, and each resolves through `{app}\current` to the newly installed version

#### Scenario: Activating a new version

- **WHEN** the new version's files are fully written and setup activates it
- **THEN** `{app}\current` is repointed to the new version directory as the last step before the post-install run, and a process holding an open file under the old target keeps that handle without error

#### Scenario: A tool resolving `volt` from PATH gets the active version

- **WHEN** `volt` is invoked from any shell, editor or agent after an update
- **THEN** it resolves through `{app}\current\bin` and executes the newly activated version

### Requirement: Superseded versions are pruned when nothing holds them

Version directories other than the active one SHALL be removed by the connector at startup, not by the installer and not at reboot. Pruning MUST be best-effort: a directory that cannot be removed is left for the next attempt and MUST NOT fail startup. At most two version directories are retained.

#### Scenario: The previous version is removed on the next start

- **WHEN** the connector starts after an update and the previous version's files are no longer held open
- **THEN** every version directory except the active one is deleted, and `{app}` contains only `current`, the active version directory, and the installer's own files

#### Scenario: A locked leftover does not break startup

- **WHEN** a superseded version directory still has a file held open at connector startup
- **THEN** the connector logs the skip, leaves that directory in place, starts normally, and removes it on a later start

### Requirement: An existing flat install is migrated on first upgrade

Installing this layout over an install that has payload files directly in `{app}` SHALL leave no orphaned payload behind. The flat payload MUST be removed as part of the upgrade, so `{app}` is not left holding two copies with the older one still first on `PATH`.

#### Scenario: Upgrading from the flat layout

- **WHEN** a version using this layout is installed over an install whose binaries sit directly in `{app}\bin` and `{app}`
- **THEN** the new version installs into its version directory, `current` points at it, the old flat payload is removed, and `PATH` resolves `volt` to the new version rather than a leftover flat copy

### Requirement: Uninstall removes the whole install root

Uninstalling SHALL remove `{app}` in full — the junction, every version directory, and every file — leaving nothing that would keep the install root alive or be picked up by a later install.

#### Scenario: Uninstall with several versions on disk

- **WHEN** Volt is uninstalled while two version directories and the `current` junction exist
- **THEN** `{app}` no longer exists, the junction is removed without deleting anything through it a second time, and no Volt file, environment variable, shortcut, login item or Add/Remove entry remains

### Requirement: The lifecycle gate proves the layout end to end

`bun run test:install:lifecycle` SHALL pass with zero problems across install → uninstall → install → update → update → uninstall → install → uninstall, executed with editors running so the previously failing file-lock condition is present.

#### Scenario: Gate run with the failure condition present

- **WHEN** the lifecycle gate runs on a machine with an editor open and `volt-lsp-iec.exe` running from the install
- **THEN** every step reports every binary at the expected version, no setup log contains a rollback or an in-use abort, each editor that had the extension still reports exactly one, and every uninstall leaves the install root empty
