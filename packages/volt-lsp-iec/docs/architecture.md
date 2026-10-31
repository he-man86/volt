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
G  server        LSP 3.17 / stdio · dispatch · capabilities · lifecycle · push|pull diagnostics (resultIds) · progress · watched-file batches
W  workspace     WorkspaceStore (eager index, per-file disk sync, quarantine) · one scope per application · the workspace scan · source extensions · binding
E  services      navigation · hierarchy · hover/completion/signature-help · inlay-hints · code-lens ·
                 semantic-tokens · structure · formatting · code-actions
D  analysis      diagnostics orchestrator · messages · the checks
C  types         elementary facts · Type model · resolve · const · infer · compat · arith · render   ┐
B  symbols       symbol table · binder · scope-nav · scoped-bodies (the shared ST-body iterator)    │ frontend/
A  syntax        vocabulary · lexer · complete AST · parser · literals · pragmas · file format      │ (+ library)
                 (network text: ST with % lines — a network/ folder in syntax and in the checks)
                      ↘ transpile (Rust backend) consumes the front-end directly — headless test execution
```

## The tree

One line per folder, held to the disk both ways by `test/package/structure.test.ts`: a folder missing here, or a line
naming a folder that is gone, fails it — so does a loose file at the top of `src/`, and a
script not in `scripts/README.md`. Network text (LD/FBD) is ST with `%` lines, so it has no root folder: the syntax
layer reads its `%` lines and the checks hold what a network may hold, each in a `network/` folder. Unit tests sit beside their module; `test/` holds what crosses
modules.

```
src/  the product code, one folder per layer; imports point down the stack (scripts/check-layering.ts)
  frontend/  A–C — the front-end every consumer asks: syntax, symbols, types, and the library format
    library/  the Volt library format: path layout, manifest, materialization (a leaf that imports nothing)
    syntax/  A — ST text to a tree: vocabulary, lexer, AST, parser, literals, pragmas, the workspace file format
      ast/  the AST node types, their walks, and questions about declarations answered from the tree alone
        nodes/  the AST node types, one file per family: expressions, statements, types, declarations, units
      format/  the Volt workspace file format: the %LANGUAGE line, folders, which reader reads a body
      lex/  the vocabulary, the token kinds and the hand-written ST lexer
      literal/  literal values: numbers, strings, durations, calendar values, direct addresses
      network/  network text (LD/FBD): its % lines, its networks, the statement tokens the ST parser reads
      parse/  the ST parser: bodies, statements, expressions, type expressions, declarations
        units/  one parser per top-level unit (PROGRAM, FUNCTION_BLOCK, METHOD, PROPERTY, TYPE, GVL …)
      pragmas/  attributes in the AST, the attribute names each dialect knows, and the conditional-compilation pragmas
    symbols/  B — the scope tree: binder, lookup, scope navigation, EXTENDS chains, the scoped-body iterator
    types/  C — elementary facts, the Type model, resolution, compatibility, rendering, layout
      arith/  the operators' typing rules: runtime and checked arithmetic, temporal arithmetic
      const/  constancy and the AST constant fold
      infer/  expression type inference and a call's callee
  analysis/  D — the diagnostics: pipeline and registry, per-vendor messages, shared rules, the checks
    checks/  one folder per concern; a check imports no other check, its test sits beside it
      calls/  call arguments against the callee's parameters
      declarations/  declarations, initializers, addresses, VAR sections
      flow/  control flow: CASE labels, jumps, loops, empty blocks
      names/  name resolution: unresolved, ambiguous, shadowed names
      network/  what an LD/FBD network may hold — the one network check, outside the registry
      oop/  function blocks, methods, interfaces, properties, inheritance
      pragmas/  pragma and attribute diagnostics
      syntax/  every parse error the parser recorded, and the body that states no language (outside the registry)
      types/  type checks: assignments, conversions, operators, bounds, overflow
      workspace/  the workspace's own findings: a materialization another Volt wrote, said on its manifests
    messages/  every message text, one slice per check group, one template per message for both vendors
    pipeline/  the registry, its run order and the context a check is handed, and one document's findings composed
    reachability/  which units and members are dead, and which objects are excluded from build — the server suppresses diagnostics on both
    shared/  rules more than one check applies, the diagnostic item and its fixes, the fix text edits, the near-miss engine
  services/  E — the LSP features over the layers below
    assist/  hover (the built-in hover text among it), completion, signature help, inlay hints, code lens, code actions
    formatting/  the formatter
    navigation/  definition, type definition, the reference set, highlight and rename, implementation, hierarchy, the override chain a rename spans
    shared/  the one cursor-to-symbol resolution, positions, locations, symbol kinds
    structure/  document and workspace symbols, folding, selection, semantic tokens
  workspace/  the WorkspaceStore (documents, the incremental index, per-file disk sync, the quarantine), one scope per application, the workspace scan, the writable-source extension set, the binding's vendor and applications
  server/  G — LSP 3.17 over stdio, the DiagnosticsPublisher (push or pull, resultIds), watched-file batches and the fs.watch fallback, the process environment (config.ts), the vendor (vendor.ts), and the CLI entry bin.ts
    handlers/  one file per request group, registered over the one ServerState (state.ts): lifecycle, documents, diagnostics, navigation, assist, structure, formatting
  transpile/  the Rust backend — it consumes the front-end only
    emit/  the printers of the IR
      rust/  IR to Rust text and its source map
        runtime/  the Rust helpers the emitted code calls, mirrored by semantics/
    interp/  the IR interpreter — the oracle the emitted Rust is checked against
    ir/  the transpiler IR every backend consumes
    lower/  AST to IR — the only place ST semantics are decided
      builtins/  the builtins' lowering and their arity
      calls/  calls: binding, in-outs, outputs, FB and method calls, SUPER
      core/  the frame, the shared builders, the AST walks, the identity keys
      diagnostics/  the refusal registry
      entry/  the per-POU pipeline and the source path
      expressions/  expressions, date and time arithmetic among them
      init/  the init step: initializers, FB_init, attributes
      interfaces/  calls through an interface
      network/  plain-ST network text (LD, FBD): its boxes, wires and elements as the ST they run as
      places/  places, their paths and access guards
      pointers/  pointers, references and addresses
      project/  the input assembly: files, libraries, attributes
      statements/  statements: assignment, loops, CASE, jumps
      storage/  storage: frames, layout, direct addresses
      values/  literals, constant folds, conversions
    pipeline/  the composition root: lower, then run or print
    semantics/  the value model: what an IR node means on values
test/  what crosses modules, one folder per concern (map: test/README.md)
  analysis/  the analysis measured: every check and message builder against both vendors' builds and the corpora
    baselines/  its pinned findings and ceilings
  baseline/  the baseline discipline both measures share: pinned findings, ceilings that only fall
  catalog/  every documented Cnnnn code has a repro and a message
  conformance/  the fixture contract: LSP replay, transpile replay, the map, backends, properties
    fixtures/  one fixture per rule, grouped by concern (map.generated.ts maps every one)
    recordings/  the committed oracle truth: CODESYS and TwinCAT builds and runs
    support/  the suites' shared machinery: replay, evidence, divergences, rustc
      notes/  the authored notes the fixture map renders
      transpile/  the transpile replay's harness
  corpus/  the real-project ratchet over test-corpus/
    support/  the corpus projects, read once, their diagnostics, and the wire-code debt list
  frontend/  the front-end measured: parse census, printer fixed point, resolution, type and fold dumps
    baselines/  its pinned findings and ceilings
  libraries/  the library repo's ST bodies, run
  lsp/  the server as a client sees it: the black-box protocol suites, and the LSP test client (harness.ts) every server test drives
  package/  the package's own shape: the build compiles, the layering, this tree
  support/  test support colocated tests read: the URI a test names a source by, the preload that turns network text on, the network-text documents the network tests share
libraries/  the library repo: referenced libraries' elements in ST, per version, for the transpiler
scripts/  dev tooling — recorders, gates, generators, audits, measurements (every file: scripts/README.md)
docs/  this file, behavior.md, data-model.md, language-reference.md, the vendor references
test-corpus/  the real projects the corpus suite reads
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
and the library format). The consumers are `analysis`, `services`, `server`, `workspace`, `transpile`, `libraries/`, the
tests and the scripts.

**Indexes.** Each sub-layer has one curated `index.ts` that names its exports one by one (no `export *`): the export
list IS the public API, and it holds exactly the names something outside the sub-layer imports — a name nobody outside
uses is file-private. `syntax/index.ts` — the lexer, the AST node types, the parse entry points, the walks, the literal
values, the pragmas and the workspace-format surface; `symbols/index.ts` — the read API (lookup, scope navigation,
EXTENDS chains, precedence, the scoped-body iterator) plus a `build` namespace (`buildSymbolTable`, `bindFile`,
`unbindFile`, `relink`, `localScope`), so a reader and a builder cannot be confused; `types/index.ts` — every type
fact, rule and engine a consumer asks; `library/index.ts` — the path layout, the manifest and the materialization
format. There is no front-end-wide index and no package barrel: a consumer imports the sub-layer index it needs.

**Import rules** (`scripts/check-layering.ts`, over `src/`, `test/`, `scripts/` and `libraries/`, tests included; run
inside `bun test` by `test/package/layering.test.ts`, which fails on any violation — there is no known-violation
list):

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
Text to a tree, and nothing about meaning. `lex/` — the token model, the vocabulary (`vocabulary.ts`: every keyword and the
dialect's differences; `word-sets.ts`: the named keyword subsets the parser asks about; `prefixes.ts`: the literal
prefixes and the punctuation) and the lexer (error-tolerant, trivia-preserving; `lexer.ts` the loop, one scanner per
token class). `ast/` — the **complete AST** (`nodes/`, one file per family: declarations · type expressions
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
CODESYS grammar: the `%LANGUAGE <LANG>` line and the body splitter, the `%`-lines (`object-properties.ts`: an
object's properties — `%CLASS`, `%FOLDER`, `%EXCLUDE_FROM_BUILD`, … — the closed key list the bridge's
`PropertyLines` spells, read and reported but never analysed as code; any other `%…` line is code), which reader reads a body — its stated language alone, never what the text looks like — and what a file's
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
`messages/` (EVERY message text, one slice per check group — `shared.ts` the builders several groups call — each ONE
template per message for both vendors, the difference decided once in `index.ts` `messagesFor`; and the compiler-exact
type text),
`error-code-map` (slug → `Cnnnn`), `shared/` (the rules more than one check applies: `diagnostic-item` and its
`emit`, `rules` — the store, narrowing, conversion-argument and binary-operator rules the ST checks and the
network-text checks share — `resolution`, `hole`, `expr-echo`, `body-context`, `compiled`), and `checks/` — thin
walks over those rules, grouped by concern: `types/` · `declarations/` · `names/` · `oop/` · `calls/` · `flow/` ·
`pragmas/` · `syntax/`. A check imports `shared/`, `messages`, `config` and `pipeline/context`, never another check or
the registry, and has its test beside it (`scripts/check-layering.ts`, rules A2–A6; openspec analysis-conformance
design.md §2). Every body-walking check iterates through `symbols/scoped-bodies` (one loop, not a per-check copy). Each
check traces to a conformance fixture recorded against the live compiler. Dead-code reachability — which units and
members are dead — is an analysis of the program and lives in `reachability/` (out through `analysis/index`), beside
exclusion (`reachability/exclusion` `effectivelyExcluded`, the one place that decides which objects the compiler does not
build: an excluded object gives nothing whatever `diagnoseDeadCode` says, and its code is no reachability edge); the policy,
suppressing diagnostics on dead code unless `diagnoseDeadCode`, is `pipeline/document` `documentFindings` (one document's findings composed: the library gate, the dead-code and unstated-body quiet, the missing-language finding; the server adds only the LSP conversion — openspec lsp-server-scheduling 2.4).

The registry's ORDER is a contract (`registry.test.ts` lists it): a check that reads earlier findings says which codes
in its entry's `reads`, and nothing else of `out` is read. `diagnostic-census.test.ts` (test/analysis) measures every
check and message builder against both vendors' build recordings and the corpora, with ceilings that only fall.
**Network text is ST**, so every registry check reads it; the one check of what a network may hold is
`checks/network/`'s `networkDiagnostics`, outside the registry, merged by `pipeline/document`.

### E — `services/`
The LSP features, thin over C/D via `shared/` (`resolve-at` cursor→symbol, positions, `locations`,
`symbol-kinds`): navigation (definition · type-definition · references · rename · highlight ·
implementation), `hierarchy` (call + type), `assist` (hover · completion · signature-help), `inlay-hints`
(inferred types + parameter names), `code-lens` ("N references" · "▶ Run test"), `semantic-tokens`, `structure`
(document/workspace-symbol · folding · selection), `formatting` (`format` — the document, range and on-type requests — over `print`, the printer · editorconfig), and
`code-actions`, which RENDERS quick fixes and derives none: the check that reports a finding produces its fixes as data
(`DiagnosticItem.fixes`, `analysis/shared/diagnostic-item.ts`), `toLspDiagnostic` carries them in `Diagnostic.data`, and a
diagnostic that comes back without that data gets no action, nor does a fix whose edit range no longer holds the text
it was made for (`FixEdit.replaces`: a diagnostic published before the client's latest edit; openspec lsp-quick-fixes
design.md §2). A fix whose edit rewrites text holding another error is withdrawn after the policy
(`withdrawBlockedFixes`): that error survives the edit, so the result cannot build clean. A client that does not declare
`publishDiagnostics.dataSupport` is told once, at `initialize`, that it will get no quick fix. Every fix edit is in the
reporting document (a `FixEdit` names no other). The checks build their edits with `analysis/shared/fixes.ts` and their
"did you mean" candidates with `analysis/shared/near-miss.ts` (one engine); the parser records what a syntax error is
missing (`ParseError.missing`) and `checks/syntax/parse-errors` turns it into the insert. Fixes marked `fixAll` are also
answered as "Fix all '<code>' in the file" and as `source.fixAll.volt`, over the document's own findings, computed only
when asked. A rename of a method or property spans its override chain (`navigation/override-chain`), refused by name
when the chain reaches a library member.

### Built-in hover, and network text in every layer
There is no catalog layer. What the compiler provides is the front-end's (`types/builtins.ts` `builtinName`, the
elementary facts, `syntax/pragmas/known-attributes.ts`); the hover TEXT for it is a service,
`services/assist/builtin-hover.ts`, whose one entry both hover paths ask, in the project's dialect — a built-in or an
attribute the dialect lacks gets no tooltip. Ranges derive from `frontend/types/elementary`. The FBD/LD family has no folder of its own: it is another
language the layers read, **reusing the shared core** — one type engine, one orchestrator, one service set.
Network text is ST with `%` lines (`packages/volt-cli/docs/network-text.html`, its cases in
`packages/volt-cli/test/fixtures/network-text-st`): `frontend/syntax/network/plain-st.ts` reads the `%` lines and hands
the ST parser the statement tokens; `frontend/symbols/network-scope.ts` declares the body's wires over the POU's scope;
`analysis/checks/network/_plain-st.ts` is the one check of what a network may hold. Every other check and service is
ST's.

### G — `server/`
LSP 3.17 over stdio (`--stdio` only), one vendor-keyed binary: dispatch, framing, capabilities, and lifecycle — the LSP
adapter and nothing else (layering rule S1: it imports only `analysis/index`, `services/index`, `frontend/*/index`,
`workspace/*` and itself). The vendor is decided once, at `initialize` (`vendor.ts` `servedWorkspace`), with the folder
crawled: the first bound workspace folder's binding (`workspace/binding.ts`), else `--codesys|--twincat`, else a refusal by
name — never a guessed dialect; a flag that contradicts the binding is refused naming both. Thin handlers over the layers
below; the documents live in the workspace layer:
- `workspace/workspace-store` — the **WorkspaceStore**: the open-buffer and on-disk source layers merged by normalized
  URI (open buffer wins; `document-key`), a `(uri, version)` parse cache, the memoized project symbol table
  (`project-build`) and, when the binding states two or more applications (`binding` `boundApplications`, from
  `ide-refs.json`), one table per application — its own documents and libraries plus the POU pool's, so a name resolves
  inside its own application and the same GVL in two is no C0136 (`application-scopes`); a pool document is analysed in
  EACH application's table, as CODESYS compiles it in each (`projectsFor`) —, the dead-code cache (`dead-code-cache`), the reference state, the config each document is analysed under (`project-configs`: each `.projectsettings` over the editor's options for the documents under its own folder — one per PLC project of a TwinCAT solution), and a `generation` bumped only when
  what analysis sees moves (the merged text, the refs, the task roots, the config). The disk layer is crawled ONCE, at
  `initialized` (`seedDisk`); after that it changes ONE FILE AT A TIME (`upsertDisk` / `deleteDisk` / `deleteDiskUnder`,
  a watched batch's files rebound together with one relink in `diskBatch`), and only a reference file (`.library`,
  `.device`, `.task`, `.projectsettings`) or a directory event re-scans the references (`workspace-refs`
  `scanWorkspaceRefs`, which reads no source; `setRefs`). A document whose parse or bind throws is **quarantined**
  (`quarantine`, one per layer): out of the merged set until its content changes, the project rebuilt without it,
  logged by name, and reported as one `not-analysed` error — never a clean report. A document whose FINDINGS throw
  (input past the runtime's stack) is not quarantined: its declarations stay in the project, and it answers one
  `not-analysed` error computed and logged once per generation (`DiagnosticsPublisher.compute`). Freshness comes from
  `workspace/didChangeWatchedFiles` (**not** file-operation events — one item per file makes a rename a delete+create
  the watcher already reports); a client that cannot register a watcher gets the server's own recursive `fs.watch`
  (`server/file-watch`), fed through the same batch.
- `server` — `runServer(input, output, flag, version, exit)`: the capabilities, and one `ServerState` (`state.ts`: the
  store, the vendor and root decided, what the client supports, the semantic-token cache, the `Logger` to
  `window/logMessage`, and what several groups run over it — the crawl behind an awaited, bounded (2 s) progress create
  so `begin` precedes `end`, the reference re-scan, the live configuration, the lifecycle gate every handler is
  registered through (-32002 before `initialize`, -32600 after `shutdown`, notifications dropped), and the one way the
  process ends: the `exit` notification, a closed connection and the 3 s `processId` watchdog all call the `exit` seam
  `bin.ts` passes as `process.exit`). Requests cancelled before dispatch answer -32800 and are never computed
  (`cancelUndispatched`). The handler groups, one file per request group under `handlers/`: `lifecycle` (initialize,
  initialized — the crawl and the watchers' registration, `**/*` Create|Delete for folders beside the extension globs —,
  shutdown, exit, configuration), `documents` (open, incremental sync, save, close, and watched-file batches through
  `disk-sync` `applyWatchedChanges`: delete only on a fact, an unreadable file kept and re-read next batch, a folder
  matched at its boundary, ONE refresh set per batch and none when nothing moved), `diagnostics` (pull), `navigation`,
  `assist`, `structure` (symbols, folding, selection, semantic tokens full · range · delta) and `formatting`. A handler
  group reads the vendor from the state and decides nothing.
- `diagnostics-publisher` — the **DiagnosticsPublisher**, the one owner of how diagnostics reach a client: push
  (`publishDiagnostics`) OR pull (`textDocument/diagnostic` · `workspace/diagnostic`), never both; the `indexed` gate
  (before the crawl a pull answers `full []` with no resultId); each URI's findings cached at the store generation, so
  a pull at an unchanged generation computes nothing; a `resultId` = the sha1 of the findings, so after a change only
  the documents whose findings moved answer `full` and the rest `unchanged`; the open buffer's `version` on every
  report and push; the manifest warnings beside the documents. In push mode a change re-publishes the other open
  documents and the manifests only when their findings moved.
- `document-diagnostics` — the LSP conversion only: `documentDiagnostics(store, doc)` reads the store's inputs and
  converts `analysis` `documentFindings` (the library gate, the dead-code and unstated-body quiet, the missing-language
  finding — composed in `analysis/pipeline/document`); `libraryManifestDiagnostics` converts the manifests' warnings
  (`analysis/checks/workspace/materialization`). Push and pull share it, so the two can never diverge.

Measured (`scripts/bench-server.ts`, openspec lsp-server-scheduling 0.1 → 3.1, pro2193 7759 files): 10 idle workspace
pulls 23 s (every one a full recompute) → 0.47 s, all reports `unchanged`; one save re-parses 1 file, not 7759, and
blocks the loop 27 ms, not ~2.1 s; a hover behind a workspace pull waits 31 ms, not 2.4 s.

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
`test/libraries/standard.test.ts` holds over every short buffer. A whole STRING VAR_IN_OUT is lent as its value, the copy
at its declared capacity (`string_input_lent_inout_wider`). Bound WIDER than it declares, a STRING VAR_IN_OUT is the
caller's buffer seen through its declared capacity (`lower/calls/string-inouts.ts`, transpile-restructure 8.2): a routine
is lowered per bound capacity, its slot the caller's type — `io[k]` reads and writes the caller's units — with `readAs`
the declared type, so every copy of it takes the declared units, but a comparison, which reads the caller's string in
place; a whole store into it writes within the declared capacity (the interpreter's `storeString`, Rust's `store_within`);
SIZEOF is the declared. Bound narrower, CODESYS refuses it (`call-inout-short` [invalid]) but for a VAR_IN_OUT CONSTANT; an FB's
bound at another capacity is refused (`call-inout-capacity` [not-modelled]: one body serves every instance).

**The folders** (openspec `transpile-restructure` design.md §2; each test sits next to its module as `<file>.test.ts`):

```
transpile/
  index.ts          the public barrel — explicit named exports, pinned by index.test.ts
  pipeline/         the composition root: load (lower, then run) and lowerAndEmit; the ST → lower → interp tests
  ir/               expr.ts stmt.ts program.ts — the node contract, and the one field lookup every layer reads a field step
                    by (program.ts `fieldIn`); walk.ts — the one exhaustive walk (childrenOf) every IR walk is built on;
                    path.ts — the IDE path grammar; faults.ts — fault kinds and their texts
  semantics/        value.ts nan.ts store.ts convert.ts arith.ts operators.ts builtins.ts math.ts text.ts parse.ts string.ts
                    memory.ts instantiate.ts fold.ts faults.ts; cases.ts and the *.cases.ts tables the twin tests share
  lower/
    entry/          lower-unit.ts lower-source.ts checks.ts finish.ts — where a POU's lowering starts and ends
    project/        prepare.ts library-base.ts — the transpiler's input assembly (files, libraries, attributes)
    diagnostics/    codes.ts (the registry) diagnostic.ts — a refusal by name
    core/           lowering.ts shared.ts (the frame and the POU's state) temps.ts nested.ts build.ts chain.ts
                    ast-walk.ts tags.ts keys.ts (the identity keys: a frame, a run, a variable in either, an imaged type)
    values/         literals.ts fold.ts enums.ts convert.ts promote.ts
    storage/        layout.ts declare.ts statics.ts addresses.ts bytes.ts unions.ts
    init/           state.ts step.ts sequence.ts fb-init.ts fb-init-args.ts instance-init.ts initial-values.ts
                    temp-resets.ts position.ts attributes.ts bindings.ts — an address bound at its declaration is its
                    slot's initial value, proven unread before it runs
    places/         places.ts names.ts self.ts globals.ts bounds.ts path.ts access-guards.ts
    pointers/       state.ts address.ts store.ts deref.ts borrowed.ts cursor.ts any.ts escape.ts image.ts
                    image-rewrite.ts raw-bool.ts bool-views.ts — the escape pass, the image layout and its rewrite are
                    model 3's, and the BOOLs held as their byte (`bool-views.ts` the escape pass's fixed point over them)
    expressions/    expressions.ts operators.ts calendar.ts partial-access.ts
    builtins/       arity.ts builtins.ts value-functions.ts system.ts clock.ts conversions.ts sizeof.ts length.ts
    statements/     statements.ts assign.ts loops.ts case.ts
    calls/          routines.ts routine-frame.ts facts.ts variants.ts parameters.ts invoke.ts fb-call.ts outputs.ts
                    binding.ts super.ts property.ts specialize.ts last-binding.ts reentrancy.ts namespace.ts
                    string-inputs.ts string-inouts.ts
    interfaces/     state.ts tags.ts lend.ts dispatch.ts query.ts
    conditions.ts   the exec oracle's condition world (read by project/ and calls/)
  interp/           machine.ts frame.ts calls.ts runner.ts — executes the IR, decides nothing
  emit/rust/        module.ts structs.ts names.ts types.ts values.ts printer.ts precedence.ts place.ts image.ts
                    expr.ts convert.ts builtins.ts calls.ts stmt.ts loops.ts routine.ts locals.ts tail.ts reinterpret.ts —
                    prints the IR, decides nothing
    runtime/        string.ts text.ts parse.ts numeric.ts pointer.ts bytes.ts — the Rust the emitted code carries, by
                    registry (index.ts); the mirror of semantics/
```

**Every refusal names what it asks of the user** (`lower/diagnostics/codes.ts`, openspec transpile-refusal-classification):
`invalid` — CODESYS refuses the ST too, fix it; `not-modelled` — valid ST, understood, not built, wait or ask;
`not-measured` — valid ST whose behaviour no recording settles, record it. Each code's kind was decided from its call
sites, the fixtures whose lowering reaches each site and what the vendor did with them, and the corpora (every corpus
project builds), and where none of that decided, a fixture asked CODESYS first (`fixtures/{calls,memory,oop,operators}/
refusal-kinds.ts`). A site valid ST reaches is never `invalid`; a code whose sites refused two kinds was split
(`diagnostics/classification.test.ts`). The rules were applied to the codes that change classified; seven `invalid` codes
classified before it are still reached by valid ST, named in `codes.ts`'s header until a change re-reads them. The lists
below name each code's kind in brackets.

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
`project/`. Rule 6: no product file under `src/` imports `test/` (a colocated test reads the test support there). Size is gated too (`scripts/check-size.ts`, over all of
`src/` and `test/` since lsp-same-standard 1.1: a file within 400 lines, a test within 600, a function within 80; any
one over fails — there is no ceiling list).

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
`pointer-shape` [not-modelled] (the address of a BIT, of a dereference), `cursor-overrun` [not-modelled], `sizeof-unmeasured` [not-measured], `layout-unmeasured` [not-measured],
`dynamic-memory` [not-measured] (`__NEW`/`__DELETE`), `call-inout-alias` [not-modelled], `place-not-local` [not-modelled], `image-stack` [not-modelled] (an escaped routine local),
for a TAGGED pointer (a pointer that holds addresses does all of these) `pointer-type` [not-modelled] (read or given as another type than
its target — a REFERENCE bound to another type than its own, not an FB derived from it, is `reference-type` [invalid],
which both vendors refuse; a REFERENCE given is read as what it refers to, so `REF=` from a REFERENCE of the same type is
`pointer-type`), `pointer-step` [not-modelled] and `pointer-runtime-index` [not-modelled] (stepped, or the address of a runtime-indexed place) and
`pointer-order` [not-modelled] (dereferenced or copied before any address was stored into it), `pointer-value` [not-modelled] (a pointer's value used
as a number — a mixed site, its vendor-refused half not yet split off, see `codes.ts`'s header; an integer the assignment table takes stored as a pointer — one it refuses, a 32-bit integer on the 64-bit
target, is `integer-into-pointer` [invalid]; stepped by what is no number, `pointer-operand` [invalid]), `pointer-foreign` [not-modelled] (a pointer INPUT followed in an FB body
lowered as any POU but the root — an FB reached by a call: its caller's address would have to be lent per call; a
METHOD/ACTION/FUNCTION routine's inputs are supplied by its caller and not refused) and `pointer-root-input` [not-measured] (a pointer
INPUT followed in the root POU, which has no caller to supply it — a harness limit, not a work item), `any-input` [not-measured] (an ANY
argument that is no named variable, or whose size is unmeasured), `call-fb-inout` [not-modelled] (a METHOD reaching its FB's
VAR_IN_OUT where no binding can be known), `pointer-outlives` [not-modelled], `pointer-targets` [not-modelled] (a pointer that would hold both a tag and an index, or a tag and an address; a
copy of a pointer of several targets; a target set that still grew after `ESCAPE_PASSES` lowerings, `entry/lower-unit.ts`),
`interface-instance` [not-modelled] (an instance at a runtime index), `interface-instance-relative` [not-modelled], `call-global-instance` [not-modelled] (a METHOD
called on a GVL's instance, directly or through an interface); a pointer→DWORD conversion is vendor-refused.

*A BOOL whose byte another type reaches* (transpile-restructure 8.2, design.md §7.2 step 8c) is HELD AS ITS BYTE
(`lower/pointers/raw-bool.ts`, `IrSlot.rawBool`: a BYTE slot): CODESYS keeps the whole byte a POINTER TO BYTE wrote into a
BOOL and every operator acts on it (`bool_byte_ops`, the bytes 2, 3 and 255) — AND / OR / XOR the bytes, NOT bit 0
inverted and the rest cleared, `=` / `<>` the bytes, IF any byte but 0, BOOL_TO_INT / BOOL_TO_BYTE bit 0, and a copy, a
FUNCTION's or an FB's input (in the call or `inst.x :=`), MOVE and a FUNCTION's VAR_IN_OUT keep the byte (`bool_byte_flow_*`,
gate 8c). A POINTER TO BOOL over what is no plain BOOL's byte — a BYTE, a WORD, an ARRAY OF BYTE, a raw BOOL, a pointer of
another type copied into it — is a BYTE VIEW: it dereferences as a BYTE and reads by the same table
(`bool_pointer_over_bytes`, `byte_pointer_copied_to_bool_pointer`). The escape pass names them (`pointers/bool-views.ts`): a
BOOL whose address reaches a pointer of another target type — given, or carried there by a pointer copy
(`bool_pointer_copied_to_byte_pointer`) — is a seed; a POINTER TO BOOL given another type's bytes, a raw BOOL's address or a
copy of another type's pointer is a byte view; every BOOL a store, an input or an in-out fills from a raw one's byte (a
load, an AND / OR / XOR of one — not a NOT or a comparison, which answer 0 or 1) is raw too, to a fixed point. Every other
BOOL keeps `bool` / `boolean`. Refused by name `bool-byte` [not-measured]: a raw BOOL's byte read anywhere else (a WHILE, an order, SEL,
an unmeasured conversion, a destination no key names — `refuseUnmeasuredRawBools` walks the IR for one no measured
operator took); a BOOL's byte no key can follow — an element's or a field's address given to (or a pointer holding one
copied into) a pointer of another type, a byte view no variable names, the address of what holds a BOOL (a struct, an
instance, an array) given to a pointer that views it otherwise; and a raw BOOL lent to an FB's VAR_IN_OUT.

*Unions* (transpile-restructure §3.3/§3.4, step 7.8d) stay out of the image: a UNION is laid out as a struct holding
each member, and a store into one member is followed by ONE assignment per other member, the stored member's
little-endian bytes read at that member's type — the IR expression `reinterpret` (`lower/storage/unions.ts`
`unionCopies`; the interpreter's twin is `semantics/memory.ts`, the Rust `to_le_bytes`/`from_le_bytes`,
`emit/rust/reinterpret.ts`) — so every read stays a plain field read. A union of pointers keeps one field per member too
(the DUT struct's fields are the emitted Rust's contract). Refused by name: `union-overlay` [not-measured] (a member that is not an
integer — an enum is its base integer —, a bit string of 8 bits or more (BYTE to LWORD: a BOOL or BIT member is
refused, though BOOL is ANY_BIT), a REAL/LREAL or a one-dimensional array of them — so also a STRING, a duration, a
struct, or a pointer beside such members), `layout-union` [not-modelled] (a member with an initial value, which CODESYS
builds: `rk_union_member_initial_value`) and
`union-write` [not-modelled] (a member written other than by `:=` — a VAR_IN_OUT or output binding, a latch, a chain link, a FOR
variable, an address taken — or reached through a runtime index).

*A REAL NaN is its bits* (transpile-restructure 8.2, design.md §7.2 step 8c; `semantics/nan.ts` `NaNBits`): JavaScriptCore
keeps one NaN in a `number`, CODESYS keeps the sign and payload — so a REAL or LREAL NaN value is its bits and every other
REAL stays a number. Recorded as bits (`nan_payload_ops*`, the cells in `semantics/nan.cases.ts`): an operation answers its
first NaN operand quieted (x86 SSE, the source's operand order), NEG keeps its sign and ABS clears it (the Rust prints
`iec_fneg32` / `iec_fabs32`, where `-x` flips the sign and `abs` keeps a signalling NaN), a NaN made from no NaN is x86's
default 16#FFC00000, REAL <-> LREAL quiets it and moves its payload, a copy, a load, a store and the selects carry it as
it is. The emitted Rust CHOOSES each NaN in the code (gate 8c): a REAL `+ - * /` is `iec_fadd` / `iec_fsub` / `iec_fmul` /
`iec_fdiv` (`iec_fdivz` with the zero check), a function `iec_fn(x, f64::ln)`, REAL <-> LREAL `iec_widen` / `iec_narrow`
(`emit/rust/runtime/numeric.ts` `IEC_REAL`) — Rust leaves which NaN an operation answers to the compiler, and an optimized
build commuted an add and folded constants into another NaN than CODESYS's; the twin harness runs the NaN cells in an
`-O` build too. An initializer that folds to a NaN is refused `init-nan` [not-measured] (no IR constant holds one; the fold's bits are unmeasured).

*The IR carries the semantics.* Implicit widening is an explicit `convert` node, CASE ranges are resolved
constant bounds, FOR/WHILE/REPEAT are one `loop`, and every node carries a resolved `Type` from `frontend/types/` —
not a second type model. **If a backend ever has to decide something, the lowering is incomplete.**

*Loops* (transpile-restructure §3.1). There is no loop bound in the semantics — CODESYS caps no loop (`tr_27_loop_cap_*`) —
so only a harness bounds a runaway: `loopGuard` on `run` and `emitRust`, one body entry after a head test counted as one
pass in both backends, and its `LoopGuardError` is never a fault match. A FOR step and limit are judged by their front-end
type (`for-step-type` [invalid], `for-limit-type` [invalid]: a DINT limit on an INT counter does not compile), an expression of untyped
literals by its value. Refused by name besides those two: `for-bound-call` [not-measured] (a call in the step, or in a limit tested on
both arms of a runtime step — its run count is unrecorded) and `exit-outside-loop` [invalid]. Whether a Rust loop names its `'loop_N`/`'body_N` labels is asked of the IR before it prints
(`ir/walk.loopUses`).

*Strings* (transpile-restructure §3.2). A STRING(n) is ONE buffer of n units plus the terminator at n: the interpreter
holds it as a JS string of the whole buffer, trailing zeros trimmed (`semantics/string.ts` `held`), Rust as
`IecStr<T, N>` (`[T; N]`, the terminator implied), and `LEN` is the first 0 — the units behind it are real (`s[i]` reads
and writes them). Every Type lowering holds carries its capacity (`Lowering.resolve` applies the default 80; a capacity
that does not fold is refused `string-capacity` [not-modelled]). One store rule: `assign` into an existing string writes `min(n, m)`
units of the SOURCE buffer and a 0 there, and leaves the destination's units behind it (`storeString`, Rust
`dst.store(&src)`; a literal is a source of its own units); a `convert` fills a fresh buffer. A string conversion hands
its text through a 255-unit buffer: STRING <-> WSTRING gives STRING(255)/WSTRING(255), a parse reads at most 255 units,
a same-width TO_STRING / TO_WSTRING and a number's text are the default 80 (`lower/builtins/conversions.ts`); a WSTRING
parsed into an integer reads the WSTRING by its own grammar — the STRING parse's reading, answered only when it reads the
whole text, else 0 (`semantics/parse.ts` `parseIntegerWide`, Rust `iec_parse_int_wide`, `wstring_parse_grammar`), into
every integer type as the STRING parse does past 32 and 64 bits; a negative text into an unsigned type is 0 for both, where
a signed one wraps it (`wstring_parse_widths`, 108 cells). Refused by name:
an implicit string crossing (`assign-string` [invalid]), unmeasured escapes (`string-escape` [not-measured], `wstring-surrogate` [not-measured],
`string-non-ascii` [not-measured]), a whole-string write through a cursor's `p^` that would go past the caller's variable — a store,
a chain link, an FB output copied out, `p^` lent to a wider writable VAR_IN_OUT (`cursor-overrun` [not-modelled]), REAL_TO_STRING
(`conversion-type` [not-measured]), a Standard function's lent input that the library repo's body writes, lends writable or takes the
address of (`input-borrow-written` [not-modelled] — a repo defect, never a silent copy) and LEN_INTERNAL of a STRING longer than its
UINT count holds (`string-length-width` [not-modelled]).

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
named where it is visible but not run — its FB's ACTION, `THIS^.x`, an instance path — is `var-temp-outside-body` [not-modelled]; where
it is not visible — a METHOD, a derived body — the name is whatever else declares it, a global of that name (the
symbols' `lookup`), and a derived FB may declare its own variable of a base VAR_TEMP's name. A field holding a VAR_TEMP's
address reads it in the run that stored it, as one into the body's VAR_IN_OUT does (`pointers/state.ts` `scopedTo`). What an initializer reads is `ir/walk.ts` `initReadChildren` — `childrenOf`, an
`ADR` reading only its indices. An ADDRESS BINDING — `p : POINTER TO INT := ADR(x)`, `r : REFERENCE TO T REF= x`, a
store of an address of the frame's own static storage (or a tag) into a whole pointer slot — is no statement of the step
but the slot's initial value (`lower/init/bindings.ts`, transpile-restructure 7.8.8): run after the image pass, `foldBindings`
writes each address into the struct's field (`p: __base + k` at a static instance), and an `init()` / `__init()` left
empty goes with its call chain. It is folded only where `provenBindings` shows, on the built sequence, that nothing
before it reads or writes a variable of its name, dereferences or calls anything (each conservative); an unproven binding keeps its store, the exact
declaration-order answer. A binding reads nothing, so it never starts the position rule's walk. Refused by name: `init-reads-later` [not-measured] (a later struct's or instance's field, by any path; a VAR_TEMP read by the run-once
init step, which runs before any run holds one),
`init-reads-instance` [not-measured] (an instance declared with a structured initializer, its field, a METHOD on it, the instance
itself or a struct holding it — also handed to a call by name, as an interface lends it after the guards ran),
`fb-init-order` [not-measured] (a nested structured initializer reaching an FB_Init, or setting the sibling a STRUCT field instance's
argument reads; an argument reading a global while an FB_Init writes globals), `fb-init-argument-shape` [not-modelled] (an
argument CODESYS builds that lowering cannot pass: neither a constant, a variable nor an elementary struct field — THIS
among them, and in a struct any expression naming something —, given positionally, or bound to an FB_Init VAR_IN_OUT),
`fb-init-argument` [invalid] (an input given no argument at all, `bInitRetains`/`bInCopyCode` of another type than BOOL, a
struct field that is no elementary value, a variable of the declaring POU), `init-frame-order` [not-measured] (a PROGRAM not first called by the POU's
own top-level statements), `init-slot-order` [not-measured] (several slot methods whose order could show), `init-not-constant` [not-modelled] (a GVL
initializer that runs; a STRUCT field's dynamic initializer — a STRUCT has no init frame), `init-composite-scalar` [invalid].

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
(the fixtures in `test/conformance/fixtures/semantics/try-catch.ts`, 2026-09-19), and it CHANGES THE FAULT MODEL for the code inside the block:

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
`__CATCH` operand is declared with — does not resolve, so `ec` is `type-unknown` [not-modelled] before lowering reaches the
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
| The Volt workspace file format (the `%`-lines: `%LANGUAGE`, `%FOLDER` and the rest, which reader reads a body) | `frontend/syntax/format/` |
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
| The identity keys lowering's tables compare (`POU:`, `FB:`, `ROUTINE:`, `GLOBAL.`, `TYPE:`, `VIEW:`, `<context>.<name>`) | `transpile/lower/core/keys` |
| A field by name, in every transpiler layer · the walk along a place's path · the walk into a type at any depth | `transpile/ir/program` `fieldIn` · `transpile/lower/places/path` `typeAlong` · `holdsAtAnyDepth` |
| An EXTENDS chain inside lowering (by the binder's link, the queued bodies, name lookup) | `transpile/lower/core/chain` |
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
| Document → findings (library gate, dead-code and unstated-body quiet, missing language) | `analysis/pipeline/document` `documentFindings` |
| Findings → LSP diagnostics; push vs pull, resultIds, versions | `server/document-diagnostics` (the conversion) · `server/diagnostics-publisher` `DiagnosticsPublisher` |
| Live document + project state (open/disk layers, parse cache, eager index, per-file disk sync, quarantine) | `workspace/workspace-store` `WorkspaceStore` |
| Built-in and pragma hover text (types/operators/conversions/pragmas/…) | `services/assist/builtin-hover` |
| Dead-code reachability; exclusion from build | `analysis/reachability` (`exclusion` `effectivelyExcluded`) |

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
