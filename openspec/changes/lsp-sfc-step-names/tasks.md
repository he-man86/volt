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

- [x] 2.1 Resolve step names (and implicit step members) for SFC POUs; or, where the chart is not available, do not
      report `unknown-member` on possible step names. Record which in DIALECT.md.
      — The chart is not available (`IMPLEMENTATION SFC UNSUPPORTED`), so neither option as written: the LSP BETS and
      TYPES (DIALECT **D40**, `src/frontend/types/infer/sfc-step.ts`). A name read WITH A MEMBER in an SFC POU (or through
      an SFC program / instance, `P.X.m`) that the POU does not declare and that names nothing else able to answer a member
      (nothing, an enum member, a FUNCTION, a variable of a memberless type) is a step, an `SFCStepType` (x/_x BOOL, t/_t
      TIME — `types/system.ts`, the IecSfc declaration). Bound in ONE place, `resolveMemberChain`, so typing, the member
      check, the unresolved-identifier check (`resolution.ts`) and `external-write` (a step written through its program is
      "no input of") all follow. Tests first: 10 in `analysis/checks/names/unresolved-identifier.test.ts` (S1–S9, S13/S14,
      a struct global keeps its member, the typo price), 2 in `types/infer/sfc-step.test.ts`. Fixtures: 16 of the 20
      `SFC_STEPS_NOT_IN_SCOPE` cells now answer as CODESYS (10 run-oracle, 6 lsp-gap: unknown member of `S_Boot` and of
      `Init`, `.t` TIME / `.x` BOOL of both, written from outside); the default step `Init` takes precedence over the
      library enum member, the step over a GVL INT / project enum member / FUNCTION. Left, niche: accepted loss (0
      occurrences in the corpora): `sizeof_adr` (a step read bare), `bare_value`, `declared_as_variable`, `action_flag`, and
      the bet's price `typo` / `typo_qualified` (newly marked) — `SFC_STEPS_NOT_IN_SCOPE` 20 -> 6. Ratings: lsp-gap 74 -> 70
      (ceiling lowered), refused 1777 -> 1781. Front-end census taught the step (`dumps.ts` `sfc-step` binding and
      `SFCStepType` type row, `bound-census.ts` base name): counts only, no finding, no ceiling raised.
- [x] 2.2 Gate step 2 — the review's two findings, each recorded first (S16, 4 fixtures, ONE `record:exec` run), then
      fixed with a failing src test first:
      - **bit access through an integer CONSTANT taken for a step** (medium): CODESYS (2026-10-03) builds `G_Wc_sfc.cBit_sfc`
        (a GVL `VAR_GLOBAL CONSTANT`) and `lwBits.cLBit` (a local `VAR CONSTANT`), read and written in an SFC action (TRUE),
        and REFUSES the list-qualified form `gw.GVL.cBit` ("Bit access requires literal or symbolic integer constant") — the
        finding's guess that it builds was wrong, the step bet was still wrong on it. Fix: `sfc-step.ts` `numbersABit` — a
        member that names a CONSTANT in scope, or a global list, numbers a bit and is never a step's. Test: unresolved-identifier
        `SFC: a bit numbered by a CONSTANT …` (SFC and ST alike, red before: `'cBit' is no component of 'SFCStepType'`).
        The qualified refusal the LSP misses in ANY POU (ST too): `sfc_step_bit_const_qualified` `deferred.lsp`, niche:
        accepted loss (0 occurrences in the corpora); the front-end census learns that refusal as an agreement
        (`bound-census.ts` `member NONE, a bit access refused on the vendor too` / `member untyped, …` — 4 each).
      - **THIS^ step write reported external** (low): `sfc_step_this_step` builds on CODESYS (TRUE). Fix: `external-write.ts`
        skips the step branch on a self reference (`isSelfRef(step.base)`). Test: `SFC: an SFC FB writing its own step
        through THIS^ …` (red before: `'S_Boot' is no input of 'FB'`).
      DIALECT D40 updated (80 fixtures, constant bit access, THIS^). Ratings: not-lowered 334 -> 337, lsp-gap 72 -> 73
      (ceilings raised FOR MEASUREMENT, comments in `fixtures.test.ts`), refused unchanged (the one refusal is lsp-gap).
      Gate: typecheck clean; full `bun test` (VOLT_REQUIRE_FULL=1, no VOLT_FIXTURES) 8049 pass, 34 skip, 381 todo, 0 fail
      (8464 tests, 207 files, 285 s); fixture map regenerated (`rate:fixtures`: confirmed 2713, refused 1781, not-lowered
      337, lsp-gap 73, diverges 5, unaskable 68).

## 3. Verify

- [ ] 3.1 Fixture clean; a real typo (`S_Bot`) still reported if the chart is available.
- [ ] 3.2 Conformance suite green.
