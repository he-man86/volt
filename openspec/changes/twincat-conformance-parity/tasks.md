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

- [x] Finish the full run with one worker and the connector stopped. Done twice: once as recorded, and then
      again from scratch once the target turned out to be wrong (below). 2524 fixtures, ~2h45 per run.
- [x] Verify the result before adopting (`scripts/check-recording.ts twincat`): zero cross-fixture references,
      zero dropped rows, every fixture accounted for.
- [x] Adopt. The checker gained a third question while it was at it — **which TARGET was this recorded on?** —
      because the answer is in the recording itself: `__XINT` is as wide as the target's pointer and
      `plat_xint_into_string` names that width in its own error message. A recording that is not 64-bit is
      refused, and that is the only durable guard: the platform is one click in a toolbar and lives in an
      uncommitted `.suo`.

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

- [x] Raise the TwinCAT replay floor from 266 to what the fresh recording supports. **266 -> 2241** over the
      day, in the steps the `FLOORS` comment records; the backlog of LSP-only messages went **79 -> 3**.
- [ ] Raise it again where the LSP now UNDER-reports: TwinCAT warns about a sign crossing in a COMPARISON where
      CODESYS does not (13 `cmp_sign_*` cells, measured on both). Those are misses, not false positives, so no
      gate is red — they are simply 13 agreement points sitting on the table.
- [ ] The `__TRY` family is a new miss and a deliberate one: on `TwinCAT RT (x64)` the device's code generator
      does not support structured exception handling, so nine fixtures that built clean on ARM now record
      "The codegenerator for the current device does not support structured exception handling." Comparing two
      vendors needs ONE target; this is what that costs.
- [ ] Re-check every `KNOWN_DIVERGENCES.twincat` entry against the fresh data. It is eight now, and six of them
      were checked against the fresh recording the day they were added. The two older ones are not:
      `operand_uchar_literal` is closed in principle by the dialect work (the prefix is CODESYS's) and needs
      re-measuring, and `op_sys_varinfo` is recorded as a BRIDGE truncation bug to fix and re-record — a product
      task hiding in a mask, and the apostrophe fix may already have closed it.
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
- [x] **The atomics (13 entries) — closed, and they split three ways.** The x64 re-record separated them:
      - `INDEXOF` (2): both vendors removed it and both say so, differing in nothing but capitalisation. A
        wording entry in `messages.ts`, which is where vendor differences are data.
      - `__COMPARE_AND_SWAP` (4): TwinCAT does not have it, and now neither does the LSP's TwinCAT dialect.
      - `__XADD` (7): the two signatures are MIRROR IMAGES. CODESYS takes the counter's ADDRESS and refuses the
        counter; TwinCAT takes the counter and refuses the address, and hands back the operand's own type where
        CODESYS always returns DINT. Six operand types each, on both recordings. The ARM code-generator crash
        had been hiding all of it.
- [x] **`__POSITION`, and the vocabulary question behind it (15 entries).** `__POSITION`, `__POUNAME`,
      `__COMPARE_AND_SWAP`, `__VECTOR` and the `UCHAR#`/`LDATE#`/`LDT#`/`LTOD#` literal prefixes are CODESYS's
      alone — measured by putting every `__`-prefixed keyword and `<prefix>#` form in the fixtures to both
      compilers, with the present ones listed beside the absent ones in `syntax/tokens.ts`.
      - The LSP reserved them for both vendors, so on TwinCAT it TYPED names that compiler has never heard of.
      - `lex`/`parseSource` take a dialect now, and the PROJECT SCOPE carries it, because name resolution and
        type inference already receive that scope. No check grew a vendor branch.
      - What it does NOT close: the two CODESYS cells. CODESYS types `__POSITION` as a sized string LITERAL
        (`STRING(INT#23)` in a body, `STRING(INT#13)` in a declaration) and the LSP says plain `STRING`.
        `scripts/probe-position-length.ts` pins the size with twelve probes — CONSTANT + digits(line) +
        digits(column), 21 in an implementation and 11 in a declaration, POU name irrelevant — which is enough
        to reproduce the message and not enough to ship: 21 and 11 are unexplained. The simulator can read the
        actual string (`record:exec` records VALUES); that is the next step.
- [x] **Everything else that was never a vendor difference.** Nine string-constant cells where TwinCAT's own
      recording carries the exception its message builder throws below STRING(3); six fixtures that are
      reachability, a project setting or a vendor defect and moved to `KNOWN_DIVERGENCES` with their evidence;
      C0098, a rule NEITHER vendor has, deleted; `MOD` on a BOOL, which both vendors take as arithmetic.
- [ ] **The last three.** `cc3_reference_assign` (TwinCAT reverses the conversion direction — ONE cell, and a
      rule built on one cell is a guess; it wants a fixture family the way `cc_enum_arg_into_*` got one),
      `cc5_deprecated_functionblock_keyword` (the parser's own `unexpected identifier … at file scope`, where
      both vendors say nothing about the header and complain where the missing FB is USED), and
      `ldate_ltod_ldt` (after an unknown literal prefix the two parsers resync differently).

## After the backlog: the agreement number itself

The false-positive gate went to three on TwinCAT and two on CODESYS, and then the interesting number was the other
one — how much of what each vendor SAYS the LSP says back. It was 2203 / 2412 that morning and is **2447 / 2486 of
2561** now. None of it came from inventing rules: every step is a measurement the recordings already held.

- [x] **TwinCAT never says the same thing twice on one LINE.** 111 of 2541 CODESYS fixtures carry a message
      repeated on a single line; the number of TwinCAT fixtures that do is ZERO. Not a rule about any check — it
      is what its error list does — so it collapses once, where the diagnostics leave the analyzer. FIFTY
      fixtures, and no check changed.
- [x] **Six checks were gated on "TwinCAT unmeasured"** — a note written when TwinCAT's recording covered 280
      fixtures. Un-gated: 73 more. An IL operator used as a name cascades identically on both, down to the ten
      messages and their order; `**` and `&` are refused by both, which "may accept either" had guessed away.
      Three more followed (dynamic creation, conditional call, FB_init), each a WORDING difference and nothing else.
- [x] **A bitwise operator computes in the unsigned integer of its width**, so both operands convert in and the
      result converts back out — three warnings on CODESYS for `out := a AND b` with LINT operands, where the LSP
      said nothing because it typed the result LINT. Twelve fixtures on each vendor.
- [x] **Arithmetic meets its operands, and both convert into the meet.** `aUlint MOD aSint` meets at LINT and the
      ULINT operand crosses sign; `aLint + aReal` meets at REAL and the LINT operand loses mantissa. The check had
      only ever looked at SAME-WIDTH pairs. 29 fixtures on each vendor.
- [x] **A one-argument math function hands back the real it was given** (`mathret_*`, twenty new cells, all ten
      functions both ways). The catalog modelled no return type for any of them, so every narrowing through one was
      silent — and a declaration's initializer was only checked when it was a LITERAL, so an initializer with a
      SHAPE converted without a word either.
- [x] **The 32-bit floor on a comparison's sign warning is CODESYS's**, not a shared rule: TwinCAT warns at
      SINT/USINT and INT/UINT too. Thirteen fixtures the LSP was UNDER-reporting, which never makes a gate red.
- [x] **File the device and application facts where they belong.** Nine TwinCAT fixtures (`__TRY` on an x64 device
      with no structured exception handling), five CODESYS ones (`__NEW` with no dynamic-memory pool) and five more
      (`VAR_PERSISTENT` with no persistent list in the application) were sitting in the residue as if the LSP owed
      them a message. It cannot know any of them. The VAR_PERSISTENT five are the clearest case: TwinCAT's project
      HAS such a list and records nothing for the same source.
- [ ] **What is left is mostly parse-recovery shape.** After an unknown literal prefix TwinCAT reports a pair per
      token until the `;` where the LSP reports one pair and resyncs (~15 fixtures); the IL-operator CALL forms
      (`GT(a, b)`) cascade to 78 messages on CODESYS. Both are the parser's recovery, not a rule, and matching them
      would mean a vendor-shaped parser. Measure whether that is worth it before writing any of it.

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
