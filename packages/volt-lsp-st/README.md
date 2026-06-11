# @opencode-ai/volt-lsp-st

A TypeScript-native Language Server for IEC 61131-3 Structured Text (ST), the textual language used by CODESYS, TwinCAT, and most modern PLC IDEs.

The server is **navigation + diagnostics first**. Type-checking and code generation are explicitly out of scope — the IDE (CODESYS / TwinCAT / etc.) remains authoritative for those.

## What it does

Advertised LSP capabilities (LSP 3.17):

- `textDocument/documentSymbol` — outline view
- `textDocument/definition` — go to declaration
- `textDocument/references` — find all references
- `textDocument/implementation` — find FBs that `IMPLEMENTS` an interface
- `textDocument/hover` — declaration line + CODESYS reference docs (rich markdown)
- `workspace/symbol` — project-wide symbol search
- `textDocument/prepareCallHierarchy` + `callHierarchy/{incoming,outgoing}Calls`
- `textDocument/prepareTypeHierarchy` + `typeHierarchy/{super,sub}types`
- `textDocument/completion` + `completionItem/resolve` — two-phase completion (keywords, types, operators, pragmas, local symbols, member access)
- `textDocument/signatureHelp` — parameter info on FB/method/function calls
- `textDocument/semanticTokens/full` — semantic coloring (keyword / type / function / variable / pragma / etc.)
- `textDocument/foldingRange` — folds POU bodies, VAR sections, type bodies, namespaces, region pragmas
- `textDocument/documentHighlight` — same-symbol highlights in the current document
- `textDocument/selectionRange` — AST-aware smart-expand (identifier → declaration → VAR section → POU)
- `textDocument/codeAction` — quick fixes for fixable diagnostics
- `textDocument/publishDiagnostics` — push, 150ms debounced
- `textDocument/diagnostic` — pull (LSP 3.17, advertised only when client opts in)
- `$/cancelRequest` — cancellation honored on the wire boundary
- `TextDocumentSyncKind.Incremental` document sync

The local CODESYS reference (14 MD files, 250+ sub-pages catalogued) lives at [`docs/codesys-reference/`](./docs/codesys-reference/00-index.md). TwinCAT 3 deltas live at [`docs/twincat-reference/`](./docs/twincat-reference/00-index.md). Both power hover, completion, and diagnostics content.

## Dual-vendor support

This LSP serves both **CODESYS** and **TwinCAT** (Beckhoff). TwinCAT shares ~90% of the language (it was forked from CODESYS V3); the reference catalog tags each entry with `vendor: "shared" | "codesys" | "twincat"` and the active vendor is selected via `initializationOptions.vendor` (or `"auto"` for filesystem detection).

The `wrong-vendor-pragma` diagnostic fires when a vendor-specific pragma is used in the other vendor's project, with an `equivalentIn` suggestion where one exists.

## Diagnostics

Mechanical checks driven by the reference catalog:

| Check | Severity | What it catches |
|---|---|---|
| `reserved-keyword` | Error | Identifier matches a reserved keyword |
| `double-underscore-prefix` | Error | Identifier starts with `__` (reserved for system-generated names) |
| `consecutive-underscores` | Error | `_{2,}` anywhere in identifier |
| `duplicate-declaration` | Error | Two declarations with the same name in the same scope |
| `unresolved-identifier` | Warning | Identifier in a body that doesn't resolve in any reachable scope |
| `unknown-pragma` | Warning | Pragma name not in either vendor's catalog |
| `wrong-vendor-pragma` | Warning | Pragma known but belongs to the OTHER vendor — suggests equivalent |
| `pragma-missing-companion` | Error | `instance-path` / `is_connected` without `reflection` on parent FB |
| `pragma-conflict` | Warning | `pingroup` coexists with `pin_presentation_order_*` |
| `fb-lifecycle-signature` | Error | `FB_Init` / `FB_Reinit` / `FB_Exit` with wrong return type or parameters |
| `shadowing-declaration` | Information | A declaration shadows a same-name symbol in an outer scope |
| `init-slot-collision` | Warning | `{attribute 'global_init_slot' := 'N'}` collides with a reserved slot |
| `conversion-source-mismatch` | Warning | `<X>_TO_<Y>(arg)` where arg's type isn't `<X>` — suggests the right conversion |

Each check has an enable flag in `initializationOptions.diagnostics` — disable selectively to mute noise.

## Install

```bash
npm install --save-dev @opencode-ai/volt-lsp-st
```

The package ships a `volt-lsp-st` binary that speaks LSP over stdio.

## Using with VS Code

This package is consumed by the `@opencode-ai/volt-vscode` extension, which spawns it as a language server. No standalone configuration needed — install the extension and `.st` files light up.

## Using with opencode (and Claude Code)

[opencode](https://opencode.ai) is an AI coding agent that talks to LSP servers for real-time code intelligence. There are two integration layers:

### 1. Reactive intelligence — LSP

Add an entry to your `opencode.jsonc`:

```jsonc
{
  "lsp": {
    "volt-st": {
      "command": ["node", "node_modules/@opencode-ai/volt-lsp-st/dist/bin.js", "--stdio"],
      "extensions": [".st", ".iecst", ".exp"]
    }
  }
}
```

In a monorepo workspace consuming this package directly, point at the workspace path instead:

```jsonc
"command": ["node", "packages/volt-lsp-st/dist/bin.js", "--stdio"]
```

Why absolute paths and not bare `["volt-lsp-st", "--stdio"]`: on Windows, bun does not create `node_modules/.bin` symlinks for private workspace packages, so the bare bin name does not resolve. Absolute paths work the same on every platform.

opencode will then automatically start the server when you open a `.st` file. The AI in your opencode session receives:

- Parse-error diagnostics as you edit (debounced 150ms)
- Hover content (file types, FBs, methods, variables — and starting in Phase 2, full CODESYS docs)
- Go-to-definition, find-references, document/workspace symbols, call hierarchy

opencode does not consume completion / semantic tokens / signature help (the LLM proposes code directly), so those features — when shipped in later phases — are inert for opencode and active for VS Code.

### 2. Proactive knowledge — Skill

Running `volt init` (from `@opencode-ai/volt-cli`) in a workspace installs:

- `docs/codesys-reference/` — the language reference corpus
- `.claude/skills/st-reference/SKILL.md` — an [agent skill](https://opencode.ai/docs/skills/) that points to the corpus

Both opencode and Claude Code discover skills from `.claude/skills/`. The skill is loaded on-demand (lazy, token-efficient) when the agent decides it needs language details — pragma semantics, FB lifecycle, shadowing rules, etc. The agent invokes it via `skill({ name: "st-reference" })`.

This is the future-proof pattern that scales to multiple LSPs: each LSP package ships its own SKILL.md. Adding a new language reference doesn't bloat the always-loaded context — only the skill descriptions appear there, and full content loads only when relevant.

## Using with other LSP clients

The server is spec-compliant LSP 3.17. Any client that speaks JSON-RPC framed messages on stdio works. Helix, Neovim with `nvim-lspconfig`, Emacs `lsp-mode`, Zed — all should work out of the box.

Generic invocation:

```bash
volt-lsp-st --stdio
```

## Initialization options

Pass via LSP `initializationOptions` at the `initialize` handshake. All fields are optional; defaults are sensible.

```jsonc
{
  "diagnostics": {
    // Per-check enable flags. All true by default.
    "reservedKeyword": true,
    "doubleUnderscore": true,
    "consecutiveUnderscores": true,
    "duplicateDeclaration": true,
    "unresolvedIdentifier": true,
    "unknownPragma": true
  },
  "hover": {
    "showSource": true  // append the CODESYS doc URL to hover content
  },
  "completion": {
    "snippetSupport": true  // honor LSP snippet syntax in completion items
  }
}
```

## Architecture

Layered modules with strict dependency direction (rust-analyzer pattern):

```
src/
├── lexer/        tokenization — knows nothing about higher layers
├── parser/       AST — depends only on lexer
├── semantic/     symbol tables, name resolution, diagnostics — knows nothing about LSP
├── reference/    structured CODESYS language facts (Phase 2) — pure data
└── lsp/          LSP wire + JSON-RPC framing — only place that knows about LSP types
    ├── server.ts             event loop, request dispatch, debouncing, cancellation
    ├── capabilities.ts       client-gated capability advertisement
    ├── workspace.ts          document manager (uses vscode-languageserver-textdocument)
    ├── config.ts             initializationOptions shape
    ├── types.ts              re-exports from vscode-languageserver-protocol
    └── queries/<feature>.ts  one file per LSP capability
```

Dependencies (type-only / utility, no framework):

- [`vscode-languageserver-protocol`](https://github.com/microsoft/vscode-languageserver-node) — canonical LSP type definitions
- [`vscode-languageserver-textdocument`](https://github.com/microsoft/vscode-languageserver-node) — incremental document buffer

JSON-RPC framing is hand-rolled in `src/lsp/server.ts` — no framework. The server is embeddable from any `Readable`/`Writable` stream pair: `runServer({ input, output })`.

## Development

```bash
npm install
npm run build      # tsc -b
npm test           # vitest run — 168 tests (158 unit + 10 e2e)
npm run typecheck  # tsc --noEmit
npm run dev        # tsc -b --watch
```

End-to-end tests spawn the built binary and exercise each advertised capability via real LSP traffic. They skip if `dist/bin.js` is missing — run `npm run build` first if needed.

## Test status

263 tests passing across 14 files:

- Lexer (~80 incl. address literals + ExST ops + backticks + operator keywords), parser (~55 incl. NAMESPACE + implicit enums + VAR_GENERIC), symbol table (~16 incl. namespace scope), resolver (12)
- Queries: definition (4), references (3), document-symbol (7), phase4 (16, hover/workspace/call/type), completion (6), semantic-tokens (8)
- Reference modules (11)
- Diagnostics (35) — incl. wrong-vendor-pragma + conversion-source-mismatch
- LSP end-to-end (11)
- Init (8) — corpus install / CLAUDE.md merge / idempotency

End-to-end tests spawn the built binary and exercise each advertised capability via real LSP traffic. They skip if `dist/bin.js` is missing — run `npm run build` first.

## Corpus install (called from `volt init`)

The package exports an `installCorpus()` helper consumed by `volt-agent`'s `volt init` command. When a user runs `volt init` in a PLC workspace, the corpus + a CLAUDE.md pointer is copied into that workspace so any AI session there can read the language reference proactively.

```ts
import { installCorpus } from "@opencode-ai/volt-lsp-st";
const result = await installCorpus({ targetDir: ".", update: false });
// → copies docs/codesys-reference/ into targetDir, manages CLAUDE.md
```

Idempotent. Re-running without `update: true` is a no-op.
