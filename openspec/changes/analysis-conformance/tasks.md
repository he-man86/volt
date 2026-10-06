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

- [x] 1.1 Snapshot A: the `fixture-diagnostics` aspect in frontend-snapshot (per fixture × vendor, conformance composition,
      network text ON).
      Where: scripts/frontend-snapshot.ts. Acceptance: `check` on an unchanged tree is identical; a deliberately changed
      message is reported, then reverted. Depends on: 0.1
      **Done 2026-10-06** (step 1a). `scripts/frontend-snapshot.ts` gains the `fixture-diagnostics` aspect (every
      `DiagnosticItem` of the replay's composition — own item, PLC_PRG, lists, each with its uri, then the network-text pass
      over the own item — per fixture × vendor, network text as `--graphical` says, default ON) and `--aspects a,b`, which
      computes only the named aspects and caches apart (`<sha>-g1-a<aspects>`). Snapshot A on the unchanged tree: identical,
      39,188 aspects (base 162 s cold, working tree ~130 s). A deliberate change (`cannotConvert` "Cannot KONVERT type")
      was reported — 1,468 aspects over 1,468 sources — and reverted.
- [x] 1.2 Layering rules A1–A6 (design.md §2, A3's test exception, A6 in both directions, dynamic `import()` counted) in
      check-layering, with an allow-list of today's violations measured by the rule itself (the six deep importers of
      design.md §4, incremental-index.test, obsolete-usage.test, the two untested checks, the two subject-less tests,
      network's deep imports).
      Where: scripts/check-layering.ts, test/frontend/layering.test.ts. Acceptance: G (allow-list = the measured list,
      printed here); A. Depends on: 1.1
      **Done 2026-10-06** (step 1a). `scripts/check-layering.ts` `analysisViolations` (A1–A6, tests included, a dynamic
      `import()` counted) with `KNOWN_ANALYSIS_VIOLATIONS`; one planted-violation test per rule in
      `test/frontend/layering.test.ts`. The allow-list as the rule measured it — **16 entries**: A2 ×10
      (network-analysis → expr-echo, hole; server/diagnostics → error-code-map; catalog.test → error-code-map (dynamic);
      evidence.ts → config; bound-census → expr-echo, hole, checks/types/struct-init; coverage-doc → config;
      probe-projectsettings-effect → config), A5 ×1 (incremental-index.test → server/workspace-store), A6 ×5
      (abstract-instantiation.ts, external-write.ts untested; implicit-conversion.test, negation-sign-change.test,
      initializer-names.test subject-less). A1, A3, A4: 0. Differences from design.md §4's list: obsolete-usage.test has no
      upward import any more (frontend-conformance removed it), and three were measured that the list lacked (evidence.ts
      → config, bound-census → struct-init, initializer-names.test). A3 names `pipeline/registry` / `pipeline/diagnostics`;
      before 1.6 the checks imported `CheckContext` from the old `analysis/diagnostics.ts`, which the rule does not name.
      Snapshot A (`check --base HEAD --aspects diagnostics,fixture-diagnostics`): identical, 39,188 aspects.
- [x] 1.3 analysis/index.ts becomes an explicit export list; every measured deep importer goes through it:
      src/network/network-analysis.ts (expr-echo, hole), src/server/diagnostics.ts (error-code-map),
      test/frontend/bound-census.ts (expr-echo, hole), test/catalog/catalog.test.ts (error-code-map, dynamic import),
      scripts/coverage-doc.ts and scripts/probe-projectsettings-effect.ts (config); error-code-map, expr-echo and hole
      are exported.
      Where: src/analysis/index.ts + those files. Acceptance: A; G (every A2 entry removed). Depends on: 1.2
      **Done 2026-10-06** (step 1a). `analysis/index.ts` is an explicit export list (no `export *`); every measured
      outside importer goes through it (`isStructInit`/`structEcho` exported for bound-census, `AnalysisInitOptions` for
      evidence). The package barrel no longer re-exports analysis internals no consumer used (`compilerArrayText`,
      `CONFIGURABLE_CHECKS`, `configurableCodeFor`, …; `@volt/lsp-iec` is imported by no other package's TS). G: the 10
      A2 entries removed. Snapshot A (`check --base HEAD --aspects diagnostics,fixture-diagnostics`): identical, 39,188 aspects.
- [x] 1.4 reachability.ts (+ test) → server/reachability.ts; incremental-index.test.ts → server/; reachability leaves the
      analysis index; scripts/corpus-fp imports from server.
      Where: src/analysis → src/server. Acceptance: A; G (A5 entry removed). Depends on: 1.3
      **Done 2026-10-06** (step 1a). `reachability.ts` (+ test) and `incremental-index.test.ts` → `src/server/`;
      reachability left the analysis index; the server, dead-code-equivalence, dead-code-cache.test and
      `scripts/corpus-fp.ts` import `server/reachability`. G: the A5 entry removed. Snapshot A (`check --base HEAD --aspects diagnostics,fixture-diagnostics`): identical, 39,188 aspects.
- [x] 1.5 obsolete-usage.test's upward import (workspace-refs) replaced by a WorkspaceRefs literal built in the test.
      Where: src/analysis/checks/declarations/obsolete-usage.test.ts. Acceptance: A; G (A5 entry removed). Depends on: 1.2
      **Nothing to do (measured 2026-10-06, step 1a)**: `obsolete-usage.test.ts` no longer imports `workspace-refs`
      (frontend-conformance 2.7.2 read the attribute from the AST), so the rule measured no A5 entry for it.

### 1b Pipeline and shared

- [x] 1.6 pipeline/: context.ts (CheckContext, Check), registry.ts (CHECKS), policy.ts (severity forcing, dedupePerLine),
      diagnostics.ts (computeDiagnostics with the optional `groups` restriction; computeSemanticDiagnostics kept as an
      alias until 4.4).
      Where: src/analysis/pipeline/. Acceptance: A; the registry's order byte-identical (a test lists it); `groups`
      unset = every check (a test). Depends on: 1.3
      **Done 2026-10-06** (step 1b). `pipeline/{context,registry,policy,diagnostics}.ts`; `analysis/diagnostics.ts`
      deleted; the 79 checks import `CheckContext` from `pipeline/context`. `computeDiagnostics({ …, groups? })`;
      `computeSemanticDiagnostics` is its alias; `runRegistry(ctx, onCheck?, groups?)` and `CHECK_REGISTRY` unchanged for
      the census. `pipeline/registry.test.ts`: the run order (79 names) is a listed contract; `groups` unset = every check,
      a list = only those groups'. Snapshot A (`check --base HEAD --aspects diagnostics,fixture-diagnostics`): identical, 39,188 aspects.
- [x] 1.7 The registry becomes data: `{ check, group, vendors, reads?, note }`, group comments corrected (signature-name
      out of the syntax block); the CODESYS_ONLY and TWINCAT_ONLY sets fold into `vendors`; generic-instantiation and
      system-initializer get a note naming their rule gate. A test asserts every producer of a `reads` code runs before
      its reader (unknown-source now).
      Where: pipeline/registry.ts, pipeline/registry.test.ts. Acceptance: A. Depends on: 1.6
      **Done 2026-10-06** (step 1b). `REGISTRY: { check, group, vendors, reads?, note? }[]`; CODESYS_ONLY / TWINCAT_ONLY folded
      into `vendors` (7 CODESYS-only entries, each with its measured note; 0 TwinCAT-only); signature-name's group is
      `declarations`; generic-instantiation and typed-literal carry a `rule gate:` note (system-initializer is gone —
      frontend-conformance). `unknown-source` `reads` hole's 12 evidence codes (`HOLE_EVIDENCE_CODES`, exported from
      `shared/hole`); the test asserts every registry producer of each runs before it — the two network codes are produced
      by the network pass only (after the registry, its own `out`). Snapshot A (`check --base HEAD --aspects diagnostics,fixture-diagnostics`): identical, 39,188 aspects.
- [x] 1.8 shared/: rules, resolution, hole, expr-echo, body-context, diagnostic-item, lost-declaration move under it;
      imports updated.
      Where: src/analysis/shared/. Acceptance: A; G (A3/A4 hold). Depends on: 1.6
      **Done 2026-10-06** (step 1b). `shared/`: rules, resolution, hole, expr-echo, body-context, diagnostic-item, and
      `compiled` (+ test) — not in design.md §2's list, but used by two checks (interface-implementation, method-signature),
      so P2 puts it here. `lost-declaration.ts` was already deleted. Every import rewritten (92 files). G: A3/A4 hold.
      Snapshot A (`check --base HEAD --aspects diagnostics,fixture-diagnostics`): identical, 39,188 aspects.
- [x] 1.9 shared/diagnostic-item `emit()` replaces every local push() helper (measured 2026-10-01: four —
      intrinsic-operands, bit-usage, const-context, array-init; re-grep at the task, the frontend run edits const-context).
      Where: those checks. Acceptance: A; `grep -rn "function push(" src/analysis` empty. Depends on: 1.8
      **Done 2026-10-06** (step 1b). `shared/diagnostic-item` `emit(out, span, code, message, severity = "error")` replaces
      the four local `push()` helpers (intrinsic-operands, bit-usage, const-context, array-init — re-grepped, still four).
      `grep -rn "function push(" src/analysis`: empty. (Local `const push = …` closures over a check's own state —
      declared-type, case-labels, jump-labels, conditional-call, comparison, unknown-source — stay.) Snapshot A (`check --base HEAD --aspects diagnostics,fixture-diagnostics`): identical, 39,188 aspects.
- [x] 1.10 The registry entry ↔ file half of A6: every entry's `group` matches its file's folder; a test fails otherwise.
      Where: pipeline/registry.test.ts. Acceptance: A; G. Depends on: 1.7, 1.8
      **Done 2026-10-06** (step 1b). `pipeline/registry.test.ts`: every entry's function is defined in exactly one file,
      under `checks/<its group>/`. G passes. Snapshot A (`check --base HEAD --aspects diagnostics,fixture-diagnostics`): identical, 39,188 aspects.

### 1c Messages, files and tests

- [x] 1.11 messages.ts: fbInitNoOutput and enumInitNotConvertible deleted (callers use noInput / cannotConvert); the two
      inline templates of parse-errors.ts become named builders in messages.ts, and struct-init's STRUCT echo moves to
      shared/expr-echo; the misattached JSDoc of the three network builders fixed; sections ordered by group.
      Where: messages.ts, checks/syntax/parse-errors.ts, checks/types/struct-init.ts. Acceptance: A. Depends on: 1.8
      **Done 2026-10-06** (step 1c). Deleted `fbInitNoOutput` (→ `noInput`), `enumInitNotConvertible` (→
      `cannotConvert`) and the dead `semicolonExpectedInsteadOf` (no caller, 0.3). New builders
      `parameterSectionNotAllowed`, `variableDeclarationExpectedInsteadOf` (parse-errors' two inline templates; the echo
      text stays in parse-errors); `structEcho` → `shared/expr-echo`; the JSDoc of `undefinedIdentifier`,
      `unresolvedAssignTarget`, `unresolvedOperandToken` reattached; interface and implementation ordered shared → types →
      declarations → names → oop → calls → flow → pragmas → syntax → network (a builder's section = the group of every
      check that calls it, `census.ts` `builderOwners`). Snapshot A (`check --base HEAD --aspects diagnostics,fixture-diagnostics`): identical, 39,188 aspects. Census (attribution only, no diagnostic changed): TP/FP/GAP
      totals unchanged; never-fired builders 18 → 17 / 41 → 40; TwinCAT unowned GAP 115 → 104 and group syntax GAP 70 → 81 —
      the same eleven recorded "Variable declaration expected instead of …" messages now owned by the new builder. That
      group ceiling would rise, so it is held by eleven named exceptions (`test/frontend/baseline.ts` SECTION_ECHO_ROWS,
      each fixture already a TwinCAT divergence), not by raising the file; baselines rewritten with
      `VOLT_WRITE_BASELINE=1`.
      **Review (gate 1a+1c, 2026-10-06):** the exceptions gave the wrong cause and pointed the fix at parse-errors. Their
      `why`/`task` now cite `TWINCAT_DRIVER_CUTS_THE_ECHO` (divergences.ts): the TwinCAT RECORDING is cut at the message's
      first line break — a bridge bug, fixed by the driver and a re-record, never by the LSP matching the cut text; each
      exception goes when its fixture is re-recorded. `decl_var_external_inside_struct`, recorded cut the same way but
      named only under `EXTERNAL_LOOKUP_IN_A_REFUSED_SECTION`, joins `TWINCAT_DRIVER_CUTS_THE_ECHO` (a set it was already
      in through the other list: no verdict changes).
- [x] 1.12 oop/inout-external-access + oop/inout-own-access → oop/inout-access.ts (both functions, registry slots unchanged).
      Where: checks/oop/. Acceptance: A. Depends on: 1.7
      **Done 2026-10-06** (step 1c). `oop/inout-access.ts` holds both functions (registry slots unchanged, adjacent);
      `inout-access.test.ts` holds both former test files, each in its own `describe`. Snapshot A (`check --base HEAD --aspects diagnostics,fixture-diagnostics`): identical, 39,188 aspects.
- [x] 1.13 CheckContext.uri required: every computeSemanticDiagnostics/computeDiagnostics call site passes a uri
      (tests: `uriFor`), mechanically (call-site count measured and written here; the ~92 is a grep estimate).
      Where: pipeline/context.ts + call sites (src, test, scripts). Acceptance: A; typecheck. Depends on: 1.6
      **Done 2026-10-06** (step 1c). `CheckContext.uri` and `DiagnosticsArgs.uri` required. Call sites measured by the
      compiler: **228** without a uri (of 230 pipeline calls, 93 files) — 204 analysis tests given `uriFor(parseResult)`
      mechanically, 21 by hand (the file the test or harness bound: `files[i].uri`, `own.uri`, `f.uri`, …), 3
      `CheckContext` literals (census ×2, registry.test). Output-neutral by construction: the asker's uri decides only
      through its `Library Manager/` folder (`symbols/precedence`), and no inserted uri is a library's. Snapshot A (`check --base HEAD --aspects diagnostics,fixture-diagnostics`): identical, 39,188 aspects;
      suite-snapshot identical.
- [x] 1.14 Tests: conversion-name.test.ts merges into checks/types/conversion.test.ts; implicit-conversion.test.ts and
      negation-sign-change.test.ts merge into checks/types/narrowing.test.ts; analysis.test.ts → pipeline/diagnostics.test.ts;
      colocated tests for abstract-instantiation and external-write (from their existing fixtures' sources).
      Where: src/analysis. Acceptance: A; G (A6 entries in both directions removed); test count not lower. Depends on: 1.2, 1.6
      **Done 2026-10-06** (step 1c). conversion-name.test → `checks/types/conversion.test.ts`; implicit-conversion.test and
      negation-sign-change.test → `checks/types/narrowing.test.ts`; analysis.test → `pipeline/diagnostics.test.ts`;
      initializer-names.test (measured at 1.2) → `checks/declarations/refused-initializer.test.ts` — each merged file's tests
      in a `describe` of their own, none dropped (50 → 50 across the merged files). New: `oop/abstract-instantiation.test.ts`
      (`oop_abstract_instantiated`, both vendors' wording, 3 tests) and `oop/external-write.test.ts` (`hide_var`, 2 tests).
      G: `KNOWN_ANALYSIS_VIOLATIONS` is empty. Snapshot A (`check --base HEAD --aspects diagnostics,fixture-diagnostics`): identical, 39,188 aspects.
      **Review (gate 1a+1c, 2026-10-06):** two of the new tests asserted what no recording covers, and were removed:
      external-write's added `VAR_INPUT iIn` (the `hide_var` FB has none) with its "input written / internal member read
      is no finding" test, and abstract-instantiation's "one finding per declared name" (no fixture declares two abstract
      instances). The POINTER TO test now cites `unit_method_abstract_final` / `unit_fb_abstract_final` (an ABSTRACT FB
      reached by pointer, no "cannot be instantiated" on either vendor) and asserts both vendors. New tests: 3 (2 + 1).
      **Review, 1.6's `groups`:** a subset that holds a check with `reads` (unknown-source, group types) but leaves out
      any group is now refused by name (`runRegistry`): run without its producers it dropped the types finding CODESYS
      reports (`groups: ["types"]` returned [] where the full run gives unknown-source). Test first in
      `pipeline/registry.test.ts`; a list of every group equals the unset run. 2.5's `["syntax"]` holds no reader.
- [x] 1.15 checks/syntax/ receives the candidates 0.5's parser-cascade test moved; the registry group of each is updated.
      Candidates that stay are untouched. Skipped with a note if 0.5 moved none.
      Where: checks/syntax/. Acceptance: A; G. Depends on: 0.5, 1.10
      **Skipped (0.5):** the parser-cascade test moved none of the candidates — four are gone (frontend-conformance), three stay
      in their group (design.md §2 "0.5 measured").

**Gate 1a+1b+1c (2026-10-06):** typecheck, `bun run lint` (A1–A6, allow-list empty) and `bun run check` pass; the full
suite (`VOLT_REQUIRE_FULL=1 bun test`, no VOLT_FIXTURES, rustc cache on): **8128 pass, 34 skip, 381 todo, 0 fail** over
8543 tests in 205 files (507 s). No fixture or transpiler file changed, so the map was not regenerated. ONE commit for the
three steps, not one per step: their edits share files throughout (1.8 rewrote every check's imports after 1.6 had,
1.13 rewrote the call sites 1.3/1.4 had moved, in scripts and tests alike), and the working tree holds only the end state —
a per-step split would be commits that were never built or measured.

## 2. Parse-error and composition seams (design.md §3 is PARKED)

Owner, 2026-10-01: network text's language will still change, so NOTHING of it moves or is rewired here — no
network-text/index.ts, no routing rewrite, no rename, no move of network-analysis/network-analyze, no parse memo (the
former 2.1–2.4 and 2.7). src/network and src/network-text stay exactly where and as they are; their integration is
handed to the LD/FBD coverage change (5.3). Only the two seams below, which are not network work, stay.

- [x] 2.5 Server merge: the raw parseResult.errors stream is dropped (the duplicate C0002/no-code pair); one quiet() for all
      items; `syntax-error` exempt from the dead-member suppression; a dead POU runs `computeDiagnostics({ groups:
      ["syntax"] })` (parse errors still ride, cost as today); documentDiagnostics' `messages` parameter removed (callers
      server.ts, bench.test.ts, diagnostics.test.ts); parseErrorMessage and vendorReportsParseError leave the index if
      now unused.
      Where: src/server/diagnostics.ts (+ tests: one parse error → one diagnostic; a parse error in a dead POU and in a
      dead member still shown). Acceptance: N (only the codeless duplicates vanish on the corpora; 0.4's unpartnered
      errors fixed first). The network diagnostics call stays as it is (parked). Depends on: 1.7, 0.4
      **Done 2026-10-06.** `documentDiagnostics(store, d)`: the raw `parseResult.errors` stream is gone (0.4: 0 unpartnered
      errors, nothing to fix first); one `quiet()` over the pipeline's and the network pass's items; a dead POU runs
      `computeDiagnostics({ groups: ["syntax"] })`; the `messages` parameter is gone (callers server.ts, bench.test.ts,
      diagnostics.test.ts, workspace-refs.test.ts, scripts/probe-projectsettings-effect.ts, test/corpus/support/diagnostics.ts;
      the network call asks `messagesFor(store.config.vendor)`). **Deviation (design.md §3 "As built"):** the dead-member
      exemption is every parse-error code (`PARSE_ERROR_CODES`, exported from `checks/syntax/parse-errors.ts`), not
      `syntax-error` alone — the raw stream also carried the conditional-pragma / `hasattribute` codes in a dead member.
      `parseErrorMessage` / `vendorReportsParseError` stay in the index (read by `test/frontend/dumps.ts`). The census's
      `server:parse-raw` key and `projectDocuments`' `parseErrors` field went with the stream (a codeless parse error is
      now refused by name, `diagnostic-census.test.ts`). Tests first, in `src/server/diagnostics.test.ts` (3, each with a
      `diagnoseDeadCode` control): one parse error → one diagnostic (C0002); a dead POU keeps its declaration and
      statement parse errors and loses its C0032; a dead member the same. Before: `[C0002, —]` (twice), the dead POU
      `[—]` only, the dead member `[—]` only (its statement parse error quieted).
      N (snapshot A, `check --base HEAD --aspects diagnostics,fixture-diagnostics`): **identical**, 39,188 aspects — the
      corpora carry no parse error (0.4), so no codeless duplicate and no dead-code parse error existed to change; the
      fixture composition does not run the server. Changed classes: none measurable on the corpora; on a parse error in
      a source: the codeless copy (−1 per top-level parse error), statement parse errors now shown in dead POUs/members.
      **Corrected at gate 2 (recorded, see "Gate 2" below):** a dead POU shows NOTHING, parse errors included (`dead ? []`
      again); the dead-member exemption stays. The dead-POU half of the test above was the design's answer, not an oracle's.
- [x] 2.6 One composition: fixtures.test runLsp, support/evidence diagnosed (no re-added parse errors; the network call stays as it is),
      scripts/agreement-residue, audit-check, corpus-fp and verify-catalog call computeDiagnostics only; the conformance
      composition passes WorkspaceRefs computed from the fixture sources (so obsolete-usage can fire).
      Where: test/conformance/{fixtures.test.ts,support/evidence.ts}, scripts/. Acceptance: N (evidence's double count
      gone; ratings recomputed by rate:fixtures, changes listed). Depends on: 2.5
      **Done 2026-10-06.** One composition, `test/conformance/support/replay.ts` `replayDiagnostics` (`computeDiagnostics`
      over own item, PLC_PRG, lists; then the network call, unchanged): `fixtures.test.ts` `runLsp` and
      `scripts/agreement-residue.ts` ask it — the residue no longer builds its own `.st`-parsed project (0.4's two
      differing fixtures) and no longer skips the empty-source PLC_PRG fixtures. `evidence.ts`: `diagnosed` drops the
      re-added raw `parseResult.errors` (≈481 CODESYS / 602 TwinCAT raw top-level errors over the fixtures' own items,
      each counted twice before), `diagnosed` and `lspMessagesOn` call `computeDiagnostics`. `audit-check.ts`,
      `verify-catalog.ts` call `computeDiagnostics`; `corpus-fp.ts` asks the server's `projectDocuments` (each project as
      its own vendor, its settings, network text, the server's suppression) instead of re-implementing the suppression on
      a CODESYS-only analysis (it now lists twincat-project14's 216 missing-language findings, 0.2's known shape).
      **WorkspaceRefs:** nothing to pass — the premise is stale. obsolete-usage reads the POU's `obsolete` attribute from
      the AST since frontend-conformance 2.7.2 (not `WorkspaceRefs`) and already fires on 7 CODESYS fixtures (0.3); the
      replay's project already binds the refs `WorkspaceRefs` holds (`PROJECT_MANIFESTS`, `projectDevices`,
      `RECORDING_ENVIRONMENT`'s target). design.md §5's row says so.
      N: `rate:fixtures` — **0 rating changes** (map.generated.ts byte-identical: confirmed 2725, refused 1788,
      not-lowered 337, lsp-gap 74, diverges 5, unaskable 80); snapshot A identical (the snapshot's fixture aspect already
      composed as `replayDiagnostics` does); no known divergence started agreeing (test/conformance 5982 pass / 0 fail);
      `resolution-dump` messages unchanged (it compares resolution messages, which no parse error carries).

**Gate 2 (2026-10-06).** Three review findings, each settled before the gate:
- *Parse errors in dead code had no oracle* (medium) — **fixed, recorded.** Four fixtures,
  `test/conformance/fixtures/grammar/dead-code.ts`, one recorder batch per vendor (CODESYS SP21 and TwinCAT Project13,
  own `-Instance analysis-conformance` IDEs): an FB nothing instantiates builds CLEAN on both with a statement parse error
  (`dead_fb_missing_then`) and with a declaration parse error (`dead_fb_declaration_parse_error`); a method nothing calls
  in a live FB reports its statement parse error on both (`dead_method_missing_then`, as `sig_empty_type` already did for
  a declaration). So `documentDiagnostics` gives a dead POU nothing (it had run `groups: ["syntax"]`; HEAD before 2.5 also
  showed its top-level parse errors — both wrong), keeps parse errors in a dead member; test first
  (`src/server/diagnostics.test.ts` "a dead POU shows nothing…": red `[C0002, 4], [C0002, 11]` → green `[]`).
  behavior.md's dead-code requirement now states both recorded facts; design.md §3 "Recorded". The two dead-FB fixtures
  are a known divergence of the replay (`DEAD_POU_NOT_IN_THE_REPLAY`: it has no reachability) and carry named ceiling
  exceptions in the census (`test/frontend/baseline.ts`).
- *The dead-member exemption is keyed by code, so the pragmas check's out-of-body C0051 passes too* (low) — **skipped,
  the recording says it is right:** an unquoted `hasattribute` operand in the declaration of a method nothing calls is
  reported by CODESYS exactly as in a live one (`dead_method_hasattribute_unquoted` = `prag_hasattribute_unquoted_in_declaration`:
  C0051 + "not supported in declaration part"); TwinCAT is silent in both. Keying on origin would have quieted a C0051
  CODESYS shows. The new fixture joins `PRAGMA_DIVERGENCES` (the same niche accepted loss, 0 `hasattribute` in the corpora).
- *behavior.md misstated the parse-error codes* (low) — **fixed:** C0002, C0081 (orphan directive), C0051, and the
  unterminated conditional pragma as its slug (`KNOWN_UNMAPPED`).
Numbers: `rate:fixtures` — +4 fixtures: refused 1788 → 1790 (`dead_method_*`), unaskable 80 → 82 (`dead_fb_*`, execSkip:
nothing instantiates them), no existing rating changed. Census baselines rewritten for the new fixtures only (codesys:
TP 5229 → 5231, FP 108 → 110 (2 div), GAP 459 → 460; twincat: TP 6445 → 6446, FP 335 → 338 (3 div); ceilings unchanged,
the rises held by named exceptions); frontend baselines: counts of the four new fixtures only. Typecheck and `bun run lint`
clean; full suite (`VOLT_REQUIRE_FULL=1 bun test`, no VOLT_FIXTURES, rustc cache on): **8131 pass, 34 skip, 381 todo,
0 fail** over 8546 tests in 205 files (469 s).

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

- [x] 3.1.1 types A (assignment, narrowing, binary-operators, conversion, unary-operand, comparison, constant-overflow,
      string-constant, pointer-conversion): fixtures for the 0.3 GAP builders (comparison's unfired builders first).
      Where: test/conformance/fixtures/. Acceptance: fixture list written here. Depends on: 2.6
      **Fixtures (2026-10-06), 47:** `operators/comparison-operands.ts` (27, `cmpop_*`): the comparison check rule by rule —
      two arrays of one type (=, <, <>, itself, two dimensions, of a struct, bounded by a VAR CONSTANT), of two types (bounds,
      element), an array against a scalar either side; a pointer against DINT, LINT, SINT, BYTE, UINT, UDINT and an INT on
      the left; STRING/WSTRING, TIME/INT, BOOL/INT, DATE/TIME, REAL/STRING; an enum variable against another enum's value; a
      struct against itself and an INT; two FB instances. `memory/pointer-into-scalar.ts` (10, `ptrsc_*`): a pointer stored
      into DINT, LINT, LREAL, REAL, SINT, WORD + BYTE, BOOL, TIME, another pointer, and as a DWORD's initial value.
      `types/literal-into-composite.ts` (10, `litc_*`, asked for 3.1.3's `decl_struct_init_positional`): 0, 1, 2 and (1) into
      a struct as an initial value and by a statement, 1 and 2 into an array.
- [x] 3.1.2 Record 3.1.1, both vendors (one batch each). Where: recordings/. Acceptance: CA.1. Depends on: 3.1.1
      **Recorded 2026-10-06** (`record:language`, instance `analysis-conformance`): CODESYS one batch of 30, TwinCAT one of 31,
      then the cells the answers asked for in one batch per vendor (three fixtures re-asked with `s`/`r`/`by` renamed —
      IL operators and a keyword, which cascaded; three more pointer widths; `ptrsc_into_real32`/`_sint`/`_word`; the ten
      `litc_*`). `record:exec` CODESYS for the ten that build (unasked 0). Both vendors agree on every comparison cell; they
      differ on one store: a pointer into a REAL or an LREAL is SILENT on CODESYS and refused on TwinCAT.
- [x] 3.1.3 FPs: sysop_position_* (CODESYS triage: the sized-STRING seam — niche test), meet_bool_mod_int,
      decl_struct_init_positional, string-constant ×3 (STRING_LENGTH_AS_WRITTEN). Where: checks/types, shared/rules.
      Acceptance: CA. Depends on: 3.1.2
      **Done 2026-10-06.** `meet_bool_mod_int`: agrees on both vendors (re-measured; the triage note is corrected).
      `sysop_position_*`: niche: accepted loss (0 occurrences of `__POSITION` in the corpora) — the divergence
      `CODESYS_POSITION_IN_AN_INITIALIZER` already said so; re-counted. `decl_struct_init_positional`: FIXED — an untyped 0
      or 1 stored into a STRUCT, an FB or an ARRAY is BIT, 2 is SINT, in an initial value and in a statement (`litc_*`,
      both vendors); `types/literal` `literalErrorType` + `checks/types/assignment` (`compositeLiteralInto`, ARRAY added,
      the statement form added); `LITERAL_ONE_IS_BIT` closed (`decl_struct_init_positional`, `decl_array_init_positional`),
      and `decl_array_of_array_comma_index` left `AFTER_A_REFUSED_TYPE` on both vendors. string-constant ×3:
      `ir_initializer_warning_no_instance` stays `DEAD_POU_NOT_IN_THE_REPLAY` (reachability, not the check);
      `decl_string_length_expression` niche: accepted loss (0 occurrences in the corpora: no string length is written as
      an operation; the compiler's form is `shared/expr-echo`'s, which the front-end's type render may not import).
      FOUND and fixed (pointer-conversion, the census's 19 SEV per vendor): the C0033 model was FALSE. Both recording
      projects' settings were read over the bridge — neither raises a warning to an error — and C0033's own wording appears
      in no recording: a pointer refused by its target is the ordinary conversion ERROR (C0032). `pointer-conversion` now
      emits `assignment-type-mismatch` errors by `types/compat` `pointerIntoElementary` (signed LINT a change of sign,
      REAL/LREAL silent on CODESYS and refused on TwinCAT, every other non-integer refused) and checks initial values;
      `pointer-not-convertible` left `CONFIGURABLE_CHECKS`, the code map, the catalog (C0033 → ide-only, with the reason)
      and the VS Code settings; `C0033_CONFIGURED_AS_AN_ERROR` closed (10 fixtures agree on both vendors, `ar_new_type` on
      TwinCAT; CODESYS keeps it for the dynamic-memory wall).
- [x] 3.1.4 Gaps attributed to these checks (census). Where: checks/types. Acceptance: CA. Depends on: 3.1.2
      **Done 2026-10-06.** The comparison check, rule by rule from 3.1.1's cells (`checks/types/comparison.ts`, colocated
      tests): an array is named as its declaration writes it (`renderType`: `ARRAY [1..2, 0..1]`, `ARRAY [0..N]` unfolded —
      `messages.ts` `compilerArrayText` deleted, the P6/P7 item 0.5 listed); one array, a struct or an FB instance against a
      named operand is C0066 naming both; an enum variable against another enum's VALUE warns (only two values are silent);
      a pointer against an integer by `types/compat` `pointerComparison` (32 bits refused, a signed one meets at LINT and the
      POINTER warns its change of sign, a narrow unsigned one silent; the 64-bit target only). The one census GAP owned by
      a types-A builder, `lib_ns_type_name_two_libraries_other_member`'s enumComparison (CODESYS), follows a name the
      LSP cannot resolve (two libraries' `ERROR`): it is the names group's (LB, 3.5), not the comparison's.
- [x] 3.1.5 Close types A. Where: test/analysis/baselines, design.md §5. Acceptance: CA.3–4. Depends on: 3.1.3, 3.1.4
      **Closed 2026-10-06.** Census rewritten (`VOLT_WRITE_BASELINE=1`): CODESYS TP 5231 → 5296, SEV 19 → 0, FP 110 → 109
      (open 1, unchanged), GAP 460 → 457, never-fired builders 17 → 15; TwinCAT TP 6446 → 6513, SEV 19 → 0, FP 338 → 337,
      GAP 807 → 804, never-fired 40 → 38. Group types per vendor: never-fired builders 8 → 6 (compareNotPossible,
      compareNotPossibleTwo fire; pointerNotConvertible deleted), group FP/GAP unchanged (types FP is held by unknown-source,
      3.2). checkComparison TP 10 → 35, checkPointerConversion TP 0 → 27 / 29, checkAssignmentTypes FP 3 → 2 / 2 → 1.
      Coverage: builders with 0 TP 20 → 17 (CODESYS), 43 → 40 (TwinCAT). Divergences closed: `C0033_CONFIGURED_AS_AN_ERROR`
      (10 fixtures × 2 vendors, `ar_new_type` TwinCAT), `LITERAL_ONE_IS_BIT` (2 × 2), `decl_array_of_array_comma_index`
      (both); opened: none. `rate:fixtures`: +47 fixtures — refused 1790 → 1827, confirmed 2725 → 2727, not-lowered
      337 → 345 (the eight pointer–integer cells the transpiler does not lower; ceiling 338 → 345, named). Frontend
      baselines: counts of the new fixtures, plus three bound-census findings (the front-end has no pointer–integer meet)
      and one paren UNKNOWN per vendor (`(1)` into a struct), each a named exception in `test/frontend/baseline.ts`.
      design.md §5 rows updated (assignment, comparison, string-constant, pointer-conversion).
      **Gate review (3.1+3.3, 2026-10-06), four findings, each MEASURED** — 13 cells, one batch per vendor
      (`record:language`, instance `analysis-conformance`; `record:exec` CODESYS for the 4 that build): (1) a literal into a
      FUNCTION BLOCK instance was BIT without a cell — `litc_fb_init_one`, `litc_fb_assign_one` (BIT) and `litc_fb_assign_two`
      (SINT) agree with the rule on both vendors; colocated test. (2) two arrays of one type with two bound spellings —
      `cmpop_array_bound_spellings`: both vendors give the ONE-type C0068 naming the left operand as written, and a bound
      written as an operation is echoed parenthesized, 'ARRAY [0..(N - 1)] OF INT' (`cmpop_array_bound_expression`). FIXED
      test-first: `checks/types/comparison` `operandText` (bounds by `shared/expr-echo`) + `sameArray` (folded bounds,
      `ArrayTypeInfo.bounds`). (3) `pointerIntoElementary`'s generalization — `ptrsc_into_{date,dt,tod,ltime,wstring}` are
      refused and `ptrsc_into_xint`, `cmpop_pointer_vs_xint` warn the change of sign at LINT, on both vendors: the rule
      stands, its comment cites the cells; colocated test. (4) a REFERENCE declared with a pointer — `ptrsc_reference_initializer`:
      refused in the same words on both vendors; colocated test. Numbers: census CODESYS TP 5344 → 5358, TwinCAT 6552 → 6565
      (fixtures measured +15 each), FP / GAP unchanged; checkComparison TP 35 → 38, checkPointerConversion 27 → 34 / 29 → 36,
      checkAssignmentTypes 721 → 724 / 700 → 703. `rate:fixtures` +15: confirmed 2744 → 2745, refused 1847 → 1858, not-lowered
      346 → 349 (`ptrsc_into_xint`, `cmpop_pointer_vs_xint`, `dflt_method_input_from_variable`; ceiling named). Frontend
      baselines: counts; `cmpop_pointer_vs_xint` joins the named pointer–integer-meet exception. Full suite
      (VOLT_REQUIRE_FULL=1): 8193 pass, 0 fail; typecheck, layering lint and `bun run check` green.

### 3.2 types B

- [x] 3.2.1 types B (deref, subrange, array-bounds, bit-number, indexing, array-init, struct-init, reference-assign,
      data-recursion, enum-init, typed-literal, unsupported-operator, partial-access, unknown-source): fixtures for GAP
      builders (array-init ×3 first). Where: fixtures/. Acceptance: list here. Depends on: 3.1.5
      **Fixtures (2026-10-06), 23:** `declarations/array-init-shapes.ts` (11, `arrinit_*`): a repeat count that is a
      variable and one that is a VAR CONSTANT; a flat and a nested list on an ARRAY OF ARRAY; scalars and struct lists on an
      ARRAY OF a struct; an array literal on an INT and on a struct; too many values through a repeat count and over two
      dimensions; a short list. `types/enum-init-values.ts` (12, `eninit_*`): an enum member initialized with a REAL, a
      STRING, TRUE, T#1S, INT#5, a sibling plus one, another enum's member, a global variable, a global CONSTANT; and the
      duplicate-value warning three of them drew — two members written 0, the first member refused, a refused member beside
      members written 5 and 6. The other builders of the group fire already (0.3); `subrangeAssignTarget`, read at 0 TP, is
      composed inside `cannotConvert` (the census attributes the message to the outer builder) — it agrees on
      `subrange_assign_const_out` and `dt_subrange_assign_variable`; it stays on the 0-TP list as a census artifact, not a gap.
      unsupported-operator and partial-access: no longer checks (0.1), nothing to ask.
- [x] 3.2.2 Record 3.2.1, both vendors. Where: recordings/. Acceptance: CA.1. Depends on: 3.2.1
      **Recorded 2026-10-06** (`record:language`, instance `analysis-conformance`): one batch of 20 per vendor, then one of 4
      per vendor the answers asked for (`arrinit_on_struct` re-asked with `s` renamed — an IL operator; the three duplicate
      probes). `record:exec` CODESYS for the nine that build (unasked 0). Both vendors agree on every cell but TwinCAT's
      one copy per line (`arrinit_flat_into_nested`, `arrinit_scalar_into_struct_array`).
- [x] 3.2.3 FPs: cc3_pointer_conversions, cc3_reference_assign (one cell: niche test), decl_nested_aggregate,
      unknown-source ×13 (itf_var_section_inherited, xf_l*_to_* LDATE, decl_array_single_bound_used,
      decl_implicit_enum_in_struct), and the census FPs of unsupported-operator/partial-access. Where: checks/types,
      checks/syntax, shared/hole. Acceptance: CA. Depends on: 3.2.2
      **Done 2026-10-06.** The one OPEN FP, `refdecl_target_undeclared` (CODESYS: the conversion said twice): FIXED — an
      undeclared `REF=` target is a hole, said once by `unknown-source` beside "Identifier … not defined"; `assignment` no
      longer says it too (colocated test: the two messages, once each). `cc3_reference_assign` agrees on both vendors (it
      left the TwinCAT triage in frontend-conformance; re-measured). `cc3_pointer_conversions` (TwinCAT prints the index
      where the type belongs, "Variable of type '1' …") stays a divergence: a vendor defect, not parity. `decl_nested_aggregate`
      (CODESYS) stays `CODESYS_DECLARATION_DIVERGENCES`: CODESYS SP21's compiler throws a NullReferenceException where
      TwinCAT and the LSP say "Unexpected array initialisation". unknown-source: every census FP re-run and each still
      diverges for its recorded reason — the implicit enum's type name (`IMPLICIT_ENUM_TYPE_NAME`), the LDATE family and
      TwinCAT's named-argument echo, the refused-type and declaration-recovery cascades (`AFTER_A_REFUSED_TYPE`,
      `DECLARATION_RECOVERY`), an interface's VAR section (the header-rules FP, 3.4), library enums (LB, 3.5); `cp_xsizeof`,
      `enum_library_*`, `xf_date_to_ldate_call_once`, `ar_sizeof_into_narrow` and `dt_namespace_static_base` agree on CODESYS
      and diverge on TwinCAT only, as marked. unsupported-operator / partial-access: gone (0.1), no FPs to count.
- [x] 3.2.4 Gaps attributed to these checks. Where: checks/types. Acceptance: CA. Depends on: 3.2.2
      **Done 2026-10-06.** array-init (`checks/types/array-init.ts`, colocated tests): C0232 and C0233 are said for EACH
      scalar with its conversion into the element type (0/1 BIT, by `types/literal` `literalErrorType`); C0075 counts every
      dimension (`elementCapacity`) and is said beside C0232 (a flat list counts each scalar once); C0074 on a scalar or a
      struct adds "Cannot convert type 'Unknown type: '[1, 2]'' …" (`shared/expr-echo` `arrayEcho`). enum-init
      (`checks/types/enum-init.ts`): each value kind as recorded — REAL, STRING (`STRING(INT#n)`), BOOL: "no valid
      initialisation" + the conversion; TIME: the conversion only; a non-constant variable: "Initialisation of constant
      variable … not constant" + "no valid initialisation"; another enum's member: the enum-change warning. The run harness's
      `enumsOf` numbered a member written as an expression as its predecessor plus one — a guess the run recording
      contradicted (`eninit_other_enum_member`, `eninit_gvl_constant`); it folds the expression in the fixture's project now.
      NOT done here: "The constant 0 is assigned to more than one enumeration" — a WARNING both vendors give for two members
      written alike (`eninit_explicit_duplicate`) and for the 0 a refused member leaves beside one written 0; it is the
      duplicate-value rule 0.2 classed missing-rule, 3.11's check (5 cells per vendor, named exceptions in
      `test/frontend/baseline.ts`). The census GAPs of the group's own builders: `ce_cycle_enum` (a cycle through an enum
      member and a global CONSTANT) niche: accepted loss (0 occurrences in the corpora — no corpus build reports "no valid
      initialisation for an enumeration"); `ce_fold_*_untyped` already `UNTYPED_OPERAND_AS_A_BOUND` (niche, 0);
      `dt_library_enum_storage` already `LIBRARY_ENUM_BASE_NOT_MATERIALIZED` (the bridge's); `lit_char_typed_in_enum_value`
      already `COMPONENT_CARRIED_ON_IN_A_DUT`; `decl_array_star_*` (TwinCAT) already `AFTER_A_REFUSED_TYPE` (niche, 0).
- [x] 3.2.5 Close types B. Acceptance: CA.3–4. Depends on: 3.2.3, 3.2.4
      **Closed 2026-10-06.** Census rewritten: CODESYS TP 5296 → 5330, FP 109 → 108, open FP 1 → 0 (group types open FP
      1 → 0), GAP 457 → 462 (+5 unowned: the duplicate-enum warnings, excepted by name for 3.11), never-fired builders
      15 → 12; TwinCAT TP 6513 → 6541, GAP 804 → 809 (+5 unowned, likewise), never-fired 38 → 35. Group types never-fired
      builders 6 → 4 per vendor; checkArrayInit TP 1 → 21 / 2 → 16, checkEnumInit TP 2 → 16 / 2 → 16. Coverage: builders
      with 0 TP 17 → 13 (CODESYS), 40 → 37 (TwinCAT). Divergences opened / closed: none. `rate:fixtures`: +23 fixtures —
      refused 1827 → 1841, confirmed 2727 → 2736. Frontend baselines: the new fixtures' counts; the parse census now reads
      C0232/C0233 as type messages (`NAME_OR_TYPE_MESSAGES`), and the bound census's 14 element conversions are a named
      exception. design.md §5 rows updated (array-init, enum-init, unknown-source).

### 3.3 declarations A

- [x] 3.3.1 declarations A (const-context, declared-type, constant-initializer, external-initializer, external-global,
      input-default, bit-usage, output-rules, non-instantiable, obsolete-usage): fixtures for bit-usage (all 4 builders),
      obsolete-usage (now reachable via 2.6), const-context's unfired builders. Where: fixtures/. Acceptance: list here.
      Depends on: 3.2.5
      **Fixtures (2026-10-06), 17:** `declarations/declaration-rules.ts` (15): bit-usage in an FB's VAR_IN_OUT, VAR_TEMP,
      VAR_STAT, VAR CONSTANT and its legal sections, in a FUNCTION, a METHOD and a PROGRAM (`bitu_*`); a VAR_INPUT
      defaulted with a global variable in an FB and in a FUNCTION (`dflt_*`, `defaultNotConstant`); a FUNCTION's struct
      input and a METHOD's array input defaulted (`indf_*`); an obsolete STRUCT as a type, an obsolete FB extended, the
      attribute with no value (`obs_*` — obsolete-usage fired on 7 fixtures already, 0.3; these are the shapes not asked).
      `calls/argument-count.ts` (2, `callarg_*`), found by the first recording, which called the defaulted functions with
      no argument: a constant default called with none (silent on CODESYS) and a variable default called with none. The
      other checks of the group fire on their recorded fixtures (0.3) and have no unasked builder.
- [x] 3.3.2 Record 3.3.1, both vendors. Acceptance: CA.1. Depends on: 3.3.1
      **Recorded 2026-10-06** (`record:language`, instance `analysis-conformance`): one batch of 15 per vendor (a first run
      recorded nothing: the export name clashed with `grammar/declarations.ts`'s and the fixtures were not in ALL_TESTS),
      then one of 4 per vendor with the functions called with their arguments plus `callarg_no_argument_defaulted_input`,
      and `callarg_no_argument_variable_default` alone. `record:exec` CODESYS for the ten that build; `bitu_fb_var_constant`
      reads "Invalid value" there (a BIT constant) and carries `execSkip` (unaskable 82 → 83).
- [x] 3.3.3 FPs of the group (census). Where: checks/declarations. Acceptance: CA. Depends on: 3.3.2
      **Done 2026-10-06.** The census had 3 FPs in the group per vendor, all `header-rules` / `signature-name` (3.4's): none
      in this step's checks. One found by the cells and FIXED: C0526 "Default value is not constant" on an FB's input
      (`dflt_fb_input_from_variable`: CODESYS builds it silently; a FUNCTION's warns) — `const-context` no longer says it for
      a function block (colocated test). Gate review (2026-10-06): `dflt_program_input_from_variable` is SILENT on CODESYS too
      (FIXED test-first: no C0526 for a PROGRAM's input) and `dflt_method_input_from_variable` warns (the rule kept, now
      measured); TwinCAT silent on both.
- [x] 3.3.4 Gaps of the group (census). Acceptance: CA. Depends on: 3.3.2
      **Done 2026-10-06** (colocated tests each): `bit-usage` — CODESYS adds "Only structures and function blocks can
      contain variables of type BIT" to an FB's VAR_TEMP (TwinCAT does not); `input-default` — a STRUCT default is refused
      too, and a METHOD's input as a FUNCTION's; `obsolete-usage` — an obsolete STRUCT used as a type and an obsolete FB
      named in an EXTENDS are uses. Not done here, with named census exceptions: "References to bits are not possible"
      (CODESYS, a BIT in a VAR_IN_OUT — 0.2's missing-rule, 3.11) and `callarg_no_argument_variable_default` (CODESYS: a
      refused default leaves the input required — `call-arguments`, 3.8; MEASURED_SILENT, lsp-gap 74 → 75). The census
      GAPs owned by the group: `externalNoGlobal` ×2 — `sym_var_external_of_ambiguous_global` follows the ambiguous name
      (names, 3.5), `decl_var_external_inside_struct` a VAR_EXTERNAL inside a STRUCT, niche: accepted loss (0 occurrences in
      the corpora: no corpus build says "No global definition found"); `arrayBoundNonConst` ×2 / ×3 — the parse-recovery
      cascades of `decl_subrange_one_bound`, `lit_malformed_subrange_bound` and TwinCAT's `decl_var_generic`, niche: accepted
      loss (0 occurrences: no corpus build says "is no constant value").
- [x] 3.3.5 Close declarations A. Acceptance: CA.3–4. Depends on: 3.3.3, 3.3.4
      **Closed 2026-10-06.** Census rewritten: CODESYS TP 5330 → 5344, GAP 462 → 464 (+1 unowned "References to bits",
      +1 calls `callarg_no_argument_variable_default`, both excepted by name), never-fired builders 12 → 10; TwinCAT TP
      6541 → 6552, never-fired 35 → 34. Group declarations: never-fired builders 2 → 0 (CODESYS), 8 → 7 (TwinCAT —
      `defaultNotConstant` is CODESYS's by rule); open FP 0, GAP unchanged. checkBitUsage TP 6 → 13 / 6 → 12,
      checkConstantContext 3 → 5 (CODESYS), checkInputDefault 1 → 3, checkObsoleteUsage 12 → 14 / 12 → 14. Coverage:
      builders with 0 TP 13 → 11 (CODESYS), 37 → 36 (TwinCAT). Divergences opened / closed: none. `rate:fixtures`: +17 —
      confirmed 2736 → 2744, refused 1841 → 1847, not-lowered 345 → 346 (`dflt_function_input_from_variable`, ceiling
      named), lsp-gap 74 → 75, unaskable 82 → 83. Frontend baselines: the new fixtures' counts; one more literal of LT14's
      "into BIT" class (`bitu_fb_var_constant`), a named exception. design.md §5 rows updated (const-context, input-default,
      bit-usage, obsolete-usage).
      **Gate review (3.1+3.3, 2026-10-06):** one finding, measured (`dflt_program_input_from_variable`,
      `dflt_method_input_from_variable`, both vendors, recorded in 3.1's gate batch): a PROGRAM's input defaulted with a
      variable builds silently on CODESYS — `const-context` exempts it as it does an FB's; a METHOD's warns as a FUNCTION's.
      checkConstantContext TP 5 → 6 (CODESYS), defaultNotConstant TP 2 → 3; `rate:fixtures`: confirmed +1 (the PROGRAM), not-lowered
      +1 (the METHOD, counted under 3.1's gate note).

### 3.4 declarations B

- [x] 3.4.1 declarations B (at-address, header-rules, attribute-placement, var-section-placement, inout-initializer,
      unknown-type, system-initializer, refused-initializer, dynamic-creation, signature-name): fixtures for header-rules'
      unfired builders. Where: fixtures/. Acceptance: list here. Depends on: 3.3.5
      **Fixtures (2026-10-06), 22** — `declarations/declaration-rules-b.ts`, rule by rule. header-rules' two 0-TP builders
      (TwinCAT `unionInheritance`, `inputInPropertyAccessor`) are CODESYS's by rule (measured: `unit_type_extends_on_union`
      builds on TwinCAT; the push refuses an accessor's text there), so the cells are the rules no fixture asked:
      `hdr_fb_return_type`, `hdr_fb_extends_three`, `hdr_interface_extends_two` (legal), `hdr_function_private`,
      `hdr_program_protected`, `hdr_fb_property_no_accessor`, `hdr_interface_var_output_used`; var-section-placement
      `vsp_var_global_in_fb`, `_in_program`, `vsp_retain_in_function`, `vsp_retain_input_in_function`,
      `vsp_var_config_in_function`, `vsp_retain_output_in_fb` (legal); inout-initializer `ioinit_fb_instance_literal`,
      `ioinit_array_initializer`, `ioinit_struct_initializer`; signature-name `sn_enum_mismatch_used`,
      `sn_alias_mismatch_used`, `sn_union_mismatch_used`, `sn_fb_case_only` (silent); attribute-placement
      `attrp_pack_mode_on_function`, `attrp_pack_mode_on_program` (legal). at-address, unknown-type, refused-initializer and
      dynamic-creation fire on their recorded fixtures with no unasked rule (system-initializer is gone, 0.5).
- [x] 3.4.2 Record 3.4.1, both vendors. Acceptance: CA.1. Depends on: 3.4.1
      **Recorded 2026-10-06** (`record:language`, instance `analysis-conformance`, TwinCAT `-Fixture 13`): one batch of 22
      per vendor (three header fixtures pushed AS SENT — the parser misreads their header, so its split could not mark the
      body). `record:exec` CODESYS: 7 that build; `ioinit_array_initializer` and `ioinit_struct_initializer` answer "Login
      failed..." alone each (an FB_INIT reading an unbound VAR_IN_OUT — the application does not start) and carry `execSkip`
      (unaskable 83 → 85).
- [x] 3.4.3 FPs: cc2_var_in_interface, itf_var_section_declaration, sn_dut_mismatch. Where: checks/declarations.
      Acceptance: CA. Depends on: 3.4.2
      **Done 2026-10-06.** The three stay divergences, re-confirmed: each is an object NOTHING reaches (an interface no one
      implements, a DUT no one uses) — both vendors build it clean and the replay has no reachability;
      `hdr_interface_var_output_used` and `sn_*_mismatch_used` measure the same rules reached, and agree. Found by the cells
      and FIXED test-first (colocated tests): `signature-name` reads the object's name from the document's uri — an ALIAS has
      no scope to ask, so `sn_alias_mismatch_used` was silent (a `.st` text names no object, `sourceObjectOf`); the parser
      reads a FUNCTION_BLOCK's return type and `header-rules` says C0182 for it as for a PROGRAM (`hdr_fb_return_type`: one
      message on both vendors, the LSP gave a 13-error cascade; the printer keeps the clause). Divergence opened:
      `hdr_function_private`, `hdr_program_protected` — niche: accepted loss (0 occurrences in the corpora; the header
      grammar has no access modifier on a FUNCTION / PROGRAM, and "Cannot access private method ???.F" is the access rule
      family, 3.11's) — `ACCESS_MODIFIER_ON_A_FUNCTION_OR_PROGRAM`.
- [x] 3.4.4 Gaps of the group. Acceptance: CA. Depends on: 3.4.2
      **Done 2026-10-06.** Three of the group's GAPs were ONE cause outside the checks: the build compiles a fixture's
      dependencies and records their errors under the fixture, the replay analysed only the fixture's own files. The replay
      now analyses the items and lists of every fixture a fixture depends on (`support/replay.ts` `dependencies`, the census
      the same documents) — measured first, both vendors: 3 fixtures gain the dependency's recorded message, none gains an
      unrecorded one (`sn_dut_mismatch_used` agrees and leaves KNOWN_DIVERGENCES.codesys; `interface_with_property_impl`
      agrees; `itf_var_section_inherited` gets its interface error, still a divergence for the body the vendor never checks).
      inout-initializer (test-first): a VAR_IN_OUT read in an ARRAY / STRUCT initializer, and an FB instance initialized
      through its FB's VAR_IN_OUT, are the uninitialized access (`ioinit_*`, `cc5_fb_init_inout`'s GAP closed). Left with
      named census exceptions: the external-access warning from FB_INIT and the literal's conversion into the REFERENCE
      (`ioinit_*` — inout-access / fb-init-inout, 3.6), CODESYS's second copy of the aggregate warning (said once), the two
      access-modifier fixtures (3.11). The remaining signature-name GAPs (8) are the member-header niche divergences.
- [x] 3.4.5 Close declarations B. Acceptance: CA.3–4. Depends on: 3.4.3, 3.4.4
      **Closed 2026-10-06.** Census rewritten: group declarations open FP 0 → 0 (FP(div) 3 → 3, both vendors), GAP 19 → 19
      CODESYS (−4 closed, +2 access-modifier niche, +2 CODESYS's double aggregate warning), 18 → 16 TwinCAT; never-fired
      builders 0 / 7 unchanged (TwinCAT's by rule). checkHeaderRules TP 34 → 40 / 29 → 35, checkVarSectionPlacement 4 → 9,
      checkInoutInitializer 2 → 6 (GAP 1 → 2 / 1 → 0), checkSignatureName 3 → 7 (GAP 9 → 8), checkAttributePlacement
      1 → 2 (CODESYS). Totals: TP 5358 → 5379 / 6565 → 6585; FP 108 → 117 / 337 → 346 (all FP(div): the two
      access-modifier fixtures), open FP 0; GAP 464 → 470 / 809 → 813, unowned 76 → 78 / 109 → 111 (each rise a named
      exception in `test/frontend/baseline.ts`). Coverage unchanged (0-TP builders 11 / 36). Divergences: opened
      `hdr_function_private`, `hdr_program_protected` (both vendors); closed `sn_dut_mismatch_used` (CODESYS). `rate:fixtures`:
      confirmed 2745 → 2750, refused 1858 → 1873, unaskable 83 → 85. Frontend baselines: the new fixtures' counts; one
      type-dump exception (`ioinit_fb_instance_literal`: an FB initializer's field is no store the bound census reads).
      `test/conformance` 6033 pass, 0 fail; agreement CODESYS 4679, TwinCAT 4584 of 5137. design.md §5 rows updated.
      **Gate review (3.4+3.6, 2026-10-06):** `inout-initializer`'s FB-instance branch (`w : B := (target := x)`) ran in
      every unit kind; both recordings declare the instance in a FUNCTION_BLOCK and its sibling inout-access
      `initializerAccess` refuses the rest — now FB declarations only (test-first; a PROGRAM's gives `fb-init-inout`
      alone, as before 3.4).

### 3.5 names

- [x] 3.5.1 names (duplicate-declaration, unresolved-identifier, ambiguous-global, type-as-value, reserved-keyword,
      refused-name, conditional-call): fixtures for ambiguous-global (two GVLs, bare use). Where: fixtures/.
      Acceptance: list here. Depends on: 3.4.5
      **Fixtures (2026-10-06), 22** — `names/name-rules.ts`: ambiguous-global, two lists, bare: `ambg_read_bare`,
      `ambg_write_bare`, `ambg_initializer`, `ambg_in_method`, `ambg_in_condition`, `ambg_fb_instance_call`,
      `ambg_different_types`, legal `ambg_qualified_read`, `ambg_local_shadow`; duplicate-declaration `dupn_two_methods`,
      `dupn_method_named_as_action` (both refused by Volt's push, DUPLICATE_CHILD — `vendorRefuses`, `execSkip`),
      `dupn_method_named_as_variable`, `dupn_gvl_variable_twice`, `dupn_struct_field_twice`, `dupn_name_list_twice`;
      type-as-value `tav_alias_as_value`, `tav_alias_as_target`, `tav_type_as_operand`, `tav_type_as_condition`,
      `tav_fb_type_as_value`; reserved-keyword `rkw_struct_field_char`, `rkw_method_input_using`. (A 23rd,
      `rkw_global_wchar`, was recorded and deleted with its rows: a global named WCHAR became a dependency of
      `cc5_reserved_keyword_names`, whose text uses the word as a local — the recorder pushes every fixture whose names
      another fixture's text mentions.) unresolved-identifier and conditional-call fire on their recorded fixtures (0.3);
      refused-name is gone (0.5).
- [x] 3.5.2 Record 3.5.1, both vendors. Acceptance: CA.1. Depends on: 3.5.1
      **Recorded 2026-10-06** (`record:language`, instance `analysis-conformance`): one batch of 23 per vendor (2 refused by
      the push). `record:exec` CODESYS: the 5 that build.
- [x] 3.5.3 FPs: decl_implicit_enum_duplicate, unresolved-identifier ×16 (LDATE family: confirm divergence still holds;
      itf_var_section_inherited), and the census FPs of refused-name/conditional-call. Where: checks/names,
      checks/syntax, shared/resolution. Acceptance: CA. Depends on: 3.5.2
      **Done 2026-10-06.** Re-confirmed, each still a divergence with its reason: `decl_implicit_enum_duplicate` (the
      implicit enum's type name, `IMPLICIT_ENUM_TYPE_NAME` — NOT niche, the binder's owner name, DT10); the TwinCAT
      LDATE family (`xf_l*_call_once`: TwinCAT has no LDATE, the call cascades); `itf_var_section_inherited` (the vendor
      stops at the interface error). refused-name has no census row (gone, 0.5), conditional-call 0 FP. Found by the cells
      and FIXED test-first (colocated tests): `duplicate-declaration` called a METHOD named as the FB's variable a duplicate
      (`dupn_method_named_as_variable`: both vendors build it; CODESYS warns "Ambiguous use of name 'M'" at the bare use —
      `ambiguous-global`, a warning, not inside the method where the name is its result; TwinCAT silent); `type-as-value` +
      `shared/hole`: an ALIAS's name as a value or target was C0230 and a hole's conversion beside it — a type's name is no
      hole (the vendors type it as the type), C0230 explains only a STRUCT's name CALLED (`tav_alias_*`); `reserved-keyword`
      lost a STRUCT field (`rkw_struct_field_char`).
- [x] 3.5.4 Gaps of the group. Acceptance: CA. Depends on: 3.5.2
      **Done 2026-10-06** (colocated tests each). The root cause of the ambiguous-global GAPs: an ambiguous global was
      RESOLVED (to the first list's) — `types/names` `globalClash` makes a global two of the project's lists declare, and a
      project global beside an own enum's member (EN5), name nothing: "Identifier not defined", the hole's conversion /
      "is no valid assignment target" / "Program name … expected" follow (`ambg_*`; `expr_global_namespace_ambiguous_bare`
      and `enum_member_vs_global` agree now and lose their marks — EXPRESSION_NICHE_DIVERGENCES, ENUM_DIVERGENCES, the
      deferral). `duplicate-declaration`: a name twice in one GVL, named after the list's OBJECT (as the binder
      names it, `gvlName` — gate review). `type-as-value`: a type's name as an operand or a condition.
      Left, named: the vendors' further conversions of a type's name (`tav_type_as_*`, niche: accepted loss, 0 in the
      corpora), "Expression of type 'BOOL' expected" for an untyped condition (`ambg_in_condition`, 3.11's), and the
      remaining group GAPs — `lib_ns_library_gvl_shared_list_name_bare` (two libraries' lists named CONSTANTS, a
      library fact), and the niche divergences `sym_var_external_of_ambiguous_global`, `sig_unknown_word`,
      `unit_method_override*`, the declaration `{IF}` cells.
- [x] 3.5.5 Close names. Acceptance: CA.3–4. Depends on: 3.5.3, 3.5.4
      **Closed 2026-10-06** (numbers against the 3.4 state). Group names: open FP 0 → 0 (FP(div) unchanged), GAP 11 → 10
      CODESYS, 4 → 3 TwinCAT, never-fired builders 1 / 2 unchanged (`duplicateMethod` unmeasurable through the push;
      TwinCAT's `reservedKeyword` by rule). checkAmbiguousGlobal TP 9 → 18 / 9 → 17 (GAP 7 → 6 / 3 → 2),
      checkUnresolvedIdentifiers TP 92 → 102 / 415 → 425, checkDuplicateDeclarations 8 → 11, checkTypeAsValue 6 → 10,
      checkReservedKeyword 3 → 5. Totals: TP 5379 → 5417 / 6585 → 6620, FP 117 / 346 unchanged, open FP 0, GAP 470 → 469 /
      813 → 812, unowned 78 → 79 / 111 → 112 (`ambg_in_condition`, a named exception). Divergences closed:
      `expr_global_namespace_ambiguous_bare`, `enum_member_vs_global` (both vendors); opened: none. `rate:fixtures`:
      confirmed 2750 → 2755, refused 1873 → 1889, lsp-gap 75 → 74, unaskable 85 → 87. Frontend baselines: the new
      fixtures' counts, resolution agreements +9 per vendor; named exceptions for the type's-name cells (type-dump) and the
      condition (parse census; `namesFixture` now reads the parse census's finding form). `test/conformance` 6042 pass, 0
      fail; agreement CODESYS 4698, TwinCAT 4603 of 5159. design.md §5 rows updated.
      **Gate review (3.4+3.6, 2026-10-06)**, each test-first: `duplicate-declaration` exempted a METHOD from every other
      declaration, so a METHOD beside an ACTION or a PROPERTY of its name stopped being a duplicate — only a METHOD beside a
      VARIABLE is exempt now (the measured pair). Its GVL scan counts the names the BINDER bound from the list (a
      VAR_ACCESS section and a refused-AT declaration bind nothing, one rule), and names the list by the binder's
      `gvl_block` (`gvlName`) instead of a second uri rule (`objectNameOf` stays `signature-name`'s). A name in each
      branch of a GVL's declaration `{IF}` is still counted twice — niche: accepted loss (0 GVLs with `{IF}` in the
      corpora), as the POU declaration `{IF}` cells. `ambiguous-global`'s method-beside-variable warning is the measured
      shape only: a bare READ in the POU's own body — no longer in another METHOD's body or at a call `M()` (the call's
      own resolution to the variable, "Program name … expected", stays: niche: accepted loss, 0 FBs in the corpora name a
      METHOD as a variable — they built clean while this was a duplicate error). `reserved-keyword`: a UNION's fields are
      not scanned (only a STRUCT field recorded), and the header no longer cites the deleted `rkw_global_wchar`.

### 3.6 oop A

- [x] 3.6.1 oop A (inheritance, property-access, method-reference, inherited-variable, external-write, inout-access,
      fb-init-inout, fb-init-instantiation): fixtures for unfired builders (0.3). Where: fixtures/. Acceptance: list here.
      Depends on: 3.5.5
      **Fixtures (2026-10-06), 18** — `oop/oop-rules-a.ts`. No oop-A builder is at 0 TP (0.3: the group's TwinCAT ones are
      oop B's), so the cells are each rule's unmeasured sides: inheritance `oopa_extends_interface`, `oopa_extends_struct`,
      `oopa_implements_struct`, `oopa_implements_one_unknown`; property-access `oopa_setonly_in_condition`,
      `oopa_setonly_as_argument`, `oopa_getonly_written`; method-reference `oopa_method_ref_in_operand`; inherited-variable
      `oopa_inherited_var_grandparent`, `oopa_inherited_input_as_var`; external-write `oopa_read_internal_var` (legal),
      `oopa_write_var_temp`, `oopa_write_output`; inout-access `oopa_inout_read_external`, `oopa_inout_in_property`;
      fb-init-inout `oopa_fb_init_inout_other_type`; fb-init-instantiation `oopa_fb_init_two_arguments`,
      `oopa_fb_init_array_left_out`.
- [x] 3.6.2 Record 3.6.1, both vendors. Acceptance: CA.1. Depends on: 3.6.1
      **Recorded 2026-10-06** (`record:language`, instance `analysis-conformance`): one batch of 18 per vendor, then
      `oopa_inherited_input_as_var` and `oopa_read_internal_var` again on both (their first text named a variable `limit` /
      `internal`, a word both vendors refuse as a name, so the cells asked a parse error). `record:exec` CODESYS: the 2 that
      build.
- [x] 3.6.3 FPs of the group. Where: checks/oop. Acceptance: CA. Depends on: 3.6.2
      **Done 2026-10-06.** The group had no FP in the census (open 0, div 0). Found by the cells and FIXED test-first
      (colocated tests): `external-write` named an instance's VAR_TEMP's owner as the FB where both vendors say
      "'scratch' is no input of '__MAIN'" (`oopa_write_var_temp`) — the body; and it let a VAR_OUTPUT be written from
      outside, which both refuse as "no input" (`oopa_write_output`). Divergences opened: none.
- [x] 3.6.4 Gaps of the group. Acceptance: CA. Depends on: 3.6.2
      **Done 2026-10-06** (colocated tests each). `inheritance`: a base that exists and is no FB (an INTERFACE, a STRUCT) is
      "No definition found for base class", alone; a STRUCT in IMPLEMENTS is no interface (the kinds list named `dut`, a kind
      no symbol has — `type`). `property-access`: a get-only property written is "'t.P' is no valid assignment target".
      `inout-access`: an initializer is an access — an FB instance initialized through its FB's VAR_IN_OUT, from the
      declaring FB; an ARRAY / STRUCT initializer reading the FB's own VAR_IN_OUT, from 'FB_INIT' (3.4's `ioinit_*`
      exceptions closed). `fb-init-inout`: the value binds the parameter's REFERENCE — a literal or a variable of another
      type is "Cannot convert type 'SINT' / 'BOOL' to type 'REFERENCE TO INT'", TwinCAT the pair reversed, as for a REF=
      statement; the exact-type rule moved out of `reference-assign` into `shared/reference-bind` (two checks apply it), and
      the initializer reading into `shared/initializer` (three do). `fb-init-instantiation`: a wrong argument COUNT is the
      same message as none; an ARRAY of such an FB with no initializer counts its initializers ("The number of 'FB_Init'
      initializers (0) does not match the number of array elements (2)", a new builder, both vendors' wording) — never for
      `ARRAY[..] OF FB_X(args)`, which gives every element its arguments (the first run said it 17 times on pro2193, which
      builds: measured before the census was written, fixed test-first). Left, named: `oopa_method_ref_in_operand` — both
      vendors type a method named without its call as a type of its own name ("Operation 'Plus' is not possible on type
      'VALUE'"), deferred, niche: accepted loss (0 in the corpora, which build); `decl_subrange_on_alias` (TwinCAT: its
      parse-error recovery reads `T(0` as an FB_Init instantiation, "No matching FB_init method found") — niche: accepted
      loss (0 subranges of an alias in the corpora), a recovery cascade, no check's.
- [x] 3.6.5 Close oop A. Acceptance: CA.3–4. Depends on: 3.6.3, 3.6.4
      **Closed 2026-10-06** (numbers against the 3.5 state). Group oop: open FP 0 → 0, GAP 7 → 7 CODESYS, 2 → 2 TwinCAT (both
      oop B's but `decl_subrange_on_alias`), never-fired builders 0 / 6 unchanged (TwinCAT's oop-B builders by rule). TP:
      checkInheritance 19 → 23 / 13 → 17, checkPropertyAccess 2 → 5, checkInheritedVariable 1 → 3, checkExternalNonInputWrite
      19 → 21, checkInoutExternalAccess 4 → 6, checkInoutOwnAccess 19 → 25 / 10 → 16, checkFbInitInout 2 → 5,
      checkFbInitInstantiation 1 → 3 (`fbInitArrayCount` 1 TP each). Totals: TP 5417 → 5442 / 6620 → 6645, FP 117 / 346
      unchanged, open FP 0, GAP 469 → 466 / 812 → 809, unowned 79 / 112 unchanged; corpus unchanged (FP 216, all
      `server:missing-language`). Divergences: none opened or closed; one deferral (`oopa_method_ref_in_operand`).
      `rate:fixtures`: confirmed 2755 → 2756, refused 1889 → 1904, not-lowered 349 → 350 (`oopa_inout_in_property`, an
      accessor has no frame slot for the FB's VAR_IN_OUT — ceiling named), lsp-gap 74 → 75. Frontend baselines: the new
      fixtures' counts; type-dump exceptions for `oopa_fb_init_inout_other_type` and `oopa_method_ref_in_operand`.
      `test/conformance` 6045 pass, 0 fail; agreement CODESYS 4717, TwinCAT 4624 of 5177. design.md §5 rows updated.
      **Gate review (3.4+3.6, 2026-10-06)**, each test-first: `inheritance` says "No definition found for base class" for an
      existing non-FB base only where measured — an INTERFACE or a STRUCT (an ALIAS, even of an FB, a FUNCTION or a PROGRAM
      base is unasked and silent as before); IMPLEMENTS's disproof likewise takes a STRUCT, not every DUT.
      `fbInitArrayCount` counts in an FB's or a PROGRAM's VAR only (a FUNCTION's VAR_INPUT array is unasked).
      `fb-init-inout.test`'s PROGRAM cases no longer expect inout-initializer's warning (measured in an FB, 3.4's gate
      fix). **Gate numbers** (full suite, `VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`): 8243 pass, 0 fail, 35 skip, 394
      todo (8672 tests, 205 files); agreement CODESYS 4717, TwinCAT 4624 of 5177 — unchanged by the gate fixes; census
      and frontend baselines unchanged (no fixture's answer moved); fixture map untouched (no fixture or transpiler change).

### 3.7 oop B

- [x] 3.7.1 oop B (generic-instantiation, abstract-assign, lifecycle, abstract-instantiation, interface-implementation,
      method-signature, abstract-output-default): fixtures for method-signature (base and interface mismatch) and
      generic-instantiation on TwinCAT. Where: fixtures/. Acceptance: list here. Depends on: 3.6.5
      **Fixtures (2026-10-06), 30** — `oop/oop-rules-b.ts`. method-signature (it had cells already — `inh_override_*`,
      `inh_interface_method_*`; these are the unmeasured sides): against an INTERFACE `oopb_itf_param_name_mismatch`,
      `_section_mismatch`, `_return_type_mismatch`, `_return_missing`, `_property_type_mismatch`,
      `_inherited_method_mismatch`, `_method_in_base_mismatch`; against a BASE `oopb_base_grandparent_mismatch`,
      `_property_get_set_mismatch`, `_output_type_mismatch`. generic-instantiation (TwinCAT measures its refusal, no
      VAR_GENERIC there) `oopb_generic_two_constants_one_value`, `_as_input`. abstract-assign `oopb_abstract_assign_inout`,
      `_assign_reference`, `_ref_rebind` (legal), `_pointer_deref_assign`. lifecycle `oopb_fb_init_swapped_inputs`,
      `_extra_input_first`, `_input_wrong_type`, `oopb_fb_reinit_no_return`, `oopb_fb_exit_extra_input`.
      abstract-instantiation `oopb_abstract_array`, `_pointer` (legal), `_as_input`. interface-implementation
      `oopb_itf_property_missing`, `_method_from_base` (legal), `_property_getter_only`. abstract-output-default
      `oopb_abstract_method_output_default`, `oopb_concrete_method_output_default` (legal),
      `oopb_implicit_abstract_output_default`.
- [x] 3.7.2 Record 3.7.1, both vendors. Acceptance: CA.1. Depends on: 3.7.1
      **Recorded 2026-10-06** (`record:language`, instance `analysis-conformance`, TwinCAT on Project13): one batch of 30
      per vendor; on CODESYS six again (`oopb_base_output_type_mismatch`, `oopb_abstract_assign_reference`, `_ref_rebind`,
      `oopb_*_method_output_default` ×3) — their first text named a variable `r`, an IL operator both vendors refuse as a
      name, so the cells asked a parse error (TwinCAT was recorded after the rename). `record:exec` CODESYS: the 10 that build.
- [x] 3.7.3 FPs of the group. Where: checks/oop. Acceptance: CA. Depends on: 3.7.2
      **Done 2026-10-06.** The group had no FP in the census (open 0, div 0). Found by the cells and FIXED test-first
      (colocated tests): `abstract-instantiation` called a VAR_IN_OUT of an ABSTRACT FB's type an instance (both vendors
      refuse only the assignment through it, `oopb_abstract_assign_inout`); `method-signature` converted a VAR_OUTPUT of
      another type (`oopb_base_output_type_mismatch`: the mismatch alone, both vendors) and named a section change vs an
      interface as "the variable" where CODESYS counts sections apart; `interface-implementation` asked the FB for an
      interface PROPERTY that declares neither accessor (`oopb_itf_property_missing`: the vendors only warn about the
      interface); `fb-init-instantiation` took FB_Init's extra inputs by POSITION — an INT declared first is "(INT)"
      (`oopb_fb_init_extra_input_first`, by NAME now). Divergences opened: none.
- [x] 3.7.4 Gaps of the group. Acceptance: CA. Depends on: 3.7.2
      **Done 2026-10-06** (colocated tests each). `method-signature`: CODESYS counts inputs, outputs and inouts APART, the
      result among the outputs (a section change, a result left out: the COUNT sentence), another result type names the
      method as "the variable 'M'"; an interface method the FB INHERITS from its base is compared too
      (`oopb_itf_method_in_base_mismatch`, both vendors); a PROPERTY whose SET overrides another type converts its value once
      (`oopb_base_property_get_set_mismatch`, both). `lifecycle`: the required inputs are BOOL (`oopb_fb_init_input_wrong_type`)
      and FB_Exit takes its input ALONE (`oopb_fb_exit_extra_input`), both vendors. `abstract-instantiation`: an ARRAY's element
      is an instance (`oopb_abstract_array`). Left, named — each niche: accepted loss, counted:
      `oopb_abstract_pointer_deref_assign` (both vendors' "The instance p^ points to will be reinitialized…" warning and
      CODESYS's ABSTRACT target refusal through `p^`: 0 FB copies through a pointer in the corpora, `deferred.lsp`,
      ANALYSIS_NICHE); `oopb_abstract_method_output_default`, `oopb_implicit_abstract_output_default` (CODESYS warns the
      default twice where the abstract FB is extended, and for a body-less method without the keyword: 0 VAR_OUTPUT defaults
      in a method of an ABSTRACT FB in the corpora, CODESYS_ANALYSIS_NICHE); `oopb_generic_*` on TwinCAT (no VAR_GENERIC —
      TWINCAT_NO_VAR_GENERIC, the recovery's); the census GAPs `unit_interface_property_accessor_var_*` (an interface
      accessor's VAR_INPUT/OUTPUT/IN_OUT: 0 in the corpora) and `unit_interface_method_final_public_order` (`METHOD FINAL
      PUBLIC` in an interface: 0 in the corpora) stay GAPs. generic-instantiation on TwinCAT: by rule (never fires there).
- [x] 3.7.5 Close oop B. Acceptance: CA.3–4. Depends on: 3.7.3, 3.7.4
      **Closed 2026-10-06** (numbers against the 3.6 state; the census of 3.7–3.9 was measured once, the group's rows are
      its own). Group oop: open FP 0 → 0, GAP 7 → 11 CODESYS (the four niche cells above, named ceiling exceptions —
      ceiling unchanged at 7), 2 → 2 TwinCAT; never-fired builders 0 / 6 unchanged (TwinCAT's oop-B builders by rule).
      TP: checkMethodSignatures 19 → 37 / 17 → 29, checkLifecycleSignatures 3 → 8 / 2 → 6, checkAbstractInstantiation 3 → 5
      / 3 → 5, checkAbstractAssign 1 → 3, checkGenericInstantiation 4 → 6, checkAbstractOutputDefault 1 → 2,
      checkFbInitInstantiation 3 → 4 (oop A's, the extra-input fix), checkHeaderRules 40 → 43 / 35 → 38 (the interface
      properties' warning). Divergences: opened `oopb_abstract_pointer_deref_assign` (both), the two output defaults
      (CODESYS), `oopb_generic_*` (TwinCAT); closed none. design.md §5 rows updated.

### 3.8 calls

- [x] 3.8.1 calls (call-arguments, call-result-access, fb-instantiation, intrinsic-operands, non-callable-call,
      recursive-call): fixtures for unfired builders of call-arguments and intrinsic-operands. Where: fixtures/.
      Acceptance: list here. Depends on: 3.7.5
      **Fixtures (2026-10-06), 30** — `calls/call-rules.ts`. call-arguments: `unknownNamedOutput` (0 TP) on an FB, a FUNCTION,
      a METHOD — `calls_unknown_output_fb`, `_function`, `_method` — and naming an INPUT, `calls_output_names_input`; counts
      `calls_function_too_few_positional`, `calls_function_defaults_none_given` (legal on CODESYS); a VAR_IN_OUT unbound
      `calls_inout_unbound_method`, `_function`; a VAR_IN_OUT bound to `calls_inout_bound_to_constant`, `_expression`,
      `_call_result`, `_property`. call-result-access `calls_index_on_method_result`. fb-instantiation
      `calls_fb_type_as_argument`, `calls_itf_type_as_argument`. intrinsic-operands (0-TP builders): `calls_adr_on_bit_field`,
      `_bit_access` (`adrOnBit`), `calls_ini_on_int`, `calls_ini_on_fb_instance` (`iniNeedsInstance`),
      `calls_queryinterface_int_first`, `_int_second`, `_legal`, `calls_querypointer_int_second`, `_legal`
      (`queryInterfaceFirst/Second`, `queryPointerSecond`), `calls_sqrt_of_bool`. non-callable-call `calls_enum_value_called`,
      `calls_struct_instance_called`, `calls_constant_called`. recursive-call `calls_method_recursive`,
      `calls_functions_mutually_recursive`.
- [x] 3.8.2 Record 3.8.1, both vendors. Acceptance: CA.1. Depends on: 3.8.1
      **Recorded 2026-10-06** (`record:language`, instance `analysis-conformance`): one batch of 30 per vendor; on CODESYS
      seven again (`calls_unknown_output_*` ×3, `calls_output_names_input`, `calls_sqrt_of_bool`, `calls_adr_on_bit_field`,
      `calls_struct_instance_called`) — their first text named variables `r`, `s` and then `st`, IL operators both vendors
      refuse as names (TwinCAT recorded after the renames). `record:exec` CODESYS: the 7 that build.
- [x] 3.8.3 FPs: lex_vector_twincat_return_type (confirm divergence) and the census list. Where: checks/calls.
      Acceptance: CA. Depends on: 3.8.2
      **Done 2026-10-06.** `lex_vector_twincat_return_type` re-confirmed (TwinCAT refuses `__VECTOR` as a return type and its
      recovery cascades — TWINCAT_VECTOR_REFUSAL_CASCADE). The census list had no other calls FP (open 0). Found by the cells
      and FIXED test-first (colocated tests): `call-arguments` said "VAR_IN_OUT 'io' must be assigned" for a FUNCTION's or
      METHOD's call, where both vendors say its input COUNT, the in-outs among the inputs ("requires exactly '2' inputs",
      `calls_inout_unbound_*`); `intrinsic-operands` said "Operation 'Sqrt' is not possible on type 'BOOL'" where both vendors
      convert SQRT's operand to LREAL ("Cannot convert type 'BOOL' to type 'LREAL'", `calls_sqrt_of_bool`; the old test's
      SQRT(STRING) premise was never recorded); `non-callable-call` named a STRUCT instance's call as no call target where both
      vendors say "Cannot call object of type 'TYPE'", and an enum value by its member alone where they write 'E.Busy'; the
      TwinCAT `inOutConstantNeedsVariable` is said of a LITERAL only there (`inout_const_bound_forms_1`: TwinCAT binds the VAR
      CONSTANT). A first form of the type-name-as-argument rule fired on `__NEW(FB)`/`INDEXOF(FB)` (8 FPs, `newdel_*`,
      `operand_indexof`, seen by the census before it was written) — restricted to a routine's arguments and
      __QUERYINTERFACE, test-first. Divergences opened: `calls_method_recursive` (niche, below).
- [x] 3.8.4 Gaps of the group. Acceptance: CA. Depends on: 3.8.2
      **Done 2026-10-06** (colocated tests each). `call-arguments`: an output binding naming nothing is also "Identifier not
      defined", naming an INPUT "'i' is no output" (`calls_unknown_output_*`, `calls_output_names_input`); an FB's positional
      arguments bind no VAR_IN_OUT (`cg_fb_positional` closes; the old test's "bound by position" premise contradicted it); a
      VAR_IN_OUT bound to a call's result or a BIT access needs a variable (`calls_inout_bound_to_call_result`,
      `refuse_inout_bound_to_bit` close), to a property CODESYS's own "Properties can't be assigned to VAR_IN_OUT." (a new
      builder, `propertyBoundToInOut`; TwinCAT the needs-variable sentence); a CODESYS default that is a VARIABLE is none
      (`callarg_no_argument_variable_default` closes, leaves MEASURED_SILENT and its ceiling exceptions);
      `inOutConstantNeedsVariable` is TwinCAT's too (both `inout_const_*` close). `fb-instantiation`: a type's name passed as an
      argument (`calls_fb_type_as_argument`, `_itf_`; `op_sys_queryinterface`'s interface, which leaves MEASURED_SILENT).
      `intrinsic-operands`: ADR of a bit access is CODESYS's single-bit warning (`calls_adr_on_bit_access`; TwinCAT silent).
      `recursive-call`: a METHOD calling itself (`calls_method_recursive`). `shared/hole`: a call refused as no call target has
      no type (`calls_constant_called`'s conversion). Left, named: `calls_method_recursive`'s echo — the vendors leave the
      literal beside a hole untyped, "'(M(n := (n - INT#1)) + 1)'" (niche: accepted loss, 0 recursive calls in the corpora,
      ANALYSIS_NICHE); `calls_functions_mutually_recursive` — CODESYS's "Call recursion: A -> B -> A" warning (niche: accepted
      loss, 0 recursive calls in the corpora); `op_sys_queryinterface`'s "does not extend __System.IQueryInterface" and
      "Operation '__QueryInterface' is not possible on type …" (niche: accepted loss, 0 of the corpora's 35 __QUERYINTERFACE
      calls name a type); the parse-recovery GAPs `unit_function_*` (UNIT_HEADER_RECOVERY) and `lex_keyword_operand_indexof`
      (0 INDEXOF in the corpora); `tav_type_as_operand` and `oopa_method_ref_in_operand` as named in 3.5/3.6.
- [x] 3.8.5 Close calls. Acceptance: CA.3–4. Depends on: 3.8.3, 3.8.4
      **Closed 2026-10-06** (numbers against the 3.7 state). Group calls: open FP 0 → 0, GAP 10 → 6 CODESYS, 9 → 6 TwinCAT
      (ceilings 7 → 4 / 7 → 4), never-fired builders 8 → 2 / 9 → 3 (`adrOnBit`, `iniNeedsInstance`, `queryInterfaceFirst`,
      `queryInterfaceSecond`, `queryPointerSecond`, `unknownNamedOutput` fire now; TwinCAT's `propertyBoundToInOut` and
      `functionRequiresInputRange` and CODESYS's `boundsNeedVariableLength` by rule). TP: checkCallArguments 96 → 113 /
      95 → 114 (GAP 5 → 2 / 4 → 2), checkIntrinsicOperands 30 → 37 / 25 → 31, checkFbInstantiation 9 → 12 (GAP 1 → 0),
      checkNonCallableCall 10 → 13 / 7 → 10, checkRecursiveCall 1 → 2, checkCallResultAccess 3 → 4, checkUnknownSource
      128 → 133 / 284 → 289 (the holes the call rules explain). Coverage: builders with 0 TP 11 → 4 CODESYS, 36 → 29 TwinCAT.
      Divergences: opened `calls_method_recursive` (both); closed none; MEASURED_SILENT −2. design.md §5 rows updated.

### 3.9 flow

- [x] 3.9.1 flow (case-labels, statement-rules, new-in-expression, jump-labels, no-op-statement, empty-block, loop-exit,
      this-super-context): fixtures for case-labels' 5 unfired builders and jump-labels' 2. Where: fixtures/.
      Acceptance: list here. Depends on: 3.8.5
      **Fixtures (2026-10-06), 35** — `semantics/flow-rules.ts`. Of the scratch census's unfired builders only
      `caseOverlappingRanges` was still at 0 TP (0.3; jump-labels' fire). case-labels `flw_case_overlapping_ranges`,
      `_ranges_touching`, `_range_inside_range`, `_label_before_range`, `_duplicate_in_list`, `_constant_beside_value`,
      `_enum_duplicate`, `_label_beyond_byte`, `_variable_range_bound`, `_real_label`; jump-labels `flw_jmp_label_duplicate`,
      `flw_jmp_undefined`, `flw_jmp_to_variable`, `flw_jmp_into_loop`, `flw_jmp_label_other_case`, `flw_label_unreferenced_two`;
      statement-rules `flw_assign_input_constant`, `flw_exit_in_if_outside_loop`, `flw_continue_in_case_in_loop`; no-op
      `flw_noop_array_element`, `_this_member`, `_typed_literal`, `_property_read`, `_enum_value`; empty-block `flw_empty_else`,
      `_elsif`, `_semicolon_body`, `_comment_body`; loop-exit `flw_for_byte_to_255`, `flw_for_int_down_to_min`,
      `flw_for_usint_by_two_to_255` (`execSkip`: an endless loop never finishes its scan); this-super `flw_this_in_function`,
      `flw_super_in_program`, `flw_super_in_method_no_base`, `flw_this_in_action`. new-in-expression stays unmeasurable on
      CODESYS (the recording device has no memory for dynamic creation).
- [x] 3.9.2 Record 3.9.1, both vendors. Acceptance: CA.1. Depends on: 3.9.1
      **Recorded 2026-10-06** (`record:language`, instance `analysis-conformance`): one batch of 35 per vendor; on CODESYS
      `flw_case_enum_duplicate` again (its selector was named `s`, then `st` — IL operators). `record:exec` CODESYS: 13 of the
      15 that build (`flw_for_byte_to_255`'s "done flag never rose" removed; the three loops are `execSkip`).
- [x] 3.9.3 FPs: lit_time_fraction_ms, cc6_loop_cannot_exit, cc5_new_in_expression (still unmeasurable on CODESYS:
      keep the divergence). Where: checks/flow. Acceptance: CA. Depends on: 3.9.2
      **Done 2026-10-06.** `lit_time_fraction_ms` and `cc6_loop_cannot_exit` left their divergences in frontend-conformance
      (2.8.3, 4.2) and agree; `cc5_new_in_expression` kept (the device has no memory configured for dynamic creation, the IDE
      says that instead). The census had no other flow FP (open 0; the FP(div) of `sig_unknown_word`, `unit_method_override*`,
      `decl_var_generic*`, `lit_enum_typed_*`, `lex_vector_twincat_return_type` are the names/recovery steps' divergences).
      Found by the cells and FIXED test-first: `statement-rules` called a VAR_INPUT CONSTANT written in the body "no valid
      assignment target" — both vendors build it (`flw_assign_input_constant`). Divergences opened: none.
- [x] 3.9.4 Gaps of the group. Acceptance: CA. Depends on: 3.9.2
      **Done 2026-10-06** (colocated tests each). `this-super-context`: SUPER^ CALLED in a PROGRAM is also no call target,
      "… instead of 'SUPER^'" (`flw_super_in_program`, both vendors). `empty-block`: an empty ELSE is said AT the ELSE —
      anchored at the IF, TwinCAT's one-message-per-line policy folded it into the empty THEN's (`cc3_empty_and_noop`'s TwinCAT
      GAP closes). Every case-label, jump-label, no-op, loop-exit cell agreed as recorded (`caseOverlappingRanges` fires,
      1 TP each vendor). Left, named: `flw_case_real_label` — both parsers refuse a REAL CASE label ("No CASE label found")
      and resync; the LSP's CASE parser takes any literal (niche: accepted loss, 0 REAL case labels in the corpora,
      `deferred.lsp`); the census no-op GAPs on IL and refused-word recovery (`cc_il_name_calc`, `ilc_calc_*`,
      `lex_keyword_*_sys_*`, `sysop_*_bare_statement`, `rec_refused_name_cascade_il_word` — the frontend's named niche
      recovery divergences).
- [x] 3.9.5 Close flow. Acceptance: CA.3–4. Depends on: 3.9.3, 3.9.4
      **Closed 2026-10-06** (numbers against the 3.8 state). Group flow: open FP 0 → 0, GAP 10 → 10 CODESYS, 17 → 16
      TwinCAT (ceiling 17 → 16), never-fired builders 1 → 0 / 3 → 2. TP: checkCaseLabels 7 → 16 / 6 → 15, checkJumpLabels 9 →
      14, checkThisSuperContext 13 → 18 / 12 → 17, checkNoOpStatement 178 → 182 / 185 → 189, checkLoopExit 1 → 4,
      checkEmptyBlock 10 → 12 / 9 → 12 (GAP TwinCAT 1 → 0), checkStatementRules 16 → 17 / 15 → 16. Group syntax GAP 33 → 34 /
      81 → 84 (`flw_case_real_label`, `oopb_generic_as_input`: named exceptions, ceilings unchanged).
      **The three steps' shared measurement (3.7–3.9, 2026-10-06).** Totals: TP 5442 → 5544 / 6645 → 6739, FP 117 → 119 /
      346 → 383 (every new one a divergence: `calls_method_recursive`, TwinCAT's `oopb_generic_*`), open FP 0, GAP 466 → 479 /
      809 → 829, unowned 79 → 81 / 112 → 114 (each rise a new niche cell, a named ceiling exception in `test/frontend/baseline.ts`);
      corpus unchanged. `rate:fixtures`: confirmed 2756 → 2768, refused 1904 → 1967, not-lowered 350 → 367 (ceiling named:
      JMP/label, bare expression statements, INI/__QUERYPOINTER, addresses of bits, a method's output bound to the call's
      own variable, mutual recursion), lsp-gap 75 → 75 (−`op_sys_queryinterface`, −`callarg_no_argument_variable_default`,
      +`flw_case_real_label`, +`oopb_abstract_pointer_deref_assign`), unaskable 87 → 90. Frontend baselines: the new
      fixtures' counts, named type-dump / parse-census / literal-agreement exceptions for the cells above; source map
      RENAMED_TARGETS 38 → 41 (`calls_queryinterface_legal`, the documented `match` class). `test/conformance` 6069 pass,
      0 fail; agreement CODESYS 4809, TwinCAT 4719 of 5272. design.md §5 rows updated.
      **Gate review (3.7+3.9, 2026-10-06)**, each test-first; the unmeasured shapes recorded first, one batch of 7 per
      vendor (`record:language`, instance `analysis-conformance`, TwinCAT on Project13; `record:exec` CODESYS: the 1 that
      builds) — `calls_inout_unbound_unknown_named`, `_mixed`, `calls_inout_given_input_missing`,
      `calls_inout_unbound_interface_method`, `calls_default_local_constant_shadows_global`, `calls_sqrt_of_string`
      (`calls/call-rules.ts`), `flw_super_in_function` (`semantics/flow-rules.ts`). Findings:
      (1) `method-signature`: an interface method INHERITED from the base put its findings at the BASE unit's spans — in a
      workspace another file's offsets; said now at the derived FB's IMPLEMENTS name (CODESYS records them unpositioned,
      line 0). The duplicate risk (the base implementing the same interface reports at its own method too) is unmeasured
      and left: the two findings now sit in different files. (2) `call-arguments`, in-out beside an unknown named input:
      both vendors say only the unknown name — the LSP already did; HEAD's "must be assigned" was the wrong one. A MIXED
      call's in-out left out is the count ("exactly '3'", both) — fires now; a mixed call's missing input alone stays
      unasked/silent. (3) the in-outs count among a FUNCTION's inputs whichever argument is missing (`F(io := v)`: "exactly
      '2'", both) — fixed; with defaults beside an in-out the range bounds count them alike (unasked). (4) an INTERFACE
      method's in-out left out is the count too ("Function 'M' requires exactly '1' inputs", both — the review's "probe"
      was the LSP's own answer) — fixed. (5) a default is judged in the CALLEE's scope: its VAR CONSTANT shadowing a global
      VARIABLE builds on CODESYS (TwinCAT requires every input anyway) — fixed. (6) SQRT(STRING): "Cannot convert type
      'STRING' to type 'LREAL'", both vendors — the test cites the recording now. (7) SUPER^ called in a FUNCTION: both
      messages, both vendors — as implemented; a colocated test added. (8) `empty-block` looks the ELSE keyword up only for
      an empty ELSE; `declaresAnything`'s doc comment back on it; the ANALYSIS_NICHE comments joined.
      **Gate numbers** (full suite, `VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`): 8299 pass, 0 fail, 35 skip, 411 todo (8745
      tests, 205 files); agreement CODESYS 4816, TwinCAT 4726 of 5279 (all 7 new cells agree). Census: TP 5544 → 5552 /
      6739 → 6748, FP and GAP unchanged (checkCallArguments 113 → 118 / 114 → 120, checkThisSuperContext 18 → 20 / 17 → 19,
      checkIntrinsicOperands 37 → 38 / 31 → 32). `rate:fixtures`: confirmed 2768 → 2769, refused 1967 → 1973, not-lowered
      367, lsp-gap 75, unaskable 90 unchanged. Frontend baselines: the new fixtures' counts; type-dump's named exception
      takes `calls_sqrt_of_string` beside `calls_sqrt_of_bool`.

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
