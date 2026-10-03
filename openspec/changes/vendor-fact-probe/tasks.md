## 0. Design gate

- [ ] 0.1 Design the table row shape (fact id, item types, vendor applicability, reader, DIALECT row) and the vendor
      core interface (`create` / `read` / `cleanup` per row) in a short `design.md`; show that every fact the proposal
      lists fits one row without a fact-specific code path. A fact that does not fit is a design finding, not a new
      script.
- [ ] 0.2 Decide the `[PROBE: <fact-id>]` marker spelling in `DIALECT.md` and mark every row the proposal lists (not the
      deferred N-rows).

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
