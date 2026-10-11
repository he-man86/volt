## 0. Design gate

- [x] 0.1 Design the table row shape (fact id, item types, vendor applicability, reader, DIALECT row) and the vendor
      core interface (`create` / `read` / `cleanup` per row) in a short `design.md`; show that every fact the proposal
      lists fits one row without a fact-specific code path. A fact that does not fit is a design finding, not a new
      script.
- [x] 0.2 Decide the `[PROBE: <fact-id>]` marker spelling in `DIALECT.md` and mark every row the proposal lists (not the
      deferred N-rows).
  - Gate (2026-10-11): 25 facts, 29 `[PROBE: …]` markers, C29–C33 filed; `check-wiring.ts` row parser accepts the marker.
    Five review findings were taken, all doc-only, so there is no failing test to write first (the 1.1 gate is the
    test, and it is task 1.1). (1, high) C2n and C24 did not fit one fixture: the step set gained `find`,
    `open{fixture}` and `close`. C2n opens Pro2193 and finds its objects; the NVL is refused by name (no committed
    fixture holds one). C24 is an open/close switch read with `same`. (2) Every write names `via: "push" | "script"`,
    with no default, and each vendor session serves the shipped pipe. (3) C2j gained `parse`, C19b `xml` (three
    units), the create order and the priority uniqueness, and C2e the text-list enum, `parent` and the
    build/negative control. (4) DIALECT C33 is now "recorded, not kept" (no log; the first-create-refused
    ambiguity); C30's headline no longer claims int 0, and the `task-kind` row tries it. (5)
    `empty-folder-lifecycle` became `empty-folder-survives` in the prose.
    Numbers: `bun run check` 18 passed / 0 failed; Repo.Gates 136/0; Engine.Tests 2307 passed / 1 skipped / 0 failed;
    `openspec validate` valid; typecheck: control/desktop/cli/vscode 0. lsp-iec fails at
    `test/frontend/baseline.ts(852)` `STRING_INDEX_TASK`. That file is in a parallel session's uncommitted
    volt-lsp-iec work, outside this step's paths and not touched by it. The LSP suites are not this step's: it
    changes no LSP file.

## 1. Gate first (offline)

- [x] 1.1 Repo.Gates `VendorFactTableMatchesDialectTests`: every `[PROBE: id]` row has a table row with that id, every
      table row cites an existing DIALECT row; red until 2.x lands the table.
  - Done (2026-10-11): pair-set equality plus the named asserts of design 1.1, and 11 synthetic-input tests of the
    gate's own teeth (all green). The real gate is red for ONE reason: `vendor-facts.table.ts not found (task 2.1)`.
    Repo.Gates 147 passed / 1 failed (that one). DIALECT today: 31 markers on 29 rows (design 1.1's "30" miscounted, fixed at the gate:
    C2e and C19 each carry two). Checked with a throwaway table of design 0.1's 25 rows (deleted): the sets are
    equal, the gate goes green; a wrong citation fails naming both sides.
  - Gate (2026-10-11): three review findings taken, failing tests first. (1) A marker in another case (`[probe: …]`,
    `[Probe: …]`) was dropped silently; `PROBE` now matches case-insensitively, and a `[PROBE` in any cell but the id
    cell is a finding (`A_marker_in_another_case_fails`, `A_marker_outside_the_id_cell_fails`). (2) design 1.1 now says
    31 markers / 31 citations. (3) The DIALECT-only findings (malformed spelling, marker on a retracted row) are checked
    before the table-exists assert and carried in its message (`A_missing_table_still_reports_the_DIALECT_findings`).
    Found on the way: `bun run check`'s citation scan read the synthetic rows' `DIALECT C3` / `C99` as real citations
    (1 failed); the synthetic ids are now N903 / N999, which that scan does not read and DIALECT does not have.
    Numbers: Repo.Gates 150 passed / 1 failed — the one designed red, `vendor-facts.table.ts not found (task 2.1)`
    (design 1.1 "Migration": 1.1 commits the test red, one reason; real DIALECT has no DIALECT-only finding);
    `bun run check` 18 passed / 0 failed; `openspec validate` valid; typecheck control/desktop/cli/vscode 0, lsp-iec
    still fails at `test/frontend/baseline.ts(850)` `STRING_INDEX_TASK` — a parallel session's uncommitted
    volt-lsp-iec work, not this step's paths. No LSP file changed, so the LSP suites are not this step's.

## 2. Build

- [x] 2.1 `scripts/vendor-facts.table.ts` with one row per fact in the proposal (recover each probe's logic with
      `git show b2496efb4b:packages/volt-cli/scripts/<file>`).
- [x] 2.2 The CODESYS core (the runscript half served by `ide.ps1 -RunScript`) and the TwinCAT core (COM on the
      instance's XAE), same interface.
- [x] 2.3 `scripts/vendor-facts.ts <codesys|twincat> [--write]`: own instance (`VOLT_E2E_INSTANCE=vendor-fact-probe`), a
      fixture COPY, every row created / read / cleaned up, the snapshot as sorted JSON, a diff against the committed
      `vendor-facts.<vendor>.json` that fails on any difference.
- [x] 2.4 `scripts/README.md`: the one command, and the rule "a new vendor question is a table row — never a new probe
      script".
  - Done (2026-10-11): 25 rows / 31 citations (the 1.1 gate green: Repo.Gates 151/0); `vendor-facts.codesys.py`,
    `vendor-facts.twincat.ps1`, `vendor-facts.ts` (+ `--only <facts>` for working on a row: runs, compares and writes
    only those); `test/unit/vendor-facts.test.ts` 15 tests (table well-formed per vendor, plan/keys, step-at-a-time run,
    refused subject, absent vendor, cleanup always and never masking the first failure, guid tokens, sort, diff, args).
    Read vocabulary gained `absent` (C2n's NVL, refused by name) and the path segments `$base`, `$methods`,
    `$constructors`, `$enumNames`, `$extension`; `find` gained `under`; step outcomes are recorded for every step
    (the `outcome` read is the `steps` list). Smoke-run live (no snapshot written): CODESYS 9 rows, TwinCAT 8 rows.
    Findings for 3.1: (1) `task-kind` int 0 opens a modal "CODESYS" message box and the run stops there, named by
    the timeout (C30's "int 0 never tried" is now answered: it is a dialog, not a refusal); (2) TwinCAT's C2e
    negative-control build reports no diagnostic on the row's items (the bridge build does not reach the user, or the
    name filter misses it); (3) refusal texts are in the OS locale (Dutch here); (4) one CODESYS `dut-subtype-in-place`
    cleanup hung reopening the run's copy, not reproduced in the next run.
  - Gate (2026-10-11): ten review findings, all taken, failing tests first (`vendor-facts.test.ts` 15 → 30).
    (1, high) TwinCAT lost a build's verdict: the `diagnostics` read is now `{ success, diagnostics }`, and a diagnostic
    that names no item is kept. The live smoke found the ROOT of 2.4's finding (2): on TwinCAT the user was never
    called (the main-program wiring was CODESYS-only), so `@negative` built `success: true`. `main` is now found on both
    vendors (TwinCAT `find` skips a task's same-named 650 call entry, as CODESYS does), and TwinCAT wires it through the
    push (cleanup restores PLC_PRG). Re-run live: `@built` success, nothing; `@negative` success false, `'Purple' is no
    component of 'VLTF_SUBP_ENUM'`. (2) C2e: the p_* tree code and guid @reloaded (606 → 605/607/623, Ids kept),
    607/623 → struct (`q_*`: accepted, codes stay 607/623, a reload re-derives 606), and a build after the IDE-authored
    subject's struct push on each vendor, read with the new `diagnostics{mentioning}` (TwinCAT `'ePRODUCTION' is no
    component of 'E_PACKML_MODE'`; CODESYS 744 messages on the IQSlices users, `'IQSlices.DI_10'` among them).
    (3) C19b: `xml{file}` reads the subject's BACKING file — a 621 publishes no FullPath, so its `.plcproj` Compile entry
    names it; refused by name otherwise. Live: own task and fixture both 100000 (100 ns) / 10000000 (ns) / 10000 (µs).
    (4) C2k: CODESYS FB holding KM → FUNCTION text: signature `Function`, KM kept, KM2 refused; TwinCAT the same through
    the push, plus the FUNCTION+METHOD create rolled back whole; the member pushes are read after each push.
    (5) C2g: broken-text DUT/POU (`None/None` all four steps), interface (`Interface`), GVL (`VarGlobal`), the interface
    set, and `GetLanguageModel()` read through the new `$xmlElements` segment (`data-type` / `pou` / `global-interface`:
    family only). The icon has no per-object read: it is the factory's, one per object type (reflected); the type and
    the interface set stand for it, and a dynamic icon would need an interface. `object.TypeGuid` reads null everywhere,
    as the deleted probe's own log did (`TypeGuid=None`): the `2DB5746D` in C2g came from reflection, not a read.
    (6) a refused push create leaves no handle unless the conflict says `remains`. (7) a refusal records
    `[partiallyApplied]` / `[renamedTo …]` / `[remains]`, and the handle follows a `renamedTo`. (8) a create that raised
    after the object was made answers `made`; the subject is kept (`… (the object was made)`). (9) `serving()` keeps and
    names the last cause, refuses a status the contract does not name; `rebind` goes through it (live: right after a
    CODESYS `open`, `connect` answered PLC_DISCONNECTED once and the old rebind aborted the run). (10) both cores refuse a
    value that will not render whole (> 500 items, nested deeper than two levels) instead of cutting it.
    Live smoke (no snapshot written): TwinCAT `dut-subtype-in-place` 25.6 s, `tc-task-items` 0.8 s,
    `pou-members-follow-text` 9.0 s; CODESYS `dut-subtype-in-place` 96.7 s, `kind-source` 60.6 s,
    `pou-members-follow-text` 2.9 s; every value agrees with its DIALECT row.
    Numbers: volt-cli `bun test test/unit` 54 pass / 0 fail; Repo.Gates 151/0; `bun run check` 18 passed / 0 failed;
    `openspec validate` valid; typecheck control/desktop/cli/vscode 0. lsp-iec fails only in
    `scripts/_scratch-hits.ts`, an untracked file of a parallel session, not this step's paths (no LSP file changed).

## 3. Verify (live)

- [ ] 3.1 Run on CODESYS SP21 and TwinCAT (Project14); commit both snapshots; each recorded value agrees with its
      DIALECT row (a disagreement is a DIALECT finding, recorded before the snapshot is committed).
- [ ] 3.2 A deliberately changed fact (an edited snapshot value) makes the run fail naming the fact and both values.

## 4. Fold-ins

- [ ] 4.1 After `bridge-refusal-review` is archived: its kept probes (proposal, "Fold in") become table rows and are
      deleted; `RefusedNamesMatchTheLogsTests` reads the snapshot (or keeps its logs, decided in 0.1).
- [ ] 4.2 The LD/FBD design decides which deferred `probe-nwl-*` facts become rows.
