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

- [ ] 1.1 Repo.Gates `VendorFactTableMatchesDialectTests`: every `[PROBE: id]` row has a table row with that id, every
      table row cites an existing DIALECT row; red until 2.x lands the table.

## 2. Build

- [ ] 2.1 `scripts/vendor-facts.table.ts` with one row per fact in the proposal (recover each probe's logic with
      `git show b2496efb4b:packages/volt-cli/scripts/<file>`).
- [ ] 2.2 The CODESYS core (the runscript half served by `ide.ps1 -RunScript`) and the TwinCAT core (COM on the
      instance's XAE), same interface.
- [ ] 2.3 `scripts/vendor-facts.ts <codesys|twincat> [--write]`: own instance (`VOLT_E2E_INSTANCE=vendor-fact-probe`), a
      fixture COPY, every row created / read / cleaned up, the snapshot as sorted JSON, a diff against the committed
      `vendor-facts.<vendor>.json` that fails on any difference.
- [ ] 2.4 `scripts/README.md`: the one command, and the rule "a new vendor question is a table row — never a new probe
      script".

## 3. Verify (live)

- [ ] 3.1 Run on CODESYS SP21 and TwinCAT (Project14); commit both snapshots; each recorded value agrees with its
      DIALECT row (a disagreement is a DIALECT finding, recorded before the snapshot is committed).
- [ ] 3.2 A deliberately changed fact (an edited snapshot value) makes the run fail naming the fact and both values.

## 4. Fold-ins

- [ ] 4.1 After `bridge-refusal-review` is archived: its kept probes (proposal, "Fold in") become table rows and are
      deleted; `RefusedNamesMatchTheLogsTests` reads the snapshot (or keeps its logs, decided in 0.1).
- [ ] 4.2 The LD/FBD design decides which deferred `probe-nwl-*` facts become rows.
