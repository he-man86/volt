# Volt

Manage IEC 61131-3 PLC projects (CODESYS and TwinCAT/Beckhoff) as version-controllable text.

Volt gives PLC code a git-native workflow and AI assistance: it syncs a live IDE project to a git repo of text files, analyzes Structured Text with a dedicated LSP, and puts the whole thing where any AI agent can read and drive it.

## What's here

| Package | What it is |
|---|---|
| `packages/volt-cli` | the single C# toolchain: the **`volt` CLI** (git-native PLC sync — `init/pull/push/status/build/show/merge`) + the in-IDE bridges (CODESYS / TwinCAT) + the tray connector, over Windows named pipes |
| `packages/volt-lsp-iec` | TypeScript-native LSP for Structured Text (diagnostics, nav, completion, hover, …) |
| `packages/volt-control` | UI-agnostic core (status/pull/push/health/diagnostics) shared by both frontends |
| `packages/volt-desktop` | the standalone desktop app — connection, sync and diagnostics for one workspace |
| `packages/volt-vscode` | editor extension (VS Code / Cursor / Windsurf): PLC language intelligence + IDE-drift coloring |
| `packages/volt-web` | the public website — React Router, prerendered to static HTML, deployed at the apex |

## AI agents

Volt ships no agent, launches none, and installs itself into none. Whatever agent you use reaches Volt through the **`volt` CLI on PATH** — that is the entire integration for Claude Code, Cursor, Windsurf and anything else with a terminal. Hosts that can also run a language server register it themselves: the editor extension for the VS Code family, a plugin for Claude Code. Claude Desktop, which has no terminal, connects over MCP.

Volt writes into no other product's configuration; the installer publishes `PATH` and nothing else. See `packages/volt-web/app/docs/agents.mdx`.

> Volt used to ship an `opencode-config/` directory into opencode's environment via `OPENCODE_CONFIG_DIR`. That integration is gone — it was one product's config format installed into that product's environment, for a dependency Volt did not own.

## Development

Bun workspaces (no Turbo — task-running is bun-native `--filter`). Requires `bun@1.3.14`.

```bash
bun install
bun run build          # build the TS packages
bun run build:installer # the product → dist/release/Volt-win-Setup.exe
bun run check          # wiring check (built binaries + source-extension/version parity)
bun run typecheck && bun run lint
```

The CLI + bridges are .NET (Windows-only) — see `packages/volt-cli/README.md`. Full guidance for contributors and agents is in `CLAUDE.md`; design + roadmap live in `openspec/` (`openspec list`).

## License

MIT
