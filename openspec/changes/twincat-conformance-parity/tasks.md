# Tasks

## The four fixes that make a live run survivable — all landed 2026-09-20

- [x] **One server per pipe name** (`Volt.Wire/PipeServer`). A named mutex across processes plus a static
      served-names set within one — mutex ownership is re-entrant per THREAD, so the cross-process half alone
      does not cover two hosts in one process, which the test caught on the first run. Both vendors get it; the
      existing catch arms in both hosts were written for this and had never fired.
- [x] **`ide.ps1` recognises its OWN worker** — the spawned process must still be alive AND the log line newer
      than it. Either check alone passes in one of the two failure modes.
- [x] **The recorder checkpoints every 25 fixtures**, with `--resume`. Proven within the hour: the next kill
      (the OOM killer, on memory another project was holding) cost zero of 995 recorded fixtures.
- [x] **The pristine PLC_PRG is derived, not observed** (`markImplementations(plcPrgSource({}))`), plus a sweep
      of fixture POUs a killed run left behind. Blast radius computed rather than assumed: only a fixture that
      sets NEITHER `plcPrgVar` nor `plcPrgBody` builds against the restored text — 8 in 2530, 6 recorded, and
      those 6 are exactly the 6 that showed contamination. Re-recorded clean, all 6 now match CODESYS exactly.

## The recording

- [ ] Finish the full run (1190/2530 at the last checkpoint) with one worker and the connector stopped.
- [ ] Verify the result before adopting: zero cross-fixture references (a diagnostic naming a POU that belongs to
      another fixture), and a fixture count that matches `ALL_TESTS` minus `recorderSkip`.
- [ ] Adopt with `--write`.

## Serve a COPY, not the committed fixture

- [x] Run against a scratch copy outside the repo. The IDE — not the recorder — writes the project it serves to
      disk continuously, so pointing `ide.ps1` at `-Fixture 14` means every recording and e2e session dirties
      tracked files. It was swept into a commit today and had to be amended out, which is exactly what
      [[never-git-add-all-during-e2e]] is about. Copied out of the repo under the system temp dir and served
      by `.sln` path; the repo fixture is untouched from here.
- [ ] **Make that the default.** `-Fixture 13|14|both` serves committed projects IN PLACE and the scratch path is
      opt-in behind a full `.sln` path — which is backwards, since in-place is the option that can damage the
      repo. `13`/`14` should copy to a work directory first and serve the copy; a caller who genuinely wants the
      committed tree can say so. The same applies to the CODESYS fixture (`CodesysTestProject.project`), which
      `record-exec.py` already copies for exactly this reason — the pattern exists, it is just not used here.

## What the recording is FOR

- [ ] Raise the TwinCAT replay floor from 266 to what the fresh recording supports, with the jump explained in
      the same style as the CODESYS floor's history.
- [ ] Re-check every `KNOWN_DIVERGENCES.twincat` entry against the fresh data. Today there are two
      (`op_sys_varinfo`, `operand_uchar_literal`) and both cite measurements from before 2250 fixtures existed.
      One of them (`op_sys_varinfo`) is recorded as a BRIDGE truncation bug to fix and re-record, not an LSP
      divergence — so it is a product task hiding in a mask.
- [ ] Report the vendor comparison as a number the suite can quote: on the overlap it is currently 96.1% identical
      verdicts. Decide whether that belongs in `fixtures.test.ts`'s report or in a script.

## Closing the triage backlogs — one family at a time, root cause first

- [x] **The string-constant family (10 entries).** Closed WITHOUT touching the LSP: TwinCAT's driver joined lines
      onto a message while its quote count was odd, and a complete message can have an odd count because what it
      quotes is ST source full of string literals. It swallowed the error list's path echo and the build log, so a
      family of warnings TwinCAT reports IDENTICALLY read as divergence. Backlog 79 -> 69, agreement 2200 -> 2203.
      The cheapest vendor difference to close is the one that was never real.
- [ ] **The platform-width family (9 entries) — INVESTIGATED, deliberately not "fixed".**
      `__XINT`/`__UXINT`/`__XWORD` resolve by TARGET WIDTH. CODESYS records LINT/ULINT/LWORD, TwinCAT records
      DINT/UDINT/DWORD, consistently across all 18 `plat_*` cells, and the LSP hardcodes the 64-bit half. Both
      `elementary.ts` and the fixture family say "Volt has no 32-bit device to record against" — **that premise is
      now false** and both notes are corrected.
      - It is NOT a vendor property and must not become a vendor branch: TwinCAT ships x64 runtimes, CODESYS ships
        32-bit PLCs. Keying on vendor would be right for these two fixture projects and wrong in principle.
      - The decider is the DEVICE. The exec oracle's is `CODESYS Control Win V3 x64` and says so in its NAME; the
        TwinCAT project carries no marker and takes the 32-bit default. Only 1 of the 6 corpus projects has a
        device name carrying bitness, so the width is usually not discoverable as things stand.
      - Exposure today is NIL and measured: all 1833 corpus uses (`__XWORD` 1570, `__UXINT` 193, `__XINT` 70) are
        inside `Library Manager/`, which the server skips. The 9 TwinCAT false positives are the whole cost.
      - The fix is one rule with no vendor branch: take the width from the project's target, and say NOTHING when
        it is not knowable. It needs a way to know the target, which is `device-tree-exposure` work, and it trades
        ~9 agreement points for removing a class of false positive. That trade is a decision, not a cleanup, which
        is why this task is open rather than done.
- [ ] The remaining ~60, by family: the atomics, `__POSITION`, the unnamed network-text target, IL-operator
      casing, and the individually-named rest. Each wants the same treatment — ask whether the vendors really
      differ before teaching the LSP that they do.

## The transport decision

- [ ] Measure `volt push` + `volt build` per fixture against the raw-wire path (~3s/fixture) on a batch of ~50.
- [ ] If it is within a small factor, replace the recorder's hand-rolled client with the CLI. It was the common
      factor in two of today's failures, and `CLAUDE.md` argues the tier should drive the IDE the way a user
      does. If it is not, write down the number and why the bespoke client stays.

## Known-stale things this touched

- [ ] `scripts/record-language.ts` said it "speaks the raw HTTP wire" — there is no HTTP wire and has not been
      since the move to named pipes. FIXED in passing; listed so the class is visible.
- [ ] The `live-tc-snapshot-was-stale-bridge` memory referenced `bun run diff:vendors` (`scripts/diff-vendors.ts`)
      as the tool for comparing the two recordings. It does not exist. Either write it or drop the reference —
      the comparison is worth having as a script rather than an ad-hoc query each time.
