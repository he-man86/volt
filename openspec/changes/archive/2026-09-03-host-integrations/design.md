## Context

Volt's agent-facing surface grew one host at a time and currently reaches two:

- **opencode** — the privileged path. One env var (`OPENCODE_CONFIG_DIR`) hands over LSP registration, the `volt` tool and permission gates. Guarded by a dedicated compat gate (`bun run compat`).
- **VS Code** — `volt-vscode` is built into `dist/volt/volt-vscode.vsix` by `build-payload.ts` and **sideloaded by the installer**. It is published to no registry: `release.yml` stamps `packages/volt-vscode/package.json` with a 3-part version and stops. (A comment in `check-wiring.ts` claims "the extension also self-publishes to the Marketplace" — that is stale; no such step exists.)

Two consequences follow from the sideload. First, Cursor and Windsurf users get nothing, because the installer only wires VS Code. Second — and worse — sideloaded extensions do not auto-update, which is the recorded cause of the extension silently drifting behind the LSP while the desktop app updates fine.

Researching the official docs for the five hosts that matter shows only **three delivery mechanisms** exist in total:

| Mechanism | Hosts it reaches |
|---|---|
| VS Code extension | VS Code, Cursor, Windsurf, VSCodium |
| Claude Code plugin (`lspServers`) | Claude Code (CLI + desktop) |
| `volt` on PATH | every host with a terminal |
| MCP | Claude Desktop (only door), optional elsewhere |

Volt already builds the artifacts for the first three. What is missing is publication, one plugin manifest, and one CLI verb.

## Goals / Non-Goals

**Goals:**

- Reach VS Code, Cursor, Windsurf, Claude Code and Claude Desktop with the artifacts Volt already produces, plus exactly one new one.
- Make the extension **auto-update**, closing the sideload drift.
- Establish a boundary the project can hold: Volt publishes artifacts; the user applies configuration; Volt never writes into another vendor's config file.
- Reduce opencode from "the integration" to "one host among five", so removing it later is a deletion rather than a redesign.

**Non-Goals:**

- Removing `opencode-config/`, the compat gate, or the `OPENCODE_CONFIG_DIR` installer step. That decision drags `volt-desktop` with it and belongs to a separate change.
- Any command that writes into `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, `%APPDATA%\Claude\claude_desktop_config.json` or `~/.claude/settings.json`.
- Fork-specific extension builds, or per-fork installer detection logic.
- Replacing the CLI. `volt` on PATH stays the primary surface for every terminal-capable agent; MCP is additive.

## Decisions

### One `.vsix`, two registries, no fork-specific build

Publish the single packaged extension to the VS Code Marketplace (`vsce publish`) and Open VSX (`ovsx publish`) from the release pipeline.

Cursor proxies Open VSX, and `marketplace.windsurf.com` *is* an Open VSX registry. So one upload reaches Cursor, Windsurf and VSCodium together. Both forks implement the VS Code extension API, so the language client needs no fork-aware code.

*Alternatives considered:* per-fork builds (nothing to differentiate — pure maintenance cost); Open VSX only (abandons the largest host); Marketplace only (Microsoft's terms restrict fork consumption, which is why Open VSX exists).

### Registry install replaces the installer's sideload

The installer stops running `code --install-extension` and stops carrying the `.vsix` in its payload. Users install from their editor's extension pane.

This is the fix for the drift bug, not merely a tidy-up: registry-installed extensions update themselves, sideloaded ones do not. It also removes the temptation to add `cursor --install-extension` and `windsurf --install-extension` branches, which would mean Volt tracking the CLI name and install semantics of every fork that ships.

*Alternative considered:* keep the sideload as a fallback for offline installs. Rejected — two install paths for one artifact is exactly how the version drift became invisible. If offline install is a genuine customer requirement, it returns as a documented manual `.vsix` download, not an installer task.

**Migration:** the registry build carries the same extension id and a higher version than any sideloaded copy, so existing installs upgrade in place on the first editor restart. The publisher id must match the one already stamped in `packages/volt-vscode/package.json` or users end up with two extensions; verify before the first publish.

### The Claude Code plugin lives in the main repo

Publish `.claude-plugin/marketplace.json` at the root of `he-man86/volt` (already public) with a `volt-lsp` plugin under `plugins/volt-lsp/`. No new repository, no new hosting, and `marketplace add` clones what is already the distribution repo.

The plugin's `lspServers` entry runs the bare command `volt-lsp-iec --stdio`, resolving through the PATH the installer sets — the same contract `opencode-config/opencode.json` already relies on.

*Alternative considered:* a dedicated `volt-claude-plugin` repo. Rejected — a second repo to version, tag and keep in step with the extension list for no gain.

Consequence to accept: the marketplace pointer lands in the user's global `~/.claude/settings.json`, because `extraKnownMarketplaces` is user-scope-only *by design* — the docs state it is ignored in project settings specifically so a cloned repo cannot introduce a plugin source. Volt cannot and should not work around that. Enablement can still be project-scoped and committed.

### `volt mcp` is a verb, not a package

Implement the MCP server as a subcommand of the existing C# CLI, sharing the engine with every other verb.

The alternative — a Node or TypeScript MCP server — would reimplement verb behavior in a second language, add a runtime users do not otherwise need, and give every host a different config snippet. As a verb, the snippet is `{"command": "volt", "args": ["mcp"]}` everywhere, and a fix to `push` reaches both surfaces at once.

Consent stays the host's job. Every supported host prompts per tool call; Volt annotates read-only versus mutating tools and implements no approval layer of its own.

### The installer's contract is PATH

The installer sets `PATH` and, until opencode is dropped, `OPENCODE_CONFIG_DIR`. Nothing else. Every other integration point is a JSON file another vendor owns, reads at startup and rewrites at will.

This is the same rule that removed the winget-opencode task — Volt owns no install or config path for a product it does not ship. Silent mutation of live user config is a stronger version of the same mistake, and it is unreviewable: the user cannot tell what changed or undo it cleanly.

Host wiring ships instead as published artifacts plus a documented snippet on the website. If pasting proves to be real friction, the escalation is a user-invoked `volt setup --host <name>` that prints or applies the snippet — deliberate, reversible, and still not the installer's business.

## Risks / Trade-offs

- **Open VSX namespace and Marketplace publisher do not exist yet** → Claim both before the first release attempt; namespace verification on Open VSX can take days and will otherwise block a release at the worst moment.
- **`VSCE_PAT` is an Azure DevOps token that expires** → Expiry surfaces only at release time as a failed publish. Set a calendar reminder at creation and make the failure message name the token.
- **Users end up with two extensions (sideloaded + registry)** → Verify the publisher id and extension id match the sideloaded build before publishing; test the upgrade path on a machine with the current installer's sideloaded copy.
- **Cursor's marketplace proxy is documented as serving stale versions** → Outside Volt's control. Document the `Install from VSIX` fallback and do not treat a proxy lag as a Volt bug.
- **Dropping the installer sideload removes a working path for VS Code users on the release it lands** → Land publication first, verify both registries serve the build, and only then remove the installer task.
- **MCP widens the consent surface — `push` and `merge` write to a live PLC** → Annotate mutating tools as destructive so hosts prompt loudly; do not expose any verb the CLI does not already expose; never add a Volt-side "allow all".
- **Claude Desktop spawns the server with no project context** → Specified as an explicit error naming the resolved path, not a guess at a workspace. A silent fallback here would operate on the wrong project.
- **Five hosts is five things that can break on someone else's release** → Mitigated by the artifacts being identical: one `.vsix`, one plugin manifest, one binary. A host-specific breakage cannot cascade into the others.

## Migration Plan

1. Claim the Marketplace publisher and Open VSX namespace; add `VSCE_PAT` and `OVSX_PAT` as repo secrets.
2. Add both publish steps to the release pipeline. Verify a real build appears in both registries and installs in VS Code, Cursor and Windsurf.
3. Only then remove the installer's sideload task and drop the `.vsix` from the payload.
4. Land the Claude Code plugin manifest and the `volt mcp` verb independently — neither blocks the other.
5. Publish the host-setup page covering all five hosts.

Rollback: each step is independently revertable. Restoring the sideload means re-adding one installer task and one payload copy.

## Open Questions

- **Which MCP implementation for C#?** The official `ModelContextProtocol` C# SDK versus hand-rolling JSON-RPC over stdio. Leaning SDK — the protocol's lifecycle and framing are not worth owning — but confirm its maturity and that it targets the CLI's TFM before committing.
- **Does `volt-desktop` survive the opencode removal?** It is an Electron shell around `opencode serve`'s GUI and has no content without it. Not decided by this change, but the answer determines whether the next refactor is a deletion or a rewrite.
- **Which verbs does the MCP server expose?** Starting position is parity with the CLI. If `init` proves too sharp a tool to hand an agent in Claude Desktop, restricting it is a smaller decision than adding it later.
