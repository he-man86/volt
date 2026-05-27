# @opencode-ai/volt-vscode

VS Code extension that gives PLC source files (`.st` today, more vendors and languages later) syntax highlighting + full language intelligence backed by an embedded CODESYS reference corpus.

Two layers, both useful on their own:

1. **TextMate grammar** — works the moment the extension is installed. Highlights keywords, types, strings, comments, numeric literals (including based `16#FF`, typed `INT#42`, and duration `T#10s`). No process required.

2. **Language server** — spawned by the extension when a `.st` file is opened. Delivers hover (with CODESYS docs inline), goto-definition, references, document/workspace symbols, call hierarchy, type hierarchy, completion + signature help, 11 diagnostic checks, semantic tokens, folding ranges, document highlight, selection ranges, and code actions. The server lives in `@opencode-ai/volt-lsp-st`; the extension finds it via Node module resolution from the workspace.

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
├── package.json                          extension manifest (languages, grammars, settings)
├── src/extension.ts                      LSP client lifecycle, server-path resolution
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

- `Volt: Restart Language Server` — restart all PLC LSP clients
- `Volt: Show Structured Text Output` — open the LSP output channel
- `Volt: Open CODESYS Language Reference` — open the local corpus (offers to run `plc init` if missing)

## Status bar

Right-side status item shows LSP health: `$(check)` running, `$(sync~spin)` starting, `$(error)` failed, `$(warning)` not found. Click to open the output channel.

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
