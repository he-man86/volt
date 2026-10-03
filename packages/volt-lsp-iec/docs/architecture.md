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
  their parsed value (and a typed literal its prefix as written); initializers are expression trees. Consumers read
  structured nodes, never re-parse spans. A literal's TYPE is deliberately NOT on the node: an untyped IEC literal is
  polymorphic and takes its type from its context, so `frontend/types/literal` answers it (`literalType`,
  `literalOwnType`, `literalCheckType`, …) — the AST holds what the text says, the type layer what it means.
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
F  reference · network        language data catalogs · the FBD/LD sublanguage (native, by reuse)
E  services      navigation · hierarchy · hover/completion/signature-help · inlay-hints · code-lens ·
                 semantic-tokens · structure · formatting · code-actions
D  analysis      diagnostics orchestrator · messages · the checks
C  types         elementary facts · Type model · resolve · const · infer · compat · arith · render   ┐
B  symbols       symbol table · binder · scope-nav · scoped-bodies (the shared ST-body iterator)    │ frontend/
A  syntax        vocabulary · lexer · complete AST · parser · literals · pragmas · file format      │ (+ library)
                      ↘ transpile (Rust backend) consumes the front-end directly — headless test execution
```

## Layers

### The front-end — `frontend/`
Layers A–C are ONE layer, `src/frontend/` (openspec `frontend-conformance`): `syntax → symbols → types`, with `library`
beside them — the Volt library format (the `Library Manager/<folder>` path layout, the `.library` manifest, the
materialization format), a leaf that imports nothing.

```
            library   (imports nothing; a leaf)
            ↑      ↑
syntax  ←  symbols  ←  types
(nothing)  (syntax,    (syntax, symbols, library)
            library)
```

The four sub-layers are `frontend/library/`, `frontend/syntax/`, `frontend/symbols/` and `frontend/types/` (A–C below,
and the library format). The consumers are `analysis`, `services`, `server`, `network`, `network-text`, `reference`,
`transpile`, the top-level workspace modules, `libraries/`, the tests and the scripts.

**Indexes.** Each sub-layer has one curated `index.ts` that names its exports one by one (no `export *`): the export
list IS the public API, and it holds exactly the names something outside the sub-layer imports — a name nobody outside
uses is file-private. `syntax/index.ts` — the lexer, the AST node types, the parse entry points, the walks, the literal
values, the pragmas and the workspace-format surface; `symbols/index.ts` — the read API (lookup, scope navigation,
EXTENDS chains, precedence, the scoped-body iterator) plus a `build` namespace (`buildSymbolTable`, `bindFile`,
`unbindFile`, `relink`, `localScope`), so a reader and a builder cannot be confused; `types/index.ts` — every type
fact, rule and engine a consumer asks; `library/index.ts` — the path layout, the manifest and the materialization
format. `frontend/index.ts` re-exports the three language indexes for the package barrel (`src/index.ts`) alone.

**Import rules** (`scripts/check-layering.ts`, over `src/`, `test/`, `scripts/` and `libraries/`, tests included; run
inside `bun test` by `test/frontend/layering.test.ts`, which fails on a new violation and on a listed one that has
gone — the known-violation list is empty):

- **F1** — nothing under `frontend/` imports outside `frontend/`: the front-end imports no consumer.
- **F2** — outside a front-end sub-layer, only its `index.js` (or `frontend/index.js`) is imported; a test colocated
  inside a sub-layer may import its own sub-layer's files.
- **F3** — inside the front-end, `library` imports nothing, `syntax` nothing but itself, `symbols` `syntax` and
  `library`, `types` `syntax`, `symbols` and `library` — each through the other's index. Inside `syntax` the folders
  are ranked too: `lex` imports `span` and itself; `ast` `lex`, `span`; `literal` `ast`, `lex/vocabulary`; `format` and
  `pragmas` `lex`, `ast`, `span`; `parse` everything in `syntax` but `print.ts`.
- **F4** — no sanctioned upward edge exists (there is no `ALLOWED_UPWARD`).
- **F5** — the front-end reads no environment (`process.env`): a parse takes `ParseOptions`, the server reads the
  environment and passes the answer in.
- **F6** — no import cycle inside `syntax`.

Every move inside `frontend/` was proved output-neutral by snapshot F (`scripts/frontend-snapshot.ts`, the working tree
against its parent commit).

### A — `frontend/syntax/`
Text to a tree, and nothing about meaning. `lex/` — the token model, the vocabulary (`vocabulary.ts`: every keyword, the
named keyword subsets the parser asks about, the dialect's differences, the literal prefixes, the punctuation) and the
lexer (error-tolerant, trivia-preserving). `ast/` — the **complete AST** (`nodes.ts`: declarations · type expressions
with structured dims/length/subrange/vector · statements · expressions · literals carrying their value), its walks
(`walk.ts`, `allUnits` the one namespace flattener) and declaration queries. `parse/` — the parser: the cursor, the
messages (`errors.ts`), names, the balanced-token scanner, declarations, initializers, expressions, statements, type
expressions, the unit parsers, and `body-parse.ts` `bodyStatements`, the ONE statement tree of a body: its conditional
pragmas applied where a statement may start (inside a statement every pragma is trivia), a branch not taken parsed in
silence and dropped, cached per `ConditionWorld` — what a condition may ask beyond the body's own defines (the vendor,
the project's names from `symbols/condition-world`, and the project's MEASURED compile environment — a device's facts,
its compile defines and tasks, `Scope.environment`, which the LSP never has and the conformance harness and the
transpiler state); a question the world cannot answer leaves that chain undecided and the body `refused`, never a branch
guessed — what lies outside the chain keeps its errors and messages. `sourceStatements` is the body AS WRITTEN, every
branch in: the tree of the services that edit and navigate text (rename, references, folding, selection, hover;
`symbols/scoped-bodies` `sourceBodies`), never of a check. `literal/` — a literal's value (numbers and durations, string escapes, calendar
values). `pragmas/` — the `{IF}` condition grammar and its evaluation (`conditional.ts`), and `{attribute …}`, attached
once by the parser to the unit, member or declaration it decorates (`attributes.ts`; `FRONTEND_ATTRIBUTES` the ones the
front-end answers by). `format/` — the Volt workspace file format, which is not
CODESYS grammar: the `IMPLEMENTATION <LANG>` line and the body splitter, `%FOLDER`, the retired comments, the reserved
name, the network header, which reader reads a body, and what a file's extension says its object is (a DUT's or a GVL's
text is read as the IDE reads it — nothing is declared, and nothing reported, unless the text opens with TYPE /
VAR_GLOBAL). A parse takes `ParseOptions` (`networkText`: whether an LD/FBD body is read as network text — the server
passes its environment's answer; the front-end reads no environment) and hands back the token stream it lexed
(`ParseResult.tokens`). Design call: the tree is an AST + `BodySpan` trivia, NOT a fully-lossless CST — enough for
round-trip/formatting without the CST's weight.

### B — `frontend/symbols/`
The binder: the model (`model.ts` `Symbol` · `Scope`), scope construction and the local lookup (`scope.ts`), the lazy
indices and their one invalidation (`cache.ts`), `binder` (AST → scope tree; property getter/setter each bind their own
accessor scope; a NAMESPACE block's units bound as a file's are, `ingestUnits`; the device tree's instances from the `.device`
descriptors, `ingestDevices`), `incremental` (a whole table, and the live server's bind/unbind one file + `relink`), `extends`
(EXTENDS linking and the base chain), `precedence` (which of several same-named candidates a reference means),
`library-namespaces`, `scope-nav` (the one scope-tree navigator — its `lookup` holds the project's level of the bare-name search
order: globals before POU and type names, the application's before a library's, a VAR_EXTERNAL bound to its global
or passed over), `condition-world` (what a conditional pragma may ask of the project — `defined`, `hasattribute`,
`hastype`, `hasconstantvalue` — answered from the scope tree) and `scoped-bodies` (the one scope-aware "walk every
ST body" iterator — POU bodies **and** property accessor bodies — shared by every analysis check and the language
services). Its index names the read API; building is the `build` namespace. Contract: name → declaring symbol/scope.

### C — `frontend/types/`
The type system, the clean core: `elementary` (the type-facts source of truth — family, bits, signed, `bigint` range,
widening rank, aliases, `ANY_*`) with its views (`predicates`, `platform` — the one target assumption, `width`,
`conversion-name`, `literal`, `defaults`); the rich `Type` model (`UNKNOWN` is the total, conservative fallback);
`resolve` (TypeExpr → Type); `enums`; `const/` (Expr → value, and constancy); `infer/` (Expr → Type, one engine:
`expr`, `member`, `callee`); `compat` (assignability · narrowing · conversion-source, one relation); `arith/` (run-time
`commonType`/`promoteForRuntime` for the transpiler, checked `checkedMeetType`/`checkedNegationType` for diagnostics,
temporal arithmetic, and `operators` — every operator's typing rule, the checks keeping only their messages);
`builtins` (every built-in's result type, and the compiler's own NAMES); `names` (the bare-name search order, the one
answer to "what does this identifier name?" — `resolveBareName`, rule Y23 — which the analysis only words); `render` (a resolved `Type` → string, in the display or the compiler form —
a declared `TypeExpr` or an expression prints through `syntax/print`). Powers diagnostics, hover, completion,
navigation, and codegen alike.

### D — `analysis/`
`diagnostics` (the orchestrator, vendor-keyed config, the CODESYS-only check list), `messages` (per-vendor builders
and the compiler-exact type text), `diagnostic-item`, `rules` (the diagnostics more than one checker applies — the
store, narrowing, conversion-argument and binary-operator rules the ST checks and the network-text checks share),
`resolution` (identifier resolution, likewise shared), `error-code-map` (slug → `Cnnnn`), and `checks/` — thin walks
over those rules, grouped by concern: `types/` · `declarations/` · `names/` · `oop/` · `calls/` · `pragmas/`. Every
body-walking check iterates through `symbols/scoped-bodies` (one loop, not a per-check copy). Each check traces to a
conformance fixture recorded against the live compiler.

### E — `services/`
The LSP features, thin over C/D via `shared/` (`resolve-at` cursor→symbol, positions, `locations`,
`symbol-kinds`): navigation (definition · type-definition · references · rename · highlight ·
implementation), `hierarchy` (call + type), `assist` (hover · completion · signature-help), `inlay-hints`
(inferred types + parameter names), `code-lens` ("N references" · "▶ Run test"), `semantic-tokens`, `structure`
(document/workspace-symbol · folding · selection), `formatting` (print · editorconfig · on-type · range), and
`code-actions`.

### F — `reference/` · `network/`
`reference/` holds the language data catalogs (types · operators · conversions · pragmas · standard fns/fbs ·
lifecycle) — ranges derive from `frontend/types/elementary`. `network/` is the FBD/LD family: the readable text
encoding (`network-text/`, room for future formats), plus infer/checks/services that **reuse the shared
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
A compiler backend, sibling consumer of the frontend (`frontend/`: `syntax ← symbols ← types`, through their indexes), not of the LSP.

```
AST ──lower/──> ir/ ──┬── interp/       runs it — the oracle
                      └── emit/rust/    prints it + a source map
```

`ir/` is the one contract; `lower/` owns every ST semantic; the backends own none. A referenced LIBRARY is not
semantics the transpiler owns: its elements are ordinary POUs whose bodies the library repo supplies
(`libraries/<library>/<version>/`, ST, looked up by the manifest's `RESOLUTION`), lowered like project code. The
only primitives a library needs are language operators — `s[i]` and `TIME()`, the latter read from a `CLOCK`
global the harness sets per scan — and one pointer form, the STRING CURSOR: a character pointer a caller fills with
a string's address binds that string by its own type and keeps its byte offset (`Lowering.cursors`), which is what a
library like StringUtils walks. That split is enforced by
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
constant bounds, FOR/WHILE/REPEAT are one `loop`, and every node carries a resolved `Type` from `frontend/types/` —
not a second type model. **If a backend ever has to decide something, the lowering is incomplete.**

Note the frontend split this forces: `inferExprType` answers the LSP's question and returns `UNKNOWN` wherever
a guess would be a false positive (`REAL + INT` among them). A backend cannot emit `UNKNOWN`, so lowering
computes operator types over the same widening lattice `frontend/types/elementary` owns, and an expression that still
lands on `UNKNOWN` is a reported gap — never untyped IR. Likewise IEC integer literals are polymorphic: they
take their type from context, and from the sibling operand before the assignment target (`rate := n / 2` with
`n : INT` divides in INT and converts the result).

The three correctness essentials, all live: **source maps** (emitted line → ST span, so a panic points at the
ST); **codegen diagnostics** (`LowerDiagnostic` — lowering is total and never throws, so an untestable POU is
reported, never silently wrong); **deterministic numerics** (IEC integers wrap at the declared width, so
arithmetic emits `wrapping_*` rather than Rust's panicking defaults; widths come from `frontend/types/width`).

Coverage is measured, not asserted: `scripts/lower-completeness.ts` lowers the whole corpus and ranks the
constructs blocking it, so the next thing to build is a number. Its denominator is POUs **with a body** — most
units in a real project are empty-bodied, with their logic in separate METHOD/ACTION units, and counting those
reports a comfortable percentage while nothing real runs.

## Testing (built in)

Diagnostics match CODESYS and TwinCAT byte-for-byte, guaranteed by construction. `test/conformance/`:
`catalog/` (one fixture per rule) → `record.ts` (push each to the live bridge, build, capture the compiler's
exact diagnostics) → `recordings/` (the committed oracle truth) → `fixtures.test.ts` (offline; asserts the
message set is byte-identical per vendor — the single criterion; a `KNOWN_DIVERGENCES` ledger is the only
opt-out). `test/corpus/` is the real-project ratchet (a miss ⇒ add a fixture, never a threshold tweak); unit
tests co-locate with each module; `test/conformance/` also runs the transpiler (interpreter + emitted Rust) against the simulator's recording. The loop: corpus miss → catalog fixture →
record → mirror the message → replay green. A diagnostic cannot ship unless it matches both compilers.

## Preventing duplication (one home per concern — enforced, not hoped)

The failure mode this architecture exists to kill is the same fact/type created in many places (type ranges
across 6 files, 4 type renderers, 6 scope walks). Three mechanisms make the *right* home the *easy* home so a
builder — human or AI — can't re-create what already exists:

**1. The ownership map.** Every reusable concept has exactly ONE owning module. Before adding a type or
constant, look it up here; if it exists, import it — never redefine.

| Concept | Owner |
|---|---|
| Source spans, tokens | `frontend/syntax/` (`Span`, `Token`) — the shared foundation everything imports down to |
| Keywords, the dialect's vocabulary | `frontend/syntax/lex/vocabulary` |
| AST node types | `frontend/syntax/ast/nodes` |
| The Volt workspace file format (`IMPLEMENTATION` line, `%FOLDER`, which reader reads a body) | `frontend/syntax/format/` |
| The library format (path layout, manifest, materialization) | `frontend/library/` |
| Symbols, scopes | `frontend/symbols/` |
| Scope-tree navigation | `frontend/symbols/scope-nav` |
| **"Walk every ST body"** (unit + scope + parsed statements, incl. property accessors) | `frontend/symbols/scoped-bodies` — the one iterator shared by checks + services |
| Call → callee + parameters (VAR_INPUT, base-first through EXTENDS) | `frontend/types/infer/callee` `resolveCallee` — shared by signature-help + the call-argument check |
| **Elementary type facts** (ranges, families, bits, signed, rank, aliases) | `frontend/types/elementary` — the type-facts SSOT |
| The `Type` model | `frontend/types/type` |
| Type compatibility (assignable/narrowing/arith/conversion) | `frontend/types/compat` |
| An operator's typing rule, a built-in's result type | `frontend/types/arith/operators` · `frontend/types/builtins` |
| Constant evaluation | `frontend/types/const/fold` |
| Type/expr rendering | `frontend/types/render` (a resolved `Type`) · `frontend/syntax/print` (a declared `TypeExpr`, an expression) |
| Diagnostic message building (per-vendor) | `analysis/messages` |
| Vendor differences | `analysis` vendor-difference registry (data; see `language-reference.md` §10) |
| Cursor → symbol resolution | `services/shared/resolve-at` |
| Symbol → Location | `services/shared/locations` |
| Symbol-kind labels | `services/shared/symbol-kinds` (one `humanKind`) |
| Document → LSP diagnostics (push **and** pull) | `server/diagnostics` `documentDiagnostics` |
| Live document + project state (open/disk layers, parse cache, eager index) | `server/workspace-store` `WorkspaceStore` |
| Language reference data (types/operators/pragmas/…) | `reference/` |

**2. Per-layer barrels.** Each layer exposes its public surface through one `index.ts`; consumers import
`from "../frontend/types/index.js"`, not `from "../frontend/types/elementary.js"`. One import path per layer makes "where does X come from"
unambiguous — re-creating it reads as obviously wrong.

**3. Lint-enforced layering.** `scripts/check-layering.ts` (an import scan, not dependency-cruiser) FAILS the build when
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
