# ST Language Server — architecture

The design of `volt-lsp-iec`: a professional language server + compiler frontend for IEC 61131-3 Structured
Text (CODESYS / TwinCAT dialects), with the graphical FBD/LD languages as a native sublanguage and a Rust
transpiler backend for headless test execution.

This is the target design, stated as the ideal — not a migration. It is built bottom-up: freeze a layer's
contract, verify it against the tests, then let the next layer consume it. **Folders are layers; imports point
downward only** (`syntax ← symbols ← types ← analysis ← services ← server`), a lint-enforceable invariant.

## Principles

- **One frontend, many backends.** A clean semantic frontend (syntax → symbols → types) is consumed by
  independent backends: the LSP features (`analysis` + `services`), the graphical sublanguage, and the Rust
  transpiler. Each asks a different question of the same core; none is a parallel stack.
- **The AST models the language completely.** Type expressions carry structured bounds/lengths; literals carry
  value + type; initializers are expression trees. Consumers read structured nodes, never re-parse spans.
- **One source of truth per concern** — type facts, compatibility, rendering, scope navigation, symbol
  resolution, kind labels. A second list is a bug.
- **Conservative & non-authoritative.** Types are inferred to make diagnostics accurate; the IDE compiler
  stays authoritative for final type-checking and codegen. Unknown types skip — never a false positive.
- **Message parity by construction.** Every diagnostic the LSP shares with a compiler reads byte-identical to
  it, per vendor — enforced by the oracle replay, not hoped for.

## The stack

```
G  server        LSP 3.17 / stdio · dispatch · capabilities · push+pull diagnostics · progress · cancellation
F  reference · graphical      language data catalogs · the FBD/LD sublanguage (native, by reuse)
E  services      navigation · hierarchy · hover/completion/signature-help · inlay-hints · code-lens ·
                 semantic-tokens · structure · formatting · code-actions
D  analysis      diagnostics orchestrator · messages · the checks
C  types         elementary facts · Type model · resolve · const-eval · infer · compat · render
B  symbols       symbol table · binder · scope-nav
A  syntax        tokens · lexer · complete AST · parser + treewalker
                      ↘ transpile (Rust backend) consumes A·B·C directly — headless test execution
```

## Layers

### A — `syntax/`
Tokens, lexer (error-tolerant, trivia-preserving), the **complete AST** (declarations · type expressions with
structured dims/length/subrange/vector · statements · expressions · literals carrying value + type), and the
parser + treewalker. Contract: `parse(source) → { units, diagnostics }`; a body materializes to a statement
tree or a graphical marker. No semantics here.

### B — `symbols/`
The binder: `symbol` · `scope`, `binder` (AST → scope tree, workspace cross-indexed), and `scope-nav` (the one
scope-tree navigator). Contract: name → declaring symbol/scope.

### C — `types/`
The type system, the clean core: `elementary` (the type-facts source of truth — family, bits, signed, `bigint`
range, widening rank, aliases, `ANY_*`); the rich `Type` model (`UNKNOWN` is the total, conservative
fallback); `resolve` (TypeExpr → Type); `const-eval` (Expr → value); `infer` (Expr → Type, one engine);
`compat` (assignability · narrowing · arithmetic-result · conversion-source, one relation); `render`
(Type/TypeExpr → string, one renderer). Powers diagnostics, hover, completion, navigation, and codegen alike.

### D — `analysis/`
`diagnostics` (the orchestrator, vendor-keyed config), `messages` (per-vendor builders), and `checks/` — thin
rules on the type system, grouped by concern: `types/` · `declarations/` · `names/` · `oop/` · `pragmas/`. Each
check traces to a conformance fixture recorded against the live compiler.

### E — `services/`
The LSP features, thin over C/D via `shared/` (`resolve-at` cursor→symbol, positions, `locations`,
`symbol-kinds`, `token-scan`): navigation (definition · type-definition · references · rename · highlight ·
implementation), `hierarchy` (call + type), `assist` (hover · completion · signature-help), `inlay-hints`
(inferred types + parameter names), `code-lens` ("N references" · "▶ Run test"), `semantic-tokens`, `structure`
(document/workspace-symbol · folding · selection), `formatting` (print · editorconfig · on-type · range), and
`code-actions`.

### F — `reference/` · `graphical/`
`reference/` holds the language data catalogs (types · operators · conversions · pragmas · standard fns/fbs ·
lifecycle) — ranges derive from `types/elementary`. `graphical/` is the FBD/LD family: the readable text
encoding (`graphical/text/`, room for future formats), plus infer/checks/services that **reuse the shared
core** — one type engine, one orchestrator, one service set. Graphical is a second front-end that plugs in, not
a second stack.

### G — `server/`
LSP 3.17 over stdio (`--stdio` only), one vendor-keyed binary (`codesys | twincat | auto`): dispatch, framing,
capabilities, push **and** pull diagnostics, progress + cancellation, incremental document sync.

### Backend — `transpile/`
A compiler backend, sibling consumer of the frontend (`syntax ← symbols ← types`), not of the LSP. It lowers
the AST to a small IR carrying resolved types + constant values and emits Rust (`transpile/rust/`, umbrella for
future targets). IEC→Rust type mapping consumes `types/elementary` (INT→i16, BYTE→u8, subrange/overflow from
the ranges). Purpose: headless PLC-logic tests — `test/exec/` transpiles a POU, builds it, drives inputs across
scan cycles, and asserts outputs.

## Testing (built in)

Diagnostics match CODESYS and TwinCAT byte-for-byte, guaranteed by construction. `test/conformance/`:
`catalog/` (one fixture per rule) → `record.ts` (push each to the live bridge, build, capture the compiler's
exact diagnostics) → `recordings/` (the committed oracle truth) → `replay.test.ts` (offline; asserts the
message set is byte-identical per vendor — the single criterion; a `KNOWN_DIVERGENCES` ledger is the only
opt-out). `test/corpus/` is the real-project ratchet (a miss ⇒ add a fixture, never a threshold tweak); unit
tests co-locate with each module; `test/exec/` runs transpiled Rust. The loop: corpus miss → catalog fixture →
record → mirror the message → replay green. A diagnostic cannot ship unless it matches both compilers.

## Invariants

- Full test suite + corpus 0-ERROR ratchet + conformance replay green before every commit — the behavioral
  spec.
- One source of truth per concern.
- Conservative & non-authoritative: unknown types skip; the IDE owns final type-checking + codegen.
- Additive to the protocol; `inferExprType` is the frontend's public entry point.

Requirement-level contracts (compiler-parity, vendor-keying, error-tolerant parsing, VG ownership boundary,
library resolution, corpus verification) live in `spec.md`; the diagnostic-parity ledger in
`diagnostics-conformance.md`; the feature-phase roadmap in `toolchain-map.md`. This document is the structural
blueprint the build follows.
