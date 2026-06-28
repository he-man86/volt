# @opencode-ai/volt-lsp

> TypeScript-native LSP for IEC 61131-3 Structured Text — navigation, diagnostics, and language intelligence over `.st`.

A from-scratch language server for Structured Text (the textual IEC 61131-3 language used by CODESYS and
TwinCAT/Beckhoff), written in TypeScript with no LSP framework. It speaks LSP 3.17 JSON-RPC over stdio and is
navigation-and-diagnostics first: type-checking and code generation stay the IDE's job.

## Role in Volt

This is the analysis layer of the Volt data path. `volt-git` materializes a live PLC project into one text file per
item under the project root; this LSP analyzes those files. opencode and editors attach it for `.st` (and the related
text extensions `volt-git` writes — `.gvl`, `.struct`, `.enum`, `.union`, `.alias`), and it cross-indexes the whole
workspace so types declared in unopened files resolve.

It provides go-to-definition, find-references, implementation, document/workspace symbols, call hierarchy, type
hierarchy, hover, completion, signature help, semantic tokens, folding, document highlights, selection ranges, rename,
conservative formatting, code actions, and both push and pull diagnostics. It does not type-check or generate code —
the CODESYS/TwinCAT compiler remains authoritative. Graphical bodies are handled too: FBD/LD bodies round-trip through
a textual **VG** form (Volt Graphical), which this server parses and analyzes as a first-class sublanguage rather than
as ST.

## How it works

The pipeline is a layered, single-direction stack (the rust-analyzer shape): `lexer` → `parser` → `semantic` → `lsp`,
with `reference` as a pure-data sidecar that none of the lower layers depend on.

- **Lexer / parser.** `src/lexer/` tokenizes ST; `src/parser/` builds an AST, with one parser per POU kind under
  `parser/units/` (program, function, function-block, method, action, property, interface, type-decl, namespace,
  global-var-list). The parser is error-tolerant so a half-typed file still yields symbols and diagnostics.
- **Semantic layer.** `src/semantic/` builds the symbol table and project scope, a name resolver, and a language-neutral
  `BodyModel` per POU body. Diagnostics are a registry of small checks in `semantic/checks/` (identifier shape, unresolved
  identifiers, pragmas, FB lifecycle signatures, shadowing, interface implementation, type/operator/assignment mismatch,
  deref-on-non-pointer, vendor-only operators, and the VG checks), each gated by a per-check enable flag. The default
  config mirrors TwinCAT: a check is on only if TC itself rejects the code; stricter-than-TC lints ship off-by-default.
- **Embedded language reference.** `src/reference/` is structured, machine-readable facts (keywords, data types,
  operators, type conversions, pragmas, lifecycle methods, standard FBs, init slots) derived from the markdown corpora in
  `docs/codesys-reference/` and `docs/twincat-reference/`. It drives hover and completion content and the pragma/vendor
  diagnostics. Each entry is tagged `shared | codesys | twincat`; an `initializationOptions.vendor` setting
  (`codesys | twincat | auto`) selects the active dialect, so a CODESYS project never suggests TwinCAT-only names.
- **LSP wire.** `src/lsp/` is the only layer that knows LSP types. `lsp/server/` hand-rolls JSON-RPC framing, a flat
  request/notification dispatcher, debounced (push) diagnostics, and cancellation; `lsp/queries/` has one module per
  capability (with `queries/vg/` mirroring them for graphical bodies). `runServer({ input, output })` is embeddable on
  any stream pair. Capabilities are advertised gated by what the client declares it supports.
- **Graphical bodies (VG).** A POU body whose first significant token is `NETWORK` is routed to `src/vg/` (lexer-on-tokens,
  parser, writer, type inference) and the `queries/vg/` handlers instead of the ST path. This is the textual form of an
  editable FBD/LD body; CFC/SFC are read-only and not analyzed here.

The directory is `volt-lsp-st` (this server is ST-specific, leaving room for sibling language servers — see
`ADDING-A-NEW-LSP.md`), while the published package is `@opencode-ai/volt-lsp`. The bin is `volt-lsp-st` → `dist/bin.js`;
opencode and editors only ever spawn it with `--stdio`.

## Commands

Per-package, from `packages/volt-lsp-st`:

```bash
bun typecheck        # tsgo --noEmit
bun test             # bun test runner (unit + conformance + e2e under src/tests/)
bun run build        # tsc -> dist/ (also runs on `prepare`, i.e. before publish)
bun run dev          # tsc --watch
```

The e2e tests spawn the built `dist/bin.js`, so build before running the full suite. Standalone, the bin also exposes
`volt-lsp-st lex <file>` (dump the token stream) and `--version`.

Launched and verified inside opencode from the repo root (opencode spawns the server lazily, with `cwd` = the project
dir, so it must be the built monorepo root — see `ADDING-A-NEW-LSP.md`):

```bash
bun volt-scripts/verify-lsp.ts   # non-interactive proof: plants a bad .st, asserts source:"volt-lsp-st" diagnostics
bun volt-scripts/dev.ts          # opencode TUI from source with this LSP attached for .st files
```

## Layout

| Path | Role |
|---|---|
| `src/bin.ts` | CLI entry — routes `--stdio` to the server, plus `lex` / `--version` |
| `src/index.ts` | Public API re-exports (consumed by `volt-git` + the VS Code extension + the conformance harness) |
| `src/lexer/` | ST tokenizer (`lex`, tokens, spans) |
| `src/parser/` | AST + per-POU-kind parsers (`parser/units/`), type expressions, VAR sections |
| `src/semantic/` | Symbol table, resolver, type resolver, `BodyModel`, diagnostics orchestrator + `checks/` registry |
| `src/reference/` | Structured CODESYS/TwinCAT language facts (pure data) driving hover, completion, pragma diagnostics |
| `src/vg/` | VG (graphical FBD/LD textual form) — parser, writer, type inference, operator table |
| `src/lsp/` | LSP wire: `server/` (framing/dispatch/diagnostics-push), `queries/` (+ `queries/vg/`), `capabilities`, `config/`, `workspace` |
| `src/init.ts` | `installCorpus` — copies the reference corpus + writes `SKILL.md` into a consumer project at `volt init` |
| `src/detect-vendor.ts` | Vendor auto-detection from project files |
| `src/bridge-diagnostic-lines.ts` | Maps an IDE build diagnostic onto a line in the assembled `.st` file |
| `src/tests/` | Unit tests + the replayable conformance harness (`tests/conformance/`) and live/e2e tests |
| `docs/` | `codesys-reference/` + `twincat-reference/` corpora (shipped via `files`), `plcopen-xml/` notes |

## See also

- [`./ADDING-A-NEW-LSP.md`](./ADDING-A-NEW-LSP.md) — how a second/Nth Volt language server is added and proven to load
- [`../../VOLT-DESIGN.md`](../../VOLT-DESIGN.md) — Volt design, roadmap, and decision log
- [`../../CLAUDE.md`](../../CLAUDE.md) — fork overview, architecture, and conventions
