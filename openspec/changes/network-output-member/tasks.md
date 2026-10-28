## 1. Census and design

- [x] 1.1 Count on the models (scratch, as network-text-st 1.1): every box shape the rule must spell — ENO shown and
      unwired while the value chains; ENO shown and not chained at a root; EN shown on an FB; an FB with one output;
      a box at a root (no chaining output: no `.X`); `Dryer`/`WSM`-like callees declaring their own `EN`/`ENO`. Decide
      each spelling from the counts; a shape with no spelling is listed, not hidden.
      Done 2026-10-28, counted on the models the shipped readers build, by scratch xunit probes (deleted): the five
      CODESYS corpora (`CodesysNetworkReader` over the hydrated `nwl-corpus` archives, 388 networks, 0 refused; a root
      box's stored `MainOutputIndex` read off the archive, since the model drops it at a root), TwinCAT
      `twincat-project14` (6 networks) and `tc-native-corpus/import` (147), and the 121 accept cases (`StNetworkReader`).
      "Function" below = a named non-FB call: `CallType` Function (113), Program (11) or Conversion (1); MOVE stores
      Move, Execute None, each keyword its own operator (And, Gt, …), an FB FunctionBlock — no box stores Operator.
      "Keyword" = the 14 operator words and NOT. CODESYS corpora unless a vendor is named.
      - Boxes: 1,300 — keyword 907 (891 consumed), MOVE 102 (33), function 125 (92), FB 155 (101), Execute 11 (0).
        Roots: 183 (MOVE 69, FB 54, function 33, keyword 16, Execute 11). TwinCAT: 165 boxes, 21 roots (19 FB and 1 MOVE in
        the native archives, 1 Execute).
      - The chaining output of the 1,117 consumed boxes (+ 144 TwinCAT): keyword 815 bit operators (no stored slot)
        + 63 value + 13 ENO; MOVE 32 ENO + 1 value; function 89 value + 3 ENO; FB 91 first declared output, 2 second
        (`L_FECA.L_FirstFASTErrCapture` ×2, `xErrorActive`), 8 ENO (`ServoControl` 1, `LIN_TRAFO` 7). TwinCAT: 142
        value, 2 TON first output. So 101 consumed FBs on CODESYS (91 + 2 + 8) and 2 on TwinCAT; the proposal's
        "of 103" is corrected to 101 + the 2 TwinCAT TONs (1a).
      - Which outputs CAN chain (corrected 1a): on CODESYS a consumed box that shows ENO is read through its ENO and
        nothing else (DIALECT N16: outputs starting `ENO` are read through it; N21: `MainOutputIndex` is read-only on a
        push and the compiler reads a consumed enabled box Volt builds through its ENO whatever the output list says),
        and 0 boxes in the corpora show ENO and chain their value. So "value + ENO" is ONE chainable output, not two.
        Under "`.X` where more than one output can chain": `.X` required on 37 consumed boxes, all FBs without ENO
        with 2+ declared outputs (35 first output — `WSM` and `Dryer`, which chain their DECLARED `ENO`, are among
        them — and 2 second); one output, so no `.X`, on 1,074 (keyword 891, function 86, FB 64, MOVE 33; 56 of them
        chain ENO: MOVE 32, keyword 13, function 3, FB 8); open on 6 (`RuntimeGuard_V5_1_100`, a function with
        VAR_OUTPUTs beside its value, below). TwinCAT: required on 2 (TON `.Q`), one output on 142.
        Conflicts for 1.2, not decided here: (a) the proposal's `x := GT(EN := c, a, b).OUT` contradicts N16 (an
        enabled comparison has ONE output) — the proposal example is corrected to `x := GT(EN := c, a, b);` (1a);
        (b) the proposal's `MOVE(EN := …, OUT => x).ENO` names the one output an ENO-shown box can chain, which the
        rule as written refuses — yet `.ENO` (or `ENO => v`) is the only text that states the ENO flag, which is
        independent of EN (N16; accept case `function-eno-without-en`). 1.2 must give the ENO flag a spelling that
        does not depend on `.X` being required.
      - ENO shown and UNWIRED while the value chains: **0** (corpora, TwinCAT archives and accept cases alike). Every
        consumed box that shows ENO chains its ENO (56: MOVE 32, keyword 13, function 3, FB 8), as DIALECT N21 says the
        compiler reads it. The reverse, ENO chained with no data output wired: 2 (functions `MainDrive`,
        `Alarms_ResetAlarmLogging`, which store no value output at all). The 40 enabled comparisons show EN without ENO
        and chain their value: one output, no `.X` (`x := GT(EN := c, a, b);`).
      - ENO shown at a root: 128 (MOVE 69, FB 16, function 16, keyword 16, Execute 11), TwinCAT 1 (Execute). `ENO => v`
        at a root: 0 (only the accept case `eno-wired-top-level`). Proposed: a root box with EN AND ENO shown is
        `f(EN := c, …);` with nothing after it; `ENO => v` stays the one spelling of a wired ENO.
      - EN without ENO, or ENO without EN, at a root (counted 1a, every kind): 0 in the corpora (all 128 ENO roots show
        EN too; the other 55 roots — FB 38, function 17 — show neither), 0 in the TwinCAT archives (the 20 native roots
        state neither, project14's Execute both). Accept cases: 3 — `move-enabled` (`MOVE … en:c`, no ENO),
        `function-eno-without-en` (`(f IN=b eno:1)`, no EN; recorded building on both vendors) and `execute-enabled`
        (`%EXECUTE(EN := TRUE)`, no ENO). The root spelling above cannot state either shape: `f(IN := b);` drops
        `eno:1`, and `f(EN := c, …);` reads the same with ENO shown or hidden — a silent loss on a round trip. Listed,
        no spelling yet: 1.2 gives the ENO flag a spelling of its own (the same gap as conflict (b) above).
      - Stored `MainOutputIndex` at a root (183, recounted 1a): 0 on 172, null on 10 (the FBs with no output and no ENO: nothing to point
        at), **1 on 1** (`L_FECA.L_GetErrorTextFromFileReadArray`, a moved pin on a box nothing reads). The root rule
        (no `.X`) cannot spell that one; the network-text-st text drops it too (a root box records no connected slot),
        and the index is read-only on a push (DIALECT N21). Listed: 1 occurrence; 1.2 decides spell vs niche.
        TwinCAT archives store no `MainOutputIndex`.
      - EN shown on an FB: 24, every one with ENO (8 consumed, all chaining ENO: 7 into a next box's EN, 1 into a data
        pin; 16 at a root). EN without ENO, or ENO without EN, on an FB: 0 in the corpora and the archives (accept cases
        `fb-call-enabled-read-by-name`, and `fb-call-read-through-declared-eno` below).
      - FB declared data outputs: 1 on 72 (64 consumed: 56 without ENO, where `.Q` is refused, and 8 with ENO, where
        only ENO can chain, so one output), 2 on 41, 0 on 15 (all roots), 3–40 on the rest. TwinCAT: 19 one-output FBs, all roots.
        Consumed FB `MainOutputName`s: `Q` 77, `Q1` 6, `xDone` 3, `ENO` 2, `xErrorActive` 2, `OUT` 1 (BLINK's declared
        output), 2 others.
      - Callees declaring their own EN/ENO (flag not shown): 2 boxes, lenze-mid only. `IDB_WSM : WSM` declares an `EN`
        input (slot 0, wired as an ordinary pin) AND an `ENO` output; `IDB_Dryer : Dryer` declares `ENO`. Both are
        consumed and chain that declared `ENO` (`MainOutputName` `ENO`, output #1 of 9 / of 7). Under the rule as
        written, `EN :=` would read as a SHOWN EN and `.ENO` as a SHOWN ENO: the declared pin and the shown flag
        collide in one spelling. No spelling yet; 1.2 must decide (2 occurrences).
      - A function's stored value name: `''` on MOVE and drawn keyword boxes (194), `'   '` (three spaces) on 97 user
        functions, `'Out1'` on all 43 TwinCAT importer boxes, none on 17 (functions with no value: program calls such
        as `GeneralProgramFlags`, VOID functions). No box stores `OUT`: `.OUT` is a Volt name for the value, not the
        stored one, so "1:1 with NWL" holds for `.X` on FBs and `.ENO`, not for `.OUT`. 1.2 says so.
      - Functions with VAR_OUTPUTs beside the value: 10 (lenze-mid): `RuntimeGuard_V5_1_100` ×6 consumed, all chaining
        the value (slot 0); `SidecorrectionCalculation` (3 outputs, no value) consumed by its ENO; 3 at a root. No
        function was seen chaining a VAR_OUTPUT. Whether CODESYS lets a function's VAR_OUTPUT be the chaining output
        (then `RuntimeGuard` ×6 would need `.X`) is a 1.2 measurement.
      - Other: `???` instances 4, all roots (`FB := ???` needs no `.X`). Execute boxes: 11 + 1 TwinCAT, all roots
        showing EN and ENO; consumed only in the accept cases (4).
      Finding for 2.1: the accept case `fb-call-read-through-declared-eno` (`Dryer` declaring ENO) models the declared
      ENO as a SHOWN one (`eno:1`), while the CODESYS reader reads the real `IDB_Dryer` box as not shown (`Eno` flag
      false, `ENO` as data output #1, network-text-st 1c). The case and the vendor model disagree; the re-spelled case
      set must follow the reader.
- [x] 1a Review of 1.1 (2026-10-28), recounted off the `nwl-corpus` archives (scratch Python, deleted) and the
      TwinCAT native archives: (1) roots are 183, not 232 (69+54+33+16+11; 1,117 + 183 = 1,300), and the stored
      `MainOutputIndex` at a root is 0 on 172 (not 220), null on 10, 1 on 1 — fixed above. (2) EN-xor-ENO at a root:
      0 in the corpora and archives, 3 accept cases; the root spelling cannot state it — listed above, to 1.2. (3) An
      ENO-shown consumed box has ONE chainable output (N16/N21): `.X` required on 37 (not 93), one output on 1,074,
      open on 6; the GT `.OUT` example in proposal.md corrected, the `.ENO` conflict listed for 1.2. The finding's
      "37 + the 2 declared-ENO callees" counts `WSM`/`Dryer` twice: both are among the 35 multi-output FBs chaining
      their first declared output (`ENO`), so the total is 37. (4) "`CallType` Operator" replaced by the stored
      values (Function 113, Program 11, Conversion 1, Move, None, the operators). (5) proposal.md: 101 consumed FBs
      on CODESYS (91 + 2 + 8), the 2 TwinCAT TONs named beside them.
      Gate (docs only, no code or fixture changed, so no map regeneration): typecheck clean; LSP full suite
      (VOLT_REQUIRE_FULL=1) 10,237 pass / 0 fail / 36 skip / 431 todo; Volt.Engine.Tests `~Network` 368/368.
      `openspec validate` still reports no spec delta (none exists yet; 1.2 writes it).
- [ ] 1.2 design.md: the rule, the member names (`OUT` for a function's value, the declared name for an FB output,
      `ENO`), when `.X` is required (more than one output can chain) and when it is refused (only one can), a declared
      `EN`/`ENO` pin vs the shown EN/ENO, the root rule; measured in CODESYS through the exec twin where behaviour is
      new.

## 2. Build

- [ ] 2.1 C# writer + reader (`StNetworkWriter`/`StNetworkReader`): one name per box, `EN :=`, `.X`, `FB :=`; suffixes
      and the FB statement form deleted. Round-trip oracle on the corpora, TwinCAT archives and accept cases: tallies
      no worse than network-text-st's (CODESYS corpora 0 `%UNSUPPORTED`), 0 gaps. The case set re-spelled.
- [ ] 2.2 LSP: one signature per box, `.X` typed from the declaration, the subset check updated; agrees with the C#
      reader on every accept and refuse case.
- [ ] 2.3 Exec twin: translate `.X`, `EN :=`, `FB :=` to ST; twin builds re-recorded live (lenze-mid, pro2193): 0
      errors; exec traces equal on the spelled cases.
- [ ] 2.4 `docs/network-text.html`: the suffix table becomes one sentence and one example; the FB rows follow the rule.
      Fix the stale anchors: `test/e2e/graphical/roundtrip.test.ts:53` (`#opaque`, LET/`i*`), the LSP conformance
      fixtures `graphical/network-unresolved.ts`, `network-graphical-a.ts`, `network-graphical-c.ts` (`#unnamed-instance`,
      `#sink`, `#eneno`, `#fb`, `#group`, `#operator-group--…`, `#execute-box--…`), `NetworkModel.cs:167`.
- [ ] 2.5 Live e2e on CODESYS and TwinCAT; the graphical conformance fixtures re-recorded.

## 3. Close

- [ ] 3.1 Cold full suites, the small release matrix (latest CODESYS + TwinCAT), archive.
