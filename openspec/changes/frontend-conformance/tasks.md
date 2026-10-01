Execution: `.claude/workflows/execute-change.js` with `{ change: "frontend-conformance" }` (or "run the
frontend-conformance workflow"). Resumable: it skips ticked tasks. Every step: test-first; the FULL suite green
(packages/volt-lsp-iec `bun test`, plus `bun run check` at the repo root); the map regenerated; the step's numbers
written under its task. Oracle: CODESYS recordings, written only by the recorders.

**Format.** Every task is one `- [ ] <id> <what>` line, followed by `Where:`, `Acceptance:` and `Depends on:` continuation lines.
Paths are relative to `packages/volt-lsp-iec/`; from 1.12 on, `syntax/`, `symbols/`, `types/`, `library/` mean
`src/frontend/<that>/`. Rule ids (L1, N2, Y23, …) are design.md §4. P6/P9/P10 are design.md §1.

**Acceptance shorthands.**
- **F:** `bun scripts/frontend-snapshot.ts check` is identical against the task's base commit (design.md P9), and
  `bun scripts/suite-snapshot.ts --compare` is identical.
- **Gate T** (tasks that edit `src/transpile/`): design.md P10 — `src/transpile/` is clean at the start and no other run is editing it;
  only the named transpile edits, in this task's commit; paths via `scripts/codemod-frontend-paths.ts`.
- **CA** (every conformance task in 2.x, 3.x, 4.x):
  1. every fixture the task names exists and is recorded (`record:language` and/or `record:exec`, `RECORD_ONLY=<fixture>`);
  2. each disagreement was first pinned as a known divergence (red), then fixed test-first in the home design.md §4 names, and its
     mark removed; a disagreement NOT fixed in the task stays a known divergence and is written under the task;
  3. `rules.test.ts`: the GAP count of the task's rule ids falls by exactly the rows the task closes, and the pinned numbers in 0.5
     are updated in the same commit (they may only fall);
  4. the F diff (`frontend-snapshot.ts check`, printed, not required identical) touches only sources containing the task's rules;
     every other difference is a regression and is fixed;
  5. written under the task: fixtures recorded, divergences opened/closed, GAP count before → after, F-diff file count.

## 0. Measure (mechanical, no judgement)

- [x] 0.1 Parse every corpus file, fixture source and library body. Table: files CODESYS builds (build recordings)
      vs LSP parse errors; every LSP parse error without a recorded CODESYS error is a finding.
      Where: test/frontend/parse-census.test.ts (+ committed baseline). Acceptance: table written here. Depends on: —
      **Measured 2026-09-30** (`test/frontend/{sources,dumps}.ts`; baseline `test/frontend/baselines/parse-census.json`). A parse
      error is both passes (declarations + every ST statement body), worded per vendor as `checks/syntax/parse-errors.ts` words
      it; it matches when the vendor's build recorded the same normalized message. Fixtures are parsed once as CODESYS against
      `codesys.build.json`, once as TwinCAT against `twincat.build.json`; `twincat-project14` is parsed as TwinCAT.

      | source | vendor build | files / fixtures | LSP parse error | matched | findings |
      |---|---|---|---|---|---|
      | corpus CodesysTestProject, awa-palletizer, bakon-nano, lenze-mid, pro2193 | CODESYS, succeeded | 816 + 6292 + 6460 + 7599 + 7759 | 0 | — | 0 |
      | corpus twincat-project14 | TwinCAT, succeeded | 244 | 0 | — | 0 |
      | fixtures, CODESYS | builds | 2062 | 0 | — | 0 |
      | | refuses | 575 | 26 (549 without) | 46 errors | 3 |
      | | unrecorded | 146 | 0 | — | 0 |
      | fixtures, TwinCAT | builds | 2001 | 0 | — | 0 |
      | | refuses | 634 | 42 (592 without) | 80 errors | 6 |
      | | unrecorded | 148 | 6 | — | 42 |
      | library repo bodies | none (Volt's) | 50 | 0 | — | 0 |

      **51 findings**: 3 CODESYS (`cc5_deprecated_functionblock_keyword`, `pwh_gvl_then_prose`, `pwh_struct_then_prose` — the LSP's
      "unexpected identifier … at file scope" is not CODESYS's wording), 6 TwinCAT on recorded refusals (the same three, and
      `ldate_ltod_ldt`'s PLC_PRG: the L-date literals lex apart on TwinCAT), 42 TwinCAT on 6 fixtures TwinCAT never recorded
      (`tr_12_fmt_long_dates`, `xf_l*_call_once`: the same L-date literals). The other direction: 64 CODESYS and 88 TwinCAT refusals
      carry a syntax-shaped message ("expected", "Unexpected token") where the LSP has no parse error at all — counted here,
      and since 0.6's review pinned as one finding line each too (see 0.6).
- [x] 0.2 Printer/formatter fixed point on everything parsed in 0.1; every non-fixed-point file is a finding.
      Where: test/frontend/fixed-point.test.ts (+ baseline). Acceptance: finding count written here. Depends on: 0.1
      **Measured 2026-09-30** (baseline `baselines/fixed-point.json`). Two printers: the formatter (`format(x)`, re-parsed as the
      same source object — its uri — carries no parse error `x` does not already carry, parses to the same AST, and
      `format(format(x)) === format(x)`) and `exprText` (every maximal expression re-parses and prints the same).
      **23 files, 23 findings**: corpus 3 of 29 170 files (`expr-reprint-fails`: an inline assignment `(x := v)` printed without
      its parentheses); fixtures 20 of 5 566 (14 `format-ast-changed` — the printer drops an alias/enum type-level initializer,
      a function's misused EXTENDS/IMPLEMENTS, an interface's stray VAR section, FB EXTENDS A, B, and turns
      `cc_decl_init_trailing_int`'s broken initializer into a clean one; 6 `expr-reprint-fails` — partial access `%W0` and
      `__CURRENTTASK`); library 0 of 50; 0 `format-reparse-errors`. Idempotence held everywhere. (Review 2026-09-30: a first
      count of 25 held two test artifacts — a `.struct` re-parsed without its uri, and a fixture's own parse error reproduced.)
- [x] 0.3 Resolution dump: every identifier occurrence → its declaration (or none). LSP "not defined" / "ambiguous" /
      "no member" messages vs the recorded ones, both directions. The dump builder is shared with snapshot F.
      Where: test/frontend/dumps.ts (resolutionDump), test/frontend/resolution-dump.test.ts (+ baseline).
      Acceptance: both-direction counts written here. Depends on: 0.1
      **Measured 2026-09-30** (baseline `baselines/resolution-dump.json`; one bound walk shared with 0.4 in
      `test/frontend/bound-census.ts`). Bindings: a declaration (`lookup` / `resolveMemberChain` / the callee's parameters), else
      an avenue `analysis/resolution.ts` accepts undeclared, else NONE; NOSCOPE = the unit binds no scope (GVL initializers,
      DUT fields); NO-CALLEE = a named argument whose callee does not resolve.

      | group | resolved | NONE | NOSCOPE | NO-CALLEE |
      |---|---|---|---|---|
      | corpus (own files) | 81 458 | 4 057 (bare 326, member 3 712, parameter 19) | 858 | 2 062 |
      | corpus Library Manager | 11 983 | 426 (bare 81, member 345) | 2 380 | 0 |
      | fixtures | 18 156 | 64 (bare 21, member 43) | 0 | 9 |
      | library repo | 930 | 0 | 0 | 0 |

      Fixtures are bound once per vendor, parsed as that vendor (`bound.ts` `withBoundFixture(f, vendor, …)`): the fixtures row
      above is CODESYS; TwinCAT: bare names 16 919 resolved, NONE 91 (the CODESYS-only operators `__POSITION`/`__POUNAME`/
      `__COMPARE_AND_SWAP` and the L-date conversions among them, as `resolveBare` decides for TwinCAT); members 660 / NONE 43,
      parameters 480 / NO-CALLEE 9.
      Messages ("Identifier … not defined", "Ambiguous use of name", "is no component of"), each fixture against each vendor's
      build (`lspErrors(t, all, vendor)`) and corpus projects against their recorded builds:
      CODESYS **LSP 27, recorded 31, both 26; LSP only 1** (`itf_var_section_inherited` "Identifier 'held' not defined");
      **recorded only 5** (`ilc_calc_declared_unused`, `ilc_calc_other_type` 'n'; `network_unnamed_target_behind_enable`,
      `ng_en_eno_named_wire`, `ng_en_eno_sink` — CODESYS's `__…__ImpVar` implicit variables).
      TwinCAT **LSP 60, recorded 70, both 59; LSP only 1** (`itf_var_section_inherited`); **recorded only 11**
      (`esc_wstring_hex3`, `esc_wstring_hex_41`, `esc_wstring_hex_ff`, `esc_wstring_pair` 'out'; `ilc_calc_declared_unused`,
      `ilc_calc_other_type` 'n'; `network_unnamed_target_behind_enable` ''; `network_unnamed_target_of_valued_call` '' and
      'In1'; `type_codesys_vector` 'vec4'; `var_non_retain` 'iCount'). The corpus: 0 and 0 both ways. The 73 CODESYS and 143
      TwinCAT unbound fixture occurrences are pinned one by one; the corpus as counts.
- [x] 0.4 Type dump and fold dump: every expression's inferred type; every constant expression/initializer's `constEval` value.
      Cross-check types against recordings that decide a type (run values that show width/sign/overflow; CODESYS type-mismatch and
      conversion messages) and folds against run values of constants.
      Where: test/frontend/dumps.ts (typeDump, foldDump), test/frontend/type-dump.test.ts, test/frontend/fold-dump.test.ts
      (+ baselines). Acceptance: UNKNOWN count, type disagreements and fold disagreements written here. Depends on: 0.3
      **Measured 2026-09-30** (baselines `baselines/type-dump.json`, `baselines/fold-dump.json`).
      UNKNOWN over every value expression (an untyped int/real literal is UNKNOWN by design — its context types it — so it is
      counted apart):

      | group | expressions | UNKNOWN (not a literal) | UNKNOWN untyped literal | NOSCOPE |
      |---|---|---|---|---|
      | corpus (own files) | 123 515 | 17 013 | 17 758 | 1 842 |
      | corpus Library Manager | 131 610 | 4 603 | 88 033 | 23 286 |
      | fixtures | 26 733 | 2 601 | 5 396 | 32 |
      | library repo | 1 748 | 231 | 271 | 0 |

      The fixtures UNKNOWN row is CODESYS-bound; TwinCAT-bound: 26 666 expressions, UNKNOWN 2 685 not a literal, 5 399 untyped
      literals, NOSCOPE 32.
      **Type disagreements: 262** (CODESYS 124, TwinCAT 96, run 42). Build: each recorded type message ("Cannot convert type",
      the two sign-change warnings, the loss warning) is explained by a store the front-end types X → Y (assignment,
      initializer, input argument, operand → its operator's type, comparison operand → the checked meet), ONE store per
      recorded copy (the recordings carry no position). CODESYS: 732 messages, **629 explained, 81 by no store** (42 "Cannot
      convert", 18 of them on an expression CODESYS calls "Unknown type"; 16 sign-change; 5 loss — mostly built-in arguments:
      MIN/MAX/SEL, the atomics, `ANY_NUM`/`ANY_BIT` operand targets, subranges) **and 22 a copy more than the stores**
      (`bound_byte_below_min` SINT → BYTE twice over one initializer store; `unary_minus_on_time` DINT → TIME twice over one
      store). TwinCAT: 455 messages, 377 explained, 77 by no store, 1 a copy more. The other way — a store the front-end types
      not implicitly convertible (`classifyConversion` "incompatible") with no recorded "Cannot convert" left for it: CODESYS
      336 such stores, 315 refused, **21 not**; TwinCAT 328, 310, **18 not**.
      Run: 6 995 recorded values, 6 953 inferred as printed, **42 inferred UNKNOWN** (inherited members through `inst.` — H2).
      Folds: corpus own decl 6 818 fold / 520 do not / 1 405 NOSCOPE, body constants 725 / 950; fixtures decl 1 706 / 430 / 32,
      body 217 / 33; library decl 34 / 2, body 9 / 0. Run: of 6 995 recorded values, 5 131 name a declaration with no scalar
      initializer, 1 165 a variable a body names, 514 resolve to no declaration (the 42 H2 paths among them), 9 are reached
      through an initializing declaration, and **176 still hold their initializer**: 123 fold to it, 33 do not fold,
      **20 fold disagreements** — every one an initializer whose value lies outside the declared type's range:
      CODESYS stores it at the declared width, `constEval` returns it unwrapped (`bound_*`, `overflow_*`, `cc_fp_overflow_*`,
      `cc_init_constant_expr_into_sint`, `named_const_literal_wrap`; rule CE2).
- [x] 0.5 Rule inventory: design.md §4 as data; every uncovered rule is a gap. Run `scripts/conversion-matrix.ts` and write the
      number of explicit-conversion pairs without a fixture (CV7). Pin the GAP count per area (2, 3, 4) and in total here.
      Where: test/frontend/rules.ts, rules.test.ts. Acceptance: the counts are pinned here; the test fails if a listed fixture is
      missing or unrecorded, if a listed test title is missing, or if a count differs; the design as written (1.1) has
      134 GAP rows (area 2: 81, area 3: 26, area 4: 27) before 0.5 re-checks each listed fixture. Depends on: 1.1
      **Pinned 2026-09-30: 352 rules; GAP area 2: 79, area 3: 26, area 4: 28, total 133.** The re-check moved three rows, each
      recorded in its `recheck`: E21 (`lib_std_rtc`) and ST8 (`tr_37_case_label_wraps_minus_212`) are recorded now — the
      condition the design states — so they are covered (area 2: 81 → 79); AR24's only fixture `op_sys_new_delete` is
      `recorderSkip` and unrecorded, so AR24 is a GAP (area 4: 27 → 28). Every other listed fixture exists and is recorded; the
      FMT rows name today's tests (`implementation-keyword.test.ts`, `units/folder-directive.test.ts`,
      `implementation-keyword-diagnostics.test.ts`, `network-text/parser.test.ts`) until 1.x moves them.
      **CV7** (`bun run scripts/conversion-matrix.ts --explicit`, offline): 600 explicit `X_TO_Y` pairs over the front-end's type
      table, 273 called by a recorded fixture, **327 by none** — pinned in `rules.test.ts`.
- [x] 0.6 Baseline numbers into this file (parse findings, fixed-point failures, resolution, type and fold disagreements,
      uncovered rules, missing conversion pairs). Depends on: 0.1–0.5
      **Baseline 2026-09-30** (every later task's numbers may only fall from these). Held mechanically, not by review:
      `test/frontend/baselines/ceilings.json` holds a ceiling for every measure below; `VOLT_WRITE_BASELINE=1` refuses a
      measurement above one and lowers each to what it measured, and `test/frontend/baseline.test.ts` fails a ceilings file
      that rose against any committed version of itself (a measure retires only at 0). The GAP and CV7 counts live there
      too; `rules.test.ts` also pins their denominators (352 rules, 600 explicit pairs), so a GAP cannot fall by a row or a
      pair vanishing.

      | measure | baseline |
      |---|---|
      | parse findings (0.1), LSP refuses what the vendor accepts or words it otherwise | **51** (CODESYS 3, TwinCAT recorded 6, TwinCAT unrecorded 42); corpus 0; library 0 |
      | parse findings (0.1), the vendor refuses with a syntax message and the LSP has no parse error | **152** (CODESYS 64, TwinCAT 88) — one finding line each since 0.6's review; `parse-census.json` holds 203 lines |
      | fixed-point failures (0.2) | **23 files** (corpus 3 `expr-reprint-fails`; fixtures 20: 14 `format-ast-changed`, 6 `expr-reprint-fails`); library 0 |
      | resolution findings (0.3) | **234** lines (CODESYS 73, TwinCAT 143 unbound fixture occurrences; 18 message lines) |
      | resolution NONE (0.3) | corpus own **4 057** (bare 326, member 3 712, parameter 19); Library Manager **426** (bare 81, member 345); fixtures CODESYS **64** (bare 21, member 43); fixtures TwinCAT **134** (bare 91, member 43) |
      | resolution NOSCOPE (0.3) | corpus own **858** (bare 439, member 419); Library Manager **2 380** (bare 1 939, member 441); fixtures 0 |
      | resolution NO-CALLEE (0.3) | corpus own **2 062**; fixtures CODESYS **9**, TwinCAT **9** |
      | resolution messages (0.3) | CODESYS LSP-only 1, recorded-only 5; TwinCAT LSP-only 1, recorded-only 11 |
      | UNKNOWN, not a literal (0.4) | corpus own **17 013**; Library Manager **4 603**; fixtures CODESYS **2 601**, TwinCAT **2 685**; library **231** — ceilinged per expression kind (`type-dump.json`) |
      | type NOSCOPE (0.4) | corpus own 1 842; Library Manager 23 286; fixtures 32 each vendor |
      | type disagreements (0.4) | **262** (CODESYS 124, TwinCAT 96, run 42) |
      | fold disagreements (0.4) | **53**: 20 a wrong value (all CE2: out-of-range initializer not wrapped) and 33 no value — a recorded run value whose initializer `constEval` does not fold (one finding line each since 0.6's review) |
      | fold NOSCOPE (0.4) | corpus own decl 1 405; Library Manager decl 20 195; fixtures decl 32 each vendor |
      | uncovered rules (0.5) | **133 GAP** of 352 (area 2: 79, area 3: 26, area 4: 28) |
      | explicit conversion pairs without a fixture (CV7) | **327** of 600 |

      Gate 0: `bun typecheck` clean; `bun test` 6016 pass / 34 skip / 148 todo / 0 fail (6198 tests, 172 files, 508 s);
      `bun run check` 14 passed, 0 failed; `bun run rate:fixtures` regenerated `map.generated.ts` byte-identical (the
      vendor-parameterized `lspErrors` rates every fixture as before). Not a gate of this change but noted: `bun run lint`
      reports one pre-existing layering violation at HEAD (`services/structure/semantic-tokens.ts → network/network-analyze.js`),
      untouched by step 0.
      Gate 0.6 (the review: ceilings + both-direction parse and fold findings): `bun typecheck` clean; `bun test` 6022 pass /
      34 skip / 148 todo / 0 fail (6204 tests, 173 files, 641 s; +6 tests, +1 file `baseline.test.ts`); `bun run check` 14
      passed, 0 failed; `bun run rate:fixtures` regenerated `map.generated.ts` byte-identical. Delta vs step 0: parse-census
      findings 51 → 203 lines (+152 vendor-refuses-LSP-accepts, now pinned), fold findings 20 → 53 (+33 no-value), every
      other measure unchanged.

## 1. Front-end restructure (design first, then output-neutral moves)

Every 1.x task: output-neutral (**F**), and the full suite is green. The layering gate's known-violation list may only shrink. No
re-export shims: a moved symbol's old path is deleted in the same task. `src/transpile/` is touched only for import paths and for the
functions a task names, under **Gate T**; transpile's own copies are handed to transpile-restructure (design.md P6 "T", task 5.3).

- [x] 1.1 design.md: principles, target structure (`src/frontend/{library,syntax,symbols,types}`), old → new map (files, tests,
      functions, duplicated concerns), rule catalogue, test layout, and the 30 review gaps closed (§6).
- [x] 1.2 The import-rule gate. `scripts/check-layering.ts` scans `src/`, `test/`, `scripts/` and `libraries/`, gains F1–F4
      (design.md §5), and a known-violation list naming today's violations: types→reference, the 4 production deep imports, the
      2 src test deep imports and the 16 test/script deep imports (design.md P4 census), the front-end tests importing consumers,
      `process.env` in syntax. `test/frontend/layering.test.ts` runs it and fails on a new violation AND on a listed violation that
      no longer occurs.
      Where: scripts/check-layering.ts, test/frontend/layering.test.ts. Acceptance: green with the list; removing a list entry
      turns it red. Depends on: 1.1
      **Done 2026-09-30.** `scripts/check-layering.ts` exports `layeringViolations()`/`layeringReport()`, scans `src/`, `test/`,
      `scripts/`, `libraries/` (tests included for F1–F3), and adds F1 (the front-end imports no consumer), F2 (consumers import
      an index only), F3 (sub-layer and `syntax/` folder table), F4 (`ALLOWED_UPWARD` deleted), F5 (no `process.env` in the
      front-end), F6 (no import cycle in `syntax`). `test/frontend/layering.test.ts` fails on an unlisted violation and on a
      listed one that no longer occurs. The list at 1.2: **31** front-end violations — 21 F2 deep imports (3 production, 1 src
      test, 17 test/script: the census's 16 plus `test/conformance/support/transpile-confidence.ts` → `syntax/lexer.js`, added
      after it), 3 F3 (`types/resolve.ts` → precedence, and 2 front-end tests), 4 F1 (`types/infer.ts` → reference and 3 front-end
      tests importing consumers — `source-object.test.ts` → `source-extensions` is one the census had not seen), 1 F5
      (`process.env`), 2 F6 (`util ↔ var-section`) — plus
      `KNOWN_OTHER_VIOLATIONS` = 1 (`services/structure/semantic-tokens.ts → network/network-analyze.ts`, pre-existing, outside
      the front-end, not this change's).
- [x] 1.3 Front-end snapshot F: `scripts/frontend-snapshot.ts write|check [--base <rev>]` (F-front: AST + errors +
      failedDeclarations + tokens, resolution/type/fold dumps from test/frontend/dumps.ts, corpus diagnostics; F-back: fixture Rust
      and interpreter outputs); `check` builds the base in a temporary git worktree, cached per commit (design.md P9);
      `package.json` script `snapshot:frontend`; `.gitignore` entry; scripts/README.md.
      Acceptance: `check` against the current commit is identical twice in a row; a deliberate one-character change to a
      diagnostic makes it differ; run time written here. Depends on: 1.2, 0.3, 0.4
      **Done.** `scripts/frontend-snapshot.ts write|check|show`, `snapshot:frontend`, `.gitignore`, scripts/README. Aspects per
      source: `ast`, `errors`, `failed`, `tokens`, `stmts` (parseStatements), `active` (parseActive), `resolution`, `types`,
      `folds` (fixtures once per vendor), corpus `diagnostics`; F-back per fixture: `lowering`, `rust`, `interp` — **399 527
      aspect hashes**. The base is built in a worktree under `.worktrees/`, checked out byte-for-byte (`core.autocrlf=false`,
      then CRLF re-applied to every file this tree holds CRLF — the library repo's bodies are), the package `node_modules`
      reached by a junction. **Run time: 96 s for one side, ~210 s cold (base built), ~95 s with the base cached.** `check
      --base HEAD` identical twice in a row; a one-character change to a corpus-reported message (`loss of informatio`) made 4
      aspects over 4 sources differ (a message no corpus file draws — `not defined` — does not: F's diagnostics are the six
      corpora's, as specified). `--graphical 0|1` sets `VOLT_GRAPHICAL` before any import.
- [x] 1.4 Deep imports through the indexes. Census (written here): every name imported from outside each sub-layer; the indexes
      export exactly that set plus design.md "Index contents" (`pickForAsker`, `scopeUri`, `libraryRank`, `LibraryManifest`,
      `MATERIALIZATION*` (symbols for now), `BINARY_PRECEDENCE`, `memoByProject`, `dialectOf` …). Fix obsolete-usage.ts,
      empty-block.ts, reference-assign.ts, types/resolve.ts, server/server.test.ts, test/conformance/suite.test.ts, and the 16
      test/script deep imports (test/corpus/corpus.test.ts and scripts/probe-ambiguous-uses.ts included).
      Acceptance: F; the gate's deep-import entries are removed. Depends on: 1.3
      **Done.** Census (names imported from outside each sub-layer, 2026-09-30, after the step): syntax **93**, symbols **40**,
      types **69**, library **10** — the index export lists of 1.30/1.40 are these names plus the design's named extras
      (`libraryRank`, `pickForAsker`, `scopeUri`, `memoByProject`, `dialectOf`, `forEachExpr`, `forEachDecl`, `bodiesAt`,
      `BINARY_PRECEDENCE`, the format surface, `baseOf`). Fixed: obsolete-usage, empty-block, reference-assign, types/resolve,
      server.test, suite.test and the 17 test/script deep imports. Gate entries removed: 23.
- [x] 1.5 Front-end tests import no consumer: the network-text half of syntax/implementation-keyword.test.ts → src/network-text/;
      the analysis half of types/conversion-name.test.ts → src/analysis/; the symbols half of syntax/units/namespace.test.ts →
      symbols/binder.test.ts; types/ambiguous-name.test.ts → types/resolve.test.ts.
      Acceptance: F (every test title kept); gate entries removed. Depends on: 1.4
      **Done.** Moved: 2 network-text tests + the network-text assertion of the `%FOLDER` test → `src/network-text/implementation-line.test.ts`
      (one new title for the split assertion); 2 analysis tests of conversion-name → `src/analysis/conversion-name.test.ts`;
      2 binder tests of namespace.test → `symbols/binder.test.ts`; `ambiguous-name.test.ts` → `types/resolve.test.ts`;
      `source-object.test.ts`'s extension-parity test → `src/source-extensions.test.ts`. Every title kept. Gate entries removed: 4.
- [x] 1.6 Built-in result facts into `types/builtins.ts`: every FIXED `returnType` of reference.ts (`__POSITION`,
      `__COMPARE_AND_SWAP`, `__XADD`, `TEST_AND_SET` and the rest) as `BUILTIN_RESULT`; infer's `MATH_ARG_TYPED` and the
      EXPT/`__XADD`/`__POSITION` rules; `exptResultType` from arith.ts. infer's `lookupReference` call is replaced by
      `BUILTIN_RESULT` + `parseConversionName` (the derived conversion return types). reference.ts reads its fixed return types
      from types; `conversionEntry` stays derived. transpile/lower/builtins.ts keeps importing `exptResultType` by name from the
      types index (no transpile edit).
      Acceptance: F (hover output unchanged); `grep lookupReference src/types` is empty; `ALLOWED_UPWARD` empty; gate entry
      removed. Depends on: 1.4
      **Done.** `types/builtins.ts`: `BUILTIN_RESULT` (`__POSITION` STRING, `__COMPARE_AND_SWAP` BOOL, `__XADD` DINT,
      `TEST_AND_SET` DWORD — the only fixed `returnType`s the catalog had), `builtinCallResult`, `bareBuiltinType`,
      `MATH_ARG_TYPED`/`mathResultType`, `exptResultType` (from arith) + `exptCheckedType`, `twincatXaddResultType`.
      `reference.ts` `ref()` reads its return type from `BUILTIN_RESULT`. `grep lookupReference src/frontend` empty;
      `ALLOWED_UPWARD` gone; F identical.
- [x] 1.7 `Document` → `services/shared/document.ts`; its consumers in services/, server/ and network/ switch.
      Acceptance: F; syntax exports no Document. Depends on: 1.4
      **Done.** `services/shared/document.ts`; 34 consumer files import `Document` from `services/shared/index.js`.
- [x] 1.8 `allUnits` in ast-walk (the one namespace flattener): replaces type-refs `flatUnits`, parser `claimedKeywordLines`,
      reachability ×3, network-services:69, server/diagnostics:133, semantic-tokens:181 and formatting/print:139 where the unit set
      is identical. A site whose set differs is left and listed here for 3.1.2.
      Acceptance: F; a grep for hand recursion over `.units` finds only allUnits (plus the listed sites). Depends on: 1.4
      **Done.** `allUnits` (`ast/walk.ts`) replaces type-refs `flatUnits`, parser `claimedKeywordLines`, reachability
      `firstPou`/`hasRootDecl`/`catalog`, network-services:69, server/diagnostics `unstatedBodies`, semantic-tokens:181, and the
      test harness's `topExprs`/`sites`/bound-census walks. Left, listed for 3.1.2: `services/formatting/print.ts:139` (it PRINTS
      the namespace, so it needs the nesting, not the flattened set), `symbols/scoped-bodies.ts` and `format/bodies.ts` (no
      recursion today — C 3.1.2), the binder's namespace ingest (it builds scopes), and `scripts/frontend-snapshot.ts` (it must
      run on base commits that have no `allUnits`).
- [x] 1.9 `syntax/type-refs.ts` → `services/navigation/type-refs.ts` (`unitTypeExprs` private).
      Acceptance: F; references tests unchanged. Depends on: 1.8
      **Done.** `services/navigation/type-refs.ts`; `unitTypeExprs` private; references tests unchanged.
- [x] 1.10 `tokenAtOffset` (token-at.ts), `exprAtOffset`, `memberAtOffset` → `services/shared/positions.ts`;
      syntax/token-at.test.ts → services/shared/positions.test.ts; network imports them downward.
      Acceptance: F; syntax exports none of them; no syntax test imports services. Depends on: 1.4
      **Done.** `tokenAtOffset`, `exprAtOffset`, `memberAtOffset` in `services/shared/positions.ts`; `token-at.test.ts`'s three
      tests appended to `positions.test.ts`; network imports them from `services/shared`.
- [x] 1.11 The network-text switch becomes a parse option (`networkText: boolean`), and the parse options carry the dialect to the
      network-text parser. The server reads `VOLT_GRAPHICAL` in one place; the test preload and conformance support pass it. First
      count and list here every direct parse call that depends on the env default.
      Acceptance: F (with VOLT_GRAPHICAL=1 and without); the "off" server test still passes; no `process.env` under syntax; gate
      entry removed. Depends on: 1.4
      **Done.** `ParseOptions { networkText }` on `parseSource`/`parseDocument`/`parse`; a body parsed with network text off is
      marked by identity (`format/implementation-line.ts`, a WeakSet — the parse's decision, not the text's, so no AST field and
      no F change). The environment is read once in `server/config.ts`; `WorkspaceStore` passes it to both of its parses. Count:
      direct parse calls outside the parser — `parseSource` 296, `parseDocument` 12 (src/test/scripts/libraries); **4
      production**: `server/workspace-store.ts` ×2 (the only ones that depended on the env default — now explicit) and
      `transpile/lower/lower.ts` ×2 (read only `isStBody`, which network text does not change). The rest are tests, which ran
      with the preload's `VOLT_GRAPHICAL=1` and get the same answer from the option's absence. The C# repo gate
      `NetworkTextSwitchTests` names `src/server/config.ts` now (54/54 Repo.Gates pass). Not done here: carrying the DIALECT to
      the network-text parser — using it changes TwinCAT answers (C 2.1.4). F identical with VOLT_GRAPHICAL=1 and without.
- [x] 1.12 Folder move: `src/{syntax,symbols,types}` → `src/frontend/{syntax,symbols,types}`, `src/frontend/index.ts`; the import
      codemod `scripts/codemod-frontend-paths.ts` (committed, re-runnable) over ~254 consumer files and ~38 test/script files;
      `check-layering.ts` `layerOf` maps `frontend/<x>`, `TRANSPILE_ALLOWED = {frontend}`; `network-text` re-ranked to 2.5;
      `docs/architecture.md` paths.
      Acceptance: Gate T; `tsc` clean; F. Depends on: 1.5–1.11
      **Done.** Gate T: `src/transpile/` had no foreign edits; its edits are import paths only (one spelling-only change the
      first codemod made, `ir/values.ts`, was restored). `scripts/codemod-frontend-paths.ts` (re-runnable; `--check`): 303
      files rewritten, 0 unresolved; `--check` clean after. `check-layering` maps `frontend/<x>`, transpile may import the
      front-end, `network-text` ranked 2.5. `scripts/check-wiring.ts` reads the materialization table at its new home.
      `docs/architecture.md`, README, TESTING.md, test/README paths updated.
- [x] 1.13 `span.ts` owns joining and synthetic spans: `joinSpans` (from util), expression `merge`/`mergeSpans` deleted,
      `eofSpan`/`zeroSpan` replace the 5 hand-built spans; the lexer's EOF span uses its incremental line/col.
      Acceptance: F (spans included). Depends on: 1.12
      **Done.** `span.ts`: `joinSpans`, `pointSpan`, `eofSpan`, `zeroSpan`; expression `merge`/`mergeSpans` deleted; the 5
      hand-built spans (statements, expression ×3, type-expr) and the binder's namespace span use them; the lexer's EOF span is
      `pointSpan(pos, line, col)` from its incremental tracking (`spanFromOffsets`, now unused, deleted in 1.40).
- [x] 1.14 `lex/`: tokens.ts → `lex/tokens.ts` (TokenKind, Token, isTrivia) + `lex/vocabulary.ts` (`KEYWORDS` const array,
      `Keyword` derived; named subsets replacing cursor `SOFT_NAME_KEYWORDS`/`DECL_LIST_ENDERS`, var-section `SECTION_KEYWORDS`,
      parser `TOP_LEVEL_DISPATCH`, the FB/method/property/interface modifier sets; lexer prefix tables; `MULTI_CHAR_PUNCT`,
      `SINGLE_CHAR_PUNCT`); `lexer.ts` → `lex/lexer.ts`; `ParseResult.tokens` exposed and used by analysis/diagnostics and
      refused-name (same dialect). The orphan JSDoc and the consumer list in the dialect comment are deleted.
      Acceptance: F; one keyword list. Depends on: 1.13
      **Done.** `lex/tokens.ts` (TokenKind, Token, isTrivia), `lex/vocabulary.ts` (`KEYWORDS` const array — 154 — with `Keyword`
      derived; `Dialect`, `CODESYS_ONLY_*`; `VAR_SECTION_KEYWORDS`, `UNIT_STARTERS`, `SOFT_NAME_KEYWORDS`, `DECL_LIST_ENDERS`,
      `FB_MODIFIERS`, `MEMBER_MODIFIERS`, `PROPERTY_MODIFIERS`, `INTERFACE_MEMBER_MODIFIERS`; the lexer's prefix tables;
      `MULTI_CHAR_PUNCT`, `SINGLE_CHAR_PUNCT`), `lex/lexer.ts`. `ParseResult.tokens` is the stream the parse lexed;
      `analysis/diagnostics` `ctx.tokens` returns it (refused-name reads it through `ctx.tokens`). Left: refused-name's
      `cascadeAfter` re-lexes a SLICE of the source from an offset (same dialect) — not the whole stream. The orphan JSDoc and the
      dialect comment's consumer list are deleted.
- [x] 1.15 `ast/`: ast.ts → `ast/nodes.ts`; ast-walk.ts → `ast/walk.ts`; `isSelfRef` + `sameName` (from types/compat) →
      `identifier.ts` (+ `selfRefKind`); this-super-context.ts:32,42-44 uses them; `varInputParams` → `ast/declarations.ts`; stale
      ast.ts comments fixed.
      Acceptance: F; no `=== "THIS"`/`"SUPER"` comparison outside identifier.ts. Depends on: 1.14
      **Done.** `ast/nodes.ts`, `ast/walk.ts`, `ast/declarations.ts` (`varInputParams`); `identifier.ts`: `sameName` (compat's copy,
      same semantics), `selfRefKind`, `isSelfRef`; this-super-context uses `selfRefKind` — no `=== "THIS"`/`"SUPER"` outside
      identifier.ts. The ast header's stale history is rewritten in 1.41's sweep.
- [x] 1.16 `parse/cursor.ts` (Cursor only, unused `_context` parameters removed) and `parse/errors.ts` (cursor `describeToken`,
      util `describeToken`, type-expr `tokenDescription`, the inline "got <kind>" forms as named functions; `nameExpected`,
      `reportBrokenDeclaration`); the detached JSDoc fixed.
      Acceptance: F (every message byte-identical). Depends on: 1.15
      **Done.** `parse/cursor.ts` without the `_context` parameters (every call site; the `endAfterType` context parameter went with
      them); `parse/errors.ts`: `vendorTokenText` (the cursor's), `plainTokenText` (util's), `typeTokenText` (type-expr's),
      `typeExpected`, `expressionExpected`, `nameExpected`, `unexpectedTokenOf`, `reportBrokenDeclaration` (over an
      `ErrorCursor` shape, so errors ↔ cursor is no cycle); the detached JSDoc now sits on `nameExpected`. Every message
      byte-identical (F).
- [x] 1.17 `util.ts` dissolved: `parse/body.ts` (collectBodyUntil(Any), cursor `consumeBodyUntilAny`, property
      `collectAccessorBody`), `parse/names.ts` (identFromToken, eatModifiers), `format/folder.ts` (readFolderLine,
      closesDeclaration, reportMisplacedFolder), `collectVarSections` → var-section; the util↔var-section cycle is gone; C#
      `<see cref>` docs rewritten.
      Acceptance: F; no import cycle in syntax (the gate checks). Depends on: 1.16
      **Done.** `parse/body.ts` (collectBodyUntil(Any), `consumeBodyUntilAny` over two raw-stream primitives the cursor
      gained, `collectAccessorBody`), `parse/names.ts`, `format/folder.ts` (over a `FolderCursor` shape: format may not import
      parse), `format/lines.ts` (the line readers the format files share), `codeBody`/`bodySpanFromTokens` → format/
      implementation-line (reporting through a `ReportAt`), `collectVarSections` → declarations. The util ↔ var-section cycle is
      gone: F6 reports no cycle in syntax. The `<see cref>` doc is rewritten.
- [x] 1.18 `parse/names.ts`: one `readQualifiedName` (type-expr loop, `readMaybeQualifiedName`, interface `parseQualifiedName`;
      callers keep their node shapes), one `readNameList` (the 5 identifier-list loops), one `readModifiers` (FB, method, property
      and interface loops; FB/method keep their boolean flags).
      Acceptance: F. Depends on: 1.17
      **Done.** `parse/names.ts`: `readQualifiedName(c, first, dangling)` — the three readers' three behaviours at a dangling
      `.` kept as `report` (type-expr), `consume` (declarations), `leave` (interface) — with `joinedName`; `readNameList` (the
      5 loops: FB EXTENDS and IMPLEMENTS, function IMPLEMENTS, interface EXTENDS/IMPLEMENTS, struct fields, var names);
      `readModifiers` (FB and method with their lookahead, property and interface greedy); `readIdent`. Node shapes unchanged.
- [x] 1.19 `parse/initializer.ts` (aggregate parser, collectInitTokens, initializerFromTokens) out of expression.ts;
      `parse/scan.ts` (one balanced scanner for collectInitTokens, collectDimTokens, collectBalancedParenInner, topLevelDotDot);
      aggregate.test.ts → parse/initializer.test.ts. The stale expression.ts header is rewritten.
      Acceptance: F. Depends on: 1.18
      **Done.** `parse/initializer.ts`; `parse/scan.ts` (`collectUntilTopLevel` for init tokens and dims, `collectParenInner`,
      `topLevelDotDot`, one depth rule — parentheses only where the paren scanner counted only them); aggregate.test.ts →
      parse/initializer.test.ts; expression.ts header rewritten.
- [x] 1.20 `parse/statements.ts` + `parse/body-parse.ts`: the BodyParse cache and conditional-pragmas `parseActive` in one module
      with one cache; the stale statements.ts header is rewritten.
      Acceptance: F (both entries still give today's two trees). Depends on: 1.19
      **Done.** `parse/body-parse.ts`: `parseStatements` and `parseActive`, one WeakMap per body; `parse/statements.ts`
      `parseStatementTokens` (uncached); `pragmas/conditional.ts` is the scanner (`scanConditionals`, `hasConditionalPragmas`).
      Both entries give today's trees (F `stmts` and `active` identical).
- [x] 1.21 `parse/type-expr.ts`, `parse/declarations.ts` (var-section + type-decl `parseStructField` side by side), `parse/units/*`,
      `parse/units/header.ts` (`parseOptionalReturnType`; program.ts uses it only if F is unchanged, else noted for 2.4.1),
      `parse/parser.ts` (dispatch from UNIT_STARTERS; header rewritten); interface.ts import order fixed; parser.test.ts,
      fuzz.test.ts, units/interface.test.ts, units/namespace.test.ts move to parse/ (design.md §3.1a).
      Acceptance: F. Depends on: 1.20
      **Done.** `parse/declarations.ts` holds `parseStructField` beside `parseVarDecl`; `parse/units/header.ts`:
      `parseOptionalReturnType`, `readImplements` (function's, now also FB's — identical); `parse/parser.ts` dispatches through a
      `UNIT_PARSERS` table keyed by `UnitStarter` (a starter with no parser is a type error), header rewritten; interface.ts
      imports in order. **Noted for 2.4.1:** `program.ts` keeps its own `: <type>` read — `parseOptionalReturnType` also eats a
      trailing `;`, which would change a program's parse.
- [x] 1.22 `literal/`: literal-value.ts → `literal/value.ts` + `literal/string.ts` (tests split likewise);
      `calendarNanoseconds` from transpile/lower/constants.ts → `literal/calendar.ts` (the transpile call site imports it from the
      syntax index); the lexer's prefix carried on the Literal node (`prefix`); `types` literal typing reads `prefix`, not a regex
      over `text`.
      Acceptance: Gate T; F. Depends on: 1.21
      **Done.** Gate T (transpile clean of foreign edits; the one named edit: `constants.ts` imports `calendarNanoseconds` from the
      syntax index). `literal/value.ts`, `literal/string.ts` (+ string.test.ts), `literal/calendar.ts`. Literal typing reads
      `prefix` for DATE/TOD/DT (`L…`). **Left:** a TIME literal carries no `prefix` on its node (adding one changes every
      duration literal's AST, so F), so `LTIME#` is still read off `text` — for 2.2.3.
- [x] 1.23 `pragmas/`: `conditional.ts` (scanner; `hasConditionalPragmas` replaces unresolved-identifier `CONDITIONAL_PRAGMA_RE`;
      analysis/checks/pragmas/pragmas.ts's balance stack switches only if F is unchanged, else noted for 2.7.1); `attributes.ts`
      (one regex, one lex). The seven attribute sites of design.md P6: unit-attributes.ts (moves), binder `hasQualifiedOnly` →
      `fileHasAttribute`, analysis attribute-placement.ts, analysis pragmas.ts, services hover.ts, services completion.ts,
      workspace-refs.ts (the obsolete regex) — each switches where identical; `addAttribute` test-only export removed; tests move
      (conditional-pragmas.test.ts, unit-attributes.test.ts).
      Acceptance: F; the non-identical sites are listed here. Depends on: 1.22
      **Done.** `pragmas/conditional.ts` (1.20), `pragmas/attributes.ts` (one attribute-name reader for its three functions;
      `addAttribute` private). **Non-identical sites, left** (each changes an answer): unresolved-identifier
      `CONDITIONAL_PRAGMA_RE` (no `define`/`undefine`, no closing-brace anchor — 2.7.1); analysis pragmas.ts balance stack
      (2.7.1); binder `hasQualifiedOnly` (unanchored, `'qualified_only'}` only — 2.7.2); attribute-placement and hover (`'[^']*'`
      reads an empty name); analysis pragmas `parsePragma` (reads the value, an unquoted one as ''); completion (a prefix inside
      an unfinished pragma); workspace-refs (the obsolete regex over raw text with the following POU). The three attribute
      functions still lex the source once each: reading `ParseResult.tokens` changes their signature, which the transpiler
      calls (T, 5.3).
- [x] 1.24 `format/`: implementation-keyword.ts → `implementation-line.ts`, `folder.ts`, `retired-comments.ts`, `reserved-names.ts`,
      `network-header.ts` (network-text/parser.ts imports its markers and drops its copy); syntax/bodies.ts → `format/bodies.ts`;
      implementation-keyword.test.ts and units/folder-directive.test.ts → `format/*.test.ts`, each FMT1–FMT8 case under the title
      design.md §4 2.10 names; exports used only inside a file become private.
      Acceptance: F; one set of network-header markers. Depends on: 1.23
      **Done.** `format/implementation-line.ts`, `folder.ts`, `retired-comments.ts`, `reserved-names.ts`, `network-header.ts`,
      `bodies.ts`, `source-object.ts` (a file-format fact the design did not map; it is the format's); tests:
      `implementation-line.test.ts`, `folder.test.ts` (+ the member-folder test), `retired-comments.test.ts`, and two new unit
      tests, `reserved-names.test.ts`, `network-header.test.ts`; `rules.ts` FMT rows name them. `network-text/parser.ts` keeps
      no copy of the header markers (its token grammar is its own), so nothing switched; the markers are private to
      network-header.ts.
- [x] 1.25 `frontend/library/`: `path.ts` (isLibraryUri, libraryOf, the path half of isLibrarySymbol; workspace-store:135
      switches), `manifest.ts`, `materialization.ts` (out of symbols/library-namespace.ts); server/diagnostics, workspace-refs,
      libraries/index.ts, transpile lower.ts and the tests import `library/index`; library-symbol.test.ts split (design.md §3.1a).
      Acceptance: Gate T; F; `bun run check` (C# parity) green. Depends on: 1.24
      **Done.** Gate T (named edits: import paths in lower.ts, calls.ts, places.ts). `frontend/library/{path,manifest,
      materialization,index}.ts`; `symbols/library-namespace.ts` → `symbols/library-namespaces.ts` (the binding half);
      `isLibrarySymbol(sym)` is `isLibraryUri(sym.uri)`; library-symbol.test → `library/path.test.ts` (+ libraryOf's test) and a
      binder test. `bun run check` 14/14. **Non-identical, left:** workspace-store:135 tests a lower-cased key for
      `library manager/` with a separator; `isLibraryUri` is case-sensitive without one.
- [x] 1.26 Symbols model split: symbol.ts → `model.ts`, `scope.ts`, `cache.ts` (the lazy indices, `invalidate(scope)` used by
      binder, library-namespaces, scope-nav and canonicalize; `memoByProject`).
      Acceptance: F; no `_childIndex` write outside cache.ts. Depends on: 1.25
      **Done.** `symbols/model.ts`, `scope.ts`, `cache.ts` (child and span indices, generation, the library visibility map, all in
      WeakMaps — no cache field on `Scope`; `invalidate(scope)` at bindFile, unbindFile, canonicalize, library-namespaces).
      `grep _childIndex` finds nothing outside cache.ts (nothing at all).
- [x] 1.27 Binder split: `binder.ts` (ingest, `gvlName`, which document-symbol uses), `incremental.ts` (bindFile, unbindFile,
      canonicalize, `relink`), `extends.ts` (`linkExtends`, `extendsChain` base-first with a cycle guard, `baseOf`); the rank doc
      lives only in precedence.ts; `model.ts` `isPouScope` replaces network-analyze:111 `isPou`'s kind set; build-API `localScope`
      replaces network-analyze:41-54's hand-built Scope; symbols.test.ts → binder.test.ts, extends-ambiguity.test.ts →
      extends.test.ts, incremental-rebind.test.ts → incremental.test.ts.
      Acceptance: F. Depends on: 1.26
      **Done.** `binder.ts` (ingest, `gvlName`), `incremental.ts` (`buildSymbolTable`, bindFile, unbindFile, canonicalize,
      `relink` = canonicalize + linkExtends, never apart; every former `linkExtends` caller calls `relink`), `extends.ts`
      (`linkExtends`, `extendsChain` base-first with a cycle guard, `baseOf`); the rank list lives only in precedence.ts;
      `model.ts` `POU_SYMBOL_KINDS`/`isPouSymbol` replace network-analyze's `isPou` kind set (a SYMBOL kind set, so it is named
      for symbols); `scope.ts` `localScope` replaces network-analyze's hand-built Scope; document-symbol names a GVL with
      `gvlName`. Tests: symbols.test.ts merged into binder.test.ts, extends.test.ts, incremental.test.ts.
- [x] 1.28 scope-nav gains `enclosingPou` (from infer), `rootOf` and `resolveQualifiedConst` (from const-eval), `visibleNames`
      (completion:81-93), `symbolDefinedAt` (resolve-at:84-100); inherited-variable:34, network-analysis pinSet and
      this-super-context:22 switch where identical.
      Acceptance: F; every non-identical site listed here for 3.x. Depends on: 1.27
      **Done.** scope-nav: `enclosingPou`, `rootOf`, `resolveQualifiedConst`, `visibleNames`, `symbolDefinedAt`. Switched:
      inherited-variable:34 and network pinSet (`extendsChain`), this-super-context:22 (`enclosingPou`), completion:81-93
      (`visibleNames` — which adds a cycle guard; the two loops there looped forever on `A EXTENDS B, B EXTENDS A`),
      resolve-at (`symbolDefinedAt`), const-eval (`resolveQualifiedConst`, `rootOf`). No non-identical site.
- [x] 1.29 symbols/bodies.ts → `symbols/scoped-bodies.ts`; server/diagnostics `unstatedBodies` and analysis/body-context.ts list
      bodies through `unitBodies`.
      Acceptance: F. Depends on: 1.28
      **Done.** `symbols/scoped-bodies.ts`; server/diagnostics `unstatedBodies` lists through `unitBodies`. analysis/body-context
      lists no bodies (it names the one it is given), so nothing to switch.
- [x] 1.30 symbols index curated: the named read API of design.md "Index contents" + a `build` namespace (buildSymbolTable,
      bindFile, unbindFile, relink, localScope); server/workspace-store, transpile lower.ts and network-analyze use `build`.
      Acceptance: Gate T; F; no `export *` in symbols/index. Depends on: 1.29
      **Done.** Gate T (lower.ts's builders through `build`). symbols/index names the read API one by one (no `export *`) and
      exports `build` = { buildSymbolTable, bindFile, unbindFile, relink, localScope }; 115 consumer files call through it.
- [x] 1.31 elementary.ts split exactly as design.md §3.1: `elementary.ts` (facts, `elementaryType`), `platform.ts`
      (`PLATFORM_ALIASES`, `POINTER_BITS`, `canonicalElem` with an optional target defaulting to today's 64-bit answer),
      `predicates.ts` (complete list incl. `isDuration`, `numericRank`), `conversion-name.ts`, `defaults.ts`; the header's legacy
      reference is removed. No transpile file changes (it imports through the types index).
      Acceptance: F; every former elementary.ts export has exactly one home. Depends on: 1.30
      **Done.** `elementary.ts` (facts, `elementaryType`, aliases, `ANY_FAMILIES`/`inTypeGroup`, `CODESYS_ONLY_TYPES`,
      `elementaryDisplayName`), `platform.ts` (`Target`, `PLATFORM_ALIASES`, the measured 32-bit table, `canonicalElem(name,
      target = the 64-bit target)`), `predicates.ts`, `conversion-name.ts`, `defaults.ts`, `literal.ts` (1.32). The header's legacy
      reference is gone. No transpile file changed. **Not created:** `widthOf` and `POINTER_BITS` — nothing reads them yet
      (4.1.1 will).
- [x] 1.32 `types/literal.ts`: integerLiteralType, REAL_LITERAL_TYPE, ANY_INT_RANGE, REAL_MAX_MAGNITUDE, and infer's literalType,
      literalCheckType, literalErrorType, typedLiteralSum; `literalOwnType` (reference-assign, call-arguments),
      `literalCapacityType` (constant-overflow), `isNegatedIntLiteral` (narrowing) replace the consumer copies; literal-check.test.ts
      → literal.test.ts.
      Acceptance: F. Depends on: 1.31
      **Done.** `types/literal.ts`: integerLiteralType, REAL_LITERAL_TYPE, ANY_INT_RANGE (private), REAL_MAX_MAGNITUDE,
      literalType, literalCheckType, literalErrorType, typedLiteralSum, `literalOwnType` (reference-assign, call-arguments),
      `literalCapacityType` (constant-overflow's `overflowType`), `isIntLiteral` (narrowing's — named for what it is: an integer
      literal written plain OR negated, not `isNegatedIntLiteral`); literal-check.test.ts → literal.test.ts.
- [x] 1.33 `types/width.ts`: `integerOfWidth` (from arith), `wrapToWidth` (const-eval `heldAs`), `widthOf`; infer's three ladders
      and checkedNegationType's ternary use it.
      Acceptance: F. Depends on: 1.32
      **Done.** `types/width.ts`: `integerOfWidth`, `wrapToWidth` (const-eval `heldAs` now wraps through it); infer's NOT ladder,
      the bitwise ladder, `typedLiteralSum`'s order and `checkedNegationType`'s ternary use it.
- [x] 1.34 `types/arith/`: `runtime.ts`, `checked.ts`, `temporal.ts`, `operators.ts` (`UNARY_ACCEPTS` from unary-operand;
      `operandConversion` from narrowing; `operandFamilyRule` from rules.binaryOpError; the bitwise-result rule from infer;
      `OPERATOR_FUNCTIONS`); network-text/parser.ts `BIT_STRINGS`/`COMPARISONS`/`BIT_OPERATORS` switch to
      `inTypeGroup("ANY_BIT")` and `OPERATOR_FUNCTIONS` where F is unchanged (else listed here for 4.4). The analysis checks keep
      only their messages; arith.test.ts split by file.
      Acceptance: F; no family list in analysis/checks/types/{unary-operand,narrowing}.ts or rules.ts. Depends on: 1.33
      **Done.** `arith/runtime.ts`, `checked.ts`, `temporal.ts`, `operators.ts` (`ARITHMETIC/BITWISE/COMPARISON_OPERATORS`,
      `COMPARISON_FUNCTIONS`, `BIT_OPERATOR_FUNCTIONS`, `operandConversion`, `comparisonConverts`, `unaryOperandConversion`,
      `notResultType`, `bitwiseResultType`, `operandFamilyRule`); unary-operand, narrowing and rules.binaryOpError keep only their
      messages; arith.test split into runtime.test/temporal.test. network-text's `COMPARISONS`/`BIT_OPERATORS` switched to
      `COMPARISON_FUNCTIONS`/`BIT_OPERATOR_FUNCTIONS`. **Listed for 4.4:** network-text `BIT_STRINGS` is not `ANY_BIT` (it has no
      `BIT`).
- [x] 1.35 `types/infer/`: `expr.ts`, `member.ts`, `callee.ts` (`fbChainSections` on `extendsChain`); stray doc block fixed.
      Acceptance: F. Depends on: 1.34
      **Done.** `infer/expr.ts`, `member.ts`, `callee.ts`; the stray `enclosingPou` doc block is gone. **Listed for 3.2.2:**
      `fbChainSections` walks the EXTENDS chain by NAME (`lookup`), not through `extendsChain` — switching changes the base
      under library ambiguity.
- [x] 1.36 `types/const/`: `fold.ts`, `constancy.ts`; name resolution through `scope-nav.resolveQualifiedConst`; const-eval.test.ts
      and constancy.test.ts move.
      Acceptance: F. Depends on: 1.35
      **Done.** `const/fold.ts`, `const/constancy.ts` (with `compileTimeConstant`); qualified constants resolve through
      `scope-nav.resolveQualifiedConst`; the tests moved.
- [x] 1.37 `types/enums.ts`: the EnumType.base rule (from resolve) and enum numbering/default (`defaultOfValues`, `enumDefault`,
      `inlineEnumDefault` from transpile/lower/constants.ts; the transpile call sites import them from the types index).
      Acceptance: Gate T; F (the storage-base disagreement is left for 4.7.3). Depends on: 1.36
      **Done.** Gate T (named edits: constants.ts gives up `enumDefault`/`inlineEnumDefault`/`defaultOfValues` and exports
      `enumeratorValue(lw)`, its enumerator folder; storage.ts calls the types index). `types/enums.ts`: `enumBase` (resolve's
      rule), `enumDefault(project, t, valueOf)`, `inlineEnumDefault(type, valueOf)` — the enumerator values are folded by the
      caller, since lowering and the LSP fold differently (4.6.1). The storage-base disagreement is left for 4.7.3.
- [x] 1.38 `compat.ts` owns pointer↔integer (from pointer-conversion `pointerSized`, width from `platform.POINTER_BITS`);
      `resolve.isDialectType` replaces resolution.ts:107/:229 and refused-name.ts:114; `types/names.ts` created holding
      `nameResolves`'s search order ONLY if F is unchanged (else it moves in 3.1.5, and this is noted here).
      Acceptance: F. Depends on: 1.37
      **Done.** `compat.ts` `isPointerSizedInteger` (pointer-conversion's rule, `bits >= 32` as measured — the target's
      pointer width would change the 32-bit answers: 4.1.1); `resolve.ts` `isDialectType` replaces resolve:97, resolution.ts's
      two gates and refused-name:114. **`types/names.ts` not created:** `nameResolves` asks the reference catalog, which the
      front-end may not import — it moves in 3.1.5.
- [x] 1.39 `render.ts` forms: messages `compilerTypeName`, `compilerArrayText`, `compilerSubrangeText` type text →
      `renderType(t, { form: "compiler" })`; array-bounds, array-init:54 and compilerArrayText read `ArrayTypeInfo.bounds`.
      Acceptance: F (every message byte-identical). Depends on: 1.38
      **Done.** `renderType(t, { form: "compiler" })` (the enum upper-casing); `compilerTypeName` is gone, its 12 call sites use
      the form. **Non-identical, left for 4.7.x:** `compilerArrayText`, array-bounds and array-init:54 fold their bounds in the
      USE site's scope; `ArrayTypeInfo.bounds` is folded in the resolving scope, which differs for a local constant bound.
      `compilerSubrangeText` is not a type's name (it takes the base name and bounds), so it stays message wording.
- [x] 1.40 Types and syntax indexes curated (named exports, the 1.4 census). Dead exports deleted (`isKnown`, `isNarrowing` and
      their tests). Exports used only inside their sub-layer made private: types (numericRank, isDatetime, isIsolated, durationFor,
      elementaryDisplayName) and syntax (parseTopLevel, parseExpression, parseAssignable, atVarSection, parseVarSection,
      collectInitTokens, bodySpanFromTokens, codeBody, opensKeywordLine, statementOf, unsupportedLine, UNSUPPORTED_WORD, folderOn,
      MULTI_CHAR_PUNCT, SINGLE_CHAR_PUNCT), each only where `scripts/dead-exports.ts` confirms no outside user.
      Acceptance: F; `scripts/dead-exports.ts` is clean for frontend/; no `export *` in any front-end index. Depends on: 1.39
      **Done.** syntax, symbols, types and frontend indexes name their exports (no `export *` in any front-end index; the
      frontend index is the union, for `src/index.ts`). Deleted: `isKnown`, `isNarrowing` (+ their tests), `spanFromOffsets`.
      Made private (the dead-export scan: no other file names them): `folderOn`, `UNSUPPORTED_WORD`, `unsupportedLine`,
      `statementOf`, `durationFor`, `generationOf`, `consumeBodyUntilAny`, `typeTokenText`, `FIELDED_HEADER`, `END_NETWORK`,
      `ANY_INT_RANGE`. The design's other candidates (parseTopLevel, parseExpression, parseAssignable, atVarSection,
      parseVarSection, collectInitTokens, bodySpanFromTokens, codeBody, opensKeywordLine, MULTI/SINGLE_CHAR_PUNCT, numericRank,
      isDatetime, isIsolated, elementaryDisplayName) are used by another file of their sub-layer, so they stay exported and off
      the index. The dead-export scan's remaining front-end rows are union members and types named in exported signatures.
- [x] 1.41 No concern in two places: the layering gate's known-violation list is empty; design.md §3.3 is re-verified by grep (every
      "R" row has one home). Every remaining copy is either a C task named in design.md or a T hand-off listed in 5.3. Stale headers
      named in the maps (parser, statements, expression, var-section, render) are rewritten.
      Acceptance: gate green with an empty list; the §3.3 check result written here. Depends on: 1.40
      **Done.** `KNOWN_FRONTEND_VIOLATIONS` is empty; the gate is green (`KNOWN_OTHER_VIOLATIONS` holds the one pre-existing
      services→network edge, outside the front-end). §3.3 re-verified by grep — one home each: keyword vocabulary, span joining,
      token description (home; one wording is 2.8.1), namespace flattening (print.ts listed under 1.8), body listing, body →
      statement tree (home; one tree is 2.7.1), `%FOLDER`, network-header markers, self reference, POU kinds, scope construction,
      cache invalidation, EXTENDS chain home (the name-resolving sites are 3.2.2), library path (workspace-store listed under
      1.25), precedence rank table, integer width ladder, wrap to width (types; transpile copies are T), literal typing (LSP
      copies; transpile's is T), NOT result type, unary-operator families, built-in result types (LIMIT/SEL/MUX are 4.3.4),
      enum numbering/default, dialect type gate, type rendering (array bounds listed under 1.39). Remaining copies are the C
      tasks named above and the T hand-offs of 5.3. Stale headers rewritten: parser, statements, expression, declarations
      (var-section), render, ast/nodes, binder, model.
      
      **Gate 1 (2026-09-30):** F identical against the step's base `1b03f0e55c` with VOLT_GRAPHICAL=1 and without (399 527 aspects
      each); `bun typecheck` clean; `bun test` 6029 pass / 34 skip / 148 todo / 0 fail (6211 tests, 181 files,
      521 s — re-run after the review fixes below; a first run made while snapshot F ran alongside timed out
      `interp — no iteration cap` at 5037 ms, which takes ~3 s alone and passed uncontended); `suite-snapshot.ts --compare` against a snapshot taken at the base identical (4565 tests); `bun run rate:fixtures`
      regenerated `map.generated.ts` byte-identical; `bun run check` 14/14; `bun run lint` green; Repo.Gates 54/54. The step's base is `1b03f0e55c`: commit
      `5cef943304` (the execute-change 5-task cap) swept this step's staged `git mv` renames — content-less, 68 R100 + 5 D — into
      itself, so that commit's package tree is a half-moved intermediate; F must be checked with `--base 1b03f0e55c`.
      **Step-1 review fixes:** (a) 1.11's count was wrong — scripts do not run with the preload, so an absent option turned
      network text ON for every script and the transpiler where the base read it OFF. `ParseOptions` is now REQUIRED
      (`parseSource(src, options, dialect?, object?)`, `parseDocument(uri, src, options, dialect?)`; a missing one throws by
      name): tests and test support pass `{ networkText: true }`, scripts `{ networkText: NETWORK_TEXT_ENABLED }`
      (`server/config.ts`, the base's reading), `lower.ts` a stated `TRANSPILE_PARSE` (on). (b) `ParseResult.dialect` records
      the parse's vocabulary and `computeSemanticDiagnostics` refuses a parse made for another vendor by name, as it refuses
      the project's; colocated check tests (30 files) that analysed a CODESYS-lexed parse as TwinCAT now parse as the vendor they assert
      (all still green). (c) `incremental.test.ts` runs the production sequence (unbind, bind, `relink`), rebinding the file
      canonical order puts SECOND; `check-layering` refuses an import of `linkExtends` outside `incremental.ts`. (d) the
      cyclic-EXTENDS completion answer (1.28) is pinned in `assist.test.ts` (hangs with the guard removed). Correction to the
      title claim: 1.25 renamed three titles (`isLibrarySymbol …` → `isLibraryUri …`), which the suite snapshot cannot see.

## 2. Parser (syntax/) conformance

Per group: record the named fixtures first (`record:language`; accept, or CODESYS's exact messages); pin each disagreement as a
known divergence, then fix test-first in the file design.md §4 names. Every task's acceptance is **CA** unless it says otherwise.

- [x] 2.1.1 Comments and line endings (L1–L4). Record lex_line_comment_in_body, lex_block_comment, lex_nested_block_comment,
      lex_crlf_body, lex_crlf_implementation_line.
      Where: lex/lexer, format/implementation-line. Acceptance: CA. Depends on: 1.41
- [x] 2.1.2 Identifiers, keywords, unknown characters, deprecated keywords (L5–L8, L13, L15). Record lex_unknown_character,
      lex_reserved_unused_keyword_as_name (READ_ONLY, FROM, USING, WITH), lex_div_as_operator, lex_cal_keyword, lex_ini_keyword.
      Where: lex/vocabulary, lex/lexer. Acceptance: CA. Depends on: 2.1.1
- [x] 2.1.3 Reserved and soft names (L9, L12, L14): the refused-name cascade moves into the parser. Record lex_limit_as_variable,
      lex_min_as_variable, lex_sel_as_variable, lex_mux_as_variable, lex_max_as_variable, lex_soft_keyword_names.
      Where: parse/errors, parse/names; analysis/checks/names/refused-name.ts shrinks to what the parser cannot know.
      Acceptance: CA. Depends on: 2.1.2
      **Gate 2.1.1–2.1.3 (2026-09-30).** Fixtures: `fixtures/grammar/lexer.ts`, 357 `lex_*` (294 of them the
      `lex_keyword_{assigned,before_name,operand}_*` family — every keyword asked as a name in the three statement
      positions), 351 recorded on each vendor (the six `lex_soft_keyword_method_name_{public…abstract}` are refused at
      object creation, `vendorRefuses`). Rules GAP area 2 **79 → 71** (total 133 → 125): L1–L4, L8, L13, L14, L15 closed;
      L11 stays (2.1.4). `rate:fixtures`: lsp-gap 13 → 11 (`lex_keyword_operand_sys_{new,pouname}` fixed here).
      Divergences opened (`support/divergences.ts`): R1 cascade after a stray token (10, both vendors → 2.8.2); system
      operands `__CURRENTTASK`/`__POOL` as bare words (5, both → 2.5.6; **niche: accepted loss, 0 occurrences in the
      corpora**); TwinCAT bare `xsizeof` (3 → 2.1.4; **niche: accepted loss, 0 in the TwinCAT corpus**, the 5 in pro2193
      are CODESYS calls); `type_codesys_vector` (TwinCAT → 2.1.4). Fixed in the product on the way (cheap): bare `__POUNAME`
      bites the next token as `__POSITION` does, bare `__NEW` takes the next token for its `(` then wants a type (both
      `parse/expression.ts`, tests in `parse/parser.test.ts`).
      **The 0.x measures, three refinements** (the first gate run was red: the `lex_keyword_*` family raised four
      ceilings — parse findings 201→223, fixed-point 23→25, resolution 234→250, types 262→263). No ceiling rose; each
      refinement makes a measure ask the question it states, and every ceiling it moved went DOWN:
      (a) `dumps.ts` `refusedIn` — an expression holding its source's own parse error has no printer fixed point (0.2; the
      rule the formatter check already followed) and no type to ask (0.4, counted "untyped, a refused expression");
      (b) a fixture bare name that binds NONE, or an `ident_expr` typed UNKNOWN, whose name that fixture's build itself
      reports "Identifier 'x' not defined" AGREES with the oracle (0.3's own question) — counted, not a finding
      (this also answers 2.1.4's open question for `type_codesys_vector`);
      (c) a fixture `support/divergences.ts` pins for a vendor is counted, not measured, for that vendor in 0.1/0.3/0.4 —
      the suite already replays it as an expected failure and fails the day it agrees; without this an owner-accepted
      niche divergence could never be recorded under a ceiling.
      Ceilings now: fixed-point findings 17 (fixtures not a fixed point 14); parse findings 190 (CODESYS refused-no-LSP
      61, TwinCAT 83); resolution findings 166 (fixture bare NONE CODESYS 5, TwinCAT 45; messages LSP-only 0/0,
      recorded-only 2/10); type findings 253 (ident_expr UNKNOWN CODESYS 68, TwinCAT 115). F (`frontend-snapshot check
      --base HEAD`): 13 268 aspects over 1 788 sources — every one a new `lex_*` fixture but `cc_il_name_cal` (L15, the
      CAL rule; its back end drops rust/interp because it is now refused at parse); no corpus source moved.
      `bun typecheck` clean; `bun test` 6084 pass / 34 skip / 148 todo / 0 fail (6266 tests, 182 files, 505 s);
      `bun run check` 14 passed, 0 failed; lint clean (the one known layering violation).
- [x] 2.1.4 Dialect vocabulary (L10, L11): `__VECTOR` applied on TwinCAT; every default-dialect re-lexer of design.md P6 lexes with
      the project dialect: services hover.ts, semantic-tokens.ts, analysis reachability.ts, symbols binder.ts, pragmas/attributes,
      services/shared/positions.ts (`tokenAtOffset`), network/network-analyze.ts:116, network-text/parser.ts:1175 (via the parse
      options of 1.11). Record lex_vector_twincat, lex_codesys_only_keyword_twincat_names.
      Where: lex/vocabulary, parse/type-expr, the eight sites. Acceptance: CA; `grep "lex("` outside syntax/ shows only calls that
      pass a dialect. Depends on: 2.1.3
      **Gate 2.1.4 (2026-10-01).** Fixtures (`fixtures/grammar/lexer.ts`), recorded on both vendors (and `record:exec` on
      CODESYS for the five declared ones): `lex_codesys_only_keyword_twincat_names`, `lex_vector_twincat`,
      `lex_vector_twincat_{pointer_to,array_of,struct_field,return_type}`. `__VECTOR` is a keyword on CODESYS and an
      identifier on TwinCAT that `parse/type-expr` refuses where a type belongs ("Type definition expected instead of
      '__VECTOR'"). Rules GAP area 2 **71 → 70** (total 125 → 124): L11 closed; L10's row gains its recorded fixtures.
      Divergences closed: `type_codesys_vector` (TwinCAT). Opened (`support/divergences.ts`, both recovery rules', not the
      vocabulary's): TwinCAT's missing "has no effect" warning after an unknown word before a name (5
      `lex_keyword_before_name_*`, → 2.8.2), TwinCAT's cascade after `__VECTOR` as a return type
      (`lex_vector_twincat_return_type`, → 2.8.3); the DUT-alias case recorded but not kept (it would raise a NOSCOPE
      ceiling — owner question, written there). `rate:fixtures`: 3149 fixtures; confirmed 2079, refused 907, lsp-gap 11,
      diverges 3. The 0.4 measure asks one more question it states (`bound-census.ts`): an index/member/deref built on a
      name the vendor reports undefined agrees as its root does, and a call to a POU with no return type has no value
      ("call with no return value": corpus 1820, fixtures 232/233) — every ceiling it moved fell (corpus call UNKNOWN
      4523 → 2703, fixtures 896 → 664 / 926 → 694; fixed-point findings 17 → 16). `grep "lex("` outside syntax/: three
      calls, each with a dialect (refused-name, network-analyze, network-text/parser); the other P6 sites read
      `parseResult.tokens`. F (`frontend-snapshot check --base HEAD`): 352 aspects over 47 sources — all the L10/L11
      fixtures above plus `lex_keyword_*_sys_vector` and `type_codesys_vector` (front and back end); no corpus source moved.
      `bun typecheck` clean; `bun test` 6102 pass / 34 skip / 148 todo / 0 fail (6284 tests, 182 files, 551 s);
      `bun run check` 14 passed, 0 failed; lint clean.
- [x] 2.2.1 Integers and bases (N1–N10): record lit_int_underscore, lit_invalid_base_3, lit_invalid_base_10, lit_byte_typed,
      lit_word_typed, lit_word_16_ff, lit_int_typed_negative.
      Where: lex/lexer, literal/value. Acceptance: CA. Depends on: 1.41
- [x] 2.2.2 Reals and BOOL (N11–N15, N12a, N12b): record lit_bool_typed_true, lit_bool_typed_1, lit_real_exponent_capital,
      lit_real_no_leading_digit, lit_real_no_fraction_digit.
      Where: lex/lexer, literal/value. Acceptance: CA. Depends on: 2.2.1
- [x] 2.2.3 Durations (N16–N20): the TIME us/ns refusal moves into the lexer (from analysis time-literal-unit). Record
      lit_time_underscore, lit_time_fraction, lit_time_negative, lit_ltime_fraction_ns.
      Where: lex/lexer, literal/value. Acceptance: CA. Depends on: 2.2.2
- [x] 2.2.4 Dates, TOD, DT (N21–N25): calendar decode in literal/calendar. Record lit_date_month_13, lit_tod_hour_25,
      lit_dt_leap_day, lit_ldt_nanoseconds.
      Where: literal/calendar, lex/vocabulary. Acceptance: CA. Depends on: 2.2.3
- [x] 2.2.5 Strings and escapes (S1–S9): the WSTRING `$hhhh` refusal moves into the lexer (from analysis wstring-escape). Record
      lit_wstring_named_escapes, lit_string_double_quote_inside, lit_wstring_single_quote_inside.
      Where: lex/lexer, literal/string. Acceptance: CA. Depends on: 2.2.4
      **Gate 2.2.1–2.2.5 (2026-10-01).** Fixtures: `fixtures/grammar/literals.ts`, 60 `lit_*` — every name the tasks list, and
      per rule the cells that separate its readings: bases 3/4/10/12 and a digit each base lacks (N3–N6), every bit-string width
      and base (N8/N9), `INT#+5`/`UINT#-5`/`INT#-16#10` (N10), `1.5E+3`/`2E3` (N12a), `BOOL#TRUE/FALSE/0/1/2` (N15), a fraction on
      every unit class and `_` after a unit (N20), month/day/Feb-30/before-1970/hour/minute/second/non-leap (N24), every named
      escape in both cases and both widths (S3/S8). Recorded `record:language` on CODESYS and TwinCAT (identical verdicts on
      all 60 but `lit_ldt_nanoseconds`, TwinCAT has no LDT) and `record:exec` on CODESYS (34 build; all 34 `confirmed`,
      both backends; 26 `refused`). Measured: `10#` IS a base; `_` is free in an integer (doubled, trailing, after `#`) but
      ends a duration after a unit; `BOOL#` reads ONE character; `5.` and `T#-…` are refused; a fraction may not stand on the
      smallest unit; out-of-range calendar fields are "Constant '…' too large for type 'DATE'/'TIME_OF_DAY'/'DATE_AND_TIME'";
      WSTRING named escapes and lower-case escapes decode as in a STRING. Fixed (test-first): the lexer ends each literal where
      the vendor does and marks a refused one `Token.malformed` (`lex/lexer.ts`, `TYPED_INTEGER_PREFIXES` in `lex/vocabulary`),
      the parser refuses it as a no-operand keyword (body) or with the pair and `VarDecl.refusedInit` (initializer), the
      statement a resync resumes at is `ExprStatement.resumed` and `flow/no-op-statement` warns it; `literal/calendar`
      validates fields and `types/literal` `literalCapacityType` names the type; `literal/string` decodes named escapes on
      both widths. **The TIME us/ns and WSTRING `$hhhh` refusals moved into the lexer:** `analysis/checks/types/time-literal-unit`
      and `wstring-escape` are deleted; the one type message after them is `declarations/refused-initializer`. On the way:
      `lex_cascade_meets_soft_name_{get,set,override}` now agree on both vendors (the resumed warning). Divergences opened
      (`support/divergences.ts`): `LITERAL_FOLLOW_ON_RULES` (both vendors, 4 — the missing-`;` resume, 2.8.2:
      `lit_invalid_digit_hex`, `lit_time_underscore`; the `.name` primary, 2.5.6: `lit_real_no_leading_digit`; the IL
      operator S as a word, 2.8.3: `lit_time_fraction_ms`), `TWINCAT_WSTRING_ESCAPE_RUNS_TO_END` (TwinCAT, 4 `esc_wstring_*`:
      the literal and every message but "'END_VAR' expected instead of ''" now agree; R3, 2.8.3). Closed: none were marked.
      Rules GAP area 2 **70 → 58** (total 124 → 112): N2, N6, N8, N9, N10, N12a, N12b, N15, N20, N24, S8, S9 closed; N3–N5,
      N19, N22, N23, N25, S3, S6 gain recorded fixtures. Agreement floors CODESYS 2912 → 2982, TwinCAT 2886 → 2954 (3209
      fixtures). `rate:fixtures`: confirmed 2113, refused 933, not-lowered 103, lsp-gap 11, diverges 3. The 0.3 measure asks
      one more question it states (`bound-census.ts`): a bare name inside a refused expression (the resumed `NS;`) is counted,
      as 0.4 counts it untyped — neither side resolves a body that did not parse. Ceilings (all fell): parse findings
      190 → 180 (refused-no-LSP CODESYS 61 → 56, TwinCAT 83 → 78), resolution findings 166 → 162 (TwinCAT recorded-only
      10 → 6), type findings 253 → 249. F (`frontend-snapshot check --base HEAD`): 2400 aspects over 203 sources — every one a
      `lit_*`/`cc_time_*`/`esc_wstring_*` fixture (front and back end; the four `esc_wstring_{dollar,dquote,newline,tab}` back
      ends because a WSTRING named escape now decodes) and `lex_cascade_meets_soft_name_*` (the `resumed` mark); no corpus
      source moved. `bun typecheck` clean; `bun test` 6182 pass / 34 skip / 148 todo / 0 fail (6364 tests, 182 files, 531 s);
      `bun run check` 14 passed, 0 failed; lint clean (warnings only, none new).
- [x] 2.2.6 Typed char, typed STRING, enum literal, UTF8 (S10–S13): record lit_char_typed, lit_wchar_typed, lit_string_typed,
      lit_wstring_typed, lit_enum_typed_value, lit_utf8_string, lit_utf8_non_ascii.
      Where: lex/lexer, literal/string. Acceptance: CA. Depends on: 2.2.5
- [x] 2.2.7 Addresses (A1–A2): record lit_address_incomplete, lit_address_unsized.
      Where: lex/lexer. Acceptance: CA. Depends on: 2.2.6
      **Gate 2.2.6–2.2.7 (2026-10-01).** Fixtures: `fixtures/grammar/literals.ts`, 58 more `lit_*` — every name the tasks
      list, and per rule the cells that separate its readings: each char prefix with each quote, a number, two characters,
      none, an escape, a non-Latin-1 character, lower case, and a BOOL target to make the vendor NAME the type (S10);
      STRING#/WSTRING# with each quote, an escape (S11); an enum value, a missing one, a qualified_only enum (S12); UTF8#
      with ASCII, `ä`, `$21`, a `"`, lower case, into a WSTRING (S13); `%I*`/`%Q*`/`%M*`, `%IW*`, `%MW`, no size, no bit,
      two/three/four segments, an address as an operand, `%ML`, lower case, bit 8 (A1, A2). Recorded `record:language` on
      CODESYS and TwinCAT (58 each) and `record:exec` on CODESYS (14 run; the three `AT %I*`/`%Q*`/`%M*` record "Login
      failed..." each ALONE — no VAR_CONFIG in the recording project — and carry that as `execSkip`). Also recorded on
      TwinCAT for the first time: `tr_12_fmt_long_dates` and the five `xf_l*_call_once` (the census pinned their parse
      errors as "no TwinCAT recording"). Measured: CODESYS reads any `<word>#<operand>` as ONE token — `UCHAR#'…'` and
      `UTF8#'…'` (either case, single quote) are literals, every other pair a COMPONENT ("''A'' is no component of 'CHAR'",
      CHAR/WCHAR are no typed prefixes), an enum's `Type#Value` a value of unknown type; `UCHAR#'A'` is UDINT 65 only in
      capitals with one decoded character, else the token is a STRING of its own text less its first and last character
      (`UCHAR#'AB'` runs as 'CHAR#$'AB', `utf8#'a'` as 'tf8#$'a'); `UTF8#'ä'` is STRING(INT#2); `STRING#`/`WSTRING#` are
      refused words on both vendors; TwinCAT refuses EVERY `<word>#` it has no literal for, as one token. An address's `*`
      stands only after the area (`%IW*` is `%IW` then `*`); an address with a size and no position is "Direct address
      expected after AT instead of %IW" and the declaration is lost; no size letter or the wrong segment count (X two,
      B/W/D/L one) is "Direct address '%I?0.0' malformed"; the bit is not checked against a byte (`%MX10.8` builds).
      Fixed (test-first): `lex/lexer` (`TWINCAT_LITERAL_PREFIXES`, `QUOTED_LITERAL_PREFIXES`, `REFUSED_LITERAL_PREFIXES` in
      `lex/vocabulary`; a refused `<word>#` is a `Token.malformed` typed literal, so the PARSER refuses it with its cascade —
      the source scan in `analysis/checks/names/refused-name` is deleted; CHAR/WCHAR leave `TYPED_PREFIXES`; the address's
      `*`), `literal/value` `typedLiteralForm`, `literal/string` `decodeUtf8Literal`, new `literal/address` `addressShape`,
      `types/literal` (UCHAR UDINT/STRING, UTF8 STRING, component UNKNOWN), `parse/expression` (an incomplete address is
      no operand), `parse/declarations` `refuseAtOperand` (the no-position AT refusal is the parser's, a `ParseError` fact
      `directAddressExpected`), `parse/errors` (a refused prefix echoes whole), new check `analysis/checks/types/
      typed-literal` (no component), `analysis/hole` (a malformed address operand and an enum `Type#Value` are holes on
      their own evidence), `expr-echo` (the `?` echo), `rules` `stringLiteralMessageType` (STRING(INT#n) for the quoted
      typed literals), `at-address` (malformed; lost uses), `unknown-source` (the target in the compiler's form).
      On the way: `ldate_ltod_ldt` left `TWINCAT_TRIAGE` (its LSP-only messages are gone); `src/transpile/lower/
      init-sequence.test.ts` wrote `AT %MQ8`, which is no address (the parser now refuses it) — `%I*` is the unmodelled
      address it meant (the one transpile edit, a test premise). Divergences opened (TwinCAT): `TWINCAT_MALFORMED_ADDRESS_
      ALIGNMENT` (2, the granularity warning on a malformed address; niche, accepted loss), `TWINCAT_LDATE_CASCADE_STOPS_
      IN_A_FUNCTION` (5 `xf_l*_call_once`, → 2.8.2/2.8.3). Closed: none were marked.
      Rules GAP area 2 **58 → 53** (total 112 → 107): S10, S11, S12, S13, A2 closed; A1 gains its recorded cells.
      Agreement floors CODESYS 2996 → 3054, TwinCAT 2968 → 3025 (3285 fixtures). `rate:fixtures`: confirmed 2131, refused
      987, not-lowered 104, lsp-gap 11, diverges 3, unaskable 49. Two measures ask one more question they state: 0.1
      counts TwinCAT's parse errors per line once, as the LSP reports them (`dumps.ts` `parseErrors`, TwinCAT's
      `dedupePerLine`); 0.4 also matches a string literal by its message form STRING(INT#n) and an untyped expression by
      the compiler's echo (`bound-census.ts`). Ceilings (all fell): parse findings 180 → 135, resolution findings
      162 → 155 (TwinCAT bare NONE 45 → 38), type findings 245 → 232 (TwinCAT binary/call/ident UNKNOWN 1160/694/115 →
      1155/689/111). F (`frontend-snapshot check --base HEAD`, HEAD still without 2.2.1–2.2.5): 5373 aspects over 743
      sources, of them this step's 2287 over 319 — the new `lit_*` fixtures and the sources holding the rules' prefixes
      on TwinCAT (`xf_l*`, `cc_ld*`/`cc_lt*`/`cc_fp_ldate*`, `tr_12_fmt_long_dates`, `ldate_ltod_ldt`,
      `operand_uchar_literal`); no corpus or library source moved. `bun typecheck` clean; `bun test` 6243 pass / 34 skip
      / 149 todo / 0 fail (6426 tests, 184 files, 530 s); `bun run check` 14 passed, 0 failed; lint clean (warnings only,
      none new).
      **Gate re-run 2.2b (2026-10-01, before commit):** `bun typecheck` clean; `bun test` 6255 pass / 34 skip / 149 todo /
      0 fail (6438 tests, 184 files, 543 s; `fixtures.test.ts` recomputes every `map.generated.ts` row and agrees — the map
      is current); `bun run check` 14 passed, 0 failed; `bun run lint` exit 0 (warnings only), layering 1 known violation.
      Committed together with 2.2.1–2.2.5: their gate passed but was never committed, and both batches share the same
      files (lexer, literals, divergences, recordings, baselines, the map), so they cannot be split.
- [x] 2.3.1 VAR section kinds (D1–D5): VAR_ACCESS dispatched at file scope with its path syntax. Record decl_var_access,
      decl_var_access_read_only, decl_var_generic.
      Where: parse/declarations, parse/parser. Acceptance: CA. Depends on: 1.41
- [x] 2.3.2 Qualifiers (D6–D7): the NON_RETAIN refusal moves into the parser (from lost-declaration). Record
      decl_non_retain_in_gvl, decl_constant_retain.
      Where: parse/declarations. Acceptance: CA. Depends on: 2.3.1
- [x] 2.3.3 Names and AT (D8–D11): the AT-operand refusal moves into the parser (from at-address / lost-declaration). Record
      decl_at_after_type, decl_at_not_an_address, decl_at_incomplete_in_program.
      Where: parse/declarations. Acceptance: CA. Depends on: 2.3.2
- [x] 2.3.4 Initializers and aggregates (D12–D17): record decl_repeat_count, decl_nested_aggregate, decl_bracket_init_no_assign,
      decl_struct_init_missing_field.
      Where: parse/initializer, parse/declarations. Acceptance: CA. Depends on: 2.3.3
- [x] 2.3.5 One declaration parser for struct fields (D19, U23): `parseStructField` → `parseVarDecl`. Record
      decl_struct_field_soft_name, decl_struct_field_ref_init, decl_struct_field_at, decl_var_inside_struct.
      Where: parse/declarations, parse/units/type-decl. Acceptance: CA. Depends on: 2.3.4
      **Gate 2.3.1–2.3.5 (2026-10-01).** Fixtures: `fixtures/grammar/declarations.ts`, 74 `decl_*` — every name the tasks list
      (`decl_var_generic` instanced `FB<6>`; `decl_repeat_count_expression` asks `[INT#2+INT#3(7)]`), and per rule the cells
      that separate its readings: VAR_ACCESS at file scope with and without a direction, to a path that does not exist, its
      name read, in an FB, in a STRUCT (D4); VAR_GENERIC with and without CONSTANT, read, instanced with and without its value
      (D5); every qualifier order and repeat, on VAR_INPUT/VAR_OUTPUT/VAR_TEMP (D6); NON_RETAIN as a name and after VAR,
      VAR_INPUT, VAR_GLOBAL, RETAIN (D7); a trailing comma, AT after a name list (D8/D9); AT after the type, with an
      initializer, twice (D10); an integer, a string, nothing as the AT operand (D11); REF= on a value, `:= ;` (D12); repeat
      counts short, long, empty, mixed, an expression, a name's call (`[K+L(7)]`); nested, flat, ARRAY OF ARRAY, repeated
      lists (D15); a bracket list without `:=` on an array, a scalar, an FB array (D16); positional and unknown-field struct
      initializers (D14); a STRUCT field's soft name, reserved name, REF=, AT before and after the type, stray token, bracket
      list, name list (D19); every one of the twelve section keywords inside a STRUCT (U23). Recorded `record:language` on
      CODESYS and TwinCAT (74 each) and `record:exec` on CODESYS (29 build; 28 run; `decl_at_incomplete_in_program` is
      "Login failed...", `execSkip` as `lit_address_incomplete`). Measured: VAR_ACCESS builds at file scope and binds nothing
      (the list's object is no name: "Identifier 'GVL_…' not defined"), and is "Unexpected token 'VAR_ACCESS' found" in a POU;
      VAR_GENERIC is CODESYS's alone, CONSTANT only, one value per constant ("Generic Functionblock 'X' expects exactly '1'
      number of Generic Constant Definitions"); NON_RETAIN is a NAME on both vendors — `VAR NON_RETAIN x : T;` is "',, AT or
      :' expected instead of 'x'"; AT after the type is no grammar ("';, :=, REF=, ( or [' expected instead of 'AT'", the
      declaration stands without it); any AT operand but an address is "Direct address expected after AT instead of <it as
      written>" (`:` when there is none) and the declaration is dropped; a repeat count is the expression before a LITERAL's
      group, a NAME's group is a repeat only alone (C0162 `i(7)`) and a call inside an expression; a 2-D array is
      initialized flat (CODESYS SP21 throws a NullReferenceException on nested lists, TwinCAT "Unexpected array
      initialisation"); `[` after the type takes `(…)` elements only (an FB array's, passed to FB_Init); `(1, 2)` is an
      expression wanting its `)`; a STRUCT field is a declaration in every respect; a VAR section in a STRUCT is named by its
      placement ('VarInput'/'VarOutput'/'VarInOut', "VAR_TEMP declaration not allowed…", VAR_GLOBAL's and VAR_CONFIG's lists,
      none for VAR/VAR_EXTERNAL) and echoed whole ("Variable declaration expected instead of VAR\r\n\ta:INT := 5;…", no
      keyword for VAR_INST/VAR_CONFIG). Fixed (test-first, `parse/declarations.test.ts`, `initializer.test.ts`, the
      checks' own tests): `parse/declarations` — ONE declaration parser for VAR lists, STRUCT/UNION fields and VAR_ACCESS
      paths (`parseStructField` deleted; `parseDeclInto`), `refuseNameAfterName`, `refuseAtOperand` (every non-address,
      `VarDecl.atRefused`), `endAfterType` takes `AT`, `parseInitializer` (`:= ;`, `refuseEmptyRepeat`,
      `refuseBracketElement`, `positionalStructInit`), `refuseSectionInStruct` (facts `ParseError.sectionInStruct`,
      `sectionEcho`, worded in `analysis` parse-errors), `collectVarSections` refuses VAR_ACCESS, `collectListSections`;
      VAR_GENERIC must be CONSTANT; `parse/parser` dispatches VAR_ACCESS; `parse/type-expr` reads `FB<…>`
      (`NamedType.genericArgs`, printed); `parse/initializer` the measured repeat rule; `lex/vocabulary` NON_RETAIN is no
      keyword, VAR_GENERIC is CODESYS-only; `parse/errors` "Identifier expected" capitalised as both vendors write it;
      `symbols/binder` binds nothing of a VAR_ACCESS list nor of a declaration whose AT was refused. **The NON_RETAIN and
      AT-operand refusals moved into the parser:** `var-section-placement`'s NON_RETAIN rule and `at-address`'s operand
      message and lost uses are deleted (the uses are plain unresolved names now); `lost-declaration` serves VAR_EXTERNAL
      alone. Analysis on the way (each a recorded cell): `reference-assign` "Initialisation with REF= is only allowed for
      variables of type REFERENCE TO", `struct-init` an unknown field, new `oop/generic-instantiation`, `array-init` a nested
      list on a 2-D array, `unknown-source` no "no structured variable" on an undefined name (`decl_var_access_used`).
      Catalog C0173's `expect` was the pre-SP21 wording; it now holds the recorded `codesysActual`. Divergences opened
      (`support/divergences.ts`): `DECLARATION_RECOVERY` (both, 6, → 2.8.2), `LITERAL_ONE_IS_BIT` (both, → 4.1.3),
      `EXTERNAL_LOOKUP_IN_A_REFUSED_SECTION` and `GVL_MEMBER_NOT_DECLARED` (both, → 3.1.3), `CALL_IN_AN_AGGREGATE_INITIALIZER`
      (both, the calls check, LSP review), `TWINCAT_NON_RETAIN_RECOVERY` (4, → 2.8.2), `TWINCAT_NO_VAR_GENERIC` (4, → 2.8.2),
      `TWINCAT_DRIVER_CUTS_THE_ECHO` (11, the TwinCAT driver cuts a message at a line break — a bridge bug),
      `CODESYS_DECLARATION_DIVERGENCES` (the compiler crash; FB_Init matching, LSP review), `decl_persistent_retain` in the
      VAR_PERSISTENT family. `MEASURED_SILENT` += `decl_bracket_init_no_assign_fb`, `decl_repeat_count_expression_names`.
      Rules GAP area 2 **53 → 45** (total 107 → 99): D4, D5, D10, D11, D15, D16, D19, U23 closed; D6–D9, D12–D14 gain recorded
      cells. Agreement floors CODESYS 3069 → 3128, TwinCAT 3036 → 3081 (3373 fixtures). `rate:fixtures`: confirmed 2158,
      refused 1041, not-lowered 108 (four new: an AT on a name list, REF= in a STRUCT, two VAR_GENERIC — the transpiler's),
      lsp-gap 13, diverges 3, unaskable 50. Two measures ask one more question they state (`bound-census.ts`): 0.3 counts a
      member read off a name the vendor reports undefined as its root (`decl_var_access_used`), and 0.4 tells a SIZEOF/ADR
      call's UNKNOWN apart — on an untyped operand (the operand's), or the operator's missing result type (its own measure,
      ceilinged, → 4.3.4): `[SIZEOF(T)]`/`ADR(x)` in an initializer were misread as repeat counts named SIZEOF/ADR (112 corpus
      library declarations moved `ident_expr` → `call`). Ceilings (all fell or new): parse findings 135 → 132, resolution
      findings 155 → 154, type findings 232 → 226 (the dropped AT declarations type as the vendor's holes). F
      (`frontend-snapshot check --base HEAD`): 2963 aspects over 405 sources — 2664 of them the new `decl_*` fixtures, the
      NON_RETAIN/AT fixtures (`lex_keyword_*_non_retain`, `var_non_retain`, `cc5_at_address_not_direct`,
      `lit_address_incomplete_sized`, `_no_position`), back ends of the new fixtures, and three corpus sources × 4 projects
      (`L_CT1P_AUTOTUNING`, `TYPEDESC_OPCUABUILTINTYPE`, `IMM_Default`: an `ADR(…)`/`SIZEOF(…)` initializer value is the call it
      is, no longer a repeat). `bun typecheck` clean; `bun test` 6323 pass / 34 skip / 153 todo / 0 fail (6510 tests, 186 files,
      561 s); `bun run check` 14 passed, 0 failed; `bun run lint` exit 0 (warnings only), layering 1 known violation.
      **Review fixes (2026-10-01).** Five more cells recorded on both vendors (`record:language`): `decl_var_generic_two_values`
      (the count message holds for two values too; TwinCAT → `TWINCAT_NO_VAR_GENERIC`), `decl_at_after_type_in_gvl` (the AT
      refusal holds in a GVL), `decl_array_init_positional` (`(1, 2)` on an ARRAY is the same two parse errors; the vendor's
      BIT → `LITERAL_ONE_IS_BIT`), `decl_struct_init_nested_unknown_field` and `decl_union_init_unknown_field` (the unknown-field
      pair holds nested and on a UNION). Fixed test-first: a `.gvl` opening with VAR_ACCESS is read (`OPENING_KEYWORDS`; the
      formatter wiped it to "\n"); `FB<…>` values are read on the main cursor (`parseGenericValue`), a malformed list is
      refused where it breaks, skipped no further than its declaration, and marked `NamedType.genericRefused` (not counted);
      `struct-init` skips a struct with an unresolved base (`hasUnresolvedBase`) and recurses into a field's own
      initializer; an FB array's `[(…)]` without `:=` is `VarDecl.initOp: "FB_Init"`, printed back operator-less
      (`initOperatorText`). Census: "unknown on the vendor too" is asked before the SIZEOF/ADR split; `call UNKNOWN, on an
      untyped operand` is ceilinged (`baseline.test.ts` now fails any uncapped disagreement count); a GVL's name qualifying
      its variable is counted apart, no value (corpus `ident_expr UNKNOWN` 3561 → 1527, Library Manager 1289 → 171).
      `rate:fixtures`: refused 1041 → 1046. `bun typecheck` clean; `bun test` 0 fail.
      **Review fixes 2.3a (2026-10-01).** Five more cells recorded (`record:language` both vendors, `record:exec` CODESYS
      for the one that builds): `decl_struct_init_unknown_field_in_array` (`ARRAY OF sv := [(c := 1)]`) and
      `_in_field_array` (a field's `[(zz := 1)]`) — the unknown-field pair on both vendors; `decl_var_generic_in_array`
      (`ARRAY[0..1] OF FB<6>` builds and runs), `_no_argument` and `_two_values` (the count message, CODESYS) — TwinCAT
      refuses `<` there too (→ `TWINCAT_NO_VAR_GENERIC`). Fixed test-first: TwinCAT has no `FB<…>` — `parse/type-expr`
      reads the list on CODESYS only (`Cursor.dialect`, given by `parse`, refused by name on a sub-cursor made without
      it; `parseTypeExprFromTokens` takes the dialect) and `endAfterType` refuses the `<` with "';, :=, REF=, ( or ['
      expected instead of '<'", the declaration standing as the plain type (`decl_var_generic*` on TwinCAT; the mark's
      note now says the `<` line agrees and only the VAR_GENERIC recovery differs); a generic value is any expression in
      which `>` is no operator (`parseBinary`'s `closer`) — `G<6 AND 3>`, `G<X = 1>` are read, not refused (no recording
      refuses them); `struct-init` holds a struct value inside an array initializer to the element's struct
      (`structValues`, at the top and as a field's array value); `generic-instantiation` counts an ARRAY OF a generic FB
      by its element; `infer` types a called array element of FB instances (`inst[0]()`) as `inst()` is typed (the new
      fixtures' PLC_PRG raised `call UNKNOWN` by 3 — corpus `call UNKNOWN` 2314 → 2036, fixtures CODESYS 419 → 418).
      Census (`bound-census.ts`, `memberShapes`, tested in `bound-census.test.ts`): a member's root is read from the AST,
      not the dump's previous line (`arr[undefIdx].nope` is `arr`'s), and a GVL's name is counted as qualifying its
      variable only where it IS a member's base. `rate:fixtures`: refused 1046 → 1050, not-lowered 108 → 109
      (`decl_var_generic_in_array`, VAR_GENERIC is the transpiler's — its ceiling raised for measurement). Agreement
      floors CODESYS 3128 → 3137, TwinCAT 3081 → 3086 (3383 fixtures).
      **Gate 2.3a (2026-10-01).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (confirmed
      2158, refused 1050, not-lowered 109, lsp-gap 13, diverges 3, unaskable 50; edges agree 2218 / disagree 0 / not-run
      95); `bun test` 6338 pass / 34 skip / 154 todo / 0 fail (6526 tests, 187 files, 655 s); `bun run check` 14 passed,
      0 failed; `bun run lint` exit 0 (warnings only).
- [x] 2.3.6 Type expressions (T1–T11): one implicit-enum value parser. Record decl_array_of_array, decl_pointer_to_pointer,
      decl_string_brackets, decl_string_length_constant, decl_implicit_enum_with_base.
      Where: parse/type-expr. Acceptance: CA. Depends on: 2.3.5
      **Step 2.3b (2026-10-01).** Fixtures: `fixtures/grammar/type-expressions.ts`, 62 `decl_*`, every name the task lists and
      per rule the cells that separate its readings — T1 no type, a keyword, an unknown qualified type; T2 reversed, from
      constants, on REAL/BOOL/BYTE/an alias of INT, one value after INT and after REAL, UINT's default; T3 `FB()`; T4 reversed,
      one bound, none, no OF, negative, `[*]` in VAR / an FB's VAR_INPUT / a FUNCTION's VAR_INPUT, `[0..1, *]`, `[*, 0..1]`,
      `[*, *]`; T5 a bound from a constant expression and from a variable; T6 ARRAY OF ARRAY indexed both ways, POINTER TO
      POINTER; T7 POINTER without TO, REFERENCE TO REFERENCE, POINTER TO REFERENCE, ARRAY OF REFERENCE, REFERENCE TO ARRAY;
      T8 STRING(0), WSTRING(3) cut, STRING(2+3); T9 STRING[5], WSTRING[3], STRING(N), STRING[N], STRING(n), each closer mix
      for STRING and WSTRING; T10 base, init, next value, empty, trailing comma, a number, duplicate, unclosed, in an ARRAY,
      in VAR_INPUT, in a STRUCT, and the TYPE enum's trailing comma, number, empty; T11 size from a constant, of INT, of BOOL.
      No variable is named `s`/`r` (IL operators — the first batch was re-recorded for it). Recorded `record:language` on
      CODESYS and TwinCAT (62 each, one batch per vendor plus the 8 cells the first answers asked for, and three fixtures
      re-recorded after they were written free of area-4 typing: typed bounds `INT#-3`, `N-INT#1`, POINTER TO POINTER
      declared without ADR), `record:exec` on CODESYS (26 build and run). Measured: `(…)` after a type is a SUBRANGE only
      after an integer or bit string (`INT(5)` "'..' expected instead of ')'"), an argument list after anything else
      (`REAL(0..1)`, `BOOL(0..1)`, an alias: "',' or ')' expected instead of '..'"; `REAL(5)` builds); a dimension wants `..`
      ("'..' expected instead of ']'" for `[5]`, `[]`, `[0..1, *]`) and after a `*` every dimension is one ("'*' expected
      instead of '0'"); a STRING length is `(…)` or `[…]` with either closer, a WSTRING's `(…)` only (`WSTRING[3]` is D16's
      bracket list); an implicit enum takes a base type and a trailing comma, a TYPE enum no trailing comma, neither an
      empty list; a subrange variable starts at its lower bound (`UINT(1..5)` runs as 1). Fixed test-first
      (`parse/type-expr.test.ts`, `declared-type.test.ts`, `const-context.test.ts`, `binder.test.ts`, `types.test.ts`,
      `lower.test.ts`): `parse/type-expr` — ONE enum value parser (`parseEnumValues`, `parseEnumBase`, TYPE enum and implicit
      enum; `trailingComma` the one measured difference; a value followed by neither `,` nor `)` is "', or )' expected"
      after a `:=` value and "':=, , or )' expected" after a bare name — both vendors, corrected by the review below —
      resynced within its declaration), `ImplicitEnumType.baseType` kept and printed (it was consumed and
      dropped), the subrange/argument split by `SUBRANGE_BASE_TYPES` (`lex/vocabulary`), the dimension rules (a refused
      dimension drops its declaration), STRING/WSTRING length closers; `parse/errors` "Type definition expected instead of
      ';'" for a punctuation mark; `symbols/binder` binds an implicit enum's values through an ARRAY; `types/infer` types an
      implicit enum's value as the implicit enum and an index through a REFERENCE TO an array (corpus `ident_expr UNKNOWN`
      1527 → 634 — pro2193's 30 implicit enums); new `analysis` declared-type (border-order, reference-base-type,
      vector-base-type, variable-length-placement, each vendor's words) and const-context string-length-non-const.
      **One transpile edit, not named by this task (Gate T: `src/transpile` was clean, no other run):** `lower.ts`
      `representable` holds an `ARRAY[*]` only in a slot a call lends (VAR_IN_OUT, a routine's VAR_INPUT) — three refused
      fixtures lowered as if every open array were an in-out and the Rust emitter THREW, so `rate:fixtures` could not run.
      Divergences opened (`support/divergences.ts`): `TYPE_EXPRESSION_RECOVERY` (both, 11, in `DECLARATION_RECOVERY`,
      → 2.8.2), `IMPLICIT_ENUM_LIST_RECOVERY` (both, 2, niche: 0 malformed lists in the corpora), `IMPLICIT_ENUM_TYPE_NAME`
      (both, 2, `Implicit_Enum__<POU>__<var>`; not niche, 30 implicit enums in pro2193 → 4.7.4/3.3),
      `STRING_LENGTH_AS_WRITTEN` (both, 3, 'STRING(N)'/'STRING((2 + 3))' and a local constant's length unfolded; not niche,
      581 named lengths → 4.7.4/4.6.2), `UNKNOWN_QUALIFIED_TYPE` (both, 1, `deferred.lsp`, → 3.4.2), `AFTER_A_REFUSED_TYPE`
      (CODESYS 2, TwinCAT 5, niche: 0 occurrences); `decl_subrange_unsigned` `deferred.transpile` (the subrange default,
      → 4.7.1; 83 subranges without an initializer in the corpora). Rules GAP area 2 **45 → 43** (total 99 → 97; 44/98 after the review below,
      T6 reopened): T6, T9 closed; T1–T5, T7, T8, T10, T11 gain recorded cells. Agreement floors CODESYS 3137 → 3178, TwinCAT 3086 → 3124 (3445
      fixtures). `rate:fixtures`: confirmed 2181, refused 1085, not-lowered 111 (ceiling 109 → 111 for measurement:
      `decl_implicit_enum_in_array`, `decl_array_star_in_function_input`), lsp-gap 14, diverges 4, unaskable 50; edges
      agree 2251 / disagree 0 / not-run 96. Ceilings (all fell): corpus member NONE 3712 → 3709, ident_expr UNKNOWN
      1527 → 634, index UNKNOWN 227 → 223, member UNKNOWN 4230 → 4227, fixtures ident_expr UNKNOWN 52 → 47 / 95 → 90,
      index UNKNOWN 34 → 30 / 33 → 29; parse findings 132, fixed-point 16, resolution 154, type 226 unchanged. F
      (`frontend-snapshot check --base HEAD`): 2442 aspects over 353 sources — 248 new fixture sources and their 62 back
      ends; 31 corpus sources (pro2193: 30 implicit enums now carry their `DINT` base IN THE AST and type their values as the one
      `(implicit)` type — no base and no identity in the Type, so a store of one is still unchecked (review below); one
      `CassetteAdjustmentFB` member resolved through a reference index); 12 sources of 6 older fixtures (the implicit enum
      fixtures' spans and value types, `refdecl_to_array`/`xo_reference_index_step` reference indexing,
      `lit_char_typed_in_enum_value` TwinCAT's enum list resync); no corpus `diagnostics` aspect moved.
      **Review fixes (2.3b review, 2026-10-01).** 22 fixtures written for the review's cells and recorded in one
      `record:language` batch per vendor (plus two cells the answers asked for) and one `record:exec` batch: the
      punctuation where a type stands (`decl_type_open_bracket` '[', `_missing_before_init` ':=') confirms the T1
      generalization; TIME/DATE subranges are argument lists ("',' or ')' expected instead of '..'") and __XINT, __UXINT,
      __XWORD subranges build and run; a TYPE enum value followed by neither `,` nor `)` is "':=, , or )'" after a bare
      name and "', or )'" after a valued one on BOTH vendors (`decl_type_enum_missing_comma`, `_value_then_name`) — the
      parser said TwinCAT's second sentence for both, fixed test-first (`type-expr.test.ts`); an `ARRAY[*]` inside another
      type is refused in every section, VAR_IN_OUT too ("… has to be on top level position of a type declaration", each
      vendor's words; `decl_array_star_nested_in_var`, `_in_inout`, `decl_pointer_to_array_star_in_var`), one as a STRUCT
      field by the placement sentence (`decl_array_star_struct_field`), and a METHOD's VAR_INPUT takes one on CODESYS and
      not on TwinCAT (`decl_array_star_in_method_input`) — declared-type `variable-length-nested` and the STRUCT field walk,
      test-first (`declared-type.test.ts`); a refused `ARRAY[5]` used (`decl_array_single_bound_used`): the vendors say
      "Identifier 'a' not defined" and "'a[1]' is no valid assignment target" themselves, the LSP's quiet is missing-only
      (`TYPE_EXPRESSION_RECOVERY`); an implicit enum's value into a BYTE ("Cannot convert type 'IMPLICIT_ENUM__…' to type
      'BYTE'", with or without a base) and into another implicit enum (C0327's warning) — unchecked, the Type has no
      identity for it (`IMPLICIT_ENUM_TYPE_NAME`, `MEASURED_SILENT` for the two refusals). Transpile (the review's
      finding): a reversed ARRAY is refused by name (`array-reversed`, was Rust that did not build; "rejected" 7 → 6),
      an implicit enum's value lowers through an ARRAY OF it (`decl_implicit_enum_in_array` confirmed), a POINTER TO
      POINTER lowers (`pointers.ts`: a pointer's storage is its target's, and a pointer reached through one is keyed as
      itself); the routine `ARRAY[*]` VAR_INPUT stays not-lowered, `deferred.transpile` niche: accepted loss (0 of the
      corpora's 36 `ARRAY[*]` are VAR_INPUT) — not-lowered 111 with the method's in place of the implicit enum's.
      **Held out for the owner:** `decl_array_negative_untyped`, `decl_array_bound_constant_minus_one`,
      `decl_pointer_to_pointer_deref` — recorded on both vendors, the LSP agrees and lowering confirms each, but each
      raises a census ceiling (unary UNKNOWN +4, binary UNKNOWN +2, ADR +2, per vendor: untyped literals and ADR's result
      type are area 4's), so, as `literals.ts`'s A2, they are documented in `grammar/type-expressions.ts` with their
      recorded answers and wait for the owner to accept the rise or for 4.x to type them; T6 is a GAP again (a POINTER TO
      POINTER only declared decides nothing). Comment fixed: an FB's VAR_INPUT refuses an `ARRAY[*]`. Floors CODESYS
      3178 → 3190, TwinCAT 3124 → 3135 (3464 fixtures). `rate:fixtures`: confirmed 2186, refused 1097, not-lowered 111,
      lsp-gap 16, diverges 4, unaskable 50; edges agree 2259 / disagree 0 / not-run 95.
      **Gate 2.3b (2026-10-01).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (confirmed
      2186, refused 1097, not-lowered 111, lsp-gap 16, diverges 4, unaskable 50; edges agree 2259 / disagree 0 / not-run
      95; 148 s). The first full run had 2 fails, both fixed: the error catalog's C0031 still expected Volt's old "expected
      type, got ';'" — the recordings (`decl_type_missing`, both vendors) word a punctuation mark in a type position
      "Type definition expected instead of ';'", the catalog's own `message` form, so its `expect` now says that; and
      `source-map.test.ts` timed out (5.5 s on bun's 5 s default) — profiled first: linear, 3464 fixtures in ~4.0 s,
      ~1.15 ms each, no new fixture above 13 ms, so it was the sweep outgrowing a default, not a regression; the lowering
      moved to registration as `fixtures.test.ts` did. `bun test` 6460 pass / 34 skip / 156 todo / 0 fail (6650 tests,
      190 files, 584 s); agreement CODESYS 3190, TwinCAT 3135 (3464 fixtures); `bun run check` 14 passed, 0 failed;
      `bun run lint` exit 0 (warnings only); layering clean.
- [x] 2.4.1 PROGRAM and FUNCTION headers (U1–U4): record unit_program_return_type, unit_function_no_return_type,
      unit_function_implements.
      Where: parse/units, parse/units/header. Acceptance: CA. Depends on: 2.3.6
- [x] 2.4.2 FUNCTION_BLOCK headers (U5–U10), with one qualified-name AST shape. Record unit_fb_extends_qualified,
      unit_fb_implements_qualified, unit_fb_public, unit_fb_internal.
      Where: parse/units/function-block, parse/names, ast/nodes. Acceptance: CA. Depends on: 2.4.1
- [x] 2.4.3 METHOD/PROPERTY/ACTION modifiers (U11–U17): modifiers become an ordered list in the AST (all unit kinds); the property
      and interface modifier sets are decided by recording. Record unit_method_each_modifier (6), unit_method_override_public_order,
      unit_property_modifiers, unit_property_accessor_modifier, unit_property_no_end_get.
      Where: parse/units/{method,property,action}, parse/names, lex/vocabulary. Acceptance: CA. Depends on: 2.4.2
- [x] 2.4.4 INTERFACE (U18–U21): accessor VAR sections kept in the AST; the unterminated path keeps implementsMisused. Record
      unit_interface_extends_list, unit_interface_implements, unit_interface_property_accessor_var.
      Where: parse/units/interface. Acceptance: CA. Depends on: 2.4.3
- [x] 2.4.5 TYPE (U22–U27): STRUCT EXTENDS accepted in one place; no invented `?` alias. Record unit_type_extends_on_enum,
      unit_type_extends_on_alias, unit_struct_extends_twice.
      Where: parse/units/type-decl. Acceptance: CA. Depends on: 2.4.4
      **Step 2.4a (2026-10-01).** Fixtures: `fixtures/grammar/units.ts`, 81 `unit_*` — every name the tasks list (`unit_method_each_modifier`
      is `unit_method_{public,private,protected,internal,final,override}`) and per rule the cells that separate its readings:
      U1 `PROGRAM P;`; U2 a PROGRAM's return type; U3 `FUNCTION F : INT;`; U4 no return type as a statement and as a value,
      IMPLEMENTS/EXTENDS after the return type; U5 IMPLEMENTS before EXTENDS, a list ending in a comma, one interface twice;
      U7 `EXTENDS Standard.TON`, `EXTENDS NoSuchLib.FB_X`, `IMPLEMENTS __SYSTEM.IQueryInterface`; U8/U9 each access
      modifier, ABSTRACT FINAL, PUBLIC PUBLIC, PUBLIC INTERNAL, FINAL FINAL, FINAL PUBLIC, INTERNAL FINAL, a PRIVATE FB not
      called; U11–U13 `METHOD M : INT;`, each modifier, OVERRIDE (overriding a base), reordered, two access modifiers,
      repeated, ABSTRACT FINAL; U16 the six on a PROPERTY, OVERRIDE, stacked, reordered, `GET PRIVATE`, a getter without
      END_GET (with and without a setter); U17 an ACTION with a VAR section, with a modifier; U18 the seven on an interface
      METHOD and on an interface PROPERTY; U20 EXTENDS a list, IMPLEMENTS, EXTENDS `__SYSTEM.IQueryInterface`; U21 an
      interface getter's VAR and VAR_INPUT; U22 STRUCT EXTENDS after STRUCT, twice, a list, `END_STRUCT;`, no colon;
      U24 `END_UNION;`; U25/U27 EXTENDS on an enum (struct base, enum base), an alias, a UNION, `TYPE X : END_TYPE`; U26 an
      alias without `;`. Recorded `record:language` on CODESYS and TwinCAT (one 75-fixture batch per vendor, then the six
      cells the answers asked for, then seven re-recorded after their sources were made to ask one question — typed
      literals `INT#1`, an undeclared FB declared and not called, `unit_struct_extends_list` as one TYPE), `record:exec`
      on CODESYS (47 cases, 5 refused there; then the 6 interface properties after the loader fix below and the 2 retyped
      functions). Measured (both
      vendors unless named): an access modifier stands only FIRST — `FINAL PRIVATE`/`PUBLIC PRIVATE` on a METHOD is
      "Identifier expected instead of 'PRIVATE'", `FINAL PUBLIC` on a PROPERTY "Unexpected token 'PUBLIC' found" + "';'
      expected instead of 'P'", and on an FB (`PUBLIC PUBLIC`, `PUBLIC INTERNAL`, `FINAL PUBLIC`) no FB is declared and
      nothing is said of the header; a repeated FINAL builds; OVERRIDE is NO modifier — CODESYS reads `METHOD OVERRIDE M`
      as a method named OVERRIDE ("The name used in the signature is not identical to the object name", record:exec; the
      push refuses every OVERRIDE header, `vendorRefuses`); PRIVATE/PROTECTED on an FB or an interface member is "PRIVATE
      and PROTECTED may only be applied on methods of function blocks" (TwinCAT "functionblocks"; an interface PROPERTY's
      is CODESYS's alone), plus "Cannot access private method ???.FB" at the call; ABSTRACT with FINAL is "A method or
      functionblock cannot be ABSTRACT and FINAL"; a FUNCTION reads IMPLEMENTS/EXTENDS only after its name — after the
      return type it is "Unexpected token 'IMPLEMENTS' found" + "';' expected instead of '<name>'" and the declaration
      recovery after it; IMPLEMENTS before EXTENDS likewise; a qualified base or interface builds (`Standard.TON` on
      CODESYS; TwinCAT has no `Standard` namespace); EXTENDS stands on the TYPE only (`STRUCT EXTENDS` is "Unexpected
      token 'EXTENDS' found") and names one base ("':' expected instead of ','"); an alias REQUIRES its `;`, an enum takes
      one, a STRUCT or UNION refuses it ("'END_TYPE' expected instead of ';'"); a refused token is consumed and the end of
      the object quoted '' (`TYPE X : END_TYPE`: three messages); EXTENDS on an alias is "Keyword EXTENDS not applicable to
      type <base>" (TwinCAT names the type) + "Inheritance only allowed in function blocks, interfaces and structures"
      (TwinCAT "Functionblocks, Interfaces and Structures"), on an enum C0144 only with an enum base (any other: "No
      definition found for base class"), on a UNION CODESYS's warning; a variable an interface accessor declares is refused
      ("Only inputs, outputs, and inouts allowed in interface methods"; VAR_INPUT "It is not allowed to define input
      variables in property accessors: scratch : INT", record:exec). Fixed test-first (`parse/units/{function-block,method,
      property,program,type-decl,interface}.test.ts`, `binder.test.ts`, `extends.test.ts`, `header-rules.test.ts`,
      `inheritance.test.ts`, `format.test.ts`): modifiers are ONE ordered list in the AST on every unit kind
      (`FunctionBlock`/`Method`/`Property` `modifiers`; `accessModifier`/`final`/`abstract`/`override` deleted, consumers
      read the list), ONE member modifier set (`MEMBER_MODIFIERS`, decided by recording — `PROPERTY_MODIFIERS`,
      `INTERFACE_MEMBER_MODIFIERS` deleted, OVERRIDE out, `ACCESS_MODIFIERS` + `names.refusedAccessModifier`), FB
      `headerRefused` (the binder declares no symbol); ONE qualified-name shape (`names.readHeaderName`/`readHeaderNames`,
      every EXTENDS/IMPLEMENTS of FB, FUNCTION and INTERFACE; "Identifier expected" where none stands), a qualified base
      linked through its library's manifest namespace (`extends.qualifiedCandidates`; `inheritance` reads the linked base
      first); `header.refuseLateClauses`; `PROGRAM P;`; the interface accessor VAR sections KEPT (`getterVarSections`/
      `setterVarSections`) and the unterminated INTERFACE keeps `implementsMisused`; TYPE: EXTENDS in one place, a refused
      header skipped through its `;`, the `;` per body kind, `RefusedBody` in place of the invented `?` alias, a span that
      covers what it consumed (`Cursor.previous`); analysis `header-rules` (access-only-on-methods, abstract-and-final,
      interface-member-variable, the measured C0144); the printer writes every header clause as written (modifier order, a
      FUNCTION's IMPLEMENTS, a PROGRAM's return type, an FB's second base, a TYPE's EXTENDS on its own line and its
      initializer, an interface's IMPLEMENTS and accessor VARs) — it had moved a STRUCT's EXTENDS to where both vendors
      refuse it and dropped all the rest (fixed-point findings 16 → 6). Harness: `record:exec`'s loader wrote an interface
      property SYNTHESIZED (`PROPERTY <name> : <type>`, accessors empty), so the U18/U21 property cells were never asked as
      written — it writes the text now (`fixture-units.ts`); the two run entries the buggy load had written for
      `unit_action_modifier` and `unit_interface_property_override` were removed (both `execSkip` now, with the reason);
      the parse census counts a fixture whose PUSH the vendor refuses (`vendorRefuses`) instead of finding it unrecorded.
      Divergences opened (`support/divergences.ts`, each niche: accepted loss, 0 occurrences in the corpora unless named):
      `UNIT_HEADER_RECOVERY` (both, 9, the vendors' recovery after a refused header → 2.8.2), `ACTION_HEADER_DROPPED_BY_THE_
      PUSH` (both, 2), `FB_ACCESS_AT_THE_CALL` (both, 2, → 3.5), `ENUM_TO_ENUM_IS_A_WARNING` (both, 1, an LSP-only error,
      → 4.5.1), `TWINCAT_UNIT_DIVERGENCES` (4: the unresolved base's silence → 3.2.4, "Unknown type" on TwinCAT).
      **For the owner — a bridge data loss found on the way (volt-cli, not this step's):** the push DROPS text silently in
      three shapes the LSP reads: a getter not closed by END_GET (`unit_property_no_end_get`, `_alone`: `StReader.
      ReadProperty` closes it as a BARE accessor, so its body `P := stored;` never reaches the IDE — the build succeeds
      with an empty getter), an ACTION's VAR section, and a modifier on an ACTION or an accessor (`GET PRIVATE`).
      Rules GAP area 2 **44 → 35** (total 98 → 89): U2, U4, U7, U9, U13, U16, U20, U21, U27 closed; U1, U3, U5, U8, U11,
      U12, U17, U18, U22, U24–U26 gain recorded cells. Agreement floors CODESYS 3190 → 3250, TwinCAT 3135 → 3191 (3545
      fixtures). `rate:fixtures` (reproduces the map byte-identically): confirmed 2223, refused 1137, not-lowered 113
      (ceiling 111 → 113 for measurement: `unit_fb_extends_qualified` `layout-base`, `unit_type_extends_on_union`
      `layout-union` — the transpiler's), lsp-gap 16, diverges 4, unaskable 52; edges agree 2310 / disagree 0 / not-run 98.
      Ceilings: parse findings 132, resolution 154, type 226 unchanged; fixed-point findings 16 → 6, files not a fixed point
      13 → 3. F (`frontend-snapshot check --base HEAD`): 18557 aspects — 15451 `ast` (the AST's new shape: `modifiers`,
      the interface accessors' VAR sections, on every unit), 3105 the new fixtures' sources and back ends, and ONE more:
      `decl_var_generic_inside_struct`@twincat `errors` (the refused END_VAR consumed: "unexpected identifier 'b' at
      file scope" for "unexpected keyword 'END_VAR' at file scope", both LSP-only in a known divergence); no corpus
      diagnostics, resolution or types aspect moved. Targeted: `bun test src` 1511 pass / 0 fail, `test/conformance` 4833
      / 0, `test/frontend` 29 / 0; `bun x tsc --noEmit` clean; `bun run lint` (layering 1 known violation).
      **2.4a review fixes (2026-10-01).** (1) The accessor cells were the push's rewrite, not the text: `unit_property_
      no_end_get`, `_alone` and `unit_property_accessor_modifier` carry `execSkip` (`pushRewrites`, rated unaskable, run
      entries removed) and U16 is a GAP again (area 2 **35 → 36**, total 89 → 90) — its modifier cells closed, its
      accessor cells (and a setter without END_SET) unaskable until the bridge carries the text. (2) A refused FB is no
      base: `Scope.undeclared`, skipped by `linkExtends` (`unit_fb_extends_refused`: CODESYS both messages, TwinCAT the
      first). (3) Recorded (one batch per vendor) and fixed: `unit_property_abstract_final`, `_final_twice` and the
      interface property's `_abstract_final`/`_final_public_order` — a PROPERTY takes one of FINAL/ABSTRACT after its access
      modifier (`names.refusedPropertyModifier`/`readPropertyModifiers`, FB and interface alike); an interface METHOD's
      access modifier after FINAL ("Identifier expected", recovery → `UNIT_HEADER_RECOVERY`) and ABSTRACT FINAL (C-error,
      both); an interface METHOD's VAR_TEMP/VAR_STAT/VAR_INST (both vendors; TwinCAT's "Only Inputs, Outputs and Inouts
      allowed in Interface Methods"); an accessor's VAR_OUTPUT/VAR_IN_OUT (record:exec: the implementer's `__GETVAL`
      mismatch, `deferred.lsp` niche, lsp-gap ceiling 17 → 18). (4) The parse census measures a push-refused fixture
      against its CODESYS record:exec refusal; `unit_method_override` and `_public_order` re-recorded on today's parser
      (OVERRIDE still a name: "Unexpected token 'INT' found" + "';' expected instead of 'M'"); `unit_property_override`
      and `unit_interface_method_override` `execSkip` (`loaderNamed`: their answer moves with the parser's object naming).
      (5) TwinCAT read-back after the push keeps `PROPERTY PRIVATE Val` on an interface — the vendor split stands.
      (6) Skipped: a library enum base IS found (`lookupLocal` on the project holds library units), and a project unit named
      like a namespace resolves the base and the type alike — neither reproduces.
      **Gate 2.4a (2026-10-01).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (3557
      fixtures, 174 s: confirmed 2220, refused 1145, not-lowered 113, lsp-gap 18, diverges 4, unaskable 57; edges agree
      2316 / disagree 0 / not-run 98). The first full run had 1 fail, fixed: the error catalog's C0144 still expected
      "Inheritance only allowed in …" for its repro — an ENUM extending a STRUCT — but both vendors answer that repro
      "No definition found for base class 'Base'" (its own `codesysActual`/`twincatActual`, and fixture
      `unit_type_extends_on_enum`; C0144 stands only with an enum base, `unit_enum_extends_enum`), which the LSP now says,
      so its `expect` says that. Agreement floors raised to the measured CODESYS 3250 → 3259, TwinCAT 3191 → 3200 (the
      2.4a review's cells). `bun test` 6566 pass / 34 skip / 158 todo / 1 fail → the catalog file 146 / 0 after the fix
      (6759 tests, 195 files, 515 s); `bun run check` 14 passed, 0 failed; `bun run lint` exit 0.
- [x] 2.4.6 NAMESPACE (U28): a multi-object fixture shape. Record unit_namespace_block, unit_namespace_nested,
      unit_namespace_method_after_fb.
      Where: parse/units/namespace, test/conformance support (the multi-object shape). Acceptance: CA. Depends on: 2.4.5
      **Step 2.4b (2026-10-01).** A project holds NO namespace object (the wire has no such kind; a namespace is a library's,
      named in its manifest), so the "multi-object shape" is an FB object's TEXT wrapping its unit: `fixtures/grammar/units.ts`
      `namespaced()` pushes it AS SENT (`execSkip`: no program runs the FB, and there is no namespace object for record:exec
      to load). Fixtures (4): `unit_namespace_block`, `_nested`, `_method_after_fb` — Volt's push REFUSES each on both
      vendors before either IDE sees it ("'FB_LANG_…', line N: expected METHOD/ACTION/PROPERTY, got: END_NAMESPACE",
      `vendorRefuses`, the engine's shared `StReader`; measured on both); so `unit_namespace_opening_only` asks the one
      namespace text the push hands an IDE, the keyword line alone: CODESYS and TwinCAT both declare nothing and say NOTHING
      about the text — only "Unknown type: 'FB_LANG_…'" where PLC_PRG declares it (record:language, one batch per vendor).
      Disagreements, fixed test-first (`parse/units/namespace.test.ts`, `services/formatting/format.test.ts`): (1) the LSP
      read a namespace block clean where the push refuses it — END_NAMESPACE is now reported on its line, as the push refuses
      it (as `%FOLDER` and the retired comments are); (2) an unterminated NAMESPACE was an LSP-only error ("unterminated
      NAMESPACE") where both vendors are silent — removed; (3) the printer closed a NAMESPACE with an END_NAMESPACE nobody
      wrote (fixed-point finding on `unit_namespace_opening_only`) — `Namespace.closer` holds the written one, absent on an
      unterminated block and on a library's synthesized namespace. Divergence opened: `TWINCAT_UNIT_DIVERGENCES` +
      `unit_namespace_opening_only` (TwinCAT "Unknown type", which the LSP has no standing to say there — the class the
      three 2.4a FB cells are in; niche: accepted loss, 0 occurrences in the corpora: their 695 NAMESPACE lines are all
      library manifests', no source holds a block). Rules GAP area 2 **36 → 35** (total 90 → 89): U28 closed (fixture
      `unit_namespace_opening_only` + the two namespace unit tests). **For the owner:** Y17/Y18 (area 3: "units inside a
      source NAMESPACE block are scoped and analysed", "a METHOD after an FB inside a NAMESPACE parents to that FB") ask about
      a text no workspace file can carry past the push — they are likely moot, and the binder's source-namespace path
      (`ingestNamespace`) serves only text the push refuses; left for 3.x to decide. Agreement CODESYS 3259 → **3260** (floor
      raised), TwinCAT 3200 (3561 fixtures). `rate:fixtures` (map regenerated): confirmed 2220, refused 1145, not-lowered
      113, lsp-gap 18, diverges 4, unaskable 57 → 61; edges agree 2316 / disagree 0 / not-run 98. Baselines (counts only,
      no finding or ceiling rose): parse census (the push refuses it, LSP parse error +3 per vendor; refused, no LSP parse
      error +1), fixed point (fixture files 7114 → 7122), resolution, types (literal UNKNOWN +4 per vendor — the namespaced
      bodies; the three refused blocks are declared in PLC_PRG and not called, as an undeclared FB is asked). F (`frontend-
      snapshot check --base HEAD`): 148 aspects over 20 sources — all the four new fixtures' (own + PLC_PRG × 2 vendors, and
      their back ends); no other source moved. Targeted: `bun test` src/frontend/syntax + symbols + services/formatting +
      test/conformance/fixtures.test.ts + test/frontend 2832 + 29 pass / 0 fail (VOLT_SKIP_RUST=1); `tsc --noEmit` clean.
      **Review fixes (2.4b).** (1) END_NAMESPACE is reported only in a POU (`object === "pou"`, `reportNamespaceClosers` in
      parser.ts), where the push refuses it: a GVL's and a DUT's text is written as sent, and text that is no workspace
      file is no push's. (2) The bridge DROPPED any line after END_INTERFACE in silence; `StReader` now refuses it naming
      the line ("nothing may follow END_INTERFACE", `InterfaceHeaderBoundaryTests`). The LSP does not report that line:
      niche, accepted loss (0 of the corpora's 97 project interfaces; a library's materialized interface writes its methods
      there and is never pushed, so a rule needs the file's library-ness). (3) A qualified `NS.F` under an opening-only
      NAMESPACE still resolves: niche, accepted loss (0 source NAMESPACE lines) — no qualified type name is checked for being
      unknown, so not binding the namespace would not give the diagnostic. (4) The stray-in-NAMESPACE message no longer
      offers END_NAMESPACE. Baselines re-measured (counts only: the TwinCAT `unit_namespace_opening_only` divergence mark).
- [x] 2.4.7 The Volt format (FMT1–FMT8): unit tests only, one per rule, under the titles design.md §4 2.10 names (most moved in
      1.24; the missing ones written here).
      Where: syntax/format/*.test.ts. Acceptance: every FMT row's test title exists (rules.test); F unchanged (no product change
      unless a test finds a bug, which is then fixed test-first and noted). Depends on: 2.4.6
      **Step 2.4b (2026-10-01).** Rule by rule, each clause of each FMT row against a named test (`test/frontend/rules.ts`):
      FMT1 — whole line, outside comments, nothing else on it: listed; ADDED to the row the clauses it lacked: the stated
      language selects the reader on members and accessors, the line is taken out of the body, and a body without the line
      (the push's refusal; `server/implementation-keyword-diagnostics.test.ts`). FMT2 — "never for ST" listed (the existing
      "UNSUPPORTED never stands after ST…" test), and "the body under it is empty" had no format test: WRITTEN,
      `implementation-line.test.ts` "code, a comment or a pragma under an UNSUPPORTED line is refused naming the line, and read
      by neither reader" (CFC and LD; code, `//`, `(* *)`, a pragma, a network — the push refuses any non-blank text there,
      `StReader.Body`). FMT3, FMT4, FMT6, FMT7, FMT8: every clause already has its test. FMT5 — the interface member's folder
      test ADDED to the row. No test found a bug: no product change, F unchanged by 2.4.7. rules.test: every listed title
      exists (352 rules; FMT rows carry tests, no GAP).
      **Gate 2.4b (2026-10-01).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (3561
      fixtures: confirmed 2220, refused 1145, not-lowered 113, lsp-gap 18, diverges 4, unaskable 61; edges agree 2316 /
      disagree 0 / not-run 98). `bun test` 6579 pass / 34 skip / 158 todo / 0 fail (6771 tests, 196 files, 225 s, rustc
      cache on); agreement CODESYS 3260, TwinCAT 3200 (3561 fixtures, = floors). volt-cli (the `StReader` refusal):
      `dotnet test` Volt.Engine.Tests 1840 pass / 1 skip / 0 fail, Volt.Cli.Tests 274 / 0. `bun run check` 14 passed,
      0 failed; `bun run lint` exit 0 (warnings only).
### 2.P Performance bugs the suite profile found (owner, 2026-10-01: "a slow check is usually an LSP bug")

Profile (dev c85441f40f, report in the session scratchpad prof/): full serial suite 691 s; the opt-in edit benchmark
(LSP_BENCH=1 src/server/bench.test.ts) FAILS: p50 212 ms / p95 262–289 ms vs a 90 ms budget (documented baseline 31/55).
Product bugs are fixed in the product, test-first with a measured size sweep; never hidden by a harness cache. Caching
LSP outputs keyed on LSP source is NOT allowed (it would have hidden both bugs).

- [ ] 2.P.1 A1: `findScopeByName` (symbols/scope-nav.ts:110-121) is a full DFS per call; callers method-signature.ts:33,45,
      interface-implementation.ts:32,74, services/navigation/hierarchy.ts:150 and the `scopeForUnit` fallback (scope-nav.ts:136,
      fires for EVERY global_var_list/type_decl unit — they never have a span-index entry). Fix: a per-project name index
      (memoByProject) or findChildScope; no fallback for unit kinds that never own a scope. Test: lookup cost flat across the
      four corpus sizes (2.9k→122k scopes). Acceptance: pro2193 PROFILE_CHECKS interface-implementation + method-signature
      from 1,863 + 1,318 ms to < 200 ms together; LSP_BENCH=1 bench green (p50 ≤ 90 ms); output unchanged (G).
      **Done in 79e9c44c47** (name index per generation, merged from per-file subtree indexes; scope-nav.test.ts keeps the
      walk as oracle): bench p50 212 → 66 ms, p95 ~270 → 93 ms (budget 90 — the rest is 2.P.2). Left for this task: verify
      the PROFILE_CHECKS numbers and the GVL/DUT fallback, then tick together with 2.P.2 once the bench is green.
- [ ] 2.P.2 A2: re-binding one file is O(project) (workspace-store.ts:134 promises O(changed file)): unbindFile
      (symbols/incremental.ts:63) filters every array, relink (:74) re-sorts every array and re-links every EXTENDS,
      invalidate bumps the project generation so compositionGraph / ambiguousGlobals / span + child indexes all rebuild.
      Fix: children and symbols indexed by file, relink only the affected scopes, per-file invalidation of the memos that
      depend on the file. The incremental-equivalence test stays the safety net. Acceptance: the 300-fixture sweep
      against 400/800/1,600/3,279-fixture projects is flat (today 6.7/6.6/9.5/16.5 ms per call); output unchanged (G).
      **Partly done:** 427d25bedd — checkDataRecursion's composition graph is lazy (per-Scope member-type cache, memo per
      generation; identical output on 32,731 documents): per-fixture LSP pass 16.6 → 10.5 ms. A ready first part of the
      rebind fix is parked as a patch (C:/Users/marce/AppData/Local/Temp/claude/C--Users-marce-Github-volt/
      e922541b-92e2-41f1-acc3-c0924669eb89/scratchpad/prof/binder-rebind-speedup.patch): unbindFile touches only the keys
      the file defined; linkExtends reads candidates from the child-name index (~3 of ~6.6 ms per rebind). Proven:
      candidate lists identical on all corpora; random-rebind equivalence on twincat-project14 + fixtures. NOT yet proven:
      old-vs-new state after the same edit sequence on the five CODESYS corpora — do that first, then apply. Known and
      harmless: a relink moves library namespace scopes to the front (old code too).
- [ ] 2.P.3 Harness: the rustc cache runs a hit's executable IN PLACE from a stable path inside the cache entry instead of
      copying it to a fresh temp path (Defender scans every new exe on first run: 60 fresh copies 3.1–3.5 s vs 0.37 s in
      place; ~2,250 + 2,350 runs per suite). Keep sampled verification. Acceptance: fixtures.test.ts before-all Rust phase
      measured before/after (was 165 s + 23 s); same verdicts.
      **Done in af655724ea** (hard link; verify renames the link aside first — test red on the old code; EXDEV copies):
      Rust phase 165 → 69 s, fixtures.test.ts 366 → 242 s. Tick after the gate re-confirms.
- [ ] 2.P.4 Harness memos (same tests, same failures): `runLsp` per (fixture, vendor) — the "LSP emits NO error on a
      fixture the simulator built" test (31 s) reuses the registration loop's result; `lspErrors` memoized (~7 s);
      backends.test.ts (and emit + libraries) compile through `buildRust` with its lanes and cache, not raw serial
      spawnSync(rustc) (backends.test.ts:328,430; ~18 s). Acceptance: per-file times before/after written here.
      **Done in 992f2c1bfa** (runLsp + lspErrors memo, ~30 s) **and b2ef9a5aba** (backends via the cache on lanes,
      26.7 → 9.8 s cold). Left: emit + libraries tests through buildRust if still raw; then tick.
- [ ] 2.P.5 Harness walks: `walkSources` (test/corpus/support/project.ts:34) withFileTypes + one pre-keyed sort, same order
      (2.2 s → 0.17 s per walk, ~8 walks); `projectDocuments` (test/corpus/support/diagnostics.ts:65) reuses scanWorkspace's
      refs/roots/sources; `loadWorkspaceRefs` (src/workspace-refs.ts:165) walks once (A3: 10.2 s vs scanWorkspace 5.2 s over
      the six corpora). Then re-measure corpus.test's "corpus is present" (144 s in-suite vs 30 s alone) and write the cause.
      Acceptance: full serial suite time written here (target ≤ 350 s); `bun test --parallel` re-measured with the 5 s/120 s
      limits under load — adopted only if it is green with no raised timeout.
      **Mostly done:** dd5c7efaea (walkSources 4.1 → 0.29 s per round), 2c677b85d4 (loadWorkspaceRefs reuses scanWorkspace,
      byte-identical on six corpora). Full serial suite 691 → 390 s (6,767 tests, 0 fail), ~370 s after b2ef9a5aba.
      Left: projectDocuments reuse, the corpus "is present" inflation cause, the --parallel re-measure (after 2.P.2).

- [x] 2.5.1 Precedence and associativity (E1, E3, E4, E6–E9): record expr_power_right_assoc, expr_neg_power,
      expr_comparison_chain, expr_mod_precedence. The CASE lookahead (statements `isArmStart`) uses the expression grammar.
      Where: parse/expression, parse/statements. Acceptance: CA. Depends on: 1.41
- [x] 2.5.2 Unary (E10–E11): record expr_unary_plus, expr_prefix_ampersand, expr_double_minus, expr_not_not.
      Where: parse/expression. Acceptance: CA. Depends on: 2.5.1
- [x] 2.5.3 `&` and `**` refused by the parser (E2, E5), moved from analysis unsupported-operator. The fixtures exist.
      Where: parse/expression, parse/errors. Acceptance: CA; the recorded messages stay byte-identical. Depends on: 2.5.2
- [x] 2.5.4 Postfix chains (E12–E17, E22, E32): the call-result postfix refusal (call-result-access) and the partial-access
      refusal (partial-access) move into the parser. Record expr_trailing_comma_index, expr_trailing_comma_call,
      expr_member_named_keyword.
      Where: parse/expression. Acceptance: CA. Depends on: 2.5.3
- [x] 2.5.5 Calls (E18–E21, E23, E28, E31): the IL operator call form moves into the parser. Record expr_en_eno_call.
      Where: parse/expression. Acceptance: CA. Depends on: 2.5.4
      **Step 2.5a (2026-10-01).** Fixtures: `fixtures/grammar/expressions.ts`, 60 `expr_*` — every name the tasks list and
      per rule the cells whose two readings differ in VALUE or in a type error (operands are variables, literals typed):
      E1/E6 every pair of the boolean levels whose groupings differ (OR/XOR, XOR/OR, OR_ELSE/XOR, XOR/OR_ELSE, XOR/AND,
      XOR/AND_THEN, OR/AND_THEN, OR_ELSE/AND, OR_ELSE/AND_THEN), `=` vs AND, NOT vs `=`; E3/E9 `a<b=c`, `a=b=c`, `a<b<c`;
      E4/E7 `a+b MOD c`, `a*b MOD c`, `a/b/c`; E8 `a**b**c`, `-a**b`; E10/E11 `+a`, `&a`, `- -a`, `--a`, `+ +a`, `NOT NOT`,
      `-NOT`, `NOT -`, `a - -b`, `a * -b`; E2/E5 `&`/`**` in parentheses, a conversion's and a user function's argument, an
      IF condition (and a stray name there and in parentheses, for the recovery); E15/E16 `arr[]`, `arr[1,]`, `grid[1,2,]`,
      `grid[1][2]`, a trailing comma in a user function's, a formal, an FB's, an operator's (`MAX`) and a conversion's list;
      E22 `F()[1]`, and beside an undefined name; E32 `bx.END_IF`/`.MOD`/`.ABS`/`.INT`/`.GET`, and beside an undefined name;
      E18/E19/E21 formal arguments reordered, positional after formal, EN/ENO on a FUNCTION; E31 `MOD(a,b)`, `AND(a,b)`,
      `NOT(a)`, `add(a,b)`. Recorded `record:language` on CODESYS and TwinCAT (60 each: one 47-fixture batch per vendor, then
      the cells the answers asked for — 5, 2, 7 re-recorded after their literals were typed, 6) and `record:exec` on CODESYS
      (31 run). The two vendors answer every cell alike (TwinCAT's capitals and one more sign warning aside).
      Measured: **OR, OR_ELSE and XOR are ONE level**, left to right (`TRUE OR TRUE XOR TRUE` runs FALSE, `TRUE XOR TRUE OR
      TRUE` TRUE) — not IEC's XOR-above-OR, which `BINARY_PRECEDENCE` had: a real bug, fixed test-first; AND/AND_THEN above
      them, then `=`/`<>`, then `<`…, all left-associative (`a<b<c` is "Cannot compare type 'BOOL' with type 'INT'"); unary
      `-`/`+`/NOT stack in any order; `**` and `&` are NO operators — the expression ends before them and its reader says
      what it wanted ("';' expected", "')' expected", "',' or ')' expected", "'THEN' expected"), a prefix `&` is "Expression
      expected instead of '&'"; a statement without its `;` STANDS and the vendor resyncs from the token (pairs, a NAME
      starts the next statement, "The code 'b;' has no effect" quoting the `;` it supplied); a parenthesis left open says
      "')' expected" and the statement resyncs; an IF missing THEN resumes at the THEN in silence; an index list takes no
      empty list or trailing comma ("Expression expected instead of ']'"), a call's list takes one unless the callee is an
      operator ("Expression expected instead of ')'"); any keyword is read as a member name and answered only "'END_IF' is
      no component of 'bx'" — and nothing else in the body is analysed (a PARSE refusal); C0185 on `F()[1]` does NOT stop
      the body's analysis (an undefined name beside it is still reported), so it is no parse refusal; EN/ENO are no
      parameters of a FUNCTION in ST. Fixed test-first (`parse/expression.test.ts`, new, 17 tests; `types.test.ts`;
      `lower.test.ts`; `refused-name.test.ts`): `parse/expression` — XOR on OR's level, `**`/`&` out of the table
      (`REFUSED_OPERATORS`, still asked of a fixture by `suite.test.ts`; `rightAssoc` gone with `**`), prefix `&` refused, a
      paren's missing `)` refuses the operand for the statement's resync, a binary operator word reads its `(` operand, the
      IL call form refused on the word (`NOT_AN_OPERAND` before `(`), index lists and an operator's trailing comma refused,
      a keyword or lone `%` member reported "'X' is no component of '<base as written>'" (`Cursor.textOf`); `lex/lexer` —
      CODESYS's `.%W0` is ONE token, TwinCAT keeps `.` `%` `W0` (the vocabulary decides, the parser needs no dialect);
      `parse/statements` — `resyncAfterMissingSemicolon` (the statement stands; `ExprStatement.unterminated`), the refused
      operand's resync for a non-keyword, IF skips to its THEN, `isArmStart` reads CASE labels with the expression grammar
      on a `Cursor.fork`; `types/const/fold` drops the `&`/`**` cases no tree can hold; `no-op-statement` quotes an
      unterminated statement with the `;` supplied. **Moved into the parser:** `analysis/checks/types/unsupported-operator`
      and `partial-access` are DELETED (TwinCAT-only list now empty), `refused-name`'s IL call form (`ST_OPERATOR_CALLS`)
      deleted and it skips member names; **not moved:** C0185 stays `call-result-access` (measured above; E22 home and
      `recheck` updated). Gate T (`src/transpile` clean, no other run): `lower.test.ts`'s `**`/`&` test now expects the
      parser's refusal (`parse`), `expressions.ts`'s `BIN_OPS` comment. Divergences closed: `R1_CASCADE_AFTER_A_STRAY_TOKEN`
      (10, both vendors — the missing-`;` resync was its rule), `lit_invalid_digit_hex`, `lit_time_underscore` (from
      `LITERAL_FOLLOW_ON_RULES`). Opened (`EXPRESSION_NICHE_DIVERGENCES`, both vendors, each niche: accepted loss, 0
      occurrences in the six corpora): `expr_trailing_comma_conversion_call` and `expr_ampersand_in_argument` (a conversion
      takes ONE argument, "')' expected"; the parser cannot tell `INT_TO_DINT` from a user FUNCTION named like one —
      pro2193's `RANGE_TO_WORD` takes three; `deferred.lsp` too, lsp-gap ceiling 18 → 19), `expr_member_named_type_keyword`
      (`bx.INT`: the lexer reads INT as a name), `expr_en_eno_call` (EN/ENO on a FUNCTION; the call checks', LSP review).
      Rules GAP area 2 **35 → 30** (total 89 → 84): E8, E9, E11, E16, E32 closed; E1–E7, E10, E15, E18, E19, E21, E22, E24,
      E28, E31 gain recorded cells. Agreement floors CODESYS 3260 → 3328, TwinCAT 3200 → 3268 (3621 fixtures).
      `rate:fixtures`: confirmed 2251, refused 1173, not-lowered 113, lsp-gap 19, diverges 4, unaskable 61; edges agree
      2349 / disagree 0 / not-run 98. The measures ask what they state, three refinements (`dumps.ts` `unparsedIn`,
      `bound-census.ts`): a name or expression in a BODY THAT DID NOT PARSE is counted apart (the vendor resolves and types
      nothing there — `expr_member_named_keyword_beside_undefined`); a member the vendor reports "no component" is unknown on
      both sides; a comparison store is refused by "Cannot compare type 'X' with type 'Y'". Ceilings (all fell): parse
      findings 132 → 114 (refused with a syntax message, no LSP parse error: CODESYS 54 → 47, TwinCAT 77 → 66), resolution
      findings 154 → 126 (TwinCAT bare NONE 38 → 12, member NONE 43 → 42 each), type: binary UNKNOWN 1155/1152 →
      1153/1150, call UNKNOWN 418/429 → 406/417, TwinCAT ident_expr UNKNOWN 90 → 58, member UNKNOWN 59 → 53; fixed-point
      unchanged (16). F (`frontend-snapshot check --base HEAD`): 2935 aspects over 471 sources — 404 sources the new and
      the rule's fixtures (`expr_*`, `lex_keyword_operand_*`, `lex_unknown_character*`, `operator_call_form_*`,
      `cc_power_operator`, `cc_fp_op_ampersand`, `*_operator_rejected`, `operand_partial_*`, `accepts_partial_access`,
      `sysop_position_*`, `lit_invalid_digit_*`, `lit_time_underscore`, `lex_div_as_operator`), their 67 back ends, and the
      `stmts`/`types` of fixtures whose body lacks a `;` (`decl_var_generic*`@twincat, `lit_enum_typed_*`@twincat,
      `unit_action_var_section`, `unit_method_override*`: the statement before the missing `;` now stands — their parse
      errors unchanged); no corpus or library source moved. Targeted: `bun test src` 0 fail, `test/frontend` 29 / 0,
      `test/conformance` 4893 pass / 0 fail, `test/corpus` 19 / 0; `tsc --noEmit` clean; `bun run lint` exit 0.
      **Review fixes (2026-10-02).** 14 cells recorded, one batch per vendor (`record:language`, CODESYS and TwinCAT; none
      builds, so no run): `expr_paren_stray_name_in_if`, `_in_while`, `_in_index`, `expr_trailing_comma_one_operand_operator`,
      `expr_trailing_comma_sizeof`, `expr_ampersand_in_operator_argument`, `expr_trailing_comma_operator_call_in_initializer`,
      `expr_partial_access_beside_undefined`, `expr_operator_word_before_minus`, `_plus`, `stmt_case_const_expr_label`,
      `stmt_case_paren_label` (2.6.2's names, recorded ahead because 2.5.1 changed their answer), `stmt_case_nonconst_label`,
      `stmt_case_arm_missing_semicolon`. Measured: a parenthesis left open in an IF/WHILE condition is its "')' expected"
      ALONE (the condition keeps the refusal, the IF/WHILE resumes at THEN/DO) — `statements` `refusedCondition`; in an
      index the list adds "',' or ']' expected instead of '2'", takes the `2`, and the statement resyncs from the `)`; a
      ONE-operand operator's trailing comma is the refusal plus "'ABS' needs exactly '1' operands" (the empty operand
      counts; `ABS(a & b)` is "',' or ')' expected", as the parser said); MAX's trailing comma in an initializer is refused
      at the `)` (`initializer` `refuseOperatorTrailingComma`; the vendors' value echo `MAX(MAX(SINT#1, 2), !!!'ERROR'!!!)`
      and its two type messages a niche divergence); TwinCAT's `d.%W0` IS a parse refusal (the undefined name beside it is
      not reported); `AND -a` is the one message; a CASE label is NO expression — `isLabelShape` (literal, signed literal,
      qualified name) on the expression-grammar lookahead, `a + 1:` the statement before a colon (all but the ST5 "is no
      valid statement"), `2 + 1:` / `(2):` refused otherwise and differently per vendor (niche divergences); a missing `;`
      before the next arm is the one "';' expected" (`LIST_STOP`). `types.test.ts`'s adapted `2 ** 8` assert dropped. The
      census: "no component" agreement keyed by member AND base (as written or its type); "a body that did not parse"
      only where the vendor recorded every LSP parse error there (no build recording: the LSP's parse); CODESYS's partial
      access typed by its width (`%X` BOOL … `%D` DWORD — member UNKNOWN 59 → 53). Floors CODESYS 3328 → 3338, TwinCAT
      3268 → 3278 (3635 fixtures). Targeted: `bun test src` 1546 / 0, `test/frontend` 29 / 0, `test/conformance` 4893 / 0,
      `test/corpus` 19 / 0; `tsc --noEmit` clean; lint exit 0.
      **Gate 2.5a (2026-10-02).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (3635
      fixtures: confirmed 2251, refused 1187, not-lowered 113, lsp-gap 19, diverges 4, unaskable 61; edges agree 2349 /
      disagree 0 / not-run 98). `bun test` 6660 pass / 34 skip / 158 todo / 0 fail (6852 tests, 195 files, 239 s, rustc
      cache on); agreement CODESYS 3338, TwinCAT 3278 (3635 fixtures, = floors). `bun run check` 14 passed, 0 failed;
      `bun run lint` exit 0 (warnings only). volt-cli untouched by 2.5a (no dotnet run).
- [ ] 2.5.6 THIS/SUPER, system operands, global-namespace and pool qualifiers (E24–E30, E33, E34): a leading-dot primary `.ident`.
      Record expr_inline_assign_if_condition, expr_inline_assign_while_condition, expr_global_namespace_dot,
      expr_global_namespace_shadowed_local, expr_pool_qualified_call.
      Where: parse/expression, parse/statements. Acceptance: CA. Depends on: 2.5.5
- [ ] 2.6.1 Assignment forms (ST1–ST5): record stmt_s_eq_no_space, stmt_ref_eq_on_non_reference.
      Where: parse/statements, lex/lexer (S=/R=/REF=). Acceptance: CA. Depends on: 2.5.6
- [ ] 2.6.2 IF and CASE labels (ST6–ST10): record stmt_case_typed_label, stmt_case_paren_label, stmt_case_const_expr_label,
      stmt_case_negative_label, stmt_case_empty_arm.
      Where: parse/statements. Acceptance: CA. Depends on: 2.6.1
- [ ] 2.6.3 Loops, jumps, missing `;`, `__TRY` recovery, CAL/INI statements (ST11–ST19): record stmt_return_no_semicolon,
      stmt_exit_no_semicolon, stmt_continue_no_semicolon, stmt_try_without_catch, stmt_try_nested, stmt_cal_instance,
      stmt_ini_call.
      Where: parse/statements. Acceptance: CA. Depends on: 2.6.2
- [ ] 2.7.1 Conditional compilation: ONE statement tree. Every consumer uses `bodyStatements` with pragmas applied; the
      unresolved-identifier skip and the analysis balance stack are removed. The `{IF}` grammar covers P10–P13. Record
      prag_define_in_declaration, prag_if_in_expression_statement, prag_unbalanced_end_if, prag_define_with_value,
      prag_if_hasvalue, prag_if_hasconstantvalue, prag_if_hasconstanttype, prag_if_defined_type, prag_if_defined_pou,
      prag_if_defined_task, prag_if_is_little_endian, prag_if_register_size, prag_if_not_and_or, prag_project_defined_in_declaration,
      prag_project_defined_forbidden_construct.
      Where: parse/body-parse, pragmas/conditional. Acceptance: CA. Depends on: 2.6.3
- [ ] 2.7.2 Attributes in the AST (on the unit, member and declaration nodes); `qualified_only` read per unit; the front-end
      attributes of design.md §4 2.7 (qualified_only, strict, to_string, const_replaced/const_non_replaced) exposed by name. Record
      prag_attribute_on_method, prag_attribute_on_struct_field, prag_attribute_brace_in_value, prag_attribute_commented_out.
      Where: pragmas/attributes, ast/nodes. Acceptance: CA. Depends on: 2.7.1
- [ ] 2.7.3 Message and region pragmas, pragmas inside expressions (P6–P7): record prag_inside_expression, prag_region_unclosed.
      Where: lex/lexer. Acceptance: CA. Depends on: 2.7.2
- [ ] 2.8.1 One token-description wording (the vendor's): the named forms from 1.16 collapse to the recorded ones. Record
      rec_file_scope_stray, rec_expected_expression.
      Where: parse/errors, parse/parser. Acceptance: CA. Depends on: 2.7.3
- [ ] 2.8.2 Recovery (R1–R2): record rec_missing_then, rec_missing_of, rec_missing_do, rec_missing_end_if, rec_missing_end_case,
      rec_missing_end_for.
      Where: parse/statements, parse/errors. Acceptance: CA. Depends on: 2.8.1
- [ ] 2.8.3 The vendor cascades in one place (R3, R6): analysis/resync.ts and refused-name's cascade are folded into parse/errors.
      Record rec_refused_name_cascade_type_word, rec_refused_name_cascade_function_word, rec_unknown_literal_prefix_cascade.
      Where: parse/errors. Acceptance: CA; the 0.1 parse-census baseline is empty (every finding closed or a recorded known
      divergence named here). Depends on: 2.8.2
- [ ] 2.9 Printer/formatter fixed point (PR1–PR4): STRING[n] and AT-after-type round-trip; parentheses from precedence; modifier
      order kept.
      Where: syntax/print.ts, services/formatting/print.ts; tests `print.test.ts` "STRING[n] round-trips", "AT after the type
      round-trips", "nested binary gets precedence parentheses"; `services/formatting/print.test.ts` "method modifiers keep their
      order". Acceptance: the four named tests exist and pass; the 0.2 fixed-point baseline is EMPTY; PR1–PR4 are no longer GAP in
      rules.test. Depends on: 2.8.3
- [ ] 2.10 Area 2 closed: every §4 2.x rule (L, N, S, A, D, T, U, E, ST, P, R, PR, FMT) has a recorded fixture or named test.
      Where: test/frontend/rules.ts. Acceptance: the rules.test GAP count for area 2 is 0 and pinned as 0; known divergences left
      in area 2 listed here with their reason. Depends on: 2.9

## 3. Symbols (symbols/) conformance

Every task's acceptance is **CA** unless it says otherwise. Area 3 needs the restructure and the 0.3 resolution dump, not the parser
conformance work; the cross-area edges are named on the tasks that have them.

- [ ] 3.1.1 Scopes and shadowing (Y1–Y8, Y20): record sym_getter_setter_same_local, sym_inout_vs_field_vs_stat.
      Where: binder, scope-nav. Acceptance: CA. Depends on: 1.41, 0.3
- [ ] 3.1.2 Namespace blocks (Y17–Y18): `scopedBodies` and `unitBodies` recurse via `allUnits` (the sites 1.8 left); ingestNamespace
      passes the member host. Record sym_namespace_block_unit_checked, sym_namespace_method_parents_to_fb.
      Where: scoped-bodies, format/bodies, binder. Acceptance: CA. Depends on: 3.1.1, 1.8
- [ ] 3.1.3 GVLs (Y9–Y14): `qualified_only` per unit (from 2.7.2); VAR_EXTERNAL binding in scope-nav. Record
      sym_qualified_only_one_of_two_gvls_in_file.
      Where: binder, scope-nav, pragmas/attributes. Acceptance: CA. Depends on: 3.1.2, 2.7.2
- [ ] 3.1.4 Order independence and dialect (Y19, Y22): record sym_order_independent (fixture pair, two file orders).
      Where: incremental, scope. Acceptance: CA. Depends on: 3.1.3
- [ ] 3.1.5 The bare-name search order (Y15, Y23, Y24, E33): analysis `nameResolves` → `types/names.resolveBareName` (tagged answer);
      the built-in NAME set from `types/builtins.ts`; device-tree instances bound by the binder from the `.device` descriptors
      (workspace-refs' `deviceInstances` set is deleted); `.ident` resolves in the global namespace. Record
      sym_method_before_global, sym_global_before_pou_name, sym_library_gvl_needs_qualification, sym_device_instance_bare,
      sym_global_namespace_dot_skips_local.
      Where: types/names.ts, symbols/binder.ts, analysis/resolution.ts (message only). Acceptance: CA; analysis/resolution.ts has no
      `lookupReference` call. Depends on: 3.1.4, 2.5.6
- [ ] 3.2.1 INTERFACE EXTENDS bound in the binder (H4–H5): interface scopes get `baseScope`; interface method parameters are bound;
      the 4 consumer re-derivations switch. Record inh_interface_method_param_resolves, inh_interface_extends_member.
      Where: binder, extends. Acceptance: CA. Depends on: 3.1.5
- [ ] 3.2.2 Every base resolved through `baseScope`/`extendsChain`, never by name (H8): method-signature, interface-implementation,
      hierarchy and inheritance switch. Record inh_extends_ambiguous_library_base.
      Where: extends; the four consumer sites. Acceptance: CA; no `findScopeByName` for an EXTENDS base outside extends.ts.
      Depends on: 3.2.1
- [ ] 3.2.3 Inherited members through an instance (H2): infer/member uses `lookupMember`. The fixture exists.
      Where: infer/member. Acceptance: CA; the type dump gives callshape_inout_base_method_from_outside_derived a type, not UNKNOWN.
      Depends on: 3.2.2
- [ ] 3.2.4 Unresolved base, cycle, SUPER, override (H6–H10): record inh_unresolved_base, inh_extends_cycle,
      inh_override_signature_mismatch.
      Where: extends, scope-nav.hasUnresolvedBase. Acceptance: CA. Depends on: 3.2.3
- [ ] 3.3 Enums (EN1–EN6): `resolveBareEnumMember` takes an asker and reports ambiguity. Record enum_same_member_two_enums,
      enum_member_vs_variable, enum_library_bare, enum_library_qualified.
      Where: scope-nav, library-namespaces. Acceptance: CA. Depends on: 3.2.4
- [ ] 3.4.1 Library precedence everywhere (LB3, LB5, LB6): `lookup`, `lookupMember`, `resolveBareEnumMember` and `findScopeByName`
      apply `pickForAsker`. Record lib_ns_same_name_two_libraries, lib_ns_own_library_first, lib_ns_type_name_two_libraries.
      Where: scope-nav, precedence, types/resolve. Acceptance: CA. Depends on: 3.3
- [ ] 3.4.2 Visibility, qualification and the project-over-namespace rule (LB1, LB2, LB4, LB8, LB9): record
      lib_ns_direct_dependency_only, lib_ns_project_unit_shadows_namespace, lib_ns_transitive_qualification,
      lib_ns_library_gvl_member.
      Where: library-namespaces, scope-nav. Acceptance: CA. Depends on: 3.4.1
- [ ] 3.4.3 Incremental library rebind (LB7): `bindLibraryNamespaces` re-runs on an incremental rebind; workspace-store drops its
      whole-rebuild workaround.
      Where: incremental, library-namespaces, server/workspace-store. Acceptance: the unit test `symbols/incremental.test.ts`
      "library rebind equals whole rebuild" exists and passes; LB7 is no longer GAP; F diff limited to the server's rebuild path.
      Depends on: 3.4.2
- [ ] 3.5 Members (M1–M6): access modifiers resolve first and are refused after. Record mem_reference_to_fb_member,
      mem_reference_to_fb_method, mem_pointer_deref_method, mem_private_member_resolves_then_refused,
      mem_protected_member_from_derived.
      Where: scope-nav, infer/member. Acceptance: CA. Depends on: 3.4.3
- [ ] 3.6 Area 3 closed: the 0.3 findings are closed; every §4 3.x rule has a recorded fixture or named test.
      Where: test/frontend/rules.ts, resolution-dump baseline. Acceptance: the 0.3 baseline is empty (or each remaining entry is a
      recorded known divergence named here); the rules.test GAP count for area 3 is 0 and pinned. Depends on: 3.5

## 4. Types (types/) conformance

One fixture per typing rule, recorded with `record:exec` (values that expose width/sign/overflow) and `record:language` (CODESYS's
type messages). Every task's acceptance is **CA** unless it says otherwise. Area 4 needs the restructure and the 0.4 dumps; the
cross-area edges are named on the tasks that have them.

- [ ] 4.1.1 Platform width per target (TY5–TY6): `Target` on the project scope; `canonicalElem`, `POINTER_BITS` readers,
      `temporalResultType`, compat's pointer↔integer rule and infer REQUIRE a target (the 1.31 default is deleted, so `tsc` lists
      every caller). The transpile `lowering.ts` call gets today's 64-bit target explicitly and is handed off (5.3). Record
      ty_xint_twincat_width, ty_pointer_size_twincat.
      Where: types/platform.ts, symbols/scope.ts (target beside dialect), every caller. Acceptance: CA; Gate T for the one
      transpile call. Depends on: 1.41, 0.4
- [ ] 4.1.2 Platform conversion names (TY11): `parseConversionName` accepts `__XINT_TO_*`; hand the transpile rewrite to T. Record
      ty_xint_to_dint, ty_dint_to_uxint.
      Where: conversion-name. Acceptance: CA. Depends on: 4.1.1
- [ ] 4.1.3 Elementary facts, aliases, ANY groups, type restrictions (TY1–TY4, TY7–TY10, TY12–TY15). Record ty_bit_as_variable,
      ty_pointer_to_bit, ty_array_of_bit, ty_array_of_reference, ty_any_num_parameter_accepts_int, ty_any_num_parameter_rejects_string,
      ty_version_type.
      Where: elementary, resolve, compat. Acceptance: CA; the 0.4 elementary findings are empty. Depends on: 4.1.2
- [ ] 4.2 Literal typing in every context (LT1–LT14): record lt_literal_in_comparison, lt_literal_case_label,
      lt_literal_array_bound, lt_literal_for_bounds, lt_literal_any_int_argument, lt_negative_min_sint, lt_negative_min_int; write
      `test/frontend/literal-agreement.test.ts` (`contextLiteralType` agrees with `literalCheckType` on every literal of the corpus
      and fixtures; disagreements pinned; T hand-off for the call site).
      Where: types/literal.ts. Acceptance: CA; literal-agreement.test.ts exists and its disagreement list is written here.
      Depends on: 4.1.3
- [ ] 4.3.1 Meets and promotion (AR1–AR3, AR19–AR21): record ar_div_negative, ar_mod_negative.
      Where: arith/runtime, arith/checked. Acceptance: CA. Depends on: 4.2
- [ ] 4.3.2 NOT and unary minus (AR4–AR6): one NOT rule in arith/operators, decided by the recordings (infer vs lowering); T
      hand-off for expressions.ts:180-184.
      Where: arith/operators. Acceptance: CA. Depends on: 4.3.1
- [ ] 4.3.3 Bitwise and shifts (AR7, AR10): the checked shift/rotate result type. Record ar_shl_byte_type, ar_ror_word_type,
      ar_shl_int_type.
      Where: arith/operators, builtins. Acceptance: CA. Depends on: 4.3.2
- [ ] 4.3.4 Built-ins (AR11–AR16, AR22–AR31): LIMIT/SEL/MUX typed in builtins.ts (T hand-off for builtins.ts:456); every built-in's
      result type from `BUILTIN_RESULT` or a rule in builtins.ts. Record ar_limit_mixed_types, ar_sel_mixed_types,
      ar_mux_mixed_types, ar_upper_bound_type, ar_lower_bound_type, ar_time_call, ar_ltime_call; re-check that the AR22–AR29
      fixtures decide the result TYPE (a message or a width-revealing value); record ar_<name>_type for any that does not.
      Where: types/builtins.ts. Acceptance: CA. Depends on: 4.3.3
- [ ] 4.3.5 Temporal (AR17–AR18): duration × integer typed in arith/temporal (T hand-off for expressions.ts:248). Record
      ar_time_times_int_type, ar_ltime_div_int_type.
      Where: arith/temporal. Acceptance: CA. Depends on: 4.3.4
- [ ] 4.4 Comparisons and BOOL (CB1–CB5), including the network-text wire rules 1.34 could not switch. Record cb_compare_pointers,
      cb_compare_time_ltime, cb_and_then_on_int.
      Where: infer/expr, arith/operators, network-text/parser.ts (imports only). Acceptance: CA; network-text/parser.ts holds no
      type-family or operator-result list. Depends on: 4.3.5
- [ ] 4.5.1 Enum conversions (CV3–CV5, P14, P15): `strict` and `to_string` read from the AST attributes. Record
      cv_enum_with_base_into_int, cv_library_enum_into_int, cv_int_into_enum, cv_literal_into_enum, cv_int_into_strict_enum,
      cv_strict_enum_into_int, cv_enum_to_string_attribute.
      Where: compat, enums, builtins. Acceptance: CA. Depends on: 4.4, 2.7.2
- [ ] 4.5.2 Pointer and reference compatibility and arithmetic (CV6, DT12, DT13, DT14): record cv_reference_to_pointer,
      cv_pointer_to_reference, dt_pointer_plus_int, dt_pointer_difference, dt_reference_auto_deref_type, dt_ref_assign_wrong_type.
      Where: compat, arith/operators, infer/member. Acceptance: CA. Depends on: 4.5.1
- [ ] 4.5.3 Explicit conversions (CV7): record every pair `scripts/conversion-matrix.ts` lists as missing (the count pinned in 0.5).
      Where: conversions/*.ts fixtures, builtins, conversion-name. Acceptance: CA; the matrix reports 0 missing pairs.
      Depends on: 4.5.2
- [ ] 4.6.1 One constant fold (CE6, CE9, P16): constEval folds conversions, pure built-ins, SIZEOF, enum values, NOT and shifts,
      honouring `const_replaced`/`const_non_replaced`, so the LSP and the transpiler fold one set (T hand-off deletes transpile's
      folder). Record ce_fold_conversion_bound, ce_fold_sizeof_bound, ce_fold_not_int, ce_fold_shl, ce_real_alias_const,
      ce_const_non_replaced_bound.
      Where: const/fold, const/constancy. Acceptance: CA; the 0.4 fold-dump baseline is empty. Depends on: 4.5.3
- [ ] 4.6.2 Constancy and scope (CE1–CE5, CE7–CE8): one walk for constancy and fold; cycle guard. Record ce_cycle.
      Where: const/fold, const/constancy. Acceptance: CA. Depends on: 4.6.1
- [ ] 4.7.1 Subrange in the Type model (DT3): subrange.ts reads the Type. Record dt_subrange_arithmetic_result.
      Where: type.ts, resolve, analysis/checks/types/subrange.ts. Acceptance: CA. Depends on: 4.6.2
- [ ] 4.7.2 Union in the Type model (DT4): record dt_union_member_sizes.
      Where: type.ts, resolve. Acceptance: CA. Depends on: 4.7.1
- [ ] 4.7.3 Enum storage base (DT5–DT6): one rule in enums.ts, decided by recording (T hand-off for enumStorage). Record
      dt_enum_base_byte_storage, dt_library_enum_storage.
      Where: enums. Acceptance: CA. Depends on: 4.7.2
- [ ] 4.7.4 Aliases, static bases, callees, rendering (DT1–DT2, DT7–DT11): staticScopeType distinguishes namespace and interface
      from struct. Record dt_alias_of_alias_init, dt_namespace_static_base, dt_interface_static_base.
      Where: infer/member, render. Acceptance: CA. Depends on: 4.7.3, 3.2.1
- [ ] 4.8 Area 4 closed: the 0.4 findings are closed; every §4 4.x rule has a recorded fixture or named test.
      Where: test/frontend/rules.ts, type/fold-dump baselines. Acceptance: the 0.4 baselines are empty (or each remaining entry is a
      recorded known divergence named here); the rules.test GAP count for area 4, and in total, is 0 and pinned. Depends on: 4.7.4

## 5. Consequences downstream

- [ ] 5.1 Re-run analysis, corpus, build-conformance and the transpiler suites; every change is either a recording-decided
      improvement (note it) or a regression (fix it). Regenerate the map.
      Acceptance: all green; the improvements listed here. Depends on: 2.10, 3.6, 4.8
- [ ] 5.2 Record in `transpile-restructure` which of its root causes this change already closed, and which of its §6 items 1–15
      the front-end now provides (with their `frontend/…` paths).
      Where: openspec/changes/transpile-restructure/{design,tasks}.md. Acceptance: every §6 item has a path or "not provided,
      because". Depends on: 5.1
- [ ] 5.3 Hand-off list into `transpile-restructure`: every "T" row of design.md P6 and §3.3 — the 13 EXTENDS sites, places GVL
      resolution, the `ns.symbols.get` namespace lookups (calls.ts:976,1627, constants.ts:103), `stored`/`fit`/`integerFoldType`,
      `withStringCapacity`, `contextLiteralType`, `UNARY_MATH`, the platform rewrite, `canonicalElem`'s target in lowering.ts, the
      LIMIT/SEL/MUX and NOT rules, the duration × integer rule, the constant folder, `enumStorage`, interp `sameName` — each with
      the front-end function that replaces it.
      Where: openspec/changes/transpile-restructure/tasks.md. Acceptance: every T row appears once. Depends on: 5.2

## 6. Close

- [ ] 6.1 docs/architecture.md and data-model.md describe the front-end layer (`src/frontend/`), its sub-layers, its indexes and
      its import rules; the stale "literals carry a type" claim is corrected.
      Acceptance: the docs name every sub-layer and rule F1–F4. Depends on: 5.3
- [ ] 6.2 Final review (spec + layering); fix; archive; delete the recreated openspec/specs/.
      Acceptance: `openspec/changes/archive/<date>-frontend-conformance` exists; `openspec/specs/` absent. Depends on: 6.1
