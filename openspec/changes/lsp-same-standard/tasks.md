## 0. Measure

- [x] 0.1 The census at HEAD: every file over its limit, every function over 80, every dead export, per area, with the
      network-text ones marked out of scope. Every `src/server/*`, `src/reference/*`, `src/workspace/*` file: what it is,
      who imports it, its target folder. Built-in hover coverage vs `ELEMENTARY_TYPES` + `BUILTIN_RESULT` + conversions.
      Measured at e26aafa0bf (design.md §1, the package's own `check-size`/`dead-exports` functions over `src` + `test`):
      - files: `src/` 19 over 400 (3 NT; frontend 13, analysis 3, server 1, services 1); colocated tests 3 over 600 (1 NT);
        `test/` suites 4 over 600; `test/` non-test 31 over 400 = 9 support + 21 fixture data + `map.generated.ts`
        (generated, exempt; the map is keyed by fixture name, so fixture-file splits are map-neutral).
      - functions over 80: 25 reported = 24 distinct (`checkIntrinsicOperands` counted twice, function + its arrow body);
        3 NT; 21 outside NT (frontend 12, analysis 7, server 1, transpile 1) — 7 of them not named in 4.1–4.3
        (`parsePostfix`, `inferExprType`, `evaluateCondition`, `parseInterface`, `parseInterfaceProperty`,
        `parseProperty`, `bindLibraryNamespaces`), assigned to their area's step in design.md §2.2.
      - dead exports: 72 raw (frontend 53, transpile 9, services 4, server 3, reference 2, workspace 1); 63 with the
        transpile scope's exclusions (its 9 are `ir/` types, the barrel surface); 17 NT; 46 non-NT = 21 union members
        (AST 17, `Type` 4) + 25 others. 63 more exports have no product caller (tests/scripts only; transpile 46).
      - test support in `src/`: `server/harness.ts`, `server/diagnostic-codes.ts` (tests only — task 2.1 keeps it in
        `server/`; design §2.3 moves it to `test/`), `analysis/test-uri.ts` (78 test importers); the 6
        `transpile/semantics/*.cases.ts` are colocated test data (admitted by suffix).
      - server/reference/workspace: 15 files inventoried (design.md §1.5). `workspace-store.ts` imports `server/config.ts`
        (upward once in `workspace/`): the flag is passed in. `docs/architecture.md` draws `reference` as layer F above
        services; `check-layering.ts` ranks it 3 (stale row confirmed).
      - hover: ELEMENTARY_TYPES 26/26, aliases 4/4, CODESYS-only 5/5, BUILTIN_OPERATOR_NAMES 67/67, BUILTIN_RESULT 13/13,
        conversions 702/702 (CODESYS; TwinCAT 552); missing 7: `THIS` `SUPER` `IOCONFIG_GLOBALS` `TYPE_CLASS` (implicits)
        and `__UXINT` `__XINT` `__XWORD` (platform integers; the service answers null on all 7). Side finding for 3.1:
        `builtinName("__UXINT")` is "system-operator" (the `__` test precedes the type test).
        Corrected by the step-0 review: the closed `__` list (17 vocabulary `__` keywords + 3 platform integers +
        `__SYSTEM` = 21) adds `__VECTOR` `__SYSTEM` → **9 missing** (design §1.6).
- [x] 0.2 design.md: the target per oversize file / long function (split by what), the folder moves, the review plan
      per area. Design first, then code. Written (§2 targets, §3 review plan). Defaults taken, open to the owner:
      reachability's computation → `analysis/` reverses analysis-conformance 1.4 (the suppression policy stays in
      `server/diagnostics.ts`); `diagnostic-codes.ts` and `test-uri.ts` → `test/`; the 21 fixture data files are held to
      400 and split within their concern folder; union members of any exported union are excluded from dead-exports
      (the transpile rule generalised).
- [x] 0.3 Step-0 review findings (7), fixed or written into design.md:
      - hover answered for built-ins the dialect lacks (`lookupReference` ignores the dialect: on TwinCAT `__POUNAME`,
        `__COMPARE_AND_SWAP`, `__POSITION`, `XSIZEOF` and ~150 LDATE/LDT/LTOD conversions). FIXED test-first:
        `assist.test.ts` "a built-in the project's dialect does not have answers nothing" red (4 of 4 hovered on
        TwinCAT), then `hover.ts` asks `builtinName(tok.text, dialectOf(project))` before the catalog — one dialect-aware
        path for both vendors. Of the 67 catalog names, 4 are refused on TwinCAT, 0 on CODESYS.
      - §1.6 counted closed lists only; `builtinName` is open on `__`: + `__SYSTEM` (240 corpus / 12 fixture files),
        `__VECTOR` (4 fixture files); §2.3's coverage test iterates the closed `__` list and asserts both directions.
      - §2.2 `messages/`: ONE builder per group slice with the `tc ?` switches kept inside the one template (no
        per-vendor builders — the vendors are identical on the Volt layer); slice keys disjoint by a type assertion so
        the composing spread cannot override.
      - `builtinName`'s open `__` test, broad form (`x := __NOSUCHTHING;` gets no "not defined"; statement position has
        no fixture; initializer position pinned by `cc_decl_init_dunder_unknown`; 0 unknown `__` names in the six
        corpora) → design §3 "known going in", decided in 3.1.
      - workspace-store's `ParseOptions` parameter REQUIRED, no default (§2.3).
      - `server.ts`/`diagnostics.ts` `../services/shared/index.js` → `../services/index.js` (already re-exports shared;
        §2.3), planned so the §2.1 structure gate is not red on an unplanned case.
      - fixture-data splits keep their rows' slot in `RAW_CATEGORIES`, so `ALL_TESTS` (the recorders' walk order) is
        unchanged (§1.1).
      Gate: `bun typecheck` clean; lint (layering, size, citations) green; fixtures and transpiler untouched (map not
      regenerated); full suite `VOLT_REQUIRE_FULL=1`, VOLT_FIXTURES unset: 9526 pass, 35 skip, 421 todo, 0 fail, 9982
      tests across 327 files (760 s).

## 1. Gates first (red where the code is not there yet)

- [x] 1.1 `check-size.ts` scope `src` + `test/` support, today's oversize files as shrink-only ceilings (network-text
      ones marked "LD/FBD change"); `dead-exports` over `src` in lint with today's list as a shrink-only allowlist.
      Done at fddcde2a6e: `check-size.ts` roots `src` + `test`, keys package-relative, `map.generated.ts` exempt by name;
      `CEILINGS` 56 (19 `src/` + 3 colocated tests + 4 `test/` suites + 30 `test/` non-test; NT 4: `network/parser.ts`
      1372, `network/lexer.ts` 414, `network-analysis.ts` 521, `network.test.ts` 1213); `FUNCTION_CEILINGS` 31 keyed
      `file#name` (25 `src` incl. `intrinsic-operands.ts#(anonymous)`, 6 `bound-census.ts`; NT 3) — a new long function
      now FAILS. `dead-exports.ts --gate` in `bun run lint`: 75 raw − 44 union members (`unionMembers`, any exported union,
      read from its declaration, keyed (name, file): AST 18, `Type` 4, NT 13, IR 9) − 2 (`IrUnOp`, `PathSegment`: `ir/`
      types) = 29 = `DEAD_EXPORT_ALLOWLIST` (25 non-NT + 4 NT); the gates' own lists AND planted tests
      (`dead-exports.ts`, `check-size.ts`, their `*.test.ts`) do not count as a use. Planted tests:
      `check-size.test.ts` (7), `dead-exports.test.ts` (6). (Corrected by the step-1 review: the first count, 72 − 41,
      was HEAD's — the planted test kept `IfStatement` `ForStatement` `IrLoad` `IrEval` alive.)
- [x] 1.2 Structure gate (`test/package/structure.test.ts`): no `src/` file is test support; `server/` imports only the
      indexes it dispatches through. Done: `testSupportInSrc` over `check-layering.ts`'s `importGraph` (one scanner;
      static + dynamic imports, tests included) — a `src/` file only tests import, or nothing imports, fails unless
      `*.test.ts`/`*.cases.ts`/`index.ts`/`bin.ts`; known 3 (`analysis/test-uri.ts` 78 importers,
      `server/diagnostic-codes.ts` 2, `server/harness.ts` 5) → 0 in step 2. Rule S1 in `check-layering.ts` (tests
      included): `KNOWN_SERVER_VIOLATIONS` 3 (`server.ts`, `diagnostics.ts`, `workspace-store.ts` →
      `services/shared/index.ts`) → 0 in 2.1. Planted tests in `structure.test.ts` and `layering.test.ts`.
- [x] 1.3 Step-1 review findings (3), fixed test-first:
      - `--gate` excluded by bare NAME across `src/` (a hand-listed transpile-surface name such as `IrValue` or
        `lowerSource`, dead anywhere in `src/`, went unreported). FIXED: exclusions are keyed (name, declaring file) —
        union members in their union's file, the surface only where `src/transpile/` declares it, `ir/` types in `ir/`.
        Red first: `dead-exports.test.ts` "an exclusion is bound to its declaring file" (a dead `IrValue`/`lowerSource`
        in `services/` → reported). The review's union-member repro (`Foo` in another file) does not reproduce: the
        union's own file mentions the word, so a namesake is never NOBODY under the textual rule (the over-count, safe
        direction); that half is pinned by the keyed `unionMembers` test.
      - the gates' planted tests counted as a use (`dead-exports.test.ts` plants `IfStatement` `ForStatement` `IrLoad`
        `IrEval`, all real exports). FIXED: `NOT_A_USE` adds `dead-exports.test.ts` and `check-size.test.ts`; red first:
        "the gates' own files, tests included, are not a use". Census corrected in 1.1 and design §5 (75 − 44 − 2 = 29;
        the allowlist is unchanged — all four are union members).
      - `KNOWN_TEST_SUPPORT_IN_SRC` matched the importer count, so a new test importing `test-uri.ts` tripped the gate.
        FIXED: the list names files only (`testSupportReport`, keyed by file; the count stays in the finding as
        information); pinned by "the test-support verdict is keyed by file".
      Gate: `bun typecheck` clean; `bun run lint` green (layering 3 known, size 56 files + 31 functions listed, dead
      exports 29 allowlisted, citations); fixtures and transpiler untouched (map not regenerated); full suite
      `VOLT_REQUIRE_FULL=1`, VOLT_FIXTURES unset: 9534 pass, 35 skip, 421 todo, 0 fail, 9990 tests across 327 files
      (769 s) — +8 tests over step 0 (the step's planted/gate tests).

## 2. Folders (output-neutral)

- [ ] 2.1 `server/`: reachability + dead-code equivalence → `analysis/`; `workspace-store.ts` → `workspace/`;
      `harness.ts` → `test/` support; `server/` = server, bin, config, index, diagnostics, diagnostic-codes.
- [ ] 2.2 `reference/` dissolved: attribute catalog → `frontend/` (beside pragma syntax), hover catalog →
      `services/assist/`; `check-layering.ts` reference rank and rule A1 updated; `src/index.ts` exports stable.
- [ ] 2.3 Every built-in has a hover entry (missing ones added); a test asserts it.

## 3. Review (services, server, workspace)

- [ ] 3.1 Review `services/` per area (assist, formatting, navigation, structure, shared) and `server/` + `workspace/`
      against the LSP behaviour tests and recorded fixtures: findings with severity and root cause.
- [ ] 3.2 Every finding fixed test-first, or filed with a reason; no LSP-only diagnostic introduced (parity rule).

## 4. Splits (output-neutral)

- [ ] 4.1 frontend: the lexer (`lex` by token class), the parsers (statements, expression, type-expr, declarations,
      units), `ast/nodes.ts`, `pragmas/conditional.ts`, `types/const/fold.ts`, `types/infer/expr.ts`,
      `symbols/scope-nav.ts`, `symbols/binder.ts`, `lex/vocabulary.ts` — each within 400, every function within 80.
- [ ] 4.2 analysis: `messages.ts` by check group, `checks/calls/call-arguments.ts`, the long check functions
      (`checkPragmas`, `checkHeaderRules`, `checkIntrinsicOperands`, `checkUnresolvedIdentifiers`, `operandSignWarnings`,
      `checkOneCase`).
- [ ] 4.3 server + services: `runServer` by request group, `services/formatting/print.ts`; the transpile leftover
      `lower/storage/layout.ts` `buildLayout`.
- [ ] 4.4 Tests: colocated tests over 600 split by subject; `test/` support files split by topic.
- [ ] 4.5 Dead exports at 0 (or the documented barrel surface); the size ceilings empty except network text; the function
      limit a failure.

## 5. Close

- [ ] 5.1 `docs/architecture.md` (tree, layers, the reference row), `test/README.md`, `scripts/README.md` current.
- [ ] 5.2 Network-text ceilings and their splits handed to the LD/FBD coverage change (memory note, and a line in its
      proposal when it is created).
- [ ] 5.3 `bun typecheck`, lint (layering, size, citations, dead exports) green, full suite cold green, fixture map
      unchanged except hover. Archive.
