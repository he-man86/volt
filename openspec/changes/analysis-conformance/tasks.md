Execution: `.claude/workflows/execute-change.js` with `{ change: "analysis-conformance", requires: ["frontend-conformance"] }`.
Resumable: it skips ticked tasks. Every step: test-first. Implement agents run targeted tests; only the gate runs the FULL
suite (packages/volt-lsp-iec `bun test`, plus `bun run check` at the repo root). The map is regenerated
(`bun run rate:fixtures`) and the step's numbers are written under its task. Oracle: the CODESYS and TwinCAT build
recordings, written only by the recorders, in ONE batch per vendor per step (`RECORD_ONLY=<a,b,c>`).

**Steps.** Every `###` sub-section is ONE step (at most 5 tasks, one commit, one kind). A step never mixes an
output-neutral task (acceptance A) with an output-changing one (acceptance N): that is why phase 2 is split into 2a (R),
2b (N) and 2c (measure-gated).

**Format.** Every task is one `- [ ] <id> <what>` line, followed by `Where:`, `Acceptance:` and `Depends on:` continuation
lines. Paths are relative to `packages/volt-lsp-iec/`. P1–P9, §2–§7 refer to design.md.

**Acceptance shorthands.**
- **A:** `bun scripts/frontend-snapshot.ts check --aspects diagnostics,fixture-diagnostics` is identical against the task's
  parent commit (or `--base <commit before the task>`), and `bun scripts/suite-snapshot.ts --compare` is identical.
- **N** (seam tasks that change output): the A diff is printed, and every changed class is listed under the task with its
  fixtures/corpus counts. Each class is either recording-confirmed (TP rises / FP falls) or fixed. The analysis census
  ceilings do not rise.
- **G:** `bun run lint` (check-layering, rules A1–A6) passes, and the A-rule allow-list in `scripts/check-layering.ts`
  shrank by the entries the task names.
- **CA** (every 3.x task):
  1. every fixture the task names exists and is recorded on both vendors (one recorder run per vendor for the whole step);
  2. each disagreement was pinned first as a known divergence (red), then fixed test-first in its §2 home with a
     colocated src test, and the mark removed. If it is not fixed, it stays a divergence, or is
     `niche: accepted loss (N occurrences in the corpora)` with N counted;
  3. `test/analysis/diagnostic-census.test.ts`: the group's open-FP, GAP and never-fired-builder ceilings fall by what
     the task closes, rewritten with `VOLT_WRITE_BASELINE=1` in the same commit;
  4. written under the task: fixtures recorded, divergences opened/closed, the group's FP/GAP per vendor before → after.

## 0. Measure (mechanical, no judgement)

### 0 Measure

- [x] 0.1 Fixture census, both vendors, network text ON: per check, per message builder: fired, TP, FP, div, GAP, SEV
      (design.md §6), and a test that census rows == registry entries. `runRegistry(ctx, onCheck)` and `CHECK_REGISTRY`
      are exported read-only from the orchestrator for this; nothing else in product code changes.
      `test/frontend/baseline.ts` takes a baseline directory; `baseline.test.ts`'s history check covers both ceilings
      files and its errors name the file they read. test/README.md and TESTING.md list `test/analysis/` as a concern.
      Where: src/analysis/diagnostics.ts (export only), test/analysis/{census.ts,diagnostic-census.test.ts},
      test/analysis/baselines/{fixtures.codesys,fixtures.twincat,ceilings}.json, test/frontend/{baseline.ts,baseline.test.ts},
      test/README.md, TESTING.md.
      Acceptance: snapshot F identical; `bun scripts/suite-snapshot.ts --compare` identical; `test/frontend/baselines/*.json`
      byte-identical; baselines committed; per-group table written here (unsupported-operator and partial-access counted
      apart). Depends on: frontend-conformance archived
      **Measured 2026-10-06** (`test/analysis/{census.ts,diagnostic-census.test.ts}`; baselines
      `test/analysis/baselines/{fixtures.codesys,fixtures.twincat,ceilings}.json`). `runRegistry(ctx, onCheck)` and
      `CHECK_REGISTRY` are exported from `analysis/diagnostics.ts` (`computeSemanticDiagnostics` = its dialect assertions +
      `runRegistry(ctx)`; output-neutral). The census binds every fixture through `test/conformance/support/replay.ts` — the
      replay's composition moved out of `fixtures.test.ts` unchanged, so the gate and the census measure one project.
      `baseline.ts` takes a directory; `baseline.test.ts` holds both ceilings files to their history, and every error names
      the file it read. Snapshot F (`check --base HEAD`): identical, 483,583 aspects. `suite-snapshot --compare`: identical,
      6,319 tests. `test/frontend/baselines/*.json` unchanged. Census rows = the 79 registry entries + `network-text` (the pass
      outside the registry while §3 is parked) — a test. Fixtures measured: 4,768 CODESYS, 4,757 TwinCAT — every fixture the
      replay compares (re-measured at the gate, see "Gate review" below). Per group (checks firing / TP / SEV / FP / GAP
      owned by one check / never-fired builders):

      | group | CODESYS | TwinCAT |
      |---|---|---|
      | types | 21 / 1527 / 19 / 17 / 7 / 8 | 20 / 1549 / 19 / 31 / 6 / 8 |
      | declarations | 20 / 131 / 0 / 3 / 19 / 2 | 17 / 338 / 0 / 3 / 18 / 8 |
      | names | 6 / 132 / 0 / 9 / 10 / 1 | 5 / 452 / 0 / 29 / 4 / 2 |
      | oop | 16 / 103 / 0 / 0 / 7 / 0 | 13 / 79 / 0 / 0 / 2 / 6 |
      | calls | 6 / 147 / 0 / 0 / 7 / 8 | 6 / 136 / 0 / 1 / 7 / 9 |
      | flow | 8 / 234 / 0 / 9 / 10 / 1 | 7 / 237 / 0 / 30 / 17 / 3 |
      | pragmas | 1 / 38 / 0 / 0 / 0 / 0 | 1 / 3 / 0 / 1 / 0 / 5 |
      | syntax (parse-errors) | 1 / 2893 / 0 / 70 / 33 / 0 | 1 / 3629 / 0 / 240 / 70 / 0 |
      | network (outside the registry) | 1 / 24 / 0 / 0 / 3 / 1 | 1 / 22 / 0 / 0 / 2 / 3 |
      | **total** | TP 5229, SEV 19, FP 108 (open 1), GAP 459 | TP 6445, SEV 19, FP 335 (open 0), GAP 807 |

      Every FP but one sits on a fixture the replay already pins (KNOWN_DIVERGENCES / triage). The one open FP (CODESYS):
      `refdecl_target_undeclared` (inProgram) — the LSP gives `Cannot convert type 'Unknown type: 'nope'' to type
      'REFERENCE TO INT'` twice, CODESYS once; the replay compares as a set and sees only a disagreement, the census
      counts the extra copy (a 3.x types finding). Of the GAP, 293 CODESYS / 566 TwinCAT sit on a builder several checks
      share (`cannotConvert`, `narrowing` / `enumConversion` through `rules.ts` `conversionWarning`, `undefinedIdentifier`,
      `parenExpectedInsteadOf` from both the parser and `conditional-call`, …) and 70 / 115 are unowned (0.2). SEV 19 on each
      vendor is all `pointer-conversion` (C0033 recorded at the other severity; `pointerNotConvertible` has 0 TP). The
      per-check table is design.md §5 "Measured". unsupported-operator and partial-access: both checks are GONE from the
      registry (frontend-conformance 2.5.3 / 2.5.4); their wording now reaches the editor as the parser's, through
      `parse-errors`, and no fact on `ParseError` tells those errors apart, so they can no longer be counted apart (0 / 0).
- [x] 0.2 Corpus census: the five CODESYS and one TwinCAT projects through `projectDocuments` vs their recorded builds, per
      project and per code (server-policy findings as `server:<code>`); plus the unowned-gap shape classification
      (owned-by-frontend / project-config / missing-rule) over fixtures and corpora.
      Where: test/analysis/census.ts, baselines/corpus.json. Acceptance: corpus.json committed; the table and the
      classification (every unowned shape in exactly one class, counts summing to the unowned total) written here.
      Depends on: 0.1
      **Measured 2026-10-06** (baseline `test/analysis/baselines/corpus.json`: the server's `projectDocuments`, normalized
      as the corpus gate normalizes, a severity-aware multiset; codeless server findings as `server:missing-language` /
      `server:parse-raw`).

      | project | vendor | TP | SEV | FP | GAP (attributed) |
      |---|---|---|---|---|---|
      | CodesysTestProject | CODESYS | 0 | 0 | 0 | 0 |
      | awa-palletizer | CODESYS | 0 | 0 | 0 | 0 |
      | bakon-nano | CODESYS | 23 | 0 | 0 | 4 (`narrowing`, shared: call-arguments, intrinsic-operands, narrowing) |
      | lenze-mid | CODESYS | 5 | 0 | 0 | 1 (`narrowing`, shared) |
      | pro2193 | CODESYS | 0 | 0 | 0 | 7 (1 `pragmas`, 6 unowned) |
      | twincat-project14 | TwinCAT | 0 | 0 | **216 `server:missing-language`** | 0 |

      No recording is incomplete (none failed, none truncated). FINDING: every TwinCAT-corpus FP is server policy — the
      project's files carry no `IMPLEMENTATION <LANG>` line (materialized before implementation-keyword), so the server flags
      each body "states no language" and quiets every analysis finding inside it: the TwinCAT corpus is effectively
      unanalysed by the server path. The answer is re-pulling `twincat-project14` (a corpus refresh, not analysis work);
      `corpus.test.ts` cannot see it, since it gates only the CODESYS recordings.

      Unowned-gap shapes (`census.ts` `unownedClass`: each shape in exactly one class, by its wording; the counts sum to the
      unowned totals):

      | | owned-by-frontend | project-config | missing-rule | unowned total |
      |---|---|---|---|---|
      | fixtures CODESYS | 3 | 27 | 40 | 70 |
      | fixtures TwinCAT | 46 | 17 | 52 | 115 |
      | corpora | 0 | 3 | 3 | 6 |
      | **all** | 49 | 47 | 95 | 191 |

      owned-by-frontend: "… expected instead of …" (TwinCAT's `VAR, VAR_INPUT, VAR_OUTPUT or VAR_INOUT expected instead of
      x:INT;` family, `Variable declaration expected instead of VAR_*`), "Counter initialisation expected", an array border that
      does not evaluate. project-config: no memory for dynamic object creation (20), no VAR_PERSISTENT list, no structured
      exception handling on the code generator (10), device description missing, stack size / stack usage, SymbolConfig, the
      vendor's internal errors. missing-rule (3.11's list): access to PRIVATE / PROTECTED / INTERNAL members (18 CODESYS / 15 TwinCAT, the largest family),
      "Expression of type '…' expected in this place" (2 / 17), an uninitialized variable used to initialize another
      (TwinCAT, `initprg_reads_later`, found once the PLC_PRG fixtures were measured), FINAL override, ABSTRACT method not implemented, interface
      method must be PUBLIC, the global scope operator on an expression, lazy-typed variable, operator not allowed in this
      statement, an interface not extending `__System.IQueryInterface`, a duplicate enum value, references to bits,
      VAR_IN_OUT CONSTANT needs a variable, address granularity alignment, initialization from an uninitialized reference
      (corpus, 3).
- [x] 0.3 Coverage: builders with 0 TP on either vendor, and registry checks firing on 0 fixtures (expected: bit-usage,
      obsolete-usage, ambiguous-global, method-signature; case-labels 5/6 builders). This becomes the catalogue's GAP list.
      Where: baselines/coverage.json; design.md §5 updated with the measured numbers. Acceptance: coverage.json committed
      and generated by the census (not hand-written); the GAP list written here. Depends on: 0.1
      **Measured 2026-10-06** (baseline `test/analysis/baselines/coverage.json`, generated by the census; design.md §5
      "Measured" holds the per-check table). Builders with 0 TP: **21 on CODESYS, 43 on TwinCAT (19 of them on both)**.
      Registry checks firing on 0 fixtures: **0** — `loop-exit` fires on one PLC_PRG fixture per vendor once those are
      measured (it read 1 before the gate review). The four the design expected (bit-usage,
      obsolete-usage, ambiguous-global, method-signature) all fire now; case-labels has one builder at 0 TP
      (`caseOverlappingRanges`), not five. The GAP list:
      - 0 TP on both: `adrOnBit`, `arrayInitCountNonConst`, `arrayInitExpected`, `initListExpected`, `bitInWrongBlock`,
        `caseOverlappingRanges`, `compareNotPossible`, `compareNotPossibleTwo`, `defaultNotConstant`, `duplicateMethod`,
        `iniNeedsInstance`, `newInExpression`, `pointerNotConvertible` (fires, but at the other
        severity: the 19 SEV), `queryInterfaceFirst`, `queryInterfaceSecond`, `queryPointerSecond`, `subrangeAssignTarget`,
        `unknownNamedOutput`, and `semicolonExpectedInsteadOf` — called by no check since frontend-conformance moved its
        callers into the parser (a dead builder for 1.11 / 4.4).
      - 0 TP on CODESYS only: `boundsNeedVariableLength`, `unexpectedArrayInit`.
      - 0 TP on TwinCAT only: `abstractAssignTarget`, `abstractKeywordMissing`, `assignmentSourceIncorrect`,
        `attributeOnlyOnVariables`, `defaultOutputUnused`, `fbReInitShape`, `functionRequiresInputRange`, `genericCount`,
        `inOutConstantNeedsVariable`, `inputInPropertyAccessor`, `interfaceParamCountMismatch`, `interfaceVariableMismatch`,
        `invalidAttributeValue`, `invalidSymbolAttributeValue`, `missingEnPin`, `multipleAssignmentNew`, `noDefaultForType`,
        `packModeNotAllowed`, `pointerIndexArity`, `recursiveConstant`, `reservedKeyword`, `unionInheritance`,
        `unknownAttribute`, `vectorBaseType` (several by rule: their check does not run for TwinCAT).
      - Checks firing on 0 TwinCAT fixtures: `typed-literal`, `generic-instantiation` (they run there); `abstract-assign`,
        `abstract-output-default`, `attribute-placement`, `constant-cycle`, `input-default`, `new-in-expression`,
        `reserved-keyword` (CODESYS-only in the registry).
- [x] 0.4 Seam measures (design.md §6): raw `parseResult.errors` ⊆ checkParseErrors (corpora + fixtures); server
      duplicate parse errors per corpus; network findings with configurable codes per corpus project and how many the
      project's settings turn off; the four compositions (server, runLsp, evidence, agreement-residue) diffed per fixture;
      parseNetworkText calls per edit and ms over the corpus graphical bodies, as a % of one documentDiagnostics pass;
      both directions of a shared `out` (network codes in hole's sets; ST findings the network hole pass would see);
      the cost of a `groups: ["syntax"]` run on dead POUs vs today's skip.
      Where: a scratch script (not committed) + numbers here. Acceptance: each number written; any raw parse error without
      a partner is listed as a finding for 2.5. Depends on: 0.1
      **Measured 2026-10-06** (scratch script, not committed):
      - raw `parseResult.errors` ⊆ `checkParseErrors`: fixtures 19,368 documents (both vendors; own item, PLC_PRG, lists),
        1,079 raw errors, **0 without a partner**; corpora: 0 raw parse errors in all six. No finding for 2.5.
      - server duplicate (codeless) parse errors: **0** on every corpus project (no corpus file has a parse error).
      - network findings with a configurable code: lenze-mid 1 (`sign-change-conversion`, a TP), twincat-project14 2
        (`jump-label-unreferenced`), the other four 0; the projects' settings turn off **0** of them. (lenze-mid's network pass
        also gives 8 `NETWORK_UNRESOLVED_BOX`, none of which reaches the server's output.)
      - the four compositions, CODESYS, every 10th fixture (479), against the replay: evidence `lspMessagesOn` differs on 1
        (`decl_array_single_bound_used`); evidence `lspErrors` (`diagnosed`) on **18** (parse errors counted twice:
        `identifier_consecutive_underscores`, `lex_*_as_name*`, …); `agreement-residue` on 2
        (`cc5_deprecated_functionblock_keyword`, `unit_namespace_method_after_fb`: it parses with `parseSource` under a `.st`
        uri, not as the object's document); the server's `documentDiagnostics` on **479 of 479** — a fixture source states no
        `IMPLEMENTATION` line, so the server reads every body as unstated (missing-language + `quiet`): the server's
        composition is not comparable on fixture sources until they are given in workspace format (input for 2.6).
      - `parseNetworkText` per edit: up to 4 per graphical body (diagnostics and semantic tokens through `analyzeNetworkText`,
        folding and document symbols `STRUCTURE_ONLY`), plus 1 `analyzeNetworkText` per position query in a network body.
        Over the corpus graphical bodies (34): lenze-mid 29 bodies, structure parse 24 ms + analyze 25 ms against a 547 ms
        `documentDiagnostics` pass = **17.8 %** at four parses; twincat-project14 5.2 %; awa-palletizer and bakon-nano 0.4 %;
        pro2193 0.01 %. Above §3's 5 % line on two projects — the parse-memo condition holds (parked: handed off in 5.3).
      - a shared `out`, both directions: hole's sets hold `network-undeclared-identifier` (both sets) and
        `network-unknown-member` (RESOLUTION_FAILURE); ST findings with a hole code inside a graphical body: **0**; network
        findings outside one: **0** (corpora) — "network last + local slice" changes nothing.
      - `groups: ["syntax"]` on dead POUs vs today's skip: dead POU documents 2 / 10 / 12 / 20 / 40 / 219 per project,
        `checkParseErrors` over them 0–1 ms in all — **≈ 0** against passes of 22–3,061 ms. (twincat-project14: 219 of 244
        documents dead — it has no IMPLEMENTATION lines, see 0.2.)
- [x] 0.5 What frontend-conformance left: which P6/P7 items still live in src/analysis (resync, nameResolves, operator
      tables, attribute/conditional parsing, compilerArrayText) and, for each of the seven parser-cascade candidates
      (unsupported-operator, partial-access, at-address, system-initializer, refused-name, conditional-call,
      call-result-access), the result of design.md §2's parser-cascade test (builder wording + spans on recorded
      errors/refusals, from the 0.1 census): move to syntax/, stay, or deleted by frontend-conformance.
      Where: design.md §2/§4 (amended in the same commit). Acceptance: the per-candidate verdict with its two measured
      facts written here; §4 rows marked present/gone. Depends on: 0.1
      **Measured 2026-10-06** (design.md §2 "0.5 measured" and §4 "What frontend-conformance left", amended). Left in
      src/analysis: `resync` gone (a test comment only); `nameResolves` present (`resolution.ts`, a wording of the front-end's
      `resolveBareName`); operator tables present as three local sets (`MATH_OPS`, `CMP_OPS`, `PASS_THROUGH_CALLS`);
      attribute / conditional parsing gone (the front-end's `readAttribute` / `directiveOf`); `compilerArrayText` present
      (`messages.ts`). The seven candidates (fact 1: the builders called; fact 2: findings on the fixtures, and of them on a
      line where the parse recorded an error):

      | candidate | verdict | builders | findings / on a parse-error line |
      |---|---|---|---|
      | unsupported-operator | deleted by frontend-conformance | — | — |
      | partial-access | deleted by frontend-conformance | — | — |
      | system-initializer | deleted by frontend-conformance | — | — |
      | refused-name | deleted by frontend-conformance | — | — |
      | at-address | stay (declarations/) | directAddressMalformed (type) | 14 / 0 |
      | conditional-call | stay (names/) | parenExpectedInsteadOf, expressionExpectedInsteadOf, conditionalCallSecondParameter, notSupportedInDeclaration | 28 / 0 |
      | call-result-access | stay (calls/) | callResultAccess (type) | 6 / 0 |

      None moves to `syntax/`: 1.15 is skipped with this note.

      **Gate review (step 0, 2026-10-06)** — four census findings, each fixed test-first in `test/analysis/census.ts`
      (the red tests are in `diagnostic-census.test.ts`), the baselines rewritten, the numbers in 0.1–0.3 and design.md §5
      re-measured:
      1. *(medium)* the census dropped every fixture with an empty own source — the 139 `inProgram` fixtures per vendor
         whose code sits only in PLC_PRG, which the replay compares. The `t.source === ""` skip is gone; fixtures measured
         4,629 → 4,768 CODESYS, 4,618 → 4,757 TwinCAT (= every recorded fixture, a test). Effect: TP 5176 → 5229 /
         6386 → 6445; TwinCAT GAP 802 → 807 (unowned 114 → 115, `initprg_reads_later`); `loop-exit` now fires (1 / 1), so
         checks firing on 0 fixtures 1 → 0 and `loopExitConstantFalse` leaves the 0-TP list; and one CODESYS open FP
         0 → 1 (`refdecl_target_undeclared`, see 0.1).
      2. *(low)* builder owners are resolved transitively through the helpers that call a builder for several checks
         (`builderOwners`: every top-level declaration that calls `.<builder>(`, up through every declaration that refers
         to it in its own file or in a file importing it by name). `narrowing` / `enumConversion` (`rules.ts`
         `conversionWarning`) are now owned by call-arguments, intrinsic-operands and narrowing; `subrangeAssignTarget` by
         assignment, intrinsic-operands, narrowing, subrange and network-text. GAP on a shared builder 284 → 293 /
         554 → 566; group types GAP 16 → 7 / 14 → 6; the corpus `narrowing` GAPs (bakon-nano 4, lenze-mid 1) are `shared`,
         no longer charged to `checkNarrowingConversion`. Never-fired builders per group re-attributed (types 6 → 8, calls
         +1, network +1, flow −1; totals 19 → 18 / 42 → 41).
      3. *(low)* builder attribution is per WINDOW (`recordingMessages().take()`): one check's run on one document, or the
         network pass on one. A finding is attributed only to a builder its own emitter called in that window, so fixture
         order no longer moves a parser text between `(parser)` and a builder. Measured: no finding line changed builder.
      4. *(low)* the corpus census refuses by name: a diagnostic with no severity throws (`corpusSeverity`); a codeless
         one is `server:missing-language` only on that finding's wording, `server:parse-raw` only when it is one of the
         document's own parse errors (`projectDocuments` now returns each document's `parseErrors`), and anything else
         throws (`corpusCode`). Corpus counts unchanged.
      The ceilings in `baselines/ceilings.json` were re-seeded at this measurement (first commit of the file, so it has
      no history to rise against): the rises are the four corrections above, not a regression. Gate: typecheck clean;
      `VOLT_REQUIRE_FULL=1 bun test` (packages/volt-lsp-iec) 8,109 pass / 0 fail / 34 skip / 381 todo (8,524 tests,
      696 s); `bun run check` and `bun run lint` pass. No fixture or transpiler change, so no `rate:fixtures`.

## 1. Restructure (design first, output-neutral, one task per move)

### 1a Gates and boundaries

- [ ] 1.1 Snapshot A: the `fixture-diagnostics` aspect in frontend-snapshot (per fixture × vendor, conformance composition,
      network text ON).
      Where: scripts/frontend-snapshot.ts. Acceptance: `check` on an unchanged tree is identical; a deliberately changed
      message is reported, then reverted. Depends on: 0.1
- [ ] 1.2 Layering rules A1–A6 (design.md §2, A3's test exception, A6 in both directions, dynamic `import()` counted) in
      check-layering, with an allow-list of today's violations measured by the rule itself (the six deep importers of
      design.md §4, incremental-index.test, obsolete-usage.test, the two untested checks, the two subject-less tests,
      network's deep imports).
      Where: scripts/check-layering.ts, test/frontend/layering.test.ts. Acceptance: G (allow-list = the measured list,
      printed here); A. Depends on: 1.1
- [ ] 1.3 analysis/index.ts becomes an explicit export list; every measured deep importer goes through it:
      src/network/network-analysis.ts (expr-echo, hole), src/server/diagnostics.ts (error-code-map),
      test/frontend/bound-census.ts (expr-echo, hole), test/catalog/catalog.test.ts (error-code-map, dynamic import),
      scripts/coverage-doc.ts and scripts/probe-projectsettings-effect.ts (config); error-code-map, expr-echo and hole
      are exported.
      Where: src/analysis/index.ts + those files. Acceptance: A; G (every A2 entry removed). Depends on: 1.2
- [ ] 1.4 reachability.ts (+ test) → server/reachability.ts; incremental-index.test.ts → server/; reachability leaves the
      analysis index; scripts/corpus-fp imports from server.
      Where: src/analysis → src/server. Acceptance: A; G (A5 entry removed). Depends on: 1.3
- [ ] 1.5 obsolete-usage.test's upward import (workspace-refs) replaced by a WorkspaceRefs literal built in the test.
      Where: src/analysis/checks/declarations/obsolete-usage.test.ts. Acceptance: A; G (A5 entry removed). Depends on: 1.2

### 1b Pipeline and shared

- [ ] 1.6 pipeline/: context.ts (CheckContext, Check), registry.ts (CHECKS), policy.ts (severity forcing, dedupePerLine),
      diagnostics.ts (computeDiagnostics with the optional `groups` restriction; computeSemanticDiagnostics kept as an
      alias until 4.4).
      Where: src/analysis/pipeline/. Acceptance: A; the registry's order byte-identical (a test lists it); `groups`
      unset = every check (a test). Depends on: 1.3
- [ ] 1.7 The registry becomes data: `{ check, group, vendors, reads?, note }`, group comments corrected (signature-name
      out of the syntax block); the CODESYS_ONLY and TWINCAT_ONLY sets fold into `vendors`; generic-instantiation and
      system-initializer get a note naming their rule gate. A test asserts every producer of a `reads` code runs before
      its reader (unknown-source now).
      Where: pipeline/registry.ts, pipeline/registry.test.ts. Acceptance: A. Depends on: 1.6
- [ ] 1.8 shared/: rules, resolution, hole, expr-echo, body-context, diagnostic-item, lost-declaration move under it;
      imports updated.
      Where: src/analysis/shared/. Acceptance: A; G (A3/A4 hold). Depends on: 1.6
- [ ] 1.9 shared/diagnostic-item `emit()` replaces every local push() helper (measured 2026-10-01: four —
      intrinsic-operands, bit-usage, const-context, array-init; re-grep at the task, the frontend run edits const-context).
      Where: those checks. Acceptance: A; `grep -rn "function push(" src/analysis` empty. Depends on: 1.8
- [ ] 1.10 The registry entry ↔ file half of A6: every entry's `group` matches its file's folder; a test fails otherwise.
      Where: pipeline/registry.test.ts. Acceptance: A; G. Depends on: 1.7, 1.8

### 1c Messages, files and tests

- [ ] 1.11 messages.ts: fbInitNoOutput and enumInitNotConvertible deleted (callers use noInput / cannotConvert); the two
      inline templates of parse-errors.ts become named builders in messages.ts, and struct-init's STRUCT echo moves to
      shared/expr-echo; the misattached JSDoc of the three network builders fixed; sections ordered by group.
      Where: messages.ts, checks/syntax/parse-errors.ts, checks/types/struct-init.ts. Acceptance: A. Depends on: 1.8
- [ ] 1.12 oop/inout-external-access + oop/inout-own-access → oop/inout-access.ts (both functions, registry slots unchanged).
      Where: checks/oop/. Acceptance: A. Depends on: 1.7
- [ ] 1.13 CheckContext.uri required: every computeSemanticDiagnostics/computeDiagnostics call site passes a uri
      (tests: `uriFor`), mechanically (call-site count measured and written here; the ~92 is a grep estimate).
      Where: pipeline/context.ts + call sites (src, test, scripts). Acceptance: A; typecheck. Depends on: 1.6
- [ ] 1.14 Tests: conversion-name.test.ts merges into checks/types/conversion.test.ts; implicit-conversion.test.ts and
      negation-sign-change.test.ts merge into checks/types/narrowing.test.ts; analysis.test.ts → pipeline/diagnostics.test.ts;
      colocated tests for abstract-instantiation and external-write (from their existing fixtures' sources).
      Where: src/analysis. Acceptance: A; G (A6 entries in both directions removed); test count not lower. Depends on: 1.2, 1.6
- [ ] 1.15 checks/syntax/ receives the candidates 0.5's parser-cascade test moved; the registry group of each is updated.
      Candidates that stay are untouched. Skipped with a note if 0.5 moved none.
      Where: checks/syntax/. Acceptance: A; G. Depends on: 0.5, 1.10

## 2. Parse-error and composition seams (design.md §3 is PARKED)

Owner, 2026-10-01: network text's language will still change, so NOTHING of it moves or is rewired here — no
network-text/index.ts, no routing rewrite, no rename, no move of network-analysis/network-analyze, no parse memo (the
former 2.1–2.4 and 2.7). src/network and src/network-text stay exactly where and as they are; their integration is
handed to the LD/FBD coverage change (5.3). Only the two seams below, which are not network work, stay.

- [ ] 2.5 Server merge: the raw parseResult.errors stream is dropped (the duplicate C0002/no-code pair); one quiet() for all
      items; `syntax-error` exempt from the dead-member suppression; a dead POU runs `computeDiagnostics({ groups:
      ["syntax"] })` (parse errors still ride, cost as today); documentDiagnostics' `messages` parameter removed (callers
      server.ts, bench.test.ts, diagnostics.test.ts); parseErrorMessage and vendorReportsParseError leave the index if
      now unused.
      Where: src/server/diagnostics.ts (+ tests: one parse error → one diagnostic; a parse error in a dead POU and in a
      dead member still shown). Acceptance: N (only the codeless duplicates vanish on the corpora; 0.4's unpartnered
      errors fixed first). The network diagnostics call stays as it is (parked). Depends on: 1.7, 0.4
- [ ] 2.6 One composition: fixtures.test runLsp, support/evidence diagnosed (no re-added parse errors; the network call stays as it is),
      scripts/agreement-residue, audit-check, corpus-fp and verify-catalog call computeDiagnostics only; the conformance
      composition passes WorkspaceRefs computed from the fixture sources (so obsolete-usage can fire).
      Where: test/conformance/{fixtures.test.ts,support/evidence.ts}, scripts/. Acceptance: N (evidence's double count
      gone; ratings recomputed by rate:fixtures, changes listed). Depends on: 2.5

## 3. Conformance per check group (gaps first; one recorder batch per vendor per step; niche rule)

Each group step has the same five tasks:
- .1 every GAP builder and every check with no fixture gets a fixture (written, not yet recorded);
- .2 one CODESYS batch + one TwinCAT batch records them;
- .3 the group's FPs: fixed test-first, or divergence/niche;
- .4 the group's gaps: implemented test-first, deleted when no vendor emits the message, or niche;
- .5 the group closed: census ceilings lowered, design.md §5 rows updated.

Every registry check is reviewed in exactly one group below, by NAME, wherever 1.15 put its file. The network-text check
is the one exception (P6): its census rows are only handed off (5.3).

### 3.1 types A

- [ ] 3.1.1 types A (assignment, narrowing, binary-operators, conversion, unary-operand, comparison, constant-overflow,
      string-constant, pointer-conversion): fixtures for the 0.3 GAP builders (comparison's unfired builders first).
      Where: test/conformance/fixtures/. Acceptance: fixture list written here. Depends on: 2.6
- [ ] 3.1.2 Record 3.1.1, both vendors (one batch each). Where: recordings/. Acceptance: CA.1. Depends on: 3.1.1
- [ ] 3.1.3 FPs: sysop_position_* (CODESYS triage: the sized-STRING seam — niche test), meet_bool_mod_int,
      decl_struct_init_positional, string-constant ×3 (STRING_LENGTH_AS_WRITTEN). Where: checks/types, shared/rules.
      Acceptance: CA. Depends on: 3.1.2
- [ ] 3.1.4 Gaps attributed to these checks (census). Where: checks/types. Acceptance: CA. Depends on: 3.1.2
- [ ] 3.1.5 Close types A. Where: test/analysis/baselines, design.md §5. Acceptance: CA.3–4. Depends on: 3.1.3, 3.1.4

### 3.2 types B

- [ ] 3.2.1 types B (deref, subrange, array-bounds, bit-number, indexing, array-init, struct-init, reference-assign,
      data-recursion, enum-init, typed-literal, unsupported-operator, partial-access, unknown-source): fixtures for GAP
      builders (array-init ×3 first). Where: fixtures/. Acceptance: list here. Depends on: 3.1.5
- [ ] 3.2.2 Record 3.2.1, both vendors. Where: recordings/. Acceptance: CA.1. Depends on: 3.2.1
- [ ] 3.2.3 FPs: cc3_pointer_conversions, cc3_reference_assign (one cell: niche test), decl_nested_aggregate,
      unknown-source ×13 (itf_var_section_inherited, xf_l*_to_* LDATE, decl_array_single_bound_used,
      decl_implicit_enum_in_struct), and the census FPs of unsupported-operator/partial-access. Where: checks/types,
      checks/syntax, shared/hole. Acceptance: CA. Depends on: 3.2.2
- [ ] 3.2.4 Gaps attributed to these checks. Where: checks/types. Acceptance: CA. Depends on: 3.2.2
- [ ] 3.2.5 Close types B. Acceptance: CA.3–4. Depends on: 3.2.3, 3.2.4

### 3.3 declarations A

- [ ] 3.3.1 declarations A (const-context, declared-type, constant-initializer, external-initializer, external-global,
      input-default, bit-usage, output-rules, non-instantiable, obsolete-usage): fixtures for bit-usage (all 4 builders),
      obsolete-usage (now reachable via 2.6), const-context's unfired builders. Where: fixtures/. Acceptance: list here.
      Depends on: 3.2.5
- [ ] 3.3.2 Record 3.3.1, both vendors. Acceptance: CA.1. Depends on: 3.3.1
- [ ] 3.3.3 FPs of the group (census). Where: checks/declarations. Acceptance: CA. Depends on: 3.3.2
- [ ] 3.3.4 Gaps of the group (census). Acceptance: CA. Depends on: 3.3.2
- [ ] 3.3.5 Close declarations A. Acceptance: CA.3–4. Depends on: 3.3.3, 3.3.4

### 3.4 declarations B

- [ ] 3.4.1 declarations B (at-address, header-rules, attribute-placement, var-section-placement, inout-initializer,
      unknown-type, system-initializer, refused-initializer, dynamic-creation, signature-name): fixtures for header-rules'
      unfired builders. Where: fixtures/. Acceptance: list here. Depends on: 3.3.5
- [ ] 3.4.2 Record 3.4.1, both vendors. Acceptance: CA.1. Depends on: 3.4.1
- [ ] 3.4.3 FPs: cc2_var_in_interface, itf_var_section_declaration, sn_dut_mismatch. Where: checks/declarations.
      Acceptance: CA. Depends on: 3.4.2
- [ ] 3.4.4 Gaps of the group. Acceptance: CA. Depends on: 3.4.2
- [ ] 3.4.5 Close declarations B. Acceptance: CA.3–4. Depends on: 3.4.3, 3.4.4

### 3.5 names

- [ ] 3.5.1 names (duplicate-declaration, unresolved-identifier, ambiguous-global, type-as-value, reserved-keyword,
      refused-name, conditional-call): fixtures for ambiguous-global (two GVLs, bare use). Where: fixtures/.
      Acceptance: list here. Depends on: 3.4.5
- [ ] 3.5.2 Record 3.5.1, both vendors. Acceptance: CA.1. Depends on: 3.5.1
- [ ] 3.5.3 FPs: decl_implicit_enum_duplicate, unresolved-identifier ×16 (LDATE family: confirm divergence still holds;
      itf_var_section_inherited), and the census FPs of refused-name/conditional-call. Where: checks/names,
      checks/syntax, shared/resolution. Acceptance: CA. Depends on: 3.5.2
- [ ] 3.5.4 Gaps of the group. Acceptance: CA. Depends on: 3.5.2
- [ ] 3.5.5 Close names. Acceptance: CA.3–4. Depends on: 3.5.3, 3.5.4

### 3.6 oop A

- [ ] 3.6.1 oop A (inheritance, property-access, method-reference, inherited-variable, external-write, inout-access,
      fb-init-inout, fb-init-instantiation): fixtures for unfired builders (0.3). Where: fixtures/. Acceptance: list here.
      Depends on: 3.5.5
- [ ] 3.6.2 Record 3.6.1, both vendors. Acceptance: CA.1. Depends on: 3.6.1
- [ ] 3.6.3 FPs of the group. Where: checks/oop. Acceptance: CA. Depends on: 3.6.2
- [ ] 3.6.4 Gaps of the group. Acceptance: CA. Depends on: 3.6.2
- [ ] 3.6.5 Close oop A. Acceptance: CA.3–4. Depends on: 3.6.3, 3.6.4

### 3.7 oop B

- [ ] 3.7.1 oop B (generic-instantiation, abstract-assign, lifecycle, abstract-instantiation, interface-implementation,
      method-signature, abstract-output-default): fixtures for method-signature (base and interface mismatch) and
      generic-instantiation on TwinCAT. Where: fixtures/. Acceptance: list here. Depends on: 3.6.5
- [ ] 3.7.2 Record 3.7.1, both vendors. Acceptance: CA.1. Depends on: 3.7.1
- [ ] 3.7.3 FPs of the group. Where: checks/oop. Acceptance: CA. Depends on: 3.7.2
- [ ] 3.7.4 Gaps of the group. Acceptance: CA. Depends on: 3.7.2
- [ ] 3.7.5 Close oop B. Acceptance: CA.3–4. Depends on: 3.7.3, 3.7.4

### 3.8 calls

- [ ] 3.8.1 calls (call-arguments, call-result-access, fb-instantiation, intrinsic-operands, non-callable-call,
      recursive-call): fixtures for unfired builders of call-arguments and intrinsic-operands. Where: fixtures/.
      Acceptance: list here. Depends on: 3.7.5
- [ ] 3.8.2 Record 3.8.1, both vendors. Acceptance: CA.1. Depends on: 3.8.1
- [ ] 3.8.3 FPs: lex_vector_twincat_return_type (confirm divergence) and the census list. Where: checks/calls.
      Acceptance: CA. Depends on: 3.8.2
- [ ] 3.8.4 Gaps of the group. Acceptance: CA. Depends on: 3.8.2
- [ ] 3.8.5 Close calls. Acceptance: CA.3–4. Depends on: 3.8.3, 3.8.4

### 3.9 flow

- [ ] 3.9.1 flow (case-labels, statement-rules, new-in-expression, jump-labels, no-op-statement, empty-block, loop-exit,
      this-super-context): fixtures for case-labels' 5 unfired builders and jump-labels' 2. Where: fixtures/.
      Acceptance: list here. Depends on: 3.8.5
- [ ] 3.9.2 Record 3.9.1, both vendors. Acceptance: CA.1. Depends on: 3.9.1
- [ ] 3.9.3 FPs: lit_time_fraction_ms, cc6_loop_cannot_exit, cc5_new_in_expression (still unmeasurable on CODESYS:
      keep the divergence). Where: checks/flow. Acceptance: CA. Depends on: 3.9.2
- [ ] 3.9.4 Gaps of the group. Acceptance: CA. Depends on: 3.9.2
- [ ] 3.9.5 Close flow. Acceptance: CA.3–4. Depends on: 3.9.3, 3.9.4

### 3.10 pragmas + parse errors

- [ ] 3.10.1 pragmas + parse-errors (pragmas, parse-errors; the 1.15 candidates are reviewed in their named groups, not
      here): fixtures for the pragma builders unfired on TwinCAT (27 CODESYS vs 5 TwinCAT fixtures). Where: fixtures/.
      Acceptance: list here. Depends on: 3.9.5
- [ ] 3.10.2 Record 3.10.1, both vendors. Acceptance: CA.1. Depends on: 3.10.1
- [ ] 3.10.3 FPs: parse-errors on the archived front-end (re-measured; parser-owned ones: a divergence naming the
      frontend rule, or fixed in parse/errors if cheap). Where: checks/syntax, checks/pragmas. Acceptance: CA. Depends on: 3.10.2
- [ ] 3.10.4 Gaps of the group. Acceptance: CA. Depends on: 3.10.2
- [ ] 3.10.5 Close pragmas + parse errors. Acceptance: CA.3–4. Depends on: 3.10.3, 3.10.4

### 3.11 Unowned gaps

- [ ] 3.11 Unowned gaps (0.2's missing-rule class): each shape gets a new check in its group home (fixture + recording +
      src test), or `niche: accepted loss (N)`, or is reclassified project-config (a divergence category). The
      unowned-GAP ceiling is lowered.
      Where: checks/<group>, fixtures/, divergences.ts. Acceptance: CA; the classification table written here. Depends on: 3.10.5

## 4. Downstream

### 4 Downstream

- [ ] 4.1 services and server suites (hover, completion, semantic tokens, references/rename over both languages,
      push/pull diagnostics parity): every change is recording-decided (noted) or a regression (fixed).
      Where: src/services, src/server. Acceptance: suites green; changes listed here. Depends on: 3.11
- [ ] 4.2 Corpus (`test/corpus/corpus.test.ts`: LSP errors ⊆ recorded build, warnings, duplicate ranges) and the corpus
      census: FP per project only fell. Where: test/corpus, test/analysis. Acceptance: numbers before → after here.
      Depends on: 4.1
- [ ] 4.3 Transpile suites and the conformance run rows unchanged: analysis feeds no lowering, so any change is a
      regression. Where: src/transpile, test/conformance, test/exec. Acceptance: `bun scripts/suite-snapshot.ts --compare`
      identical on every title under the fixtures.test.ts describes `confirmed —`, `not-lowered —`, `diverges —` and
      `unaskable —` and every test/exec title (the `refused —` and `lsp-gap —` describes read LSP diagnostics: their
      changes are listed here and recording-decided); `bun test src/transpile` pass/fail counts identical. Depends on: 4.1
- [ ] 4.4 The `computeSemanticDiagnostics` alias deleted; dead exports gone (`scripts/dead-exports.ts` clean for
      src/analysis); the catalog (`verify-catalog`, `catalog-status`) and `coverage-doc` regenerated where wording changed.
      Where: src/analysis, scripts/, docs/codesys-reference/. Acceptance: A on the alias removal; dead-exports clean.
      Depends on: 4.2, 4.3

## 5. Close

### 5 Close

- [ ] 5.1 Cold full suite once: `VOLT_RUSTC_CACHE=0 bun test` in packages/volt-lsp-iec, and `bun run check` at the root.
      Where: —. Acceptance: green; durations written here. Depends on: 4.4
- [ ] 5.2 Docs: architecture.md D (pipeline/, shared/, checks/ groups, the one pipeline, rules A1–A6) (network text's
      integration unchanged and marked as parked for the LD/FBD change); data-model.md "analysis"
      (the stale DiagnosticConfig flag list replaced by the real config, CheckContext, registry entry); TESTING.md and
      test/README.md (the census, beyond 0.1's listing); scripts/README.md.
      Where: docs/, TESTING.md, test/README.md, scripts/README.md. Acceptance: every path named exists. Depends on: 5.1
- [ ] 5.3 Hand-off notes: to the LD/FBD coverage change (the whole parked network seam of design.md §3 — one
      network-text interface, routing, one pipeline for network findings, the parse memo — plus the duplicate jump-label rule, NETWORK_* code spelling,
      Cnnnn entries for network codes, the `NetworkTextAnalysis.vg` field name, the network check's own conformance with
      its census rows) and to lsp-package-structure (network-text/, what is left of network/, and analysis/checks/network/
      final homes, test/analysis's root, the baseline.ts directory).
      Where: openspec/changes/{lsp-package-structure,<the LD/FBD change if it exists>}/proposal.md or a hand-off section
      in their tasks.md. Acceptance: each item named once, with its file. Depends on: 5.2
- [ ] 5.4 Spec delta: specs/analysis-conformance/spec.md gains the requirements of what was BUILT — one pipeline and the
      registry's order contract (P1, P3), the layering rules A1–A6 — each with a scenario; anything the work measured and rejected is not asserted.
      Where: openspec/changes/analysis-conformance/specs/analysis-conformance/spec.md. Acceptance: `npx --yes openspec
      validate analysis-conformance` passes. Depends on: 5.3
- [ ] 5.5 Final review (spec + layering: A1–A6 allow-list empty or each remaining entry justified); fix;
      `openspec archive analysis-conformance`; delete the recreated openspec/specs/.
      Where: openspec/. Acceptance: archived; `openspec list` no longer shows it. Depends on: 5.4

## Hand-in (2026-10-04, from the CI fix c4f4b66e02)

- [ ] H.1 Record a CODESYS fixture for a namespace declared by TWO referenced libraries (e.g. CAA Callback placeholder +
      CAA Callback Extern, both `CB`; SysTime twice): which library's members does `CB.X` / a bare member reach? The CI
      fix made a shared namespace cover every declaring library (consistent with `linkExtends`, backed by the clean
      corpus builds) — the recording is the oracle; adjust the binder if CODESYS answers otherwise. Add the rule row
      to test/frontend/rules.ts.
