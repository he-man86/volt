# Volt

Manage IEC 61131-3 PLC projects (CODESYS and TwinCAT/Beckhoff) as version-controllable text.

Volt gives PLC code a git-native workflow and AI assistance: it syncs a live IDE project to a git repo of text files, analyzes Structured Text with a dedicated LSP, and exposes the whole thing to [opencode](https://opencode.ai) as a first-class tool + agent.

## What's here

| Package | What it is |
|---|---|
| `packages/volt-git` | the **`volt` CLI** — git-native PLC sync (`init/pull/push/status/build/log/show/merge`) |
| `packages/volt-bridge` | C# bridges + connector: one live IDE (CODESYS / TwinCAT) over a small HTTP wire |
| `packages/volt-lsp-iec` | TypeScript-native LSP for Structured Text (diagnostics, nav, completion, hover, …) |
| `packages/volt-control` | UI-agnostic core (status/pull/push/health/diagnostics) shared by both frontends |
| `packages/volt-desktop` | Electron shell wrapping the installed opencode's GUI + a Volt IDE panel |
| `packages/volt-vscode` | VS Code extension: PLC language intelligence + IDE-drift coloring |
| `volt-config/` | the agent-config layer handed to opencode via `OPENCODE_CONFIG_DIR` |

## opencode

Volt is **opencode-independent**: opencode is a **runtime dependency** (a user-provided install), not a fork. Volt makes your opencode PLC-aware by handing it `volt-config/` via the `OPENCODE_CONFIG_DIR` env var — additive and safe (your settings + provider keys are untouched; uninstall reverts it to vanilla).

## Development

Bun workspaces + Turbo. Requires `bun@1.3.14` and, for the agent, an installed `opencode` on PATH.

```bash
bun install
bun run dev            # the Volt-aware agent (OPENCODE_CONFIG_DIR=$PWD/volt-config opencode)
bun run build          # build the TS packages
bun run dist           # release bundle → dist/volt/
bun run compat         # opencode compat gate (integration → lsp → tool)
bun run typecheck && bun run lint
```

The bridges are .NET (Windows-only) — see `packages/volt-bridge/README.md`. Full guidance for contributors and agents is in `CLAUDE.md`; design + roadmap live in `openspec/` (`openspec list`).

## License

MIT
