# volt-scripts

Fork-owned tooling for the Volt fork of opencode. All TS scripts run with `bun`; PS scripts
drive the Windows-only bridges. (Not `bun run` scripts — `package.json` is an upstream file
outside the fork's allowed seams; see `CLAUDE.md` → "Fork surface".)

## Sync with upstream

| Command | What it does |
|---|---|
| `bun volt-scripts/merge-upstream.ts [vX.Y.Z]` | **The one sync command.** Tracks opencode's **release tags**, not `dev`: fetch tags → newest `v<current-major>.*` (or a named tag — `v2.0.0` to opt into a new major) → dated `sync/…` branch → merge → run `sync.ts`. Stops on conflict; prints the fast-forward to land it. `--land` fast-forwards `volt` + pushes on green. |
| `bun volt-scripts/sync.ts` | **The merge-process signal flow** — install → divergence → integration → lsp → tool, stopping at the first ✗. Run standalone after resolving a manual merge. |
| `bun run volt-scripts/check-divergence.ts` | **Keystone guard.** Fails if the fork touched upstream outside the 15 seams, added a file outside the allowlist, or committed junk (`*.bak`/`.DS_Store`/…). `--self-test` runs the classifier unit tests. Also run by the pre-push hook + CI. |

## Verify integration (after a merge, or in dev)

| Command | What it does |
|---|---|
| `bun run volt-scripts/check-volt-integration.ts` | Configs/bins/wiring present (files exist, dist built, corpus, vscode entry) + the release-merge guards: GUI channel `define` intact, `@opencode-ai/plugin` pin published on npm. |
| `bun volt-scripts/verify-lsp.ts` | Proves the volt **LSP** attaches in opencode (drives `opencode debug lsp`). |
| `bun volt-scripts/verify-volt-tool.ts` | Proves the volt **CLI tool** registers (drives `opencode debug agent volt`). Needs a configured model/provider. |

## Build & distribution (the prod installer)

**One** all-inclusive installer (the desktop NSIS = GUI + `volt` CLI on PATH + bridge + LSP). Prod-only by default — dev/beta need an explicit `OPENCODE_CHANNEL` (CI sets it per branch).

| Command | What it does |
|---|---|
| `bun volt-scripts/build-installer.ts` | **Recreate the PROD installer** — forces `OPENCODE_CHANNEL=prod`, builds the bundle + the desktop NSIS (`packages/desktop/dist/Volt-Setup-<ver>-x64.exe`). |
| `bun volt-scripts/dist.ts` | Build the `dist/volt` bundle — prod `volt` binary + LSP + self-contained connector (`--no-bridge` skips the C# connector). The installer bundles it. |

(`build.ts` compiles the `volt` binary and `brand-icons.ts` brands the icons — both are called by the above. Install/uninstall is the NSIS; **updates ship via electron-updater from `he-man86/volt`** — opencode's mechanism, so the GUI + CLI + bridge all update together.)

## Dev & PLC tooling

| Command | What it does |
|---|---|
| `bun volt-scripts/dev.ts` | opencode TUI from source with the volt LSP attached (`.st`). |
| `bun volt-scripts/harvest-corpus.ts` | Capture POU PLCopenXML from a live bridge (LSP corpus tooling). |
| `pwsh volt-scripts/codesys-bridge.ps1 up\|test\|down\|…` | Headless CODESYS dev/test bridge loop. |
| `pwsh volt-scripts/bridge.ps1` | Build + (re)launch the Beckhoff standalone bridge. |
| `volt` / `volt.cmd` | `volt` CLI wrappers (add `volt-scripts/` to PATH to use bare `volt`). |

`tsconfig.json` here typechecks every script (run by the pre-push hook + CI via
`tsgo --noEmit -p volt-scripts/tsconfig.json`).
