# Design: frontend-conformance

Paths are relative to `packages/volt-lsp-iec/`. Line numbers were read on 2026-09-29 while other runs were editing `src/transpile/`.
Treat them as approximate: they name the code, not a contract. Every move in this design is checked by the front-end snapshot
(**F**, task 1.3), not by line numbers.

This document describes the **target** structure and the path to it:

1. Principles
2. Target structure
3. Old → new map
4. Rule catalogue
5. Test layout
6. Review gaps and how this design closes them

---

## 1. Principles

### P1. One home per concern

Each rule, fact, table and walk is owned by exactly one module. §3.3 lists every concern that lives in more than one place today,
with its one home and the task that moves it there.

### P2. The front-end is ONE layer: `syntax → symbols → types`, with `library` as a leaf beside it

The front-end has four sub-layers:

```
            library   (imports nothing; a leaf)
            ↑      ↑
syntax  ←  symbols  ←  types
(nothing)  (syntax,    (syntax, symbols, library)
            library)
```

- `syntax` imports nothing outside `syntax/`. In particular it never imports `library/`.
- `symbols` imports `syntax/index` and `library/index`.
- `types` imports `syntax/index`, `symbols/index` and `library/index`. No production file in `types/` needs `library/` today; the
  edge is allowed so that a `types/` test (e.g. `types/resolve.test.ts`, formerly `ambiguous-name.test.ts`) can build a
  `LibraryManifest` without a re-export shim in `symbols/`.
- `frontend/library/` holds the Volt library-materialization format: the `.library` manifest, the `Library Manager/<folder>` path
  layout and the MATERIALIZATION ledger. It depends on nothing. `symbols` needs it (namespaces, precedence), and so do the server,
  `workspace-refs`, `transpile/lower/lower.ts` and the top-level `libraries/index.ts`.
- Each sub-layer has a curated `index.ts` with named exports, not `export *`, so the export list IS the public API (§2 "Index
  contents"). `frontend/index.ts` re-exports the three language sub-layers for `src/index.ts` (the package API); `library/` is
  reached through `frontend/library/index.js`.

### P3. Nothing in the front-end imports a consumer

The consumers are `analysis`, `services`, `server`, `network`, `network-text`, `reference`, `transpile`, `workspace-refs` and the
scripts. The front-end imports none of them, and that includes the front-end's own `*.test.ts` files. Today there are five
violations:

- `types/infer.ts → reference` (`lookupReference(name)?.returnType`, infer.ts:560)
- `syntax/implementation-keyword.test.ts → network-text`
- `types/conversion-name.test.ts → analysis`
- `syntax/token-at.test.ts`: not a violation today, but it becomes one the moment `token-at.ts` moves to `services/` (1.10), so the
  test moves with it
- `syntax/units/namespace.test.ts → symbols` (upward inside the front-end)

The first is removed by task 1.6 (below, and §6 G19). The test edges are relocated by tasks 1.5 and 1.10.

**1.6 in full.** `infer.ts` asks `lookupReference` for ANY catalog entry's `returnType`. Those are of two kinds:
- **fixed** return types written in `reference.ts` (`__POSITION`→STRING, `__COMPARE_AND_SWAP`→BOOL, `__XADD`→DINT,
  `TEST_AND_SET`→DWORD, and every other entry with a literal `returnType`): they move, as data, into `types/builtins.ts`
  (`BUILTIN_RESULT`), and `reference.ts` reads its hover text's return type from there;
- **derived** return types: `conversionEntry` computes `returnType: dst.name` from `parseConversionName`. `infer` stops asking
  reference for these and calls `types/conversion-name.parseConversionName` itself — the answer is the same function.

Acceptance of 1.6: `grep lookupReference src/frontend` is empty; `ALLOWED_UPWARD` is empty; hover output is unchanged (F, services
tests). `types/arith.ts` `exptResultType` moves into `types/builtins.ts` in the same task (it is the EXPT rule); its one consumer
outside types, `transpile/lower/builtins.ts:12,225`, keeps importing it by name through `types/index.js`, so no transpile file
changes.

### P4. Consumers import the front-end only through an index

A consumer may import `frontend/<layer>/index.js` or `frontend/index.js`, and no other front-end file. The census of 2026-09-29:

- production deep imports (4): `analysis/.../obsolete-usage.ts` and `analysis/.../empty-block.ts` → `syntax/span.js`;
  `analysis/.../reference-assign.ts` → `types/elementary.js`; `types/resolve.ts` → `symbols/precedence.js` (inside the front-end,
  but it bypasses the layer index);
- test deep imports inside `src/` (2): `server/server.test.ts` → `symbols/library-namespace.js`;
  `test/conformance/suite.test.ts` → `syntax/expression.js`;
- test and script deep imports under `test/` and `scripts/` (16 statements): `types/elementary.js` ×7, `symbols/symbol.js` ×3,
  `symbols/precedence.js` ×2 (`test/corpus/corpus.test.ts` and `scripts/probe-ambiguous-uses.ts`, both using `libraryRank`),
  `symbols/library-namespace.js`, `types/compat.js`, `types/type.js`, `syntax/expression.js`.

All are fixed by task 1.4, which also adds the names they need to the indexes (`libraryRank` included; §6 G5). Tests colocated
inside a sub-layer may import their own sub-layer's files. Everything else goes through an index.

### P5. The front-end reads no environment and knows no presentation

- `process.env.VOLT_GRAPHICAL` (`NETWORK_TEXT_ENABLED`) becomes a parse option. The server reads the environment and passes the option
  in; the test preload passes it through the test support (task 1.11).
- The following leave the front-end because their consumers are services or server: `Document`, the offset queries
  (`tokenAtOffset`, `exprAtOffset`, `memberAtOffset`) and the rename/reference helper `type-refs.ts`.

### P6. Consumers never re-decide what the front-end owns

"Re-decide" means a consumer computes, by its own code, something the front-end also answers: a type, a conversion class, a
resolution, a literal's type, a constant, or an EXTENDS chain. The table below lists every such site found. Each one moves to its
front-end home in one of three ways:

- **(R)** in the restructure, when the outputs are provably identical (snapshot F unchanged);
- **(C)** in a conformance task, when switching changes an answer (the recording decides which answer is right);
- **(T)** by hand-off to `transpile-restructure`, which owns `src/transpile/` call sites (its §6 lists items 1–15). This change
  creates the front-end home; that change deletes the transpiler's copy. The full T list is task 5.3.

| Consumer site | What it re-decides | Front-end home | How / task |
|---|---|---|---|
| `analysis/checks/types/narrowing.ts` `operandSignWarnings`, `meetOperandWarnings`, `isIntLiteral` | per-operator operand conversion class (arithmetic meets signed; bitwise meets unsigned; comparison only at 32/64 bits, with a TwinCAT branch); NOT signed→unsigned | `types/arith/operators.ts` `operandConversion(op, a, b, dialect)`; `types/literal.ts` `isNegatedIntLiteral` | R 1.34 |
| `analysis/rules.ts` `binaryOpError` (the typing part) | a BOOL operand is arithmetic; MOD is integer-only; a string operand targets ANY_NUM | `types/arith/operators.ts` `operandFamilyRule` | R 1.34 |
| `analysis/checks/types/unary-operand.ts` `MINUS_REPORTS`, `NOT_REPORTS`, `ANY_BIT_FAMILIES` | the families a unary operator accepts | `types/arith/operators.ts` `UNARY_ACCEPTS` | R 1.34 |
| `network-text/parser.ts:1339-1343` `BIT_STRINGS`, `COMPARISONS`, `BIT_OPERATORS` (used to type wires, :502/:507) | the ANY_BIT family (with BOOL); comparison result BOOL; bitwise result = the operand bit-string type; the function-form operator names | `types/elementary.ts` `inTypeGroup("ANY_BIT", …)`; `types/arith/operators.ts` `OPERATOR_FUNCTIONS` (GT/GE/LT/LE/EQ/NE, AND/OR/XOR/NOT … with their result rule) | R 1.34 where identical; otherwise C 4.4 (CB4, AR7). `network-text` is a non-goal for conformance, but its copy of the RULE is not: it imports the rule |
| `analysis/checks/types/pointer-conversion.ts` `pointerSized` | pointer↔integer compatibility, 64-bit target | `types/compat.ts` + `types/platform.ts` `POINTER_BITS` | R 1.38 |
| `analysis/checks/types/reference-assign.ts` (a literal's own exact type) | literal typing | `types/literal.ts` `literalOwnType` | R 1.32 |
| `analysis/checks/calls/call-arguments.ts` `argumentType` | literal typing for VAR_IN_OUT | `types/literal.ts` `literalOwnType` | R 1.32 |
| `analysis/checks/types/constant-overflow.ts` `overflowType` | a literal's capacity type | `types/literal.ts` `literalCapacityType` | R 1.32 |
| `analysis/checks/types/subrange.ts` | subrange bounds folded from the TypeExpr (the Type model drops subranges) | `types/type.ts` subrange variant | C 4.7.1 |
| `analysis/checks/types/array-bounds.ts`, `array-init.ts:54`, `analysis/messages.ts` `compilerArrayText` | array bounds re-folded with `constEval` | read `ArrayTypeInfo.bounds` | R 1.39 |
| `analysis/messages.ts` `compilerTypeName`, `compilerArrayText`, `compilerSubrangeText` (type text only) | a second ARRAY/enum rendering | `types/render.ts` `renderType(t, { form: "compiler" })` | R 1.39 |
| `analysis/resolution.ts:101-107`, `:229`; `analysis/checks/names/refused-name.ts:114` | the CODESYS-only type gate on TwinCAT (three copies next to `resolve.ts`) | `types/resolve.ts` `isDialectType(name, dialect)` | R 1.38 |
| `analysis/resolution.ts` `nameResolves` (:101-115) | the WHOLE bare-name search order: scope lookup, then the reference catalog (`lookupReference`), library-namespace roots, device-tree instances (`references.deviceInstances`), implicit references — CODESYS's documented order (`docs/codesys-reference/09-shadowing.md`) | `types/names.ts` `resolveBareName(scope, name, ctx)` returning a tagged answer (`symbol` / `builtin` / `library-namespace` / `device` / `none`); the built-in NAME set from `types/builtins.ts`; device instances bound by the binder (§2) | C 3.1.5 (Y23, Y24) — moving it changes what is searched in which order |
| `analysis/checks/names/unresolved-identifier.ts` `CONDITIONAL_PRAGMA_RE` | whether a body contains conditional compilation | `syntax/pragmas/conditional.ts` `hasConditionalPragmas` | R 1.23 |
| `analysis/checks/pragmas/pragmas.ts` `{IF}`/`{END_IF}` balance stack | conditional-pragma structure | `syntax/pragmas/conditional.ts` `scanConditionals` | R 1.23 if identical, else C 2.7.1 |
| attribute parsing, **7 sites**: (1) `syntax/unit-attributes.ts` (the home-to-be), (2) `symbols/binder.ts:58` `hasQualifiedOnly` (re-lexes the whole file, default dialect), (3) `analysis/checks/declarations/attribute-placement.ts`, (4) `analysis/checks/pragmas/pragmas.ts`, (5) `services/assist/hover.ts`, (6) `services/assist/completion.ts`, (7) `workspace-refs.ts` (the `obsolete` regex) | attribute parsing | `syntax/pragmas/attributes.ts` | R 1.23 for every site where identical (1.23 names all seven); the per-unit `qualified_only` is C 2.7.2 |
| `analysis/checks/names/refused-name.ts` (re-lexed cascade), `analysis/resync.ts`, `analysis/lost-declaration.ts` (NON_RETAIN, AT operand), `checks/types/unsupported-operator.ts` (`&`, `**`), `time-literal-unit.ts`, `wstring-escape.ts`, `at-address.ts`, `partial-access.ts`, `calls/call-result-access.ts` | grammar refusals and the vendor's cascade after them | `syntax/lex/lexer.ts`, `syntax/parse/*`, `syntax/parse/errors.ts` | C 2.1.3, 2.2.3, 2.2.5, 2.3.2, 2.3.3, 2.5.3, 2.5.4, 2.5.5, 2.8.3 (moving them changes where a diagnostic is produced, and its ordering and code) |
| `analysis/checks/oop/method-signature.ts:44`, `interface-implementation.ts:71`, `services/navigation/hierarchy.ts:37-60`, `analysis/checks/oop/inheritance.ts` | EXTENDS base resolved by NAME (`findScopeByName`), not via `baseScope` | `symbols/extends.ts` `extendsChain` / `baseOf` | C 3.2.2 (under library ambiguity the base can differ) |
| `analysis/checks/oop/inherited-variable.ts:34`, `network/network-analysis.ts` `pinSet:230`, `services/assist/completion.ts:81-93` | hand-written `baseScope`/parent walks | `symbols/scope-nav.ts` `lookupMember`, `visibleNames` | R 1.28 |
| `analysis/checks/flow/this-super-context.ts:22`, `types/infer.ts` `enclosingPou`, `types/const-eval.ts` `rootOf` | hand-written parent walks | `symbols/scope-nav.ts` `enclosingPou`, `rootOf` | R 1.28 |
| `analysis/checks/flow/this-super-context.ts:32,42-44` (`name === "THIS"` / `"SUPER"`, `toUpperCase() !== "SUPER"`) | what a self reference is | `syntax/identifier.ts` `isSelfRef` / `selfRefKind` | R 1.15 |
| `network/network-analyze.ts:111` `isPou` (its own set of POU scope kinds) | which scope kinds are POUs | `symbols/model.ts` `POU_SCOPE_KINDS` / `isPouScope` | R 1.27 |
| `services/shared/resolve-at.ts:84-100` | walks `project.symbols`/`children`/`defUri` internals | `symbols/scope-nav.ts` `symbolDefinedAt` | R 1.28 |
| `services/structure/document-symbol.ts:103` | GVL name from the URI | `symbols/binder.ts` `gvlName` | R 1.27 |
| `server/workspace-store.ts:135` | `includes("library manager/")` | `library/path.ts` `isLibraryUri` | R 1.25 |
| `server/diagnostics.ts` `unstatedBodies`, `analysis/body-context.ts` | re-list getter/setter bodies | `syntax/format/bodies.ts` `unitBodies` | R 1.29 |
| `analysis/reachability.ts` (×3), `network/network-services.ts:69`, `server/diagnostics.ts:133`, `services/structure/semantic-tokens.ts:181`, `services/formatting/print.ts:139`, `syntax/parser.ts` `claimedKeywordLines` | namespace flattening | `syntax/ast/walk.ts` `allUnits` | R 1.8 |
| `symbols/bodies.ts`, `syntax/bodies.ts` (no namespace recursion) | which units are analysed | `allUnits` inside `scopedBodies` | C 3.1.2 (namespaced units start being checked) |
| `network/network-analyze.ts:41-54` | hand-built Scope literal + `defineSymbol` | `symbols` build API `localScope` | R 1.27 |
| re-lexers, **same dialect as the parse**: `analysis/diagnostics.ts`, `refused-name.ts` | lexing a second time | `ParseResult.tokens` (lexed once, with the parse's dialect) | R 1.14 |
| re-lexers, **default CODESYS dialect**: `services/assist/hover.ts`, `services/structure/semantic-tokens.ts`, `analysis/reachability.ts`, `symbols/binder.ts` (`hasQualifiedOnly`), `syntax/unit-attributes.ts`, `syntax/token-at.ts` (→ `services/shared/positions.ts`), `network/network-analyze.ts:116` (`lex(head)` for the instance type), `network-text/parser.ts:1175` (`lex(this.text.slice(…))` for ST fragments) | lexing with a possibly wrong dialect | `ParseResult.tokens`, or `lex(text, dialect)` with the project's dialect passed in (the network-text parser gets the dialect with its parse options, 1.11) | C 2.1.4 (a TwinCAT project changes answers) |
| `analysis`, `services`, `symbols/bodies.ts`, `network-text` → `parseStatements`; `transpile` → `parseActive` | two statement trees for one body | `syntax/parse/body-parse.ts` `bodyStatements` (conditional pragmas applied) | C 2.7.1 |
| `transpile/lower/*` (13 EXTENDS sites) | EXTENDS chains | `symbols/extends.ts` `extendsChain` | T (transpile-restructure 1.1.2/1.7.3) |
| `transpile/lower/places.ts:33,64,80` | GVL-qualified resolution | `symbols/scope-nav.ts` `resolveGvlMember` | T |
| `transpile/lower/calls.ts:976,1627`, `constants.ts:103` | `ns.symbols.get` library namespace lookup (a lookup, not a flattening — §6 G18) | `symbols/scope-nav.ts` `findChildScope` + `lookupLocal` | T |
| `transpile/lower/expressions.ts:180-184` (NOT result), `:248-251` (duration × integer); `builtins.ts:456-460` (LIMIT/SEL/MUX), `UNARY_MATH`, `:153-155` (platform conversion rewrite) | typing rules | `types/arith/*`, `types/builtins.ts`, `types/conversion-name.ts` | C 4.3.x / 4.1.2, then T |
| `transpile/lower/constants.ts` `foldConstant`, `foldsToConstant`, `convertedConstant`, `enumStorage`, `enumDefault`, `defaultOfValues`, `inlineEnumDefault`, `contextLiteralType`, `calendarNanoseconds` | fold set, enum facts, literal typing, literal decoding | `types/const/*`, `types/enums.ts`, `types/literal.ts`, `syntax/literal/calendar.ts` | R 1.22 (calendar), R 1.37 (numbering/default), C 4.6.1 (fold set), C 4.7.3 (enum storage), T (call sites) |
| `transpile/lower/convert.ts` `stored`, `integerFoldType`; `transpile/ir/values.ts` `fit` | wrap to width; fold width | `types/width.ts` `wrapToWidth` | T |
| `transpile/lower/storage.ts` `withStringCapacity` | the default STRING capacity | `types/defaults.ts` (the transpiler applies it at `lowering.resolve`, as transpile-restructure §3.2 decides) | T |
| `transpile/lower/lowering.ts` `canonicalElem` call; every other `canonicalElem`/`temporalResultType` caller | platform-alias canonicalization with no target | `types/platform.ts` `canonicalElem(name, target)` | C 4.1.1 (front-end callers), T (lowering) |
| `transpile/lower/bytes.ts` | type size and alignment | stays in `transpile/`: layout is a back-end fact. `types/platform.ts` owns only the target's widths | — |
| `transpile/interp` `sameName` | ST identifier equality | `syntax/identifier.ts` `sameName` | R 1.15 (compat's copy); T (interp) |

### P7. Grammar refusals belong to the parser, unless moving one changes a recorded message

The parser accepts a superset of the language, and `analysis` claws the difference back (the refusals listed under P6). The target is
that the parser refuses each of them with the vendor's cascade. Every such move is a conformance task (C), because a recording
decides the message, its location and its ordering.

### P8. The Volt workspace format is not CODESYS grammar, and it has its own home

Three things are the Volt file format, not the language:

- the `IMPLEMENTATION <LANG>` line, `%FOLDER` and the retired `(* @volt-… *)` comments → `syntax/format/`;
- the library manifest and path layout → `library/`;
- the network-text header markers → `syntax/format/network-header.ts`, which `network-text/parser.ts` imports instead of keeping its own
  copy.

These are tested by unit tests, not by CODESYS fixtures (catalogue §4 2.10, FMT1–FMT8).

### P9. Output-neutral restructure, measured against the parent commit

Every phase-1 task leaves the following unchanged:

- snapshot **F** (task 1.3), which has two halves:
  - **F-front**: the parse tree, parse errors, `failedDeclarations`, the token stream, the resolution dump, type dump and fold dump for
    every corpus file, fixture source and library body; the LSP diagnostics over the six corpora;
  - **F-back**: the emitted Rust and interpreter outputs of every conformance fixture;
- `bun scripts/suite-snapshot.ts --compare`;
- the full suite.

**F is compared against the task's PARENT commit, not against a stored baseline.** Other runs commit to `src/transpile/` while this
change runs (`transpile-fix-all` today). A stored F-back would change on their commits and make every "F unchanged" check lie.
`scripts/frontend-snapshot.ts check` therefore writes the snapshot of `HEAD~1` (or `--base <rev>`) in a temporary git worktree, cached
under `test/frontend/.snapshot/<commit>/`, writes the snapshot of the working tree, and compares the two. A transpile commit that
lands between two phase-1 tasks is inside both sides of the next comparison, so it never reads as a front-end change. A task that
spans several commits passes `--base <the commit before the task>`.

A split that would change F is not done in phase 1. It is filed as the conformance task this design names.

### P10. Coordination with the runs that edit `src/transpile/`

Phase 1 touches `src/transpile/` only for import paths and for the functions a task names (1.12 codemod; 1.22 `calendarNanoseconds`;
1.25 and 1.30 `lower.ts` imports; 1.37 enum numbering/default). Each of those tasks carries **Gate T**:

- at its start, `git status --porcelain -- packages/volt-lsp-iec/src/transpile` is empty (no other run is mid-edit), and no other
  workflow run is executing against `src/transpile/` (the executor is the only agent running; a `transpile-fix-all` run in flight
  means wait, not merge);
- its transpile edits are exactly the named ones, in the task's own commit;
- the path codemod is a committed, re-runnable script (`scripts/codemod-frontend-paths.ts`), so a transpile commit that lands after
  1.12 with an old path is fixed by re-running it, not by hand.

`transpile-restructure` itself starts only after this change is archived (its task 0.0), so the only concurrent writer is
`transpile-fix-all` and the review fixes it commits.

### Where the tree lives: `src/frontend/` — decided by the import graph

The decision is to move `syntax/`, `symbols/` and `types/` under `src/frontend/`, and to add `src/frontend/library/`. The import graph
decides it:

1. **The front-end is a closed DAG.** `syntax` imports nothing outside itself. `symbols` imports only `syntax`. `types` imports only
   `syntax` and `symbols`, plus the one `types → reference` edge, which task 1.6 removes. No production file in the front-end imports
   `network-text`, `analysis`, `services`, `server`, `network` or `transpile`.
2. **Its rank is contiguous once `network-text` is re-ranked.** `network-text` (rank 0.5) sits between `syntax` and `symbols` today,
   but nothing in `symbols` or `types` imports it. It imports only `syntax`. Ranked at 2.5, above `types`, it becomes an ordinary
   consumer, and the front-end is ranks 0–2 with nothing interleaved.
3. **One folder makes the rule one line.** "Nothing under `frontend/` imports outside `frontend/`", and "nothing outside imports
   `frontend/<layer>/<file>` except `index.js`". The per-layer ranks remain inside `frontend/`.
4. **The cost is mechanical and one-off.** About 254 consumer files and 38 test/script files change their import path prefix. That is
   a codemod (task 1.12), checked by `tsc` and F.

`transpile-restructure` §6 already reads "that concern's home in the front-end structure frontend-conformance's archived design
defines". Its `types/…`, `symbols/…` and `syntax/…` paths therefore resolve to `frontend/types/…` and so on. The file names below keep
that change's names: `types/predicates.ts`, `types/width.ts`, `types/enums.ts`, `types/defaults.ts`, `types/literal.ts`,
`types/arrays.ts`, `types/conversion-name.ts`, `types/const/{fold,constancy}.ts`, `types/arith/{runtime,checked,temporal}.ts`,
`types/infer/{expr,member,callee}.ts`, `syntax/identifier.ts`, and `symbols/scope-nav.ts` `extendsChain`.

---

## 2. Target structure

```
src/frontend/
  index.ts                     package-facing re-export of syntax, symbols, types (named)
  library/                     Volt library materialization format — imports nothing
    index.ts
    path.ts                    isLibraryUri, libraryOf, isLibrarySymbol's path half ("Library Manager/<folder>", %20)
    manifest.ts                parseLibraryManifest, LibraryManifest (LIBRARY/NAMESPACE/DEPENDENCIES/RESOLUTION lines), libraryResolution
    materialization.ts         MATERIALIZATION*, stale/newer/mismatch classification (C# parity contract)
  syntax/                      imports nothing outside syntax/ (never library/)
    index.ts                   curated named exports (see "Index contents")
    span.ts                    Span, spanFromOffsets, spanContains, joinSpans, eofSpan, zeroSpan
    identifier.ts              sameName (ST identifier equality), isSelfRef, selfRefKind (THIS/SUPER)
    lex/
      tokens.ts                TokenKind, Token, isTrivia (the token MODEL)
      vocabulary.ts            KEYWORDS (const array; Keyword derived), named subsets: VAR_SECTION_KEYWORDS,
                               UNIT_STARTERS, DECL_LIST_ENDERS, SOFT_NAME_KEYWORDS, MEMBER_MODIFIERS, FB_MODIFIERS,
                               PROPERTY_MODIFIERS, INTERFACE_MEMBER_MODIFIERS, OPERATOR_KEYWORDS; Dialect,
                               CODESYS_ONLY_KEYWORDS, literal-prefix tables (TIME/DATE/TOD/DT/TYPED, CODESYS-only),
                               MULTI_CHAR_PUNCT, SINGLE_CHAR_PUNCT (the punctuation vocabulary the lexer matches)
      lexer.ts                 lex(source, dialect) — tokens with trivia; literal prefix carried on the token
    ast/
      nodes.ts                 every AST node type, ParseError, ParseResult (+ tokens), no Document
      walk.ts                  exprChildren, walkExpr, stmtExprs, stmtChildLists, walkStatements, walkAllExprs,
                               allUnits (the one namespace flattener), walkInitializer (declarations + aggregates)
      declarations.ts          varInputParams and other declaration queries over the AST
    parse/
      parser.ts                parseSource, parse, top-level dispatch (from UNIT_STARTERS), file-scope post-passes
      cursor.ts                Cursor: trivia skip, eat/expect, error collection, failedDeclarations, recovery
      errors.ts                every token describer, nameExpected, reportBrokenDeclaration, the vendor cascades
      scan.ts                  one balanced-token scanner (init tokens, dims, paren inner, top-level '..')
      names.ts                 identFromToken, readQualifiedName, readNameList, readModifiers
      body.ts                  collectBodyUntil(Any), accessor body collection
      body-parse.ts            BodyParse cache; bodyStatements (and, until 2.7.1, parseActive) — one cache
      expression.ts            Pratt parser, BINARY_PRECEDENCE, literal node construction, parseExprFromTokens
      initializer.ts           collectInitTokens, initializerFromTokens, parseAggregate (+ element/value)
      statements.ts            parseStatements, CASE-arm lookahead, statement ';' cascade
      type-expr.ts             parseTypeExpression, parseTypeExprFromTokens, subrange vs FB_Init args
      declarations.ts          VAR sections, parseVarDecl, collectVarSections, parseStructField (unified in 2.3.5)
      units/
        header.ts              parseOptionalReturnType, EXTENDS/IMPLEMENTS lists (via names.ts)
        program.ts function.ts function-block.ts method.ts property.ts action.ts interface.ts
        type-decl.ts global-var-list.ts namespace.ts
    literal/
      value.ts                 parseLiteralValue (ints, reals, bool, typed), DURATION_UNITS_NS, parseDuration
      string.ts                decodeStringLiteral, the CP1252 table, escape rules
      calendar.ts              calendarNanoseconds (DATE/TOD/DT valuation; from transpile)
    pragmas/
      conditional.ts           {define}/{undefine}/{IF}/{ELSIF}/{ELSE}/{END_IF}: scanConditionals, applyConditionals,
                               hasConditionalPragmas, the {IF} expression grammar (defined/hasattribute/hastype/…)
      attributes.ts            {attribute …}: unitAttributes, memberAttributes, declarationAttributes, fileHasAttribute
    format/                    the Volt workspace file format (not CODESYS grammar)
      implementation-line.ts   IMPLEMENTATION <LANG> grammar, body splitter, bodyReader, BodySpan construction
      folder.ts                %FOLDER: folderOn, peelFolder, readFolderLine, closesDeclaration, reportMisplacedFolder
      retired-comments.ts      the (* @volt-… *) reports
      reserved-names.ts        reportReservedNames (the IMPLEMENTATION reserved-name rule)
      network-header.ts        FIELDED_HEADER, END_NETWORK, opensNetwork — imported by network-text/parser.ts
      bodies.ts                unitBodies, isStBody, isGraphicalBody, graphicalMarkerLanguage, graphicalBodies
    print.ts                   renderTypeExpr, dimText, exprText (the declared form)
  symbols/                     imports: syntax/index, library/index
    index.ts                   curated read API + `build` namespace (see "Index contents")
    model.ts                   Symbol, Scope, SymbolKind, ScopeKind, POU_SCOPE_KINDS/isPouScope (no cache fields)
    scope.ts                   makeScope, defineSymbol, lookupLocal, createProjectScope, dialect/dialectOf
    cache.ts                   the lazy indices (child, span, lib-visible), generation, invalidate(scope), memoByProject
    binder.ts                  AST → scope tree, one ingest per unit kind; gvlName; device-descriptor ingest (3.1.5)
    incremental.ts             bindFile, unbindFile, canonicalize, relink (canonicalize + linkExtends, never apart)
    extends.ts                 linkExtends, extendsChain(scope) base-first + cycle guard, baseOf
    precedence.ts              pickForAsker, scopeUri, libraryRank, the rank table (the only copy)
    scope-nav.ts               lookup, lookupMember, childScopesByName, findChildScope, findScopeByName, scopeForUnit,
                               resolveGvlMember, resolveBareEnumMember, hasUnresolvedBase, enclosingPou, rootOf,
                               visibleNames, symbolDefinedAt, resolveQualifiedConst
    library-namespaces.ts      bindLibraryNamespaces, visibleFolders, manifestsByTitle
    scoped-bodies.ts           bodies, forEachExpr, forEachDecl, bodiesAt (from symbols/bodies.ts)
  types/                       imports: syntax/index, symbols/index, library/index
    index.ts                   curated named exports (see "Index contents")
    type.ts                    the Type union, constructors (elementaryTypeRef, elementaryRef), elemOf
    elementary.ts              ELEMENTARY_TYPES facts table, elementaryType (lookup), ELEM_ALIASES, ANY_FAMILIES/inTypeGroup,
                               CODESYS_ONLY_TYPES, elementaryDisplayName (private after 1.40)
    platform.ts                Target, PLATFORM_ALIASES, POINTER_BITS, canonicalElem(name, target?) — the one target assumption
    predicates.ts              isIntegerType, isNumericType, numericRank (private after 1.40), isTemporal, isDatetime, isDuration,
                               isIsolated, isKnownPrimitive, isBit, isBoolValued, isReal/floatBits, stringKind
    width.ts                   integerOfWidth, wrapToWidth, widthOf
    defaults.ts                DEFAULT_STRING_LENGTH (+ typeZero/typeDefault when transpile-restructure asks)
    arrays.ts                  peelArray, elementOf, bounds of ArrayTypeInfo
    conversion-name.ts         parseConversionName
    literal.ts                 integerLiteralType, REAL_LITERAL_TYPE, ANY_INT_RANGE, REAL_MAX_MAGNITUDE, literalType,
                               literalCheckType, literalErrorType, typedLiteralSum, literalOwnType,
                               literalCapacityType, isNegatedIntLiteral
    resolve.ts                 resolveTypeExpr, resolveNamedType, isDialectType
    names.ts                   resolveBareName — the CODESYS bare-name search order (3.1.5; created empty of behaviour change)
    enums.ts                   enum base rule, member numbering, default value
    compat.ts                  classifyConversion, isAssignable, isSameType, pointer↔integer rule
    arith/
      runtime.ts               commonType, promoteForRuntime
      checked.ts               checkedMeetType, checkedNegationType
      temporal.ts              temporalResultType, durationFor
      operators.ts             UNARY_ACCEPTS, operandConversion, operandFamilyRule, OPERATOR_FUNCTIONS, bitwise result rule,
                               NOT result
    builtins.ts                BUILTIN_RESULT (every fixed return type, from reference.ts), exptResultType (from arith),
                               the ten math functions, MIN/MAX, __XADD, __POSITION, the built-in NAME set
    const/
      fold.ts                  constEval, fold, initialValue (wraps via width.wrapToWidth)
      constancy.ts             constancyOf, compileTimeConstant
    infer/
      expr.ts                  inferExprType, binaryResultType, callReturnType
      member.ts                resolveMemberChain, memberScopeOf, staticScopeType, thisType, isEnumValueRef, enumValueType
      callee.ts                resolveCallee, calleeInfo, fbChainSections (on symbols extendsChain)
    render.ts                  renderType(t, { form: "display" | "compiler" })
```

### Import rules within the front-end (enforced by the gate, task 1.2)

| Sub-layer / folder | May import |
|---|---|
| `library/` | nothing |
| `syntax/lex` | `syntax/span.ts`, itself |
| `syntax/ast` | `lex`, `span`, itself |
| `syntax/literal` | `ast`, `lex/vocabulary` |
| `syntax/format`, `syntax/pragmas` | `lex`, `ast`, `span` |
| `syntax/parse` | everything in `syntax` except `print.ts` |
| `symbols/` | `syntax/index`, `library/index` |
| `types/` | `syntax/index`, `symbols/index`, `library/index`, `types/*` |

`syntax/` never imports `library/`. No file imports a consumer.

### Index contents (the public API of each sub-layer)

Rule: **an index exports exactly the names imported from outside its sub-layer**, measured by a census when task 1.4 runs (written
under 1.4 in tasks.md), plus the names this design adds. A name no outside file imports is not on the index; 1.40 makes it
file-private when no other file of its sub-layer uses it (`scripts/dead-exports.ts` decides). Named here because the review asked
(§6 G6, G7) and because they are the easiest to forget:

- `syntax/index.ts` — the format surface consumers use: `IMPLEMENTATION_KEYWORD`, `isRetiredComment` (server/diagnostics),
  `isNeverShown` (network-services), `implementationWords` (semantic-tokens), `statedLine`, `bodyReader`, `splitImplementation`
  (formatting/print), `FIELDED_HEADER`/`END_NETWORK`/`opensNetwork` (network-text); `BINARY_PRECEDENCE`; `lex`, `Token`,
  `TokenKind`, `Dialect`; the AST node types; `parseSource`, `parseStatements`/`bodyStatements`, `parseExprFromTokens`; the walks;
  `sameName`, `isSelfRef`; `renderTypeExpr`. NOT on it (no outside user in the 2026-09-29 census, private candidates for 1.40):
  `parseTopLevel`, `parseExpression`, `parseAssignable`, `atVarSection`, `parseVarSection`, `collectInitTokens`,
  `bodySpanFromTokens`, `codeBody`, `opensKeywordLine`, `statementOf`, `unsupportedLine`, `UNSUPPORTED_WORD`, `folderOn`,
  `MULTI_CHAR_PUNCT`, `SINGLE_CHAR_PUNCT`.
- `symbols/index.ts` — read API: `lookup`, `lookupLocal`, `lookupMember`, `findChildScope`, `findScopeByName`, `scopeForUnit`,
  `childScopesByName`, `resolveGvlMember`, `resolveBareEnumMember`, `hasUnresolvedBase`, `enclosingPou`, `rootOf`, `visibleNames`,
  `symbolDefinedAt`, `extendsChain`, `baseOf`, `isLibrarySymbol`, `pickForAsker`, `scopeUri`, `libraryRank`, `dialect`,
  `dialectOf`, `memoByProject` (analysis `ambiguous-global.ts`, `data-recursion.ts`), `bodies`, `forEachExpr`, `forEachDecl`,
  `bodiesAt` (26 + 13 + 2 analysis/services files), `gvlName`, `isPouScope`, the model types. `build` namespace:
  `buildSymbolTable`, `bindFile`, `unbindFile`, `relink`, `localScope`.
- `types/index.ts` — every name consumers import today (the transpiler's `canonicalElem`, `isDuration`, `elementaryRef`,
  `exptResultType` … included), from their new files. Because the index is the only path, moving a name between types files
  (1.31–1.39) changes no consumer file.
- `library/index.ts` — `isLibraryUri`, `libraryOf`, `parseLibraryManifest`, `LibraryManifest`, `libraryResolution`,
  `MATERIALIZATION*` and the classification.
- `frontend/index.ts` — the union of the three language indexes, for `src/index.ts` only.

### Why no member resolution in `symbols`

The maps suggest moving `resolveMemberChain` into `symbols/`. It cannot move: resolving `a.b.c` needs the TYPE of `a` to find the next
scope, and `symbols` sits below `types`. It stays in `types/infer/member.ts`, split out of `infer.ts`. Only its purely scope-based parts
move to `symbols/scope-nav.ts`: `enclosingPou`, `rootOf`, and the name-resolution half of `const-eval`'s `qualifiedConstRef`/`constRef`.
The same argument puts the bare-name search order in `types/names.ts`, not in `symbols/`: one of its steps asks whether a name is a
built-in (an elementary type, a conversion, an operator), which are type facts.

### The platform target (why `canonicalElem` takes one)

`canonicalElem` folds `__XINT→LINT`, `__UXINT→ULINT`, `__XWORD→LWORD` through `PLATFORM_ALIASES` with no dialect or target: it assumes
a 64-bit target. Phase 1 moves it to `types/platform.ts` unchanged (the optional `target` defaults to today's 64-bit answer, and F
proves no answer moved). Task 4.1.1 then makes the target a fact: `Target = { pointerBits: 32 | 64 }`, derived from the project
(dialect + device, as recorded), stored on the project scope next to `dialect`, and REQUIRED by `canonicalElem`, `POINTER_BITS`
readers, `temporalResultType`, `compat`'s pointer↔integer rule and `infer`. The default parameter is deleted in 4.1.1, so every
caller is found by `tsc`, not by grep; the transpiler's `lowering.ts` call is a T hand-off (5.3).

### Consumer-side homes created by this change (outside `frontend/`)

| New file | From |
|---|---|
| `services/shared/document.ts` | `syntax/ast.ts` `Document` |
| `services/shared/positions.ts` (added to) | `syntax/token-at.ts` `tokenAtOffset`; `syntax/ast-walk.ts` `exprAtOffset`, `memberAtOffset` |
| `services/shared/positions.test.ts` | `syntax/token-at.test.ts` |
| `services/navigation/type-refs.ts` | `syntax/type-refs.ts` (minus `flatUnits`, which becomes `allUnits`) |
| `server/config.ts` (or the existing workspace-store options) | the `VOLT_GRAPHICAL` read |

---

## 3. Old → new map

### 3.1 Files

| Current file | New home(s) | Task |
|---|---|---|
| `syntax/span.ts` | `frontend/syntax/span.ts`; gains `joinSpans` (from `util.ts`), `eofSpan`, `zeroSpan` | 1.13 |
| `syntax/tokens.ts` | `lex/tokens.ts` (TokenKind, Token, isTrivia), `lex/vocabulary.ts` (keywords, subsets, dialect, prefixes, `MULTI_CHAR_PUNCT`, `SINGLE_CHAR_PUNCT`); the orphan JSDoc is deleted | 1.14 |
| `syntax/lexer.ts` | `lex/lexer.ts`; prefix sets move to `vocabulary.ts`; the EOF span comes from incremental tracking | 1.14 |
| `syntax/ast.ts` | `ast/nodes.ts`; `Document` → `services/shared/document.ts` | 1.15, 1.7 |
| `syntax/ast-walk.ts` | `ast/walk.ts` (+ `allUnits`, `walkInitializer`); `isSelfRef` → `identifier.ts`; `exprAtOffset`, `memberAtOffset` → `services/shared/positions.ts` | 1.8, 1.10, 1.15 |
| `syntax/bodies.ts` | `format/bodies.ts`; `varInputParams` → `ast/declarations.ts` | 1.24, 1.15 |
| `syntax/conditional-pragmas.ts` | `pragmas/conditional.ts` (scanner); the parse entry → `parse/body-parse.ts` | 1.20, 1.23 |
| `syntax/cursor.ts` | `parse/cursor.ts` (Cursor only; unused `_context` parameters dropped); `describeToken`, `nameExpected`, `reportBrokenDeclaration` → `parse/errors.ts`; `consumeBodyUntilAny` → `parse/body.ts`; `SOFT_NAME_KEYWORDS`, `DECL_LIST_ENDERS` → `vocabulary.ts` | 1.14, 1.16, 1.17 |
| `syntax/expression.ts` | `parse/expression.ts`; aggregate and initializer code → `parse/initializer.ts`; `merge`/`mergeSpans` → `span.joinSpans`; `collectInitTokens` depth scan → `parse/scan.ts` | 1.13, 1.19 |
| `syntax/implementation-keyword.ts` | `format/implementation-line.ts`, `format/folder.ts`, `format/retired-comments.ts`, `format/reserved-names.ts`, `format/network-header.ts`; `NETWORK_TEXT_ENABLED` becomes a parse option; exports used only in the file become private (`opensKeywordLine`, `statementOf`, `unsupportedLine`, `UNSUPPORTED_WORD`, `folderOn` if the census confirms) | 1.11, 1.24, 1.40 |
| `syntax/index.ts` | `frontend/syntax/index.ts`, curated | 1.4, 1.40 |
| `syntax/literal-value.ts` | `literal/value.ts`, `literal/string.ts` | 1.22 |
| `syntax/parser.ts` | `parse/parser.ts`; dispatch from `UNIT_STARTERS`; `claimedKeywordLines` uses `allUnits`; header rewritten | 1.8, 1.21 |
| `syntax/print.ts` | `frontend/syntax/print.ts` | 1.12 |
| `syntax/statements.ts` | `parse/statements.ts`; the cache → `parse/body-parse.ts`; the EOF span → `eofSpan`; header rewritten | 1.20 |
| `syntax/token-at.ts` | `services/shared/positions.ts` (`tokenAtOffset`) | 1.10 |
| `syntax/type-expr.ts` | `parse/type-expr.ts`; `parseOptionalReturnType` → `parse/units/header.ts`; `tokenDescription` → `parse/errors.ts`; three scanners → `parse/scan.ts`; qualified-name loop → `parse/names.ts` | 1.16, 1.18, 1.19, 1.21 |
| `syntax/type-refs.ts` | `services/navigation/type-refs.ts`; `flatUnits` → `ast/walk.allUnits` | 1.8, 1.9 |
| `syntax/unit-attributes.ts` | `pragmas/attributes.ts` (one regex, one lex per source) | 1.23 |
| `syntax/util.ts` | dissolved: `joinSpans` → `span`; `identFromToken`, `eatModifiers` → `parse/names`; the `%FOLDER` helpers → `format/folder`; `BodySpan`/`codeBody` → `format/implementation-line`; `collectVarSections` → `parse/declarations`; `collectBodyUntil(Any)` → `parse/body`; `describeToken` → `parse/errors` | 1.17 |
| `syntax/var-section.ts` | `parse/declarations.ts`; `readMaybeQualifiedName` → `parse/names`; `SECTION_KEYWORDS` → `vocabulary`; header fixed (12 variants) | 1.14, 1.18, 1.21 |
| `syntax/units/*.ts` | `parse/units/*.ts`; the identifier-list and modifier loops → `parse/names`; `program.ts` return type → `header.ts` | 1.18, 1.21 |
| `symbols/index.ts` | curated read API + `build` namespace | 1.4, 1.30 |
| `symbols/symbol.ts` | `model.ts`, `scope.ts`, `cache.ts`; `isLibrarySymbol`/`libraryOf` path half → `library/path.ts` | 1.25, 1.26 |
| `symbols/binder.ts` | `binder.ts` (ingest, `gvlName`), `incremental.ts`, `extends.ts`; `hasQualifiedOnly` → `pragmas/attributes.fileHasAttribute`; the duplicated rank doc is deleted | 1.23, 1.27 |
| `symbols/scope-nav.ts` | stays; gains `enclosingPou`, `rootOf`, `visibleNames`, `symbolDefinedAt`, `resolveQualifiedConst` | 1.28 |
| `symbols/precedence.ts` | stays; `pickForAsker`, `scopeUri`, `libraryRank` exported from the index | 1.4 |
| `symbols/library-namespace.ts` | `library/manifest.ts`, `library/materialization.ts`; the binding half → `symbols/library-namespaces.ts` | 1.25 |
| `symbols/bodies.ts` | `symbols/scoped-bodies.ts` | 1.29 |
| `types/type.ts` | stays (with `elementaryTypeRef`, `elementaryRef`); `isKnown` deleted (dead) | 1.40 |
| `types/elementary.ts` | `elementary.ts` (facts: `ELEMENTARY_TYPES`, `elementaryType`, `ELEM_ALIASES`, `ANY_FAMILIES`, `inTypeGroup`, `CODESYS_ONLY_TYPES`, `elementaryDisplayName`), `platform.ts` (`PLATFORM_ALIASES`, `canonicalElem`), `predicates.ts` (`numericRank`, `isIntegerType`, `isNumericType`, `isIsolated`, `isDatetime`, `isDuration`, `isTemporal`, `isKnownPrimitive`), `conversion-name.ts` (`parseConversionName`), `literal.ts` (`integerLiteralType`, `REAL_LITERAL_TYPE`, `ANY_INT_RANGE`, `REAL_MAX_MAGNITUDE`), `defaults.ts` (`DEFAULT_STRING_LENGTH`); `TypeFamily`/`ElementaryType` stay in `elementary.ts`. Every export is placed; the transpiler's imports of these names go through `types/index.js` and do not change | 1.31, 1.32 |
| `types/resolve.ts` | stays; imports precedence through the symbols index; gains `isDialectType` | 1.4, 1.38 |
| `types/const-eval.ts` | `const/fold.ts`, `const/constancy.ts`; `heldAs` → `width.wrapToWidth`; name resolution → `scope-nav.resolveQualifiedConst` | 1.28, 1.33, 1.36 |
| `types/infer.ts` | `infer/expr.ts`, `infer/member.ts`, `infer/callee.ts`; `literalType`, `literalCheckType`, `literalErrorType`, `typedLiteralSum` → `literal.ts`; `MATH_ARG_TYPED` and the math/EXPT/`__XADD` rules → `builtins.ts`; the `lookupReference` call → `builtins.BUILTIN_RESULT` + `parseConversionName`; three integer ladders → `width.integerOfWidth`; `enclosingPou` → `scope-nav`; stray doc block fixed | 1.6, 1.28, 1.32, 1.33, 1.35 |
| `types/compat.ts` | stays; gains the pointer↔integer rule; `sameName` → `syntax/identifier.ts`; `isNarrowing` deleted (dead) | 1.15, 1.38, 1.40 |
| `types/arith.ts` | `arith/runtime.ts` (`commonType`, `promoteForRuntime`), `arith/checked.ts` (`checkedMeetType`, `checkedNegationType`), `arith/temporal.ts` (`temporalResultType`, `durationFor`); `integerOfWidth` → `width.ts`; `exptResultType` → `builtins.ts`; new `arith/operators.ts` | 1.6, 1.33, 1.34 |
| `types/render.ts` | stays; gains the compiler form | 1.39 |
| `reference/reference.ts` | `returnType` of every fixed entry reads `types/builtins.ts` `BUILTIN_RESULT` (no second table); `conversionEntry` stays derived from `parseConversionName` | 1.6 |

### 3.1a Tests (every front-end test file, and where it goes)

A colocated test imports only its own sub-layer and the layers below it. Titles are kept (suite-snapshot); a file that splits keeps
each title in exactly one destination.

| Current test | Destination | Task |
|---|---|---|
| `syntax/lexer.test.ts` | `syntax/lex/lexer.test.ts` | 1.14 |
| `syntax/literal-value.test.ts` | `syntax/literal/value.test.ts` + `literal/string.test.ts` (string cases) | 1.22 |
| `syntax/parser.test.ts` | `syntax/parse/parser.test.ts` | 1.21 |
| `syntax/aggregate.test.ts` | `syntax/parse/initializer.test.ts` | 1.19 |
| `syntax/fuzz.test.ts` | `syntax/parse/fuzz.test.ts` | 1.21 |
| `syntax/print.test.ts` | `syntax/print.test.ts` | 1.12 |
| `syntax/conditional-pragmas.test.ts` | `syntax/pragmas/conditional.test.ts` | 1.23 |
| `syntax/unit-attributes.test.ts` | `syntax/pragmas/attributes.test.ts` | 1.23 |
| `syntax/implementation-keyword.test.ts` | `syntax/format/{implementation-line,folder,retired-comments,reserved-names,network-header}.test.ts`; its network-text half → `src/network-text/` | 1.5 (network half), 1.24 |
| `syntax/token-at.test.ts` | `services/shared/positions.test.ts` | 1.10 |
| `syntax/units/folder-directive.test.ts` | `syntax/format/folder.test.ts` | 1.24 |
| `syntax/units/interface.test.ts` | `syntax/parse/units/interface.test.ts` | 1.21 |
| `syntax/units/namespace.test.ts` | `syntax/parse/units/namespace.test.ts`; its symbols half → `symbols/binder.test.ts` | 1.5, 1.21 |
| `symbols/symbols.test.ts` | `symbols/binder.test.ts` | 1.27 |
| `symbols/extends-ambiguity.test.ts` | `symbols/extends.test.ts` | 1.27 |
| `symbols/library-symbol.test.ts` | `library/path.test.ts` (path cases) + `symbols/binder.test.ts` (`isLibrarySymbol(sym)` cases) | 1.25 |
| `symbols/incremental-rebind.test.ts` | `symbols/incremental.test.ts` | 1.27 |
| `types/ambiguous-name.test.ts` | `types/resolve.test.ts` (it tests `resolveNamedType`; a `symbols/` home would import `types/` upward) | 1.5 |
| `types/arith.test.ts` | `types/arith/{runtime,checked,temporal}.test.ts` by function | 1.34 |
| `types/constancy.test.ts` | `types/const/constancy.test.ts` | 1.36 |
| `types/const-eval.test.ts` | `types/const/fold.test.ts` | 1.36 |
| `types/conversion-name.test.ts` | `types/conversion-name.test.ts`; its analysis half → `src/analysis/` | 1.5, 1.31 |
| `types/literal-check.test.ts` | `types/literal.test.ts` | 1.32 |
| `types/types.test.ts` | stays at `frontend/types/types.test.ts` (it exercises the index end to end) | 1.12 |

### 3.2 Major functions (that change file or merge)

| Function | Now | New home |
|---|---|---|
| `joinSpans`, `merge`/`mergeSpans` | `util.ts`, `expression.ts` | `span.joinSpans` |
| hand-built EOF/zero spans | `statements`, `expression` (×3), `type-expr` | `span.eofSpan`, `span.zeroSpan` |
| `describeToken` (×2), `tokenDescription`, the inline "got <kind>" forms | cursor, util, type-expr, expression, statements | `parse/errors.ts`, as named forms (`vendorTokenText`, `plainTokenText`); one wording is chosen in 2.8.1 |
| `SOFT_NAME_KEYWORDS`, `DECL_LIST_ENDERS`, `SECTION_KEYWORDS`, `TOP_LEVEL_DISPATCH`, `isFbModifier`, `isMethodModifier`, `MODIFIERS` (property, interface), `MULTI_CHAR_PUNCT`, `SINGLE_CHAR_PUNCT` | cursor, var-section, parser, units, tokens | `lex/vocabulary.ts` named subsets (the property and interface sets stay two named sets until 2.4.3 decides) |
| the qualified-name readers (type-expr loop, `readMaybeQualifiedName`, `parseQualifiedName`) | 3 files | `parse/names.readQualifiedName` (callers keep their node shapes; one AST shape is 2.4.2) |
| the identifier-list loops (×5) | units | `parse/names.readNameList` |
| the depth scanners (`collectDimTokens`, `collectBalancedParenInner`, `topLevelDotDot`, `collectInitTokens`) | type-expr, expression | `parse/scan.ts` |
| `collectAccessorBody`, `collectBodyUntilAny` | property, util | `parse/body.ts` |
| `parseActive`, `parseStatements` cache | conditional-pragmas, statements | `parse/body-parse.ts` |
| `unitAttributes`, `memberAttributes`, `declarationAttributes`, `hasQualifiedOnly` | unit-attributes, binder | `pragmas/attributes.ts` |
| `flatUnits`, `claimedKeywordLines` flattening + 7 consumer copies | type-refs, parser, … | `ast/walk.allUnits` |
| `unitBodies`, `unstatedBodies`, `body-context` listing | syntax/bodies, server, analysis | `format/bodies.unitBodies` |
| `isLibrarySymbol`, `libraryOf`, `normalize` | symbol.ts, library-namespace | `library/path.ts` (+ `symbols` keeps `isLibrarySymbol(sym)` as a one-line call) |
| `gvlNameFromUri`, `document-symbol.basename` | binder, services | `symbols/binder.gvlName` |
| `canonicalize` hidden in `linkExtends` | binder | `incremental.relink` |
| cache invalidation (4 hand-written sites) | binder, library-namespace, scope-nav, canonicalize | `cache.invalidate` |
| `heldAs` | const-eval | `width.wrapToWidth` |
| integer ladders (infer ×3, `checkedNegationType` ternary) | infer, arith | `width.integerOfWidth` |
| `MATH_ARG_TYPED`, `exptResultType`, reference `returnType` (fixed entries), infer's `lookupReference` call | infer, arith, reference | `types/builtins.ts` |
| `canonicalElem` | elementary | `platform.ts` (target parameter REQUIRED from 4.1.1) |
| `nameResolves` (the search order) | analysis/resolution | `types/names.resolveBareName` (3.1.5) |
| `BIT_STRINGS`, `COMPARISONS`, `BIT_OPERATORS` | network-text/parser | `elementary.inTypeGroup("ANY_BIT")`, `arith/operators.OPERATOR_FUNCTIONS` |
| `qualifiedConstRef`, `constRef`, `rootOf` (resolution half) | const-eval | `scope-nav.resolveQualifiedConst`, `rootOf` |
| `enclosingPou` | infer | `scope-nav.enclosingPou` |
| `resolveMemberChain`, `memberScopeOf`, `staticScopeType`, `thisType`, `isEnumValueRef` | infer | `infer/member.ts` |
| `resolveCallee`, `fbChainSections`, `calleeInfo` | infer | `infer/callee.ts` (`fbChainSections` on `extendsChain`) |
| `defaultOfValues`, `enumDefault`, `inlineEnumDefault` | transpile/lower/constants | `types/enums.ts` |
| `calendarNanoseconds` | transpile/lower/constants | `syntax/literal/calendar.ts` |
| the CODESYS-only type gate (×4) | resolve, resolution ×2, refused-name | `resolve.isDialectType` |

### 3.3 Duplicated concerns → their one home

| Concern | Copies today | One home | Restructure (R) or conformance (C) |
|---|---|---|---|
| Keyword vocabulary | Keyword union + `ALL_KEYWORDS` + 4 subset copies | `lex/vocabulary.ts` | R 1.14 |
| Span joining | 2 | `span.ts` | R 1.13 |
| Token description | 4 + parse-errors check | `parse/errors.ts` | R 1.16 (home), C 2.8.1 (one wording) |
| Namespace flattening | 8 (none in transpile — §6 G18) | `ast/walk.allUnits` | R 1.8 |
| Body listing | syntax/bodies, symbols/bodies, server, analysis/body-context | `format/bodies` + `symbols/scoped-bodies` (layered, not duplicated) | R 1.24, 1.29 |
| Body → statement tree | `parseStatements` vs `parseActive` | `parse/body-parse.bodyStatements` | R 1.20 (home), C 2.7.1 (one tree) |
| Attribute parsing | 7 (enumerated in P6) | `pragmas/attributes.ts` | R 1.23 |
| Conditional-pragma scanning | 3 | `pragmas/conditional.ts` | R 1.23 / C 2.7.1 |
| `%FOLDER` | implementation-keyword + util | `format/folder.ts` | R 1.17, 1.24 |
| Network header markers | implementation-keyword + network-text | `format/network-header.ts` | R 1.24 |
| Declaration parsing | `parseVarDecl` + `parseStructField` | `parse/declarations.ts` (side by side in R 1.21; merged in C 2.3.5) | R + C |
| Implicit-enum value list | type-expr + type-decl | `parse/type-expr.ts` (`parseEnumValues`) | C 2.3.6 (recovery differs) |
| Qualified names | 3 readers, 3 AST shapes | `parse/names` (R 1.18); one AST shape (C 2.4.2) | R + C |
| Modifiers | 3 AST shapes, 4 loops | `parse/names.readModifiers` (R 1.18); ordered list in the AST (C 2.4.3) | R + C |
| Self reference (THIS/SUPER) | ast-walk `isSelfRef` + this-super-context | `syntax/identifier.ts` | R 1.15 |
| POU scope kinds | model + network-analyze `isPou` | `symbols/model.ts` `isPouScope` | R 1.27 |
| Scope construction | makeScope + network-analyze literal | `symbols/scope.ts` + build API `localScope` | R 1.27 |
| Cache invalidation | 4 partial | `symbols/cache.invalidate` | R 1.26 |
| EXTENDS chains | about 10 re-derivations (plus 13 in transpile) | `symbols/extends.extendsChain` | R 1.27 (home), C 3.2.2 (name-resolving sites), T |
| Interface EXTENDS | 4 consumers, not in the binder | `symbols/extends` | C 3.2.1 |
| Bare-name search order | analysis `nameResolves` | `types/names.resolveBareName` | C 3.1.5 |
| Library path classification | symbol.ts + workspace-store | `library/path.ts` | R 1.25 |
| Precedence rank table | precedence + binder doc | `precedence.ts` | R 1.27 |
| Integer width ladder | 6 | `types/width.integerOfWidth` | R 1.33 (types), T (transpile) |
| Wrap to width | 3 | `types/width.wrapToWidth` | R 1.33 (types), T |
| Literal typing | 10 sites | `types/literal.ts` | R 1.32 (LSP), T (transpile `contextLiteralType`) |
| Literal prefix | lexer + literal-value split + infer regex | the prefix on the token/Literal node | R 1.22 |
| NOT result type | infer + lowering + narrowing + unary-operand | `types/arith/operators.ts` | R 1.34 (LSP copies), C 4.3.2 (infer vs lowering disagree) |
| Unary-operator families | 3 | `types/arith/operators.ts` | R 1.34 |
| Bit-string family / comparison and bitwise result (network wires) | elementary + network-text parser | `elementary.inTypeGroup`, `arith/operators` | R 1.34 / C 4.4 |
| Built-in result types | infer + reference + arith (`exptResultType`) + transpile builtins | `types/builtins.ts` | R 1.6, C 4.3.4 (LIMIT/SEL/MUX), T |
| Constant folding | constEval + transpile folder | `types/const/fold.ts` | C 4.6.1 (the fold sets differ), T |
| Enum base / numbering / default | resolve + transpile | `types/enums.ts` | R 1.37 (numbering/default), C 4.7.3 (base) |
| Pointer width / platform | 4 files | `types/platform.ts` | R 1.31, 1.38; C 4.1.1 (per target) |
| Type rendering | render + messages | `types/render.ts` forms | R 1.39 |
| Dialect type gate | 4 | `types/resolve.isDialectType` | R 1.38 |

---

## 4. Rule catalogue

**Legend.** "Home" is the rule's file in the target structure. **GAP** means no fixture covers the rule. A fixture listed covers the
rule by name; task 0.5 checks each one exists and is recorded, and marks the row GAP if it does not decide the rule. A rule marked
"(Volt)" is the Volt workspace format and is covered by unit tests, not CODESYS fixtures. `record:language` records accept/reject and
messages; `record:exec` records values. The GAP count of this catalogue as written is pinned in tasks.md (0.5) and may only fall.

### 2.1 Lexer

| id | Rule | Home | Fixtures |
|---|---|---|---|
| L1 | line comment `//` | lex/lexer | ng_network_title_and_comment (only one, and it is a network fixture) — **GAP** for ST bodies |
| L2 | block comment `(* *)` | lex/lexer | **GAP** |
| L3 | nested block comment | lex/lexer | **GAP** |
| L4 | CRLF line endings (lexer, implementation line) | lex/lexer, format/implementation-line | **GAP** |
| L5 | keywords are case-insensitive, echoed as written | lex/lexer, parse/errors | echo_mixed_case_function_name, cc2_fb_not_instantiated, tr_15_fb_copy_keeps_pointer_address |
| L6 | identifier with a leading underscore | lex/lexer | xo4_query_between_interfaces, ct_pointer_width_types, cp_xsizeof |
| L7 | backtick identifier | lex/lexer | identifier_backtick_keyword_escape, ng_opaque_leaf_negation |
| L8 | unknown character token | lex/lexer | **GAP** |
| L9 | a reserved standard-function or type word used as a name → "Unexpected token" cascade | parse/errors (today cursor + analysis refused-name) | cc4_type_name_bit_as_variable, cc4_type_name_byte_as_variable, identifier_double_underscore |
| L10 | CODESYS-only keywords are identifiers on TwinCAT | lex/vocabulary, lex/lexer | cp_pouname_operator, operand_position, operand_compare_and_swap |
| L11 | `__VECTOR` refused on TwinCAT (declared but never applied) | lex/vocabulary + parse/type-expr | type_codesys_vector (CODESYS only) — **GAP** for TwinCAT |
| L12 | soft keywords (GET/SET/PUBLIC/…/OVERRIDE) as names | lex/vocabulary SOFT_NAME_KEYWORDS | tr_15_fb_copy_keeps_pointer_address, cc2_fb_not_instantiated, subrange_assign_const_out |
| L13 | reserved keywords no grammar rule consumes (READ_ONLY, READ_WRITE, FROM, USING, WITH, PARAMS, DIV as infix) | lex/vocabulary | **GAP** |
| L14 | LIMIT/MIN/MAX/SEL/MUX are reserved (cannot be variable names) | lex/vocabulary | covered by L9 fixtures for BIT/BYTE only — **GAP** for LIMIT/MIN/MAX/SEL/MUX |
| L15 | the deprecated keywords CAL and INI: accepted or refused, and with which message | lex/vocabulary, parse/statements | **GAP** |

### 2.2 Literals

| id | Rule | Home | Fixtures |
|---|---|---|---|
| N1 | decimal integer | lex/lexer, literal/value | xo_gvl_shared_struct, xo_three_level_super_chain |
| N2 | `_` digit separator | lex/lexer, literal/value | **GAP** |
| N3 | `2#` binary | same | literal_binary, displaymode_bin |
| N4 | `8#` octal | same | literal_octal |
| N5 | `16#` hex | same | xo_union_across_objects, lib_std_counter_ends, lib_stu_pad |
| N6 | invalid base (`3#`, `10#`) | literal/value | **GAP** |
| N7 | typed integer `INT#`/`DINT#`… | lex, literal/value | literal_typed_int_hash, overflow_typed_literal_int, cc_typed_fold_usint |
| N8 | typed bit string `BYTE#`/`WORD#` | lex | **GAP** |
| N9 | typed based literal `WORD#16#FF` | lex, literal/value | **GAP** |
| N10 | typed negative `INT#-5` | lex | **GAP** |
| N11 | REAL with a fraction | lex | xo4_real_precision_across_objects, ct_bare_to_conversions |
| N12 | REAL exponent, including negative, lower-case `e` | lex | r2i_real_to_byte_above_max, fmt_real_very_small, fmt_real_down_1e_10 |
| N12a | REAL exponent with a capital `E` | lex | **GAP** |
| N12b | REAL without a leading digit (`.5`) or without a fraction digit (`5.`) | lex | **GAP** |
| N13 | typed `REAL#`/`LREAL#` | lex, literal/value | real_constant_fold_width, typed_literal_real_prefix |
| N14 | TRUE/FALSE | parse/expression | lib_std_counters, xo_function_inout_nested_struct |
| N15 | typed `BOOL#` | literal/value | **GAP** |
| N16 | `T#`/`TIME#` | lex, literal/value | lib_std_ton, lib_std_tof, lib_std_tp |
| N17 | `LTIME#` | lex, literal prefix | xf_ltime_to_dint, xf_ltime_to_udint |
| N18 | time units d/h/m/s/ms | literal/value | fmt_time_every_component, fmt_ltime_every_component, lib_std_ton |
| N19 | us/ns only in LTIME; TIME stops at u/n | lex (today split with analysis time-literal-unit) | fmt_ltime_one_microsecond, fmt_ltime_one_nanosecond, tr_32_fmt_ltime_past_i64 |
| N20 | time with `_`, a fractional component, negative `T#-` | literal/value | **GAP** |
| N21 | `D#`/`DATE#`, `LDATE#` | lex, literal/calendar | conversion_date_to_string, xf_ldate_to_date |
| N22 | `TOD#`/`TIME_OF_DAY#`, `LTOD#` | lex, literal/calendar | xf_tod_to_date, xf_ltod_to_date |
| N23 | `DT#`/`DATE_AND_TIME#`, `LDT#` | lex, literal/calendar | lib_std_rtc, xf_ldt_to_date |
| N24 | out-of-range date/time field (month 13, 25:00) | literal/calendar | **GAP** |
| N25 | CODESYS-only literal prefixes on TwinCAT | lex/vocabulary (today + refused-name) | xf_ldate_to_date, operand_uchar_literal |
| S1 | STRING `'…'` | lex | lib_stu_length, lib_stu_concat |
| S2 | WSTRING `"…"` | lex | lib_stu_wide, xo3_wstring_across_objects |
| S3 | escapes `$$ $' $L/$N $P $R $T` | literal/string | esc_len_dollar, esc_len_quote, esc_len_line_feed, esc_len_page, esc_len_carriage_return, esc_len_tab |
| S4 | `$hh` in STRING (CP1252 bytes) | literal/string | string_non_ascii_bytes, string_high_byte_escape, tr_45_string_embedded_nul |
| S5 | `$00` | literal/string | tr_45_string_embedded_nul, wstring_non_ascii |
| S6 | WSTRING escape exactly `$hhhh` | literal/string (today + analysis wstring-escape) | wstring_non_ascii, wstring_surrogate_pair, esc_wstring_hex4_0041 |
| S7 | invalid named escape | literal/string | esc_len_newline, esc_around_newline, esc_wstring_newline |
| S8 | WSTRING named escapes (`$N` in `"…"`) | literal/string (refused as unmeasured) | **GAP** |
| S9 | `"` inside STRING and `'` inside WSTRING | lex | **GAP** |
| S10 | typed char `CHAR#`/`WCHAR#`/`UCHAR#` | lex | operand_uchar_literal (UCHAR only) — **GAP** for CHAR#/WCHAR# |
| S11 | typed `STRING#'…'` / `WSTRING#"…"` | lex | **GAP** |
| S12 | IEC typed enum literal `Type#Value` | lex (not supported) | **GAP** |
| S13 | `UTF8#'…'` string literal (V3.5.18+, `05-operands.md`): its type and bytes | lex, literal/string | **GAP** |
| A1 | address `%IX`/`%QX` bit, sized `%IW`/`%MD` | lex | addr_ix_read, addr_qx_roundtrip, ca_adjacent_word_addresses |
| A2 | incomplete `%I*`, unsized `%I0.0` | lex | **GAP** |

### 2.3 Declarations

| id | Rule | Home | Fixtures |
|---|---|---|---|
| D1 | VAR, VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT | parse/declarations | xo_interface_array_dispatch, xo2_fb_instance_as_inout, xo_function_inout_nested_struct |
| D2 | VAR_TEMP, VAR_STAT, VAR_INST, VAR_EXTERNAL | parse/declarations | decl_temp_counts, var_stat_in_method, var_inst_in_method, xo_two_fbs_one_global |
| D3 | VAR_GLOBAL (GVL); VAR_CONFIG with dotted names | parse/units/global-var-list, parse/names | xo3_limits_gvl, var_config_address_binding, cc3_retain_and_var_config |
| D4 | VAR_ACCESS (file scope, path syntax, READ_ONLY/READ_WRITE) | parse/declarations | **GAP** |
| D5 | VAR_GENERIC | parse/declarations | **GAP** |
| D6 | CONSTANT, RETAIN, PERSISTENT, RETAIN PERSISTENT | parse/declarations | xo3_limits_gvl, var_retain, var_persistent, decl_retain_persistent_counts |
| D7 | NON_RETAIN (accepted by the parser, refused through analysis) | parse/declarations | var_non_retain |
| D8 | several names `a, b : T` | parse/declarations | implicit_check_bounds |
| D9 | `AT %addr` before the colon | parse/declarations | co_move_operator, ca_adjacent_word_addresses, var_config_address_binding |
| D10 | `AT %addr` after the type | parse/declarations | **GAP** |
| D11 | AT operand that is not an address | parse/declarations (today analysis at-address/lost-declaration) | **GAP** |
| D12 | scalar initializer; `REF=` initializer | parse/declarations, parse/initializer | refdecl_program_local, refdecl_fb_field |
| D13 | trailing token after a scalar initializer | parse/declarations | cc_decl_init_trailing_ident, cc_decl_init_trailing_int |
| D14 | aggregates: `[..]` array, `(a := 1)` struct, `STRUCT(..)` | parse/initializer | cc5_input_default_composite, xo3_struct_default_as_input, init_struct_by_field |
| D15 | repeat count `n(v)`; nested aggregate | parse/initializer | **GAP** (declarations/initializer-repeat.ts covers constancy, not the grammar — rechecked in 0.5) |
| D16 | bracket array initializer without `:=` | parse/declarations | **GAP** |
| D17 | empty declaration `;;` | parse/declarations | cp_empty_statements |
| D18 | `{attribute}` on a declaration | pragmas/attributes | cp_declaration_pragmas, cp_symbol_and_monitoring, cc4_attribute_value_string |
| D19 | STRUCT field with a soft-keyword name, `REF=`, AT, stray token | parse/declarations (one parser) | **GAP** |
| T1 | named elementary type; qualified `Lib.T` | parse/type-expr | try_no_fault, try_divide_by_zero |
| T2 | subrange `INT(lo..hi)` | parse/type-expr | type_dut_subrange, subrange_init_in_range, ct_subrange_across_objects |
| T3 | FB_Init arguments `FB(x := 1)` | parse/type-expr | fb_init_runs_with_declared_arguments, fb_init_base_and_derived, xo4_fb_init_chain |
| T4 | ARRAY single, multi-dimensional, `[*]`, negative lower bound | parse/type-expr | ct_three_dimensional_array, callshape_array_star_bounds, array_initializers |
| T5 | ARRAY bound from a named constant | parse/type-expr | type_codesys_vector |
| T6 | ARRAY OF ARRAY; POINTER TO POINTER | parse/type-expr | **GAP** |
| T7 | POINTER TO / REFERENCE TO | parse/type-expr | xo2_pointer_walk_across_objects, cc3_reference_assign |
| T8 | STRING, STRING(n), WSTRING, WSTRING(n) | parse/type-expr | lib_stu_length, xo_string_built_across_objects, lib_stu_wide |
| T9 | STRING[n]; STRING length from a constant | parse/type-expr | **GAP** |
| T10 | implicit enum in a declaration | parse/type-expr | type_implicit_enum_inline, var_inline_enum_decl, type_enum_inline_default_first_nonzero |
| T11 | `__VECTOR[n] OF T` | parse/type-expr | type_codesys_vector |

### 2.4 Units

| id | Rule | Home | Fixtures |
|---|---|---|---|
| U1 | PROGRAM | parse/units/program | fb_init_program_own, init_slot_program_own |
| U2 | PROGRAM with a return type (C0182) | parse/units/program | **GAP** |
| U3 | FUNCTION with a return type | parse/units/function | xo_function_inout_nested_struct |
| U4 | FUNCTION without a return type; FUNCTION IMPLEMENTS (C0145) | parse/units/function | **GAP** |
| U5 | FUNCTION_BLOCK, EXTENDS, IMPLEMENTS and lists | parse/units/function-block | xo_three_level_super_chain, xo_interface_array_dispatch, mem_fb_implements_two |
| U6 | FB EXTENDS A, B (C0096) | parse/units/function-block | cc3_multiple_inheritance |
| U7 | FB EXTENDS/IMPLEMENTS a qualified name | parse/units/function-block | **GAP** |
| U8 | FB ABSTRACT / FINAL | parse/units/function-block | oop_abstract_fb, oop_final_fb |
| U9 | FB access modifier PUBLIC/INTERNAL | parse/units/function-block | **GAP** |
| U10 | FB header with a trailing `;` | parse/units/function-block | io_function_block |
| U11 | METHOD, with a return type | parse/units/method | xo_three_level_super_chain, xo_reference_to_fb_call |
| U12 | METHOD ABSTRACT | parse/units/method | cc5_abstract_assign_and_output |
| U13 | METHOD PUBLIC/PRIVATE/PROTECTED/INTERNAL/FINAL/OVERRIDE, stacked in any order | parse/units/method | **GAP** |
| U14 | PROPERTY GET / SET / both | parse/units/property | interface_with_property_impl, cc2_property_lacks_getter, state_property_get_set |
| U15 | PROPERTY accessor VAR | parse/units/property | state_property_get_set |
| U16 | PROPERTY modifiers, accessor modifiers, accessor without END_GET/END_SET | parse/units/property | **GAP** |
| U17 | ACTION | parse/units/action | xo2_actions_base_and_derived, xo3_action_method_action |
| U18 | INTERFACE, EXTENDS, method, method with return, property | parse/units/interface | interface_extends_another, xo2_interface_extends, itf_property_through_interface |
| U19 | INTERFACE with a stray VAR (C0149) | parse/units/interface | cc2_var_in_interface, itf_var_section_declaration |
| U20 | INTERFACE EXTENDS a list; INTERFACE IMPLEMENTS (C0421) | parse/units/interface | **GAP** |
| U21 | interface accessor VAR sections (kept in the AST) | parse/units/interface | **GAP** |
| U22 | STRUCT, STRUCT EXTENDS, field initializer | parse/units/type-decl | type_dut_struct_extends, decl_temp_struct_init_resets, init_struct_by_field |
| U23 | VAR section inside a STRUCT (C0173) | parse/units/type-decl | **GAP** |
| U24 | UNION | parse/units/type-decl | type_dut_union, xo_union_across_objects |
| U25 | enum: explicit values, base type, default init | parse/units/type-decl | xo_mode_enum, xo2_grade_enum, type_enum_type_level_default |
| U26 | alias; alias with an initializer | parse/units/type-decl | type_dut_alias_int, type_dut_alias_with_init |
| U27 | TYPE EXTENDS on a non-struct (C0144/C0542) | parse/units/type-decl | **GAP** |
| U28 | NAMESPACE … END_NAMESPACE | parse/units/namespace | **GAP** (the catalog shape cannot express it; needs a multi-object fixture) |

The Volt body line and `%FOLDER` (formerly U29/U30) are rules FMT1–FMT8 in §4 2.10.

### 2.5 Expressions

| id | Rule | Home | Fixtures |
|---|---|---|---|
| E1 | OR / OR_ELSE / XOR / AND / AND_THEN | parse/expression | cp_boolean_precedence, cc_fp_op_or_else, cc_fp_op_and_then, bit_xor_byte |
| E2 | binary `&` refused | parse/expression (today analysis unsupported-operator) | cc_fp_op_ampersand, ampersand_operator_rejected |
| E3 | comparisons `= <> < > <= >=` | parse/expression | lib_std_edges, lib_prim_null_cursor, lib_std_ton |
| E4 | `+ - * / MOD` | parse/expression | xo_two_fbs_one_global, cc2_call_recursion, op_modulo_on_real |
| E5 | binary `**` refused | parse/expression (today analysis) | cc_power_operator, power_operator_rejected |
| E6 | precedence across levels | parse/expression | cp_boolean_precedence, lib_std_edges, xo_three_level_super_chain |
| E7 | left associativity `a-b-c` | parse/expression | lib_std_edges, lib_std_counters, lib_std_tp |
| E8 | `**` right associativity; `-a**b` | parse/expression | **GAP** |
| E9 | comparison chains `a<b=c` | parse/expression | **GAP** |
| E10 | unary `-`, NOT | parse/expression | xo3_bit_through_struct, cp_boolean_precedence, unary_not_on_string |
| E11 | unary `+`, prefix `&`, double unary (`- -x`, `NOT NOT`) | parse/expression | **GAP** |
| E12 | member access `a.b` | parse/expression | xo_gvl_shared_struct, xo_two_fbs_one_global |
| E13 | bit access `x.0` | parse/expression | xo3_bit_through_struct, cc3_bit_access_and_call_result |
| E14 | partial access `x.%X0/%B/%W` | parse/expression | accepts_partial_access, operand_partial_word_in_dword, operand_partial_bit_in_dword |
| E15 | index `a[i]`, `a[i,j]` | parse/expression | xo_interface_array_dispatch, xo2_grid_of_structs, ct_three_dimensional_array |
| E16 | trailing comma in an index or argument list | parse/expression | **GAP** |
| E17 | dereference `p^` | parse/expression | lib_prim_null_cursor, xo_three_level_super_chain |
| E18 | call: no args, positional, formal `:=`, output `=>` | parse/expression | xo_reference_to_fb_call, xo2_fb_instance_as_inout, xo2_method_outputs_across_objects |
| E19 | call: formal and positional mixed | parse/expression | cg_fb_mixed, cg_fun_mixed, ilc_calc_called_properly |
| E20 | call: empty formal argument `p := ,` | parse/expression | state_empty_argument |
| E21 | call: EN/ENO arguments | parse/expression | lib_std_rtc (unrecorded) — **GAP** (recorded) |
| E22 | postfix on a call result `f().x`, `f()^` | parse/expression (today analysis call-result-access) | cc3_bit_access_and_call_result, op_sys_varinfo |
| E23 | method call `a.m()` | parse/expression | xo_three_level_super_chain, xo_interface_array_dispatch |
| E24 | parenthesized expression | parse/expression | lib_std_tp_held, cp_boolean_precedence |
| E25 | inline assignment `(x := v)` | parse/expression | cp_inline_assignment, cc5_new_in_expression |
| E26 | inline assignment as an IF/WHILE/REPEAT condition | parse/statements | **GAP** |
| E27 | THIS / SUPER / `THIS^.x` | parse/expression, identifier | xo3_override_calls_override, xo_three_level_super_chain, shadowing_method_local_shadows_fb_var |
| E28 | keyword-named callee (ADR, SIZEOF, SEL, MUX, MIN, MAX, LIMIT…) | parse/expression | lib_stu_length, xo_reference_to_fb_call |
| E29 | `__POSITION` swallows the next token | parse/expression, parse/statements | operand_position, sysop_position_then_statement, sysop_position_call_form |
| E30 | `__CURRENTTASK` refused in ST | parse/expression | op_sys_currenttask, sysop_currenttask_then_statement, sysop_currenttask_call_form |
| E31 | IL operator call form `ADD()`/`GT()` refused | parse (today analysis refused-name) | operator_call_form_arithmetic, operator_call_form_comparison, operator_call_form_extensible |
| E32 | `eatName` accepts any keyword as a member name | parse/expression | **GAP** |
| E33 | the global-namespace operator: a leading dot `.ident` names the global (`08-identifiers.md`, `09-shadowing.md`; the parser has no primary for it) | parse/expression + types/names | **GAP** |
| E34 | `__POOL.POU()` (the pool qualifier) | parse/expression | **GAP** |

### 2.6 Statements

| id | Rule | Home | Fixtures |
|---|---|---|---|
| ST1 | assignment `:=` | parse/statements | xo_gvl_shared_struct |
| ST2 | `S=` / `R=` | lex + parse/statements | cc_fp_set_reset, set_reset_basic, ng_coil_storage |
| ST3 | `REF=` | lex + parse/statements | cc3_reference_assign, xo_reference_to_fb_call, cc4_output_reference_type |
| ST4 | chained assignment with mixed operators | parse/statements | set_reset_chained, cc_fp_set_reset_chain, cc5_new_in_expression |
| ST5 | call statement; bare expression statement | parse/statements | cc5_no_op_statement, conditional_define_then_if |
| ST6 | IF/ELSIF/ELSE | parse/statements | stmt_elsif_second, ctrl_if_elsif_else, cp_empty_statements |
| ST7 | CASE: multi-label, range, enum label, ELSE | parse/statements | stmt_case_multi_label, stmt_case_range, xo_enum_case_across_objects, ctrl_case_of_else |
| ST8 | CASE: negative label | parse/statements | tr_37_case_label_wraps_minus_212 (unrecorded) — **GAP** (recorded) |
| ST9 | CASE: typed-literal label `INT#1:`, parenthesized and constant-expression labels | parse/statements | **GAP** |
| ST10 | CASE: empty arm (is an error) | parse/statements | **GAP** |
| ST11 | FOR, FOR BY | parse/statements | refuse_for_step_calls, cc4_loop_exit_constant |
| ST12 | WHILE / REPEAT | parse/statements | stmt_repeat_once, ctrl_repeat_until, lib_prim_null_cursor |
| ST13 | RETURN / EXIT / CONTINUE | parse/statements | xo4_return_in_every_routine, stmt_exit_inner, stmt_continue_skips |
| ST14 | RETURN/EXIT/CONTINUE without `;` | parse/statements | **GAP** |
| ST15 | JMP and `label:` | parse/statements | ng_label_jmp_resolved, cc_vg_undefined_label, err_c0116_duplicate_label |
| ST16 | empty `;` | parse/statements | cp_empty_statements, initprg_reads_earlier |
| ST17 | `__TRY/__CATCH/__FINALLY/__ENDTRY` | parse/statements | op_sys_try_catch, try_divide_by_zero, try_finally_on_fault |
| ST18 | `__TRY` without `__CATCH`/`__FINALLY`; a nested `__TRY` | parse/statements | **GAP** |
| ST19 | `CAL inst(…)` and `INI(…)` in an ST body (the statement half of L15) | parse/statements | **GAP** |

### 2.7 Pragmas

| id | Rule | Home | Fixtures |
|---|---|---|---|
| P1 | `{attribute}` on a POU, with a value | pragmas/attributes | cp_symbol_and_monitoring, cp_obsolete_pou, xo_mode_enum |
| P2 | `{attribute}` on a member (METHOD/PROPERTY) and inside a STRUCT | pragmas/attributes | **GAP** |
| P3 | `{define}/{undefine}/{IF defined}/{ELSIF}/{ELSE}` | pragmas/conditional, parse/body-parse | conditional_define_then_if, conditional_elsif_chain, conditional_undefine_after_define |
| P4 | `{IF hasattribute/hastype/defined(variable:…)}` | pragmas/conditional | cc6_attribute_value_unquoted |
| P5 | `{define}` in the declaration part / project settings | pragmas/conditional | **GAP** |
| P6 | `{warning}/{info}/{text}`, `{region}` | lex (trivia) | warning_message, info_message, region_pragma_nested |
| P7 | pragma inside an expression/statement | lex | **GAP** |
| P8 | `}` inside a quoted attribute value | lex | **GAP** |
| P9 | a commented-out attribute is ignored | pragmas/attributes | **GAP** |
| P10 | `{define name 'string'}` — a define with a value | pragmas/conditional | **GAP** |
| P11 | the other conditional operators: `hasvalue(…)`, `hasconstantvalue`, `hasconstanttype`, `defined(type:/pou:/task:)`, `IsLittleEndian`, `RegisterSize` (`07-pragmas.md` "Conditional operators") | pragmas/conditional | **GAP** |
| P12 | `NOT`/`AND`/`OR` combinations in an `{IF}` condition | pragmas/conditional | **GAP** |
| P13 | `project_defined` in a declaration part, and the constructs it is limited to (`07-pragmas.md` "project_defined exception") | pragmas/conditional | **GAP** |
| P14 | `{attribute 'strict'}` on an enum: which conversions it refuses (changes CV5) | pragmas/attributes + types/compat | **GAP** |
| P15 | `{attribute 'to_string'}` on an enum: the enum → STRING conversion yields the member name | pragmas/attributes + types/builtins | **GAP** |
| P16 | `{attribute 'const_replaced'}` / `'const_non_replaced'`: constancy of the decorated constant | pragmas/attributes + types/const/constancy | **GAP** |

Front-end-semantic attributes are the ones that change resolution, typing or constancy: `qualified_only` (Y11, Y12, EN1), `strict`
(P14), `to_string` (P15), `const_replaced`/`const_non_replaced` (P16). The rest of the catalog in `07-pragmas.md` (`pack_mode`,
`noinit`, `obsolete`, `no_assign`, `hide`, `monitoring`, init slots, `call_after_init` …) is decided by a consumer — layout and
initialization by the transpiler, warnings by analysis, visibility by services — and is not a front-end rule. Attribute PARSING of every
one of them is P1/P2/P8/P9.

### 2.8 Error recovery

| id | Rule | Home | Fixtures |
|---|---|---|---|
| R1 | missing `;` after a statement: the vendor's two-message cascade | parse/statements | sysop_position_in_expression |
| R2 | missing THEN/OF/DO/END_* | parse/statements | **GAP** |
| R3 | a broken declaration: the vendor cascade (`reportBrokenDeclaration`) | parse/errors | cc4_type_name_bit_as_variable, cc4_type_name_byte_as_variable, identifier_double_underscore |
| R4 | file-scope stray token wording | parse/parser | **GAP** |
| R5 | "expected expression, got <kind>" wording | parse/errors | **GAP** |
| R6 | the cascade after a refused name / unknown literal prefix (today analysis refused-name, resync) | parse/errors | cc4_type_name_* (partial) — **GAP** per refusal kind |

### 2.9 Printer

The printer is Volt's, so its rules are checked by the fixed-point harness (0.2) and by named unit tests, not by recordings.

| id | Rule | Home | Tests |
|---|---|---|---|
| PR1 | print → parse → print is a fixed point for every construct in 2.1–2.7 | print.ts + services/formatting | `test/frontend/fixed-point.test.ts` over everything 0.1 parses — **GAP** until its baseline is empty |
| PR2 | `STRING[n]` and AT-after-type round-trip as written | print.ts | `print.test.ts` "STRING[n] round-trips", "AT after the type round-trips" — **GAP** |
| PR3 | a synthesized nested binary prints with the parentheses precedence needs | print.ts | `print.test.ts` "nested binary gets precedence parentheses" — **GAP** |
| PR4 | METHOD modifier order is kept | services/formatting/print.ts | `services/formatting/print.test.ts` "method modifiers keep their order" — **GAP** |

### 2.10 The Volt workspace format (Volt; unit tests)

| id | Rule | Home | Tests |
|---|---|---|---|
| FMT1 | a body's declaration ends at a whole line `IMPLEMENTATION ST|LD|FBD`, outside every comment, with nothing else on it | format/implementation-line | `implementation-line.test.ts` (from implementation-keyword.test.ts) |
| FMT2 | `IMPLEMENTATION <LANG> UNSUPPORTED` states an unshown body (always for CFC/SFC/IL; never for ST); the body under it is empty | format/implementation-line | `implementation-line.test.ts` |
| FMT3 | a bare `IMPLEMENTATION CFC|SFC|IL` is reported, naming the line to write | format/implementation-line | `implementation-line.test.ts` |
| FMT4 | a look-alike (in a comment, or after code on the line) is not the boundary | format/implementation-line | `implementation-line.test.ts` |
| FMT5 | `%FOLDER <path>` is read only on the line directly under a METHOD's or ACTION's keyword line, alone on its line; a property's or interface member's is peeled from the declaration's last line (`StReader.PeelFolderClosing`) | format/folder | `folder.test.ts` (from units/folder-directive.test.ts) |
| FMT6 | a `%FOLDER` line anywhere else is reported ("is no folder the push reads here") | format/folder | `folder.test.ts` |
| FMT7 | the retired `(* @volt-… *)` comments are reported | format/retired-comments | `retired-comments.test.ts` |
| FMT8 | IMPLEMENTATION is a reserved name; a network body opens with the fielded header and closes with END_NETWORK | format/reserved-names, format/network-header | `reserved-names.test.ts`, `network-header.test.ts` |

FMT rows carry named tests, not fixtures; `rules.test.ts` checks the test titles exist and does not count them as GAPs.

### 3.1 Scopes and lookup

| id | Rule | Home | Fixtures |
|---|---|---|---|
| Y1 | identifiers are case-insensitive | symbols/scope | sn_case_differs_only, echo_mixed_case_function_name, echo_lower_case_function_name |
| Y2 | innermost declaration shadows outer | scope-nav.lookup | shadowing_method_local_shadows_member, shadowing_method_param_shadows_member, shadowing_method_local_shadows_fb_var, xo3_method_local_shadows_field |
| Y3 | VAR_IN_OUT vs FB field vs VAR_STAT (transpile-review 19) | scope-nav | **GAP** |
| Y4 | a standalone METHOD/ACTION/PROPERTY parents to the preceding POU | binder | use_fb_method_call_no_args, use_fb_method_returns_value, oop_action_block, xo3_action_method_action, use_self_method_call |
| Y5 | method VAR_INPUT/OUTPUT/IN_OUT are parameters | binder | use_fb_method_call_one_input, use_fb_method_call_named_args, callshape_method_input_no_default |
| Y6 | getter and setter have their own scopes; the property is a host member | binder, scoped-bodies | use_fb_property_read, use_fb_property_write, xo2_property_override_chain, callshape_program_instance_property |
| Y7 | the same local name in getter and setter does not collide | binder | **GAP** |
| Y8 | program instance members reachable as `PRG.var` | scope-nav.lookupMember | callshape_program_instance_from_outside, callshape_method_on_program |
| Y9 | GVL block name = file basename; `GVL.var` resolves | binder.gvlName, scope-nav.resolveGvlMember | use_gvl_field_access, xo3_limits_gvl, xo_gvl_shared_struct, xo4_gvl_array |
| Y10 | GVL variables resolve bare (list not qualified_only) | binder | xo_two_fbs_one_global, fbcall_program_writes_global, cfold_global_list |
| Y11 | `qualified_only` GVL: only `GVL.var` resolves | binder + attributes | fbcall_gvl_qualified |
| Y12 | `qualified_only` applies per unit, not per file | attributes | **GAP** |
| Y13 | VAR_EXTERNAL binds to the same-named global | scope-nav (today analysis) | var_external_gvl, var_external_consumer |
| Y14 | the same global in two GVLs is ambiguous; VAR_EXTERNAL disambiguates | analysis over scope-nav | cc6_ambiguous_gvl_one, cc6_ambiguous_gvl_two, cc6_ambiguous_global |
| Y15 | an unknown bare identifier is an error | types/names + analysis (message) | unresolved_identifier_in_body, cc_vg_undeclared, network_unnamed_* |
| Y16 | a duplicate declaration in one scope | binder + analysis | duplicate_declaration |
| Y17 | units inside a source NAMESPACE block are scoped and analysed | binder.ingestNamespace, scoped-bodies | **GAP** |
| Y18 | a METHOD after an FB inside a NAMESPACE parents to that FB | binder | **GAP** |
| Y19 | binding is order-independent | incremental.canonicalize | **GAP** (probe script only) |
| Y20 | a function's name is its return variable; a method's result | binder | refuse_method_no_result, use_fb_method_returns_value |
| Y21 | the signature name must match the object name | analysis over scopeForUnit | sn_fb_mismatch, sn_function_mismatch, sn_program_mismatch, sn_interface_mismatch, sn_dut_mismatch, sn_fb_matches, sn_function_matches |
| Y22 | dialect vocabulary resolved per project dialect | scope.dialect | tc2_gvl_var_names |
| Y23 | the bare-name search order (`09-shadowing.md`): locals, then the POU's members and inherited members, then local methods before globals, globals before POU/type names, then built-ins and library roots; a library GVL requires qualified access | types/names.resolveBareName | shadowing_* (steps 1–2 only) — **GAP** for the intermediate steps |
| Y24 | a device-tree instance name resolves bare (from the `.device` descriptors) | symbols/binder (device ingest) + types/names | **GAP** |

### 3.2 Inheritance

| id | Rule | Home | Fixtures |
|---|---|---|---|
| H1 | FB EXTENDS: inherited members resolve in the derived FB and its methods | extends.linkExtends, scope-nav | oop_extends_simple, oop_extends_with_override, inh_call_runs_derived_body, inh_inherited_method_reaches_override, xo_three_level_super_chain, xo_inherited_action_from_derived, xo2_actions_base_and_derived, callshape_inout_base_method_from_derived_method |
| H2 | `inst.baseMember` resolves AND types | infer/member via lookupMember | callshape_inout_base_method_from_outside_derived (types UNKNOWN today) |
| H3 | STRUCT EXTENDS inherits fields | binder + extends | type_dut_struct_extends |
| H4 | INTERFACE EXTENDS: base members visible through the derived interface | extends (not bound today) | interface_extends_another, interface_extends_another_impl, xo2_interface_extends, itf_extends_assigns_to_base, xo4_query_between_interfaces |
| H5 | interface members are symbols of the interface scope; interface method parameters are bound | binder | interface_with_method, interface_with_property, itf_property_through_interface, itf_call_dispatches_on_instance — **GAP** for parameters |
| H6 | THIS is the enclosing FB; SUPER is its base; SUPER without a base is refused | scope-nav.enclosingPou, infer/member | keyword_this_dereference, use_this_member_in_method, fbcall_this_in_program, oop_extends_with_super, inh_super_call_runs_base_body, refuse_super_without_base |
| H7 | an unresolved EXTENDS base keeps checks conservative | scope-nav.hasUnresolvedBase | **GAP** |
| H8 | the base named by EXTENDS under library ambiguity (by precedence, not by the first scope of that name) | extends | **GAP** |
| H9 | an EXTENDS cycle | extends.extendsChain | **GAP** |
| H10 | override and abstract members | analysis over extends | oop_abstract_fb, cc5_abstract_assign_and_output (partial) — **GAP** for override-signature mismatch |

### 3.3 Enums

| id | Rule | Home | Fixtures |
|---|---|---|---|
| EN1 | `qualified_only` enum: only `Enum.Member` resolves | binder, scope-nav.resolveBareEnumMember | xo_mode_enum, xo_enum_case_across_objects |
| EN2 | non-qualified enum members resolve bare, after locals | scope-nav | type_dut_enum_simple, xo2_grade_enum, xo2_case_ranges_over_enum |
| EN3 | two enums declaring the same bare member → ambiguity | scope-nav | **GAP** |
| EN4 | an implicit enum introduces its values into the enclosing scope | binder | type_implicit_enum_inline, var_inline_enum_decl |
| EN5 | an enum member vs a variable of the same name | scope-nav | **GAP** |
| EN6 | a library enum's members, bare and qualified | scope-nav + library-namespaces | **GAP** |

### 3.4 Libraries

| id | Rule | Home | Fixtures |
|---|---|---|---|
| LB1 | a library element is reachable qualified through its manifest NAMESPACE | library-namespaces | tr_21_namespace_qualified_first, tr_21_namespace_bare_first |
| LB2 | a namespace sees only its direct DEPENDENCIES | library-namespaces.visibleFolders | **GAP** |
| LB3 | same-name candidates: own library > dependency > project > other, then the URI tiebreak | precedence (applied by linkExtends, findChildScope, resolve — not by lookup) | **GAP** |
| LB4 | a project unit wins over a library namespace of the same name | library-namespaces | **GAP** |
| LB5 | the type name exported by two libraries (kind first, then asker) | types/resolve + precedence | **GAP** (unit test resolve.test.ts only) |
| LB6 | bare `lookup` of a name several libraries export uses precedence | scope-nav.lookup | **GAP** |
| LB7 | an incremental rebind of a library file equals a whole rebuild | incremental + library-namespaces | unit test `symbols/incremental.test.ts` "library rebind equals whole rebuild" — **GAP** until written |
| LB8 | transitive library qualification `lib0.lib1.sym` | library-namespaces + scope-nav | **GAP** |
| LB9 | a library GVL member `lib.gvl.var` | library-namespaces + scope-nav.resolveGvlMember | **GAP** |

### 3.5 Members

| id | Rule | Home | Fixtures |
|---|---|---|---|
| M1 | an unknown member of a type is an error | scope-nav.lookupMember | cc_unknown_member, cc_vg_unknown_member, cc_vg_unknown_pin |
| M2 | UNION members resolve like struct fields | binder | type_dut_union, xo_union_across_objects |
| M3 | members through `p^.x` and a REFERENCE | infer/member | xo2_pointer_walk_across_objects (partial) — **GAP** for REFERENCE TO FB member and method |
| M4 | property access through an interface | infer/member | itf_property_through_interface |
| M5 | CONSTANT section symbols are foldable | binder (constant flag) | named_const_expression_keeps, named_const_literal_wrap, cfold_global_list |
| M6 | access modifiers PRIVATE/PROTECTED/INTERNAL are checked AFTER resolution (a private member still resolves, then is refused) | scope-nav (resolution) + analysis (refusal) | **GAP** |

### 4.1 Elementary types

| id | Rule | Home | Fixtures |
|---|---|---|---|
| TY1 | ranges and widths (SINT..ULINT, BYTE..LWORD, BOOL, BIT) | elementary | types/primitive-bounds.ts, types/primitive-default.ts, operators/overflow.ts |
| TY2 | TIME/DATE/TOD/DT tick and 32 bits; L-variants 64-bit ns | elementary | semantics/execution.ts (time_*, date_width_wrap, ldate_ltod_ldt), conversions/cross-family.ts |
| TY3 | REAL/LREAL mantissa bits | elementary + compat | conversions/conversion.ts (loss_dint_to_real), conversions/integer-to-real.ts |
| TY4 | aliases (TIME_OF_DAY=TOD …) and their display spelling | elementary, render | cc_ltod_literal_into_tod, cc_ldt_literal_into_dt, types/literal.ts |
| TY5 | platform integers `__XINT/__UXINT/__XWORD` (64-bit) | platform | types/platform-integers.ts (plat_*) |
| TY6 | platform integers on a 32-bit target | platform (Target) | **GAP** |
| TY7 | CODESYS-only LDATE/LTOD/LDT unknown on TwinCAT | resolve.isDialectType | cc_ld*_literal_into_*, conversions/cross-family.ts |
| TY8 | default STRING/WSTRING capacity 80 | defaults | string_default_length, wstring_basic |
| TY9 | ANY_* group membership | elementary | types/data-type.ts, operators/unary-operand.ts, check-coverage (ANY_NUM string operand) |
| TY10 | conversion names: exact spelling, case-insensitive, ANY_ prefixes, no ANYNUM_ | conversion-name | cc_conv_spelled_*, cs_anynum_to_conversions |
| TY11 | platform-alias conversion names `__XINT_TO_DINT` … | conversion-name | **GAP** |
| TY12 | BIT only as a STRUCT/FB field: no BIT variable elsewhere, no POINTER TO / REFERENCE TO / ARRAY OF BIT | resolve | **GAP** |
| TY13 | an ARRAY element cannot be a REFERENCE | resolve | **GAP** |
| TY14 | generic ANY / ANY_NUM / ANY_* as a parameter type, and what argument it accepts | resolve + compat | **GAP** |
| TY15 | the VERSION system type | elementary | **GAP** |

### 4.2 Literal typing

| id | Rule | Home | Fixtures |
|---|---|---|---|
| LT1 | an untyped integer takes the narrowest of SINT..ULINT | literal | overflow_*, cc_literal_*, cc_fp_literal_* |
| LT2 | an untyped real is LREAL | literal | cc_init_real_into_int |
| LT3 | a real literal above REAL_MAX into REAL warns LREAL→REAL | literal | cc_real_init_max, cc_real_init_sci_fraction, cc_real_init_tiny |
| LT4 | 0/1 into BOOL is silent, other values "Cannot convert" | literal | cc_init_*_into_bool, cc_assign_one_into_bool |
| LT5 | a typed literal has its prefix's type; UCHAR# is UDINT | literal | operand_uchar_literal, literal_typed_int_hash |
| LT6 | the LTIME#/LDATE#/LTOD#/LDT# prefixes are the 64-bit types | literal (from the token prefix) | cc_ltime_literal_into_time, cc_ltod_literal_into_tod, cc_ldt_literal_into_dt |
| LT7 | REAL#/LREAL# decide the stored width | literal, const/fold | typed_literal_real_prefix |
| LT8 | typed + typed folds to the narrowest type of its signedness | literal.typedLiteralSum | cc_typed_fold_*, typed_literal_constant_fold |
| LT9 | beyond ANY_INT / LREAL / its prefix type → "constant too large" | literal.literalCapacityType | operators/overflow.ts |
| LT10 | a REF= literal's own type must equal the referenced type | literal.literalOwnType | cc6_reference_assign_literal |
| LT11 | a VAR_IN_OUT literal argument takes its narrowest type | literal.literalOwnType | calls/inout-constant.ts |
| LT12 | an untyped literal in comparison, CASE label, array bound, FOR bounds, and as a call argument to ANY_* | literal | **GAP** |
| LT13 | negative literals (`-128` into SINT, `-32768` into INT) | literal.isNegatedIntLiteral | **GAP** (only through narrowing fixtures) |
| LT14 | the context literal type the transpiler uses (`contextLiteralType`) agrees with the checked type | literal | `test/frontend/literal-agreement.test.ts` over every literal in the corpus and fixtures — **GAP** until written |

### 4.3 Arithmetic and built-in result types

| id | Rule | Home | Fixtures |
|---|---|---|---|
| AR1 | checked meet (a REAL wins; else the widest int, signed if either is) | arith/checked | operators/mixed-type.ts (meet_*) |
| AR2 | run-time meet commonType | arith/runtime | same_width_mixed_sign_order, signed_unsigned_comparison, meet_mixed_sign_wider_unsigned, strord_capacity_* |
| AR3 | promotion below 32 bits to DINT | arith/runtime | arithmetic_width, bit_string_arithmetic |
| AR4 | unary minus checked type (signed of width, floor 16) | arith/checked | cc_neg_*, uop_neg_* |
| AR5 | unary minus run-time; not on TIME | arith/operators | unary_minus_at_the_edge, unary_minus_unsigned_widened, unary_minus_on_time |
| AR6 | NOT result type (infer and lowering disagree) | arith/operators | uop_not_*, not_result_width, cc_not_int_into_dint |
| AR7 | AND/OR/XOR on signed compute in the unsigned of the width | arith/operators | bit_{and,or,xor}_*, cc_bitwise_sint_and_literal |
| AR8 | operand sign-change warnings (arith/MIN/MAX meet signed; comparison only at 32/64) | arith/operators | cc_add_*, cc_max_*, cc_compare_*, same_width_*, meet_ulint_mod_sint, meet_lint_plus_real |
| AR9 | BOOL operand in `+ - * / MOD`; MOD integer-only; string operand → ANY_NUM | arith/operators | meet_bool_*, cc_string_* |
| AR10 | shifts/rotates result type | arith/operators + builtins | operators/bitwise.ts (run values only) — **GAP** for the checked type |
| AR11 | EXPT: REAL only when both are REAL, else LREAL | builtins | cc_expt_*, expt_types, expt_mixed_width, cfold_expt |
| AR12 | the ten math functions return the REAL argument's type, else LREAL | builtins | mathret_*, cfold_sqrt, sqrt_precision |
| AR13 | MIN/MAX return the checked meet | builtins | operators/selection.ts |
| AR14 | LIMIT/SEL/MUX result type | builtins | **GAP** |
| AR15 | `__XADD`: TwinCAT returns the operand type, CODESYS DINT | builtins | atomic_xadd_* |
| AR16 | `__POSITION` is STRING on CODESYS, undefined on TwinCAT | builtins | sysop_position_initializer |
| AR17 | temporal: date − date = duration (LTIME for 64-bit); date ± duration = date | arith/temporal | semantics/execution.ts date/calendar cases |
| AR18 | duration × / ÷ integer is the duration type | arith/temporal | time_multiply_divide (run value only) — **GAP** for the checked type |
| AR19 | all-constant integer expressions fold at LINT (ULINT ≥ 2^63) | const/fold | constant_arithmetic_width, const_literal_wider_than_lint, all_constant_division_in_real_context |
| AR20 | integer / REAL constant divides in REAL | arith/runtime | division_with_a_real_operand |
| AR21 | DIV/MOD signs with negative operands | arith/runtime | **GAP** |
| AR22 | ADR / BITADR result type (pointer-sized / DWORD, per target) | builtins | mem_adr_of_inout_member, operand_bitadr |
| AR23 | SIZEOF / XSIZEOF / INDEXOF result type | builtins | mem_sizeof_struct_mixed, cp_xsizeof, operand_indexof |
| AR24 | `__NEW(T)` is POINTER TO T; `__DELETE` | builtins | op_sys_new_delete |
| AR25 | `__ISVALIDREF` / `__QUERYINTERFACE` / `__QUERYPOINTER` are BOOL | builtins | op_sys_isvalidref, op_sys_queryinterface, operand_querypointer |
| AR26 | `__VARINFO`, `__POUNAME` result types | builtins | op_sys_varinfo, cp_pouname_operator |
| AR27 | `TEST_AND_SET`, `__COMPARE_AND_SWAP` result types | builtins | operand_test_and_set, operand_compare_and_swap |
| AR28 | TRUNC (DINT) / TRUNC_INT (INT) | builtins | conversion_trunc_real_to_dint, conversion_trunc_int_real_to_int, trunc_functions |
| AR29 | ABS keeps its operand type; MOVE is its operand type | builtins | abs_values, abs_unsigned, co_move_operator |
| AR30 | UPPER_BOUND / LOWER_BOUND result type (DINT) | builtins | **GAP** |
| AR31 | the nullary clock calls `TIME()` / `LTIME()` | builtins | **GAP** |

### 4.4 Comparisons and BOOL/bit operations

| id | Rule | Home | Fixtures |
|---|---|---|---|
| CB1 | comparing incompatible scalars / arrays | compat + analysis | operators/comparison.ts, check-coverage |
| CB2 | enum comparison: two enum types error, two enum values silent, same enum in two casings | compat.isSameType, infer/member | cc_enum_compare_two_enums, cc_enum_compare_two_enum_values, cc_fp_enum_compare_same_enum_other_case |
| CB3 | BIT converts as BOOL | compat, predicates.isBoolValued | types/data-type.ts, types/corpus-types.ts |
| CB4 | the comparison result is BOOL for every pair incl. STRING, TIME, pointer | infer/expr | **GAP** (pointers and TIME) |
| CB5 | AND_THEN/OR_ELSE on non-BOOL operands | arith/operators | **GAP** |

### 4.5 Conversions

| id | Rule | Home | Fixtures |
|---|---|---|---|
| CV1 | implicit: widen by rank; LREAL→REAL narrows; int→real narrows past the mantissa; real→int incompatible; isolated families | compat | conversions/implicit-checks.ts, integer-to-integer.ts, integer-to-real.ts, real-to-integer.ts, cross-family.ts, conversion.ts |
| CV2 | sign change: signed→unsigned at any width, unsigned→signed at the same width only | compat | sign_change_sint_to_uint, conversions/integer-to-integer.ts |
| CV3 | a project enum without a base converts as INT; two enums are incompatible | resolve + compat | cc_enum_into_*, cc_enum_var_into_* |
| CV4 | an enum with a written base; a library enum | compat + enums | type_dut_enum_with_base (storage only) — **GAP** |
| CV5 | a scalar into an enum (with and without `strict`, P14) | compat | **GAP** |
| CV6 | pointer ↔ unsigned 32/64-bit integer | compat + platform | memory/memory-model.ts, memory/pointer-parameters.ts |
| CV7 | explicit `X_TO_Y` for every pair; TRUNC/ROUND; BCD; string ↔ number/time/date | builtins + conversion-name | conversions/*.ts; the pair matrix (`scripts/conversion-matrix.ts`, run in 0.5) lists the missing pairs — **GAP** while that list is non-empty |

### 4.6 Constant evaluation

| id | Rule | Home | Fixtures |
|---|---|---|---|
| CE1 | REAL constant expressions fold wide and round once | const/fold | real_constant_fold_width |
| CE2 | a literal initializer is held at the declared width; an expression initializer is not | const/fold | named_const_literal_wrap, named_const_expression_keeps |
| CE3 | VAR_INPUT/VAR_IN_OUT CONSTANT is not a compile-time constant | const/constancy | var_input_constant_default_as_step |
| CE4 | `GVL.Const` / `Program.Const`; sibling constants inside a GVL initializer | const/fold + scope-nav.resolveQualifiedConst | cfold_global_list |
| CE5 | cycle guard | const/fold | **GAP** |
| CE6 | folding of conversions, pure built-ins, SIZEOF, enum values (transpile folds these; constEval does not) | const/fold | declarations/constant-folding.ts (transpile only) — **GAP** for LSP agreement |
| CE7 | constancyOf: an enum member or CONSTANT is constant, a variable is not | const/constancy | check-coverage C0218 cases, declarations/constant-folding.ts, declarations/initializer-repeat.ts |
| CE8 | array bounds and STRING(n) fold in the declaring POU's scope | resolve | types/data-type.ts, types/range-bounds.ts (array_index_const_*) |
| CE9 | NOT on an integer, shifts, a REAL behind an alias | const/fold | **GAP** |

### 4.7 Derived types

| id | Rule | Home | Fixtures |
|---|---|---|---|
| DT1 | an alias resolves in its own file | resolve | types/corpus-types.ts, types/data-type.ts |
| DT2 | an alias with an initializer | resolve + const | type_dut_alias_with_init |
| DT3 | subrange bounds check (outside the Type model today) | type.ts subrange | subrange_init_*, subrange_assign_const_out |
| DT4 | union typing (a union as a struct today) | type.ts union | types/data-type.ts, operators/operands.ts |
| DT5 | enum default value: zero if a member, else the first | enums | type_enum_default_*, type_enum_inline_default_first_nonzero |
| DT6 | enum storage base (resolve says INT only for a project enum without a base; transpile uses the written base) | enums | **GAP** |
| DT7 | THIS types as the enclosing FB; `THIS^` is identity | infer/member | calls/call-shapes.ts, calls/fb-call.ts, oop/* |
| DT8 | a name that denotes a GVL/enum/POU/namespace is a static member base (namespace and interface typed "struct" today) | infer/member | cross-object/* |
| DT9 | an FB takes no positional arguments; a function/method does | infer/callee | calls/call-grid.ts, refuse_fb_called_positionally |
| DT10 | render: TIME_OF_DAY spelling, `ARRAY [` with a space, STRING(n) | render | cc_ltod_literal_into_tod, cc_standard_len_wstring, cc6_function_input_array_default |
| DT11 | render: a string literal as `STRING(INT#len)` | render (compiler form) | cc_string_escape_literal_into_int, operators/system-operands.ts |
| DT12 | POINTER TO / REFERENCE TO compatibility with each other and with the pointee | compat | memory/* (partial) — **GAP** for REFERENCE ↔ POINTER |
| DT13 | pointer arithmetic: POINTER ± integer, pointer − pointer | arith/operators + compat | refuse_adr_difference (the refused form only) — **GAP** for the accepted forms |
| DT14 | REFERENCE auto-dereference typing (a REFERENCE TO T reads as T) and the REF= type rules beyond LT10 | infer/member + compat | **GAP** |

---

## 5. Test layout

- **Colocated unit tests** sit next to their file in the new tree, for example `frontend/syntax/parse/declarations.test.ts`. §3.1a maps
  every current front-end test file. Files that have no test today get one when they move: `parse/cursor`, `parse/statements`,
  `parse/type-expr`, `parse/declarations`, `parse/names`, `parse/scan`, `symbols/extends`, `types/width`, `types/arith/*`,
  `types/literal`. A colocated test imports only its own sub-layer and the layers below it: never a consumer, and never a higher
  front-end layer.
- **Volt format tests** go in `frontend/syntax/format/*.test.ts` (FMT1–FMT8). That is the 401 lines of today's
  `implementation-keyword.test.ts` plus `units/folder-directive.test.ts`, minus the network-text half, which moves to
  `src/network-text/`.
- **Conformance fixtures** (CODESYS-recorded) go in `test/conformance/fixtures/`, in two new folders plus the existing ones:
  - `grammar/`: `lexer.ts`, `literals.ts`, `declarations.ts`, `units.ts`, `expressions.ts`, `statements.ts`, `pragmas.ts`,
    `recovery.ts` (areas 2.1–2.8), recorded with `record:language`;
  - `names/`: `scopes.ts`, `inheritance.ts`, `enums.ts`, `libraries.ts`, `members.ts` (areas 3.1–3.5);
  - typing rules keep the existing `types/`, `operators/`, `conversions/` and `declarations/constant-folding.ts` files, with new
    cases in the file of their topic; values come from `record:exec`, messages from `record:language`.

  New fixture names use the prefix of their catalogue group: `lex_`, `lit_`, `decl_`, `unit_`, `expr_`, `stmt_`, `prag_`, `rec_`,
  `sym_`, `inh_`, `enum_`, `lib_ns_`, `mem_`, `ty_`, `lt_`, `ar_`, `cb_`, `cv_`, `ce_`, `dt_`.
- **The rule catalogue as data** lives in `test/frontend/rules.ts`: every §4 row as `{ id, area, home, fixtures, tests }`.
  `test/frontend/rules.test.ts` fails when a listed fixture does not exist, when a listed fixture is unrecorded, when a listed unit
  test title does not exist, or when the GAP count (per area and in total) differs from the pinned numbers in `tasks.md`. The pinned
  numbers are a ratchet: they may only fall.
- **Measurement harness (phase 0)** lives in `test/frontend/`: `parse-census.test.ts` (0.1), `fixed-point.test.ts` (0.2),
  `resolution-dump.test.ts` (0.3), `type-dump.test.ts` and `fold-dump.test.ts` (0.4). The dump builders live in
  `test/frontend/dumps.ts`, shared by these tests and by snapshot F. Each test has a committed baseline of findings. A new finding
  fails; a finding that disappears fails until it is removed from the baseline — the same "known divergence" discipline as the
  transpiler.
- **Front-end snapshot F** (task 1.3): `scripts/frontend-snapshot.ts write|check [--base <rev>]` writes to
  `test/frontend/.snapshot/<commit>/` (gitignored). It serializes, per source, with the builders from `test/frontend/dumps.ts`:
  - F-front: the AST (spans included), parse errors, `failedDeclarations`, the token stream; the resolution, type and fold dumps;
    the LSP diagnostics over the six corpora;
  - F-back: the emitted Rust and interpreter output of every conformance fixture.

  `check` compares the working tree against `--base` (default: the parent commit), built in a temporary git worktree (P9). Every
  phase-1 task must leave `check` identical.
- **The import gate** is `scripts/check-layering.ts`, extended, plus `test/frontend/layering.test.ts`, which runs it inside
  `bun test`:
  - the scanner covers `src/`, `test/`, `scripts/` and the top-level `libraries/` (today it scans `src/` only);
  - F1: nothing under `frontend/` imports outside `frontend/`, tests included;
  - F2: outside `frontend/`, only `frontend/<layer>/index.js` or `frontend/index.js` is imported (from `src/`, `test/`, `scripts/`
    and `libraries/`);
  - F3: within `frontend/`, the table "Import rules within the front-end": `library` imports nothing; `syntax` imports nothing
    outside `syntax` (not `library`); `symbols` imports `syntax` and `library`; `types` imports `syntax`, `symbols` and `library`;
  - F4: `ALLOWED_UPWARD` is empty;
  - `TRANSPILE_ALLOWED` becomes `{frontend}` (all four sub-layers, `library` included, through their indexes), so transpile's
    `library/index` import (1.25) is legal and no other layer is.

  Its known-violation list shrinks with each task and is empty at 1.41.

---

## 6. Review gaps and how this design closes them

The critic's review of the first draft listed 30 gaps. Each is closed below, or explained as not a gap.

| # | Gap | Resolution |
|---|---|---|
| G1 | `arith.ts` `exptResultType` unmapped; transpile/lower/builtins.ts imports it | → `types/builtins.ts` in task 1.6 (§3.1 `types/arith.ts` row, §3.2). The transpiler imports it by name through `types/index.js`, which keeps exporting it, so no transpile file changes. |
| G2 | `canonicalElem`, `elementaryType`, `isDuration`, `elementaryTypeRef`/`elementaryRef` unplaced; predicates list ended in "…" | Every `elementary.ts` export is placed in §3.1 (`canonicalElem` → platform; `elementaryType` stays in elementary; `isDuration` → predicates; the predicates list is complete). `elementaryTypeRef`/`elementaryRef` stay in `type.ts`. Transpile imports all of them through `types/index.js`, so 1.31 changes no transpile file (Index contents). |
| G3 | `canonicalElem` has no target, conflicting with a per-target platform (TY6) | §2 "The platform target": phase 1 keeps today's 64-bit answer (F proves it); 4.1.1 introduces `Target`, makes it a REQUIRED parameter of `canonicalElem` and every target-dependent function, so `tsc` finds every caller; the transpile `lowering.ts` call is a T hand-off (P6 row, 5.3). |
| G4 | `MULTI_CHAR_PUNCT`/`SINGLE_CHAR_PUNCT` unassigned; syntax-private candidates unlisted | Both → `lex/vocabulary.ts` (§2, §3.1). The private candidates are listed under "Index contents" (`syntax/index.ts` NOT on it) and handled by 1.40 for syntax as well as types. |
| G5 | `libraryRank` not exported, breaking F2 for corpus.test.ts and probe-ambiguous-uses.ts | Exported from the symbols index in 1.4 (P4 census, §3.1 precedence row). |
| G6 | symbols index contents unspecified (`memoByProject`, `dialectOf`, `forEachExpr`, `forEachDecl`, `bodiesAt`) | "Index contents": the rule (exactly what outside files import, census written at 1.4) and the named list, including all five. |
| G7 | the format surface of the syntax index unspecified | "Index contents" names `IMPLEMENTATION_KEYWORD`, `isRetiredComment`, `isNeverShown`, `implementationWords`, `statedLine`, `bodyReader`, `splitImplementation` and the network-header markers. |
| G8 | the export is `tokenAtOffset`; `token-at.test.ts` must move too | Name fixed throughout; the test → `services/shared/positions.test.ts` in 1.10 (P3, §3.1a). |
| G9 | F serializes dumps no task builds before 1.3; no owner for the fold dump | 0.4 builds the type dump AND the fold dump (`fold-dump.test.ts`); the builders live in `test/frontend/dumps.ts`; 1.3 depends on 0.3 and 0.4. |
| G10 | F-back changes under concurrent transpile work | P9: F is compared against the task's parent commit, built in a worktree, not against a stored baseline; a concurrent transpile commit sits on both sides of the comparison. |
| G11 | 1.12/1.22/1.37 collide with transpile edits in flight | P10 "Gate T" on every task that edits `src/transpile/`; the codemod is a committed re-runnable script. |
| G12 | `TRANSPILE_ALLOWED` lacks `library`; the scanner covers only `src/` | §5 import gate: the scanner covers `src/`, `test/`, `scripts/`, `libraries/`; `TRANSPILE_ALLOWED = {frontend}` (1.2 extends the scanner, 1.12 switches the set). |
| G13 | F3 wording allowed syntax → library | P2 diagram and F3 restated: `library` is a leaf reachable from `symbols`, `types` and consumers, never from `syntax`. |
| G14 | re-lexers missed: network-analyze:116, network-text/parser:1175, token-at | All three are in P6's default-dialect re-lexer row, assigned to C 2.1.4; task 2.1.4 names them. |
| G15 | network-text/parser's `BIT_STRINGS`, `COMPARISONS`, `BIT_OPERATORS` re-decide types | P6 row → `elementary.inTypeGroup("ANY_BIT")` + `arith/operators.OPERATOR_FUNCTIONS`; R 1.34 where identical, C 4.4 otherwise; §3.3 row. |
| G16 | analysis `nameResolves` holds the search order; no rule for device instances | P6 row → `types/names.resolveBareName`; device instances bound by the binder; rules Y23 (search order) and Y24 (device instances); task 3.1.5. Placed in `types/` because a step asks about built-in (type) names ("Why no member resolution in symbols"). |
| G17 | this-super-context compares `"THIS"`/`"SUPER"` itself; network-analyze `isPou` unlisted | Both in P6 and §3.3: `isSelfRef`/`selfRefKind` (R 1.15), `symbols/model.isPouScope` (R 1.27). |
| G18 | transpile/lower/constants.ts flattens namespaces by hand | **Not a gap.** A grep for `.units` recursion in `src/transpile/` (2026-09-29) finds none outside the Rust prelude's string `units` field. `constants.ts:103` is a namespace LOOKUP (`findChildScope(lw.project, ns.name)`), already in P6's T row for `ns.symbols.get` lookups and in the 5.3 hand-off. |
| G19 | 1.6 underspecified: infer asks reference for every catalog return type | P3 "1.6 in full": fixed return types move as data into `BUILTIN_RESULT`; derived (conversion) ones come from `parseConversionName` directly; acceptance: `grep lookupReference src/frontend` empty. |
| G20 | catalogue lacks `.ident`, `__POOL.POU()`, `lib0.lib1.sym`, `lib.gvl.var`, the search order, access modifiers | Rows E33, E34, LB8, LB9, Y23, M6; tasks 2.5.6, 3.1.5, 3.4.2, 3.5. (`__POOL` left L13.) |
| G21 | `UTF8#` missing; 2.2.2's real fixtures had no row | Rows S13 (task 2.2.6), N12a (capital E), N12b (`.5`/`5.`) (task 2.2.2). |
| G22 | pragma catalogue incomplete; `strict` missing | Rows P10–P16, and a paragraph classifying every `07-pragmas.md` attribute as front-end or consumer; tasks 2.7.1, 2.7.2, 4.5.1. |
| G23 | type rules missing (BIT restrictions, REFERENCE elements, generic ANY, VERSION, pointer arithmetic, auto-deref) | Rows TY12–TY15, DT13, DT14; tasks 4.1.3, 4.5.2, 4.7.4. |
| G24 | built-in result types missing | Rows AR22–AR31 with the fixtures that exist (ADR/BITADR, SIZEOF/XSIZEOF/INDEXOF, `__NEW`, `__ISVALIDREF`/`__QUERY*`, `__VARINFO`/`__POUNAME`, atomics, TRUNC, ABS/MOVE) and GAPs for UPPER/LOWER_BOUND and `TIME()`/`LTIME()`; task 4.3.4. |
| G25 | CAL/INI and `__TRY` recovery missing | Rows L15, ST18, ST19 (INI left L13's "unused" list); tasks 2.1.2, 2.6.3. |
| G26 | conformance tasks lack acceptance; no GAP=0 close for area 2; 2.4.7 lists no rules; U30 had no text | tasks.md defines the acceptance shorthand **CA** used by every 2.x/3.x/4.x task; new task 2.10 closes area 2 at GAP=0; the format rules are FMT1–FMT8 with text and named tests, and 2.4.7 lists them. |
| G27 | 2.9, 4.1.3, 4.5.3, 3.4.3, 2.4.7, LT14 had no named fixtures/tests | PR1–PR4 name their harness and test titles; 4.1.3 records TY12–TY15 fixtures and its acceptance is the 0.4 elementary findings being empty; the conversion matrix runs in 0.5 so 4.5.3's pair count is known and pinned; LB7 names its unit test; FMT rows name theirs; LT14 names `test/frontend/literal-agreement.test.ts`. |
| G28 | serial dependencies without cause | tasks.md dependencies are the real ones: areas 2, 3 and 4 start from 1.41 (+ the phase-0 dump each needs); the only cross-area edges are 3.1.2 → 1.8, 3.1.3 → 2.7.2 (`qualified_only` per unit), 4.5.1 → 2.7.2 (`strict`), 4.7.4 → 3.2.1 (interface scopes) and 3.1.5 → 2.5.6 (the `.ident` primary). The executor still runs in file order; the dependencies say what may be reordered. |
| G29 | test mapping only generic | §3.1a maps every front-end test file, including extends-ambiguity, library-symbol, incremental-rebind, literal-check, fuzz, aggregate, parser and folder-directive. `ambiguous-name.test.ts` goes to `types/resolve.test.ts`, not `symbols/`, which would have imported `types/` upward. |
| G30 | attribute copies: "7" but 6 enumerated; 1.23's list incomplete | P6 enumerates all seven sites; task 1.23 names all seven (including `workspace-refs.ts` and analysis `pragmas.ts`). |
