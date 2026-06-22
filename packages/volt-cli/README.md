# @opencode-ai/volt-cli — the `volt` command

A **git-style CLI** for managing IEC 61131-3 PLC projects (CODESYS / TwinCAT 3)
as version-controllable text. It talks to a vendor **bridge**
(`packages/volt-bridge`) over a small HTTP wire and materializes the live IDE
project into a `.volt/` workspace — one text file per item, plus a snapshot
used for three-way merge.

## Verbs (git-shaped)

| Command | Purpose |
|---|---|
| `volt init` | One-time: bind this workspace folder to the IDE project. |
| `volt status` | Show drift between IDE, snapshot, and workspace (read-only; `--porcelain` for parsing). |
| `volt pull` | IDE → workspace (≈ `git fetch`+`merge`). Mutates local files. |
| `volt push` | Workspace → IDE (≈ `git push`). Refuses on drift; `--force-with-lease=<version>` for atomic override. |
| `volt build` | Ask the IDE to build; returns diagnostics (JSON on stdout). |
| `volt merge` / `show` / `log` | Three-way merge, inspect an item, history. |

The bridge port is resolved from the workspace binding (CODESYS `8556`,
Beckhoff `8555`); override with `--port` or `VOLT_BRIDGE_PORT`.

`.volt/` is the CLI-managed workspace (snapshot + `config.json`); it is **not**
the same as `.opencode/` (opencode agent config). See the repo `CLAUDE.md` and
`packages/volt-bridge/ARCHITECTURE.md` for the end-to-end data path.

## Develop

```bash
cd packages/volt-cli
bun typecheck      # tsgo --noEmit (never raw tsc)
bun test           # bun test runner
bun run build      # tsc -> dist/
```

The headless CODESYS dev/test loop (Windows/PowerShell):
`pwsh script/codesys-bridge.ps1 up|test|down`.
