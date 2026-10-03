## 1. Test red

- [x] 1.1 Conformance fixture: an SFC program with steps, whose ST (transitions/actions/other POU code) reads
      `<Step>.x` and `<Step>.t`. Today: `unknown-member`. CODESYS build: clean.
      — `test/conformance/fixtures/names/sfc-steps.ts`: 22 fixtures, rules S1–S12, recorded by `record:exec` (the push
      cannot create an SFC body; the recorder creates the POU in SFC and names the default chart's one step `S_Boot`
      through CODESYS's PLCopen export/import). CODESYS builds 11 and refuses 11. The LSP errs on 10 of the 11 that build
      (`KNOWN_DIVERGENCES.codesys` `SFC_STEPS_NOT_IN_SCOPE`, run as expected failures by the run-oracle row), agrees on
      4 refusals (`S_Bot` typo inside and qualified, a step name outside its POU, `SFCInit` undeclared) and words 7
      refusals differently (`deferred.lsp`). 0 SFC charts with steps in the six corpora.
- [x] 1.2 Gate step 1 — the review's five findings, each fixed:
      - **bound census exclusion reached past SFC** (medium): `test/frontend/bound-census.ts` now takes only an SFC fixture
        (`sfcStep`) with no answer out of the measurement; the 45 other push-refused fixture/vendor pairs (17 CODESYS, 28
        TwinCAT) are measured again — fold-dump `twincat: decl does not fold` 626 -> 633 and `decl folds` 2976 -> 2985,
        type-dump `twincat: literal untyped, in a body that did not parse` 361 -> 363, back to what they were. Key renamed
        `SFC files the push refuses, no build or refusal recorded, not measured`: CODESYS 82, TwinCAT 140.
      - **no `Init` step** (medium): S13, 3 fixtures with sfcStep `Init` (no rename). CODESYS binds `Init.x` to the step
        (`init_flag` builds, TRUE/TRUE), refuses `Init.t` into an INT and `Init.y`. The LSP is silent on all three — it binds
        bare `Init` to Component Manager's enum member (LB2): the two refusals are `SFC_STEPS_NOT_IN_SCOPE` + `deferred.lsp`;
        `init_flag` is silent for the wrong reason, noted on the fixture (no mark can hold a silent answer) — 2.1 must give
        the step precedence over that enum member.
      - **one SFC flag only** (low): S11 made systematic — all 13 flags (9 BOOL, 4 STRING) undeclared (12 new), declared
        with their type (12 new), declared with another type (13, incl. `SFCInit : INT`), and each STRING flag into an INT
        (4). CODESYS: undeclared is unknown; declared with ANY type builds as the ordinary variable (flag use is disabled
        in the default settings); STRING into INT is the plain conversion refusal. The LSP agrees on all 41.
        `SFCErrorAnalyzationTable` not asked (its element type and bounds would be guessed) — written in the file.
      - **no shadowing case** (low): S14, 4 fixtures, each its own step name (a global of another fixture's step name would
        make that fixture depend on this one). CODESYS binds the STEP in the action over a GVL global, a project enum member
        and a FUNCTION of the same name, and the global in PLC_PRG (k = 7). The LSP: silent on the global and the
        FUNCTION (noted), errs on the enum member (`shadow_enum_in_action`, marked `SFC_STEPS_NOT_IN_SCOPE`).
      - **sfcStep contract only at record time** (low): `requireSfcStep` in `support/fixture-units.ts`, asked by
        `withDependencies` (every suite path) and `fixtureUnits`; `support/fixture-units.test.ts` red first (both shapes
        assembled silently), green after.
      48 new fixtures (70 SFC in all), recorded in ONE `record:exec` run: 30 build, 18 refuse. Ratings: not-lowered 300 ->
      330, lsp-gap 72 -> 74 (ceilings raised FOR MEASUREMENT, comments in `fixtures.test.ts`); the rest refused. Known
      divergences `SFC_STEPS_NOT_IN_SCOPE` 17 -> 20.
      Gate: typecheck clean; full `bun test` (VOLT_REQUIRE_FULL=1, no VOLT_FIXTURES) 8031 pass, 34 skip, 374 todo, 0 fail
      (8439 tests, 206 files, 301 s); fixture map regenerated (`rate:fixtures`: confirmed 2713, refused 1777, not-lowered
      330, lsp-gap 74, diverges 5, unaskable 68).

## 2. Fix

- [ ] 2.1 Resolve step names (and implicit step members) for SFC POUs; or, where the chart is not available, do not
      report `unknown-member` on possible step names. Record which in DIALECT.md.

## 3. Verify

- [ ] 3.1 Fixture clean; a real typo (`S_Bot`) still reported if the chart is available.
- [ ] 3.2 Conformance suite green.
