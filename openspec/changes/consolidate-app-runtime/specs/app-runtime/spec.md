## ADDED Requirements

### Requirement: The installer delivers the complete agent toolchain

The installed product SHALL deliver the full functional agent toolchain — the agent config (via
`OPENCODE_CONFIG_DIR` → the bundled `volt-config`), the LSP, and the `volt` CLI (on PATH) — from Volt's own
installer, so a user never needs opencode installed separately. Unifying the runtime DATA dirs (opencode's XDG
`data`/`cache`/`state` and the Electron `userData`) under one Volt-branded root is an OPTIONAL consolidation
(nice-to-have, decided B): opencode-branded data dirs are acceptable as an internal implementation detail,
especially for the CLI, and are NOT required.

#### Scenario: The toolchain is complete from our installer alone
- **WHEN** the product is installed fresh on a machine with no opencode present, and the GUI, the `volt` CLI, and
  an editor are each used
- **THEN** the agent config, the LSP, and the `volt` CLI all resolve from the Volt install (bundled `volt-config`
  + `resources/volt/bin`) — no separate opencode install is needed and nothing is missing

#### Scenario: Uninstall removes the Volt install cleanly
- **WHEN** the product is uninstalled
- **THEN** `%LOCALAPPDATA%\Programs\Volt` is removed, `volt` is off PATH, and the editor extension is removed;
  opencode-branded data dirs MAY remain (internal detail), but stale duplicate caches (`ai.opencode.desktop.dev`,
  a second updater cache, `volt-bridge*`) SHALL NOT accumulate

### Requirement: Volt's agent data is isolated from a stock opencode install

The installed product SHALL store its opencode agent data (session DBs, `auth.json`/`account.json`, snapshots)
under a Volt data root (`%LocalAppData%\Volt\data`, set via `XDG_DATA_HOME` in both the CLI and desktop
launchers before core initializes), so it never shares auth or session state with a separately-installed stock
opencode. The Volt CLI and the Volt desktop SHALL resolve to the same Volt data root (one Volt identity across
both).

#### Scenario: Volt and stock opencode coexist without clobbering each other
- **WHEN** both Volt and a stock opencode are installed on the same machine and each is signed in
- **THEN** Volt's `auth.json`/sessions live under `%LocalAppData%\Volt\data\opencode` and opencode's under
  `~/.local/share/opencode`, and neither overwrites the other

#### Scenario: The CLI and desktop share one Volt identity
- **WHEN** a user signs in via the desktop and then runs the `volt` CLI (or vice-versa)
- **THEN** both resolve the same Volt data root, so the login and session history are shared between them

### Requirement: The install updates through a single path

The all-inclusive install SHALL update through exactly one mechanism — the desktop electron-updater against
Volt's release feed, replacing the whole bundle (app, `volt` CLI, bridges, LSP, connector). The opencode
in-sidecar self-updater SHALL be disabled for the installed product, and there SHALL be a single, Volt-named
updater cache under the Volt root.

#### Scenario: Only one updater and one cache are active
- **WHEN** the installed product checks for and applies an update
- **THEN** the update is applied by electron-updater, the opencode self-updater does not also prompt or download,
  and only one updater cache (under `%LOCALAPPDATA%\Volt\updater`) exists afterward

### Requirement: One shared PLC gateway, reached by discovery (local topology)

For the current LOCAL topology (agent, connector, and IDE on the same machine), the connector SHALL be the
single shared gateway to the live PLC IDEs; every local frontend (GUI, CLI, editor extension, LSP) SHALL reach
the bridge by discovering that connector (its `8555`/`8556` HTTP wire), and no frontend SHALL spawn a bridge
worker independently. The hosted/cloud model is out of scope here and may add a separate local relay connector
(see design §8); this requirement does not declare the process inventory final.

#### Scenario: Local frontends attach to the running gateway, not their own
- **WHEN** the GUI, the CLI, or the editor extension needs the bridge while the connector is running locally
- **THEN** it connects to the connector's HTTP wire and does not start a second bridge/connector process
