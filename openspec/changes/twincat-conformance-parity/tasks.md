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
- [x] **Made that the default** (2026-09-21). `ide.ps1` copies the selected fixture under the temp dir and serves
      the copy, on BOTH vendors, refreshed on every `up` so it is the committed fixture every time. `-InPlace` is
      the opt-out, for when the changes are the point. It is the pattern `record-exec.py` already used, now where
      every live-IDE session goes through it.

## What the recording is FOR

- [x] Raise the TwinCAT replay floor from 266 to what the fresh recording supports. **266 -> 2241** over the
      day, in the steps the `FLOORS` comment records; the backlog of LSP-only messages went **79 -> 3**.
- [x] Raise it again where the LSP UNDER-reports. The 32-bit floor on a comparison's sign warning turned out to
      be CODESYS's alone — TwinCAT warns at SINT/USINT and INT/UINT too, in all twelve of those cells. Misses like
      that never make a gate red, which is exactly why they sit unnoticed.
- [x] The `__TRY` family is a new miss and a deliberate one: on `TwinCAT RT (x64)` the device's code generator
      does not support structured exception handling, so nine fixtures that built clean on ARM now record it.
      Comparing two vendors needs ONE target; this is what that costs. Filed in `KNOWN_DIVERGENCES.twincat` beside
      CODESYS's `__NEW`-with-no-memory family, because both are DEVICE facts an editor cannot know.
- [x] Re-check every `KNOWN_DIVERGENCES.twincat` entry against the fresh data. Both of the older ones were
      masks and both are GONE: `op_sys_varinfo` was listed as a TwinCAT divergence when the real fault was the
      line-joining bug — the two vendors record it identically now and it agrees exactly — and
      `operand_uchar_literal` is no longer excused either, because with `UCHAR#` absent from the TwinCAT dialect
      the LSP emits a strict SUBSET of what TwinCAT says. What is left there is a miss in plain sight.
- [x] Report the vendor comparison as a number: `scripts/check-recording.ts --diff` prints it — same verdict on
      2464 of 2524, with identical wording on 2264 of those — and it belongs in a script rather than the suite,
      because it is a question about the RECORDINGS and not about the LSP.

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
one — how much of what each vendor SAYS the LSP says back. It was 2203 / 2412 that morning and is **2470 / 2489 of
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
- [x] **A name in a resync cascade is a statement.** `added := ADD(a, b)` is Instruction List, and a VARIABLE in
      the cascade that follows is not echoed back as an unexpected token — it could start a statement, and once
      the compiler supplies the `;` it was asking for that is what it becomes. Twelve "has no effect" warnings per
      fixture that the LSP was not making, with all eleven errors around them already matching.
- [x] **The parse-recovery shapes were the simple case after all.** They looked like they needed a vendor-shaped
      parser; they needed the cascade machine that was already here. `cascadeAfter` reports a pair per token up to
      the `;` — which is what BOTH compilers do after a name they refuse — and an unknown literal prefix is a name
      they refuse. Twenty fixtures, and the only new code is a token SCAN, because `v := LDT#2026-05-09…` leaves
      the statement list EMPTY: the parser gives up at the first stray and there is no AST to walk.
      - It also found a real bug in the cascade: it re-lexed the source WITHOUT the project's dialect, so it read
        `LDATE#2026-05-09` as one CODESYS date literal and quoted a token TwinCAT never saw.
- [ ] **What is left is a long tail on both vendors** — 72 CODESYS fixtures and 91 TwinCAT ones, with no cluster
      bigger than five. `agreement-residue.ts` (either vendor, and honest since it reads the dialect all the way
      down) is the work list. The next one worth taking is whichever family a recording can settle, not whichever
      is largest.

## The transport decision — MEASURED, and the answer is no

- [x] Measure `volt push` + `volt build` per fixture against the raw-wire path. **The CLI is not a transport for
      this job, and the timing was never the reason.** `volt --version` is ~98 ms of process start and `volt build`
      reaches its first check in ~180 ms — costs that would add perhaps eight minutes to a 2524-fixture run, next
      to the ~3.9 s/fixture the run already takes. Cheap enough to be irrelevant.
- [x] What stops it is the MODEL. `volt build` answers "not a Volt workspace — run `volt init` first", because the
      CLI's verbs operate on a git WORKSPACE bound to the IDE: `push` reconciles a whole tree through a git merge.
      The recorder needs the opposite shape — set ONE item, build, read the diagnostics, delete the item, restore
      PLC_PRG, 2524 times, with no tree and nothing committed. Driving that through the CLI would mean creating
      and resetting a workspace per fixture to express a single wire call.
- [x] So the hand-rolled client stays, and the reason is written where it will be read: it is not duplication of
      the CLI, it is the wire without the workspace. (`scripts/bridge.ts` speaks the same named-pipe protocol the
      CLI does — the PROTOCOL is shared, which is the part that matters.)

## Known-stale things this touched

- [x] `scripts/record-language.ts` said it "speaks the raw HTTP wire" — there is no HTTP wire and has not been
      since the move to named pipes. Fixed, and its header now also answers WHY it is not the `volt` CLI.
- [x] The `live-tc-snapshot-was-stale-bridge` memory referenced `bun run diff:vendors` (`scripts/diff-vendors.ts`),
      which does not exist. Written instead as `scripts/check-recording.ts --diff`, which compares the two
      recordings on the build VERDICT and on whitespace-normalised message sets — raw text equality would measure
      spelling, which is the one thing the two vendors are known to differ on.
