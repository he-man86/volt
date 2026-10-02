## 0. Design gate — do this first

- [ ] 0.1 Check every item below against volt's design (CLI/workspace push model, pre-flight vs apply, the no-rollback
      rule in PushService.Reject, related docs and open changes). Record per item: FITS, or CONFLICTS + why + the
      volt-native alternative. Implement only the FITS items; stop and leave the rest for the owner.

## 1. Test red

- [ ] 1.1 Live fixture (CODESYS): push `[create A.<dut kind>, create FB.fb with METHOD Log]`. Today: `accepted:false`,
      reason "2 of 2…" style prose, FB left as an empty shell.
- [ ] 1.2 Pre-flight: a batch with one INVALID_ST item and two valid items. Today: all three refused, nothing written.

## 2. Per-item outcome

- [ ] 2.1 Pre-flight refuses per item: the refused item gets a conflict, the rest go to apply.
- [ ] 2.2 Apply loop: an item the IDE refuses is undone (created object removed / previous text restored) and the
      loop continues with the next item.
- [ ] 2.3 Dependent ops (an op on a name a refused op in the same batch produces or removes) are refused with it,
      with a reason naming the op they depended on.
- [ ] 2.4 Response: any item applied → `accepted:true` + `conflicts` + full receipt; none → `accepted:false`.
      `STALE_PROJECT_VERSION` and a malformed request stay whole-batch.
- [ ] 2.5 `conflicts[].reason` carries no CLI instruction; the CLI renders its own advice from the code.

## 3. Optional pre-flight

- [ ] 3.1 If a live IDE shows a member-name refusal is decidable from the text (e.g. `Log`), add it to pre-flight with
      the measurement recorded; otherwise leave it to 2.2.

## 4. Verify

- [ ] 4.1 1.1 and 1.2 now: the valid items land, the refused one is the only conflict, no shell left behind,
      `refs` matches the receipt.
- [ ] 4.2 CLI push of a partially refused batch updates the baseline for applied items only; full suites green.
