> Plan, owner 2026-11-05: CODESYS SP21 first, then verify on TwinCAT, then other IDEs in the future. Each step is its own change where it is large.

## 1. Finish the first map

- [x] 1.1 `nwl-box-storage-map`: finish, review, push (archived 2026-11-05).
- [x] 1.2 Move its rows to the row format (design.md) as a committed data file.
- [x] 1.3 The completeness gate: a test reads the census and fails on a member or option with no row.

## 2. Map the rest of NWL on CODESYS SP21

- [x] 2.1 Assign and operand, to the same depth.
- [x] 2.2 Every other class in the census: branch, demux, terminator, network and the rest.
- [x] 2.3 Combinations: `shapes.v2` runs against the map instead of beside it (design.md "Combinations against the map"; the
      states no row covers are the queue in `shapes.v2.coverage.txt`). The queue closed 2026-11-06: every state resolves
      (class-states 0146-0581); design.md "The queue closed" names what stays listed and why.

## 3. Fix what the maps find

- [x] 3.1 Everything silently lost first, then what changes the program and has no text. Carried in from the archived drafts, unmeasured: LD boxes with formal pins (`LIMIT(MN := 0, IN := v, MX := 100)`) store and run as FBD's; whether CODESYS compiles an array-typed FBD wire (`w1 := MOVE(arr); ASSIGN(w1, Q => out);`). Done 2026-11-06: design.md
      "What the 3.1 sweep found".
- [x] 3.2 The open network drafts that the maps settle (`network-empty-pin-value`, `network-function-formal-pins`, `network-lower-coil-in-and-box`, `network-lower-pin-edges-and-output-marks`, `network-unnamed-jump-label`).

## 4. One source of truth

- [ ] 4.1 (`nwl-facts-rerecord` archived 2026-11-06 as superseded by this task.) Fold in what `vendor-facts.*`, `shapes.v2.coverage`, the census outcome table and the DIALECT rows on NWL hold, then close `nwl-facts-rerecord`.
      Open (2026-11-06): `shapes.v2.coverage` holds nothing beyond the map (no uncovered state). No "census outcome table"
      exists in the repo apart from the map itself. The `vendor-facts` NWL rows (N24, N28–N38) measure the PUSHED form and
      TwinCAT, and the map has no pushed-form or TwinCAT rows: those facts have no row and need measuring as rows (or the
      row format needs a pushed source) before they can move. The five LD/FBD states that had no row are rows now
      (class-states 0582-0595, each LD and FBD, the editor's form, all `spelled`): a `SUPER^` call box with and without a
      pin, two MOVE ENOs feeding one AND, `fbs[1](in := a)`, a network holding only a label (alone, and below a coil
      network), `t()`.
- [ ] 4.2 Fold what the shape e2e tests measure (`census-shapes`, `create-shapes`, `stored-shapes`, `uncovered-shapes`, `real-project-shapes`) into the map's tests, then delete them, each with its reason; delete `record-nwl-corpus.py`, `record-nwl-live.py`, `voltprobe.py` after confirming each is unused.
      Open (2026-11-06): `create-shapes`, `uncovered-shapes`, `real-project-shapes` and the report `e2e-graphical-coverage.ts`
      deleted (each case is a map row). `census-shapes` and `stored-shapes` are covered on the CODESYS side since class-states
      0582-0595 (`SUPER^`, two ENOs into one box, an array element heading its call), and kept: they hold the only live pins
      of TwinCAT's refusals of those shapes (`TcUnmeasured`), until 6.1. The three scripts stay: `voltprobe.py` is imported by the `author-*-fixture.py`
      recorders and `vendor-facts.codesys.py`; the two `record-nwl-*.py` record the inputs of the NWL completeness oracles.
- [x] 4.3 `scripts/README.md`, `CLAUDE.md` and `ARCHITECTURE.md` state the one source.
- [ ] 4.4 Clean the previous attempts (owner, 2026-11-05), only after their facts are rows: delete `DIALECT.md`'s NWL rows that moved, its superseded rows and citations of deleted probes; rewrite the history notes in `ARCHITECTURE.md`, `CLAUDE.md`, `scripts/README.md` and `docs/driver.html` to the current state (a mistake worth remembering stays as its one-line rule); delete the network and NWL changes from `openspec/changes/archive`, which git keeps. The other archived changes and the vendor reference docs stay.
      Open (2026-11-06): N43 and D30 deleted, the deleted-probe citations gone, the map named in N21/C18. The other NWL rows
      (N13–N42) each hold a TwinCAT half, a pushed-form fact or a Volt-code fact the CODESYS map has no row for. The archived
      network/NWL change folders are not deleted yet.

## 5. The final language for NWL

- [x] 5.1 One proposal to the owner and Sim-Assist from the map, every rule with its row, following design.md "Language direction" (settled 2026-11-05) and closing its open points.
- [x] 5.2 Build it after the owner decides (`network-language`, archived 2026-11-06).
- [ ] 5.3 `network-text.html` "What it runs as": one row per network-only form and the exact plain ST it runs as, generated from the lowering's rules and gated, each row pinned by a run; it replaces the text in `services/shared/network-meanings.ts` (from `network-rail-and-pin-negation` 2.3).

## 6. Verify on TwinCAT

- [ ] 6.1 Replay the rows and fixtures on TwinCAT; each row is confirmed or gets a measured difference (an irreducible one needs two measured alternatives and the owner's OK).
- [ ] 6.2 Measure each form TwinCAT refuses as unmeasured today, including `.NAME` at a root, the CODESYS-only refusal "an FB box storing call type Function with an output past its names" (6d14fac8c8), an ENO-hidden Execute box and the XAE probe `network-text-one-to-one` 2.0; lift or keep each refusal.

## 7. The guide

- [ ] 7.1 A short guide in `packages/volt-cli/` with the method, the row format, the old patterns and the machine rules, written from what the NWL maps actually taught; correct design.md where they disagree.
- [ ] 7.2 A real-project check at the end: pull and push the corpus projects, and any surprise becomes a new row and fixture.
- [ ] 7.3 Other IDEs: start from the guide when the owner picks one (design.md, "A new IDE").
