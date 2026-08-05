## ADDED Requirements

### Requirement: The extension publishes to both VS Code Marketplace and Open VSX

The release pipeline SHALL publish the `volt-vscode` `.vsix` to the VS Code Marketplace and to Open VSX on every stable release. A build that packages the extension but publishes it to neither registry SHALL be treated as a failed release, not a successful one.

Open VSX is the registry Cursor proxies and the registry `marketplace.windsurf.com` serves, so one published `.vsix` SHALL be the delivery mechanism for VS Code, Cursor, Windsurf and VSCodium alike. No fork-specific extension build is permitted.

#### Scenario: A stable release publishes to both registries

- **WHEN** `promote.yml` promotes a dev build to the stable channel
- **THEN** the same `.vsix` artifact is published to the VS Code Marketplace and to Open VSX under the Volt namespace
- **AND** the published version matches the 3-part `<maj>.<min>.<count>` version stamped into `packages/volt-vscode/package.json`

#### Scenario: A publish step fails

- **WHEN** either `vsce publish` or `ovsx publish` exits non-zero
- **THEN** the release job fails
- **AND** the failure names which registry rejected the upload

#### Scenario: A Cursor or Windsurf user installs Volt

- **WHEN** a user searches for the Volt extension in Cursor's or Windsurf's extension pane
- **THEN** the extension resolves from Open VSX and installs
- **AND** Structured Text intelligence works without any host-specific configuration beyond the extension itself

### Requirement: Claude Code receives the LSP through a published plugin marketplace

Volt SHALL publish a plugin marketplace from the `volt` repository root so Claude Code users install the language server with two one-time commands. A plugin is Claude Code's only mechanism for registering a language server; the implementation SHALL NOT attempt to configure an LSP through `settings.json`, an environment variable, or any other channel.

The plugin's `lspServers` entry SHALL run `volt-lsp-iec --stdio` and map `.fb`, `.prg`, `.fun`, `.itf`, `.dut` and `.gvl` to the `structured-text` language id, matching the extension set `volt-vscode` declares.

#### Scenario: A user installs the plugin

- **WHEN** a user runs `/plugin marketplace add he-man86/volt` followed by `/plugin install volt-lsp@volt`
- **THEN** Claude Code registers the `volt-lsp-iec` server
- **AND** opening a `.prg` or `.dut` file yields go-to-definition, hover and diagnostics from the installed `volt-lsp-iec` on PATH

#### Scenario: The extension set drifts

- **WHEN** `packages/volt-vscode/package.json` gains or loses a `structured-text` file extension
- **THEN** a test fails unless the plugin manifest's `extensionToLanguage` map is updated to match

#### Scenario: The plugin is enabled for a single project

- **WHEN** a user runs `claude plugin install volt-lsp@volt --scope project`
- **THEN** enablement is written to the repository's `.claude/settings.json` and travels with a clone
- **AND** the marketplace pointer remains in the user's own global settings, because `extraKnownMarketplaces` is user-scope-only by design

### Requirement: The installer configures PATH and nothing host-specific

The installer SHALL add Volt's `bin` directory to the user's `PATH` and SHALL NOT write to, merge into, or otherwise mutate any configuration file owned by another vendor's product. This specifically forbids touching `~/.claude/settings.json`, `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json` and `%APPDATA%\Claude\claude_desktop_config.json`.

PATH alone delivers the complete `volt` CLI to every host with a terminal, which covers Claude Code, Cursor, Windsurf and opencode. Host wiring beyond that SHALL be delivered as a published artifact plus a documented snippet the user applies deliberately.

#### Scenario: A fresh install reaches terminal-capable agents

- **WHEN** a user completes the installer and restarts their agent
- **THEN** `volt` resolves on PATH in Claude Code, Cursor, Windsurf and opencode
- **AND** no file under another vendor's config directory has been created or modified

#### Scenario: Uninstall leaves other products untouched

- **WHEN** the user uninstalls Volt
- **THEN** the PATH entry is removed
- **AND** every other product's configuration is byte-identical to its pre-install state

### Requirement: Host setup is documented as pasteable snippets

Volt SHALL publish a host-setup page covering each supported host: which mechanism serves it, what the user installs, and the exact configuration snippet where one is required. The page SHALL state plainly that Claude Desktop supports the CLI over MCP only and cannot host the language server, because it has no editor.

#### Scenario: A user sets up a host Volt does not auto-configure

- **WHEN** a user follows the setup page for Cursor, Windsurf or Claude Desktop
- **THEN** the page provides the exact config file path and a copyable JSON snippet
- **AND** the snippet is identical across hosts apart from the file it goes in
