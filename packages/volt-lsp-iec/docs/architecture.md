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
G  server        LSP 3.17 / stdio · dispatch · capabilities · WorkspaceStore (eager index + watched-file
                 freshness) · push+pull diagnostics · progress
F  reference · graphical      language data catalogs · the FBD/LD sublanguage (native, by reuse)
E  services      navigation · hierarchy · hover/completion/signature-help · inlay-hints · code-lens ·
                 semantic-tokens · structure · formatting · code-actions
D  analysis      diagnostics orchestrator · messages · the checks
C  types         elementary facts · Type model · resolve · const-eval · infer · compat · render
B  symbols       symbol table · binder · scope-nav · bodies (the shared ST-body iterator)
A  syntax        tokens · lexer · complete AST · parser + treewalker
                      ↘ transpile (Rust backend) consumes A·B·C directly — headless test execution
```

## Layers

### A — `syntax/`
Tokens, lexer (error-tolerant, trivia-preserving), the **complete AST** (declarations · type expressions with
structured dims/length/subrange/vector · statements · expressions · literals carrying value + type), and the
parser + treewalker. Contract: `parse(source) → { units, diagnostics }`; a body materializes to a statement
tree or a graphical marker. No semantics here. Modern parser concerns: **incremental re-parse** of the edited
region (perf on large files, paired with the server's incremental sync); **error-recovery nodes** in the tree
so completion/navigation still work inside a broken region. Design call: the tree is an AST + `BodySpan` trivia,
NOT a fully-lossless CST — enough for round-trip/formatting without the CST's weight (revisit only if
tree-rewriting refactors are needed).

### B — `symbols/`
The binder: `symbol` · `scope`, `binder` (AST → scope tree, workspace cross-indexed; property getter/setter
each bind their own accessor scope), `scope-nav` (the one scope-tree navigator), and `bodies` (the one
scope-aware "walk every ST body" iterator — POU bodies **and** property accessor bodies — shared by every
analysis check and the language services). Contract: name → declaring symbol/scope.

### C — `types/`
The type system, the clean core: `elementary` (the type-facts source of truth — family, bits, signed, `bigint`
range, widening rank, aliases, `ANY_*`); the rich `Type` model (`UNKNOWN` is the total, conservative
fallback); `resolve` (TypeExpr → Type); `const-eval` (Expr → value); `infer` (Expr → Type, one engine);
`compat` (assignability · narrowing · arithmetic-result · conversion-source, one relation); `render`
(Type/TypeExpr → string, one renderer). Powers diagnostics, hover, completion, navigation, and codegen alike.

### D — `analysis/`
`diagnostics` (the orchestrator, vendor-keyed config), `messages` (per-vendor builders), and `checks/` — thin
rules on the type system, grouped by concern: `types/` · `declarations/` · `names/` · `oop/` · `calls/` ·
`pragmas/`. Every body-walking check iterates through `symbols/bodies` (one loop, not a per-check copy). Each
check traces to a conformance fixture recorded against the live compiler.

### E — `services/`
The LSP features, thin over C/D via `shared/` (`resolve-at` cursor→symbol, positions, `locations`,
`symbol-kinds`, `token-scan`): navigation (definition · type-definition · references · rename · highlight ·
implementation), `hierarchy` (call + type), `assist` (hover · completion · signature-help), `inlay-hints`
(inferred types + parameter names), `code-lens` ("N references" · "▶ Run test"), `semantic-tokens`, `structure`
(document/workspace-symbol · folding · selection), `formatting` (print · editorconfig · on-type · range), and
`code-actions`.

### F — `reference/` · `network/`
`reference/` holds the language data catalogs (types · operators · conversions · pragmas · standard fns/fbs ·
lifecycle) — ranges derive from `types/elementary`. `network/` is the FBD/LD family: the readable text
encoding (`network/text/`, room for future formats), plus infer/checks/services that **reuse the shared
core** — one type engine, one orchestrator, one service set. Graphical is a second front-end that plugs in, not
a second stack.

### G — `server/`
LSP 3.17 over stdio (`--stdio` only), one vendor-keyed binary (`codesys | twincat | auto`): dispatch, framing,
capabilities, and lifecycle. Thin handlers over the layers below; the state and the non-trivial compute live in
three server modules:
- `workspace-store` — the **WorkspaceStore**: the open-buffer and on-disk source layers merged by normalized
  URI (open buffer wins), a `(uri, version)` parse cache, the memoized project symbol table, and the
  reference-crawl state. Backs the eager whole-workspace index (crawled on `initialized`) and stays fresh via
  `workspace/didChangeWatchedFiles` (freshness comes from watched-file events, **not** file-operation events —
  those are out of scope; one item per file makes a rename just a delete+create the watcher already reports).
- `diagnostics` — the one `documentDiagnostics(store, messages, doc)` compute shared by the **push** transport
  (`publishDiagnostics` on open/change) and the **pull** transport (`textDocument/diagnostic` ·
  `workspace/diagnostic`), so the two can never diverge.
- `server` — the dispatch itself: incremental document sync, semantic tokens (full · range · delta),
  refresh-after-reindex, live configuration, and work-done progress around the crawl.

Every advertised capability has a registered handler — an invariant guarded by a parity test (see `spec.md`,
"The LSP-3.17 conformance surface is declared and kept in capability↔handler parity").

### Backend — `transpile/`
A compiler backend, sibling consumer of the frontend (`syntax ← symbols ← types`), not of the LSP.

```
AST ──lower/──> ir/ ──┬── interp/       runs it — the oracle
                      └── emit/rust/    prints it + a source map
```

`ir/` is the one contract; `lower/` owns every ST semantic; the backends own none. That split is enforced by
`check-layering.ts`: inside `transpile/`, **only `ir/` is importable across folders**, so a backend cannot
reach into the lowering and let a semantic decision drift out of its single home.

**Two decisions carry the design.**

*Places, not references.* ST's memory model is one static image — instances are fixed allocations, `VAR_IN_OUT`
is a pointer, `POINTER TO`/`REFERENCE TO` are real aliases, GVLs are global mutable state. Mapping any of that
to Rust `&mut` loses to the borrow checker the moment two aliases live at once, so **nothing lowers to a Rust
reference**. A POU is a flat frame of slots; a name is a slot index; pointers will become indices into that
same frame. The emitted struct's `&mut self` is the only borrow in the output, which is what makes 100%
coverage reachable rather than a wall at the first aliasing construct.

*The IR carries the semantics.* Implicit widening is an explicit `convert` node, CASE ranges are resolved
constant bounds, FOR/WHILE/REPEAT are one `loop`, and every node carries a resolved `Type` from `types/` —
not a second type model. **If a backend ever has to decide something, the lowering is incomplete.**

Note the frontend split this forces: `inferExprType` answers the LSP's question and returns `UNKNOWN` wherever
a guess would be a false positive (`REAL + INT` among them). A backend cannot emit `UNKNOWN`, so lowering
computes operator types over the same widening lattice `types/elementary` owns, and an expression that still
lands on `UNKNOWN` is a reported gap — never untyped IR. Likewise IEC integer literals are polymorphic: they
take their type from context, and from the sibling operand before the assignment target (`rate := n / 2` with
`n : INT` divides in INT and converts the result).

The three correctness essentials, all live: **source maps** (emitted line → ST span, so a panic points at the
ST); **codegen diagnostics** (`LowerDiagnostic` — lowering is total and never throws, so an untestable POU is
reported, never silently wrong); **deterministic numerics** (IEC integers wrap at the declared width, so
arithmetic emits `wrapping_*` rather than Rust's panicking defaults; widths come from `types/elementary`).

Coverage is measured, not asserted: `scripts/lower-completeness.ts` lowers the whole corpus and ranks the
constructs blocking it, so the next thing to build is a number. Its denominator is POUs **with a body** — most
units in a real project are empty-bodied, with their logic in separate METHOD/ACTION units, and counting those
reports a comfortable percentage while nothing real runs.

## Testing (built in)

Diagnostics match CODESYS and TwinCAT byte-for-byte, guaranteed by construction. `test/conformance/`:
`catalog/` (one fixture per rule) → `record.ts` (push each to the live bridge, build, capture the compiler's
exact diagnostics) → `recordings/` (the committed oracle truth) → `replay.test.ts` (offline; asserts the
message set is byte-identical per vendor — the single criterion; a `KNOWN_DIVERGENCES` ledger is the only
opt-out). `test/corpus/` is the real-project ratchet (a miss ⇒ add a fixture, never a threshold tweak); unit
tests co-locate with each module; `test/exec/` runs transpiled Rust. The loop: corpus miss → catalog fixture →
record → mirror the message → replay green. A diagnostic cannot ship unless it matches both compilers.

## Preventing duplication (one home per concern — enforced, not hoped)

The failure mode this architecture exists to kill is the same fact/type created in many places (type ranges
across 6 files, 4 type renderers, 6 scope walks). Three mechanisms make the *right* home the *easy* home so a
builder — human or AI — can't re-create what already exists:

**1. The ownership map.** Every reusable concept has exactly ONE owning module. Before adding a type or
constant, look it up here; if it exists, import it — never redefine.

| Concept | Owner |
|---|---|
| Source spans, tokens | `syntax/` (`Span`, `Token`) — the shared foundation everything imports down to |
| AST node types | `syntax/ast` |
| Symbols, scopes | `symbols/` |
| Scope-tree navigation | `symbols/scope-nav` |
| **"Walk every ST body"** (unit + scope + parsed statements, incl. property accessors) | `symbols/bodies` — the one iterator shared by checks + services |
| Call → callee + parameters (VAR_INPUT, base-first through EXTENDS) | `types/infer` `resolveCallee` — shared by signature-help + the call-argument check |
| **Elementary type facts** (ranges, families, bits, signed, rank, aliases) | `types/elementary` — the type-facts SSOT |
| The `Type` model | `types/type` |
| Type compatibility (assignable/narrowing/arith/conversion) | `types/compat` |
| Constant evaluation | `types/const-eval` |
| Type/expr rendering | `types/render` — the ONE renderer |
| Diagnostic message building (per-vendor) | `analysis/messages` |
| Vendor differences | `analysis` vendor-difference registry (data; see `language-reference.md` §10) |
| Cursor → symbol resolution | `services/shared/resolve-at` |
| Symbol → Location | `services/shared/locations` |
| Symbol-kind labels | `services/shared/symbol-kinds` (one `humanKind`) |
| Document → LSP diagnostics (push **and** pull) | `server/diagnostics` `documentDiagnostics` |
| Live document + project state (open/disk layers, parse cache, eager index) | `server/workspace-store` `WorkspaceStore` |
| Language reference data (types/operators/pragmas/…) | `reference/` |

**2. Per-layer barrels.** Each layer exposes its public surface through one `index.ts`; consumers import
`from "../types"`, not `from "../types/elementary"`. One import path per layer makes "where does X come from"
unambiguous — re-creating it reads as obviously wrong.

**3. Lint-enforced layering.** A `dependency-cruiser` (or `eslint-plugin-boundaries`) rule FAILS the build when
an import points upward (`types` importing `analysis`), when a check imports a sibling check, or when a layer
re-declares a lower-layer type. Imports point downward only — mechanically, not by convention. This is the guard
an AI cannot skip.

Rule of thumb baked into the build: **if you're about to define a type or a constant table, grep the ownership
map first.** A second copy is a lint failure, not a style nit.

## Invariants

- Full test suite + corpus 0-ERROR ratchet + conformance replay green before every commit — the behavioral
  spec.
- One source of truth per concern.
- Conservative & non-authoritative: unknown types skip; the IDE owns final type-checking + codegen.
- Additive to the protocol; `inferExprType` is the frontend's public entry point.

Requirement-level contracts (compiler-parity, vendor-keying, error-tolerant parsing, network-text ownership boundary,
library resolution, corpus verification) live in `spec.md`; the concrete types in `data-model.md`; the IEC
catalog + the CODESYS↔TwinCAT differences in `language-reference.md`. This document is the structural blueprint
the build follows.
