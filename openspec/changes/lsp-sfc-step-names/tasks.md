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

- [x] 3.1 Fixture clean; a real typo (`S_Bot`) still reported if the chart is available.
      — The chart is NOT available (`IMPLEMENTATION SFC UNSUPPORTED`), so the spec's second branch holds: DIALECT D40 notes
      why a typo read with a member cannot be reported. Measured by `scripts/measure-sfc-step-names.ts` (2026-10-03):
      the field case (`PRG0_Main` SFC, `S_Boot.x/.t/._x/._t` in its action, `PRG0_Main.S_Boot.x/.t` from an ST program)
      0 errors — the PLCAssist `'S_Boot' is no component of 'PRG0_Main'` is gone. Typos: `S_Bot.x` inside 0 errors and
      `PRG0_Main.S_Bot.x` outside 0 errors (the bet's price — `sfc_step_typo` / `sfc_step_typo_qualified` held as known
      divergences, CODESYS refuses both); `S_Bot.y` 2 errors, reported but worded as a step's (`'y' is no component of
      'SFCStepType'`, `sfc_step_typo_other_member`); `S_Bot` bare 2 errors, `Identifier 'S_Bot' not defined` as CODESYS;
      `S_Boot.x` in an ST POU 2 errors, `Identifier 'S_Boot' not defined` as CODESYS. Corpora: 2 SFC POUs (the
      `VltFixtureSfc` stubs, CodesysTestProject + twincat-project14), 0 errors on each diagnosed alone (a one-file project), no code reads a step (a grep). Fixtures
      (`VOLT_FIXTURES` = the 80 `sfc_step_*`): 67 pass, 6 skip, 48 todo (expected failures), 0 fail;
      `SFC_STEPS_NOT_IN_SCOPE` 8 entries, none matching. No product code changed.
- [x] 3.2 Conformance suite green.
      — `bun test test/conformance` (whole, no VOLT_FIXTURES, rustc cache on), 2026-10-03: 5949 pass, 337 todo, 0 fail
      (6286 tests, 13 files, 211 s); rust 2688 compiled+run, 352 more compiled. Ratings unchanged from gate 2: confirmed
      2713, refused 1781, not-lowered 337, lsp-gap 73, diverges 5, unaskable 68; LSP-only 0 on both vendors.
      Typecheck clean.
      (Measured on a tree that also held another workflow's uncommitted `grammar/units.ts` and `codesys.build.json` changes
      — bridge-refusal-review 3.6 — so these numbers describe that tree; 3.3's gate is the one run on the commit's own tree.)
- [x] 3.3 Gate step 3 — the review's three findings:
      - **the field's own shape was never recorded** (medium): the field read was SELF-qualified (`PRG0_Main.S_Boot` at a
        line of PRG0_Main.prg itself), and 3.1 measured it only from another program. S3 now has it, recorded in ONE
        `record:exec` run (2026-10-03): `sfc_step_qualified_self` (`PRG.S_Boot.x` / `.t` in the SFC program's own action)
        BUILDS on CODESYS (TRUE, TRUE) and the LSP is silent — agreement, rated not-lowered (an SFC body has no ST to lower);
        `sfc_step_qualified_self_typo` (`PRG.S_Bot.x` there) is REFUSED ("'S_Bot' is no component of 'PRG…'"), the LSP
        silent — the bet's price as from outside, niche: accepted loss (0 occurrences in the corpora): `deferred.lsp` and
        `SFC_STEPS_NOT_IN_SCOPE` (8 -> 9). `scripts/measure-sfc-step-names.ts` gains the shape: self-qualified 0 errors,
        its typo 0 errors. **The 'field FP gone' claim is conditional** and now says so: the bet needs the file's
        `IMPLEMENTATION SFC UNSUPPORTED` line; the same program WITHOUT it (a pull from before 2026-09-28's keyword line)
        still gives 5 errors, among them the field's `'S_Boot' is no component of 'PRG0_Main'` (measured, new case in
        the script). Whether the PLCAssist text carried the line is not known here — a re-pull gives it.
      - **foreign changes in 3.2's tree** (low): written under 3.2. This gate ran in a clean worktree at HEAD with only
        this step's paths copied in (`units.ts` / `codesys.build.json` left out, uncommitted, not staged).
      - **corpus SFC POUs diagnosed alone** (low): reworded, not changed — the script and its README row say "diagnosed
        alone" (a one-file project, no libraries, not the corpus run's answer); that no other code reads a step is a grep
        (`VltFixtureSfc.` over test-corpus: 0 hits). Count re-checked: 2 `IMPLEMENTATION SFC UNSUPPORTED` among 17 hidden
        bodies (3 CFC, 2 FBD, 10 LD, 2 SFC).
      Ratings: not-lowered 337 -> 338, lsp-gap 73 -> 74 (ceilings raised FOR MEASUREMENT, comments in `fixtures.test.ts`);
      front-end baselines count-only (`VOLT_WRITE_BASELINE=1`: fixture files 9954 -> 9958, CODESYS known-divergence files
      394 -> 396, SFC files not measured CODESYS 96 -> 98 / TwinCAT 160 -> 164, push-refused without parse error CODESYS
      54 -> 55 / TwinCAT 94 -> 96), no finding moved.
      Gate (clean worktree, the commit's tree): typecheck clean; full `bun test` (VOLT_REQUIRE_FULL=1, no VOLT_FIXTURES,
      rustc cache on, 2% re-proved) 8050 pass, 34 skip, 382 todo, 0 fail (8466 tests, 207 files, 366 s); rust 2688
      compiled+run, 352 more compiled; fixture map regenerated (`rate:fixtures`: confirmed 2713, refused 1781, not-lowered
      338, lsp-gap 74, diverges 5, unaskable 68); LSP-only 0 on both vendors.
