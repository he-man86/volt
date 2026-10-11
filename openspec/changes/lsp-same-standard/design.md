## Context

`transpile-restructure` (archived 2026-10-11) set the standard for `packages/volt-lsp-iec`: files within 400 lines (600
for a test), functions within 80, no dead export, one home per concern, every layer in its folder, every behaviour pinned
by a recorded fixture. Only `src/transpile` is held to it. This change holds the whole package to it.

Everything below was measured at HEAD `e26aafa0bf` (2026-10-11, task 0.1) with the package's own gates run over all of
`src/` and `test/`: `scripts/check-size.ts` (`lineCount`, `longFunctions`) and `scripts/dead-exports.ts` (`exportRows`,
`nobodyIn`), driven by a single-use census script outside the repo. "NT" = network text (`*/network/*`), out of scope
until the LD/FBD coverage change: it gets ceilings at today's size and its splits are handed over (task 5.2).

## 1. The census (task 0.1)

### 1.1 Files over their limit

**`src/` product files over 400 — 19 (3 NT):**

| lines | file | target (§2) |
|---:|---|---|
| 1372 | `frontend/syntax/network/parser.ts` | NT ceiling |
| 901 | `frontend/syntax/parse/statements.ts` | split by construct |
| 896 | `frontend/syntax/ast/nodes.ts` | split by node family |
| 830 | `analysis/messages.ts` | split by check group |
| 704 | `frontend/types/const/fold.ts` | split by operator family |
| 685 | `frontend/syntax/lex/lexer.ts` | split by token class |
| 624 | `server/server.ts` | split by request group |
| 586 | `frontend/symbols/scope-nav.ts` | lookup / name index / scope queries |
| 575 | `frontend/syntax/parse/expression.ts` | precedence+binary / postfix+call / primary |
| 574 | `frontend/syntax/lex/vocabulary.ts` | keywords / parser subsets / literal prefixes+punctuation |
| 550 | `analysis/checks/calls/call-arguments.ts` | per-argument / in-out / output |
| 521 | `analysis/checks/network/network-analysis.ts` | NT ceiling |
| 501 | `frontend/syntax/parse/declarations.ts` | sections / one declaration / initializers |
| 470 | `frontend/symbols/binder.ts` | units / types / GVLs+devices |
| 468 | `frontend/syntax/parse/type-expr.ts` | named+string / array / enum |
| 459 | `frontend/syntax/pragmas/conditional.ts` | directive / condition grammar / evaluation |
| 451 | `services/formatting/print.ts` | units+declarations / bodies+statements |
| 426 | `frontend/types/infer/expr.ts` | expression / built-in call results / sizeof |
| 414 | `frontend/syntax/network/lexer.ts` | NT ceiling |

By area: frontend 13 (2 NT), analysis 3 (1 NT), server 1, services 1, transpile 0, reference 0, workspace 0.

**`src/` colocated tests over 600 — 3 (1 NT):** `services/network/network.test.ts` 1213 (NT ceiling),
`server/server.test.ts` 910, `analysis/checks/calls/call-arguments.test.ts` 870.

**`test/` suites (`*.test.ts`) over 600 — 4:** `conformance/transpile-replay.test.ts` 888, `corpus/corpus.test.ts` 793,
`conformance/map.test.ts` 731, `conformance/runtime-twins.test.ts` 711.

**`test/` non-test files over 400 — 31 (0 NT)**, in three kinds:

- generated — 1: `conformance/fixtures/map.generated.ts` 5953 (written by `rate:fixtures`; exempt by name, §2.4);
- support — 9: `frontend/rules.ts` 4629, `conformance/support/divergences.ts` 1779,
  `conformance/support/notes/lean.data.ts` 1455, `frontend/bound-census.ts` 1378, `baseline/baseline.ts` 1041,
  `analysis/census.ts` 723, `frontend/dumps.ts` 627, `conformance/support/rustc-cache.ts` 535,
  `conformance/support/fixture-units.ts` 440;
- fixture data — 21: `strings/string-edges.ts` 1998, `semantics/execution.ts` 1952, `calls/call-shapes.ts` 1495,
  `pragmas/pragma.ts` 1088, `oop/lifecycle.ts` 1023, `operators/operator.ts` 888, `declarations/section-semantics.ts`
  834, `oop/init-model.ts` 662, `memory/pointer-model.ts` 643, `grammar/units.ts` 628, `libraries/library-bodies.ts` 622,
  `types/data-type.ts` 561, `graphical/network-graphical.ts` 492, `oop/refusal-kinds.ts` 478, `batches/check-coverage.ts`
  473, `calls/refusal-kinds.ts` 465, `cross-object/cross-object-four.ts` 458, `cross-object/cross-object-two.ts` 452,
  `cross-object/cross-object.ts` 426, `cross-object/cross-object-three.ts` 417, `grammar/expressions.ts` 404 (all under
  `test/conformance/fixtures/`).

`map.generated.ts` is keyed by fixture
NAME, not by file, so moving a fixture between files is map-neutral (checked: the map holds one `fixtures/` path, in its
header comment). It is NOT order-neutral: `ALL_TESTS` is `CATEGORIES.flatMap((c) => c.tests)` in `RAW_CATEGORIES` order
(`fixtures/index.ts`), each category named after a fixture file, and the recorders walk `ALL_TESTS` in that order — a
faulting case poisons every case after it. A split keeps its rows in place: the new categories take the old one's slot in
`RAW_CATEGORIES`, in order, so `ALL_TESTS` is unchanged name for name (checked by a before/after dump of the
`ALL_TESTS` names in each step 4.4 commit).

### 1.2 Functions over 80 — 25 reported, 24 distinct (3 NT)

`checkIntrinsicOperands` (149) is reported twice: once as the function and once as the arrow (147) that is its whole
body. Distinct, outside NT — 21:

| lines | function | file |
|---:|---|---|
| 566 | `lex` | `frontend/syntax/lex/lexer.ts` |
| 486 | `runServer` | `server/server.ts` |
| 335 | `messagesFor` | `analysis/messages.ts` |
| 273 | `checkCall` | `analysis/checks/calls/call-arguments.ts` |
| 229 | `parseTypeExpression` | `frontend/syntax/parse/type-expr.ts` |
| 170 | `parsePrimary` | `frontend/syntax/parse/expression.ts` |
| 152 | `checkPragmas` | `analysis/checks/pragmas/pragmas.ts` |
| 150 | `checkHeaderRules` | `analysis/checks/declarations/header-rules.ts` |
| 149 | `checkIntrinsicOperands` | `analysis/checks/calls/intrinsic-operands.ts` |
| 129 | `parseCondition` | `frontend/syntax/pragmas/conditional.ts` |
| 109 | `inferExprType` | `frontend/types/infer/expr.ts` |
| 107 | `evaluateCondition` | `frontend/syntax/pragmas/conditional.ts` |
| 96 | `checkUnresolvedIdentifiers` | `analysis/checks/names/unresolved-identifier.ts` |
| 96 | `parseInterface` | `frontend/syntax/parse/units/interface.ts` |
| 93 | `operandSignWarnings` | `analysis/checks/types/narrowing.ts` |
| 93 | `parsePostfix` | `frontend/syntax/parse/expression.ts` |
| 90 | `parseProperty` | `frontend/syntax/parse/units/property.ts` |
| 86 | `checkOneCase` | `analysis/checks/flow/case-labels.ts` |
| 86 | `buildLayout` | `transpile/lower/storage/layout.ts` |
| 85 | `bindLibraryNamespaces` | `frontend/symbols/library-namespaces.ts` |
| 84 | `parseInterfaceProperty` | `frontend/syntax/parse/units/interface.ts` |

NT (ceilings, handed over): `parseNetwork` 101 and `parseCall` 90 (`syntax/network/parser.ts`), `next` 95
(`syntax/network/lexer.ts`). By area: frontend 12, analysis 7, server 1, transpile 1.

Tasks 4.1–4.3 name 14 of the 21; the other seven (`parsePostfix`, `inferExprType`, `parseInterface`,
`parseInterfaceProperty`, `parseProperty`, `bindLibraryNamespaces`, and `evaluateCondition` beside `parseCondition`) are
in the same files or folders and go with the step that owns their area (§2.2).

### 1.3 Dead exports

`nobodyIn(texts, "src")` (no exclusions): **72** — frontend 53, transpile 9, services 4, server 3, reference 2,
workspace 1 (the proposal's number). Per area with the transpile scope's own exclusions (its IR union members and barrel
surface): **63** — transpile 0. Of the 63, **17 are NT** (14 `syntax/network/ast.ts` union members, `TokKind`,
`CONSTRUCT_WORDS`, `v1Refusal`, and `services/network/network-services.ts` `resolveAnywhere`), leaving **46**:

| kind | n | names |
|---|---:|---|
| AST union members (`syntax/ast/nodes.ts`) | 17 | `IndexExpr` `DerefExpr` `ParenExpr` `AssignExpr` `CallStatement` `TryStatement` `IfStatement` `ForStatement` `WhileStatement` `RepeatStatement` `ReturnStatement` `ExitStatement` `ContinueStatement` `EmptyStatement` `JmpStatement` `LabelStatement` `ImplicitEnumType` |
| `Type` union members (`types/type.ts`) | 4 | `InterfaceType` `PointerTypeInfo` `ReferenceTypeInfo` `UnknownType` |
| other frontend | 16 | `FolderCursor` `FolderLine` (format/folder) · `ReadLanguage` `isImplementationKeyword` (format/implementation-line) · `ParsedLiteral` (literal/value) · `ErrorCursor` (parse/errors) · `readIdent` `refusedPropertyModifier` (parse/names) · `ReturnTypeClause` (parse/units/header) · `Condition` `UNKNOWN_OPERATOR_ERRORS` `ConditionValue` (pragmas/conditional) · `COMPILER_IMPLICITS` (types/builtins) · `EnumeratorValue` `EnumeratorNumbering` (types/enums) · `staticOf` (types/infer/member) |
| services | 3 | `FormatOptions` (formatting/print) · `CallRef` (navigation/hierarchy) · `TypeNameRef` (navigation/type-refs) |
| server | 3 | `VoltDiagnostic` (diagnostics) · `Harness` (harness) · `normalizeKey` (workspace-store) |
| reference | 2 | `ReferenceKind` `ReferenceEntry` |
| workspace | 1 | `WorkspaceScan` (workspace-refs) |

The 9 transpile names the raw count holds (`IrUnOp` `IrAddress` `IrUnary` `IrConvert` `PathSegment` `IrArrayInit`
`IrBreak` `IrContinue` `IrReturn`) are `ir/`'s types, the transpile barrel's documented surface — the standard's own
exclusion, kept.

Second list (not a gate today): **63 exports with no product caller** — used by tests or scripts only: transpile 46
(semantics 31, ir 8, emit 5, lower 2), server 6, frontend 3, services 4 (network 2 NT), workspace 2, analysis 1,
reference 1. Most are the transpile semantics' test surface by design; the server's 6 go with §2.3.

### 1.4 Files with no product importer (test support in `src/`)

A `src/` file (not a test, not an index or `bin.ts`) whose every importer is a test:

| file | importers | what it is | target |
|---|---|---|---|
| `server/harness.ts` | 5 server tests | the LSP test client | `test/` support (task 2.1) |
| `server/diagnostic-codes.ts` | `diagnostic-identity.test.ts`, `test/corpus/corpus.test.ts` | `KNOWN_UNMAPPED`, the wire-code invariant's debt list | `test/` support — task 2.1 keeps it in `server/`; the census says it is test support (§2.3) |
| `analysis/test-uri.ts` | 78 colocated tests | `uriFor`, the URI a test names a source by | `test/` support (§2.3) |
| `transpile/semantics/*.cases.ts` (6) | their colocated tests | the semantics' case tables | stay: `*.cases.ts` is the colocated-test-data suffix transpile-restructure introduced; the structure gate admits it by suffix, as it admits `*.test.ts` |

### 1.5 `server/`, `reference/`, `workspace/` — every file

| file | lines | what it is | imported by (product) | target folder |
|---|---:|---|---|---|
| `server/bin.ts` | 36 | the CLI entry (`--stdio`, `--version`) | — (package `bin`) | `server/` |
| `server/config.ts` | 15 | the process environment (`NETWORK_TEXT_ENABLED`) | `workspace-store.ts`; 5 scripts, 1 test | `server/` |
| `server/index.ts` | 3 | the server barrel | `src/index.ts`, `bin.ts` | `server/` |
| `server/server.ts` | 624 | the LSP adapter: dispatch, capabilities, 42 handlers | `index.ts`, `harness.ts` | `server/` |
| `server/diagnostics.ts` | 202 | document → LSP diagnostics, push+pull (applies dead-code suppression) | `server.ts`; 4 tests | `server/` |
| `server/diagnostic-codes.ts` | 62 | `KNOWN_UNMAPPED` | tests only | `test/` (§1.4) |
| `server/harness.ts` | 157 | the test client | tests only | `test/` |
| `server/reachability.ts` | 330 | dead-POU / dead-member detection over the parse trees | `diagnostics.ts`, `workspace-store.ts`, `dead-code-equivalence.ts` | `analysis/` |
| `server/dead-code-equivalence.ts` | 67 | when an edit leaves reachability unchanged | `workspace-store.ts` | `analysis/` (beside reachability) |
| `server/workspace-store.ts` | 268 | the live documents + project index (incremental) | `server.ts`, `diagnostics.ts`; 7 tests | `workspace/` |
| `reference/index.ts` | 4 | the catalog barrel | `analysis/checks/pragmas/pragmas.ts`, `services/assist/{completion,hover}.ts`, `services/network/network-services.ts`, `src/index.ts` | dissolved |
| `reference/pragmas.ts` | 162 | the attribute catalog (`isKnownAttribute`, `attributeNames`) + `pragmaHelp` hover text | via index: analysis (`isKnownAttribute`), services (`attributeNames`, `pragmaHelp`) | split: attribute names → `frontend/syntax/pragmas/`; `pragmaHelp` → `services/assist/` |
| `reference/reference.ts` | 202 | built-in hover text (`lookupReference`, `renderReferenceHover`, `catalogNames`) | via index: services only | `services/assist/` |
| `workspace/source-extensions.ts` | 25 | the writable-source extension set | `server.ts`, `workspace-refs.ts`; 2 scripts | `workspace/` |
| `workspace/workspace-refs.ts` | 213 | the workspace scan (libraries, settings, devices, target) | `index.ts`, `server.ts`, `workspace-store.ts` | `workspace/` |

`docs/architecture.md` still draws `reference` as layer F *between services and server* ("F reference language data
catalogs") while `check-layering.ts` ranks it 3, below analysis — the stale row the proposal names.

### 1.6 Built-in hover coverage

`lookupReference` answered against every set the front-end calls built-in:

| set | names | with hover | missing |
|---|---:|---:|---|
| `ELEMENTARY_TYPES` | 26 | 26 | — |
| `ELEM_ALIASES` | 4 | 4 | — |
| `CODESYS_ONLY_TYPES` | 5 | 5 | — |
| `BUILTIN_OPERATOR_NAMES` | 67 | 67 | — (already a test: `reference.test.ts`) |
| `BUILTIN_RESULT` | 13 | 13 | — |
| `ARGUMENT_TYPED` / `MATH_ARG_TYPED` | 6 / 10 | all | — |
| conversions (`builtinName = "conversion"`, CODESYS; every `X_TO_Y`, `TO_Y`, `TRUNC_Y` over the elementary names and aliases) | 702 | 702 | — (TwinCAT: 552) |
| `COMPILER_IMPLICITS` | 4 | 0 | `THIS` `SUPER` `IOCONFIG_GLOBALS` `TYPE_CLASS` |
| platform integers (`isElementaryTypeName`, not in `ELEMENTARY_TYPES`) | 3 | 0 | `__UXINT` `__XINT` `__XWORD` |

| `__` names (added 2026-10-11, review of step 0) | 21 | 19 | `__VECTOR` `__SYSTEM` |

The first count (7) iterated closed lists only. `builtinName` is OPEN on `__`: `upper.startsWith("__")` answers
"system-operator" for EVERY `__` name, so the built-ins it accepts are not a set any table enumerates. The `__` names the
compiler has are a closed list the front-end already holds: the 17 `__` KEYWORDS of `lex/vocabulary.ts` (`__NEW` …
`__POOL`, `__VECTOR`; `__POSITION` `__POUNAME` `__COMPARE_AND_SWAP` `__VECTOR` CODESYS-only), the 3 platform integers and
the `__SYSTEM` namespace — 21. `__VECTOR` (4 fixture files, 0 corpus) and `__SYSTEM` (240 corpus files, 12 fixture files)
have no entry either. **9 missing**: the 7 above + `__VECTOR` `__SYSTEM`. Through the service (`services/assist/hover`
on a parsed FB) all nine answer `null`. The coverage test (§2.3) iterates that closed `__` list, not `builtinName`'s
prefix test.

**The opposite direction was not measured, and was wrong (fixed in step 0):** hover fell back to `lookupReference`, which
ignores the dialect, so on TwinCAT it described `__POUNAME`, `__COMPARE_AND_SWAP`, `__POSITION`, `XSIZEOF` and ~150
LDATE/LDT/LTOD conversions (`BOOL_TO_LDATE`, `LDATE_TO_DINT`; 702 conversions on CODESYS, 552 on TwinCAT) as built-ins the
analysis reports "not defined". Both vendors now go through the one dialect-aware path: hover answers from the catalog
only where `builtinName(name, dialectOf(project))` is defined (`assist.test.ts` "a built-in the project's dialect does not
have answers nothing"). The vendor difference is a fact `builtinName` holds, not a second path in hover. The §2.3
coverage test asserts both directions per dialect: every name `builtinName` accepts has hover, and no name it refuses
does.

Side findings for the review (§3): `builtinName("__UXINT")` is `"system-operator"`, because the `__` test runs before the
type test — the platform integers are types; and that same `__` test is a broader defect (§3, "known going in").

## 2. Targets (task 0.2)

Every split is output-neutral: the fixture map, the recordings and the LSP behaviour tests do not change. A split moves
code; it does not rewrite it. A file that becomes a folder keeps an `index.ts` only where it has more than one importer
outside the folder.

### 2.1 Gates (step 1)

- `check-size.ts` `SCOPE` becomes `src` + `test` (all `.ts`). Limits: product 400, `*.test.ts` 600, `test/` non-test 400.
  `map.generated.ts` exempt by name (a generated file; `map.test.ts` already holds it). Ceilings: every file in §1.1 at
  today's count, the NT ones marked "LD/FBD change". The function list stays a warning until §1.2 is empty outside NT,
  then fails; NT functions sit in a named exemption list with their counts (may not grow).
- `dead-exports` in lint over `src`, failing on NOBODY. Exclusions generalise the transpile one: the members of ANY
  exported union declared beside them (`Expr`, `Statement`, `TypeExpr`, `Type`, `IrExpr`, `IrStmt`, the NT `Network*`
  unions) and a barrel's documented surface. Today's remainder (§1.3, 46 − 21 union members = 25 non-NT, plus `TokKind`,
  `CONSTRUCT_WORDS`, `v1Refusal`, `resolveAnywhere` NT) is a shrink-only allowlist that ends with the NT four.
- Structure gate (`test/package/structure.test.ts`): a `src/` file whose every importer is a test fails, unless named
  `*.test.ts` or `*.cases.ts`; `server/` imports only `analysis/index`, `services/index`, `frontend/*/index`,
  `workspace/*` and itself.

### 2.2 Splits (step 4)

**frontend (4.1)**

- `lex/lexer.ts` (685; `lex` 566): `lex` keeps the loop and dispatches on the first character to one scanner per token
  class, each its own file under `lex/`: trivia (whitespace, line/nested block comments, pragma block), strings
  (STRING/WSTRING), numbers (radix, decimal, real, duration), words (identifier/keyword, `#`-typed literals, ExST `S=`
  `R=` `REF=`), addresses (`%` literals, partial access `.%X0`), punctuation (backtick ident, multi/single-char,
  unknown). The closure state (`pos`, `line`, `col`, tokens) becomes one `Scanner` object the scanners take. Char
  predicates → `lex/chars.ts`.
- `lex/vocabulary.ts` (574): `KEYWORDS` + `Dialect` + `CODESYS_ONLY_KEYWORDS` (vocabulary.ts); the parser's named subsets
  (`VAR_SECTION_KEYWORDS` … `MEMBER_MODIFIERS`) → `lex/word-sets.ts`; literal prefixes + punctuation → `lex/prefixes.ts`.
- `parse/statements.ts` (901): pragma handling inside bodies (`applyPragmas`, `PragmaState`, ~180) →
  `parse/body-pragmas.ts`; list/resync machinery (`parseStatementList`, `closeBlock`, `leftOpen`, sync sets) →
  `parse/statement-list.ts`; control statements (`parseIf/Case/For/While/Repeat`, arms, conditions) →
  `parse/control.ts`; `parseStatement`, assignment, JMP, TRY stay.
- `parse/expression.ts` (575; `parsePrimary` 170, `parsePostfix` 93): precedence table + binary/unary stay;
  postfix + call + call arguments → `parse/postfix.ts` (`parsePostfix` split per suffix: member, index, deref, call);
  primary → `parse/primary.ts` (`parsePrimary` split: literal, typed literal, name/keyword operand, parenthesised,
  refusal).
- `parse/type-expr.ts` (468; `parseTypeExpression` 229): one function per type form — named/subrange, STRING length,
  ARRAY (with `parseArrayDim`), POINTER/REFERENCE, implicit enum — dispatched from a ≤80-line `parseTypeExpression`;
  enum values → `parse/enum-values.ts`.
- `parse/declarations.ts` (501): VAR sections (`parseVarSection`, `collect*Sections`, section-in-struct) stay;
  `parseVarDecl` + name/access-path refusals → `parse/var-decl.ts`; initializers (`parseInitializer`, aggregate and
  positional struct forms, bracket/repeat refusals) → `parse/initializer.ts`.
- `parse/units/interface.ts` (`parseInterface` 96, `parseInterfaceProperty` 84) and `units/property.ts`
  (`parseProperty` 90): header/members/accessors as separate functions.
- `pragmas/conditional.ts` (459; `parseCondition` 129, `evaluateCondition` 107): directive recognition stays;
  the condition grammar (tokenizer + parser, split per precedence level) → `pragmas/condition-parse.ts`; evaluation
  (world types + evaluator, split per operator kind) → `pragmas/condition-eval.ts`.
- `ast/nodes.ts` (896): by family — `ast/expressions.ts` (leaves, `Expr`, literals, initializers), `ast/statements.ts`,
  `ast/types.ts` (type expressions + DUT bodies), `ast/declarations.ts` (VAR sections, `VarDecl`, attributes), `ast/units.ts`
  (top-level units, `ParseResult`, `ParseError`); `nodes.ts` re-exports nothing — importers move to the family file
  (`ast/index.ts` remains the barrel).
- `types/const/fold.ts` (704): context + `fold` dispatch + literal/symbol reads stay; calls and built-ins (`call`,
  `builtin`, `convert`, shifts) → `const/calls.ts`; operators (`foldUnary`, `foldBinary`, `foldBool`, `foldCompare`,
  `ARITHMETIC`) → `const/operators.ts`; declared/initial values + enum values → `const/values.ts`.
- `types/infer/expr.ts` (426; `inferExprType` 109): one function per expression kind dispatched from
  `inferExprType`; built-in call results (`exptType`, `stringSelection`, `builtinArgumentResult`, `callReturnType`) →
  `infer/builtin-call.ts`; sizeof (`sizeofOperandBytes`, `storageBytes`, struct bound) → `infer/sizeof.ts`.
- `symbols/scope-nav.ts` (586): lookup chain (`lookup*`, search step, temps) stays; the name index (`NameIndex`,
  build/update, subtree index, `findScopeByName`, `scopeForUnit`) → `symbols/name-index.ts`; enum/qualified-const/GVL
  queries → `symbols/qualified.ts`.
- `symbols/binder.ts` (470): POU ingestion stays; DUT ingestion (`ingestTypeDecl/Struct/Union/Enum`) →
  `symbols/bind-types.ts`; GVLs + devices + var sections → `symbols/bind-globals.ts`. `library-namespaces.ts`
  `bindLibraryNamespaces` (85): its per-library body → a helper.

**analysis (4.2)**

- `messages.ts` (830; `Messages` interface 471 lines, `messagesFor` 335): already sectioned by check group. Becomes
  `analysis/messages/`: one file per group (shared, types, declarations, names, oop, calls, flow, pragmas, syntax, and
  network — moved whole, NT), each exporting its interface slice (`TypeMessages` …) and ONE builder for that slice
  (`typeMessages(w: VendorWording)`) holding one template per message exactly as `messagesFor` holds it today: the vendor
  differences stay the `tc ?` switches inside the one template (`possible`, `modNotDefined`, `operatorNeedsExactly` …).
  There is NO per-vendor builder. A message both vendors share has one template, so neither copy can drift from the
  other's recordings (owner, 2026-10-11: the vendors are identical on the Volt layer; a difference is a switch on a
  measured fact, never a second copy). `VendorWording` is `{ tc, possible }`, computed once in `messagesFor`.
  `messages/index.ts` composes `Messages` as the intersection of the slices; `messagesFor` calls each group builder, and
  the slices' key sets are disjoint BY TYPE: a `Disjoint<A, B, …>` assertion over the slice interfaces' `keyof` makes a
  key declared in two groups a `bun typecheck` error, so the object spread that composes them can never let a later
  group silently override an earlier one's text. Wording untouched: a before/after dump of every builder on fixed sample
  arguments, both vendors, byte-equal (single-use, deleted after the step).
- `checks/calls/call-arguments.ts` (550; `checkCall` 273): `checkCall` dispatches to per-concern functions (arity and
  formal/positional, input types, in-out checks, output targets); in-out checks → `calls/in-out-arguments.ts`, argument
  type errors → `calls/argument-types.ts`.
- long checks: `checkPragmas` (152) per attribute family; `checkHeaderRules` (150) one function per header rule
  (its nine message builders map 1:1); `checkIntrinsicOperands` (149) per intrinsic group (atomic, address, bounds,
  query); `checkUnresolvedIdentifiers` (96) traversal vs one-name decision; `operandSignWarnings` (93) per operand side;
  `checkOneCase` (86) labels vs duplicates/ranges.

**server + services (4.3)**

- `server/server.ts` (624; `runServer` 486): `runServer` builds a `ServerState` (store, root, client flags, semantic-token
  cache) and registers handler groups, one file each under `server/handlers/`: lifecycle (initialize, initialized,
  shutdown, config), documents (open/change/close/watched files), diagnostics (push, pull, refresh), navigation
  (definition, references, highlight, rename, implementation, hierarchy), assist (hover, completion, signature help,
  inlay hints, code lens, code actions), structure (symbols, folding, selection, semantic tokens), formatting.
- `services/formatting/print.ts` (451): units + declarations → `formatting/print-units.ts`; bodies + statements stay.
- `transpile/lower/storage/layout.ts` `buildLayout` (86): its member loop → a helper.

**tests (4.4)** — colocated: `server.test.ts` (910) by request group (mirrors §2.2 server handlers);
`call-arguments.test.ts` (870) mirrors its split. `test/` suites: `transpile-replay.test.ts`, `corpus.test.ts`,
`map.test.ts`, `runtime-twins.test.ts` split by subject (each has `describe` blocks to cut on). Support: `frontend/rules.ts`
(4629) by rule group (one file per frontend rule section, an index assembling `RULES`); `divergences.ts` (1779) by
concern (the fixture folders' names); `lean.data.ts` (1455) by construct family; `bound-census.ts`, `baseline.ts`,
`census.ts`, `dumps.ts`, `rustc-cache.ts`, `fixture-units.ts` by concern. Fixture data (21 files): split within their
concern folder by rule group (`string-edges.ts` → `string-edges-*.ts` …); map-neutral (§1.1).

### 2.3 Folders (step 2)

- **`server/`** keeps `server.ts` (+ `handlers/`), `bin.ts`, `config.ts`, `index.ts`, `diagnostics.ts`.
  - `server.ts` and `diagnostics.ts` each import `type Document` from `../services/shared/index.js`, a path the §2.1
    structure gate refuses. `services/index.ts` already re-exports `shared/` whole (`export * from "./shared/index.js"`),
    so both become `from "../services/index.js"`: a path change, no new export. `workspace-store.ts`'s same import
    becomes `../services/index.js` with its move (workspace 6.5 → services 5 points downward).
  - `reachability.ts` + `dead-code-equivalence.ts` (+ tests) → `analysis/reachability/`. This REVERSES
    analysis-conformance 1.4, which moved reachability to `server/` as "server suppression policy". The default taken:
    the computation (which units and members are dead) is an analysis of the program — it reads only the front-end — and
    the policy (suppress diagnostics on dead code unless `diagnoseDeadCode`) is what `server/diagnostics.ts` does with
    it, and stays there. `scripts/corpus-fp.ts` reads it through `analysis/index`.
  - `workspace-store.ts` (+ tests, `incremental-index.test.ts`) → `workspace/`. It imports `server/config.ts`
    (`NETWORK_TEXT_ENABLED`) — an upward import from `workspace` (rank 6.5) to `server` (7). Resolved by passing the flag
    in (the store's constructor takes its `ParseOptions`; `server.ts` reads `config.ts`), not by moving `config.ts`.
    The parameter is REQUIRED, with no default: `constructor(config: ResolvedConfig, parse: ParseOptions)`. A default
    (`networkText: false`) would make the 7 workspace-store tests and `incremental-index.test.ts` silently stop reading
    network text although `bunfig` sets `VOLT_GRAPHICAL=1`; each test passes its options explicitly
    (`{ networkText: NETWORK_TEXT_ENABLED }`, as the store applies today), and a missing argument is a type error.
  - `harness.ts` → `test/server/harness.ts` (a new `test/server/` folder, in the tree and test/README).
  - `diagnostic-codes.ts` → `test/support` beside the corpus (`test/corpus/support/diagnostic-codes.ts`): tests are its
    only importers. Task 2.1 keeps it in `server/`; the census overrules that (spec: "test support only under `test/`").
  - `analysis/test-uri.ts` → `test/` support (`test/support/test-uri.ts` or beside the analysis suite); the 78 colocated
    importers change their import path only.
- **`reference/` dissolved**: `pragmas.ts`'s attribute names (`attributeNames`, `isKnownAttribute`, the catalog data) →
  `frontend/syntax/pragmas/attributes.ts` (a language fact, read by `analysis/checks/pragmas` through
  `frontend/syntax/index`); `pragmaHelp` + `reference.ts` → `services/assist/builtin-hover.ts` (hover text, read only by
  services). `check-layering.ts` drops the `reference` rank and rule A1 (analysis reaches the catalog only through its
  index) becomes moot — removed, with the frontend index rule covering the new home. `src/index.ts` keeps exporting
  `lookupReference`, `renderReferenceHover`, `catalogNames`, `isKnownAttribute`, `pragmaHelp`, `attributeNames` from
  their new homes (the package surface is stable).
- **Hover coverage (2.3)**: entries for the 9 of §1.6; a test iterates every set of §1.6, the closed `__` list included
  (never `builtinName`'s `__` prefix test, which is open), and per dialect asserts both directions through the service:
  every name `builtinName(name, dialect)` accepts has hover, naming each one without; every name it refuses has none
  (step 0's `assist.test.ts` case is its seed).

### 2.4 Not done here

- NT files and functions: ceilings only (§1.1, §1.2), handed to the LD/FBD coverage change (5.2).
- `map.generated.ts`: generated; exempt by name.
- `transpile/semantics/*.cases.ts`: colocated test data by suffix (§1.4).

## 3. Review plan (step 3)

Never reviewed: `services/` (assist, formatting, navigation, structure, shared), `server/`, `workspace/`. Each area is
read against (a) its colocated tests and the LSP behaviour tests (`server/*.test.ts` over the harness,
`capability-matrix`, `navigation-golden`, `diagnostic-identity`), (b) `docs/behavior.md`'s requirements, and (c) the
recorded fixtures where a service consumes a front-end fact the recordings pin (types in hover, built-in names,
resolution in navigation). A finding has severity (wrong answer / missing answer / structure), root cause, and is fixed
test-first or filed with a reason; no LSP-only diagnostic is introduced (parity rule).

| area | files (lines) | what is checked |
|---|---|---|
| assist | hover 93, completion 161, signature-help 43, inlay-hints 39, code-lens 24, code-actions 47 | built-in hover after §2.3; completion offers only names the dialect resolves (`builtinName`, CODESYS-only words on TwinCAT); signature help for built-ins vs library FBs; inlay hints agree with inference |
| formatting | print 451 | idempotence (the printer fixed point in `test/frontend`), refused text kept verbatim, every `IMPLEMENTATION` form |
| navigation | navigation 89, references 64, type-refs 84, hierarchy 152, implementation 45 | definition/references agree with `resolve-at`; case-insensitivity; cross-file; rename refuses built-ins |
| structure | document-symbol 105, semantic-tokens 224, selection 71, folding 34, workspace-symbol 25 | every unit kind, `.dut`/`.gvl`/`.itf` symbols; token legend vs lexer kinds |
| shared | resolve-at 67, positions 74, symbol-kinds 84, locations 10, document 13 | the one cursor-to-symbol path; UTF-16 positions |
| server | server 624, diagnostics 202, config 15, bin 36 | capability↔handler parity; push vs pull exactly once; refresh after re-index; dead-code suppression |
| workspace | workspace-refs 213, source-extensions 25, workspace-store 268 (after the move) | watched-file freshness, open buffer over disk, library reference change, incremental index equivalence |

Already known going in:

- `builtinName` (`frontend/types/builtins.ts:64`) accepts ANY `__` name as a compiler built-in (`upper.startsWith("__")`
  → "system-operator"). The census reported only its narrow face: the 3 platform integers get the wrong category, which
  nothing reads. The broad one: an undefined `__` name in a STATEMENT (`x := __NOSUCHTHING;`) gets no "Identifier
  '__NOSUCHTHING' not defined", where `x := yNOSUCH;` does. Pinned today: the INITIALIZER position only
  (`cc_decl_init_dunder_unknown`, refused by the parser since frontend-conformance 2.8.3); the statement position has no
  fixture, so CODESYS's answer there is unrecorded. Corpora: 0 unknown `__` names in the six (every `__` there is
  `__SYSTEM`, a platform integer, or a listed operator: `__POUNAME` `__VARINFO` `__ISVALIDREF` `__QUERYINTERFACE`
  `__TRY`…`__ENDTRY`). Review 3.1 decides: the fix is the closed `__` list of §1.6 (the vocabulary's 17 `__` keywords +
  the platform integers + `__SYSTEM`), after a statement-position fixture is recorded on both vendors; if that is not
  cheap, it is filed "niche: accepted loss (0 occurrences in the corpora)".

## 4. Order

Measure (0) → gates red where code is missing (1) → folders (2) → review (3) → splits (4) → close (5). Folders before
the review so the review reads files in their final homes; splits after the review so a fix lands before its file is cut.

## 5. Step 1 — the gates (design)

**Target.** Every rule of the standard is a gate in `bun run lint` / `test/package` from step 1 on, green at HEAD, with
today's debt as NAMED, shrink-only entries: an entry that grows fails, one that no longer occurs (stale) fails until
removed, a new violation fails. Each later step deletes its own entries in its commit; 4.5 leaves only the NT ones.

**Choice.**
- *Files* — `check-size.ts` `SCOPE` → roots `src` + `test`; ceilings keyed package-relative; limit by kind (product and
  `test/` non-test 400, `*.test.ts` 600); `map.generated.ts` exempt by NAME. Ceilings = §1.1 (19 + 3 + 4 + 30).
- *Functions* — a second shrink-only map `FUNCTION_CEILINGS`, keyed `file#name` → lines, failing like the file one.
  Today: 25 in `src` + 6 in `test/` support (`bound-census.ts`: `boundCensus` 393, `known` 276, `storesOf` 263, `e` 118,
  `crossCheckBuildTypes` 84, `units` 82 — not in §1.2, go to 4.4). NT 3 marked "LD/FBD change". Measured what decides
  the key: `file#name` is unique for all 31 (no duplicate), so no line number in the key (lines move on every edit).
- *Dead exports* — `dead-exports.ts --gate` in lint: NOBODY over `src`, less (a) the members of any exported union
  declared in the same file (`irUnionMembers` generalised; measured: excludes 41 of the 72 — the 21 + 14 NT + 6 IR), (b)
  the transpile barrel surface + `ir/` types (`IrUnOp`, `PathSegment`). Allowlist = the remaining 29: 25 non-NT (→ 0
  by 4.5) + 4 NT (`TokKind` `CONSTRUCT_WORDS` `v1Refusal` `resolveAnywhere`).
- *Structure* — `structure.test.ts`: a `src/` file whose every importer is a test fails, unless `*.test.ts`,
  `*.cases.ts`, an `index.ts` or `bin.ts`; known 3 (`server/harness.ts`, `server/diagnostic-codes.ts`,
  `analysis/test-uri.ts`) → 0 in step 2. The `server/` import rule is rule **S1 in `check-layering.ts`** (reported by
  `layering.test.ts`): `server/` imports only `analysis/index`, `services/index`, `frontend/*/index`, `workspace/*`,
  itself. Known 3: the `../services/shared/index.js` imports of `server.ts`, `diagnostics.ts`, `workspace-store.ts`
  (§2.3) → 0 in step 2. Task 1.2 named `structure.test.ts` for both; the import half goes where imports are scanned.
- Each gate gets a planted-violation test (a scratch tree, as `layering.test.ts` does) proving it fires and names both
  the file and the rule.

**Rejected.** Function list as a warning until empty (the transpile run's way: a new long function lands unseen for
the whole change). Red tests / `test.failing` for the debt (a red full suite hides every other regression). A second
import parser in `structure.test.ts` (two scanners drift; `check-layering` already has known lists + stale checks). A
type-aware dead-export graph (TS 7 native has no JS API; textual over-counts, the safe direction). A hand list of union
members (drifts from the unions).

**Refused by name.** Adding a ceiling or allowlist entry after step 1 (only lowering/removing); exempting a folder
(only `map.generated.ts`, by name); an inline `size-ignore`/`dead-export-ignore` comment; raising a limit.

**Migration.** Step 1: the gates with today's lists, lint + `test/package` green, `scripts/README.md` and
`test/README.md` rows updated. Steps 2–4 delete entries as they land (the `lower` hint names the number). 4.5 asserts the
lists hold only NT entries; 5.2 hands those over.
