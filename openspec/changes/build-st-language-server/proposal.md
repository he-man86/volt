## Why

Volt needs a professional language server for IEC 61131-3 Structured Text (CODESYS / TwinCAT dialects) that is
also a reusable compiler frontend. The design goal is a clean layered core — syntax → symbols → types — that
several backends consume without duplicating it: the LSP features today, the FBD/LD graphical sublanguage as a
native front-end, and a Rust transpiler for headless test execution next. The defining quality is **message
parity**: every diagnostic the server shares with a compiler reads byte-identical to it, per vendor, enforced
by an oracle replay against the live IDEs — so the editor and the build pane never disagree.

The professional bar means the AST models the language completely (structured type expressions, literals with
value + type, initializers as expression trees), so backends read structured nodes rather than re-parsing
spans; one source of truth per concern (type facts, compatibility, rendering, scope navigation); a conservative
type layer that defers final authority to the IDE (unknown types skip — never a false positive); and the modern
LSP 3.17 feature set (inlay hints, code lens, type-definition, pull diagnostics, progress, cancellation).

## Capabilities

### New Capabilities

- **`st-language-server`** — the whole server, specified by its layered architecture: a syntactic + semantic
  **frontend** (`syntax`, `symbols`, `types`), the LSP **feature backend** (`analysis` diagnostics +
  `services` features), the **graphical** sublanguage (FBD/LD as readable text, native by reuse of the core),
  and a **Rust transpile** backend for headless PLC-logic tests. Diagnostics match CODESYS + TwinCAT
  byte-for-byte, proven by a record→replay oracle harness and a real-project corpus ratchet.

## Impact

- `packages/volt-lsp-iec/src/` is built to the layered structure in `design.md` (folders = layers, imports
  point downward only). Public API (`inferExprType`, the LSP entry) and the wire/protocol are stable.
- Supersedes the legacy `language-server` spec framing and the `restructure-semantic-foundation` change; the
  build proceeds against this clean spec, with the existing test suite + corpus + conformance replay as the
  behavioral floor.
