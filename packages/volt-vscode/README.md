# @opencode-ai/volt-vscode

VS Code extension that gives PLC source files (`.st` today, more vendors and languages later) syntax highlighting, full language intelligence backed by an embedded CODESYS reference corpus, AND buttons / commands for the `volt` CLI so workspace ↔ IDE sync is one click away.

Three layers, each useful on its own:

1. **TextMate grammar** — works the moment the extension is installed. Highlights keywords, types, strings, comments, numeric literals (including based `16#FF`, typed `INT#42`, and duration `T#10s`). No process required.

2. **Language server** — spawned by the extension when a `.st` file is opened. Delivers hover (with CODESYS docs inline), goto-definition, references, document/workspace symbols, call hierarchy, type hierarchy, completion + signature help, 11 diagnostic checks, semantic tokens, folding ranges, document highlight, selection ranges, and code actions. The server lives in `@opencode-ai/volt-lsp-st`; the extension finds it via Node module resolution from the workspace.

3. **CLI integration** — status bar buttons + command palette entries that drive the `volt` CLI. `volt status` and `volt push` are status-bar one-clicks; `volt pull` / `volt build` / `volt init` live in the command palette. `volt push --force` opens a modal confirmation. `volt build` parses its JSON output into VS Code's Problems panel so build errors show inline as red squigglies.

## Install (development / local use)

```bash
# 1. Build the workspace (LSP server + extension TypeScript)
cd <repo root>
npm run build

# 2. Tell VS Code to load this extension from disk
code --extensionDevelopmentPath="<repo root>/packages/volt-vscode" .
```

Open any `.st` file in the new VS Code window. Syntax highlighting is immediate; the LSP starts on first `.st` activation (look for "Volt — Structured Text" in the Output panel).

## Install (packaged `.vsix`)

```bash
npm run --workspace=@opencode-ai/volt-vscode package
# produces volt-vscode-0.0.1.vsix in packages/volt-vscode/
code --install-extension packages/volt-vscode/volt-vscode-0.0.1.vsix
```

## Resolving the LSP server

The extension auto-discovers `@opencode-ai/volt-lsp-st` by walking up from your workspace folder looking for `node_modules/@opencode-ai/volt-lsp-st/dist/bin.js`. If your workspace doesn't have the package as a dep, the extension also checks the extension's install dir and the global npm dir.

Explicit override (settings):

```json
{
  "volt.structuredText.lspServer": "C:/path/to/volt-lsp-st/dist/bin.js"
}
```

If the server can't be found, syntax highlighting still works — the LSP-powered features (hover, goto, etc.) just won't fire, and you'll see a warning toast.

## Adding another PLC language

The extension is wired language-neutral. To add (say) Instruction List:

1. Drop a TextMate grammar + language-configuration into `languages/instruction-list/`.
2. Register a new entry in `package.json`:
   ```json
   { "id": "instruction-list", "extensions": [".il"], "configuration": "./languages/instruction-list/language-configuration.json" }
   ```
3. Add a row to `PLC_LANGUAGES` in `src/extension.ts` pointing at the corresponding LSP package.

The extension activates per language id; one LSP client is started per registered language.

## Layout

```
packages/volt-vscode/
├── package.json                          extension manifest (languages, grammars, settings, commands)
├── src/
│   ├── extension.ts                      activate/deactivate + LSP client lifecycle
│   └── cli.ts                            volt CLI integration (commands, status bar, build diagnostics)
└── languages/
    └── structured-text/
        ├── language-configuration.json   brackets, comments, folding markers
        └── syntax.tmLanguage.json        TextMate grammar
```

## Settings

All of the LSP's tunables are exposed as VS Code settings under `volt.structuredText.*`. Changes hot-reload — the language server restarts when a setting changes.

| Setting | Default | Effect |
|---|---|---|
| `lspServer` | `""` (auto) | Override LSP bin path |
| `trace` | `"off"` | LSP trace level: off / messages / verbose |
| `hover.showSource` | `true` | Append CODESYS doc URL to hover |
| `completion.snippetSupport` | `true` | Snippet expansions for pragmas |
| `diagnostics.<check>` | `true` | Toggle each of 11 diagnostic checks individually |

Diagnostic flags: `reservedKeyword`, `doubleUnderscore`, `consecutiveUnderscores`, `duplicateDeclaration`, `unresolvedIdentifier`, `unknownPragma`, `pragmaMissingCompanion`, `pragmaConflict`, `fbLifecycleSignature`, `shadowingDeclaration`, `initSlotCollision`.

## Commands

LSP control:
- `Volt: Restart Language Server` — restart all PLC LSP clients
- `Volt: Show Structured Text Output` — open the LSP output channel
- `Volt: Open CODESYS Language Reference` — open the local corpus (offers to run `volt init` if missing)

CLI shortcuts (all run in the integrated terminal named "Volt"):
- `Volt: Status` — `volt status` (read-only drift check)
- `Volt: Pull (bridge → workspace)` — `volt pull`
- `Volt: Push (workspace → bridge)` — quick-pick between normal and `--force`; force-push opens a modal confirmation
- `Volt: Build (writes diagnostics to Problems panel)` — runs `volt build`, parses JSON output, populates VS Code's Problems panel + maps errors to `.st` files inline
- `Volt: Init Workspace` — `volt init`

## Status bar

Three items, right-aligned:
- `$(check) Structured Text` — LSP health (running / starting / failed / not found). Click → opens output channel.
- `$(git-pull-request) Volt: Status` — runs `volt status`.
- `$(cloud-upload) Volt: Push` — opens push quick-pick (normal vs force).

## CLI requirements

The CLI integration assumes the `volt` binary is on `PATH`. `bun install` populates `node_modules/.bin/volt` automatically from the `@opencode-ai/volt-agent` workspace package. For non-standard installs, override via:

```json
{
  "volt.cli.path": "/abs/path/to/volt"
}
```

## Build diagnostics → Problems panel

`Volt: Build` captures `volt build`'s JSON output (the CLI emits `{ success, errors, warnings, diagnostics: [...] }` on stdout), parses each diagnostic, maps it to the corresponding `POUs/<name>.st` file in the workspace, and pushes it into a `volt-build` `DiagnosticCollection`. Errors show as red squigglies inline + entries in the Problems panel; warnings show as yellow. The collection clears on the next build so stale errors don't accumulate.

If a diagnostic can't be mapped to a file (e.g. project-level errors with no `object` field), it's dropped silently — better to lose one than to pin it to the wrong file.

## Status

- ✅ Syntax highlighting (TextMate grammar)
- ✅ Hover with CODESYS docs (via `@opencode-ai/volt-lsp-st`)
- ✅ Goto-definition, references, document/workspace symbols
- ✅ Call hierarchy + type hierarchy
- ✅ Completion + signature help (with two-phase resolve)
- ✅ Semantic tokens (richer than TextMate)
- ✅ 11 diagnostic checks with quick-fix code actions
- ✅ Folding ranges, document highlight, selection ranges
- ⏳ Inlay hints, code lens (future polish)
- ⏳ Other PLC languages (the structure's ready; grammars + LSPs aren't)

## Tip: Volt's `(* folder: X *)` annotation

The grammar gives our metadata comment its own scope (`meta.annotation.folder.structured-text`) so themes can color it distinctly from regular comments. Useful visual cue that the annotation is load-bearing — the engine reads it to round-trip in-FB folder organization to the bridge.
