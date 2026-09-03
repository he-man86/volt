> **STATUS 2026-09-03 — two of the three mechanisms have SHIPPED; one has not, and it is the one that matters
> for anyone who does not run the Windows installer.**
>
> - **Claude Code plugin — shipped.** `.claude-plugin/marketplace.json` exists at the repo root.
> - **Editor extension — shipped as a SIDELOAD, not as a publication.** `installer/Volt.iss` installs the
>   `.vsix` directly into VS Code, Cursor and Windsurf (one `[Run]` entry each, offered only when that editor's
>   launcher is on PATH). That covers the installer path and nothing else.
> - **Registry publication — NOT done.** `release.yml` stamps the extension's version and stops; it runs no
>   `vsce publish` and no `ovsx publish`. So the extension is in no registry, and anyone who installs Volt any
>   other way — or who wants updates through their editor — still gets nothing. **This is the remaining work.**

## Why

**Volt ships PLUGINS, published to each supplier's own registry, and nothing else.** That is the settled
direction (2026-09-03) and it is what remains undone here: the plugin exists, the registry entry does not.

Every terminal-capable host already has the whole `volt` CLI on `PATH` — that is one persistent environment
variable and it is the entire integration for Claude Code, Cursor, Windsurf and VS Code alike. What PATH cannot
deliver is language intelligence: an LSP has to be REGISTERED by the host, and each supplier accepts exactly one
kind of artifact for that.

There are only three across every host that matters, and Volt already builds all three artifacts:

| Artifact | Reaches |
|---|---|
| the `.vsix`, published to the VS Code Marketplace **and Open VSX** | VS Code, Cursor, Windsurf, VSCodium — one build, no fork-specific work |
| the Claude Code plugin (`.claude-plugin/marketplace.json`) | Claude Code |
| an MCP entry (`volt mcp`) | Claude Desktop — no terminal, no editor, so MCP is its only door |

The gap is publication, not construction. The `.vsix` is built on every release and pushed to no registry, so it
reaches users only by the Windows installer sideloading it into whichever editors it finds — which is the
opposite of the model: it is Volt reaching into a supplier's product instead of the supplier's own channel
handing Volt to the user. That is why §3 retires the sideload once §2 publishes.

> **On opencode**, which the original text of this proposal was written around: it is gone. Removed entirely on
> 2026-08-05 — no `opencode-config/`, no `OPENCODE_CONFIG_DIR` (the installer retires a stale one on upgrade and
> `test-install.ts` fails if it survives), no bundled agent, no launcher. It is named here only so that the §0
> tasks below read as history rather than as work outstanding. **Volt ships no agent and installs itself into
> none**; a plugin in a supplier's registry is the only shape a host integration takes.

## What Changes

**Publish the artifact Volt already builds**

- Publish `volt-vscode` to the **VS Code Marketplace** and to **Open VSX** from `release.yml`. Today it does neither — the workflow stamps the extension version and stops. Open VSX is the registry Cursor proxies and the one [marketplace.windsurf.com](https://marketplace.windsurf.com/) *is*, so a single `.vsix` covers VS Code, Cursor, Windsurf and VSCodium.

**Ship a Claude Code plugin**

- Publish a plugin marketplace from the `volt` repo root (`.claude-plugin/marketplace.json`) carrying a `volt-lsp` plugin whose `lspServers` entry runs `volt-lsp-iec --stdio` for `.fb .prg .fun .itf .dut .gvl` → `structured-text`. A plugin is Claude Code's **only** LSP mechanism; there is no settings key and no env var.
- The marketplace pointer necessarily lands in the user's global `~/.claude/settings.json` — `extraKnownMarketplaces` is user-scope-only by design, so a cloned repo cannot self-register a plugin source. Enablement can be project-scoped and committed.

**Add `volt mcp`**

- A new stdio MCP subcommand in the existing C# CLI, exposing the `volt` verbs as MCP tools. This is the only way into **Claude Desktop**, which has no terminal and no editor, and it doubles as a structured surface for the other hosts. Shipping it as a verb on `volt.exe` means no new package, no Node runtime, and one identical config snippet everywhere: `{"command": "volt", "args": ["mcp"]}`.

**Hold the installer's line at PATH**

- The installer keeps setting PATH and does **nothing else** per host. Every remaining integration point is a JSON file another vendor owns and rewrites (`~/.claude/settings.json`, `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, `%APPDATA%\Claude\claude_desktop_config.json`). Writing into those is the same coupling the winget-opencode task was deleted for, but worse — silent mutation of live config instead of an opt-in install.
- Host wiring is delivered as **published artifacts plus a documented snippet the user pastes**, not as installer actions.

**Remove opencode entirely — DONE, ahead of the rest of this change**

- This was written as out of scope ("the next refactor"). It was then done first, because every other decision here depends on it: `opencode-config/`, `verify-opencode.ts`, `bun run compat`, the `OPENCODE_CONFIG_DIR` env var, the desktop's embedded opencode GUI, the extension's "Open Agent" command and its "Agent & Settings" view are all deleted.
- **`volt-desktop` survived as a standalone app** rather than being deleted with opencode: the window is now the IDE panel itself, launched from its own exe or the connector tray. It gained `recent.ts` (remember the last workspace) and an "open an existing workspace" action, because opencode's GUI route was what used to answer "which project" — without a replacement a returning user would be offered a brand-new workspace every launch.
- The two frontends now surface the same three things (IDE Connection / IDE Sync / Diagnostics), deliberately.

## Capabilities

### New Capabilities

- `host-integrations`: how Volt's LSP and CLI reach each supported agent host — which mechanism serves which host, what Volt publishes, what the user configures, and the boundary that keeps Volt out of other vendors' config files.
- `mcp-server`: the `volt mcp` stdio subcommand — which CLI verbs are exposed as MCP tools, how mutating verbs are gated, and the transport contract.

### Modified Capabilities

<!-- None. The archived openspec/specs/ tree was removed; invariants live in package docs. -->

## Impact

**Code**

- `packages/volt-cli` — new `mcp` verb + its tests.
- `.claude-plugin/marketplace.json`, `plugins/volt-lsp/` — new, committed at repo root.
- `.github/workflows/release.yml` — add `vsce publish` + `ovsx publish` steps.
- `packages/volt-vscode` — no code change; needs `publisher` metadata and an Open VSX namespace.
- `packages/volt-web` — a host-setup docs page (the four snippets).

**Secrets / accounts**

- A VS Code Marketplace publisher (Azure DevOps PAT, `VSCE_PAT`) and an Open VSX namespace + token (`OVSX_PAT`), both as repo secrets. Neither exists today.

**Explicitly out of scope**

- Any `volt setup --host <name>` command that writes into a vendor's config file. Revisit only if the paste-a-snippet docs prove insufficient.
