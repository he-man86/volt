# volt-scripts

Repo tooling for Volt. All TS scripts run with `bun`; PS scripts drive the Windows-only bridges.

## Track opencode (the compat gate)

Volt depends on opencode as a runtime + `@opencode-ai/plugin` (npm), not a fork. On an opencode version bump, run the compat gate:

| Command | What it does |
|---|---|
| `bun volt-scripts/sync.ts` | **The opencode compat gate** — install → integration → lsp loads → tool loads, stopping at the first ✗. Exit 0 = Volt loads in this opencode. |
| `bun run volt-scripts/check-volt-integration.ts` | Configs/bins/wiring present (config layer, dist built, corpus, wire-version parity, vscode entry). Key-free — runs in CI. |
| `bun volt-scripts/verify-lsp.ts` | Proves the volt **LSP** loads in the installed opencode via `OPENCODE_CONFIG_DIR` (drives `opencode debug lsp`). |
| `bun volt-scripts/verify-volt-tool.ts` | Proves the volt **CLI tool** loads (drives `opencode debug agent volt`). Needs an installed opencode + configured provider. |

## Build & distribution

| Command | What it does |
|---|---|
| `bun volt-scripts/dist.ts` | Build the `dist/volt` bundle — `volt` PLC CLI + LSP + `volt-config/` + self-contained connector (`--no-bridge` skips the C# connector). The installer bundles this folder. |

`dist.ts` compiles the `volt` PLC CLI directly (no opencode bundled — the agent is the user's installed opencode). The desktop shell + NSIS installer are built from `packages/volt-desktop` (Phase 2 / the distribution work).

## Dev tooling

| Command | What it does |
|---|---|
| `volt` / `volt.cmd` | `volt` CLI wrappers (add `volt-scripts/` to PATH to use bare `volt`). |

For dev with the Volt-aware agent, run `bun dev` from the repo root (`OPENCODE_CONFIG_DIR=$PWD/volt-config opencode`).

Package-specific scripts live in each package's `scripts/` dir — the bridge build + dev-loop scripts (`build-bridges.ps1`, `codesys-bridge.ps1`, `bridge.ps1`, `harvest-corpus.ts`) are in `packages/volt-bridge/scripts/`; LSP corpus/conformance tooling is in `packages/volt-lsp-iec/scripts/`.

`tsconfig.json` here typechecks every script (run by the pre-push hook + CI via `tsgo --noEmit -p volt-scripts/tsconfig.json`).
