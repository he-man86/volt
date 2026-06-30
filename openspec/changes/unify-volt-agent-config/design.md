# Design: one shipped config dir, handed to opencode via `OPENCODE_CONFIG_DIR`

## The proof opencode reads it (no assumptions)
opencode resolves config from three env hooks (`packages/core/src/flag/flag.ts:21-22,63`), all loaded + merged:
- `OPENCODE_CONFIG` — a config **file** (`config/config.ts:400-402`)
- `OPENCODE_CONFIG_CONTENT` — config **inline** (`config.ts:467-474`)
- `OPENCODE_CONFIG_DIR` — a config **dir** (`config.ts:417`)

`ConfigPaths.directories()` appends `OPENCODE_CONFIG_DIR` to the dir list (`config/paths.ts:39`); `config.ts:423` loops every dir and `:424` — `if (dir.endsWith(".opencode") || dir === Flag.OPENCODE_CONFIG_DIR)` — gives the env dir the **full `.opencode` treatment**: `opencode.json` + `tool/` + `agent/` + `command/` + `plugin/` + theme, all `mergeDeep`'d. The TUI honors it too (`config/tui.ts:170,198`). So one env var = the entire agent toolchain, in both frontends.

## At a glance — before → after

```
BEFORE — patchwork: per-project, machine-specific, fragile
══════════════════════════════════════════════════════════
  volt init ──writes──► <EACH project>/.opencode/
                          ├─ opencode.json   lsp: "C:\Users\…\volt-lsp-codesys.exe"  ⚠ absolute → stale on update
                          ├─ tool/volt.ts    + bun/npm install @opencode-ai/plugin    ⚠ corporate proxy breaks it
                          └─ package.json
                          (agent · theme · permissions live in the DEV REPO ONLY ──► a consumer never gets them ✗)

   ✗ project not init'd  →  no LSP          ✗ 4 registration methods, split dev-repo vs consumer


AFTER — one dir shipped with the app, one env var, registered globally
══════════════════════════════════════════════════════════════════════
  ┌──────────────────────── Volt app  (installed once) ────────────────────────┐
  │  resources/volt/                                                            │
  │    bin/  ─────────────────────►  on PATH:  volt-lsp-codesys.exe · volt.exe  │
  │    volt-config/   ◄── OPENCODE_CONFIG_DIR points here  (ships STATIC)       │
  │      ├─ opencode.json   lsp: ["volt-lsp-codesys","--stdio"] ✓ bare → PATH   │
  │      ├─ tool/volt.ts                                  (cross-spawn resolves)│
  │      ├─ agent/volt.md                                                       │
  │      ├─ themes/volt.json                                                    │
  │      └─ node_modules/@opencode-ai/plugin   ✓ vendored (zod inlined, no npm) │
  └───────────────────────────────────┬────────────────────────────────────────┘
            desktop sidecar fork ──┐   │   ┌── CLI / TUI launcher
                                   └───┴───┘   both export OPENCODE_CONFIG_DIR
                                       │
                                       ▼
                            opencode server   (config.ts:424 → treats it as a full .opencode)
                                       │
         ┌──────────────┬─────────────┼─────────────┬──────────────┐
         ▼              ▼             ▼             ▼              ▼
       LSP           volt tool      agent         theme        permissions
     (.st nav)      (PLC verbs)   (volt.md)      (brand)       (ask gates)
         └─────────────── every project · ZERO `volt init` ───────────────┘

   volt init now writes ONLY:  .git/volt/config.json (IDE binding)  +  .claude/skills/ (vendor ref)
```

## The shipped dir (`resources/volt/volt-config/`)
```
volt-config/
  opencode.json        # lsp: { "volt-lsp-codesys": { command: ["volt-lsp-codesys","--stdio"], extensions:[...] } }
                       # permission: { bash: { "volt init*":"ask", "volt pull*":"ask", "volt push*":"ask" } }
  tool/volt.ts         # the custom tool (VOLT_BIN bare-name or resolved)
  agent/volt.md        # the Volt agent — consumers finally get it
  themes/volt.json     # brand theme
  node_modules/@opencode-ai/plugin/   # vendored (bundled, zod inlined)
```
This is the **single source** for the dev repo's `.opencode/{opencode.json,tool,agent,themes}` too — generate both from one template so they can't drift.

## Path resolution — bare-name first, absolute fallback
The LSP/tool paths are the only machine-specific risk. Two options, decided by the spike:
1. **Bare-name (preferred):** `command: ["volt-lsp-codesys","--stdio"]`; the installer's PATH entry (`resources/volt/bin`) resolves it. Zero machine-specific state → the dir ships **static**, no first-run write.
2. **Resolved-at-first-run (fallback):** if opencode's LSP spawn doesn't PATH-resolve a bare name, the desktop writes `volt-config/opencode.json` once at first-run with the absolute `process.resourcesPath`-relative path. Still one write at install, not per-project.

`tool/volt.ts`'s `VOLT_BIN` follows the same choice (bare `volt` on PATH, or resolved).

## Wiring `OPENCODE_CONFIG_DIR`
- **Desktop:** set it on the sidecar `utilityProcess.fork` env (`desktop/src/main/server.ts` `preferAppEnv` already shapes that env) → `path.join(process.resourcesPath, "volt", "volt-config")`.
- **CLI/TUI:** the `volt` launcher exports it before handing off to the opencode entry (sibling of the binary).

## Spikes to confirm before building (both have safe fallbacks)
1. **Does opencode's LSP spawn PATH-resolve a bare command on Windows?** (`packages/opencode/src/lsp/lsp.ts:160-181` — check the spawn API.) Yes → option 1. No → option 2.
2. **Does the sidecar fork inherit a set env var end-to-end?** Confirm `preferAppEnv` doesn't strip unknown vars; set `OPENCODE_CONFIG_DIR` and verify the server's loaded config shows the LSP (opencode debug / a log).

## What stays per-project (`volt init`)
- `.git/volt/config.json` — the IDE binding (genuinely per-project).
- `.claude/skills/*-reference/` — vendor-specific (CODESYS vs TwinCAT differs per project).
Everything else `writeOpencodeConfig` writes today is deleted.

## Supersedes
`harden-opencode-integration` Step 0's plugin-vendoring task folds in here (the plugin is vendored into `volt-config/node_modules`). The `<spinner>` + channel work there is unaffected.
