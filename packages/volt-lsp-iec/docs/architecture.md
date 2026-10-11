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
F  reference · network(-text) language data catalogs · the FBD/LD sublanguage (native, by reuse)
E  services      navigation · hierarchy · hover/completion/signature-help · inlay-hints · code-lens ·
                 semantic-tokens · structure · formatting · code-actions
D  analysis      diagnostics orchestrator · messages · the checks
C  types         elementary facts · Type model · resolve · const · infer · compat · arith · render   ┐
B  symbols       symbol table · binder · scope-nav · scoped-bodies (the shared ST-body iterator)    │ frontend/
A  syntax        vocabulary · lexer · complete AST · parser · literals · pragmas · file format      │ (+ library)
                      ↘ transpile (Rust backend) consumes the front-end directly — headless test execution
```

## The tree (as it stands; openspec `lsp-package-structure` gives it its final shape)

```
src/
  frontend/      A–C — syntax · symbols · types, and library (the Volt library format); one index per sub-layer
  analysis/      D — the diagnostics pipeline/ and registry, messages, shared/ rules, and checks/ by concern
  services/      E — the LSP features over the layers below
  reference/     F — the language data catalogs
  network-text/  F — the network-text (FBD/LD) lexer, parser and AST
  network/       F — network-text analysis and services over the shared core
  server/        G — LSP 3.17 over stdio, the WorkspaceStore, push+pull diagnostics
  transpile/     the Rust backend — lower/ → ir/ → interp/ · emit/rust/
  bin.ts · index.ts · source-extensions.ts · workspace-refs.ts
                 the CLI entry · the package barrel · the writable-source extension set · the workspace scan
test/            cross-cutting suites — conformance/ · corpus/ · catalog/ · frontend/ · libraries/ (map: test/README.md);
                 unit tests sit beside their module in src/
libraries/       the library repo: referenced libraries' elements in ST, per version, for the transpiler
scripts/         dev tooling — recorders, gates, generators, audits, measurements (every file: scripts/README.md)
docs/            this file · behavior.md · data-model.md · language-reference.md · reserved-il-operators.md ·
                 codesys-reference/ (vendor docs + the C-code catalog) · twincat-reference/
test-corpus/     the real projects the corpus suite reads
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
CODESYS grammar: the `IMPLEMENTATION <LANG>` line and the body splitter, `%FOLDER`, the retired `(* @volt-… *)`
comments (read only as the hint of a body that states no language — a comment everywhere else, bridge-refusal-review
2.1), which reader reads a body — its stated language alone, never what the text looks like — and what a file's
extension says its object is (a DUT's or a GVL's
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
or passed over, a VAR_TEMP reached by its own body and its FB's ACTIONs only — not by a METHOD or a derived body),
`condition-world` (what a conditional pragma may ask of the project — `defined`, `hasattribute`,
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
`index` (the public API, an explicit export list — nothing outside `analysis/` imports any other analysis file),
`pipeline/` (`context` — what a check is handed; `registry` — every check as data, `{ check, group, vendors, reads?,
note }`, in its stated run order; `policy` — configurable severity / off and TwinCAT's per-line dedupe; `diagnostics` —
`computeDiagnostics`, the one pipeline, optionally restricted to some groups), `config` (vendor-keyed configuration),
`messages` (EVERY message text, per vendor, ordered like `checks/`, and the compiler-exact type text),
`error-code-map` (slug → `Cnnnn`), `shared/` (the rules more than one check applies: `diagnostic-item` and its
`emit`, `rules` — the store, narrowing, conversion-argument and binary-operator rules the ST checks and the
network-text checks share — `resolution`, `hole`, `expr-echo`, `body-context`, `compiled`), and `checks/` — thin
walks over those rules, grouped by concern: `types/` · `declarations/` · `names/` · `oop/` · `calls/` · `flow/` ·
`pragmas/` · `syntax/`. A check imports `shared/`, `messages`, `config` and `pipeline/context`, never another check or
the registry, and has its test beside it (`scripts/check-layering.ts`, rules A1–A6; openspec analysis-conformance
design.md §2). Every body-walking check iterates through `symbols/scoped-bodies` (one loop, not a per-check copy). Each
check traces to a conformance fixture recorded against the live compiler. Dead-code reachability is server
suppression policy and lives in `server/reachability`.

The registry's ORDER is a contract (`registry.test.ts` lists it): a check that reads earlier findings says which codes
in its entry's `reads`, and nothing else of `out` is read. `diagnostic-census.test.ts` (test/analysis) measures every
check and message builder against both vendors' build recordings and the corpora, with ceilings that only fall.
**Network text is NOT in the one pipeline yet** — its findings still come from `network/`'s own
`computeNetworkTextDiagnostics`, merged by `server/diagnostics`, and `services/structure/semantic-tokens` still imports
`network/` (the one `KNOWN_OTHER_VIOLATIONS` entry). That integration is unchanged and PARKED for the LD/FBD coverage
change (openspec analysis-conformance design.md §3, the hand-off in its tasks.md 5.3).

### E — `services/`
The LSP features, thin over C/D via `shared/` (`resolve-at` cursor→symbol, positions, `locations`,
`symbol-kinds`): navigation (definition · type-definition · references · rename · highlight ·
implementation), `hierarchy` (call + type), `assist` (hover · completion · signature-help), `inlay-hints`
(inferred types + parameter names), `code-lens` ("N references" · "▶ Run test"), `semantic-tokens`, `structure`
(document/workspace-symbol · folding · selection), `formatting` (print · editorconfig · on-type · range), and
`code-actions`.

### F — `reference/` · `network-text/` · `network/`
`reference/` holds the language data catalogs (types · operators · conversions · pragmas · standard fns/fbs ·
lifecycle) — ranges derive from `frontend/types/elementary`. The FBD/LD family is two folders today:
`network-text/` reads the text (lexer, parser, AST of a network-text body, the format specified in
`packages/volt-cli/docs/network-text.html`), and `network/` analyzes it — wire symbols and types, the checks, the
services — **reusing the shared core**: one type engine, one orchestrator, one service set. Graphical is a second
front-end that plugs in, not a second stack. (Both dissolve into the layers — `frontend/syntax/network`,
`frontend/symbols`/`types`, `analysis/checks/network` — in openspec `lsp-package-structure`.)

### G — `server/`
LSP 3.17 over stdio (`--stdio` only), one vendor-keyed binary (`codesys | twincat | auto`): dispatch, framing,
capabilities, and lifecycle. Thin handlers over the layers below; the state and the non-trivial compute live in
three server modules:
- `workspace-store` — the **WorkspaceStore**: the open-buffer and on-disk source layers merged by normalized
  URI (open buffer wins), a `(uri, version)` parse cache, the memoized project symbol table, and the
  reference-crawl state. Backs the eager whole-workspace index (crawled on `initialized`) and stays fresh via
  `workspace/didChangeWatchedFiles` (freshness comes from watched-file events, **not** file-operation events —
  those are out of scope; one item per file makes a rename just a delete+create the watcher already reports).
- `diagnostics` — the one `documentDiagnostics(store, doc)` compute shared by the **push** transport
  (`publishDiagnostics` on open/change) and the **pull** transport (`textDocument/diagnostic` ·
  `workspace/diagnostic`), so the two can never diverge.
- `server` — the dispatch itself: incremental document sync, semantic tokens (full · range · delta),
  refresh-after-reindex, live configuration, and work-done progress around the crawl.

Every advertised capability has a registered handler — an invariant guarded by a capability↔handler parity test
in `server/server.test.ts`.

### Backend — `transpile/`
A compiler backend, sibling consumer of the frontend (`frontend/`: `syntax ← symbols ← types`, through their indexes), not of the LSP.

```
AST ──lower/──> ir/ ──┬── interp/       runs it — the oracle
                      └── emit/rust/    prints it + a source map
              semantics/  what a node MEANS on values: run by interp/ and by lowering's IR fold,
                          mirrored by emit/rust/runtime/ (the twin tests hold the two together)
```

`ir/` is the one contract; `lower/` owns every ST semantic; the backends own none. A referenced LIBRARY is not
semantics the transpiler owns: its elements are ordinary POUs whose bodies the library repo supplies
(`libraries/<library>/<version>/`, ST, looked up by the manifest's `RESOLUTION`), lowered like project code. The
only primitives a library needs are language operators — `s[i]` and `TIME()`, the latter read from a `CLOCK`
global the harness sets per scan — plus `Standard.LEN_INTERNAL`, the count every Standard string function takes, as
the IR builtin `length` (`lower/builtins/length.ts`; `units().len()`, its repo body kept as the primitive's oracle) —
and one pointer form, the STRING CURSOR: a character pointer a caller fills with a string's address binds that string
by its own type and keeps its byte offset (`PointerFrame.cursors`, `lower/pointers/state.ts`), which is what a
library like StringUtils walks. A Standard string FUNCTION's `STRING(255)` input is lent the caller's STRING(N <= 255)
read-only instead of copied (`lower/calls/string-inputs.ts`): every body reads it only below its length, which
`test/libraries/standard.test.ts` holds over every short buffer. A whole STRING VAR_IN_OUT keeps a copy at its
declared capacity — it is bound at its caller's, which CODESYS's input copy does not read (`string_input_lent_inout_wider`).

**The folders** (openspec `transpile-restructure` design.md §2; each test sits next to its module as `<file>.test.ts`):

```
transpile/
  index.ts          the public barrel — explicit named exports, pinned by index.test.ts
  pipeline/         the composition root: load (lower, then run) and lowerAndEmit; the ST → lower → interp tests
  ir/               expr.ts stmt.ts program.ts — the node contract; walk.ts — the one exhaustive walk (childrenOf) every
                    IR walk is built on; path.ts — the IDE path grammar; faults.ts — fault kinds and their texts
  semantics/        value.ts store.ts convert.ts arith.ts operators.ts builtins.ts math.ts text.ts parse.ts string.ts
                    memory.ts instantiate.ts fold.ts faults.ts; cases.ts and the *.cases.ts tables the twin tests share
  lower/
    entry/          lower-unit.ts lower-source.ts checks.ts finish.ts — where a POU's lowering starts and ends
    project/        prepare.ts library-base.ts — the transpiler's input assembly (files, libraries, attributes)
    diagnostics/    codes.ts (the registry) diagnostic.ts — a refusal by name
    core/           lowering.ts shared.ts (the frame and the POU's state) temps.ts nested.ts build.ts chain.ts
                    ast-walk.ts tags.ts
    values/         literals.ts fold.ts enums.ts convert.ts promote.ts
    storage/        layout.ts declare.ts statics.ts addresses.ts bytes.ts unions.ts
    init/           state.ts step.ts sequence.ts fb-init.ts fb-init-args.ts instance-init.ts initial-values.ts
                    temp-resets.ts position.ts attributes.ts bindings.ts — an address bound at its declaration is its
                    slot's initial value, proven unread before it runs
    places/         places.ts names.ts self.ts globals.ts bounds.ts path.ts access-guards.ts
    pointers/       state.ts address.ts store.ts deref.ts borrowed.ts cursor.ts any.ts escape.ts image.ts
                    image-rewrite.ts — the escape pass, the image layout and its rewrite are model 3's
    expressions/    expressions.ts operators.ts calendar.ts partial-access.ts
    builtins/       arity.ts builtins.ts value-functions.ts system.ts clock.ts conversions.ts sizeof.ts length.ts
    statements/     statements.ts assign.ts loops.ts case.ts
    calls/          routines.ts routine-frame.ts facts.ts variants.ts parameters.ts invoke.ts fb-call.ts outputs.ts
                    binding.ts super.ts property.ts specialize.ts last-binding.ts reentrancy.ts namespace.ts
                    string-inputs.ts
    interfaces/     state.ts tags.ts lend.ts dispatch.ts query.ts
    conditions.ts   the exec oracle's condition world (read by project/ and calls/)
  interp/           machine.ts frame.ts calls.ts runner.ts — executes the IR, decides nothing
  emit/rust/        module.ts structs.ts names.ts types.ts values.ts printer.ts precedence.ts place.ts image.ts
                    expr.ts convert.ts builtins.ts calls.ts stmt.ts loops.ts routine.ts locals.ts tail.ts reinterpret.ts —
                    prints the IR, decides nothing
    runtime/        string.ts text.ts parse.ts numeric.ts pointer.ts bytes.ts — the Rust the emitted code carries, by
                    registry (index.ts); the mirror of semantics/
```

**The layers** — enforced by `scripts/check-layering.ts` (rules 3, 4, 4b and 6), a lint failure, not a convention.
`transpile/` as a whole may import only `syntax`, `symbols` and `types`; inside it:

| Folder | May import (transpile) | May import (frontend) | Owns |
|---|---|---|---|
| `ir/` | itself | `syntax` (Span), `types` (Type) | The node contract, the walkers, the IDE path grammar, fault kinds and texts. No semantics. |
| `semantics/` | `ir/` | `types`, `syntax` | What a node means on values: store, convert, arithmetic, builtins, text, the string model, the IR constant fold, instantiation. |
| `lower/` | `ir/`, `semantics/` | `syntax`, `symbols`, `types` | Every ST decision: types, order, evaluation strategy, defaults, refusals. |
| `interp/` | `ir/`, `semantics/` | `types` | Nothing. It executes. |
| `emit/rust/` | `ir/` | `types` | Nothing. It prints. Its `runtime/` mirrors `semantics/`; the emitter must not import `semantics/` (a printer that can evaluate starts deciding). |
| `pipeline/` | everything | — | The composition root. Nothing in `src/` but the barrel imports it. |

Inside `lower/` the recursion is real (an expression lowers a call, a call lowers its arguments), so most folders import
each other; rule 4b keeps the LEAVES acyclic: `diagnostics/` imports no other `lower/` folder, `core/` only
`diagnostics/`, `values/` only `core/` and `diagnostics/`, `project/` only `diagnostics/`, and only `entry/` imports
`project/`. The edges the restructure has not removed yet are listed by name in `KNOWN_TRANSPILE_VIOLATIONS` (the list
only shrinks). Rule 6: nothing under `src/` imports `test/`. Size is ratcheted too (`scripts/check-size.ts`: a file
within 400 lines, a test within 600, a function within 80 — the last reported, none over it since 1.9.4).

**The two constant folds.** The AST fold (`frontend/types/const/fold.ts` `constEval`) serves the LSP on code that is
never lowered — declarations, CASE labels, array bounds, diagnostics — and lowering before any IR exists. The IR fold
(`semantics/fold.ts` `constantValue`) serves lowering after its conversions are in (an initializer holding a call,
`lower/init/initial-values.ts` `foldedCall`), through the interpreter's own arithmetic. They cannot be one function without
`types/` depending on the IR, so they are held together the way the backends are: `test/conformance/fold-agreement.test.ts`
folds every constant expression the lowered fixtures hold with both and requires the same value; the disagreements it
found are expected failures naming their task.

**Two decisions carry the design.**

*Places, not references.* ST's memory model is one static image — instances are fixed allocations, `VAR_IN_OUT`
is a pointer, `POINTER TO`/`REFERENCE TO` are real aliases, GVLs are global mutable state. Mapping any of that
to Rust `&mut` loses to the borrow checker the moment two aliases live at once, so **nothing lowers to a Rust
reference**. A POU is a flat frame of slots; a name is a slot index; a frame whose data address is taken lives in the
program's byte image, laid out as CODESYS lays it out; a data pointer is an address into it, a pointer to an instance a
handle, a pointer that never outlives the call a borrow — and a pointer the image cannot hold keeps a tag. The emitted
struct's `&mut self` is the only borrow in the output, which is what makes 100% coverage reachable rather than a wall at
the first aliasing construct.

*Pointers* (transpile-restructure §3.3). Which frames reach the image is decided by the escape pass before the bodies
lower for real (`lower/pointers/escape.ts`): a lowering that only records, then lowering again on its answer until it
finds nothing new — and, until no use has read a pointer's target set that later grew (`pointers/state.ts`
`grownTargets`; each lowering starts with the sets the previous one ended with). The image is a `Place` root (`image`,
with its byte address `at`), folded to `semantics/memory.ts` in the interpreter and to `Mem` in Rust. Tags stay only
where the image cannot hold the target, in three schemes that number through `lower/core/tags.ts` (0 is none, the k-th
is k + 1), each for one reason: the INSTANCE HANDLE (`interfaces/tags.ts` `instanceHandle`) — every interface value and
every pointer or reference to a whole FB instance, one table, so a value names the same instance in whichever variable
holds it; the residual DATA TAG — a pointer to a routine's local, a VAR_IN_OUT's target, a STRING's characters or a
non-image ANY argument, numbered per `pointerKey`, a copy into a pointer of several targets re-mapped so NULL stays NULL;
and `__inout_binding` (`calls/last-binding.ts`) — folding it into the image would make every VAR_IN_OUT target escape.
Form 2 (a `POINTER TO` parameter only dereferenced is a borrow) and the string cursor stay as built. Refused by name:
`pointer-shape` (the address of a BIT, of a dereference), `cursor-overrun`, `sizeof-unmeasured`, `layout-unmeasured`,
`dynamic-memory` (`__NEW`/`__DELETE`), `call-inout-alias`, `place-not-local`, `image-stack` (an escaped routine local),
for a TAGGED pointer (a pointer that holds addresses does all of these) `pointer-type` (read or given as another type than
its target), `pointer-step` and `pointer-runtime-index` (stepped, or the address of a runtime-indexed place) and
`pointer-order` (dereferenced or copied before any address was stored into it), `pointer-value` (a pointer's value used
as a number, an integer stored as a pointer), `pointer-foreign` (a pointer INPUT followed in an FB body
lowered as any POU but the root — an FB reached by a call: its caller's address would have to be lent per call; a
METHOD/ACTION/FUNCTION routine's inputs are supplied by its caller and not refused) and `pointer-root-input` (a pointer
INPUT followed in the root POU, which has no caller to supply it — a harness limit, not a work item), `any-input` (an ANY
argument that is no named variable, or whose size is unmeasured), `call-fb-inout` (a METHOD reaching its FB's
VAR_IN_OUT where no binding can be known), `pointer-outlives`, `pointer-targets` (a pointer that would hold both a tag and an index, or a tag and an address; a
copy of a pointer of several targets; a target set that still grew after `ESCAPE_PASSES` lowerings, `entry/lower-unit.ts`),
`interface-instance` (an instance at a runtime index), `interface-instance-relative`, `call-global-instance` (a METHOD
called on a GVL's instance, directly or through an interface); a pointer→DWORD conversion is vendor-refused.

*Unions* (transpile-restructure §3.3/§3.4, step 7.8d) stay out of the image: a UNION is laid out as a struct holding
each member, and a store into one member is followed by ONE assignment per other member, the stored member's
little-endian bytes read at that member's type — the IR expression `reinterpret` (`lower/storage/unions.ts`
`unionCopies`; the interpreter's twin is `semantics/memory.ts`, the Rust `to_le_bytes`/`from_le_bytes`,
`emit/rust/reinterpret.ts`) — so every read stays a plain field read. A union of pointers keeps one field per member too
(the DUT struct's fields are the emitted Rust's contract). Refused by name: `layout-union` (a member that is not an
integer — an enum is its base integer —, a bit string of 8 bits or more (BYTE to LWORD: a BOOL or BIT member is
refused, though BOOL is ANY_BIT), a REAL/LREAL or a one-dimensional array of them — so also a STRING, a duration, a
struct, or a pointer beside such members; or a member with an initial value) and
`union-write` (a member written other than by `:=` — a VAR_IN_OUT or output binding, a latch, a chain link, a FOR
variable, an address taken — or reached through a runtime index).

*The IR carries the semantics.* Implicit widening is an explicit `convert` node, CASE ranges are resolved
constant bounds, FOR/WHILE/REPEAT are one `loop`, and every node carries a resolved `Type` from `frontend/types/` —
not a second type model. **If a backend ever has to decide something, the lowering is incomplete.**

*Loops* (transpile-restructure §3.1). There is no loop bound in the semantics — CODESYS caps no loop (`tr_27_loop_cap_*`) —
so only a harness bounds a runaway: `loopGuard` on `run` and `emitRust`, one body entry after a head test counted as one
pass in both backends, and its `LoopGuardError` is never a fault match. A FOR step and limit are judged by their front-end
type (`for-step-type`, `for-limit-type`: a DINT limit on an INT counter does not compile), an expression of untyped
literals by its value. Refused by name besides those two: `for-bound-call` (a call in the step, or in a limit tested on
both arms of a runtime step — its run count is unrecorded) and `exit-outside-loop`. Whether a Rust loop names its `'loop_N`/`'body_N` labels is asked of the IR before it prints
(`ir/walk.loopUses`).

*Strings* (transpile-restructure §3.2). A STRING(n) is ONE buffer of n units plus the terminator at n: the interpreter
holds it as a JS string of the whole buffer, trailing zeros trimmed (`semantics/string.ts` `held`), Rust as
`IecStr<T, N>` (`[T; N]`, the terminator implied), and `LEN` is the first 0 — the units behind it are real (`s[i]` reads
and writes them). Every Type lowering holds carries its capacity (`Lowering.resolve` applies the default 80; a capacity
that does not fold is refused `string-capacity`). One store rule: `assign` into an existing string writes `min(n, m)`
units of the SOURCE buffer and a 0 there, and leaves the destination's units behind it (`storeString`, Rust
`dst.store(&src)`; a literal is a source of its own units); a `convert` fills a fresh buffer. A string conversion hands
its text through a 255-unit buffer: STRING <-> WSTRING gives STRING(255)/WSTRING(255), a parse reads at most 255 units,
a same-width TO_STRING / TO_WSTRING and a number's text are the default 80 (`lower/builtins/conversions.ts`). Refused by name:
an implicit string crossing (`assign-string`), unmeasured escapes (`string-escape`, `wstring-surrogate`,
`string-non-ascii`), a whole-string write through a cursor's `p^` that would go past the caller's variable — a store,
a chain link, an FB output copied out, `p^` lent to a wider writable VAR_IN_OUT (`cursor-overrun`), REAL_TO_STRING
(`conversion-type`), a Standard function's lent input that the library repo's body writes, lends writable or takes the
address of (`input-borrow-written` — a repo defect, never a silent copy) and LEN_INTERNAL of a STRING longer than its
UINT count holds (`string-length-width`).

*Initialization* (transpile-restructure §3.4). An initializer is a statement that RUNS, once before the first scan, in
declaration order — not a constant expression. `IrSlot.init` holds the folded constant (an `IrInit` complete to every
element: an enum's default, an alias's `:=`); everything else is ONE ordered walk, `lower/init/step.ts`, into
`IrPou.init`: the POU's frame, then the PROGRAMs its body calls in call order, then the `call_after_global_init_slot`
METHODs. Per declaration a dynamic initializer, a constant after the frame's first statement (the position rule,
`init/position.ts`: a later declaration still holds its type's start), or an instance's whole init — per class of its
EXTENDS chain, base first, its own fields then its FB_Init (arguments in the containing frame; a STRUCT field
instance's in the struct's scope: its earlier fields, then globals), then its structured initializer. A METHOD's or
FUNCTION's VAR and an FB's or PROGRAM's VAR_TEMP are PER-RUN LOCALS (`Lowering.perRun`; transpile-restructure 7.6.4): an
`IrRoutine`'s `locals`, an FB body's `IrLayout.locals`, the scan's `IrPou.locals` — never a field the instance carries
between runs. Each starts at its `IrInit` on every run (the interpreter instantiates it, the Rust binds it with a `let` at
the top of the fn that runs the body, `emit/rust/routine.ts` `printLocals`), and only an initializer that is not a constant
is a statement of the run, the dynamic elements after the static part (`init/temp-resets.ts` `localInits`). A VAR_TEMP
named where it is visible but not run — its FB's ACTION, `THIS^.x`, an instance path — is `var-temp-outside-body`; where
it is not visible — a METHOD, a derived body — the name is whatever else declares it, a global of that name (the
symbols' `lookup`), and a derived FB may declare its own variable of a base VAR_TEMP's name. A field holding a VAR_TEMP's
address reads it in the run that stored it, as one into the body's VAR_IN_OUT does (`pointers/state.ts` `scopedTo`). What an initializer reads is `ir/walk.ts` `initReadChildren` — `childrenOf`, an
`ADR` reading only its indices. An ADDRESS BINDING — `p : POINTER TO INT := ADR(x)`, `r : REFERENCE TO T REF= x`, a
store of an address of the frame's own static storage (or a tag) into a whole pointer slot — is no statement of the step
but the slot's initial value (`lower/init/bindings.ts`, transpile-restructure 7.8.8): run after the image pass, `foldBindings`
writes each address into the struct's field (`p: __base + k` at a static instance), and an `init()` / `__init()` left
empty goes with its call chain. It is folded only where `provenBindings` shows, on the built sequence, that nothing
before it reads or writes a variable of its name, dereferences or calls anything (each conservative); an unproven binding keeps its store, the exact
declaration-order answer. A binding reads nothing, so it never starts the position rule's walk. Refused by name: `init-reads-later` (a later struct's or instance's field, by any path; a VAR_TEMP read by the run-once
init step, which runs before any run holds one),
`init-reads-instance` (an instance declared with a structured initializer, its field, a METHOD on it, the instance
itself or a struct holding it — also handed to a call by name, as an interface lends it after the guards ran),
`fb-init-order` (a nested structured initializer reaching an FB_Init, or setting the sibling a STRUCT field instance's
argument reads), `fb-init-argument` (an argument neither a constant, a variable nor an elementary struct field — THIS
among them, and in a struct any expression naming something), `init-frame-order` (a PROGRAM not first called by the POU's
own top-level statements), `init-slot-order` (several slot methods whose order could show), `init-not-constant` (a GVL
initializer that runs; a STRUCT field's dynamic initializer — a STRUCT has no init frame), `init-composite-scalar`.

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

**`__TRY` is measured and not yet lowered**, which is a different thing from unmeasured — the model is complete
and written down here (the lowering of statements points here) so whoever builds it is not asked to guess. Measured on SP21
(`semantics/try-catch.ts`, 2026-09-19), and it CHANGES THE FAULT MODEL for the code inside the block:

```
  no fault              the body runs, the catch is skipped, __FINALLY runs, and so does what follows __ENDTRY
  a divide by zero      the catch RUNS, its operand receives 258, the faulting statement did not complete,
                        and THE SCAN FINISHES — outside a __TRY the same division ends the application
  LN of a run-time 0    the same, with 338
  __FINALLY             runs either way
  nested                the INNER block catches; the outer never sees it
```

`__CATCH`'s operand is an EXISTING variable of `__SYSTEM.ExceptionCode` that receives the code — pro2193
declares `ARRAY[0..50] OF __SYSTEM.ExceptionCode` for exactly this and wraps every top-level call in one.

What it needs: an IR statement carrying the three blocks and the catch place, a `try` in the interpreter, and
a Rust form — the emitter's faults are `panic!`, so `catch_unwind` or a `Result`-shaped rewrite is the open
design question. Six corpus POUs are blocked by this, three of them by nothing else.

AND IT IS BLOCKED ON THE FRONTEND FIRST, measured 2026-09-24: `__SYSTEM.ExceptionCode` — the type every
`__CATCH` operand is declared with — does not resolve, so `ec` is `type-unknown` before lowering reaches the
statement at all. The eight fixtures give its VALUES (258, 338) and that `ANY_TO_DWORD` takes it; they do not
give its base type or its enumerators. Inferring DWORD from two observed values is a guess of exactly the
kind `refused` exists to prevent, so the type has to be READ from a live CODESYS before any of this is built.

Coverage is measured, not asserted: `scripts/lower-completeness.ts` lowers the whole corpus and ranks the
constructs blocking it, so the next thing to build is a number. Its denominator is POUs **with a body** — most
units in a real project are empty-bodied, with their logic in separate METHOD/ACTION units, and counting those
reports a comfortable percentage while nothing real runs.

## Testing (built in)

Diagnostics match CODESYS and TwinCAT byte-for-byte, guaranteed by construction. `test/conformance/`:
`fixtures/` (one fixture per rule, grouped by concern) → `scripts/record-language.ts` (push each to the live bridge,
build, capture the compiler's exact diagnostics) → `recordings/` (the committed oracle truth) → `lsp-replay.test.ts`
(offline; asserts the message set is byte-identical per vendor — the single criterion; a `KNOWN_DIVERGENCES` ledger
is the only opt-out). The full map is `TESTING.md` and `test/README.md`. `test/corpus/` is the real-project ratchet (a miss ⇒ add a fixture, never a threshold tweak); unit
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
| Constant evaluation — the two folds, held together by `test/conformance/fold-agreement.test.ts` | `frontend/types/const/fold` (the AST fold) · `transpile/semantics/fold` (the IR fold) |
| The integer store wrap | `frontend/types/width` |
| BIT-as-BOOL and the type predicates | `frontend/types/predicates` |
| Literal typing | `frontend/types/literal` |
| Type defaults (a type's zero) | `frontend/types/defaults` |
| Enum numbering and an enum's default | `frontend/types/enums` |
| A type's byte layout (size, alignment, the field-packing rule) | `frontend/types/layout` (`typeBytes`, `packFields`) — the front-end's SIZEOF; lowering's frames pack with `packFields` (`transpile/lower/storage/bytes`) |
| Arithmetic result types | `frontend/types/arith/` (`runtime`, `checked`, `temporal`, `operators`) |
| The EXTENDS chain, FB and interface | `frontend/symbols/extends` `extendsChain` |
| The transpiler's input assembly (files, libraries, attributes) | `transpile/lower/project` |
| The lowering's view of a call's parameters | `transpile/lower/calls/parameters` (over `frontend/types/infer/callee`) |
| Place identity · the tag encoding | `transpile/lower/places/path` `staticKey` · `transpile/lower/core/tags` |
| The value semantics (what an IR node means on values) | `transpile/semantics` |
| The IR walk | `transpile/ir/walk` (`childrenOf`, total over every node kind) |
| Fault kinds and messages | `transpile/ir/faults` |
| The Rust runtime | `transpile/emit/rust/runtime` — mirrored by `transpile/semantics` through the shared `*.cases.ts` tables |
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
library resolution, corpus verification) live in `behavior.md`; the concrete types in `data-model.md`; the IEC
catalog + the CODESYS↔TwinCAT differences in `language-reference.md`. This document is the structural blueprint
the build follows.
