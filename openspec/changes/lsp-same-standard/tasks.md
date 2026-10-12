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

- [x] 2.1 `server/`: reachability + dead-code equivalence → `analysis/`; `workspace-store.ts` → `workspace/`;
      `harness.ts` → `test/` support; `server/` = server, bin, config, index, diagnostics, diagnostic-codes.
      Done: `reachability.ts` + `dead-code-equivalence.ts` (+ test) → `analysis/reachability/`, read through
      `analysis/index`; `workspace-store.ts` (+ `workspace-store.test.ts`, `incremental-index.test.ts`,
      `dead-code-cache.test.ts`) → `workspace/`; `harness.ts` → `test/server/`, `diagnostic-codes.ts` →
      `test/corpus/support/`, `analysis/test-uri.ts` → `test/support/` (its 78 importers re-pointed). Structure known
      3 → 0 (`KNOWN_TEST_SUPPORT_IN_SRC` empty), S1 known 3 → 0 (`KNOWN_SERVER_VIOLATIONS` empty).
- [x] 2.2 `reference/` dissolved: attribute catalog → `frontend/` (beside pragma syntax), hover catalog →
      `services/assist/`; `check-layering.ts` reference rank and rule A1 updated; `src/index.ts` exports stable.
      Done: attribute lists + `isKnownAttribute` → `frontend/syntax/pragmas/known-attributes.ts` (out through
      `syntax/index`); `reference.ts` + directive texts → `services/assist/builtin-hover.ts`; the `reference` rank, rule
      A1 and its planted test deleted; `src/index.ts` drops the `reference` re-export (design §6). Dead-export allowlist
      29 → 25 (`ReferenceKind`, `ReferenceEntry` file-private, `Harness` out of `src/`, `COMPILER_IMPLICITS` now read;
      `normalizeKey` re-keyed to `workspace/`). Departures from design §6, kept: the entry is
      `builtinHover(doc, project, offset)` — not `(name, dialect)` — because the PLACE decides too (`THIS` in a FUNCTION,
      review finding 6a) and the target decides a platform integer's width (finding 4), and both hover paths need the
      same three facts; the pragma entry kept its name `pragmaHelp(word, dialect)` (hover and completion detail).
- [x] 2.3 Every built-in has a hover entry (missing ones added); a test asserts it.
      Done: the 9 of design §1.6 (`THIS` `SUPER` `IoConfig_Globals` `TYPE_CLASS` `__UXINT` `__XINT` `__XWORD`
      `__VECTOR` `__SYSTEM`); `builtin-hover.test.ts` per dialect, both directions, THROUGH `hover()` (one bound
      document, one FB per name) over §1.6's sets and the closed 21-name `__` list; network-text `__POUNAME` on
      TwinCAT answers nothing (red first).
- [x] 2.4 Step-2 review findings (6), fixed test-first:
      - `builtin-hover.test.ts` had weakened the old `reference.test.ts` (kind and `returnType` no longer asserted,
        `toBe` → `toContain`). FIXED: the hover now renders what an entry IS (`_operator · returns REAL_`,
        `_data type · 16-bit signed int · range …_`), and the test asserts exact hovers again (`INT`, `MOD`, `SQRT`,
        `INT_TO_REAL`, `to_real`, `TO_SINT`, `TRUNC`), every `BUILTIN_OPERATOR_NAMES` name hovering as an operator or a
        standard function, and every `BUILTIN_RESULT` entry showing its result type. The other direction (no catalog
        operator outside the set) is refused when the module loads, which let `catalogNames` — a dialect-blind name list
        on the surface — go.
      - `returnType` was dead data. FIXED: rendered ("returns STRING" on `__POSITION`, "returns DINT" on `TRUNC`); the
        comments in `builtins.ts` and `builtin-hover.ts` are true again.
      - `pragmaHelp` took `Object.prototype` keys for directives (`{constructor}` hovered "function Object() …").
        FIXED: `Object.hasOwn`; red first: "an inherited object key is no directive".
      - A platform integer hovered "LINT on a 64-bit target" whatever the project's target. FIXED: the width is the
        target's (`canonicalElem`: "DINT on this target (32-bit pointers)"), and an unmeasured target says "width
        unknown" instead of a guessed one.
      - The `pragma_conflicting_pair` note cited a mutually-exclusive list in `known-attributes.ts` and a
        `pragmaConflict` check; neither exists, and the hover file claimed an `unknown-pragma` lint reads `DIRECTIVES`.
        FIXED: the note says what the recordings hold (TwinCAT clean; CODESYS warns `pingroup` placement only — not a
        pair rule) and the hover comment no longer names a lint. Map unchanged (notes are not in it).
      - (a) `THIS`/`SUPER` hovered in a FUNCTION/PROGRAM and `SUPER` in a base-less FB, where the analysis reports them.
        FIXED: the rule has one home, `frontend/symbols/self-ref.ts` (`instanceless`, `declaresNoBase`,
        `selfRefAllowed`), read by `this-super-context` and by `builtinHover`; red first: "THIS and SUPER hover only
        where they mean something". (b) the coverage test now runs through the service (above). `catalogNames` gone (above).
      Also: `scripts/check-layering.test.ts` rule 6 still asserted "a test file too", the rule 2.1 relaxed on purpose
      (test support lives under `test/`, so a colocated test imports it; `dist/` excludes tests) — the test now names
      the product file only.
      Gate: `bun typecheck` clean; `bun run lint` green (layering 0 known server/test-support violations, size 56 files +
      31 functions listed, dead exports 25 allowlisted, citations); `rate:fixtures` run — map unchanged; full suite
      `VOLT_REQUIRE_FULL=1`, VOLT_FIXTURES unset: 9543 pass, 35 skip, 421 todo, 0 fail, 9999 tests across 327 files
      (703 s) — +9 tests over step 1.

## 3. Review (services, server, workspace)

- [x] 3.1 Review `services/` per area (assist, formatting, navigation, structure, shared) and `server/` + `workspace/`
      against the LSP behaviour tests and recorded fixtures: findings with severity and root cause.
      Read through design §7's lens first (a vendor difference is data from one fact, decided once), then §3's per-area
      checks. 16 findings (W = wrong answer, M = missing answer, S = structure):
      - R1 (W, server): the vendor was a silent default, decided five times — `bin.ts` read "no `--twincat`" as codesys,
        `runServer(vendor = "codesys")`, `resolveConfig` (`auto`/unset → codesys), `parseDocument`/`buildSymbolTable`
        (dialect = codesys). The Claude Code plugin launches `--stdio` with no flag, so every TwinCAT workspace there was
        analysed as CODESYS (`__POUNAME` hovered, CODESYS wording).
      - R16 (S, outside the package): a second and third vendor decision — volt-vscode `resolveVendor` (unbound →
        codesys) and volt-control `collectDiagnostics(root, vendor = "codesys")`, which also sent a dead
        `initializationOptions.vendor` the server never read; the desktop read the binding to pass it.
      - R13 (S, analysis): `computeDiagnostics`' `isResolved` tested a `warnings` field `ResolvedConfig` does not have —
        always false, every config re-resolved; the optional `config` was what let `resolveConfig()` default the vendor.
      - R2 (W, data-corrupting, formatting + server): range formatting edited `unit.span`, which ends BEFORE a POU's
        `END_…` keyword and starts AFTER its attributes, while the printer writes both — Format Selection left a second
        `END_FUNCTION_BLOCK` (and a second `{attribute}`). On-type formatting ran that range formatting on every `;` and
        newline, while `formatOnType` (the auto-indent written and tested for the request) had no product caller.
      - R7 (W, protocol): a range end past its line or the text read as a cursor position (-1): a whole-document range
        (semantic tokens, inlay hints, range formatting) answered nothing. LSP clamps. The positions header said "byte
        offset"; columns are UTF-16 code units on both sides (LSP's default) — correct code, wrong comment, now pinned.
      - R3 (M, server/workspace): the watcher globs were a hand list beside the scan's own and had lost `.projectsettings`
        — a pull changing only the project's compiler-warning settings was never re-read.
      - R4 (W, frontend fact read by hover + semantic tokens): `builtinName` applied the CODESYS-only types to
        conversions only, so a bare `LDATE` was a type on TwinCAT (hover "64-bit date", painted as a type), and semantic
        tokens asked a dialect-blind `isKnownPrimitive`.
      - R8 (S, frontend, the census's side finding): `builtinName("__UXINT")` was "system-operator" (the `__` test ran
        before the type test).
      - R5 (W, navigation): renaming a library element edited its read-only materialization under `Library Manager/` and
        every use. Root: the shipped rename (`network-services` `*Anywhere`) had no rule for it, and the tests ran the
        ST-only `rename`/`prepareRename`/`references`/`documentHighlights` in `navigation.ts` — copies with no product
        caller, so the tested path was not the shipped one.
      - R6 (W, navigation): any `newName` was written over every occurrence (`IF`, `1x`, `a__b`, `INT`).
      - R12 (W, protocol): a multi-line token (block comment) went out as ONE token of its whole length on its first
        line; LSP allows that only to a client stating `multilineTokenSupport` (VS Code does not). Also a `?? 1`
        ("variable") fallback for a token type outside the legend.
      - R15 (S/perf, workspace): the scan walked `.git` (every object, on every watched-file event); nothing in it is an
        item of the workspace (the CLI keeps only `config.json`/`ide-refs.json` there).
      - R14 (S): `documentDiagnostics`' doc comment sat on the `VoltDiagnostic` type.
      - R9 (W, analysis, design §3 "known going in"): `builtinName` accepts ANY `__` name, so `x := __NOSUCHTHING;` gets
        no "not defined". Corpora counted 2026-10-12: every `__` word in the six corpora is a listed one (`__XWORD` 1579,
        `__SYSTEM` 412, `__POUNAME` 308, `__VARINFO` 248, `__UXINT` 193, `__XINT` 70, `__ISVALIDREF` 50, `__TRY`/`__CATCH`/
        `__ENDTRY` 36, `__QUERYINTERFACE` 35) — 0 unknown. The statement position has no recorded fixture.
      - R10 (S, server): one `CODESYS_CODE_MAP` (CODESYS codes and doc URLs) for both vendors; neither recording holds a
        code (design §7), so nothing decides TwinCAT's column.
      - R11 (M, assist): signature help answers nothing for a built-in call (`LIMIT(`, `SEL(`, `MAX(`): no parameter
        catalog exists for the built-ins (the hover catalog has text, not parameters).
      Checked, no finding: completion (attribute names per dialect; keywords common to both), inlay hints and signature
      help for user callees (`resolveCallee`), code actions (`TO_<T>` of an elementary the dialect has), code lens,
      folding, selection, workspace symbol, push vs pull exactly once and refresh after re-index (`server.test.ts`),
      capability↔handler parity (`server.test.ts` covers every advertised provider), open buffer over disk, incremental
      index equivalence. `implementation` matches `IMPLEMENTS` by name and does not follow EXTENDS — a missing answer
      not measured against the IDE, left for the services split (4.3).
- [x] 3.2 Every finding fixed test-first, or filed with a reason; no LSP-only diagnostic introduced (parity rule).
      - R1 FIXED: the server decides the vendor once, at `initialize` (`server/vendor.ts`): the flag, else the first
        bound folder's binding (`workspace/binding.ts`, the C# `WorkspaceConfig` shape pinned), else a refusal by name
        (`InitializeError`, "no vendor: … `volt init --vendor <codesys|twincat>`, or … --codesys|--twincat"). `bin.ts`
        passes the flag or none (both flags: usage error); `runServer(input, output, flag, version)` no default;
        `resolveConfig` takes `vendor: Vendor` (no `VendorSetting`/`auto`); `parseDocument` and `buildSymbolTable` take
        the dialect required (251 call sites state it, all tests that had relied on codesys; `types/system.ts` states
        it with its reason). Red first: `server/vendor.test.ts` (TwinCAT binding, no flag → `__POUNAME` hovers nothing;
        no binding → refused; multi-root → first bound folder; the flag wins), `workspace/binding.test.ts`.
      - R16 FIXED: volt-vscode `auto` passes no flag (`vendor.ts` + test deleted, setting text says the server refuses an
        unbound window); volt-control `collectDiagnostics(root, opts)` passes none (e2e binds its workspaces, run green);
        the desktop no longer reads the vendor to pass it. The Claude plugin unchanged; `agents.mdx` says to open a bound
        folder.
      - R13 FIXED: `isResolved` deleted, `config` required, resolved once.
      - R2 FIXED: `formatRange` replaces exactly what the printer writes (`reprintedRange`: attributes through `END_…`);
        on-type calls `formatOnType`, trigger `\n` only. Red first: `format.test.ts` "applying the edits to formatted text
        changes nothing, for every unit kind" + "…several units…", `server/on-type-formatting.test.ts`. The request half
        of `print.ts` moved to `formatting/format.ts` (print.ts 465 → 355, its ceiling removed — the gate forbade growth).
      - R7 FIXED: `clampedOffset` for range ends (range formatting, semantic-token and inlay-hint ranges);
        `server/ranges.test.ts` red without it; `positions.test.ts` pins UTF-16 columns.
      - R3 FIXED: `SCANNED_EXTENSIONS` (workspace-refs) is the one list; the server watches exactly it
        (`server/watched-files.test.ts`).
      - R4 + R8 FIXED at the fact: `builtinName` — a type only where the dialect has it, platform integers are types;
        `isKnownPrimitive(name, dialect)` reads it. Red first: `semantic-tokens-primitives.test.ts` "a type name the
        dialect lacks…"; pinned in `builtins.test.ts`. Conformance replay + corpus green: no LSP-only finding.
      - R5 FIXED: `renameTarget` (network-services) refuses a library symbol for prepare and rename; the ST-only copies
        in `navigation.ts` deleted, their tests run the shipped `*Anywhere` path. Red first: `navigation.test.ts`.
      - R6 FIXED: `renameRefusal(newName, project)` — one identifier the dialect's declarations accept — answered as a
        `RequestFailed` naming the name (`navigation.test.ts`, `server/rename.test.ts`).
      - R12 FIXED: one token per line; the legend typed (`TokenType`), no fallback index.
      - R15 FIXED: `walkFiles` skips `.git` (`workspace-refs.test.ts`). R14 FIXED.
      - R9 FILED: niche: accepted loss (0 occurrences in the corpora). Not recorded: a statement-position fixture on both
        vendors is a recorder run for a name no corpus writes.
      - R10 FILED: niche: accepted loss (0 codes in the recordings).
      - R11 FILED, not niche: a feature (a measured per-dialect parameter catalog for the built-ins), not a defect
        against a recording — for a follow-up change.
      No recorder run: no finding changed a compiler-observable answer except R4 on TwinCAT (bare `LDATE`), and the
      conformance replay stayed green on it. Ceilings: `server.ts` 623 → 618, `runServer` 486 → 453, `print.ts` removed;
      dead-export allowlist 25 (re-keyed `FormatOptions` → `format.ts`).
- [x] 3.3 Step-3 review findings (7), fixed test-first or filed:
      - Formatting deleted comments (high): a unit is reprinted from its AST, which holds none — every comment in a
        declaration (`i : INT; // counter`, a STRUCT member's, a GVL's) and, in Format Document, every comment between
        units or before the first. The corpus gate compares `astKey`, which carries no comments. FIXED: `format.ts`
        `reprint` keeps a unit AS WRITTEN when the reprint lacks a comment or pragma of its text (checked in order against
        the printed text, as the printer writes it — a CRLF line comment ends in `\r`, which made the formatter
        non-idempotent on 3 corpus files until compared trimmed); `formatDocument` keeps the text between units as written.
        Also found on the way: an attribute an interface carries from INSIDE it (a property's) was taken as the unit's
        start, so the range edit began inside the unit and the source's `INTERFACE I` header stayed beside the reprint
        (range formatting since R2; Format Document after this fix, caught on 30 pro2193 `.itf` files). Red first:
        `format.test.ts` "…every comment in a declaration and between units…", "…CRLF file decides each unit as its LF
        form does", "…interface whose member carries an attribute keeps one header…". Side note, not fixed here: the
        parser attaches that member attribute to the INTERFACE, so a reprinted interface moves it before
        `INTERFACE` — a meaning change the AST gate cannot see (filed for the services split, 4.3).
      - R4's TwinCAT bare `LDATE` (medium): 3.2 said the conformance replay "stayed green on it" — green only because no
        fixture covers the position. FILED: niche: accepted loss (0 occurrences in the corpora — the only 4 uses of
        `LDATE|LTOD|LDT|LTIME_OF_DAY|LDATE_AND_TIME` are a return type in AlarmManager's `CONVERTTIMESTAMPTOLDATEANDTIME`
        in the four CODESYS corpora; twincat-project14 has none). The new answer agrees with the recorded one in the
        declaration position (`Unknown type`); the expression position stays unrecorded.
      - Flag vs binding (medium): the flag won silently (a user-scope `volt.iec.vendor` analysed a TwinCAT-bound
        workspace as CODESYS). FIXED: `server/vendor.ts` `servedWorkspace` refuses a flag that contradicts the binding,
        naming both; `vendor.test.ts` "the flag is never second-guessed" replaced (its premise contradicted design §7:
        one fact, a conflict fails loud) by "agrees → served", "no binding → the flag", "contradicts → refused".
      - Worktree / submodule binding (low): FIXED in both readers — `.git` as a FILE is followed to the git dir its
        `gitdir:` line names (the CLI's `git rev-parse --absolute-git-dir`); volt-control `readBridgeVendor` now refuses a
        malformed binding by name as `binding.ts` does (it read it as unbound). Red first: `binding.test.ts`,
        volt-control `bridge/health.test.ts`.
      - Vendor and crawl from two folders (low): FIXED — `servedWorkspace` returns the vendor AND the root, the bound
        folder for both; `vendor.test.ts` "the folder the vendor is read from is the folder crawled".
      - Corpus read as CODESYS (low): FIXED — `corpusVendor(dir)` (the one `expected-build.<vendor>.json`, else throws)
        parses, format-round-trips and diagnoses each corpus project in its vendor; lowering re-reads it in
        `EXEC_ORACLE_DIALECT` (`loweringProject`). `parseSource`'s `dialect = "codesys"` default removed: 438 call sites
        state it (mechanical, behaviour-neutral); the transpiler's two say `EXEC_ORACLE_DIALECT`.
      - CRLF range formatting (low): FIXED — range edits are written in the file's line ending (`inLineEndingOf`); red
        first: "range formatting a CRLF file leaves no mixed line endings".
- [x] 3.4 Step-3 gate review findings (4), fixed test-first:
      - Interface member attribute moved above `INTERFACE` (high — 3.3's "side note" was not niche: 5 pro2193 `.itf`
        files). FIXED: `format.ts` `reprint` keeps a unit as written when it carries an attribute from inside it (the
        test `reprintedSpans` already made). Red first: `format.test.ts` "…keeps an interface member's attribute on the
        member…". Corpus sweep after the fix (formatDocument over all six corpora, 29170 files, attribute vs unit-header
        line order): 0 moved, 0 non-idempotent.
      - Five readers of the binding, two following worktrees (medium). FIXED: volt-control `health.ts` exports the one
        resolver (`bindingFile`, over `voltStateDir`); `hasVoltConfig` (volt-vscode), `VoltStatus.refresh`
        (volt-control), `volt.openConfig` (volt-vscode, refuses by name outside a git repo) and a sixth the gate found
        — `readStateMtime` (`ide-refs.json`, volt-control `state/files.ts`) — read through it. Red first:
        `bridge/health.test.ts` "the binding file is named once…" (the resolver, and no `".git", "volt"` path left in
        volt-control/-vscode/-desktop src outside it).
      - Half-written binding read as malformed (low). FIXED at the writer: C# `Config.SaveConfig` writes a temp file and
        renames it over the binding (Windows refuses to replace a file a reader holds open, so the rename retries for up
        to 2 s, then fails loud with the temp removed). Red first: `DomainTests.SaveConfig_never_shows_a_reader_a_partial_file`
        (a Node-like reader over 2 s of rewrites saw empty files before).
      - Comment matched inside a string literal (low). FIXED: `dropsCommentary` matches the source's comment and pragma
        tokens, in order, against the printed text's own comment and pragma tokens (lexed in the document's dialect).
        Red first: "…keeps a declaration comment whose text also stands in a string literal".
      Also found by the gate: `bun run check` (scripts/check-wiring.ts) still looked for the watcher list in `server.ts`;
      since R3 it is `SCANNED_EXTENSIONS` in workspace-refs.ts — the check reads it there (18 passed).
      Gate: `bun typecheck` clean (root `bun run typecheck` too); package `bun run lint` green (layering, size 55 files +
      31 functions listed, dead exports 25 allowlisted, citations); root lint exit 0; `rate:fixtures` run — map unchanged
      (edge agree 3261, disagree 0); full LSP suite `VOLT_REQUIRE_FULL=1`, VOLT_FIXTURES unset: 9578 pass, 35 skip,
      421 todo, 0 fail, 10034 tests across 333 files (750 s) — +35 tests over step 2. volt-control 137 pass, volt-vscode
      35 pass, volt-desktop 31 pass; `dotnet test test/Volt.Cli.Tests/` 265 pass.

## 4. Splits (output-neutral)

- [x] 4.1 frontend: the lexer (`lex` by token class), the parsers (statements, expression, type-expr, declarations,
      units), `ast/nodes`, `pragmas/conditional.ts`, `types/const/fold.ts`, `types/infer/expr.ts`,
      `symbols/scope-nav.ts`, `symbols/binder.ts`, `lex/vocabulary.ts` — each within 400, every function within 80.
- [x] 4.2 analysis: `messages` by check group, `checks/calls/call-arguments.ts`, the long check functions
      (`checkPragmas`, `checkHeaderRules`, `checkIntrinsicOperands`, `checkUnresolvedIdentifiers`, `operandSignWarnings`,
      `checkOneCase`).
- [x] 4.3 server + services: `runServer` by request group, `services/formatting/print.ts`; the transpile leftover
      `lower/storage/layout.ts` `buildLayout`.
- [x] 4.4 Tests: colocated tests over 600 split by subject; `test/` support files split by topic.
- [x] 4.5 Dead exports at 0 (or the documented barrel surface); the size ceilings empty except network text; the function
      limit a failure.
- [x] 4.6 Step-4 gate review findings (3):
      (1) Two comments cited the deleted `messages.ts` (test/conformance/lsp-replay.test.ts, support/divergences-triage.ts)
      — re-pointed to `src/analysis/messages/`. Comment only, no test can be red for it.
      (2) SKIPPED, by design: `record-corpus-build.ts`'s `_doc` names `test/corpus/corpus-diagnostics.test.ts` while the
      committed `expected-build.codesys.json` recordings still say `corpus.test.ts`. Recordings are never hand-edited;
      the string follows on the next re-record. No diagnostic data is affected.
      (3) No action: the independent DATA-lens check found no output difference (22,636 fuzzed sources x both vendors,
      8,000 multi-file projects, 6,552 message-builder calls: 0 diffs; moved test data equal; titles unchanged).
      Gate: `bun typecheck` clean (root `bun run typecheck` too); package `bun run lint` green (layering; size 4 files +
      3 functions listed, all network text — was 55 + 31 after step 3; dead exports 4 allowlisted, all network text — was
      25; citations); root lint exit 0; root `bun run check` 18 passed; `rate:fixtures` run — map unchanged (edge agree
      3261, disagree 0); full LSP suite `VOLT_REQUIRE_FULL=1`, VOLT_FIXTURES unset: 9582 pass, 35 skip, 421 todo, 0 fail,
      10038 tests across 343 files (716 s) — +4 tests over step 3, none removed. volt-control 137 pass, volt-vscode 35
      pass, volt-desktop 31 pass.

## 5. Close

- [x] 5.1 `docs/architecture.md` (tree, layers, the reference row), `test/README.md`, `scripts/README.md` current.
      Checked against the disk at 29eed113a6 (every backticked path in the five docs resolved; the tree already held by
      `test/package/structure.test.ts`, the reference row already `services/assist/builtin-hover`). Fixed:
      architecture.md — G `server/` rewritten for step 4 (`runServer` + one `ServerState` + the seven `handlers/` groups,
      rule S1, the dead-code suppression in `diagnostics`), the front-end's stale consumer list (`network`,
      `network-text`, "top-level workspace modules"), D's `messages` → `messages/` slices, the size paragraph (ceilings =
      network text alone, nothing in `transpile/`), `binding` in the stack's W row. test/README.md — the corpus and
      transpile-replay splits (one walk `corpus/support/walk.ts`, one selection, `replay-steps.ts`), the split support
      parts (`rules-a…p`, `dumps-*`, `bound-census-*`, `census-fixtures/-owners`, `baseline-a/-b`), `server/sources.ts`,
      `support/call-diagnostics.ts`; "six files" dropped. TESTING.md — the same, the stale "96" colocated tests (286
      now; the count dropped, it rots), the `VOLT_FIXTURES` line naming all five contract files. scripts/README.md —
      `record-corpus-build` → `corpus-diagnostics.test.ts`, `probe-lowering-refusals` → `corpus-lowering.test.ts`, the
      `check-size` / `dead-exports` rows say the lists hold network text alone since 4.5. Docs only; no code, test,
      fixture or recording touched.
- [x] 5.2 Network-text ceilings and their splits handed to the LD/FBD coverage change (memory note, and a line in its
      proposal when it is created). No LD/FBD coverage change exists yet under `openspec/changes/`, so the hand-over is
      the memory note `support-all-ld-fbd.md` (rewritten from the step-0 numbers to the measured state after step 4):
      files 4 (`syntax/network/parser.ts` 1372, `syntax/network/lexer.ts` 414, `checks/network/network-analysis.ts` 521,
      `services/network/network.test.ts` 1213 — each at its ceiling), functions 3 (`parseNetwork` 101, `parseCall` 90,
      `next` 95), dead exports 4 (`TokKind`, `CONSTRUCT_WORDS`, `v1Refusal`, `resolveAnywhere`), with the instruction
      to put one line naming them in that change's proposal when it is created. `bun run lint` green (size: 4 files +
      3 functions listed; dead exports: 4 allowlisted).
- [x] 5a Step-5 gate review findings (3, all docs, all correct), fixed:
      - test/README.md "One walk per input" said all three corpus suites ask every question of the one parse. That is
        false for question 2. `corpus-diagnostics.test.ts` never calls `pass()`. It asks of the one shared LSP diagnostic
        pass (`corpus/support/diagnostics.ts` `projectDocuments()`: its own store, cached per project and vendor), as the
        `corpus.test.ts` header says. Rewritten, and TESTING.md's corpus tree lines say the same. (5.1's record line "one
        walk `corpus/support/walk.ts`" meant the same mistake; this entry corrects it.)
      - TESTING.md never got the transpile-replay split. The routing table, the conformance paragraph and the `test/`
        tree now name `transpile-replay-lowered.test.ts` and `transpile-replay-refusals.test.ts`. The tree's frontend/
        entry now names `rules-a…p`, `dumps-*` and `bound-census-*`. The analysis/ entry now names `census-fixtures` /
        `census-owners`, and the baseline/ entry `baseline-a/-b`. test/README.md's "One selection" paragraph now lists the
        five contract files. Checked against the imports on the way: `support/fixture-suite.ts` is shared by four of the
        five (not `-refusals`), and `support/transpile/replay-steps.ts` by `transpile-replay` and `-lowered`. The
        docs now say that, where the old "the three share" was wrong.
      - architecture.md G: the `documents` handler group now lists didOpen (`handlers/documents.ts` line 17).
      Gate: `bun typecheck` clean; `bun run lint` exit 0 (warnings only). Full LSP suite with `VOLT_REQUIRE_FULL=1`,
      `VOLT_FIXTURES` unset: 9582 pass, 35 skip, 421 todo, 0 fail (10038 tests across 343 files, 722 s). No fixture,
      transpiler or recording change, so the fixture map was not regenerated. Docs only.
- [ ] 5.3 `bun typecheck`, lint (layering, size, citations, dead exports) green, full suite cold green, fixture map
      unchanged except hover. Archive.
