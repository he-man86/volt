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
- [x] **The platform-width family (11 entries) — CLOSED, and not in the LSP.**
      `__XINT`/`__UXINT`/`__XWORD` are as wide as the target's pointer. The CODESYS recording said LINT/ULINT/
      LWORD, the TwinCAT one said DINT/UDINT/DWORD across all 18 `plat_*` cells, and the LSP hardcodes the
      64-bit answer — so it read as a vendor difference and put nine fixtures on the backlog.
      - **It was the fixture project's target platform.** The TwinCAT solution's active configuration was
        `TwinCAT CE7 (ARMV7)` — 32-bit ARM, a Windows CE device nobody meant to measure. Proof, three ways: the
        DTE reported it, `_Boot/TwinCAT CE7 (ARMV7)` is the only boot folder in the project, and the recording
        itself carried `Internal Error (ARM): RiscFrontEnd: Unknown operator` on the `__XADD` fixtures. Its
        sibling fixture project was on `TwinCAT RT (x64)` at the same time, so this was not a default — it was
        one click in a toolbar dropdown, made once, months ago.
      - Switched to `TwinCAT RT (x64)` and re-recorded: TwinCAT answers **LINT/ULINT/LWORD**, identical to
        CODESYS. Eleven entries leave the backlog and the LSP does not change. It never was a vendor property —
        TwinCAT ships x64 runtimes and CODESYS ships 32-bit PLCs — and a vendor branch would have been right
        for these two projects and wrong in principle.
      - **The choice leaves no trace in git**: it lives in an uncommitted `.suo`. So the guard goes where the
        evidence is — `check-recording.ts` now reads the target's pointer width back out of the recording
        (`plat_xint_into_string` names it in its own error) and refuses to adopt one that is not 64-bit.
- [ ] **The atomics (13 entries) — measured, and they split three ways.** One re-record on x64 separated them:
      - `INDEXOF` (2): both vendors removed it and both say so, differing in nothing but capitalisation.
        Closed as a wording entry in `messages.ts`, which is where vendor differences are data.
      - `__COMPARE_AND_SWAP` (4): TwinCAT does not have it — "Identifier '__COMPARE_AND_SWAP' not defined".
      - `__XADD` (5): TwinCAT HAS it with a different signature. Ours (CODESYS's) takes `POINTER TO DINT`;
        TwinCAT's takes the DINT itself, which is why `atomic_xadd_dint` now builds CLEAN there while CODESYS
        refuses it. The ARM internal errors were hiding this — on x64 the front end gets far enough to answer.
      The last two need a VENDOR-KEYED INTRINSIC VOCABULARY, and that is a design decision, not a table edit:
      `__POSITION` and friends are LEXER keywords today (`syntax/tokens.ts`), and the parser bakes in CODESYS's
      token-eating behaviour for them. Making the vocabulary vendor-keyed means `parseSource` takes a vendor,
      which every caller and both conformance harnesses would feel. Worth doing — it is the honest model, and it
      would make TwinCAT's "Identifier 'X' not defined" fall out for free instead of being suppressed — but it
      is a change to propose, not to slip in under a triage item.
- [ ] **`__POSITION` (7 TwinCAT + 2 CODESYS) — measured, still open.** CODESYS types it as a sized string
      LITERAL (`STRING(INT#23)` in a body, `STRING(INT#13)` in a declaration); the LSP says plain `STRING`, so
      the CODESYS cells are false positives too. `scripts/probe-position-length.ts` (new) pins the size with
      twelve probes: **CONSTANT + digits(line) + digits(column)**, CONSTANT = 21 in an implementation and 11 in
      a declaration, POU name irrelevant. That is enough to reproduce the message and NOT enough to ship: 21 and
      11 are unexplained, and a magic number with a provenance note is not a measurement. The simulator can read
      the actual string (`record:exec` records VALUES) — that is the next step. The TwinCAT half is the
      vocabulary question above.

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
