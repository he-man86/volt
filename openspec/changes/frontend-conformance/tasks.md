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

- [x] 2.P.1 A1: `findScopeByName` (symbols/scope-nav.ts:110-121) is a full DFS per call; callers method-signature.ts:33,45,
      interface-implementation.ts:32,74, services/navigation/hierarchy.ts:150 and the `scopeForUnit` fallback (scope-nav.ts:136,
      fires for EVERY global_var_list/type_decl unit — they never have a span-index entry). Fix: a per-project name index
      (memoByProject) or findChildScope; no fallback for unit kinds that never own a scope. Test: lookup cost flat across the
      four corpus sizes (2.9k→122k scopes). Acceptance: pro2193 PROFILE_CHECKS interface-implementation + method-signature
      from 1,863 + 1,318 ms to < 200 ms together; LSP_BENCH=1 bench green (p50 ≤ 90 ms); output unchanged (G).
      **Done in 79e9c44c47** (name index per generation, merged from per-file subtree indexes; scope-nav.test.ts keeps the
      walk as oracle): bench p50 212 → 66 ms, p95 ~270 → 93 ms (budget 90 — the rest is 2.P.2). Left for this task: verify
      the PROFILE_CHECKS numbers and the GVL/DUT fallback, then tick together with 2.P.2 once the bench is green.
      **Step 2.P (2026-10-02):** pro2193 PROFILE_CHECKS interface-implementation + method-signature 52 + 4 ms (was
      1,863 + 1,318; < 200 ✓). The fallback fired for an ALIAS or refused DUT only (a GVL has no name; a struct, union or
      enum DUT has a span entry) and answered it with any same-named scope — now none, test-first (scope-nav.test.ts, red
      on the old code: the alias got a method `Run`). LSP_BENCH=1: p50 29 ms (was 44 at HEAD), p95 60–68 ms (budget 90).
- [x] 2.P.2 A2: re-binding one file is O(project) (workspace-store.ts:134 promises O(changed file)): unbindFile
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
      **Step 2.P (2026-10-02): done.** The patch applied, then the rest of the rebind made O(file): unbind takes the
      file's own top-level scopes (kept per file) and keys; `canonicalize` inserts what was appended since the last sort
      (a stable sort's exact order) and re-sorts only the keys that gained a symbol; `linkExtends` re-links only scopes
      whose base name was bound or unbound (`noteTopLevel`), the visibility map once per manifest set; the project's span
      index and child index are KEPT (makeScope enters, unbindFile leaves, canonicalize places; a size mismatch throws);
      the name index re-answers only touched names. `buildSymbolTable` now relinks after `bindLibraryNamespaces`, so a
      built project already has the order one edit later gives it (the namespaces at the front) — corpus + fixture output
      identical, and the first keystroke no longer re-answers every namespace name (100 → 71 ms on pro2193). Proven:
      old-vs-new ordered state + every index after random edit sequences on all six corpora (300 ops each, two seeds);
      identical diagnostics on all 3,959 fixtures (rebind sweep) and the six corpora (+40 replayed keystrokes each);
      incremental.test.ts gains an order-sensitive random-rebind ≡ fresh-build test (red when the link or sort skips are
      broken). Sweep per call 400/800/1,600/3,279/3,959 fixtures: 0.99/0.64/0.62/0.76/0.80 ms (HEAD 2.58/2.53/3.24/
      5.45/—; flat ✓). Rebind alone on pro2193 5.6 → 0.47 ms.
- [x] 2.P.3 Harness: the rustc cache runs a hit's executable IN PLACE from a stable path inside the cache entry instead of
      copying it to a fresh temp path (Defender scans every new exe on first run: 60 fresh copies 3.1–3.5 s vs 0.37 s in
      place; ~2,250 + 2,350 runs per suite). Keep sampled verification. Acceptance: fixtures.test.ts before-all Rust phase
      measured before/after (was 165 s + 23 s); same verdicts.
      **Done in af655724ea** (hard link; verify renames the link aside first — test red on the old code; EXDEV copies):
      Rust phase 165 → 69 s, fixtures.test.ts 366 → 242 s. Tick after the gate re-confirms.
- [x] 2.P.4 Harness memos (same tests, same failures): `runLsp` per (fixture, vendor) — the "LSP emits NO error on a
      fixture the simulator built" test (31 s) reuses the registration loop's result; `lspErrors` memoized (~7 s);
      backends.test.ts (and emit + libraries) compile through `buildRust` with its lanes and cache, not raw serial
      spawnSync(rustc) (backends.test.ts:328,430; ~18 s). Acceptance: per-file times before/after written here.
      **Done in 992f2c1bfa** (runLsp + lspErrors memo, ~30 s) **and b2ef9a5aba** (backends via the cache on lanes,
      26.7 → 9.8 s cold). Left: emit + libraries tests through buildRust if still raw; then tick.
      **Step 2.P (2026-10-02):** emit.test.ts (4 compiles), libraries/{standard,stringutils,util} and backends' probe
      compareCase now build through `buildRust` (the metadata-only crate check stays raw: it makes no executable). The
      six rust-building files in one process, warm cache: 17.8–19.7 → 14.2–14.5 s. (Run alone each is slower — the
      toolchain identity is hashed once per process — so the saving is in-suite.)
- [x] 2.P.5 Harness walks: `walkSources` (test/corpus/support/project.ts:34) withFileTypes + one pre-keyed sort, same order
      (2.2 s → 0.17 s per walk, ~8 walks); `projectDocuments` (test/corpus/support/diagnostics.ts:65) reuses scanWorkspace's
      refs/roots/sources; `loadWorkspaceRefs` (src/workspace-refs.ts:165) walks once (A3: 10.2 s vs scanWorkspace 5.2 s over
      the six corpora). Then re-measure corpus.test's "corpus is present" (144 s in-suite vs 30 s alone) and write the cause.
      Acceptance: full serial suite time written here (target ≤ 350 s); `bun test --parallel` re-measured with the 5 s/120 s
      limits under load — adopted only if it is green with no raised timeout.
      **Mostly done:** dd5c7efaea (walkSources 4.1 → 0.29 s per round), 2c677b85d4 (loadWorkspaceRefs reuses scanWorkspace,
      byte-identical on six corpora). Full serial suite 691 → 390 s (6,767 tests, 0 fail), ~370 s after b2ef9a5aba.
      Left: projectDocuments reuse, the corpus "is present" inflation cause, the --parallel re-measure (after 2.P.2).
      **Step 2.P (2026-10-02):** projectDocuments seeds from scanWorkspace's sources (the server's own seeding; identical
      file sets, no BOM in the corpora, identical diagnostics; ~2 s of walk + read saved). "Corpus is present" is the
      first test to run `pass()` (parse, format, bind and lower all six corpora): 144 s in-suite at c85441f40f, 21.9 s
      in-suite in the run after the 2026-10-01 perf commits (79e9c44c47 … a298c777d4), 14.4 s alone now — the inflation
      is gone. Which commit removed it is NOT isolated (pass() itself never calls findScopeByName, so the walk is no
      proven cause); the residual in-suite/alone ratio (~1.5×) fits a larger heap to collect. Left for the GATE:
      the full serial suite time and the --parallel re-measure.
      **Gate 2.P (2026-10-02).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (3959
      fixtures: confirmed 2348, refused 1381, not-lowered 139, lsp-gap 24, diverges 4, unaskable 63; edges agree 2458 /
      disagree 0 / not-run 102 — unchanged from Gate 2.7). `bun test` (serial) 6927 pass / 34 skip / 183 todo / 0 fail
      (7144 tests, 195 files, 183 s, rustc cache on with sampled re-proof; `rate:fixtures` ran alongside for its first
      83 s) — was 691 s at c85441f40f, 288 s at Gate 2.7; target ≤ 350 s ✓. Agreement CODESYS 3647, TwinCAT 3592 (= the
      floors). 2.P.3 re-confirmed: the cache's hard-linked hits gave the same verdicts (agreement and map unchanged).
      `LSP_BENCH=1` bench green: diagnostics p50 29.6 ms / p95 63.6 ms (budget 90), definition p50 0.1 / p95 2.9 ms.
      `bun test --parallel` re-measured with the 5 s / 120 s limits untouched: green, same counts, 117 s — one green run
      under load; NOT adopted as the default `test` script on a single sample (the gates keep the serial suite; adopt
      after it stays green across the next gates). `bun run check` 14 passed, 0 failed; `bun run lint` exit 0 (warnings
      only). volt-cli untouched by 2.P (no dotnet run).

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
- [x] 2.5.6 THIS/SUPER, system operands, global-namespace and pool qualifiers (E24–E30, E33, E34): a leading-dot primary `.ident`.
      Record expr_inline_assign_if_condition, expr_inline_assign_while_condition, expr_global_namespace_dot,
      expr_global_namespace_shadowed_local, expr_pool_qualified_call.
      Where: parse/expression, parse/statements. Acceptance: CA. Depends on: 2.5.5
      **Step 2.5b (2026-10-02).** Fixtures: `fixtures/grammar/expressions.ts`, 31 new `expr_*` — every name the task lists and per
      rule the cells that separate its readings: E24 `(a + b) * c`, `((a + b)) * c`, `()`; E25 an inline assignment's value
      `(a := b + INT#1) * INT#2` and nested; E26 an inline assignment bare as an IF, ELSIF, WHILE, REPEAT condition, a CASE
      selector, a FOR bound, an index, and after a binary operator; E27 `THIS^.v` in an FB body, `THIS.v`, `p := THIS`,
      `SUPER.Get()`, `SUPER^.Get()`, `SUPER^` in a base-less FB, `THIS^` in a FUNCTION; E33 `.g` read, past a shadowing
      local, as an assignment target, as a member base, before a FUNCTION's call, with a space after the dot, naming nothing,
      naming only a local; E34 `__POOL.F()`, `__POOL.g`, `inner : __POOL.FB`. Operands typed (`INT#n`), globals without an
      initializer (a VAR_GLOBAL list has no scope in the census). Recorded `record:language` on CODESYS and TwinCAT (one batch
      of 29 + 2 and 31, then the 11 re-asked with typed literals and uninitialised globals) and `record:exec` on CODESYS (21,
      then 11). Measured: an inline assignment stands bare in every read position asked — a condition, a CASE selector, a
      FOR bound, an index (not only IF/WHILE/REPEAT; the FOR start value was asked in the review below), and after a binary operator it is a chain whose inner target is
      `(INT#1 + a)`; its value is its target's (`(a := b + 1) * 2` runs 8); `.g` reads the GLOBAL past a local (0, not 3),
      a space may follow the dot, `.loc`/`.nope` are "There is no global definition for 'X'" and the conversion of the hole;
      SUPER in a base-less FB is "Expression SUPER is not allowed in this context" plus, where called, "Program name … instead
      of '<callee as written>'" ('SUPER^.Get'), not a fixed 'SUPER^'; THIS/SUPER without `^` are "'THIS' is no structured
      variable"; THIS in a FUNCTION is untyped; `__POOL.X` looks in the POUs view only (an application object is "Identifier
      'X' not defined") yet `__POOL.FB` as a declared type builds. Fixed test-first (`parse/expression.test.ts` 3 tests,
      `unresolved-identifier.test.ts` 1, `this-super-context.test.ts` 2): `syntax/ast` — `GlobalExpr` (`global_expr`), its
      name no child of the tree (every name walker resolves locals first); `parse/expression` — the leading-dot primary,
      `()` the vendors' "Expression expected instead of ')'", an index reads `parseAssignable`, `parseExprFromTokens(…,
      assignable)`; `parse/statements` — CASE selector and FOR TO/BY read `parseAssignable`; `types/infer` — `global_expr`
      in the project scope, an inline assignment typed by its target, SUPER typed by the enclosing FB's base (`superType`),
      THIS only in a FUNCTION_BLOCK, no member off a bare THIS/SUPER; `symbols/scope-nav` — `.GVL.v` and `.List.Const`
      qualify through the global list; `types/const/fold` — `.Const`; `analysis` — `noGlobalDefinition`,
      `this-super-context` (`super-without-base` and its fixed message DELETED; `self-not-structured` a hole), `print`.
      Corpora: `.g` is NOT niche — 26 occurrences, every one an array bound written `1...X.c` (`..` then `.X.c`: L_MC1P
      libraries in four projects, pro2193's `CassetteDefinition`), whose UPPER BOUND the parser dropped (`ast` had no
      `upper`); all 26 resolve now. Divergences opened (`EXPRESSION_NICHE_DIVERGENCES`, both vendors, `deferred.lsp` on the
      lsp-gaps): `expr_pool_qualified_call`, `_global`, `_fb_type` (niche: accepted loss, 0 `__POOL` in the corpora — the
      workspace does not model the POUs view; `SYSTEM_OPERAND_AT_STATEMENT_START` stays, same reason), `expr_inline_assign_operand`
      (ST4's chain target, task 2.6.1; niche, 0). Closed: `refuse_super_without_base` now agrees on both vendors. Rules GAP
      area 2 **30 → 27** (total 84 → 81): E26, E33, E34 answered; E24, E25, E27, E30 gain cells. `rate:fixtures` (3666):
      confirmed 2255, refused 1194, not-lowered 130, lsp-gap 22, diverges 4, unaskable 61; edges agree 2353 / disagree 0 /
      not-run 98. Ceilings (`fixtures.test.ts`, FOR MEASUREMENT, new questions only, no fixture moved): lsp-gap 19 → 22,
      not-lowered 113 → 130 (`assign_expr` and `global_expr` are lowered nowhere; `expr_this_as_pointer`,
      `expr_pool_qualified_fb_type`). Agreement floors CODESYS 3338 → 3366, TwinCAT 3278 → 3306. Measures (each asks what it
      states): 0.1 C0035 "Program name … expected" is no syntax message; 0.2 an expression re-parses in the grammar of its
      place; 0.3 `.g` dumped as `(global) g`, agreeing with "There is no global definition", and a member NONE where the
      vendor says "'X' is no structured variable"; 0.4 a GVL qualifier written `.GVL`, folds of a known divergence counted
      not measured, zero UNKNOWN counts seeded. Ceilings all fell: fixed-point findings 6 → 3 (corpus not a fixed point
      3 → 0), parse findings 114 → 78 (refused with a syntax message CODESYS 47 → 37, TwinCAT 66 → 40), resolution findings
      126 → 112 (corpus member NONE 3709 → 3602, fixtures member NONE 42 → 35 each — SUPER), type findings 226 → 222 (corpus
      deref UNKNOWN 185 → 20, ident_expr 634 → 469, call 2036 → 1939, assign_expr 9 → 0), folds decl NOSCOPE 32 → 31. F
      (`frontend-snapshot check --base HEAD`): 1342 aspects over 250 sources — the new fixtures, the 13 corpus files with a
      `1...X` bound (`ast`, `folds`), SUPER's `resolution`/`types` in corpus and fixtures, THIS in a PROGRAM, and one back
      end (`cc5_new_in_expression`, still refused, now at the pointer comparison); no corpus `errors`, `stmts` or
      `diagnostics` moved. Targeted: `bun test src` 1552 / 0, `test/frontend` 29 / 0, `test/conformance` 4904 / 0,
      `test/corpus` 19 / 0; `tsc --noEmit` clean; lint exit 0.
      **Review fixes 2.5b (2026-10-02).** 11 cells recorded (`record:language` CODESYS and TwinCAT, one batch each, then the
      three bound fixtures re-asked without UPPER_BOUND — TwinCAT refuses it on a fixed array — and the two-list pair once
      a STRUCT stood between the lists: back to back, two VAR_GLOBAL blocks are ONE list's sections; `record:exec` 4 + 3):
      `expr_global_namespace_array_bound`, `_array_bound_index`, `_qualified_bound`, `_enum_bound` (the corpora's only E33
      form, `1...X.c` / `E.Up...E.Left`: all build, `a[3]` runs 6, `a[4]` past `1...gnIndex` is "The constant index '4' is
      not within the range from '1' to '3'" on both), `_constant_target` ("'.gcTarget' is no valid assignment target"),
      `_call_non_callable` ("… instead of '.gCall'" and the hole), `_variable_in_constant` ("Initialisation of constant
      variable 'k' not constant"), `_ambiguous` (`.gAmb` two lists declare: "There is no global definition" and the hole),
      `_ambiguous_bare` (bare: "Ambiguous use of name", "Identifier 'gAmb' not defined" and the hole),
      `expr_super_without_deref_without_base` (SUPER.Get() with no base: not allowed, the call target ONCE, the hole — no
      "no structured variable"), `expr_inline_assign_for_start` (`FOR i := m := 1 TO 3 DO` builds, runs out 6). Fixed
      test-first: `parse/statements` the FOR start value reads `parseAssignable`; `symbols/scope-nav` `lookupGlobal` — the
      ONE `.name` lookup (member, fold, constancy, the `.GVL` qualifier): a name two project lists declare is none;
      `types/const/constancy` `.g` has the constancy of its global; `types/infer` a call of a non-constant project VALUE
      whose type is no call target is UNKNOWN (it had the value's type); `analysis` — `statement-rules` refuses a CONSTANT
      `.g` target as written, `non-callable-call` names `.g` as written, `hole` an invalid call target explains a hole,
      `this-super-context` no structured-variable message and no second call target for a base-less SUPER;
      `services` — references/rename/definition see `.g` (`references.ts`, `resolve-at.ts`). Harness (each asks what the
      push sends): a fixture's lists are objects of their own under `gvlNames` (`fixture-units` `splitLists`) in the
      replay, the rating, the census and `assembleFixture` — bound inside the fixture's file they were named after it, so
      `.GVL.c` reached nothing and two lists were one. Census: a call the vendor says is no call target and a SUPER it does
      not allow are untyped on both sides; a member off that SUPER NONE on both. Divergence opened
      (`EXPRESSION_NICHE_DIVERGENCES`, both vendors): `expr_global_namespace_ambiguous_bare` — the LSP resolves the bare
      name to the first list's, so it gives "Ambiguous use" without the not-defined and the hole; niche: accepted loss (0
      occurrences in the corpora, which build). Not fixed, said: `expr_global_namespace_enum_bound` is not lowered —
      `constEval` folds no enum value, with `..` as with `...` (task 4.6.1); a call argument is not asked for E26 (`F(m :=
      1)` is a formal argument). `rate:fixtures` (3677): confirmed 2257, refused 1201, not-lowered 132, lsp-gap 22,
      diverges 4, unaskable 61. Ceilings: not-lowered 130 → 132 FOR MEASUREMENT (`expr_inline_assign_for_start`,
      `_enum_bound`); lsp-gap unchanged. Floors CODESYS 3366 → 3376, TwinCAT 3306 → 3316. Frontend ceilings fell: fixtures
      call UNKNOWN 400 → 398 / 411 → 408, ident_expr UNKNOWN 44 → 43 / 55 → 54. Targeted: `bun test src` 1560 / 0,
      `test/frontend` 29 / 0, `test/conformance` 4908 / 0, `test/corpus` 19 / 0; `tsc --noEmit` clean; lint exit 0.
      **Gate 2.5b (2026-10-02).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (3677
      fixtures: confirmed 2257, refused 1201, not-lowered 132, lsp-gap 22, diverges 4, unaskable 61; edges agree 2356 /
      disagree 0 / not-run 99). `bun test` 6689 pass / 34 skip / 177 todo / 0 fail (6900 tests, 195 files, 249 s, rustc
      cache on); agreement CODESYS 3376, TwinCAT 3316 (3677 fixtures, = floors). `bun run check` 14 passed, 0 failed;
      `bun run lint` exit 0 (warnings only). volt-cli untouched by 2.5b (no dotnet run).
- [x] 2.6.1 Assignment forms (ST1–ST5): record stmt_s_eq_no_space, stmt_ref_eq_on_non_reference.
      Where: parse/statements, lex/lexer (S=/R=/REF=). Acceptance: CA. Depends on: 2.5.6
- [x] 2.6.2 IF and CASE labels (ST6–ST10): record stmt_case_typed_label, stmt_case_paren_label, stmt_case_const_expr_label,
      stmt_case_negative_label, stmt_case_empty_arm.
      Where: parse/statements. Acceptance: CA. Depends on: 2.6.1
- [x] 2.6.3 Loops, jumps, missing `;`, `__TRY` recovery, CAL/INI statements (ST11–ST19): record stmt_return_no_semicolon,
      stmt_exit_no_semicolon, stmt_continue_no_semicolon, stmt_try_without_catch, stmt_try_nested, stmt_cal_instance,
      stmt_ini_call.
      Where: parse/statements. Acceptance: CA. Depends on: 2.6.2
      **Step 2.6 (2026-10-02).** Fixtures: `fixtures/grammar/statements.ts`, 85 `stmt_*` (81 new; `stmt_case_const_expr_label`,
      `_paren_label`, `_nonconst_label`, `_arm_missing_semicolon` moved from `expressions.ts`) — every name the tasks list and,
      rule by rule, the cells that separate a rule's readings: ST1 a literal / parenthesized target, an empty value, `: =`;
      ST2 `S=`/`R=` without spaces, in lower case, written apart, with a FALSE operand, on an INT target or operand; ST3
      `REF=` on a non-reference, without spaces, in lower case, apart, onto a literal; ST4 mixed chains, a literal inner
      target, three targets; ST5 a comparison, an arithmetic, a literal, `(a)`, NOT, `-a`, TRUE, a member, a discarded
      FUNCTION call, `LIMIT(…)`, a FUNCTION's bare name as statements; ST6 an empty THEN, ELSIF after ELSE, two ELSEs,
      `ELSE IF` with one and two END_IFs, `IF x THEN ;`; ST7 no arms, ELSE only, a duplicate, an overlap, a reversed range,
      a trailing comma; ST8 `-1:`, `-3..-1:`, `+1:`; ST9 `INT#1:`, `DINT#2:` on an INT, `INT#2:` on a DINT, a constant's and
      a variable's name; ST10 an empty arm before an arm, last, before ELSE; ST11 a member, a REAL, a BOOL, a DWORD and a
      literal counter, an empty body; ST12 empty WHILE/REPEAT, a `;` after UNTIL's condition; ST13 EXIT/CONTINUE outside
      a loop; ST14 RETURN/EXIT/CONTINUE/an assignment without `;` before a statement and before END_IF/END_FOR; ST15 JMP
      without `;`, a label last; ST18 `__TRY` without `__CATCH`, with `__FINALLY` only, nested in a `__CATCH`, `__CATCH`
      without its operand; ST19 `CAL t(k := 1);`, `CAL t;`, `INI(t, TRUE);`. Arithmetic operands typed (`out + INT#1`).
      Recorded `record:language` on CODESYS (one batch of 73, a second of 8 the answers asked for, the 6 re-asked with typed
      operands) and TwinCAT (one batch of 85, the 6 re-asked), `record:exec` on CODESYS (32 sent, then the 3 re-asked);
      `expr_inline_assign_operand` re-asked on both as `INT#1 + a := 2` (same answer). Measured (both vendors alike unless
      said): a statement starts with a name, a statement keyword, THIS/SUPER, `.` or an address — a LITERAL (TRUE too), any
      other punctuation and NOT are "Unexpected token 'X' found" and the resync, and so is a reserved word before `(`
      (`LIMIT(0, a, 5);`, `INI(t, TRUE);` — in an operand each is the operator); `out : = a;` is the label `out:` and a
      refused `=`; `s=`/`r=`/`ref=` are the operators in any case; `S =` apart is the IL word S, `REF =` apart the name REF
      and a comparison; S=/R= set a BOOL from a BOOL ("Cannot convert type 'INT' to type 'BOOL'", either side), a FALSE
      operand leaves the target; a binary operation as a statement is the ERROR "'(a + 1);\r\n' is no valid statement"
      (its literal left untyped in the echo — the vendor types nothing there), a name or member a no-op, a FUNCTION's bare
      name "FUNCTION 'F' referenced without parentheses '()'" beside the no-op; a chain's inner target and a FOR counter that
      are no name are "'1' is no valid assignment target" (`'(INT#1 + a)'`); RETURN/EXIT/CONTINUE/JMP without `;` are the
      one line "';' expected instead of 'X'" before a name AND before a block's END, an assignment before END_IF too (no
      "Unexpected token"); a CASE label list's trailing comma is "Expression expected instead of ':'" alone; an empty CASE
      arm is a WARNING ("At least one statement is expected") that builds and runs — the row's "is an error" was the
      2026-07-21 note; typed, constant-name and signed labels build, `DINT#2:` on an INT is "Cannot convert type 'DINT' to
      type 'INT'"; a FOR counter converts to ANY_INT (REAL, BOOL refused, DWORD counts, a member counts); `UNTIL c;` is
      "'END_REPEAT' expected instead of ';'"; `__CATCH` needs no operand; CODESYS builds a `__TRY` without `__CATCH` and its
      application does not start ("Login failed...", alone, twice each — `execSkip`), TwinCAT refuses it; TwinCAT words a
      literal REF= reversed ("'REFERENCE TO INT' to type 'SINT'", a second cell beside `cc3_reference_assign`) and ends the
      inverted CASE range with a full stop. Fixed test-first (`parse/statements.test.ts` 7, `no-op-statement.test.ts` 4,
      `statement-rules.test.ts` 3, `empty-block.test.ts` 1, `case-labels.test.ts` 2, `assignment.test.ts` 1,
      `reference-assign.test.ts` 1, `types.test.ts` 1): `parse/statements` — `refusedAtStatementStart` (literals, punctuation
      but `.`, NOT/TRUE/FALSE, a reserved word before `(`), `assignOpOf` in any case, RETURN/EXIT/CONTINUE/JMP end with
      `endStatement`, `resyncAfterMissingSemicolon` the one line at a block keyword, a label list's trailing comma
      (`isArmStart`, `parseCaseArm`), `__CATCH` without operand (`services/formatting/print` prints it); `analysis` —
      `no-op-statement` gives C0020 `no-valid-statement` (catalog C0020 implemented, verified both) and
      `function-without-parens`, and warns a statement standing without its `;` in a body that did not parse (not a call
      operator that took the next token, `lex_keyword_assigned_sys_delete`); `statement-rules` refuses a non-name chain
      target / FOR counter (an address is a target) and adds `for-control-type` (`rules.isRefusedCounter`, `loop-exit` judges
      no refused counter); `empty-block` a CASE arm a warning (catalog C0426 kind warning); `case-labels` a typed label's
      type; `assignment` S=/R= BOOL on both sides; `reference-assign`/`messages` `refLiteralCannotConvert` (TwinCAT
      reversed), `caseRangeInverted` TwinCAT's full stop; `types/arith/operators` NOT of a BIT stays a BIT (pro2193's
      `done R= NOT busy`, which the S=/R= rule found). `types.test.ts` carries its probe expressions as an assignment's
      value (a bare expression is no statement). Divergences closed: `stmt_case_nonconst_label`, `expr_inline_assign_operand`
      (`EXPRESSION_NICHE_DIVERGENCES`; the latter's `deferred.lsp` dropped), `cc3_reference_assign` (`TWINCAT_TRIAGE`).
      Opened (`STATEMENT_DIVERGENCES`, both vendors): `stmt_assign_missing_value` (R5 wording, task 2.8.1),
      `stmt_if_else_if_two_words` (an IF open at EOF, R2, task 2.8.2), `stmt_s_eq_spaced` (the IL word S, task 2.8.3),
      `stmt_assign_spaced_operator` (the label warning in a body that did not parse; niche: accepted loss, 0 occurrences),
      `stmt_for_literal_control` (its extra "'SINT' to type 'BIT'"; niche, 0), `stmt_case_const_expr_label` and
      `stmt_case_paren_label` (moved: the vendors' resync after a refused label differs per vendor; niche, 0);
      `TWINCAT_TRY_NEEDS_CATCH` (twincat): `stmt_try_without_catch`, `stmt_try_finally_only` (niche: accepted loss — 0 `__TRY`
      in the TwinCAT corpus, all 36 in the CODESYS corpora have their `__CATCH`). Rules GAP area 2 **27 → 22** (total
      81 → 76): ST9, ST10, ST14, ST18, ST19 closed; ST1–ST8, ST11–ST13, ST15, ST16 gain recorded cells. Agreement floors
      CODESYS 3376 → 3454, TwinCAT 3316 → 3393 (3758 fixtures). `rate:fixtures` (3758): confirmed 2283, refused 1251,
      not-lowered 136, lsp-gap 21, diverges 4, unaskable 63; edges agree 2390 / disagree 0 / not-run 102. Ceilings
      (`fixtures.test.ts`): lsp-gap 22 → 21; not-lowered 132 → 136 FOR MEASUREMENT (`stmt_try_nested`,
      `stmt_try_catch_without_operand`, `stmt_bare_member`, `stmt_label_at_end` — the transpiler's); source-map
      `RENAMED_TARGETS` 31 → 34 (chain temps and an S= latch, documented classes). Measures (each asks what it states):
      0.1 "At least one statement is expected" is a statement count, no syntax refusal; 0.4 a store for S=/R= (BOOL), a
      FOR counter (ANY_INT), a typed CASE label (the selector) and a literal REF= (TwinCAT's reversed wording), the
      expressions of a "no valid statement" untyped on the vendor too, and a sign on an untyped number counted apart as
      its literal is (a new measure, capped: fixtures 253/252, corpus 135, Library Manager 658, library 9). Ceilings fell:
      parse findings 78 → 76 (refused with a syntax message CODESYS 37 → 36, TwinCAT 40 → 39), type findings 222 → 220.
      (`unary UNKNOWN` fixtures 246/245 → 0, corpus 308 → 173, Library Manager 658 → 0, library 9 → 0 is a RECLASSIFICATION,
      not a fall — see the review fixes below.) F (`frontend-snapshot
      check --base HEAD`): 3109 aspects over 417 sources — the 85 statement fixtures (own, PLC_PRG, back end),
      `expr_inline_assign_operand` (re-asked), pro2193's `ModuleWithStateFB.fb` (`types`: NOT of a BIT), and the
      `stmts` of two TwinCAT recoveries whose body opens with a refused token (`lex_vector_twincat_return_type`,
      `lit_enum_typed_case_label`, both known divergences); no other corpus or library source moved. Targeted: `bun test
      src` 1580 / 0, `test/frontend` 29 / 0, `test/conformance` 4959 / 0, `test/corpus` 19 / 0; `tsc --noEmit` clean;
      lint exit 0.
      **Review fixes 2.6 (2026-10-02).** 118 cells recorded (`record:language` CODESYS and TwinCAT, one batch each;
      `record:exec` CODESYS 1). (1) The census's `unary UNKNOWN` → `…, a signed untyped number` split is a
      RECLASSIFICATION, not a fall: the front-end still types `-1` UNKNOWN, as it types `1` (`literal UNKNOWN`, uncapped,
      area 4). Every one of the 246/245 fixture rows was such a number; the new key took them plus the 7 the 2.6 CASE-label
      fixtures add (253/252, a rise for measurement); corpus 308 = 173 + 135, Library Manager 658, library 9 (no rise). Said
      in `bound-census.ts`. "No valid statement on the vendor too" and the new "its operands refused on the vendor too" are
      agreement buckets, uncapped as "no call target on the vendor too" is. (2) The two parser rules asked of the vendor,
      not narrowed: a reserved word before `(` where a statement starts, EVERY word of the statement positions
      (`lex_keyword_called_*`, 99, in `grammar/lexer.ts` beside the three positions) — all 93 words of
      `REFUSED_AT_STATEMENT_START` answer "Unexpected token 'W' found" and the resync on both vendors (TwinCAT's `xsizeof`
      is no keyword, `TWINCAT_XSIZEOF_IS_NO_KEYWORD`); and an assignment without its `;` before every other `STMT_SYNC`
      keyword (`stmt_assign_no_semicolon_before_*`, 17; END_REPEAT has no statement before it) — the one line on both. The
      LSP agreed on all of them. (3) `no-op-statement`: inside a FUNCTION its own name is the return variable — `F;` is the
      no-op alone (`stmt_function_own_name_bare`, CODESYS; fixed test-first). (4) A negation as a chain's inner target and
      a FOR counter is "'(INT#0 - a)' is no valid assignment target" on both (`stmt_chain_negated_inner_target`,
      `stmt_for_negated_control`) — the LSP's answer, now pinned. (5) Catalog C0020: the repro is CRLF and ends in a line
      break, as the vendor stores it and the fixtures record it ("'(x = 2);
'"); `verified` back to false —
      `verify-catalog` built nothing for any repro on 2026-10-02 (control C0139 empty too). (6) `expr_inline_assign_operand`
      stays typed (`INT#1 + a`), said on the fixture: the untyped `1` beside an INT is area 4's question, and asked there
      it raises `binary UNKNOWN` above its committed ceiling; the six statement fixtures keep their typed operands for the
      same reason (one question per fixture). Found on the way, fixed test-first: `__queryinterface(n);` /
      `__querypointer(n);` are "'X' needs exactly '2' operands" alone (`intrinsic-operands`, a CODESYS false positive the
      sweep found). Divergences opened (both vendors, `SYSTEM_OPERAND_AT_STATEMENT_START`): `lex_keyword_called_sys_currenttask`,
      `_sys_pool` (niche, 0 in the corpora); `lex_keyword_called_sys_pool` is a `MEASURED_SILENT` lsp-gap. Not fixed, said:
      `lex_keyword_called_sys_delete` lacks the recording project's "No memory for dynamic object creation" line (as the
      `newdel_*` fixtures). `rate:fixtures` (3876): confirmed 2283, refused 1367, not-lowered 137, lsp-gap 22, diverges 4,
      unaskable 63; edges agree 2390 / disagree 0 / not-run 102. Ceilings (`fixtures.test.ts`, FOR MEASUREMENT): lsp-gap
      21 → 22, not-lowered 136 → 137 (`stmt_function_own_name_bare`). Floors CODESYS 3454 → 3569, TwinCAT 3393 → 3508.
      Frontend ceilings unchanged. Targeted: `bun test src` 1582 / 0, `test/frontend` 29 / 0, `test/conformance` 4960 / 0,
      `test/corpus` 19 / 0, `test/catalog` 147 / 0; `tsc --noEmit` clean; lint exit 0.
      **Gate 2.6 (2026-10-02).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (3876
      fixtures: confirmed 2283, refused 1367, not-lowered 137, lsp-gap 22, diverges 4, unaskable 63; edges agree 2390 /
      disagree 0 / not-run 102). `bun test` 6764 pass / 34 skip / 181 todo / 0 fail (6979 tests, 195 files, 267 s, rustc
      cache on); agreement CODESYS 3569, TwinCAT 3508 (3876 fixtures, = floors). `bun run check` 14 passed, 0 failed;
      `bun run lint` exit 0 (warnings only). volt-cli untouched by 2.6 (no dotnet run).
- [x] 2.7.1 Conditional compilation: ONE statement tree. Every consumer uses `bodyStatements` with pragmas applied; the
      unresolved-identifier skip and the analysis balance stack are removed. The `{IF}` grammar covers P10–P13. Record
      prag_define_in_declaration, prag_if_in_expression_statement, prag_unbalanced_end_if, prag_define_with_value,
      prag_if_hasvalue, prag_if_hasconstantvalue, prag_if_hasconstanttype, prag_if_defined_type, prag_if_defined_pou,
      prag_if_defined_task, prag_if_is_little_endian, prag_if_register_size, prag_if_not_and_or, prag_project_defined_in_declaration,
      prag_project_defined_forbidden_construct.
      Where: parse/body-parse, pragmas/conditional. Acceptance: CA. Depends on: 2.6.3
- [x] 2.7.2 Attributes in the AST (on the unit, member and declaration nodes); `qualified_only` read per unit; the front-end
      attributes of design.md §4 2.7 (qualified_only, strict, to_string, const_replaced/const_non_replaced) exposed by name. Record
      prag_attribute_on_method, prag_attribute_on_struct_field, prag_attribute_brace_in_value, prag_attribute_commented_out.
      Where: pragmas/attributes, ast/nodes. Acceptance: CA. Depends on: 2.7.1
- [x] 2.7.3 Message and region pragmas, pragmas inside expressions (P6–P7): record prag_inside_expression, prag_region_unclosed.
      Where: lex/lexer. Acceptance: CA. Depends on: 2.7.2
      **Implementation 2.7.1–2.7.3 (2026-10-02).** Fixtures: `fixtures/grammar/pragmas.ts`, 75 `prag_*` (every name the
      tasks give, and the cells that separate a rule's readings), recorded `record:language` CODESYS and TwinCAT and
      `record:exec` CODESYS (one batch per vendor, follow-ups in small batches as the answers raised questions).
      Measured: (1) a conditional directive acts ONLY WHERE A STATEMENT MAY START — inside a statement every pragma is
      trivia (`prag_if_in_expression_statement` runs both branches, out = 31; `prag_if_whole_operand` is "';' expected
      instead of 'INT#20'"; `prag_if_statement_starts_inside` leaves the `{IF}` open); a chain belongs to its statement
      list (`prag_if_crossing_statement` unterminated); a branch not taken is parsed IN SILENCE
      (`prag_untaken_branch_syntax_error` builds); the words are case-sensitive (`{if}`, `{DEFINE}` are no directive, `DEFINED (X)` an unknown
      operator: "Unexpected token '(' found" + "'!!!'ERROR'!!!' is no valid condition for pragma"); a define's name is
      case-sensitive and its body's own (one in the declaration part or the FB body is not seen by the body / the METHOD);
      NOT binds before AND before OR; `hasvalue` of a define without a value is FALSE; `hasconstantvalue (c, v, op)` is
      `c op v`; `defined (resource: …)` FALSE; on the exec device IsLittleEndian, IsSimulationMode, IsFPUSupported TRUE,
      RegisterSize '64', PackMode '8', task MainTask; `project_defined` and `hasconstanttype` are CODESYS's (TwinCAT: the
      unknown-operator pair); a second `{ELSE}` / an `{ELSIF}` after it is the orphan message. (2) Message pragmas the
      same: inside an expression, between a statement's keywords or in an untaken branch neither vendor says a `{warning}`.
      (3) `}` ends a pragma even inside quotes (both); an attribute on a METHOD is the METHOD's (`obsolete` warns at each
      call), on a PROPERTY or STRUCT field obsolete says nothing; an obsolete POU warns ONCE PER USE (its type, each
      instance call, each FUNCTION/METHOD call).
      **The recorder dropped every pragma above a top-level unit** (`scripts/record-language.ts` `pragmaStart` never
      walked back: a unit keyword always opens its line). Found by `prag_if_hasattribute_pou` (the exec recorder carries
      the pragma and took the branch the build's object could not have). Fixed; the 49 fixtures it touched re-recorded
      on both vendors — 15 answers moved (obsolete warnings, `abstract` on an FB, `pingroup` on a unit, an unknown
      attribute on any DUT, `deprecated` unknown to CODESYS, the five TwinCAT `newdel_*` building clean).
      Changed (test-first in `pragmas/conditional.test.ts` 17, `obsolete-usage.test.ts` 8, `pragmas.test.ts` 2 premises
      corrected by the re-recording): `syntax/pragmas/conditional.ts` — `directiveOf`, the `{IF}` condition grammar
      (P10–P13) and `evaluateCondition` against a `ConditionWorld` (vendor, names, device, project settings; a question it
      cannot answer is REFUSED by name, never defaulted); `parse/statements.ts` `applyPragmas` — directives and message
      pragmas where a statement may start, chains per list, untaken branches silent, `BodyParse.messages`/`.refused`, the
      orphan/unterminated errors with `ParseError.orphanPragma`/`.unterminatedConditional` facts (TwinCAT's "Pragma");
      `parse/body-parse.ts` `bodyStatements(body, world)` — ONE tree (`parseStatements`/`parseActive` gone), cached per
      world object; `symbols/condition-world.ts` (names from the scope tree, one world per scope per project generation);
      `bodies()`, parse-errors, no-op-statement, the message pragmas and the transpiler (`transpile/lower/conditions.ts`,
      the exec oracle's device and project as measured — Gate T, `calls.ts`/`lower.ts` only) read it; the
      unresolved-identifier skip and the analysis balance stack are removed. 2.7.2: `Attribute` on unit, member and
      declaration nodes (struct/union fields too), attached once by the parser (`pragmas/attributes.ts`
      `attachAttributes`, `readAttribute` the one reading — pragmas.ts and attribute-placement ask it; hover keeps its
      offset regex, completion reads unfinished text); `FRONTEND_ATTRIBUTES` + `hasFrontendAttribute`; the binder's
      `qualified_only` per unit from the AST; `obsolete-usage` AST-based (the workspace raw-text scan and
      `WorkspaceRefs.obsoletePous` deleted); the formatter prints attributes (it had dropped every one) and keeps a body
      holding any pragma verbatim. Divergences opened (niche: accepted loss, 0 occurrences in the corpora):
      `prag_attribute_brace_in_value` and `prag_project_defined_in_declaration` (both), `prag_if_defined_in_declaration`
      and `prag_project_defined_forbidden_construct` (CODESYS), `prag_project_defined_not_in_declaration` (TwinCAT) — the
      declaration parser applies no conditional pragma (0 conditional directives in any declaration part of the corpora).
      Closed: the five TwinCAT `newdel_*` marks. Rules GAP area 2 **22 → 13** (total 76 → 67): P2, P5, P7, P8, P9, P10,
      P11, P12, P13 closed; P1, P3, P4, P6 gain recorded cells (P14–P16 are 4.x's). `rate:fixtures` (3951): confirmed
      2344, refused 1377, not-lowered 139, lsp-gap 24, diverges 4, unaskable 63; edges agree 2453 / disagree 0 / not-run
      102. Ceilings (`fixtures.test.ts`, FOR MEASUREMENT): lsp-gap 22 → 24 (the two declaration-part cells,
      `MEASURED_SILENT`), not-lowered 137 → 139 (`prag_if_hasconstanttype`: the "Replace constants" option is not in the
      exec world; `prag_unknown_attribute_on_union`: `layout-union`). Floors CODESYS 3569 → 3640, TwinCAT 3508 → 3585.
      Frontend ceilings: parse findings 76 → 72 (the orphan/unterminated cells now the parser's), refused with a syntax
      message CODESYS 36 → 34, TwinCAT 39 → 37; resolution fixtures bare NONE CODESYS 5 → 0, TwinCAT 12 → 7 (names only
      an untaken branch held); a new capped measure `call UNKNOWN, __NEW or __DELETE` (TwinCAT fixtures 20, the
      `newdel_*` measured since their marks went — task 4.3.4's). **Coverage, said:** the corpora hold 15 bodies with
      conditional pragmas (16 `{IF}`); with the analysis world 2 are decided (`defined (pou: …)`) and 13 are REFUSED
      (`defined (IsSimulationMode)`, a device fact the LSP does not hold) — analysis no longer reads them (it used to read
      every branch, unresolved-identifier skipping them), which is why corpus expressions measured fell 123519 → 123142
      and several corpus UNKNOWN ceilings fell with them (a fall of coverage, not of disagreement). F (`frontend-snapshot
      check --base HEAD`): 3647 aspects over 1031 sources — 2901 added (the new fixtures), `ast` 618 (every source
      carrying an attribute), `stmts` 40 / `active` 32 (bodies with conditional or message pragmas), `resolution` and
      `types` 26 each, `folds` 1, `lowering` 3 (the conditional bodies). Targeted: `bun test src` 1592 / 0,
      `test/conformance test/frontend test/catalog test/corpus` 5279 / 0; `tsc --noEmit` clean; lint exit 0.
      **Review fixes 2.7 (2026-10-02).** (1) TWO TREES: the compiled one (`bodyStatements`, analysis and the transpiler)
      and the body AS WRITTEN (`sourceStatements`, every branch in) — rename, references and highlight
      (`services/navigation/references.ts`), hover/definition/signature help (`bodiesAt`), call hierarchy, inlay hints
      (`symbols/scoped-bodies` `sourceBodies`), folding, selection and on-type indent read the source tree: a use in a
      branch not taken, or in a body the LSP cannot decide (pro2193 `IMM_Default.fb` 995, `IQ_Handling.prg`), was left
      unrenamed. (2) `defined (X)` / `hasvalue (X, …)` of a name the body does not define asks the project's COMPILE
      DEFINES — refused by name without them, never FALSE by default; `Scope.environment` (`buildSymbolTable`'s 4th
      argument) carries what a builder MEASURED: none in the LSP, the recording projects' (no compile define, measured by
      `prag_define_upper_case`, `prag_else_twice`, …; `test/conformance/support/recording-environment.ts`) in the
      replay, the census and the evidence, the exec oracle's in the transpiler. (3) An undecided condition leaves only
      ITS CHAIN undecided (`parse/statements` `applyPragmas`, `Compiled` on/maybe/off): each branch parsed in silence, a
      define there makes its name uncertain, and the text outside — compiled either way — keeps its syntax errors, its
      messages and the chain's orphan/unterminated structure (before: no error, no message, no fold). The corpus gates
      read the source tree (`materializeFailures` no longer excludes refused bodies; the formatter fixed point compares
      every branch), the corpus UNKNOWN/NONE ceilings return to their pre-2.7 values (member NONE 3602, call UNKNOWN
      1939, binary 3382, ident_expr 469, index 223, member UNKNOWN 4217 — the 2.7 cuts were lost coverage), and the lost
      coverage is COUNTED: `… expressions in a conditional branch Volt cannot decide, not measured` (corpus 15, fixtures
      36/32). An unquoted `hasattribute` attribute is the condition parser's vendor error where the directive acts
      (`ParseError.attributeValueString`, code `attribute-value-string`; the analysis scan keeps the pragmas out of a
      body) — `cc6_attribute_value_unquoted` is then a body the vendor refuses too, which the restored measurement needed
      (its `n + 1` had been hidden behind the refusal while `newdel_with_pragma_has_method`'s joined the TwinCAT count).
      (4) `hastype` is answered for an elementary spec of a variable of an elementary type only (`TYPED_PREFIXES`); a
      generic spec (ANY_INT…) or an alias/DUT/FB variable is refused. (5) The message words are lower case only, in a
      body and out of one (`analysis/checks/pragmas` reads them through `directiveOf`): recorded `prag_warning_upper_case`,
      `prag_warning_mixed_case`, `prag_error_upper_case`, `prag_warning_upper_case_in_declaration` — all four build
      CLEAN on CODESYS and TwinCAT (`record:language` both, `record:exec` CODESYS); `rate:fixtures` confirmed 2344 → 2348.
      **Review fixes 2.7, round 2 (2026-10-02).** (1) The SOURCE reading voided a body whose untaken or undecided branch
      held a syntax error (`prag_untaken_branch_syntax_error` builds), dropping it from rename/references/folding:
      `parseSourceStatementTokens` now follows the chains' structure where a statement may start, asks no condition, and
      parses every branch in silence and KEEPS it — an error outside every chain, or an orphan/unterminated chain, still
      voids it (`navigation.test.ts`, `conditional.test.ts`). (2) `dumps.ts` `parseErrors` takes a `Bound` and parses a
      body in `bodyConditionWorld` as `parse-errors` does (the census binds corpus, fixtures and library as `bound.ts`
      does); `SYNTAX_WORLD` is gone. (3) `defined (RegisterSize|PackMode)` and `hasvalue (IsLittleEndian|IsSimulationMode|
      IsFPUSupported, …)` are refused by name, not answered FALSE by the project defines (0 occurrences in the corpora).
      (4) Recorded `prag_hasattribute_unquoted_{elsif_after_taken,elsif_asked,in_untaken_branch,in_declaration}`
      (`record:language` both; none builds on CODESYS, so no exec): both vendors say the unquoted-attribute error on
      every `{IF}`/`{ELSIF}` in a body, its condition asked or not — `applyPragmas` reports it from the condition's
      text wherever the directive stands (`PragmaState.textErrors`, kept apart from what silence drops). In a VAR
      section CODESYS adds "This code is not supported in declaration part" and TwinCAT builds clean:
      `prag_hasattribute_unquoted_in_declaration` a known divergence on both (niche: accepted loss (0 occurrences in
      the corpora)). `rate:fixtures` (3959): confirmed 2348, refused 1377 → 1381; frontend baselines rewritten (counts
      of the four fixtures only, no finding moved). Targeted: `bun test src` 1608 / 0, `test/frontend` 30 / 0, the
      conformance replay (`-t "LSP against|prag_hasattribute|cc6_attribute|prag_untaken"`) 8 / 0; `tsc` clean.
      **Gate 2.7 (2026-10-02).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (3959
      fixtures: confirmed 2348, refused 1381, not-lowered 139, lsp-gap 24, diverges 4, unaskable 63; edges agree 2458 /
      disagree 0 / not-run 102). `bun test` 6923 pass / 34 skip / 183 todo / 0 fail (7140 tests, 195 files, 288 s, rustc
      cache on); agreement CODESYS 3647, TwinCAT 3592 (3959 fixtures) — the floors raised to them (3640 → 3647, 3585 →
      3592: the review's cells), re-confirmed by the agreement tests. `bun run check` 14 passed, 0 failed; `bun run lint`
      exit 0 (warnings only). volt-cli untouched by 2.7 (no dotnet run).
- [x] 2.8.1 One token-description wording (the vendor's): the named forms from 1.16 collapse to the recorded ones. Record
      rec_file_scope_stray, rec_expected_expression.
      Where: parse/errors, parse/parser. Acceptance: CA. Depends on: 2.7.3
      **Done 2026-10-02** (the three 2.8 tasks were one CONFORMANCE pass, rule by rule over R1–R6, one fixture file
      `fixtures/grammar/recovery.ts`, 55 `rec_*`; recorded in ONE batch per vendor and two follow-up batches the first
      answers asked for — `record:language` both vendors, 52 recorded, 3 refused by the PUSH on both, `vendorRefuses` +
      `execSkip`; nothing builds, so no `record:exec`). `parse/errors`: ONE wording, the vendors' — `plainTokenText`,
      `typeTokenText`, `expressionExpected` deleted; "Expression expected instead of 'X'" for every token
      (`rec_expected_expression*`: `;` `)` `*` `,` `]`; the end of the body is "';' expected instead of end of POU" + "Expression
      expected instead of ''"), "Type definition expected instead of 'X'" for every token (`rec_type_expected_literal`), the END
      of the text quoted `''` everywhere but after `';'` ("end of POU", 146 recorded — `expectedInsteadOf`), `atObjectEnd` one
      helper. R4 (`parse/parser`): a POU text opening with a NAME declares nothing and says nothing (`rec_file_scope_stray_
      before_unit`, `cc5_deprecated_functionblock_keyword` — both vendors); text AFTER a unit is the push's refusal on both
      vendors ("expected METHOD/ACTION/PROPERTY, got: X" — `rec_file_scope_stray`, `_semicolon`, `_keyword`), worded so; after
      a DUT/GVL "Unexpected token 'X' found". Units' recovery in the vendors' words: an unclosed STRUCT/UNION reads END_TYPE as
      a field name (`rec_unterminated_struct`, `_union`), an unclosed VAR section wants END_VAR instead of '' where the
      declaration part ends — its IMPLEMENTATION line too (`rec_unterminated_var`) — echoing a VAR section it meets as a
      STRUCT does (`rec_unterminated_var_before_section`), a name in an INTERFACE is a declaration's (`rec_interface_stray`),
      a member name missing takes the next token (`rec_member_name_expected`), `JMP;` takes its `;` for the destination
      (`rec_jmp_without_label`; the label checks now read a body that did not parse cleanly, `symbols` `bodiesThroughErrors`),
      `IF THEN` is the one line (`rec_expected_expression_condition`). Tests (test-first for R2/R6, in `statements.test.ts`
      18, `parser.test.ts` 2, `initializer-names.test.ts`, `types.test.ts` 1). Premises the recordings overturned, corrected:
      `parser.test` "unterminated section", `conditional.test`, `parse-errors.test` (a variable named INT), the error catalog's
      C0008/C0010/C0027/C0189/C0211/C0213 expectations (Volt wordings, now the vendors').
- [x] 2.8.2 Recovery (R1–R2): record rec_missing_then, rec_missing_of, rec_missing_do, rec_missing_end_if, rec_missing_end_case,
      rec_missing_end_for.
      Where: parse/statements, parse/errors. Acceptance: CA. Depends on: 2.8.1
      **Done 2026-10-02.** R1 agreed already (`rec_missing_semicolon_*`, 4). R2 (`parse/statements`): a block keyword missing is
      its one line (`rec_missing_then*`, `_of`, `_to`, `_do*` agreed); a block's list ends at every block CLOSER
      (`BLOCK_CLOSERS`), its own or another's, and at the end of the body — a block whose list ended elsewhere is LEFT OPEN,
      "Unexpected End-of-file found: <list> expected" (one list per block whatever part is open: IF 'ELSIF', 'ELSE' or
      'END_IF', CASE 'END_CASE', FOR, WHILE, REPEAT 'END_REPEAT' — also when its UNTIL never came —, __TRY '__CATCH',
      '__FINALLY' or '__ENDTRY'), every block around it leaves too, and the body's list refuses the closer as a statement
      start (`rec_missing_end_*`, `rec_end_while_closes_if`, `rec_stray_closer_*`); an ELSE/ELSIF after the ELSE is refused
      inside the ELSE branch (`stmt_if_two_else`). The resync's end of the text is "';' expected instead of end of POU".
- [x] 2.8.3 The vendor cascades in one place (R3, R6): analysis/resync.ts and refused-name's cascade are folded into parse/errors.
      Record rec_refused_name_cascade_type_word, rec_refused_name_cascade_function_word, rec_unknown_literal_prefix_cascade.
      Where: parse/errors. Acceptance: CA; the 0.1 parse-census baseline is empty (every finding closed or a recorded known
      divergence named here). Depends on: 2.8.2
      **Done 2026-10-02.** `analysis/checks/names/refused-name.ts` (+ test), `analysis/resync.ts` and
      `analysis/checks/declarations/system-initializer.ts` DELETED, their rules the parser's: `lex/vocabulary`
      `IL_OPERATOR_WORDS`, `ELEMENTARY_TYPE_WORDS` (held to `types/elementary` by a test), `CODESYS_ONLY_TYPE_WORDS` (moved
      from `types`), `isRefusedWord`/`isRefusedDeclaredName`; a refused word is the word where a declaration's name (with
      `__` names), a statement start or an operand belongs, and the resync PAIRS it (`Cursor.refusedWord`, only in a BODY —
      `BodySpan.dialect`, the body's vocabulary, now carried; `frontend-snapshot` leaves it out of the AST it hashes); a callee
      (`LTIME()`) and a lone argument (`XSIZEOF(DINT)`) are names. The declaration cascade RESUMES a declaration at a name and a
      refused `;` takes the declaration after it (`rec_refused_name_declared_fb_type`), which closed `unit_struct_extends_*` on
      CODESYS. An intrinsic's `.` ends the expression (`op_sys_varinfo`), and a `__` identifier leading an initializer is
      refused (`cc_decl_init_dunder_unknown`, TwinCAT's `__POSITION`; the `__SYSTEM` namespace through its `.`). Test sources
      that declared IL operators or type names as variables (`s`, `r`, `word`, `__clock` — refused by both vendors, recorded)
      renamed: `transpile/lower/{lower,calls,init-sequence}.test.ts`, `interp.test.ts`, `emit/rust/emit.test.ts` (test
      files only), `services/assist`, `formatting`, `analysis/checks/types/*`, `network-wire-type`, `types.test`.
      **Parse census (0.1): findings 70 → 0** (baseline empty): 43 closed by the parser (the refused words, `op_sys_varinfo`,
      cc5); the TwinCAT `__POSITION` initializer pair and `cc_decl_init_dunder_unknown` now parse errors; three messages the
      census's pattern matched by their words are name/type answers (`cc2_type_name_and_method_without_parens` "Type name …
      not expected", `cc3_unexpected_struct_init`, `decl_nested_aggregate` "Unexpected structure/array initialisation") and
      a network body's refusals are the network reader's (`network_unnamed_*`) — both now said in the census, with reasons;
      the rest are known divergences named below.
      **Divergences opened** (`support/divergences.ts`): `RECOVERY_DIVERGENCES` `rec_refused_name_cascade_il_word` (both; the
      rebuilt "'(n + !!!'ERROR'!!!);' is no valid statement", niche: accepted loss (0 occurrences in the corpora));
      `TWINCAT_RECOVERY_DIVERGENCES` `rec_interface_stray`, `rec_refused_name_declared_fb_type` (TwinCAT's own recovery,
      niche: accepted loss (0 occurrences in the corpora)); `rec_unterminated_var_before_section` into
      `TWINCAT_DRIVER_CUTS_THE_ECHO`; `CALC_CONDITIONAL_CALL` `cc_il_name_calc`, `ilc_calc_*` (4) (both; the conditional
      call's cascade, niche: accepted loss (0 occurrences in the corpora — two comments)); `CODESYS_POSITION_IN_AN_INITIALIZER`
      `sysop_position_initializer` (from the CODESYS triage backlog, niche: accepted loss (0 occurrences in the corpora));
      `cp_xsizeof` into `TWINCAT_XSIZEOF_IS_NO_KEYWORD`; `unit_struct_extends_after_struct`, `_twice` kept on TwinCAT only.
      **Closed**: `stmt_assign_missing_value`, `stmt_if_else_if_two_words`, `stmt_s_eq_spaced`, `stmt_assign_spaced_operator`,
      `lit_time_fraction_ms` (both), `cc5_deprecated_functionblock_keyword` (CODESYS known + the TwinCAT triage backlog, now
      empty), `unit_struct_extends_after_struct`, `_twice` (CODESYS).
      **Numbers.** Rules GAP area 2 **13 → 9** (total 67 → 63): R2, R4, R5, R6 closed; R1, R3 gain recorded cells.
      Agreement CODESYS 3647 → 3707, TwinCAT 3592 → 3645 (4014 fixtures; floors raised). `rate:fixtures` (4014): confirmed
      2348, refused 1381 → 1434, not-lowered 139, lsp-gap 24 → 23 (ceiling lowered), diverges 4, unaskable 63 → 66; edges agree
      2438 / disagree 0 / not-run 102. Frontend baselines rewritten (no finding added; one census bucket: an expression over a
      typed literal whose prefix names no type, "no component on the vendor too"). F (`frontend-snapshot check --base HEAD`):
      2493 aspects over 403 sources — the 55 new fixtures, and 513 aspects over 184 sources outside them, each a source holding
      a refused word, a recovery or a wording of R1–R6 (the cc_il/cc_reserved/cc4/identifier families, `op_sys_varinfo`, the
      pwh/unit/decl recoveries, the transpile `back/` rows of the newly refused sources). Targeted: `bun test src` 1616 / 0,
      `test/frontend` 30 / 0, `test/catalog` 147 / 0, `test/corpus` 19 / 0, conformance (`-t` the touched fixtures, "LSP
      against", the table, the ratchet) 166 / 0, `suite` + `support` 58 / 0; `tsc` clean; lint exit 0; `bun run check` 14 / 0.
      **Review 2.8 (2026-10-02).** The positions 2.8.3 had not asked, recorded in one batch per vendor (18 fixtures in
      `recovery.ts`, both vendors): a refused word as a statement or CASE label (`rec_refused_word_case_label*`,
      `_body_label_*` — refused as a statement start now, no invented label warning; the FIRST arm without its label is
      "No CASE label found" / "No case label found", a `noCaseLabel` fact, which also closed TwinCAT's
      `lit_enum_typed_case_label`), a keyword or refused word as a JMP target (`rec_refused_word_jmp_target`,
      `rec_jmp_keyword_target` — the invalid destination, as `JMP;`; "expected a label after JMP" deleted), a refused word
      in an initializer (`rec_refused_word_initializer*` — the malformed-literal pair and placeholder), the end of the text
      as a member name (`rec_member_name_at_end` — "'' is no component"; "expected member name after '.'" deleted), a keyword
      in an INTERFACE (`rec_interface_stray_keyword` — "unexpected 'X' inside INTERFACE" deleted). Confirmed as built, no
      change: STRUCT/UNION fields named a refused word (`rec_refused_word_struct_field*`, `_union_field`), the `.name`
      resume and a punctuation member (`rec_refused_word_member_cascade`, `rec_member_name_punct`), and `__TRY_CAST`
      leading an initializer refused on BOTH vendors (`rec_dunder_try_cast_initializer`). Known divergences, niche: accepted
      loss (0 occurrences in the corpora): `rec_refused_word_for_variable`, `rec_type_name_dot_dangling` (both vendors read
      the VAR section away; the LSP's "expected identifier after '.'" stays there). The error catalog's C0011 expectation
      (a Volt wording, never verified) is the documented "No CASE label found". Agreement CODESYS 3723, TwinCAT 3662 (4032
      fixtures; floors raised); `rate:fixtures` refused 1434 → 1452; frontend baselines rewritten (no finding added).
      **Gate 2.8 (2026-10-02).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (4032
      fixtures: confirmed 2348, refused 1452, not-lowered 139, lsp-gap 23, diverges 4, unaskable 66; edges agree 2438 /
      disagree 0 / not-run 102). The first full run had 2 failures, both test sources declaring the IL operator words as
      variables (`s : SR`, `r : RS` in `test/libraries/standard.test.ts`; `s : STRING` in `stringutils.test.ts`) — refused by
      both vendors (recorded in 2.8.3), the same rename 2.8.3 made in `src/` and missed under `test/libraries/` (test files
      only; the premise was wrong on the vendors' grounds). `bun test` (serial) 6941 pass / 34 skip / 183 todo / 0 fail
      (7158 tests, 194 files, 170 s, rustc cache on with sampled re-proof); agreement CODESYS 3723, TwinCAT 3662 (4032
      fixtures, = the floors). `bun run check` 14 passed, 0 failed; `bun run lint` exit 0 (warnings only). volt-cli
      untouched by 2.8 (no dotnet run).
- [x] 2.9 Printer/formatter fixed point (PR1–PR4): STRING[n] and AT-after-type round-trip; parentheses from precedence; modifier
      order kept.
      Where: syntax/print.ts, services/formatting/print.ts; tests `print.test.ts` "STRING[n] round-trips", "AT after the type
      round-trips", "nested binary gets precedence parentheses"; `services/formatting/print.test.ts` "method modifiers keep their
      order". Acceptance: the four named tests exist and pass; the 0.2 fixed-point baseline is EMPTY; PR1–PR4 are no longer GAP in
      rules.test. Depends on: 2.8.3
      **Done 2026-10-02.** The printer is Volt's, so no recording decides it (design §4 2.9): rule by rule, each with its named
      test, written red first. PR1: the last three fixed-point findings (`cc2_var_in_interface`, `hdr_interface_var_input`,
      `itf_var_section_declaration`) were one root cause — an INTERFACE's VAR section, refused by a check (C0149) and not
      the parse, was dropped by the formatter; it is printed now, and an interface's members (methods, properties, stray
      sections — three AST lists) in the order written, by span. `baselines/fixed-point.json` is EMPTY (29 170 corpus,
      8 064 fixture, 50 library files) and its ceilings 3 → 0. PR2: a STRING's length delimiters are in the AST
      (`StringType.delimiters`: `()`, `[]`, `(]`, `[)`, or the opener alone when the closer is missing) and printed as
      written — the formatter rewrote `STRING[80]` to `STRING(80)` (9 occurrences in the corpora); AT after the type is
      a parse refusal (D10), so its unit is kept verbatim (test pins it, and AT before the colon reprinted as written).
      PR3: `exprText` parenthesizes a child its parent would capture, by the parser's `BINARY_PRECEDENCE` (left-associative
      levels; unary then postfix tighter; an inline assignment loosest) — a parsed tree carries its `paren` nodes, so no
      parsed output moved (fixed point unchanged, snapshot F: only the `ast` aspect of 1837 sources differs, the new
      `delimiters` field — no errors/tokens/stmts/diagnostics/rust/interp change). PR4: already kept (the parser's ordered
      modifier list); pinned on METHOD, FB, PROPERTY and interface members, a refused order kept verbatim. Tests:
      `src/frontend/syntax/print.test.ts` "STRING[n] round-trips", "nested binary gets precedence parentheses";
      `src/services/formatting/print.test.ts` (new) "AT after the type round-trips", "method modifiers keep their order",
      "an interface's VAR section survives formatting, in its place". Rules GAP area 2 **9 → 5** (total 63 → 59): PR1–PR4
      closed with their named tests. No fixture recorded (none decides a printer rule); no known divergence added.
      **Gate 2.9 (2026-10-02).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (4032 fixtures:
      confirmed 2348, refused 1452, not-lowered 139, lsp-gap 23, diverges 4, unaskable 66; edges agree 2438 / disagree 0 /
      not-run 102). `bun test` (serial) 6949 pass / 34 skip / 183 todo / 0 fail (7166 tests, 195 files, 183 s, rustc cache on
      with sampled re-proof) — +8 tests, +1 file (the new formatting/print.test.ts) over gate 2.8; agreement CODESYS 3723,
      TwinCAT 3662 (4032 fixtures, = the floors). `bun run check` 14 passed, 0 failed; `bun run lint` exit 0 (warnings only).
      volt-cli untouched by 2.9 (no dotnet run).
### 2.Q Targeted runs cost what they check (workflow timing, owner 2026-10-02: "optimise without losing quality")

Measured over the 39 agents of steps 2.4a–2.8 (17.7 agent-hours): 28% went to three repeated runs that do far more than
the agent looks at — `bun test test/frontend` 144× (median 53 s, 2.2 h), `bun run rate:fixtures` 67× (77 s, 1.4 h),
`bun test test/conformance -t <names>` 57× (62 s, 1.3 h: a -t filter still registers every fixture and runs the whole
Rust before-all phase). The GATE keeps every full run; only the inner loop gets cheaper. Risk accepted: a partial run
cannot see a change breaking OTHER fixtures — the same blind spot -t has today; each implement/fix agent still ends with
ONE whole test/conformance + test/frontend + rate:fixtures, and the gate runs everything.

- [x] 2.Q.1 `VOLT_FIXTURES=<name,name,…>` (exact names; unknown name → throw, never "0 tests ran = green"): fixtures.test.ts
      registers, LSP-runs and Rust-builds ONLY those fixtures (the before-all phase included); every per-fixture check
      is the same code path as the full run. A loud line says the run is partial. CI/`VOLT_REQUIRE_FULL=1` refuses it.
      Test: a named run of 3 fixtures executes the same assertions as the full run for those 3 (titles + verdicts equal).
      Acceptance: a 3-fixture run in seconds (was ~62 s), written here.
      **Done (2026-10-02).** `test/conformance/support/selection.ts` (`selectFixtures`, tested in `selection.test.ts`: unset
      → all; named → those, in suite order, one `PARTIAL RUN` line; unknown or empty → throw; `CI` / `VOLT_REQUIRE_FULL=1`
      → throw). `fixtures.test.ts` walks `SELECTION.selected` for every per-fixture row — the rating rows, both Rust
      before-alls, the table-is-total rows, the build-recording replay, the simulator gate — while `ALL_TESTS` stays the
      universe a fixture is assembled, rated and bound in (every other fixture's declarations stay in the shared project,
      so a named fixture is checked against the project the full run checks it against). Project-wide totals are skipped
      in a partial run (`whole`): the not-lowered blocker report, dead notes, the map's NOTES section, the evidence
      distribution and ceilings, the two agreement floors; the reverse-direction checks (a MEASURED_SILENT / triage entry
      that no longer fires) are held for the named fixtures. Measured: `bun test test/conformance -t "bit_or_bool|
      cc_conv_short_source_mismatch|decl_implicit_enum_with_base_into_byte"` **73 s** (2323 Rust cases compiled) →
      `VOLT_FIXTURES=<the three> bun test test/conformance/fixtures.test.ts` **2.6–2.8 s** (3 runs; 1 + 2 Rust cases).
      Equivalence, by the JUnit reports of a full run (5023 pass, 139 todo, 0 fail — green with the change) and the
      partial one: the 3 rows titled by a named fixture are present in both with the same verdict, and every one of the
      44 partial rows is a full-run title with the same verdict (pass), the 6 `whole` totals skipped. A diverges fixture
      alone (`decl_subrange_unsigned`) runs its expected failure with its Rust half; `bit_or_boool` exits 1 naming it.
- [x] 2.Q.2 test/frontend: each baseline file runnable alone and cheap (census, resolution, type, fold, fixed-point,
      rules); measure where its 53 s goes (corpus read/parse once per process — already memoized? — or per file) and
      remove repeated work with the same output. Acceptance: per-file times before/after written here; outputs identical.
      **Done (2026-10-02).** Where it goes, measured phase by phase: reading the corpus 1.6 s (already once per process);
      `boundCorpus` over the six projects 6.0 s (2.2 s parse + binding) — NOT memoized, paid by the parse census AND the
      bound census; the printer census parsed the corpus a third time (2.2 s of its 7.7 s); `withBoundFixture` × 2
      vendors 1.0 s; the bound census 13.5 s (once per process already, shared by type/fold/resolution); resolution-dump's
      own `lspErrors` × 2 vendors 4.7 s and the server pass over the corpus (`projectDocuments`) ~8 s — the oracle the
      measurement is about, not repeatable work. Fixed: `boundCorpus` once per project per process (`bound.ts`), and
      `dumps.ts` `parse` once per file object and dialect (the corpus files and each fixture's own item and PLC_PRG are
      the same objects to every measurement). Per file, alone, before → after: parse-census 10.6 → 10.2 s,
      resolution-dump 27.9 → 27.0 s, type-dump 16.2 → 16.2 s, fold-dump 15.9 → 16.2 s, fixed-point 10.0 → 10.4 s, rules
      0.37 → 0.36 s, bound-census 0.59 → 0.49 s, baseline 0.67 → 0.65 s, layering 0.29 → 0.28 s — each file alone had no
      repeated work left to remove (its cost is its one measurement); the repeat was ACROSS files: the folder
      **44.5 → 36.0 s**, and type + fold + resolution named in one call 27.4 s (one census) against 59 s run one by one.
      Outputs identical: the folder's printed counts byte-equal before/after, and `VOLT_WRITE_BASELINE=1` rewrote every
      `baselines/*.json` (and `ceilings.json`) with no content change.
- [x] 2.Q.3 TESTING.md documents VOLT_FIXTURES and the per-file baseline runs (the inner loop), and that a gate/close
      never uses them. (The executor's own rules are updated by the owner's session, not by this step.)
      **Done (2026-10-02):** TESTING.md "Running" → "The inner loop — runs that cost what they check".
      Not done on purpose: a partial `rate:fixtures` — the map has project-wide totals and a partial rewrite would leave
      them stale; agents run the full `rate:fixtures` ONCE at the end of their work instead of after every edit.
      **Gate 2.Q (2026-10-02).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (4032 fixtures:
      confirmed 2348, refused 1452, not-lowered 139, lsp-gap 23, diverges 4, unaskable 66; edges agree 2438 / disagree 0 /
      not-run 102). `bun test` (serial, `VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset) 6955 pass / 34 skip / 183 todo /
      0 fail (7172 tests, 197 files, 162 s, rustc cache on with sampled re-proof) — +6 tests, +2 files
      (`partial-run.test.ts`, `support/selection.test.ts`) over gate 2.9; agreement CODESYS 3723, TwinCAT 3662 (4032
      fixtures, = the floors). `bun run check` 14 passed, 0 failed; `bun run lint` exit 0. volt-cli untouched by 2.Q
      (no dotnet run).

- [x] 2.10 Area 2 closed: every §4 2.x rule (L, N, S, A, D, T, U, E, ST, P, R, PR, FMT) has a recorded fixture or named test.
      Where: test/frontend/rules.ts. Acceptance: the rules.test GAP count for area 2 is 0 and pinned as 0; known divergences left
      in area 2 listed here with their reason. Depends on: 2.9
      **Done 2026-10-02.** Rule by rule over `rules.ts`, area 2 had five GAP rows left (T6, U16, P14, P15, P16); each now
      has recorded fixtures or named tests. 44 fixtures written and recorded in one batch per vendor (`record:language`
      CODESYS + TwinCAT, `record:exec` CODESYS; 4 re-recorded after a fixture fix), 43 kept:
      - **T6** (`grammar/type-expressions.ts`): the POINTER TO POINTER USED without ADR (whose result type is 4.3.4's) —
        `decl_pointer_to_pointer_deref_typed` (`p := pp^; x := pp^^;` builds on both; in a branch never taken, so no null
        read), `_once_into_int` (`x := pp^;` "Cannot convert type 'POINTER TO INT' to type 'INT'", both), `_thrice`
        (`pp^^^` "Dereference requires a pointer"; TwinCAT "… Pointer"). The LSP gives each message; `_once_into_int`'s is
        C0033, an ERROR in both recording projects and a warning as shipped — known divergence
        `C0033_CONFIGURED_AS_AN_ERROR` (both vendors), the reason `cc5_pointer_not_convertible` already has on CODESYS.
        `_deref_typed` is not-lowered (`pointer-order`, the transpiler's pointer model).
      - **U16** accessor cells — VOLT'S FORMAT, decided by named tests as FMT is: in both IDEs a getter/setter is an
        object with a declaration of its own, and the push reads that declaration from the lines UNDER the keyword line,
        dropping the keyword line whole, and closes a `GET` without END_GET at its own line. Measured in the corpora: the
        pull writes an accessor's modifier on the line UNDER `GET` (39 in pro2193), never beside it; all 366 GET / 86 SET
        lines are closed. Fixed test-first (`parse/units/property.ts`; `parse/body.ts` `collectAccessorBody` now says
        whether its END_ closed it): a modifier on the keyword's own line, and code (or a VAR, or a comment) under an
        accessor left open, are refused by name — the push would drop them (0 of either in the corpora); the pulled form
        and a bare `GET` are accepted. Tests: `property.test.ts` "an accessor's modifier on the keyword's own line is
        refused; on the line under it, it is the accessor's declaration", "an accessor without END_GET/END_SET is bare:
        code under it is refused, the bare keyword is not". The fixed point then found the FORMATTER printing a pulled
        accessor modifier beside the keyword (`GET PUBLIC` — a text the push writes to the IDE as `GET`; 21 corpus
        files): fixed, `services/formatting/print.test.ts` "an accessor's modifier prints on the line under GET/SET, where
        the push reads it". The three unaskable `unit_property_*` fixtures (recordings of the push-rewritten text) are
        known divergences `ACCESSOR_TEXT_DROPPED_BY_THE_PUSH` (both vendors). The push's silent drop itself
        (`StReader.ReadProperty`) is volt-cli's and still open — reported, not touched by this step.
      - **P14** `strict` (`grammar/pragmas.ts`, `prag_strict_enum_*` and the twins `prag_enum_not_strict_*`, both vendors
        identical): `strict` refuses an INT variable ("'i' is not a valid value for strict ENUM type …"), a literal no
        member names ("'5' is not …") and arithmetic ("Arithmetics not allowed on strict ENUM type …"); it accepts a
        literal a member names, the enum into an INT, a comparison with a literal or an INT, TO_INT. Without it every cell
        builds. The three refusals are lsp-gap with `deferred.lsp` — `strict` is read by the type compatibility of task
        4.5.1 (CV5, P14), not this step's; not niche (56 `{attribute 'strict'}` in the corpora). HELD OUT for the owner
        (as 2.3b's three): `prag_enum_not_strict_add_literal` (`e + INT#1`, both build, CODESYS out = 2, the LSP agrees)
        raises the census ceiling `binary UNKNOWN` by 1 per vendor — the front-end types an enum operand of arithmetic
        nowhere yet (4.5.1); documented in the fixture file, its recordings removed. The strict twin's binary is counted
        as refused on the vendor (`bound-census.ts`, a new key). Arithmetic cells use a TYPED literal, so they ask about
        `strict` and not about an untyped literal's type.
      - **P15** `to_string` (`prag_to_string_*`): TO_STRING / INT_TO_STRING / TO_WSTRING of a member or variable is the
        member's NAME ('On', "On"), a base type changes nothing, without the attribute it is the value ('1'), a value no
        member names prints its number ('5'), an enum into a STRING unconverted is refused. The LSP agrees on every
        build. Lowering printed the NUMBER under the attribute — a silent wrong answer the recording exposed: now refused
        by name (`transpile/lower/builtins.ts`, `lower.test.ts` "a `to_string` enum's STRING conversion is refused by
        name; the same enum without it prints its value"); the member-name table is 4.5.1's.
      - **P16** `const_replaced` / `const_non_replaced` (`prag_const_*`, both vendors identical): the decorated constant is
        still a constant everywhere one is required — ARRAY bound, STRING length, CASE label, subrange bound, another
        constant's initializer — and "no valid assignment target" when written; `const_replaced` on an ARRAY constant is
        accepted silently. The attribute changes storage, never constancy; the LSP agrees on every cell.
      Measurement refinement (an independent recorded fact): the type dump reads an enum holding a value no member names
      as printed in its base type (`INT#5`, CODESYS run), not as a disagreement. Rules GAP area 2 **5 → 0** (total
      59 → 54), pinned at 0 twice: `baselines/ceilings.json` and the hard-zero row in `rules.test.ts` "area 2 is closed:
      every grammar rule has a recorded fixture or a named test (tasks.md 2.10)". `rate:fixtures` (4075 fixtures):
      confirmed 2376, refused 1457, not-lowered 146, lsp-gap 26, diverges 4, unaskable 66; edges agree 2468 / disagree 0
      / not-run 102. Ceilings (`fixtures.test.ts`, FOR MEASUREMENT): lsp-gap 23 → 26 (P14's three), not-lowered
      139 → 146 (`decl_pointer_to_pointer_deref_typed` and six `prag_to_string_*`). Floors CODESYS 3723 → 3757, TwinCAT
      3662 → 3696. Targeted runs: `bun test test/conformance` 5156 pass / 146 todo / 0 fail (agreement CODESYS
      3757/4075, TwinCAT 3696/4075), `bun test test/frontend` 31 / 0 (baselines rewritten — counts only; ceilings
      changed only by the GAP rows), `bun test src` 1639 / 0, corpus "lowering is total" 5 / 0; `bun typecheck` clean,
      `bun run lint` exit 0.
      **Known divergences left in area 2**, each with its reason in `test/conformance/support/divergences.ts`: the
      vendors' RECOVERY after a first refusal the LSP gives (`RECOVERY_DIVERGENCES`, `DECLARATION_RECOVERY`,
      `TYPE_EXPRESSION_RECOVERY`, `UNIT_HEADER_RECOVERY`, `IMPLICIT_ENUM_LIST_RECOVERY`,
      `LITERAL_REFUSAL_DECLARATION_RECOVERY`, `AFTER_A_REFUSED_TYPE`, `CALC_CONDITIONAL_CALL`; TwinCAT's
      `TWINCAT_RECOVERY_DIVERGENCES`, `TWINCAT_STRUCT_EXTENDS_RECOVERY`, `TWINCAT_NON_RETAIN_RECOVERY`,
      `TWINCAT_NO_VAR_GENERIC`, `TWINCAT_VECTOR_REFUSAL_CASCADE`, `TWINCAT_IF_RECOVERY_AFTER_A_REFUSED_LITERAL`,
      `TWINCAT_REFUSED_PREFIX_INSIDE_A_LIST`, `TWINCAT_REFUSED_LDATE_LITERAL_STOPS`, `TWINCAT_WSTRING_ESCAPE_RUNS_TO_END`,
      `TWINCAT_NO_EFFECT_AFTER_AN_UNKNOWN_WORD`, `TWINCAT_NOTHING_OF_PLC_PRG_BESIDE_A_PARSE_ERROR`); a rule of a later
      task or of analysis (`UNKNOWN_QUALIFIED_TYPE` 3.4.2, `GVL_MEMBER_NOT_DECLARED` Y9, `IMPLICIT_ENUM_TYPE_NAME`
      3.3/4.7.4, `LITERAL_ONE_IS_BIT` 4.1.3, `ENUM_TO_ENUM_IS_A_WARNING`, `CALL_IN_AN_AGGREGATE_INITIALIZER`,
      `EXTERNAL_LOOKUP_IN_A_REFUSED_SECTION`, `FB_ACCESS_AT_THE_CALL`, `STATEMENT_DIVERGENCES`,
      `EXPRESSION_NICHE_DIVERGENCES`, `LITERAL_FOLLOW_ON_RULES`, `STRING_LENGTH_AS_WRITTEN`,
      `CODESYS_POSITION_IN_AN_INITIALIZER`); niche: accepted loss, 0 occurrences in the corpora
      (`SYSTEM_OPERAND_AT_STATEMENT_START`, `TWINCAT_XSIZEOF_IS_NO_KEYWORD`, `PRAGMA_DIVERGENCES`,
      `CODESYS_PRAGMA_DIVERGENCES`, `TWINCAT_PRAGMA_DIVERGENCES`, `COMPONENT_CARRIED_ON_IN_A_DUT`,
      `TWINCAT_TRY_NEEDS_CATCH`, `TWINCAT_MALFORMED_ADDRESS_ALIGNMENT`); a project or recording fact, not behaviour
      (`C0033_CONFIGURED_AS_AN_ERROR`, `TWINCAT_DRIVER_CUTS_THE_ECHO`, `TWINCAT_UNIT_DIVERGENCES`); a vendor crash
      (`CODESYS_DECLARATION_DIVERGENCES`: SP21 throws on a nested aggregate); text the push drops before either IDE sees
      it (`ACTION_HEADER_DROPPED_BY_THE_PUSH`, `ACCESSOR_TEXT_DROPPED_BY_THE_PUSH`). Plus the `deferred.lsp` lsp-gaps on
      area-2 fixtures (P14's three strict refusals → 4.5.1; the `__POOL` and declaration-part conditional-pragma cells,
      niche) and the held-out fixtures waiting on area 4 (2.3b's three, P14's one).
      **Gate 2.10 (2026-10-02).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (4075
      fixtures: confirmed 2376, refused 1457, not-lowered 146, lsp-gap 26, diverges 4, unaskable 66; edges agree 2468 /
      disagree 0 / not-run 102). The first full run was 1 fail: the rustc cache's sampled re-proof hit a harness whose
      loop guard PANICS (`emit.test.ts` g0_2) and called the entry stale because the panic line carries the run's OS
      thread id (`thread 'main' (39996)` vs `(53404)`, rustc ≥ 1.89) — a verifier bug, any panicking hit sampled would
      fail. Fixed test-first: `rustc-cache.test.ts` "a verified hit of a program that PANICS agrees — the panic's thread
      id is the run's, not the program's" (red, then green), `rustc-cache.ts` compares run stderr with the thread id
      masked (the source-path normalisation it already did). Second full run (serial, `VOLT_REQUIRE_FULL=1`,
      `VOLT_FIXTURES` unset): 7022 pass / 34 skip / 190 todo / 0 fail (7246 tests, 197 files, 195 s, rustc cache on
      with sampled re-proof) — +74 tests over gate 2.Q (the 43 fixtures, the named tests, the cache test); agreement
      CODESYS 3757, TwinCAT 3696 (4075 fixtures, = the floors). `bun run check` 14 passed, 0 failed; `bun run lint`
      exit 0. volt-cli untouched by 2.10 (no dotnet run).

## 3. Symbols (symbols/) conformance

Every task's acceptance is **CA** unless it says otherwise. Area 3 needs the restructure and the 0.3 resolution dump, not the parser
conformance work; the cross-area edges are named on the tasks that have them.

- [x] 3.1.1 Scopes and shadowing (Y1–Y8, Y20): record sym_getter_setter_same_local, sym_inout_vs_field_vs_stat.
      Where: binder, scope-nav. Acceptance: CA. Depends on: 1.41, 0.3
- [x] 3.1.2 Namespace blocks (Y17–Y18): `scopedBodies` and `unitBodies` recurse via `allUnits` (the sites 1.8 left); ingestNamespace
      passes the member host. Record sym_namespace_block_unit_checked, sym_namespace_method_parents_to_fb.
      Where: scoped-bodies, format/bodies, binder. Acceptance: CA. Depends on: 3.1.1, 1.8
- [x] 3.1.3 GVLs (Y9–Y14): `qualified_only` per unit (from 2.7.2); VAR_EXTERNAL binding in scope-nav. Record
      sym_qualified_only_one_of_two_gvls_in_file.
      Where: binder, scope-nav, pragmas/attributes. Acceptance: CA. Depends on: 3.1.2, 2.7.2
- [x] 3.1.4 Order independence and dialect (Y19, Y22): record sym_order_independent (fixture pair, two file orders).
      Where: incremental, scope. Acceptance: CA. Depends on: 3.1.3
- [x] 3.1.5 The bare-name search order (Y15, Y23, Y24, E33): analysis `nameResolves` → `types/names.resolveBareName` (tagged answer);
      the built-in NAME set from `types/builtins.ts`; device-tree instances bound by the binder from the `.device` descriptors
      (workspace-refs' `deviceInstances` set is deleted); `.ident` resolves in the global namespace. Record
      sym_method_before_global, sym_global_before_pou_name, sym_library_gvl_needs_qualification, sym_device_instance_bare,
      sym_global_namespace_dot_skips_local.
      Where: types/names.ts, symbols/binder.ts, analysis/resolution.ts (message only). Acceptance: CA; analysis/resolution.ts has no
      `lookupReference` call. Depends on: 3.1.4, 2.5.6
      **Gate 3.1 (2026-10-02)** — 3.1.1–3.1.5 together. 44 `sym_*` fixtures in `fixtures/names/scopes.ts` (Y1–Y5, Y7–Y9,
      Y12, Y16–Y20, Y23, Y24), recorded CODESYS + TwinCAT build and CODESYS run; the two Y17/Y18 NAMESPACE fixtures are
      unaskable (the push refuses the block on both vendors) and decided by named tests (`scoped-bodies.test.ts` Y17,
      `binder.test.ts` Y18); Y19 by `incremental.test.ts` "binding is order-independent…". 3.1.2: `scopedBodies`/`unitBodies`
      recurse via `allUnits`. 3.1.3: `GVL_MEMBER_NOT_DECLARED` closed (Y9, `checkMember`). 3.1.5: `types/names.ts`
      `resolveBareName` (tagged answer), the built-in name set `types/builtins.ts` `BUILTIN_OPERATOR_NAMES` (the reference
      catalog held equal to it, `reference.test.ts`), device instances bound by the binder from `.device` descriptors
      (`ingestDevices`, symbol kind `device`; workspace-refs' `deviceInstances` deleted, `lost-declaration.ts` deleted);
      `analysis/resolution.ts` has no `lookupReference` call (grep). Known divergences added, each niche: accepted loss with
      its count (`SCOPE_DIVERGENCES` `sym_var_external_of_ambiguous_global`, 0 VAR_EXTERNAL in the corpora;
      `CODESYS_SCOPE_DIVERGENCES` the library-global qualification pair — the manifest carries no qualified-access flag, 0
      occurrences; `TWINCAT_SCOPE_DIVERGENCES` StringUtils absent from TwinCAT's project, `sym_device_instance_bare`).
      Numbers: `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (4119 fixtures, +44: confirmed
      2396, refused 1471, not-lowered 151, lsp-gap 29, diverges 4, unaskable 68; edges agree 2491 / disagree 0 / not-run
      104). Ceilings (`fixtures.test.ts`): lsp-gap 26 → 29, not-lowered 146 → 151 (reasons at the ceilings). Rules GAP area 3
      **26 → 18** (total 54 → 46). Resolution dump: corpus member NONE 3602 → 3385, Library Manager member NONE 345 → 313;
      type dump findings 214 → 213, corpus ident UNKNOWN 469 → 353 (+109 named: a device instance has no type), run path
      UNKNOWN 42 → 2 (+41 named, H2 → 3.2.3). First full run: 1 fail — `source-map.test.ts` renamed-target ratchet 34 vs 35;
      read: `sym_inout_vs_field_vs_stat`'s `x := x + INT#100` in METHOD `Io(x := v)` is the documented VAR_IN_OUT
      specialization class (`self.v = …`), ratchet 34 → 35 with the reading. Second full run (`VOLT_REQUIRE_FULL=1`, rustc
      cache with sampled re-proof): **7096 pass / 34 skip / 195 todo / 0 fail** (7325 tests, 200 files, 197 s); agreement
      CODESYS 3757 → **3797**, TwinCAT 3696 → **3732** (floors raised to it; `fixtures.test.ts` 5125 / 0 after). `bun run
      check` 14 passed, 0 failed; `bun run lint` exit 0; layering gate green. The `.dut` source-extension edits in the tree
      are push-without-header-check's, not this step's, and are not in this commit.
- [x] 3.2.1 INTERFACE EXTENDS bound in the binder (H4–H5): interface scopes get `baseScope`; interface method parameters are bound;
      the 4 consumer re-derivations switch. Record inh_interface_method_param_resolves, inh_interface_extends_member.
      Where: binder, extends. Acceptance: CA. Depends on: 3.1.5
- [x] 3.2.2 Every base resolved through `baseScope`/`extendsChain`, never by name (H8): method-signature, interface-implementation,
      hierarchy and inheritance switch. Record inh_extends_ambiguous_library_base.
      Where: extends; the four consumer sites. Acceptance: CA; no `findScopeByName` for an EXTENDS base outside extends.ts.
      Depends on: 3.2.1
- [x] 3.2.3 Inherited members through an instance (H2): infer/member uses `lookupMember`. The fixture exists.
      Where: infer/member. Acceptance: CA; the type dump gives callshape_inout_base_method_from_outside_derived a type, not UNKNOWN.
      Depends on: 3.2.2
- [x] 3.2.4 Unresolved base, cycle, SUPER, override (H6–H10): record inh_unresolved_base, inh_extends_cycle,
      inh_override_signature_mismatch.
      Where: extends, scope-nav.hasUnresolvedBase. Acceptance: CA. Depends on: 3.2.3
      **Step 3.2 (2026-10-02)** — 3.2.1–3.2.4 together. 26 `inh_*` fixtures in `fixtures/names/inheritance.ts` (H4–H10, rule by
      rule: interface EXTENDS member/list/property/obligation/unknown base, interface method parameters by name/unknown/
      output, SUPER to the grandparent, unresolved base, the project-vs-library base, four cycles, every override cell),
      recorded CODESYS + TwinCAT build and CODESYS run (7 run, all as predicted: H8 extends the project's HYSTERESIS, out 42).
      3.2.1: the binder binds an interface's EXTENDS list (`Scope.interfaceExtends`) and `linkExtends` links it
      (`interfaceBases`); `extends.ts` `basesOf`/`ancestry`/`extendsCycle`; `lookupInChain`/`hasUnresolvedBase` walk the
      list; interface METHOD parameters bound in a method scope. 3.2.2: method-signature, interface-implementation, the
      type hierarchy (`typeSubtypes(project, …)`) and the callee's EXTENDS chain (`fbChainSections` on `extendsChain`) read
      the linked bases — no `findScopeByName` for an EXTENDS base outside extends.ts (it stays only for IMPLEMENTS). 3.2.3:
      `infer/member` uses `lookupMember` (type dump: run paths UNKNOWN 2 + 41 inherited → 0). 3.2.4: cycles of FBs,
      interfaces and STRUCTs and the self-cycle from `extendsCycle`; an interface base nothing declares is "No definition
      found for base class" (+ CODESYS "Unknown type"); the override signature is the whole parameter list (name, type,
      section, count) and the result type, names upper-cased, a differing parameter's conversion (C0032), a PROPERTY's as
      `'__GET<P>'`, CODESYS's second sentence for an interface ("number of inputs/outputs", "The variable 'a' …"); only an
      FB the vendor compiles — instanced, or a base of one (`analysis/compiled.ts`) — is checked: pro2193 builds with
      uninstanced FBs whose overrides differ. A named argument the callee declares nothing of is also "Identifier not
      defined" (`inh_interface_method_unknown_param`, call-arguments). H7: the vendors are not conservative about the
      derived body (a name only the missing base could declare is "not defined", as the LSP already said).
      Known divergences opened (`INHERITANCE_DIVERGENCES`, `deferred.lsp`, both vendors): `inh_override_final_method`,
      `inh_abstract_method_not_implemented` — both vendors' words recorded; blocked on the CODESYS code number (a wire
      diagnostic is a catalog `Cnnnn`, `server/diagnostic-codes.ts` admits no new slug), 0 occurrences of either refusal
      in the corpora (7 FINAL, 11 ABSTRACT methods, all built). Numbers: `rate:fixtures` 4145 fixtures (+26): confirmed
      2402 (+6), refused 1488 (+17), not-lowered 152 (+1, `inh_interface_method_output_param`, the transpiler's
      `o => out` through an interface), lsp-gap 31 (+2), diverges 4, unaskable 68; edges agree 2510 / disagree 0 / not-run
      104. Ceilings (`fixtures.test.ts`): lsp-gap 29 → 31, not-lowered 151 → 152 (reasons at the ceilings). Rules GAP area 3
      **18 → 13** (total 46 → 41; H5, H7, H8, H9, H10 closed). Agreement CODESYS 3797 → **3821**, TwinCAT 3732 → **3756**.
      Resolution dump: findings 93 → 73, corpus member NONE 3385 → 1595, parameter NO-CALLEE 2059 → 1916, fixtures member
      NONE 34 → 23; type dump findings 213 → 174 (corpus member UNKNOWN 3980 → 2717, call UNKNOWN 1939 → 1410). Targeted
      runs green: `src/frontend src/analysis src/services src/network` 1256/0, `test/conformance test/frontend test/corpus`
      green (corpus FP oracle 0), `bun typecheck`, `bun run lint` exit 0, layering gate, `bun run check` 15/0. F diff (base
      cfd58c5a19): 1644 sources' aspects changed, all resolution/types/diagnostics (corpus 1315 resolution, 1515 types, 237
      diagnostics; fixture 72/15; library types 12; back lowering 7) — and 8288 DUT sources absent from the working tree's
      walk, which is push-without-header-check's uncommitted source-extension edit in the tree, not this step's.
      **Step-3.2 review fixes (2026-10-02).** 8 fixtures more (`inh_override_input_as_output`, `_inout_as_input`,
      `_uninstanced`, `_pointer_only`, `_reference_only`, `_instanced_in_uninstanced_fb`,
      `inh_interface_method_signature_mismatch_uninstanced`, `inh_implements_derived_missing_base_method_uninstanced`),
      recorded CODESYS + TwinCAT build (identical answers) and CODESYS run; a `__NEW`-only cell was recorded and dropped
      (CODESYS refuses the override there too, beside the fixture application's "No memory for dynamic object creation").
      (a) a parameter is converted only where its PASSED type differs — no "Cannot convert type 'INT' to type 'INT'" for a
      VAR_OUTPUT for a VAR_INPUT; the reverse of `_section_mismatch` is 'INT' to 'REFERENCE TO INT', as the LSP said.
      (b) `compiled.ts` is a REACH from the PROGRAMs, FUNCTIONs and GVLs through instances, arrays, POINTER and REFERENCE
      TO (and STRUCT fields), plus bases — an FB instanced only in an FB nothing reaches is not compiled, one reached only
      by a pointer or a reference is. (c) `interface-implementation` answers only for that set too (the uninstanced FB
      builds without the inherited method). (d) "Identifier not defined" after "is no input of" goes out as
      `unresolved-identifier` (C0046), and a base's "Unknown type" as `unknown-type` (C0077), the FB's and the interface's.
      (e) `fbChainSections` is incomplete for a chain that runs INTO a cycle. (f) H10's recheck no longer says closed:
      the FINAL / ABSTRACT cells are known divergences, "niche: accepted loss (0 occurrences in the corpora)". Numbers:
      `rate:fixtures` 4153 (+8), confirmed 2406 (+4), refused 1492 (+4), edge not-run 108 (+4); agreement CODESYS
      3829 (+8), TwinCAT 3764 (+8) (the floors still read 3797 / 3732). Not staged by this step: `fixtures.test.ts`'s
      `extFor` hunk (`dut`) is push-without-header-check's — stage only its CEILINGS hunks.
      **Gate 3.2 (2026-10-02).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (4153; confirmed
      2406, refused 1492, not-lowered 152, lsp-gap 31, diverges 4, unaskable 68; edges agree 2511 / disagree 0 / not-run
      108). First full run (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset, rustc cache sampled): 7143 pass / 9 fail — the
      review round's 8 fixtures had not been measured by the catalog or the front-end baselines. Repaired here: (1) the
      catalog repros of C0087, C0089, C0094, C0568 (`docs/codesys-reference/error-catalog.json`) declared an FB nothing
      instances, which the vendors do not check (recorded `inh_override_uninstanced`, `_interface_method_signature_
      mismatch_uninstanced`, `inh_implements_derived_missing_base_method_uninstanced`) — each gains a PLC_PRG instancing it
      (`reproFiles`, a note says why); (2) `infer/member` `memberScopeOf` reads through a REFERENCE TO (`r_….M(a := 1)` in
      `inh_override_reference_only` was member NONE / NO-CALLEE — cheap; the 3.5 fixtures `mem_reference_to_fb_*` will
      record it), test `types.test.ts` "a member through a REFERENCE TO…"; (3) the type dump (`bound-census.ts`) tallies a
      "Cannot convert" beside "Interface of overridden method … doesn't match declaration" as that override's parameter
      (H10), not a store with no type — 5 per vendor, the 4 baseline findings of that class gone with the 6 new.
      Baselines rewritten, every ceiling fell: resolution findings 73 → **59**, corpus member NONE 1595 → **1028**,
      parameter NO-CALLEE 1916 → 1914, fixtures member NONE 23 → 16 (both vendors); type findings 174 → **170**, corpus
      member UNKNOWN 2717 → 2160, call UNKNOWN 1410 → 1398, index UNKNOWN 168 → 94, binary UNKNOWN 3150 → 3076. Rules GAP
      area 3 13, total 41 (unchanged by the gate). Second full run: **7153 pass / 34 skip / 196 todo / 0 fail** (7383
      tests, 201 files, 382 s); agreement CODESYS **3829**, TwinCAT **3764** (floors raised 3797 → 3829, 3732 → 3764).
      `bun run check` 15 passed, 0 failed; `bun run lint` exit 0; layering gate green. F diff (base cfd58c5a19), sources in
      both trees: 1398 changed (corpus 1318, fixture 80), aspects resolution and types only; the 82704 aspects gone / 84010
      new are push-without-header-check's uncommitted DUT renames in the tree plus the new fixtures. Seen in passing (not
      this step's, not researched): the parser refuses a variable declared `r : INT;` ("Unexpected token 'r' found"), so a
      unit-test source reading `r.bx` parses as `.bx`; the new test names it `rf`.
- [x] 3.3 Enums (EN1–EN6): `resolveBareEnumMember` takes an asker and reports ambiguity. Record enum_same_member_two_enums,
      enum_member_vs_variable, enum_library_bare, enum_library_qualified.
      Where: scope-nav, library-namespaces. Acceptance: CA. Depends on: 3.2.4
      **Step 3.3 (2026-10-02).** 28 `enum_*` fixtures in `fixtures/names/enums.ts`, rule by rule (EN1 qualified_only bare /
      qualified / beside an open enum; EN3 a member two enums declare stored to either enum, to an INT, compared, as a CASE
      label, qualified, a unique member beside it; EN4 an implicit enum's value in a METHOD, in another POU, over a DUT
      enum's; EN5 the member against an FB variable, a METHOD local, a store to the enum, a global, a FUNCTION; EN6 a
      library member bare, into an INT, by type, by namespace and type, two enums of one library, of two, a library global
      of its name, a project enum's of its name, in an uninstanced FB; plus a name nothing declares in an uninstanced FB),
      recorded CODESYS + TwinCAT build and CODESYS run (16 build and run, each value as predicted). Measured: a member two of the asker's
      own enums declare is "Ambiguous use of name" + "Identifier not defined" + the hole's conversion in EVERY context (no
      expected-type pick), as a CASE label also "requires literal or symbolic integer constant"; a referenced library's
      member resolves bare where one enum declares it (Util's `SAWTOOTH_RISE`), two library enums (one library or two)
      are only "not defined"; a project enum's member beats a library's of its name (out 9). The first recording of EN6
      used Util's WEEKDAY bare and was confounded — Util's list DAY_FLAGS declares MONDAY … SUNDAY as globals — so the
      cells were re-asked with GEN_MODE; CommFB's `IO_SYSTEM_TYPE` is "Unknown type" bare (a transitive library, LB2 →
      3.4.2), so the two-library cell uses Util/StringUtils' `DONE`. Code: `scope-nav` `resolveBareEnumMember(asker,
      name)` → `{member}` | `{ambiguous, candidates, said}` (candidates grouped by `precedence` `libraryRank`, the
      asker's own first; `said` only at rank 0) and `bareEnumMember` (the unique member, for the 9 callers that took the
      first); `types/names` `resolveBareName` answers `ambiguous`; `analysis/resolution` `nameResolves` counts it as
      naming nothing; `ambiguous-global` says "Ambiguous use of name" for a said one (and no longer reads a named
      argument's parameter as a bare name); `case-labels` refuses an ambiguous label; `infer/expr` types `Ns.E` as the
      static base `E` (`Util.WEEKDAY.THURSDAY` had no type — corpus member NONE 1028 → 620). Corpus census (project files,
      bare names whose candidates include an enum member): 220 to one project enum, 47 to one library enum (pro2193's
      uninstanced `Magazine_BeursFB`, `i`), 0 ambiguous among project or library enums, 0 project global or POU named like
      a project member. Known divergences (`ENUM_DIVERGENCES`, both vendors; `deferred.lsp` where the LSP is silent): the
      condition's "Expression of type 'BOOL' expected" after an untyped comparison (`enum_same_member_comparison`,
      `enum_implicit_member_in_other_pou` — no catalog code), a project global of a member's name is ambiguous
      (`enum_member_vs_global`), the member before a FUNCTION of its name (`enum_member_vs_function_name`), Util's
      `TUESDAY` member beside its DAY_FLAGS global (`enum_library_member_vs_library_global`, CODESYS) — each niche:
      accepted loss (0 occurrences in the corpora); `enum_undeclared_name_uninstanced` (an uncompiled POU has no
      diagnostics; the replay analyses the file it is given); TwinCAT's project references no Util
      (`TWINCAT_ENUM_DIVERGENCES`). EN4's implicit-enum TYPE NAME stays `IMPLICIT_ENUM_TYPE_NAME` (4.7.4's render; the
      owner is the binder's already: the value's `owner` scope and its declaration). The run comparison numbers a library
      enum's displayed value (`fixtures.test.ts` `enumsOf` over the project's libraries). Numbers: `rate:fixtures` 4181
      fixtures (+28): confirmed 2422 (+16), refused 1501 (+9), not-lowered 152, lsp-gap 34 (+3), diverges 4, unaskable 68;
      edges agree 2527 / disagree 0 / not-run 110. Ceilings: lsp-gap 31 → 34 (`fixtures.test.ts`). Rules GAP area 3
      **13 → 10** (total 41 → 38; EN3, EN5, EN6 closed). Agreement CODESYS 3829 → **3851**, TwinCAT 3764 → **3780**
      (floors not yet raised — the gate's). Baselines rewritten, every ceiling fell, findings unchanged (resolution 59,
      types 170): corpus member NONE 1028 → 620, Library Manager member NONE 313 → 209, corpus member UNKNOWN 2160 → 1343,
      Library Manager member UNKNOWN 417 → 209. Targeted runs green: `bun test src` 1710/0, `test/frontend` 31/0,
      `test/corpus` 19/0 (FP oracle clean), `test/conformance` on the 28 fixtures 145/0, the replay over all fixtures
      (`-t "recorded build|lsp-gap|diverge|table is total|ratchet"`) 56/0; `bun typecheck` clean, `bun run lint` exit 0.
      **Review fixes (2026-10-02).** 7 cells recorded in one batch per vendor (CODESYS + TwinCAT build, CODESYS run):
      `enum_library_member_direct_vs_caa` (Util `_STATE` vs CAA Device Diagnosis `PROC_STATE`, `ABORTED`) is "not defined" on
      CODESYS — the mixed direct/CAA tie refuses as the LSP does (the first ask, `NO_ERROR`, collided with a fixture enum in
      the replay); `sym_named_argument_beside_ambiguous_global` builds, out 8 (the named-argument skip is right; tests in
      `ambiguous-global.test.ts`); EN3 as a VAR initializer / named argument / array index: the three messages everywhere —
      the initializer destination is now the resolved type upper-cased (`unknown-source`), the argument and index
      conversions are `ENUM_DIVERGENCES` (niche, 0 in the corpora); EN5 across the library boundary: CODESYS takes Util's
      member before a project FUNCTION / PROGRAM of its name — `CODESYS_ENUM_DIVERGENCES` + `MEASURED_SILENT` (LB2 → 3.4.2:
      pro2193's 87 clean POU names forbid refusing without knowing which libraries are open). `infer/expr` types `Ns.X` only
      for an ENUM (no FB/FUNCTION typing from a namespace). The library-internal EN6 test is renamed as an unmeasured
      precedence choice. lsp-gap ceiling 34 → 36; agreement CODESYS 3854, TwinCAT 3784.
      **Gate 3.3 (2026-10-02).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (4188; confirmed
      2423, refused 1505, not-lowered 152, lsp-gap 36, diverges 4, unaskable 68; edges agree 2530 / disagree 0 / not-run
      110). Full run (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset, rustc cache sampled): **7207 pass / 34 skip / 196 todo /
      0 fail** (7437 tests, 201 files, 240 s); agreement CODESYS **3854**, TwinCAT **3784** (floors raised 3829 → 3854,
      3764 → 3784). `bun run check` 15 passed, 0 failed; `bun run lint` exit 0; layering gate green. Rules GAP area 3 10,
      total 38. F diff (base 461b70fc4d, VOLT_GRAPHICAL=1): 135 aspects changed over 68 sources (corpus 63, fixture 5),
      aspects resolution and types only; 1337 aspects new — the 35 new fixtures (34 `enum_*`, 1 `sym_*`); 0 gone.
- [x] 3.4.1 Library precedence everywhere (LB3, LB5, LB6): `lookup`, `lookupMember`, `resolveBareEnumMember` and `findScopeByName`
      apply `pickForAsker`. Record lib_ns_same_name_two_libraries, lib_ns_own_library_first, lib_ns_type_name_two_libraries.
      Where: scope-nav, precedence, types/resolve. Acceptance: CA. Depends on: 3.3
      **Step 3.4 (3.4.1–3.4.3, 2026-10-02).** 22 `lib_ns_*` fixtures in `fixtures/names/libraries.ts`, rule by rule (LB1 a type
      qualified by either library's namespace, a qualified-access library's type qualified, an INTERNAL POU qualified; LB2 a
      dependency's element bare, by its own namespace, through the depending library's namespace, a qualified-access library's
      element bare; LB3 a project FUNCTION before two libraries', a library FUNCTION's output typed in its own file stored to its
      own and to another library's ERROR; LB4 a project PROGRAM / STRUCT named like a namespace; LB5 a type name three libraries
      export, bare, with a member only one declares (each side); LB6 a FUNCTION two libraries export bare, an INTERNAL one bare,
      a list name five libraries carry bare; LB8 a type and a FUNCTION through a namespace to its dependency's; LB9 a library
      list's variable through namespace and list, a shared list name qualified), recorded in ONE batch per vendor: CODESYS +
      TwinCAT build (22 each), CODESYS run 14 (each value as predicted). Three cells were re-asked after the first recording
      confounded them (`s : CmpApp` — `S` is reserved; TIMERSWITCH's `no_assign`; LEAPYEARS is INTERNAL, now its own two cells).
      Measured (CODESYS 2026-10-02): a library's own element first — `DED.ERROR` is DED's, not CAA Types' (a dependency of DED,
      out 3), Util's `EERRORID : ERROR` is Util's (stored to a `DED.ERROR`: "Implicit conversion from one enumeration type (ERROR
      (util …)) to another (ERROR (caa device diagnosis …))"); a project FUNCTION before two libraries' (out 7); `ISLIBRELEASED()`
      (Util's, CommFB's) builds (out 1); bare `ERROR` is Util's (out 2), DED's `TIME_OUT` "is no component of 'ERROR'".
      Code (test-first, `scope-nav.test.ts` "LB6: …", "LB3: …"): `lookup`/`lookupUnit` pick among one search step by the asker
      (`projectLevelHit` → `pickForAsker`; for project source every library ranks alike, so the URI tiebreak — the canonical
      order's own answer); a library namespace scope carries its manifest (`Scope.libraryUri`) and answers its own library before
      a dependency's (`namespaceHit`, used by `lookupMember`); `findScopeByName(project, name, askerUri?)` and the two IMPLEMENTS
      checks pass the asker; `resolveBareEnumMember` already ranked by `libraryRank` (3.3). Rules LB3, LB5, LB6 closed.
- [x] 3.4.2 Visibility, qualification and the project-over-namespace rule (LB1, LB2, LB4, LB8, LB9): record
      lib_ns_direct_dependency_only, lib_ns_project_unit_shadows_namespace, lib_ns_transitive_qualification,
      lib_ns_library_gvl_member.
      Where: library-namespaces, scope-nav. Acceptance: CA. Depends on: 3.4.1
      **3.4.2.** Measured: `DED.CommFB.IO_SYSTEM_TYPE` builds (out 2), `Util.Standard.LEN('abcd')` runs 4 (LB8); a project PROGRAM
      `BPLog` / STRUCT `CmpApp` is what the name means over the namespace (out 12, 6, both vendors; LB4); `Util.DAY_FLAGS.TUESDAY`,
      `Util.CONSTANTS.GC_AUSIWEEKDAY[1]` (out 2, 3; LB9); CommFB's enum is "Unknown type" bare, as `CommFB.T` and as `DED.T`, and
      DED's `DEVICE_STATE` bare (LB2). Code: a qualified type resolves in its namespace (`types/resolve` `namespaceOf`,
      `resolveQualifiedType` — it dropped the qualifiers, so `Util.ERROR` was DED's), a namespace that does not hold the name as
      materialized resolving it as the project holds it (130 pro2193 library references name a type their namespace's folder
      does not hold — `(unresolved)/` interface libraries, published dependencies — and build); a qualifier that names nothing is
      "Unknown type: 'NoSuchLib.T'" (`analysis/resolution` `unknownQualifiedTypeName`; `decl_type_unknown_qualified` closed on
      CODESYS, `UNKNOWN_QUALIFIED_TYPE` TwinCAT only now — unit test "a qualified type whose qualifier names nothing"; the test
      that called `Tc2_Standard.TON` "the library floor" was a narrowness the recording answers); the library namespaces bind in
      two passes, so a namespace holds the namespace symbols of every library it sees, whatever the manifests' order (LB8 was
      order-dependent); `infer/expr` types `Ns.Dep` as the dependency's namespace (static base). Corpus census for the rule
      choices: namespace-qualified references in project files — 691 to the namespace's own element, 51 to a dependency's
      (published: `L_IE1P.L_IE1P_SeverityLevel`), 4 to a dependency's namespace (`L_TT1P.L_MC4P.…`); 0 bare `L.v` with `L` a
      list name two libraries carry; 0 bare project type names two libraries export. KNOWN DIVERGENCES (`CODESYS_LIBRARY_DIVERGENCES`
      + `deferred.lsp`, each niche: accepted loss, 0 occurrences in the corpora — facts the manifest does not carry: which
      references are the application's, which require qualified access, which dependencies a namespace publishes, which POUs are
      INTERNAL): `lib_ns_transitive_bare`, `_transitive_namespace`, `_qualified_access_library_bare`,
      `_type_name_two_libraries_other_member`, `_direct_dependency_only`, `_library_internal_function_bare`, `_qualified`,
      `_library_gvl_shared_list_name_bare`; TwinCAT references none of these libraries (`TWINCAT_LIBRARY_DIVERGENCES`, 19 cells).
      **OPEN for the gate (held by a named ceiling exception, review fixes under 3.4.3):** `lib_ns_type_name_two_libraries` builds on both sides of the replay and the LSP resolves it wrongly
      (bare `ERROR` → DED's by the URI tiebreak; CODESYS: Util's, DED's no candidate) — the same qualified-access fact — so the
      0.3/0.4 dumps carry one new finding (`.WRONG_CONFIGURATION -> NONE`: resolution findings 59 → 60, fixtures codesys member
      NONE 16 → 17, member UNKNOWN 40 → 41) that no known-divergence list can hold (the replay agrees) and the ceilings refuse.
      Root fix: the bridge exports each library reference's `qualified_only`, `publish` and direct-reference facts into the
      `.library` manifest (volt-cli), which closes this and the eight divergences above.
- [x] 3.4.3 Incremental library rebind (LB7): `bindLibraryNamespaces` re-runs on an incremental rebind; workspace-store drops its
      whole-rebuild workaround.
      Where: incremental, library-namespaces, server/workspace-store. Acceptance: the unit test `symbols/incremental.test.ts`
      "library rebind equals whole rebuild" exists and passes; LB7 is no longer GAP; F diff limited to the server's rebuild path.
      Depends on: 3.4.2
      **3.4.3.** `relink` unbinds and rebinds the library namespaces when a library file, a top-level unit of a namespace's name, or
      the manifests changed since the last relink (`incremental` `namespacesStale`, `library-namespaces` `unbindLibraryNamespaces` —
      the aliases' spans kept); `buildSymbolTable` binds them through the same path; `workspace-store` `rebindKey` no longer
      rebuilds the whole table for a file under `Library Manager/`. The unit test "library rebind equals whole rebuild" rebinds
      library and project files at random, 150 operations, against a fresh build — tree, symbols and every unit's scope (it caught
      an unbind that forgot the library scopes' spans). It closes LB4 on the replay's incremental path too (`BPLog.v` was NONE).
      **Numbers (3.4).** `rate:fixtures` 4210 fixtures (+22): confirmed 2428 (+5), refused 1506 (+1), not-lowered 161 (+9),
      lsp-gap 43 (+8 new, `decl_type_unknown_qualified` −1), diverges 4, unaskable 68; edges agree 2540 / disagree 0 / not-run
      110. Ceilings (`fixtures.test.ts`): lsp-gap 36 → 43, not-lowered 152 → 161 (library elements the lowering has no body or
      place for — the transpiler's). Rules GAP area 3 **10 → 2** (total 38 → 30; LB2–LB9 closed; `ceilings.json` "rules" pinned).
      Agreement CODESYS 3854 → **3868**, TwinCAT 3784 → **3787** (floors not raised — the gate's). Dumps (clean worktree at
      3c66511693 + this step): corpus member NONE 620 → 616, Library Manager member NONE 209 → 159, corpus member UNKNOWN 1343 →
      1338, Library Manager member UNKNOWN 209 → 159; the one RISE is the OPEN cell above. F diff (base 9b840e5b7e, VOLT_GRAPHICAL=1):
      208 aspects changed over 153 sources, resolution and types only (corpus Library Manager 180, corpus 28), no fixture
      aspect and no corpus `diagnostics` changed; 834 new aspects (the 22 fixtures); 0 gone. Targeted runs green: `bun test src`
      1726/0 before the concurrent `.pou` rename landed in the tree, the touched suites 207/0 after; `test/corpus` 19/0 (FP
      oracle clean); the replay over all fixtures (`-t "recorded build|lsp-gap|diverge|table is total|ratchet|lib_ns_|…"`) 82/0
      with the ceilings above; `rules.test` 9/0; `bun typecheck` clean; `bun run lint` exit 0.
      **Review fixes (3.4).** (1) LB3 for a LIBRARY asker: `projectLevelHit` ranked by search step before the asker, so a
      library body got the APPLICATION's element of its own name (project POU step 8 before its own step 10; lenze-mid's
      `scProductionMode` is a project DUT and L_OEEA_Library's) while `resolveTypeExpr` answered the library's. A library
      asker now ranks by library first, then by step (`precedence` `isLibraryAsker`; test "LB3: a library asker's own
      library before the PROJECT's element …"; corpus Library Manager member NONE/UNKNOWN 159 → 157). (2)
      `resolveQualifiedType`'s path for a namespace that misses the name answers only a LIBRARY's element (each of the 130
      is one): `Util.AppEnum` is UNKNOWN, not the project's type (unrecorded; UNKNOWN reports nothing). (3) `enumDefault`
      reads the declaration the type RESOLVED to (its scope's file), not the first of its bare name: `v : B.E` starts at
      B's default. (4) The OPEN cell `lib_ns_type_name_two_libraries` is a named ceiling exception (`test/frontend/baseline.ts`
      `CEILING_EXCEPTIONS`: +1 resolution findings, +1 fixtures codesys member NONE, +1 type-dump fixtures codesys member
      UNKNOWN) that points at the bridge task. The ceilings file does not rise, and the exception goes stale when the
      fixture stops producing the finding. The bridge export (qualified-only, publish and direct-reference facts in the
      `.library` manifest) is deferred: `Walk` flattens the application's references and every dependency into one list,
      and the manifest's `SYSTEM` is no proxy (DED is `SYSTEM true` in CodesysTestProject and `false` in pro2193). (5) A
      skipped manifest whose units still materialize: niche: accepted loss (0 occurrences in the corpora), noted at
      `unknownQualifiedTypeName`. (6) Rules LB2 now says plainly that it is recorded, not implemented (`gap: false` is
      coverage).
      **Gate 3.4 (2026-10-02).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte-identically (4210; confirmed
      2428, refused 1506, not-lowered 161, lsp-gap 43, diverges 4, unaskable 68; edges agree 2540 / disagree 0 / not-run
      110). First full run: 3 fail — the parse-census, fixed-point and fold-dump baselines were never rewritten for the 22
      fixtures (COUNT moves only: files 8376 → 8420, known-divergence files, recorded run values 7843 → 7869; findings
      unchanged, 0 / 0 / 53); rewritten with `VOLT_WRITE_BASELINE=1`, `ceilings.json` unchanged. Full run (`VOLT_REQUIRE_FULL=1`,
      `VOLT_FIXTURES` unset, rustc cache sampled): **7242 pass / 34 skip / 205 todo / 0 fail** (7481 tests, 201 files,
      249 s); agreement CODESYS **3868**, TwinCAT **3787** (floors raised 3854 → 3868, 3784 → 3787). `bun run check` 15
      passed, 0 failed; `bun run lint` exit 0; `rules.test` 9/0 (GAP area 3 2, total 30).
      The first commit attempt was blocked: the step was measured against the then-uncommitted push-without-header-check
      5.Q `.pou` rename, which shared 17 of its files. **Re-gate on HEAD f7eb383f47 (5Qa committed, 2026-10-02):** the
      3.4 diff holds no rename hunk (its `.pou` names are its own new tests); `bun typecheck` clean; `rate:fixtures`
      reproduces the same counts (4210; confirmed 2428, refused 1506, not-lowered 161, lsp-gap 43, diverges 4, unaskable
      68; edges 2540 / 0 / 110); full run (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset) **7242 pass / 34 skip / 205 todo /
      0 fail** (7481 tests, 201 files, 240 s), no baseline rewritten, `ceilings.json` only falls; agreement CODESYS
      **3868**, TwinCAT **3787**; `bun run check` 15 passed, 0 failed; `bun run lint` exit 0. Committed as
      `feat(lsp): frontend-conformance 3.4 — …`.
- [x] 3.5 Members (M1–M6): access modifiers resolve first and are refused after. Record mem_reference_to_fb_member,
      mem_reference_to_fb_method, mem_pointer_deref_method, mem_private_member_resolves_then_refused,
      mem_protected_member_from_derived.
      Where: scope-nav, infer/member. Acceptance: CA. Depends on: 3.4.3
      **Step 3.5–3.6 (2026-10-02).** 49 `mem_*` fixtures in `fixtures/names/members.ts`, rule by rule (M1 an unknown member off
      an FB instance — a variable and a METHOD —, a REFERENCE TO one, a dereferenced POINTER, an interface; M3 through a
      REFERENCE TO an FB: a VAR read and written, a VAR_INPUT written, a METHOD, a PROPERTY, a STRUCT field, an instance call
      with an unknown input; a POINTER's METHOD, POINTER TO POINTER, a pointer read without `^`, an array element and SUPER^
      called with an unknown input, and the named-argument wording by callee — METHOD/FUNCTION with one input, none, one given
      beside the unknown; M6 PRIVATE/PROTECTED/INTERNAL/PUBLIC METHODs and PROPERTYs from the FB's own body, THIS^, another
      instance of its type, another METHOD, a derived FB, SUPER^, a grandchild, outside through an instance/REFERENCE/POINTER/
      interface, and a refused member's result type and parameters; M2/M4/M5 recorded elsewhere), recorded in ONE batch per
      vendor (plus one follow-up batch of 5 call-wording cells and the 10 `xf_*_call_once` builds, which had none): CODESYS +
      TwinCAT build (identical answers, TwinCAT's capitals aside), CODESYS run 19 (each value as predicted).
      Measured: PRIVATE is the declaring FB's alone (refused from a derived FB and through SUPER^, allowed for another instance
      of its own type), PROTECTED reaches any depth of derived FB and is refused from outside (an inherited one too), INTERNAL
      and PUBLIC reach the application; the refused member RESOLVES first (its INT result into a BOOL is "Cannot convert"
      beside "Cannot access private method B.M"); an interface METHOD implemented PRIVATE "must be PUBLIC"; an interface's
      member set is `<ITF>__Union`; a VAR written from outside through a REFERENCE is "no input of", as directly; a
      FUNCTION's/METHOD's named arguments are COUNTED first — more `:=` arguments than inputs is "Function 'M1' requires exactly
      '1' inputs" and every unknown name only "not defined", within the count "'zz' is no input of 'M1'".
      Code (test-first): `infer/expr` an index of a POINTER is its target (`p[2].x`) and a dereferenced instance called is the
      FB (`SUPER^(…)`); `infer/callee` `resolveCallee` finds an instance by the callee's TYPE (a REFERENCE read through, an
      array element, SUPER^) — corpus parameter NO-CALLEE 1914 → 42, corpus FP oracle still clean; `analysis/resolution`
      `checkMember` reads a REFERENCE through and names an interface `<ITF>__Union`, `pointerMemberBases` ("'p' is no structured
      variable", `self-not-structured`); `unresolved-identifier` a CALLED unknown member is also C0035; `external-write` reads a
      REFERENCE through; `call-arguments` the named-argument count (`expr_en_eno_call` LEFT `EXPRESSION_NICHE_DIVERGENCES`; the
      test that said "'zz' is no input of 'M'" for a METHOD with no input took its premise from an interface METHOD with one).
      Known divergences opened: `MEMBER_DIVERGENCES` (both vendors, 14: every access refusal and "must be PUBLIC" — no catalog
      code for a METHOD's refusal, a PROPERTY's C0513/C0515 document another, unverified sentence; niche: accepted loss, 0
      occurrences in the corpora of a refused access — corrected 2026-10-03: pro2193's own Application declares 525
      PRIVATE/PROTECTED/INTERNAL members (524 METHODs, 1 PROPERTY), user code, not library code as first written; 12 `deferred.lsp`, the two where the LSP is not silent not), `TWINCAT_ECHO_NAMES_A_POSITIONAL_ARGUMENT`
      (the three `xf_<d>_to_ldate_call_once` first build-recorded here: TwinCAT echoes a user FUNCTION's positional argument
      formally inside the hole; niche, 0 in the corpora). Named ceiling exceptions (`test/frontend/baseline.ts`): the four
      pointer cells' `ADR(sb)` (5 per vendor, `call UNKNOWN, SIZEOF or ADR` — task 4.3.4).
      Numbers: `rate:fixtures` 4259 fixtures (+49): confirmed 2446 (+18), refused 1524 (+18), not-lowered 162 (+1,
      `mem_private_method_of_same_type_instance`), lsp-gap 55 (+12), diverges 4, unaskable 68; edges agree 2572 / disagree 0 /
      not-run 110. Ceilings (`fixtures.test.ts`): lsp-gap 43 → 55, not-lowered 161 → 162. Rules GAP area 3 **2 → 0** (total
      30 → 28; M3, M6 closed — M6 as coverage, its refusal the divergence above). Agreement CODESYS 3868 → **3914**, TwinCAT
      3787 → **3825** (floors not raised — the gate's). Resolution (0.3) findings 59 + 1 excepted → **29 + 1 excepted**; corpus
      parameter NO-CALLEE 1914 → 42; fixtures member NONE 16/16 → 13/13, parameter NO-CALLEE 8/8 → 0, parameter NONE 1/1 → 0,
      TwinCAT bare name NONE 6 → 0; messages both 95 → 111 (CODESYS), 120 → 136 (TwinCAT). Types (0.4): corpus call UNKNOWN
      1398 → 1270, index 94 → 92, library index UNKNOWN 111 → 49, fixtures call UNKNOWN 391/388 → 383/380; findings unchanged.
      F diff (base 22917a0677, VOLT_GRAPHICAL=1): 246 aspects changed over 192 sources, resolution and types only (corpus 71 /
      130, fixture 12 / 20, library types 13), no `diagnostics` aspect; 1877 new (the new fixtures and recordings); 0 gone.
      Targeted runs green: `bun test src` 1739/0, `test/conformance` 5326/0 (whole), `test/frontend` 33/0 after the
      parse-census and fixed-point COUNT rewrite, `test/corpus` 19/0, `test/catalog` 147/0, `bun typecheck`, `bun run lint`.
- [x] 3.6 Area 3 closed: the 0.3 findings are closed; every §4 3.x rule has a recorded fixture or named test.
      Where: test/frontend/rules.ts, resolution-dump baseline. Acceptance: the 0.3 baseline is empty (or each remaining entry is a
      recorded known divergence named here); the rules.test GAP count for area 3 is 0 and pinned. Depends on: 3.5
      **3.6 (2026-10-02).** Rules GAP area 3 **0**, pinned (`ceilings.json` "rules"). The 0.3 findings 59 + 1 → 29 + 1, closed:
      the SUPER^ / REFERENCE / array-element calls' NO-CALLEE (10 per vendor, `resolveCallee`), `p[2].x` (2), a named argument
      the vendor too calls "not defined" (`inh_interface_method_unknown_param`: the census now counts it so, as it counts a
      bare name), `__CURRENTTASK^.szName` in a body neither side parses (the census keyed a member's row by its expression's
      start, not its name's), TwinCAT's `<D>_TO_LDATE` / `LDATE_TO_ULINT` NONE (6: never build-recorded; recorded now, they
      are TwinCAT's "not defined"). REMAINING, each recorded and named:
        - `lib_ns_type_name_two_libraries` `.WRONG_CONFIGURATION` (1, CODESYS) — the named ceiling exception of 3.4 (bridge
          library-reference facts);
        - `.diSize` / `.pValue` of an ANY / ANY_INT input (12 per vendor: `type_any_*`, `state_any_*`, `tr_17_*`, `tr_42_*`,
          `refuse_interface_any_input`) — members of the compiler's `__SYSTEM.AnyType`, of which the front-end has no
          declaration (30 such reads in pro2193's own code) → 4.1.3 (ANY groups);
        - `TYPE_CLASS.TYPE_SUBRANGE` (1 per vendor, `op_sys_type_class_bare`) — a value of the compiler's `__SYSTEM.TYPE_CLASS`,
          no declaration either → 4.1.3;
        - TwinCAT "Identifier '' not defined" ×2 and 'In1' (`network_unnamed_target_*`) — network text, not the ST front-end.
      **Gate 3.5–3.6 (2026-10-03, on HEAD 15d421e57a).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte for
      byte (4259; confirmed 2446, refused 1524, not-lowered 162, lsp-gap 55, diverges 4, unaskable 68; edges 2572 / 0 / 110);
      full run (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset) **7302 pass / 34 skip / 206 todo / 0 fail** (7542 tests, 201
      files, 233 s); agreement CODESYS **3914**, TwinCAT **3825** — floors raised 3868 → 3914 and 3787 → 3825
      (`fixtures.test.ts`); `bun run check` 15 passed, 0 failed; `bun run lint` exit 0.

## 4. Types (types/) conformance

One fixture per typing rule, recorded with `record:exec` (values that expose width/sign/overflow) and `record:language` (CODESYS's
type messages). Every task's acceptance is **CA** unless it says otherwise. Area 4 needs the restructure and the 0.4 dumps; the
cross-area edges are named on the tasks that have them.

- [x] 4.1.1 Platform width per target (TY5–TY6): `Target` on the project scope; `canonicalElem`, `POINTER_BITS` readers,
      `temporalResultType`, compat's pointer↔integer rule and infer REQUIRE a target (the 1.31 default is deleted, so `tsc` lists
      every caller). The transpile `lowering.ts` call gets today's 64-bit target explicitly and is handed off (5.3). Record
      ty_xint_twincat_width, ty_pointer_size_twincat.
      Where: types/platform.ts, symbols/scope.ts (target beside dialect), every caller. Acceptance: CA; Gate T for the one
      transpile call. Depends on: 1.41, 0.4
      **4.1.1 (2026-10-03).** `Target` (`syntax/pragmas/conditional`, `CompileEnvironment.target`, absent = unknown) is the
      project scope's (`symbols/scope` `targetOf`, beside `dialectOf`; throws off a non-root). REQUIRED (no default) by
      `canonicalElem(name, target)`, `elementaryTypeOn`, `parseConversionName`, `builtinCallResult` and the pointer rule
      `compat.pointerFits(t, target)`; `elementaryType` and every comparison of RESOLVED names read `aliasElem` (a resolved
      Type never carries a platform name), so `temporalResultType`/`compat`/`infer` need no target. On an unknown target a
      platform integer is a type NAME (`isElementaryTypeName`, never "Unknown type") with no facts: UNKNOWN, silent. Who
      states it: the harness (`RECORDING_ENVIRONMENT`, 64-bit, measured), lowering (`EXEC_ORACLE_TARGET`; Gate T: the one
      `prepareProject` call and `bytes.ts` SIZEOF of a type name — handed off, 5.3), the server and the corpus binding from a
      device descriptor whose width is measured (`workspace-refs` `MEASURED_DEVICE_TARGETS`: `CODESYS Control Win V3 x64`).
      Recorded ty_xint_twincat_width, ty_pointer_size_twincat (both vendors): both recording projects are 64-bit, and the
      pointer rule is ONE rule, the target's (64-bit: LWORD/ULINT/`__XWORD` silent, WORD/DWORD/UDINT "Cannot convert";
      32-bit: DWORD/UDINT silent too) — not the vendor split `pointer-conversion` had (it was the two projects' targets).
      FOUND: TwinCAT Project14 opens on TwinCAT CE7 (ARMV7), 32-bit — the 50 rows were recorded there first (DINT/UDINT/
      DWORD, a pointer silent into DWORD) and re-recorded on Project13 (TwinCAT RT x64) so `twincat.build.json` keeps one
      target (`scripts/check-recording.ts` notes it); which project earlier RECORD_ONLY merges used is not recorded.
      TY6 STAYS A GAP: implemented and unit-tested, measured, but no committed recording of a 32-bit target.
      Divergences: `ty_pointer_size_twincat` and `cc5_pointer_not_convertible` (now both vendors) in
      `C0033_CONFIGURED_AS_AN_ERROR` (severity only). Census: `typedOnASixtyFourBitTarget` names the UNKNOWNs only the
      target leaves — 54 own-file + 24 Library Manager expressions of the projects with no measured target (pro2193's
      `CAA.HANDLE`/tick aliases), a new ceilinged class "a platform integer on a target nobody measured (TY6)".
- [x] 4.1.2 Platform conversion names (TY11): `parseConversionName` accepts `__XINT_TO_*`; hand the transpile rewrite to T. Record
      ty_xint_to_dint, ty_dint_to_uxint.
      Where: conversion-name. Acceptance: CA. Depends on: 4.1.1
      **4.1.2 (2026-10-03).** `conversion-name`: the platform sides read on every target (`isConversionName`,
      `conversionSides`), their facts the target's (`parseConversionName(name, target)`); `builtinName` reads the sides by
      spelling, inference types `DINT_TO___XINT(d)` LINT on a 64-bit target. Recorded ty_xint_to_dint, ty_dint_to_uxint,
      ty_xint_to_dint_result_type (both vendors build and run all eight names; the result named by the message).
      Transpile: its `builtins.ts` platform rewrite and `constants.ts` read `parseConversionName(…, undefined)` — unchanged
      behaviour, handed to T (5.3); `ty_dint_to_uxint` is not-lowered ("not a project FUNCTION").
- [x] 4.1.3 Elementary facts, aliases, ANY groups, type restrictions (TY1–TY4, TY7–TY10, TY12–TY15). Record ty_bit_as_variable,
      ty_pointer_to_bit, ty_array_of_bit, ty_array_of_reference, ty_any_num_parameter_accepts_int, ty_any_num_parameter_rejects_string,
      ty_version_type.
      Where: elementary, resolve, compat. Acceptance: CA; the 0.4 elementary findings are empty. Depends on: 4.1.2
      **4.1.3 (2026-10-03).** Recorded (both vendors build, CODESYS run) the 37 cells of `fixtures/types/elementary-rules.ts`:
      TY12 BIT in a FUNCTION's VAR/VAR_INPUT, a METHOD's VAR, an FB's VAR/VAR_INPUT, a GVL, POINTER TO/REFERENCE TO/ARRAY OF
      BIT; TY13 ARRAY OF REFERENCE (+ ARRAY OF POINTER); TY14 ANY/ANY_NUM/ANY_INT/ANY_REAL/ANY_BIT/ANY_STRING/ANY_DATE/
      ANY_ELEMENTARY/ANY_MAGNITUDE as a parameter, accepting or refusing, and ANY_NUM as a local; TY15 VERSION.
      Measured and fixed test-first: a GVL is no BIT container ("Only structures and function blocks…", `bit-usage`); a
      generic input refuses an argument outside its group in the group's name ("Cannot convert type 'STRING' to type
      'ANY_NUM'"), TwinCAT's ANY_BIT refuses a BOOL that CODESYS's takes, ANY_ELEMENTARY/ANY_MAGNITUDE are no type on either
      vendor (`compat.genericParameterAccepts`, `GENERIC_PARAMETER_TYPES`, `call-arguments`); VERSION is a struct of four UINTs
      and an ANY input is the compiler's AnyType (`diSize` DINT, `pValue` POINTER TO BYTE) — `types/system.ts` binds both in
      a project of their own, after the asker's symbols (closing the 24 `.diSize`/`.pValue` resolution findings 3.6 left).
      Known divergences opened (`ELEMENTARY_RULE_DIVERGENCES`, both vendors, each niche: 0 occurrences in the corpora):
      `ty_reference_to_bit`, `ty_any_num_as_local_variable` (no catalog code), `ty_any_elementary_parameter_rejects_struct`,
      `ty_any_magnitude_parameter_accepts_time` (the unknown-type check passes every ANY_FAMILIES name), `ty_version_into_string`
      (a struct into an elementary target is unchecked for every struct — 4.5.3). The 0.4 elementary findings: none left in
      the type-dump (its 170 findings are other areas': built-in operands 4.3.4, temporal 4.3.5, …); the 0.3 leftover
      `TYPE_CLASS.TYPE_SUBRANGE` (1 per vendor) stays — the enum's member list is the compiler's, and one written from the
      corpora's uses (TYPE_NONE 19, TYPE_SUBRANGE 1) would refuse every member they do not use.
- [x] 4.2 Literal typing in every context (LT1–LT14): record lt_literal_in_comparison, lt_literal_case_label,
      lt_literal_array_bound, lt_literal_for_bounds, lt_literal_any_int_argument, lt_negative_min_sint, lt_negative_min_int; write
      `test/frontend/literal-agreement.test.ts` (`contextLiteralType` agrees with `literalCheckType` on every literal of the corpus
      and fixtures; disagreements pinned; T hand-off for the call site).
      Where: types/literal.ts. Acceptance: CA; literal-agreement.test.ts exists and its disagreement list is written here.
      Depends on: 4.1.3
      **4.2 (2026-10-03).** Recorded (both vendors build, CODESYS run) the 13 cells of `fixtures/types/literal-contexts.ts`.
      Measured and fixed test-first (`narrowing`, `loop-exit`, `call-arguments`, `types/arith/operators`): an untyped literal
      beside a narrower variable converts nothing in a comparison on TwinCAT too (`si = 200`, an LSP-only warning there); a
      NEGATIVE literal compared with an unsigned operand converts into the operand's type on TwinCAT and into UDINT on
      CODESYS (`negativeLiteralComparisonTarget`); a CASE label and a FOR's TO bound convert into the selector's / counter's
      type (200 under SINT: USINT → SINT), and a TO bound BEYOND the counter's range is that conversion, not C0266 —
      `cc6_loop_cannot_exit` left KNOWN_DIVERGENCES on both vendors (its "C0266 is configured off" was the wrong reading);
      a literal into an ANY input is "ANY parameter 'x' of 'F' needs variable with write access as input" (C0041's
      sentence for a generic parameter). LT13: the minima (-128, -32768, DINT's, LINT's) hold, one below them refuses; the
      census counts a negated untyped number as a literal (uncapped) from here. `lt_literal_negative_in_comparison_unsigned`
      DIVERGES in the transpiler (`ui > -1` TRUE where CODESYS says FALSE; `deferred.transpile`, T).
      `test/frontend/literal-agreement.test.ts` (LT14): `contextLiteralType` against `literalCheckType` over every stored
      literal — corpus 14 930 (78 disagree), fixtures 3 871 (79), library 46 (0); 29 classes pinned
      (`baselines/literal-agreement.json`): a 0/1 into BOOL/BIT/TIME (transpiler SINT, checker the target), an integer the
      target cannot hold (transpiler the target, checker its narrowest type), a real beyond REAL into a REAL, a real into an
      integer — the same stored value reached two ways; the call site is the transpiler's (T, 5.3).
      **Step 4a numbers.** `rate:fixtures` 4309 (+50): confirmed 2463 (+17), refused 1547 (+23), not-lowered 166 (+4:
      `ty_dint_to_uxint`, `ty_version_type`, `ty_array_of_pointer`, `lt_literal_case_label_out_of_range` — the transpiler's),
      lsp-gap 60 (+5, the divergences above), diverges 5 (+1), unaskable 68; edges agree 2609 / disagree 0 / not-run 110.
      Ceilings (`fixtures.test.ts`): lsp-gap 55 → 60, not-lowered 162 → 166. Rules GAP area 4 **28 → 20** (total 28 → 20;
      TY11–TY15, LT12–LT14 closed; TY6 open). Agreement CODESYS 3914 → **3959**, TwinCAT 3825 → **3870** (floors not
      raised — the gate's). Resolution (0.3) findings 29 + 1 → **5 + 1**. Types (0.4): findings 170 → 170 (4 new answered by
      census stores for CASE labels, FOR bounds and the comparison literal); fixtures member UNKNOWN 38/38 → 27/26, ident
      36/39 → 24/27; corpus member 1338 → 1313, ident 353 → 327 (the TY6 class takes 78 corpus expressions); a census fix
      (project and scope were swapped in `operandTyped`) moves 48 Library Manager `SIZEOF(T)` to their own class; named
      exceptions for the 4.2 FOR-bound `n + 1` (`binary UNKNOWN`, 4.3.1) and `ty_array_of_pointer`'s ADR.
      F diff (base 77024fb0ac, VOLT_GRAPHICAL=1): 73 aspects changed over 51 sources — `types`/`resolution` of sources holding
      platform integers, ANY inputs or VERSION, and two lowering refusal texts (`type_codesys_version`,
      `refuse_interface_any_input`, ratings unchanged); no `diagnostics` aspect; the rest new fixtures; 0 gone.
      Runs: `bun test src` 1758/0, `test/conformance` 5366/0 (whole), `test/frontend` 34/0, `test/corpus` 19/0,
      `test/catalog` 147/0, `bun typecheck`, `bun run lint`, `bun run check` 15/0.
      **4a review fixes (2026-10-03).** Each unmeasured generalisation was narrowed back to what was recorded, test-first:
      (1) `loop-exit` fires again at/beyond the limit; only the measured conversion (`types/literal`
      `literalContextConversion`: an untyped literal that the same-width unsigned type holds, over a signed counter or
      selector) earns the LT12 warning instead, so `FOR bt := 0 TO 300`, `TO 70000` and typed-constant bounds keep C0266.
      The CASE/FOR conversion in `narrowing` reads the same predicate (a negative label under WORD is silent). (2)
      `scripts/recording-target.ts` (`TARGET_PROBE`, `targetWidth`) is shared by `check-recording.ts` and
      `record-language.ts`. A `RECORD_ONLY` run now records `plat_xint_into_string` as well, and refuses the merge unless
      `__XINT` is LINT. (3) An unknown member of an ANY/ANY_* input is not refused (`analysis/resolution`; the vendor's
      struct is __SYSTEM.AnyType, and no recording names it). (4) `negativeLiteralComparisonTarget` returns undefined at
      32 and 64 bits on TwinCAT too. (5) The literal rule for generic inputs covers only an integer literal into
      ANY_INT; any other literal into a generic input is silent, and the group refusal applies to variables only. (6)
      `fold` `heldAs` reads `elementaryTypeOn(name, targetOf(project))`. (7) Negated untyped numbers keep their capped
      census key again (ceilings 135/658/253/252/9). The 22 per vendor that the 4.1.3/4.2 fixtures write are named
      exceptions (`baseline.ts` `NEGATED_LITERAL_ROWS`). So is `cc6_loop_cannot_exit`'s `n + 1`, which has been measured
      since it left the divergences. Baselines rewritten. Runs: `bun test src` 1764/0, `test/conformance` 5366/0,
      `test/frontend` 34/0, `rate:fixtures` (map unchanged), `bun typecheck`.
      **Gate 4a (2026-10-03, 4.1.1–4.2, on HEAD a313c74b38).** `bun typecheck` clean; `rate:fixtures` reproduces the map byte
      for byte (4309; confirmed 2463, refused 1547, not-lowered 166, lsp-gap 60, diverges 5, unaskable 68; edges 2609 / 0 /
      110); full run (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset) **7365 pass / 34 skip / 210 todo / 0 fail** (7609 tests,
      203 files, 308 s; vs gate 3.5–3.6 +63 pass, +4 todo, +2 files); agreement CODESYS **3959** (+45), TwinCAT **3870**
      (+45) — floors raised 3914 → 3959 and 3825 → 3870 (`fixtures.test.ts`; re-run whole, 5291 pass / 166 todo / 0 fail);
      `bun run check` 15 passed, 0 failed; `bun run lint` exit 0.
- [x] 4.3.1 Meets and promotion (AR1–AR3, AR19–AR21): record ar_div_negative, ar_mod_negative.
      Where: arith/runtime, arith/checked. Acceptance: CA. Depends on: 4.2
      **4.3.1 (2026-10-03).** All of 4.3 lives in `fixtures/types/arithmetic-results.ts` (86 fixtures, recorded on both
      vendors in one `record:language` run each, plus two follow-up batches; `record:exec` for the two that build). AR21:
      `ar_div_negative`, `ar_mod_negative` (confirmed, both backends) — the quotient truncates toward zero and the remainder
      takes the dividend's sign at SINT/INT/DINT/LINT and all-constant (`-7 / 2` = -3, `-7 MOD 2` = -1, `7 MOD -2` = 1);
      `DIV(a, b)` and `MOD(a, b)` CALLED are refused by both vendors (`ar_div_function_form`, `ar_mod_function_form`, the
      LSP agrees word for word). AR1 with a LITERAL operand, measured into a STRING and stored back
      (`ar_int_literal_operand_types`, `ar_real_literal_operand_types`, `ar_literal_operand_stores`, both vendors):
      an untyped integer takes its neighbour's integer when it holds the value (a bit string's is the unsigned one of its
      width: `aByte + 1` USINT, `aByte AND 1` USINT), else the smallest integer of that signedness that does (`aSint + 200`
      INT, `aUsint + 300` UINT, `anInt + 70000` DINT) — context-free (`si := si + 200` is "Cannot convert type 'INT' to type
      'SINT'"); a real literal is the real beside a REAL/LREAL. Fixed test-first: `arith/checked` `literalOperandType`,
      read by inference (`infer/expr` `binaryResultType`, via `literal` `untypedNumberValue`) and by the narrowing meet
      (`aSint + 200` no longer warns USINT → SINT — an LSP-only warning the new fixture exposed). OPEN, a known divergence
      (`ARITHMETIC_RESULT_DIVERGENCES`, both vendors): a real literal beside an INTEGER is named LREAL into a STRING and is
      silent into a REAL (`division_with_a_real_operand`'s `int7 / 2.0`) — the store's context, which an operation's own
      type does not carry; left undefined (missing, never wrong), the context literal type is LT14's/T's (5.3). AR2/AR3/
      AR19/AR20 stay decided by their recorded fixtures (rules.ts unchanged). The FOR-bound `n + 1` ceiling exceptions
      (`baseline.ts`) left: the operation is typed now.
- [x] 4.3.2 NOT and unary minus (AR4–AR6): one NOT rule in arith/operators, decided by the recordings (infer vs lowering); T
      hand-off for expressions.ts:180-184.
      Where: arith/operators. Acceptance: CA. Depends on: 4.3.1
      **4.3.2 (2026-10-03).** The recordings decide infer's reading (`uop_not_*`: NOT BYTE is USINT, NOT WORD UINT, NOT TIME
      UDINT; `not_result_width`): `arith/operators` `notResultType` is the one rule — the narrowing check's NOT branch now
      converts the operand into it instead of its own `unsignedOfWidth` (same answers; `unary-operand` already read the
      inferred type). Lowering's copy (`transpile/lower/expressions.ts:180-184`, a signed integer → the BIT STRING of its
      width, BYTE/WORD/DWORD/LWORD) is value-identical and handed to T (5.3: replace with `notResultType`). AR4/AR5 stay
      decided by `cc_neg_*`, `uop_neg_*`, `unary_minus_*`; no new fixture.
- [x] 4.3.3 Bitwise and shifts (AR7, AR10): the checked shift/rotate result type. Record ar_shl_byte_type, ar_ror_word_type,
      ar_shl_int_type.
      Where: arith/operators, builtins. Acceptance: CA. Depends on: 4.3.2
      **4.3.3 (2026-10-03).** Recorded SHL/SHR/ROL/ROR × every integer and bit string (48 `ar_<op>_<type>_type`, both
      vendors): the result is the OPERAND's own type, never promoted, and no operand converts (`SHL(aSint, n)` a SINT, no
      warning). Fixed test-first: `builtins` `ARGUMENT_TYPED` (shifts by their first argument, ABS and MOVE by their one),
      read by inference; an untyped literal operand stays unknown. AR7 with a literal: `aSint AND 1` is USINT with the
      operand's sign warning (`ar_int_literal_operand_types`, agrees).
- [x] 4.3.4 Built-ins (AR11–AR16, AR22–AR31): LIMIT/SEL/MUX typed in builtins.ts (T hand-off for builtins.ts:456); every built-in's
      result type from `BUILTIN_RESULT` or a rule in builtins.ts. Record ar_limit_mixed_types, ar_sel_mixed_types,
      ar_mux_mixed_types, ar_upper_bound_type, ar_lower_bound_type, ar_time_call, ar_ltime_call; re-check that the AR22–AR29
      fixtures decide the result TYPE (a message or a width-revealing value); record ar_<name>_type for any that does not.
      Where: types/builtins.ts. Acceptance: CA. Depends on: 4.3.3
      **4.3.4 (2026-10-03).** AR13/AR14: LIMIT/SEL/MUX over the six mixed pairs in both orders and two same-type bit strings
      (`ar_limit_mixed_types`, `ar_sel_mixed_types`, `ar_mux_mixed_types`, `ar_minmax_bitstring_types`): the CHECKED MEET of
      the value arguments (SEL's after the selector, MUX's after the index), each argument converting into it with its own
      warning (TwinCAT one per line, the existing per-line dedupe). `builtins` `selectionValueArguments` is the one rule —
      inference and the narrowing meet read it for MIN, MAX, LIMIT, SEL and MUX (three or more values: `meetAllWarnings`).
      Lowering's LIMIT/SEL/MUX (`transpile/lower/builtins.ts:456`) handed to T (5.3). Re-check AR22–AR29: none of the listed
      fixtures named the TYPE (each stored into the very type, or was refused for another reason), so each got an
      `ar_<name>_type` into a STRING: ADR is POINTER TO its operand's type (`ar_adr_type`; 'POINTER TO ARRAY [0..3] OF BYTE'),
      BITADR of a BOOL located at `%MX4.3` DWORD (`ar_bitadr_type` — BITADR's refusal no longer fires on a variable located at
      a bit address, `intrinsic-operands` `locatedAtBitAddress`, an LSP-only error the fixture exposed), SIZEOF the smallest
      unsigned integer holding the size (`ar_sizeof_type`, `ar_sizeof_width_edges`: 255 USINT, 256/65535 UINT, 65536 UDINT;
      `builtins` `sizeofResultType` over `scalarStorageBytes` — elementary types, strings and arrays of them; a STRUCT/FB's
      layout stays the transpiler's), XSIZEOF `__UXINT` (ULINT; TwinCAT has none — `XSIZEOF` joined `CODESYS_ONLY_KEYWORDS`,
      which closed 3 TwinCAT `lex_keyword_*_xsizeof` divergences), `__NEW(T)` POINTER TO T (`ar_new_type`), `__ISVALIDREF`/
      `__QUERYINTERFACE`/`__QUERYPOINTER` BOOL, `__COMPARE_AND_SWAP` BOOL, TRUNC DINT, TRUNC_INT INT, ABS and MOVE their
      argument's type (BYTE stays BYTE), UPPER_BOUND/LOWER_BOUND DINT, `TIME()` TIME and `LTIME()` LTIME (`clockCallResult`).
      All in `builtins.ts` (`BUILTIN_RESULT`, `ARGUMENT_TYPED`, `pointerTo`, `sizeofResultType`, `clockCallResult`). AR11/
      AR12/AR15/AR16 were already decided by messages. Known divergences opened: `ar_adr_type` (`C0033_CONFIGURED_AS_AN_ERROR`,
      severity only), `ar_new_type` (C0033 severity; CODESYS also has no dynamic memory and states the conversion twice),
      `ar_varinfo_type` (`__SYSTEM.VAR_INFO`'s members unmeasured, struct → elementary is 4.5.3's; `deferred.lsp`), CODESYS
      `ar_pouname_type` (a STRING sized by the asking body's qualified name, which an ACTION's body does not carry —
      `CODESYS_POUNAME_IS_SIZED_BY_ITS_BODY`, `MEASURED_SILENT`; 308 `__POUNAME()` in the corpora, none mis-stored).
- [x] 4.3.5 Temporal (AR17–AR18): duration × integer typed in arith/temporal (T hand-off for expressions.ts:248). Record
      ar_time_times_int_type, ar_ltime_div_int_type.
      Where: arith/temporal. Acceptance: CA. Depends on: 4.3.4
      **4.3.5 (2026-10-03).** Recorded `ar_time_times_int_type`, `ar_time_div_int_type`, `ar_ltime_div_int_type`,
      `ar_ltime_times_lint_type` (TIME/LTIME × or ÷ an integer, and integer × duration: the duration) and, for AR17's TYPES,
      `ar_date_minus_date_type` (DATE/DT/TOD differences TIME), `ar_ldate_minus_ldate_type` (LTIME), `ar_date_plus_time_type`
      (DT + TIME a DATE_AND_TIME, TIME + TOD a TIME_OF_DAY, DATE − TIME a DATE). Fixed test-first: `arith/temporal`
      `durationScaleResultType`, and `temporalArithmeticType` (the date pair and the duration scale, one entry) read by
      inference and by the type census, whose operand stores no longer convert a date or a duration into the result (with
      4.3.4's selection arguments now census stores, the type-dump findings fall 170 → 128). Lowering's duration × integer
      (`transpile/lower/expressions.ts:248`) handed to T (5.3). Known divergence (TwinCAT, niche: accepted loss, 0
      occurrences of LDATE/LDT/LTOD in the TwinCAT corpus): `ar_ldate_minus_ldate_type` — TwinCAT does arithmetic on the
      unknown type ("Cannot convert type 'LDATE' to type 'ANY_NUM'").
      **Step 4b numbers.** `rate:fixtures` 4395 (+86): confirmed 2465 (+2), refused 1629 (+82), not-lowered 166, lsp-gap 62
      (+2: `ar_varinfo_type`, `ar_pouname_type`), diverges 5, unaskable 68; edges agree 2612 / disagree 0 / not-run 111.
      Ceilings: lsp-gap 60 → 62 (`fixtures.test.ts`); source-map RENAMED_TARGETS 35 → 38 (`ar_queryinterface_type`'s
      `__QUERYINTERFACE` match, the documented class). Rules GAP area 4 **20 → 13** (total 20 → 13; AR10, AR14, AR18, AR21,
      AR24, AR30, AR31 closed; AR6/AR13/AR17/AR22–AR29 gained their type fixtures). Agreement (whole `test/conformance`)
      CODESYS 3959 → **4040**, TwinCAT 3870 → **3954** (floors not raised — the gate's). Types (0.4): findings 170 → **128**;
      corpus binary UNKNOWN 3076 → 505, call UNKNOWN 1270 → 868, `SIZEOF or ADR` 392 → 57 (Library Manager 390 → 132, ident
      100 → 48), unary 87 → 55; fixtures binary UNKNOWN 1152 → 93, call UNKNOWN 382 → 83, `SIZEOF or ADR` 239 → 28 (what is
      left is SIZEOF of a STRUCT/FB and ADR of no value; the key keeps its name, a ceiling's id), `__NEW or __DELETE` 20 → 9
      (`__DELETE` alone); new census keys `ident_expr untyped, a type named where the operator takes one` (SIZEOF(LINT),
      `__NEW(T)` — no value on either side) and a Library Manager TY6 call (reclassified). Named ceiling exceptions: the 4.3
      negated literals (`NEGATED_LITERAL_ROWS`, +21 per vendor); the ADR and FOR-bound exceptions left (typed now).
      LT14: fixtures literals 3871 → 4069, disagreements 79 (unchanged), corpus 78. Known divergences: +6 opened
      (`ar_adr_type`, `ar_new_type`, `ar_varinfo_type`, `ar_real_literal_operand_types` both vendors; `ar_pouname_type`
      CODESYS; `ar_ldate_minus_ldate_type` TwinCAT), 3 closed (TwinCAT `lex_keyword_assigned/operand/called_xsizeof`).
      Runs: `bun test src` 1768/0, `test/conformance` 5372/0 (whole), `test/frontend` 34/0, `test/corpus` 19/0,
      `rate:fixtures`, `bun typecheck`, `bun run lint`.
      **Gate 4b (2026-10-03, 4.3.1–4.3.5, on HEAD ccbd277317 + the step's tree).** `bun typecheck` clean; `rate:fixtures`
      reproduces the map byte for byte (4403; confirmed 2466, refused 1636, not-lowered 166, lsp-gap 62, diverges 5, unaskable
      68; edges 2616 / 0 / 111 — the step note's 4395/2465/1629/2612 predate its last follow-up batch, the map is the truth);
      full run (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset) **7382 pass / 34 skip / 210 todo / 0 fail** (7626 tests, 203
      files, 260 s; vs gate 4a +17 pass, +17 tests); agreement CODESYS **4047** (+88), TwinCAT **3960** (+90) — floors raised
      3959 → 4047 and 3870 → 3960 (`fixtures.test.ts`; re-run whole `test/conformance`, 5374 pass / 166 todo / 0 fail);
      LT14 disagreements corpus 78 / fixtures 79; `bun run check` 15 passed, 0 failed; `bun run lint` exit 0.
- [x] 4.4 Comparisons and BOOL (CB1–CB5), including the network-text wire rules 1.34 could not switch. Record cb_compare_pointers,
      cb_compare_time_ltime, cb_and_then_on_int.
      Where: infer/expr, arith/operators, network-text/parser.ts (imports only). Acceptance: CA; network-text/parser.ts holds no
      type-family or operator-result list. Depends on: 4.3.5
      **4.4 (2026-10-03).** Recorded `fixtures/types/comparisons-bool.ts` (11, both vendors, values on CODESYS):
      `cb_compare_result_types`/`_values` (STRING, WSTRING, TIME, DATE, REAL with LREAL, BOOL, INT with UDINT, enum values —
      every comparison BOOL; INT vs UDINT warns "UDINT to DINT": a comparison of two widths meets as arithmetic and warns at
      32/64 bits — fixed test-first, `narrowing`), `cb_compare_pointers`/`_values` (pointer vs pointer BOOL; vs a DWORD "Cannot
      compare type 'POINTER TO INT' with type 'DWORD'" on the 64-bit target, LWORD/ULINT silent — `comparison` reads
      `pointerFits`), `cb_compare_time_ltime`/`_values` ("Cannot compare type 'TIME' with type 'LTIME'", agreed already). CB5
      (`cb_and_then_on_int`, `cb_or_else_on_int`, `cb_and_then_on_word`, `cb_and_then_bool_and_int`, `cb_and_then_result_type`):
      two BOOLs are BOOL; otherwise the operands meet in the UNSIGNED integer of their width (a signed one warns, a WORD is
      silent, a BOOL "Cannot convert type 'BOOL' to type 'UINT'") and that integer — also the result's type — is refused as the
      condition ("...'UINT' to type 'BOOL'"). Fixed test-first: `arith/operators` `SHORT_CIRCUIT_OPERATORS`/`shortCircuitType`,
      read by inference, `rules` `shortCircuitErrors` and `narrowing`. Network text: `parser.ts` keeps no type-family or
      operator-result list — `boxProduces` asks `arith/operators` `operatorFunctionResult`, the bit-operator disagreement
      `isBitOperatorWireType` (ANY_BIT without BIT, as the bridge's `NetworkSpelling.BitStrings`: a wire declared BIT is
      refused by the push, so by the reader — step 4c review). (`lt` is the LT operator and cannot
      name a variable — the first recording of the TIME/LTIME cells said so; the LSP already agreed.)
- [x] 4.5.1 Enum conversions (CV3–CV5, P14, P15): `strict` and `to_string` read from the AST attributes. Record
      cv_enum_with_base_into_int, cv_library_enum_into_int, cv_int_into_enum, cv_literal_into_enum, cv_int_into_strict_enum,
      cv_strict_enum_into_int, cv_enum_to_string_attribute.
      Where: compat, enums, builtins. Acceptance: CA. Depends on: 4.4, 2.7.2
      **4.5.1 (2026-10-03).** Recorded `fixtures/types/enum-conversions.ts` (30, both vendors, values on CODESYS) and restored
      the held-out `prag_enum_not_strict_add_literal`. CV3: another enum's value is the WARNING "Implicit conversion from one
      enumeration type (A) to another (B)" (`cv_enum_into_other_enum`; it was refused) — `compat` `enum-change`, `rules`
      `conversionWarning`; an enum operand of arithmetic computes in its base (`cv_enum_arithmetic_type`: `e + 1` INT,
      `e * aDint` DINT) — `infer/expr` `asOperand`. CV4: a written base is the base the enum converts as, both ways
      (`cv_enum_base_<8 bases>_into_scalars`, `cv_enum_with_base_*`, `cv_scalars_into_enum_with_base`), except into REAL/LREAL,
      silent for every base — `enums` `enumBase`, `compat`. A LIBRARY enum's base is not in its materialized declaration (Util's
      WEEKDAY converts as an unsigned 16-bit, StringUtils' EDATETIMEPLACEHOLDER as an unsigned 8-bit type): known divergence
      `LIBRARY_ENUM_BASE_NOT_MATERIALIZED` (3, both vendors; the bridge's to fix). CV5/P14: a scalar into an enum converts as into
      its base (`cv_scalars_into_enum`: DINT, REAL, BOOL refused, UINT a change of sign); into a `strict` enum only its own values
      and literals a member holds — any other variable, another enum's value, `5`, `-1`, `TRUE` is "'<text>' is not a valid value
      for strict ENUM type '<name>'", never with a conversion warning beside it; arithmetic is refused once per operation; NOT
      converts it as its base ("signed Type 'E' to unsigned Type 'UINT'") — `enums` `strictEnum`/`enumDeclaration` (the attribute
      read from the AST), `rules` `strictEnumStore`/`binaryOpError`, `arith/operators` `notResultType`. The three
      `prag_strict_enum_*` `deferred.lsp` marks closed. P15: `cv_enum_to_string_attribute` (written values TsIdle/TsBusy/TsDone —
      a bare `Done` bound `enum_library_same_member_two_libraries` to it, so prefixed) and `cv_enum_to_string_implicit_members`
      print every member's name; lowering's member-name table stays refused by name and is handed to T (5.3).
- [x] 4.5.2 Pointer and reference compatibility and arithmetic (CV6, DT12, DT13, DT14): record cv_reference_to_pointer,
      cv_pointer_to_reference, dt_pointer_plus_int, dt_pointer_difference, dt_reference_auto_deref_type, dt_ref_assign_wrong_type.
      Where: compat, arith/operators, infer/member. Acceptance: CA. Depends on: 4.5.1
      **4.5.2 (2026-10-03).** Recorded `fixtures/types/pointer-reference.ts` (19, both vendors, values on CODESYS; no variable
      is called `r` or `s` — IL operators, the first recording refused them). CV6: an integer into a pointer on the 64-bit
      target — a 32-bit one refused, INT/LINT a change of sign, BYTE/WORD/UINT/LWORD/ULINT/`__XWORD` silent (`compat`
      `integerIntoPointer`; `classifyConversion` takes the target). DT12/DT14: a REFERENCE converts as its target on either side
      and is named as itself (`compat`, `rules` `checkable`/`signOf`; `dt_reference_into_narrower`, `cv_reference_to_pointer`,
      `cv_reference_to_other_reference`), and reads as its target in an operation (`ri + 1` INT, `ri * rr` REAL — `infer/expr`
      `asOperand`); `REF=` takes a variable of exactly the target's type — a REAL, a DINT, a SINT, a pointer, another reference, an
      array of another shape are refused, an operation is the write-access refusal (`reference-assign`; TwinCAT names every such
      pair reversed, `messages` `refAssignCannotConvert`, renamed from `refLiteralCannotConvert`); a pointer written through a
      reference is C0033. DT13: POINTER ± integer is the pointer, pointer − pointer a DWORD (`arith/operators`
      `pointerArithmeticType`); a pointer minus a REAL is refused — the REAL converted into the pointer on CODESYS, the pointer into
      the REAL on TwinCAT (`messages` `pointerMinusReal`). Known divergences: `cv_pointer_assigned_to_reference`,
      `cv_pointer_and_pointee`, `dt_pointer_plus_int` joined `C0033_CONFIGURED_AS_AN_ERROR` (word for word, severity only).
- [x] 4.5.3 Explicit conversions (CV7): record every pair `scripts/conversion-matrix.ts` lists as missing (the count pinned in 0.5).
      Where: conversions/*.ts fixtures, builtins, conversion-name. Acceptance: CA; the matrix reports 0 missing pairs.
      Depends on: 4.5.2
      **4.5.3 (2026-10-03).** `fixtures/conversions/explicit-pairs.ts`: one `xp_<from>_to_<to>` per pair the matrix listed (327),
      each converting a known source value (negative, past the signed range, high bits set, a fraction, 1 s 500 ms, every date
      field; a STRING holds the target's literal text). All 327 compile and run on CODESYS; the builds agree on both vendors and
      every value the transpiler lowers agrees (216 confirmed); 111 are not lowered (conversion-type — handed to T). Fixed on the
      way: a conversion naming a type the dialect lacks has no result (`builtins` `builtinCallResult`: `BOOL_TO_LDATE(v)` on
      TwinCAT is UNKNOWN, as the vendor says), and a STRUCT stored into an elementary target is refused, named as the struct
      (`rules` `storeConversionError`; `ty_version_into_string` left `ELEMENTARY_RULE_DIVERGENCES`). The harness reads a pre-epoch
      instant's negative fraction (`LDATE_AND_TIME#1970-1-1-0:0:0.-000000005`, `xp_sint_to_ldt`). **The matrix reports 0 missing
      pairs** (`CV7 explicit pairs no recorded fixture calls` 327 → 0).
      **Step 4c numbers.** `rate:fixtures` 4791 (+388): confirmed 2695 (+229), refused 1678 (+42), not-lowered 286 (+120), lsp-gap
      59 (−3), diverges 5, unaskable 68; edges agree 2857 / disagree 0 / not-run 115. Ceiling not-lowered 166 → 286 (FOR
      MEASUREMENT, `fixtures.test.ts`). Rules GAP area 4 **13 → 5** (total 13 → 5; CB4, CB5, CV4, CV5, CV7, DT12, DT13, DT14
      closed; the pinned counts in `baselines/ceilings.json`). Agreement (whole `test/conformance`) CODESYS 4047 → **4434**,
      TwinCAT 3960 → **4345** (floors not raised — the gate's). Types (0.4): findings 126 → **111**; corpus binary UNKNOWN 505 →
      439, fixtures 93 → 81, library 4 → 2; TwinCAT ident UNKNOWN 19 → 5. Census (`bound-census.ts`): a store into a strict enum
      is no conversion; the short-circuit condition is a store; REF= of a variable is one (TwinCAT reversed); TwinCAT's one copy
      per line; an unknown target is named as written; a variable whose declared type the vendor names unknown is its own key;
      50 negated-literal cells named in `NEGATED_LITERAL_ROWS`. Known divergences: +7 (`LIBRARY_ENUM_BASE_NOT_MATERIALIZED` 3 both
      vendors, C0033 +3 both, TwinCAT `cv_library_enum_type`), closed 4 (3 `prag_strict_enum_*` deferrals,
      `ty_version_into_string`). F-diff (`frontend-snapshot.ts check --base HEAD`): 57 existing sources (type dumps of pointer,
      reference, enum and L-date code; bakon-nano `CalcMasterSpeedAcc.pou` gains two LREAL → REAL warnings its recorded build
      holds; `back/decl_implicit_enum_duplicate`, a refused fixture) plus the new fixtures' sources. Runs: `bun test src` 1791/0,
      `test/conformance` 5829 pass / 286 todo / 0 fail (whole), `test/frontend` 34/0, `test/corpus` 19/0, `rate:fixtures`,
      `bun typecheck`, `bun run lint`.
      **Gate 4c (2026-10-03, 4.4–4.5.3, on HEAD c29df84902 + the step's tree).** `bun typecheck` clean; `rate:fixtures`
      reproduces the map byte for byte (4791; confirmed 2695, refused 1678, not-lowered 286, lsp-gap 59, diverges 5, unaskable
      68; edges 2857 / 0 / 115); full run (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset) **7862 pass / 34 skip / 330 todo /
      0 fail** (8226 tests, 203 files, 274 s; vs gate 4b +480 pass, +120 todo — the not-lowered explicit pairs, +600 tests);
      agreement CODESYS **4434** (+387), TwinCAT **4345** (+385) — floors raised 4047 → 4434 and 3960 → 4345
      (`fixtures.test.ts`; re-run whole `test/conformance`, 5829 pass / 286 todo / 0 fail); LT14 disagreements corpus 78 /
      fixtures 79; `bun run check` 15 passed, 0 failed; `bun run lint` exit 0.
- [x] 4.6.1 One constant fold (CE6, CE9, P16): constEval folds conversions, pure built-ins, SIZEOF, enum values, NOT and shifts,
      honouring `const_replaced`/`const_non_replaced`, so the LSP and the transpiler fold one set (T hand-off deletes transpile's
      folder). Record ce_fold_conversion_bound, ce_fold_sizeof_bound, ce_fold_not_int, ce_fold_shl, ce_real_alias_const,
      ce_const_non_replaced_bound.
      Where: const/fold, const/constancy. Acceptance: CA; the 0.4 fold-dump baseline is empty. Depends on: 4.5.3
      **4.6.1 (2026-10-03).** Recorded `fixtures/types/constant-evaluation.ts` (both vendors; values on CODESYS). The PROBE is
      an array bound whose element 30000 is written: the refusal names the fold ("…range from '0' to '<fold>'"). CE6:
      `ce_fold_conversion_bound*` (8: a constant from INT_TO_DINT, TO_DINT, INT_TO_USINT(300) 44, REAL_TO_INT(2.5) 3,
      TRUNC(7.9) 7, BOOL_TO_INT 1, TIME_TO_DINT(T#5MS) 5, a nested one 6), `ce_fold_builtin_bound_*` (7: ABS, MIN, MAX, LIMIT,
      SEL, MUX, LREAL_TO_INT(EXPT(2, 3)) 8), `ce_fold_sizeof_bound*` (4: DINT 4, an LREAL 8, ARRAY[0..2] OF INT 6, STRING(10)
      11), `ce_fold_enum_value*` (3, 7 each). CE9: `ce_fold_not_int*` (NOT BYTE#250 / WORD#65530 / of a BYTE constant 5,
      NOT INT#-5 4), `ce_fold_shl*`/`shr`/`rol`/`ror` (8, 254, 5, 3, 192), `ce_real_alias_const` (3, a REAL behind an
      alias) + `_values` (2.5), and `ce_fold_untyped_*_in_context_values` (an untyped literal in a CONSTANT of a declared
      type takes it: NOT 0 into a WORD 65535, SHL(1, 20) into a DWORD 1048576). P16: `ce_const_non_replaced_bound` (a
      decorated global constant, qualified, 3). Fixed test-first in `const/fold`: `constEval` folds the conversions
      (wrap at the target, a REAL rounded half away from zero at the destination's register — the transpiler's measured
      table — BOOL, a TIME literal as ticks), ABS/MIN/MAX/LIMIT/SEL/MUX/TRUNC/EXPT/SQRT, SIZEOF (`infer/expr`
      `sizeofOperandBytes`), enum values (`enums` `enumMemberValue`, in their storage type), NOT on an integer (unsigned at
      its width) and the shifts (at the operand's width); a REAL constant's width is read through its alias; an untyped
      literal takes the context's integer type (a constant's declared type, a conversion's source) and has NO width without
      one — the bound's narrowest is an accepted loss (`UNTYPED_OPERAND_AS_A_BOUND`, 0 occurrences in the corpora), because
      the transpiler folds an initializer by itself and there the narrowest width is wrong. A project function named like a
      conversion is its own. `const_replaced`/`const_non_replaced` change nothing the fold reads (P16, 2.10).
      **The 0.4 fold-dump baseline is empty: findings 53 → 0.** The census (`bound-census`) asked `constEval` of the
      initializer where the value is the DECLARATION's: it now asks `declaredValue` (`const/fold`, the fold stored into the
      declared type — wrapped to its width, a string cut at its capacity, WSTRING by UTF-16 units) and only of an initializer
      that is a compile-time constant (8 that read a variable or call a user function are counted apart, "not asked");
      strings compared decoded. Run: 214 fold equal, 0 do not fold (33 before).
      Known divergences opened: `UNTYPED_OPERAND_AS_A_BOUND` (both, 2), `UNTYPED_NOT_IN_A_SIGNED_CONTEXT` (both, 1: `c3 : INT :=
      NOT 5` is "Cannot convert type 'INT' to type 'ANY_BIT'", niche 0), `TWINCAT_NOT_OF_A_SIGNED_BOUND` (TwinCAT, 1: "Array
      Border NOT(INT#-5) does not evaluate…", niche 0). Not lowered (the transpiler's, 5.3): `ce_fold_untyped_in_context_values`
      ("init-not-constant": lowering folds the initializer without its context).
- [x] 4.6.2 Constancy and scope (CE1–CE5, CE7–CE8): one walk for constancy and fold; cycle guard. Record ce_cycle.
      Where: const/fold, const/constancy. Acceptance: CA. Depends on: 4.6.1
      **4.6.2 (2026-10-03).** One walk: `const/fold` evaluates value AND constancy together (`constancyIn`; `constancy.ts`
      `constancyOf` reads it), so a conversion or pure built-in of constants, SIZEOF, an enum value (bare or qualified) and a
      list's/program's CONSTANT are constant by the reading that folds them; a built-in over a variable is variable, a user
      function unknown. CE5: recorded `ce_cycle`, `ce_cycle_self` — CODESYS "Recursive definition of constant value" once per
      constant of the cycle; new `checks/declarations/constant-cycle` on `const/fold` `isRecursiveConstant` (slug
      `constant-cycle` in `KNOWN_UNMAPPED`: no documented Cnnnn holds the sentence). TwinCAT's XAE EXITS building either
      (three times, the restart manager relaunching it): `vendorRefuses.twincat`. CE8: a variable's type is resolved in its
      declaring scope (`infer/expr` passes `sym.owner`, it passed the project), so `STRING(n)`/`ARRAY[0..n]`/`INT(0..n)` with n
      a POU CONSTANT have their size wherever the variable is read; recorded `ce_string_length_constant_assign`/`_init`,
      `ce_string_length_literal_assign` (both vendors warn "…destination type 'STRING(n)'" — the capacity named AS WRITTEN,
      `type` `lengthText`; `string-constant` renders through `renderType`, its private copy deleted). Closed:
      `decl_string_length_constant`, `_brackets` (`STRING_LENGTH_AS_WRITTEN`, both vendors; `decl_string_length_expression`
      stays — the compiler's expression form is 4.7.4's render).
- [x] 4.7.1 Subrange in the Type model (DT3): subrange.ts reads the Type. Record dt_subrange_arithmetic_result.
      Where: type.ts, resolve, analysis/checks/types/subrange.ts. Acceptance: CA. Depends on: 4.6.2
      **4.7.1 (2026-10-03).** Recorded `fixtures/types/derived-types.ts` DT3 (both vendors): `dt_subrange_arithmetic_result`
      (`v + 1` INT, `w * 2` UINT) + `_values` (11, 14), `dt_subrange_variable_type` ('INT (0..10)', 'UINT (0..10)'),
      `dt_subrange_member_assign` (20 into a STRUCT member of INT(0..10) refused — the LSP was silent),
      `dt_subrange_assign_zero_lower`, `_negative_lower`, `dt_subrange_member_assign_nonzero_lower` (CODESYS types a
      POSITIVE lower bound of an assignment target with the base, `UINT (UINT#1..10)`, a zero or negative one bare — the
      message had `INT#` for every bound and base). The subrange is in the Type (`type` `subrange`, folded where declared,
      `resolve` `withSubrange`; rendered `INT (0..10)`; an operation on one is its base, `withoutSubrange` in `infer/expr`), and
      `subrange.ts` reads the Type: the declared type of an initialized variable, the inferred type of any assigned target.
      Census: a subrange store is explained by its folded value and the assignment form (the subrange type findings closed).
- [x] 4.7.2 Union in the Type model (DT4): record dt_union_member_sizes.
      Where: type.ts, resolve. Acceptance: CA. Depends on: 4.7.1
      **4.7.2 (2026-10-03).** Recorded DT4 (both vendors): `dt_union_member_sizes` (values: SIZEOF 4, 5, 8; a DWORD read through
      the BYTE 4), `dt_union_sizeof_bound` (4), `dt_union_array_sizeof_bound` (5), `dt_union_sizeof_type` and
      `dt_sizeof_derived_type`: SIZEOF of a STRUCT or a UNION is a UINT (even of one byte) where an elementary, enum, implicit
      enum, alias or array size is the smallest unsigned integer holding it. `type` StructType `union`; `infer/expr`
      `storageBytes` (a union: its largest member rounded to its most aligned) and `structSizeBound` (UINT only where the size
      certainly fits one). Not lowered: `dt_union_member_sizes` (the transpiler's, 5.3).
- [x] 4.7.3 Enum storage base (DT5–DT6): one rule in enums.ts, decided by recording (T hand-off for enumStorage). Record
      dt_enum_base_byte_storage, dt_library_enum_storage.
      Where: enums. Acceptance: CA. Depends on: 4.7.2
      **4.7.3 (2026-10-03).** Recorded DT6 (both vendors; values on CODESYS): `dt_enum_base_byte_storage` (1) + `_values` (200
      reads back as BYTE#200), `dt_enum_plain_storage` (2), `dt_enum_implicit_storage` (2), `dt_library_enum_storage` (2 on
      CODESYS; TwinCAT's project has no WEEKDAY) + `_values`. One rule: `enums` `enumStorage` — the base the enum converts as
      (`enumBase`: written, else INT; an implicit one INT) — read by SIZEOF and by the enum-value fold (`enumValueStorage`);
      the transpiler's `enumStorage` is handed to T (5.3). A library enum's storage is no fact (`LIBRARY_ENUM_BASE_NOT_MATERIALIZED`
      +1); its SIZEOF still types USINT. DT5 is `type_enum_default_*`'s (unchanged).
      **Step 4d numbers.** `rate:fixtures` 4853 (+62): confirmed 2704 (+9), refused 1726 (+48), not-lowered 287 (+1), lsp-gap 63
      (+4), diverges 5, unaskable 68; edges agree 2866 / disagree 0 / not-run 157. Ceilings (`fixtures.test.ts`, FOR
      MEASUREMENT): lsp-gap 62 → 63, not-lowered 286 → 287. Rules GAP area 4 **5 → 1** (total 5 → 1; CE5, CE6, CE9, DT6 closed;
      TY6 remains — a 32-bit recording target). Agreement (whole `test/conformance`) CODESYS 4434 → **4496**, TwinCAT 4345 →
      **4403** (floors not raised — the gate's). Fold dump findings 53 → **0**; type dump findings 111 → **105** (SIZEOF/subrange
      closed; +2 pinned: `ce_fold_untyped_not_signed_context_values`, TwinCAT `ce_fold_not_int_signed`); corpus SIZEOF/ADR
      UNKNOWN 57 → 53, Library Manager 132 → 128; corpus body constants folding 725 → 4653. Ceiling exceptions (`baseline.ts`):
      8 built-in-over-untyped-number cells (`UNTYPED_CALL_ROWS`, LT14) and 2 negated-literal rows. Known divergences: opened
      `UNTYPED_OPERAND_AS_A_BOUND` (both, 2), `UNTYPED_NOT_IN_A_SIGNED_CONTEXT` (both, 1), `TWINCAT_NOT_OF_A_SIGNED_BOUND` (1),
      `LIBRARY_ENUM_BASE_NOT_MATERIALIZED` +1; closed `decl_string_length_constant`, `_brackets` (both vendors). F-diff
      (`frontend-snapshot.ts check --base HEAD`): 4406 aspects over 2292 sources — folds (the step's: conversions, SIZEOF,
      enum values, bit operators now fold across the corpora) and types (subrange/union/enum SIZEOF, named string capacities).
      Runs: `bun test src` 1815/0, `test/conformance` 5851 pass / 287 todo / 0 fail (whole), `test/frontend` 34/0,
      `test/corpus` 19/0, `rate:fixtures`, `bun typecheck`, `bun run lint`.
      **Step 4d review (8 findings, all fixed, each with a failing test first).** (1) SIZEOF re-entered type resolution with a
      fresh fold context, so `a : ARRAY[0..SIZEOF(a)]` (and four sibling shapes) overflowed the stack and the file got no
      diagnostics: `fold` `sizing` guards the operand, a size that reaches itself does not fold. (2) A duration's ticks reached
      MIN/MAX/LIMIT/SEL/MUX and folded a TIME as an integer: only a conversion reads them now (`converted`). (3) The context's
      type reached an untyped literal through operators, parens, built-in arguments and signed constants, none recorded: only
      NOT or a shift at the top of an UNSIGNED constant's initializer takes it. (4) A variable stored into a subrange named the
      target as declared — recorded `dt_subrange_assign_variable` (both): the assignment form, `UINT (UINT#1..10)` on CODESYS,
      for a variable source too (`rules` `StoreSite`); `dt_subrange_ref_bind` (both build it): a REFERENCE TO the base binds a
      subrange variable (`reference-assign` compares without the subrange). (5) A cycle through an enum member's value lost
      the walk's start: recorded `ce_cycle_enum` (CODESYS; TwinCAT not attempted — its XAE exits on a cycle): two "Recursive
      definition" plus "… is no valid initialisation for an enumeration"; the LSP now says the constant's (the member's and the
      enum message are misses). (6) The fold census filtered on `constancyOf`, the code under test: now an AST + resolution
      test (`readsRuntime`); it surfaced `sysop_position_value` (`__POSITION()`'s text), niche: accepted loss (0 occurrences in
      the corpora), counted by name; an enum-valued run value now compares (`sameEnumValue`). (7) constant-cycle is
      CODESYS-only (TwinCAT has no recorded answer). (8) A WSTRING aligns to 2 — recorded `dt_union_wstring_sizeof_bound`
      (both): WSTRING(1)|5 bytes is 6. `rate:fixtures` 4857: confirmed 2705, refused 1729; no baseline finding moved.
      **Gate 4d (2026-10-03, 4.6.1–4.7.3, on HEAD 34095e48b5 + the step's tree).** `bun typecheck` clean; `rate:fixtures`
      reproduces the map byte for byte (4857; confirmed 2705, refused 1729, not-lowered 287, lsp-gap 63, diverges 5, unaskable
      68; edges 2866 / 0 / 158); full run (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset) **7920 pass / 34 skip / 331 todo /
      0 fail** (8285 tests, 204 files, 291 s; vs gate 4c +58 pass, +1 todo — the not-lowered `dt_union_member_sizes`, +59
      tests); agreement CODESYS **4499** (+65), TwinCAT **4406** (+61) — floors raised 4434 → 4499 and 4345 → 4406
      (`fixtures.test.ts`; re-run whole `test/conformance`, 5853 pass / 287 todo / 0 fail); LT14 disagreements corpus 78 /
      fixtures 79; type dump disagreements 105; `bun run check` 15 passed, 0 failed; `bun run lint` exit 0.
- [x] 4.7.4 Aliases, static bases, callees, rendering (DT1–DT2, DT7–DT11): staticScopeType distinguishes namespace and interface
      from struct. Record dt_alias_of_alias_init, dt_namespace_static_base, dt_interface_static_base.
      Where: infer/member, render. Acceptance: CA. Depends on: 4.7.3, 3.2.1
      **4.7.4 (2026-10-03).** Rule by rule, 35 cells the listed fixtures did not separate, in `fixtures/types/derived-types.ts`
      (recorded on both vendors, values on CODESYS). DT1: `dt_alias_type_name` (an alias, and an alias of one, named 'INT'),
      `dt_alias_narrowing_name`, `dt_alias_struct_and_array_values` (5, 7) — the LSP agreed. DT2: `dt_alias_of_alias_init` (an
      alias's initializer is NOT inherited by an alias of it: 42, **0**, 7 — the transpiler agrees), `dt_alias_init_out_of_range`,
      `_wrong_type`, `_narrowing`, `_narrowing_two_uses`, `_narrowing_in_program`, `_narrowing_unused`, `_wrong_type_unused`: both
      vendors check an alias's initializer as a store into its base as often as the alias is USED (never unused; a refusal once;
      a warning once plus once per FB variable on CODESYS, twice on TwinCAT) — the LSP checks none, and saying it needs the
      project-wide count of uses: `ALIAS_INITIALIZER_NOT_CHECKED` (both, 5), niche: accepted loss (0 aliases with an initializer in
      the corpora). DT7: `dt_this_type`, `dt_super_type` — THIS is a POINTER TO the enclosing FB and SUPER one to its base, `^`
      the FB, named upper-cased ('POINTER TO FB_LANG_DT_THIS_TYPE'); the design row said THIS was the FB. Fixed test-first:
      `infer/member` `thisType`/`superType` (pointers; `pouNamed`), and the `THIS.v` "no structured variable" is now any
      pointer's rule (`resolution` `pointerMemberBases`), its private copy in `this-super-context` deleted; `dt_this_into_pointer`
      (silent into any pointer), `dt_this_deref_identity_values` (9, 9). The THIS/SUPER-into-STRING cells are C0033 at its
      shipped severity (`C0033_CONFIGURED_AS_AN_ERROR` +2). DT8: `dt_static_base_gvl`, `_struct_type`, `_fb_type`, `_function`,
      `_program`, `_enum_type`, `dt_namespace_static_base`, `dt_interface_static_base`, `dt_interface_static_member`,
      `dt_fb_instance_type_name`, `dt_interface_variable_type_name`, `dt_function_name_in_own_body`: a name that denotes a
      declaration, stored as a value, is refused named UPPER-CASED ('GVL_LANG_…', 'UTIL', 'I_LANG_…', 'F_LANG_…', 'PRG_LANG_…') —
      the LSP said nothing for a GVL, a program, an FB type, and the return type ('INT') for a function, and 'Util', a source-case
      struct name for the rest; an FB or interface type name also "must be instantiated to be accessed"; an INSTANCE, an
      interface variable and an array are refused named as declared. Fixed test-first: `type` `StaticType` (a GVL, namespace,
      STRUCT type, INTERFACE, uncalled FUNCTION or METHOD — **namespace and interface no longer typed "struct"**), `infer/member`
      `staticScopeType` (a PROGRAM or FB type the POU, upper-cased), `staticNameOf`, `insideOwnBody` (a FUNCTION's name in its own
      body is its result, and called there has no result — `cc2_call_recursion`'s finding closed), `analysis/rules`
      `storeConversionError` (every non-elementary value into an elementary target), `checks/calls/fb-instantiation` (a type
      name stored). TwinCAT has no Util: `dt_namespace_static_base` to `TWINCAT_LIBRARY_DIVERGENCES`. DT9:
      `dt_program_called_positionally` — a PROGRAM takes no positional argument either (the LSP took it): `infer/callee`
      `takesNoPositionalArguments`; `dt_interface_method_positional_values` (42). DT10: `dt_render_array_dims` (an array into an
      elementary was unchecked), `dt_render_string_capacity`, `dt_render_date_time_names`, `dt_render_pointer_names` (C0033 +1).
      DT11: `dt_render_string_literal` ('STRING(INT#0)', 'STRING(INT#3)' for `'a$$b'`, 'WSTRING(INT#4)'),
      `dt_render_string_constant` ('STRING'). Everything else agreed on both vendors.
- [x] 4.8 Area 4 closed: the 0.4 findings are closed; every §4 4.x rule has a recorded fixture or named test.
      Where: test/frontend/rules.ts, type/fold-dump baselines. Acceptance: the 0.4 baselines are empty (or each remaining entry is a
      recorded known divergence named here); the rules.test GAP count for area 4, and in total, is 0 and pinned. Depends on: 4.7.4
      **4.8 (2026-10-03).** **The 0.4 baselines are empty: type dump findings 105 → 0, fold dump 0.** Each class of the 105
      was a store the census did not model or a measured vendor fact, closed at its root: an FB declaration's initializer
      WARNING said twice (`analysis` `initializerWarnedTwice`, the one `pushForDeclaration` reads; the census lets one store
      explain both copies, the inner conversions of such an initializer too); a conversion's argument into its
      source type, an arithmetic operand of the wrong family (`operandFamilyRule`, ANY_NUM), NOT's ANY_BIT
      (`unaryOperandConversion`), a bitwise operand into the unsigned integer of the width, an output binding, a chained
      assignment, a `REF=` declaration, an enum member's value, a struct initializer's echo on an elementary variable, a
      VAR_IN_OUT bound not converted — each from the front-end or analysis function that decides it; the atomics' operands from
      the type layer (`builtins` `atomicOperand`, moved out of `intrinsic-operands`' private tables); a recursive
      call's hole (`insideOwnBody`); a network body's messages counted apart (`in a fixture with a network body`, the census
      reads ST). Named known divergences: `sysop_position_call_form` (moved from `CODESYS_TRIAGE`, now empty, into
      `CODESYS_POSITION_IN_AN_INITIALIZER`: the sized string is the position text's length — niche, 0 `__POSITION` in the
      corpora); TwinCAT `cc_fp_overflow_expr`, `cc_init_constant_expr_into_sint` (`TWINCAT_UNTYPED_OPERATION_IN_AN_INITIALIZER`:
      TwinCAT types a folded operation over untyped integers as the smallest signed integer — niche, 0 overflowing ones in the
      corpora); TwinCAT `ldate_ltod_ldt` (`TWINCAT_ARITHMETIC_ON_AN_UNKNOWN_DATE_TYPE`). The census places an ALIAS's type
      expression in the project scope (`dumps.ts` `sites`; rule DT1): NOSCOPE literals 31 → 18 per vendor, Library Manager
      19971 → 19840 — one of pro2193's aliases bounded by a platform-integer constant moves into the TY6 class (+1, a named
      ceiling exception in `baseline.ts`). **Rules GAP area 4 1 → 0, total 1 → 0 (pinned):** TY6 recorded on its own target —
      `recordings/twincat-32.build.json`, TwinCAT Project14 on TwinCAT CE7 (ARMV7), written by `VOLT_RECORDING_TARGET=32`
      (`record-language`; `recording-target` `THIRTY_TWO_BIT_WIDTH`), 38 fixtures that name a platform integer or store a
      pointer (the probe among them); `test/conformance/target-32.test.ts` replays each on a 32-bit project (C0033 an error, as the project configures
      it): 35 agree, 3 expected failures — `cp_xsizeof` (TwinCAT's XSIZEOF), `ty_xint_to_dint_result_type` and
      `dt_pointer_arithmetic_values` (niche: 0 platform integers in the corpora's own code; the second batch, which would have
      measured pointer − pointer on that target, ran while another session held an XAE on the same project name and was refused
      by its own probe — the TwinCAT tier needs Project14 to itself).
      **Step 4e numbers.** `rate:fixtures` 4892 (+35): confirmed 2713 (+8), refused 1752 (+23), not-lowered 289 (+2), lsp-gap 65
      (+2), diverges 5, unaskable 68; edges agree 2877 / disagree 0 / not-run 161. Ceilings (`fixtures.test.ts`, FOR
      MEASUREMENT): lsp-gap 63 → 65 (the two alias-initializer refusals), not-lowered 287 → 289 (`dt_this_into_pointer`,
      `dt_this_deref_identity_values` — the transpiler's: a bare THIS and `SUPER^.v` as places, task 5.3). Agreement (whole
      `test/conformance`) CODESYS 4499 → **4526**, TwinCAT 4406 → **4432** (floors not raised — the gate's). Type dump 105 → **0**,
      fold dump 0; resolution/parse/fixed-point baselines moved by the new fixtures only (Library Manager NOSCOPE −5 names, −3
      members, from the alias scope). Known divergences: opened `ALIAS_INITIALIZER_NOT_CHECKED` (both, 5),
      `TWINCAT_UNTYPED_OPERATION_IN_AN_INITIALIZER` (2), C0033 +3, TwinCAT library +1, TwinCAT unknown date type +1,
      `sysop_position_call_form` from triage. Runs: `bun test src` 1838/0, `test/conformance` 5911 pass / 289 todo / 0 fail
      (whole, incl. `target-32.test.ts` 40/0), `test/frontend` 34/0, `test/corpus` 19/0, `rate:fixtures`, `bun typecheck`,
      `bun run lint` exit 0.
      **Step 4e review (6 findings; 5 fixed test-first, 1 wrong).** Five cells recorded on both vendors
      (`fixtures/types/derived-types.ts`): `dt_interface_into_integers`, `dt_fb_instance_into_integers`,
      `dt_struct_type_name_called`, `dt_static_base_unknown_member`, `dt_method_name_in_same_named_method`. (1) A STRUCT type's
      or INTERFACE's name as a static base had gone quiet: `analysis/resolution` `checkMember` reads a `StaticType` base again
      ("'nope' is no component of 'Dut_s'" / 'I_x', and their Unknown-type stores); a STRUCT type's name CALLED is "Cannot
      call object of type 'TYPE'" plus C0230 "Type name … not expected in this place" — not the C0035 HEAD said
      (`non-callable-call`, `type-as-value` for a call and for a member the struct lacks, `hole` explains with C0230).
      (2) A POU named by its name keeps its declared case in a member-not-found message (recorded on CODESYS; TwinCAT
      upper-cases it, which the comparison folds): `FunctionBlockType.byName` and `StaticType.name` are declared, `render`
      upper-cases. (3) WRONG: an interface and an FB instance ARE refused into every integer (LWORD, DWORD, __XWORD named
      'LWORD', INT, both vendors); the silent __XWORD was the repro's missing target. (4) `insideOwnBody` matches the scope
      the symbol's owner holds, not the name. (5) The 32-bit batch was contaminated: re-recorded on an XAE of its own (39
      fixtures, with `dt_pointer_difference`, DWORD): `ty_xint_to_dint_result_type`, `cv_integers_into_pointer`,
      `dt_pointer_arithmetic_values` had been recorded clean and build with errors; the two niche marks removed (the LSP
      agrees), and an integer into a pointer on 32 bits is the mirror rule (`compat` `integerIntoPointer`: 64-bit refused,
      the rest as into UDINT); TY6's recheck corrected. (6) The type census names every network-body message (fixture and
      text, 3 CODESYS + 6 TwinCAT) instead of one blanket count. `rate:fixtures` 4897: confirmed 2713, refused 1757 (+5),
      not-lowered 289, lsp-gap 65, diverges 5, unaskable 68; edges 2878 / 0 / 162. Agreement CODESYS 4531, TwinCAT 4437.
      Runs: `bun test src` 1843/0, `test/conformance` 5912 pass / 289 todo / 0 fail (whole, `target-32` 41/0),
      `test/frontend` 34/0 (baselines rewritten for the new fixtures and the named network-body tallies; findings unchanged),
      `bun typecheck`, `bun run lint` exit 0.
      **Gate 4e (2026-10-03, 4.7.4–4.8, on HEAD 63b37d1657 + the step's tree).** `bun typecheck` clean; `rate:fixtures`
      reproduces the map byte for byte (4897; confirmed 2713, refused 1757, not-lowered 289, lsp-gap 65, diverges 5, unaskable
      68; edges 2878 / 0 / 162); full run (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset) **7991 pass / 34 skip / 333 todo /
      0 fail** (8358 tests, 205 files, 340 s; vs gate 4d +71 pass, +2 todo — the not-lowered `dt_this_into_pointer`,
      `dt_this_deref_identity_values` — +73 tests, +1 file `target-32.test.ts`); agreement CODESYS **4531** (+32), TwinCAT
      **4437** (+31) — floors raised 4499 → 4531 and 4406 → 4437 (`fixtures.test.ts`; re-run whole `test/conformance`, 5912
      pass / 289 todo / 0 fail); type dump findings 0, fold dump 0 disagreements; LT14 disagreements corpus 78 / fixtures 79;
      `bun run check` 15 passed, 0 failed; `bun run lint` exit 0.

## 5. Consequences downstream

- [x] 5.1 Re-run analysis, corpus, build-conformance and the transpiler suites; every change is either a recording-decided
      improvement (note it) or a regression (fix it). Regenerate the map.
      Acceptance: all green; the improvements listed here. Depends on: 2.10, 3.6, 4.8
      **5.1 (2026-10-03, on HEAD 94a1cbfd8c).** Runs, each once: the consumer `src` suites (`analysis`, `services`, `server`,
      `network`, `network-text`, `transpile`, `reference`, `workspace-refs`, `source-extensions`) **1368 pass / 1 skip / 0 fail**
      (131 files); `test/corpus` (parse, "the LSP invents nothing" = build-conformance, lowering totality) + `test/libraries` +
      `test/catalog` **189 pass / 33 skip / 44 todo / 0 fail** (266 tests); whole `test/conformance` (the transpiler's fixture
      suite and the LSP's) **5912 pass / 289 todo / 0 fail** (6201 tests, 12 files); `test/frontend` **34 pass / 0 fail** (10 files; baselines unchanged);
      `rate:fixtures` reproduces `map.generated.ts` byte for byte (4897: confirmed 2713, refused 1757, not-lowered 289, lsp-gap 65, diverges 5, unaskable 68; edges 2878 / 0 / 162).
      **What the change did downstream, measured** — snapshot F of 1b03f0e55c (0.6: `src/` identical to the commit before this
      change) against the working tree, every source matched by path with the extension dropped (the DUT/POU file unification
      renamed `.prg`/`.fb`/`.struct` to `.pou`/`.dut` meanwhile):
      - **Transpiler (F-back): no output changed.** Emitted Rust and interpreter values are byte-identical for all **2181**
        fixtures that lowered at the change's start. 22 fixtures stopped lowering and 59 changed their lowering diagnostics —
        every one recording-decided: 56 refused fixtures (CODESYS refuses them) are now refused by the parser, as the vendor
        does (`cc_il_name_*` ×14, `cc_reserved_name_*` ×3, `cc4_type_name_*_as_variable` ×2, `identifier_*underscore*` ×2,
        `var_non_retain` — the 22; `pwh_*`, `esc_wstring_*`, `operator_call_form_*`, `cc_power_operator`, `cc_fp_op_ampersand`,
        `cc_time_*_literal*`, `power_/ampersand_operator_rejected`, `cc_unterminated_if`, `conditional_orphan_else`, …), one
        unaskable (`pwh_prose_gvl`, a parse message in the vendor's words now); `operand_uchar_literal` (`UCHAR#'A'`) now lowers and compiles (edge agree) where lowering
        called it a malformed literal — NOT recording-decided: CODESYS REFUSES it ("Cannot convert type 'UDINT' to type
        'BYTE'", `codesys.build.json`) and TwinCAT refuses it at parse, so it joins the 266 refused fixtures that lower,
        outside the transpiler's input contract ("code CODESYS compiles"; `fixtures.test.ts` `refused` row) — neutral, and
        the LSP gives the recorded refusal (pinned in review: the fixture's `refused` field); two not-lowered
        fixtures change their refusal because the front-end now types `VERSION` and an `ANY` input as the compiler's structs
        (TY14/TY15, recorded): `type_codesys_version` (`slot-unknown` → `layout-struct` "VERSION has no declaration lowering
        can lay out") and `refuse_interface_any_input` (+ that refusal for ANY before its own) — still refused by name, but at
        a zero span — a regression this note first only handed on; fixed in review: `storageOf` takes the span of the use
        and a type with no declaration of its own (a compiler struct) is refused there, never at 0:0 (`lower.test.ts` "a
        compiler struct lowering cannot lay out …"; the `?? ZERO_SPAN` fallbacks in `storage.ts` are gone).
      - **LSP over the six corpora: one file changed, toward the recording.** 1145 of 1146 project files and all 28 024
        Library Manager files give identical diagnostics; bakon-nano `CalcMasterSpeedAcc` gains 2 × C0197 "Implicit
        conversion from 'LREAL' to 'REAL'" (`Axis.scPar.MaxVelocity / ABS(rGearingRatio)` into a REAL) — the recorded build
        has 20 copies, the LSP now 16 (was 14). COUNT-LEVEL EVIDENCE ONLY: every C0197 in the corpus recording has line 0
        and no file, so it cannot say these two are among the 20; six other files read the same LREAL members
        (`Axis.scPar.MaxVelocity`) without changing, and the two could be false positives under the count. Settling it
        needs a per-file recording of bakon-nano, not done here. Corpus gate figures unchanged: warnings ours/build CodesysTestProject 0/0,
        awa-palletizer 0/0, bakon-nano 4/4, lenze-mid 3/4, pro2193 0/5 (distinct messages; the misses are pre-existing);
        lowering 54/304 POUs, 85 of 116 refusal codes reached, IR coverage 8/8, 9/9, 24/24.
      - **Fixture ratings: of the 2783 fixtures the map held at the start, 1 changed evidence** (`cc_decl_init_dunder_unknown`
        lsp-gap → refused: the LSP now gives the recorded refusal). Divergence marks on those fixtures: closed 3
        (`cc6_loop_cannot_exit`, `cc5_deprecated_functionblock_keyword`, `cc3_reference_assign`), narrowed 5 (`newdel_*_pragma`
        to CODESYS only), triage → known 3 (`sysop_position_*`, `ldate_ltod_ldt`); opened on 22 (5 `CALC_CONDITIONAL_CALL`,
        16 TwinCAT-only: `TWINCAT_WSTRING_ESCAPE_RUNS_TO_END`, `TWINCAT_ECHO_NAMES_A_POSITIONAL_ARGUMENT`,
        `TWINCAT_NON_RETAIN_RECOVERY`, `TWINCAT_XSIZEOF_IS_NO_KEYWORD`, `TWINCAT_UNTYPED_OPERATION_IN_AN_INITIALIZER`; and
        `cc5_pointer_not_convertible` widened to TwinCAT) — none an answer that got worse: each is a disagreement the 0.1/0.3
        census already listed (the recorded-only "not defined" names, the TwinCAT L-date lexing) or a TwinCAT message the
        comparison started checking, opened with its reason in the step that found it.
      No regression found, so nothing fixed here; no test or fixture added (no logic changed). [Superseded by the step-5
      review: the zero-span refusal above was a regression and is fixed; `operand_uchar_literal`'s refusal is pinned.]
- [x] 5.2 Record in `transpile-restructure` which of its root causes this change already closed, and which of its §6 items 1–15
      the front-end now provides (with their `frontend/…` paths).
      Where: openspec/changes/transpile-restructure/{design,tasks}.md. Acceptance: every §6 item has a path or "not provided,
      because". Depends on: 5.1
      **5.2 (2026-10-03).** transpile-restructure design.md §6.1 (a 15-row table: verdict, `src/frontend/…` path and export,
      the transpiler copy still standing) and §6.2 (every front-end root cause with its status), pointed to from a new last
      section of its tasks.md ("Hand-off from frontend-conformance") as the input of its 0.1 and 0.9. §6 items: **met** 1
      (`syntax/identifier.ts`), 2 (`symbols/extends.ts`), 8 (`types/conversion-name.ts`), 9 (`types/arith/*`, EXPT in
      `types/builtins.ts`), 10 (`types/const/{constancy,fold}.ts`), 11 (`types/enums.ts`), 12 (`syntax/literal/calendar.ts`),
      13 (`types/infer/{expr,member,callee}.ts`), 15 (curated indexes; `wrapToWidth` and the private `fbChainSections` not on
      one); **in part** 6 (`types/width.ts` — `widthOf` not provided) and 7 (`types/literal.ts` — `contextLiteralType` not
      provided: LT14 pins 29 classes where it and `literalCheckType` disagree); **not provided, because** 3 (no front-end
      consumer of `peelArray`/`elementOf`), 4 (no value model; the facts `typeDefault` reads are provided), 5 (no front-end rule
      asks the transpiler's predicate set; `types/predicates.ts` is its home), 14 (the asker stayed optional). Root causes:
      none closed by this change — RC 1–4, 2.3, 6, 21, 45 were closed upstream by the review's own fixes before this change's
      first code step; of the appendix items it closed 6.A.22 (4.6.2, CE8), 6.A.24 (3.2.3, H2), 6.A.26 (3.4.2), and the
      front-end half of 6.A.20 (`**`/`&`, 2.5a; REAL MOD still folds), 6.A.25 (4.7.1, `Type.subrange`) and 6.A.29 (4.6.1,
      `declaredValue`); 6.A.21 and 6.A.23 are open (probed: `SIN(-1.5)`, `SQRT((2.0))` infer UNKNOWN).
- [x] 5.3 Hand-off list into `transpile-restructure`: every "T" row of design.md P6 and §3.3 — the 13 EXTENDS sites, places GVL
      resolution, the `ns.symbols.get` namespace lookups (calls.ts:976,1627, constants.ts:103), `stored`/`fit`/`integerFoldType`,
      `withStringCapacity`, `contextLiteralType`, `UNARY_MATH`, the platform rewrite, `canonicalElem`'s target in lowering.ts, the
      LIMIT/SEL/MUX and NOT rules, the duration × integer rule, the constant folder, `enumStorage`, interp `sameName` — each with
      the front-end function that replaces it.
      Where: openspec/changes/transpile-restructure/tasks.md. Acceptance: every T row appears once. Depends on: 5.2
      **5.3 (2026-10-03).** transpile-restructure tasks.md "Hand-off from frontend-conformance", H1–H11, each with the
      transpiler sites re-read today, the front-end function that replaces it and the restructure task that owns it: H1 the
      EXTENDS walks (21 sites today in `lower.ts`, `calls.ts`, `storage.ts`, `bytes.ts`, `interfaces.ts`, `lowering.ts` `baseOf`)
      → `symbols/extends.ts` `extendsChain`/`baseOf`/`basesOf`/`ancestry`; H2 places' GVL resolution → `scope-nav`
      `resolveGvlMember`; H3 `ns.symbols.get` (`calls.ts` :993, `lower.ts` :302; `constants.ts` already on `findChildScope`) →
      `findChildScope` + `lookupLocal`; H4 NOT → `notResultType`, duration × integer → `durationScaleResultType`, LIMIT/SEL/MUX
      → `selectionValueArguments`, `UNARY_MATH` → `MATH_ARG_TYPED`/`mathResultType`, the platform rewrite →
      `parseConversionName(name, target)`; H5 `contextLiteralType` → `types/literal.ts` (not value-identical: LT14 first); H6
      `stored`/`fit`/`integerFoldType`/`widthOf` → `wrapToWidth`/`integerOfWidth`; H7 the constant folder → `const/fold`
      (`constEval`, `compileTimeConstant`, `declaredValue`), `enumStorage` → `types/enums.ts`; H8 `withStringCapacity` →
      `DEFAULT_STRING_LENGTH` at `lowering.resolve`; H9 the target (`lowering.ts`'s `canonicalElem` call is gone; left
      `EXEC_ORACLE_TARGET` and `bytes.ts` SIZEOF) → `types/platform.ts`; H10 interp `sameName` → `syntax/identifier.ts`; H11 (from
      1.23) the attribute maps → the AST's `attributes`. Plus the not-lowered fixtures the front-end now types
      (`ce_fold_untyped_in_context_values`, `dt_union_member_sizes`, `dt_this_into_pointer`, `dt_this_deref_identity_values`,
      `ty_dint_to_uxint`, the enum `to_string` table, and 5.1's `type_codesys_version`/`refuse_interface_any_input`).
      **Gate 5 (2026-10-03, 5.1–5.3 + the step-5 review fixes, on HEAD b989a16d9d + the step's tree).** `bun typecheck`
      clean; `bun run lint` exit 0; `rate:fixtures` reproduces the map byte for byte (4897; edges 2878 / 0 / 162); full run
      (`VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset) **7993 pass / 34 skip / 333 todo / 0 fail** (8360 tests, 205 files,
      324 s; vs gate 4e +2 pass, +2 tests — `lower.test.ts` "a compiler struct lowering cannot lay out …" and the pinned
      `operand_uchar_literal` refusal); agreement CODESYS **4531**, TwinCAT **4437** (floors unchanged); type dump 0 findings, fold dump 0 disagreements; LT14
      disagreements corpus 78 / fixtures 79 (unchanged); `bun run check` 15 passed, 0 failed.

## 6. Close

- [ ] 6.1 docs/architecture.md and data-model.md describe the front-end layer (`src/frontend/`), its sub-layers, its indexes and
      its import rules; the stale "literals carry a type" claim is corrected.
      Acceptance: the docs name every sub-layer and rule F1–F4. Depends on: 5.3
- [ ] 6.2 Final review (spec + layering); fix; archive; delete the recreated openspec/specs/.
      Acceptance: `openspec/changes/archive/<date>-frontend-conformance` exists; `openspec/specs/` absent. Depends on: 6.1
