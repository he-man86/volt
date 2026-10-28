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
- [x] 1.2 design.md: the rule, the member names (`OUT` for a function's value, the declared name for an FB output,
      `ENO`), when `.X` is required (more than one output can chain) and when it is refused (only one can), a declared
      `EN`/`ENO` pin vs the shown EN/ENO, the root rule; measured in CODESYS through the exec twin where behaviour is
      new.
      Done 2026-10-28 (design.md "1.2"): `.ENO` closes every box showing ENO, root or consumed (N16: the shown ENO is
      the handed-on output); `.NAME` closes a consumed box without ENO with more than one data output (a function's
      `OUT` + `VAR_OUTPUT`s, an FB's declared outputs); `EN :=` = EN shown. The four EN/ENO pairs are four spellings, so
      the draft's comparison exception and its refusal of `move-enabled`, `execute-enabled`, `function-eno-without-en`
      (measured running in network-text-st 3.0) are gone. Consumed 1,117: no member 1,018, `.ENO` 56, `.NAME` 43 (FB 37,
      `.OUT` 6 `RuntimeGuard`); roots 183: `.ENO` 117, none 55, Execute 11; TwinCAT `.Q` 2, none 142 + 20 roots, Execute 1.
      No new run-time behaviour (every spelling translates to ST the twin runs today), so no exec recording; the one
      open vendor fact is the push of a function's moved `VAR_OUTPUT` (0 in the corpora), refused by name until 2.5.
      Niche, accepted loss: a root FB's stored moved pin (1). Spec delta `specs/network-text/spec.md` added.
- [x] 1b Review of 1.2 (2026-10-28), six findings, all fixed in design.md / spec.md / proposal.md (docs only):
      (1) unknown callee: design "A callee no declaration in reach states" — the reader reads such a call as written,
      the push refuses the box by name, the CLI's post-push check (`PushedText.SameBody`, scope with
      `declarationOf: _ => null`) compares both texts as written and refuses nothing for it; 2.1 counts the boxes.
      (2) root moved pin: the claim "the oracle counts it under stored members" was false (`CodesysNetworkReader` sets
      `ConnectedSlot`/`MainOutputName` on consumed boxes only; `RebuildLoss` names no `MainOutputIndex`) — now a
      `RebuildLoss` candidate + a known divergence "niche: accepted loss (1 occurrence in the corpora)", both in 2.1.
      (3) root `f(…).ENO;`: named as network text's one added statement form (reader + LSP subset check), the twin
      translates it to the call statement (2.1-2.3). (4) spec delta: Execute excepted, `EN :=` = EN shown only where
      the callee declares none, the root/function-`.NAME`/`OUT` refusals and the moved-pin count added; split into four
      requirements; proposal's "1:1 with NWL" line says `.OUT` is Volt's name and a root `.ENO` the flag. (5) a
      function declaring `VAR_OUTPUT OUT`: refused by name; 0 occurrences in the six corpora (no FUNCTION in
      `test-corpus` declares an `OUT`; 1,042 function files with `VAR_OUTPUT` scanned). (6) the run claim corrected:
      `st-spellings-run.test.ts` runs `X_EN`/`X_ENONLY` only (no `_ENO(`); ENO without EN is recorded building, never
      run — 2.3 adds the run. No failing test: no code or fixture changed in this step (design phase).
      Gate (docs only, no code or fixture changed, so no map regeneration): typecheck clean; LSP full suite
      (VOLT_REQUIRE_FULL=1) 10,237 pass / 0 fail / 36 skip / 431 todo; Volt.Engine.Tests `~Network` 368/368;
      `openspec validate network-output-member` valid, no warnings.

## 2. Build

- [x] 2.1 C# writer + reader (`StNetworkWriter`/`StNetworkReader`): one name per box, `EN :=`, `.X`, `FB :=`; suffixes
      and the FB statement form deleted. Round-trip oracle on the corpora, TwinCAT archives and accept cases: tallies
      no worse than network-text-st's (CODESYS corpora 0 `%UNSUPPORTED`), 0 gaps. The case set re-spelled.
      From 1b: the statement form `f(…).ENO;` (and `.X` other than `.ENO` closing a statement refused); a callee out
      of reach read as written and refused by name at a push, the post-push check comparing as written (count the
      corpus boxes a push meets so); the `VAR_OUTPUT OUT` refusal; a `RebuildLoss` `MainOutputIndex` candidate for a
      root box and the root moved pin listed as a known divergence "niche: accepted loss (1 occurrence in the corpora)".
      Done 2026-10-28 (design.md 2a "As built"): `StNetworkWriter`/`StNetworkReader` per 2a; the suffixes, the FB statement
      form and the read-once splice of an FB go (the splice stays for the Execute box only); `NetworkScope.Signature`
      (`CalleeSignature`) states a callee's pins, a name-list scope through signature lines. Case set re-spelled from the
      models (130 accept incl. 9 new `members.cases`, 57 refuse; `fb-call-read-through-declared-eno` model now flags false,
      `name:ENO`). Oracle: CODESYS corpora identical 316 / stored 72 / unsupported 0 / gap 0 (was 301 / 87 / 0 / 0);
      TwinCAT archives 143 / 8 + its 2 pinned niche categories (unchanged). Corpus boxes a push meets with a callee out of
      reach: 0 (five CODESYS corpora) and 0 (twincat-project14), against the push's scope (`CorpusProject.PushScope`).
      `NetworkPairing.RefuseUnbuildableBoxes` (unstated callee; function read through a VAR_OUTPUT) in the three vendor
      writers; `RebuildLoss.RootMainOutput`; `A_root_box_storing_a_moved_pin_is_a_known_divergence` (ExpectRed, 1 box).
      The LSP corpora's network bodies regenerated (`VOLT_WRITE_CORPUS_TEXT=1`, 37 files). The completeness ledger's
      `BoxTreeBox.BoxType — changed` (24) closed: the text carries the stored type.
- [x] 2.2 LSP: one signature per box, `.X` typed from the declaration, the subset check updated; agrees with the C#
      reader on every accept and refuse case.
      The statement `f(…).ENO;` accepted at a network's top level only (1b).
      Done 2026-10-28: `types/infer/network-box.ts` (one box per call, its `BoxSignature` from the declaration in reach),
      `network-call.ts` (value, `.ENO` BOOL, `.OUT`, `.NAME` typed), `_plain-st.ts` / `_plain-st-wires.ts` carry the
      reader's refusals in its words; the ST checks (call arguments, non-callable, unresolved names, member, call-result
      access, unknown source) read a box as the call its callee takes. Case set: 187/187 on both sides. Corpus gate (LSP
      invents nothing) green; frontend and analysis baselines unchanged.
- [ ] 2.3 Exec twin: translate `.X`, `EN :=`, `FB :=` to ST; twin builds re-recorded live (lenze-mid, pro2193): 0
      errors; exec traces equal on the spelled cases.
      The root `f(…).ENO;` → the call statement. ENO without EN (`function-eno-without-en`) added to
      `st-spellings-run.test.ts` and RUN live before its translation is trusted (1b: only built so far).
- [x] 2.4 `docs/network-text.html`: the suffix table becomes one sentence and one example; the FB rows follow the rule.
      Fix the stale anchors: `test/e2e/graphical/roundtrip.test.ts:53` (`#opaque`, LET/`i*`), the LSP conformance
      fixtures `graphical/network-unresolved.ts`, `network-graphical-a.ts`, `network-graphical-c.ts` (`#unnamed-instance`,
      `#sink`, `#eneno`, `#fb`, `#group`, `#operator-group--…`, `#execute-box--…`), `NetworkModel.cs:167`.
      Done 2026-10-28: the suffix table is `#outputs`, one paragraph and one example block; FB rows `TON(FB := t1, …)`;
      every stale anchor points at a section that exists (`#elements`, `#outputs`, `#wires`, `#execute`, `#lines`,
      `#subset`); the roundtrip.test.ts comment says the current spelling.
- [ ] 2.5 Live e2e on CODESYS and TwinCAT; the graphical conformance fixtures re-recorded.

- [ ] 2.6 The Execute box as `EXECUTE(EN := …, CODE := '<ST>')` (design.md, last section): writer, reader, LSP, exec twin, doc;
      `%EXECUTE` / `%END_EXECUTE` deleted. Count first: an Execute box without EN, and one whose ENO chains on.
- [ ] 2.7 An FB box is a call on its instance (design.md "FB boxes"); the code on this branch still writes
      `TYPE(FB := inst, …)`.
- [ ] 2.8 Wires as `VAR_TEMP w1 : ANY; END_VAR` at the network start (design.md "Wires"): writer, reader, LSP, exec
      twin, doc; `%WIRES` deleted.
- [ ] 2a Gate of 2.1/2.2/2.4 (2026-10-28): NOT green, nothing committed. Typecheck, lint, `bun run check` green; C#
      Engine 2478 (+1 skip) / Cli 378 / Codesys 538 / Twincat 785 / Connector 156 / Contracts 56 / Repo.Gates 276, 0 fail;
      volt-cli `test/unit` 235, volt-vscode 34, 0 fail; LSP full suite (`VOLT_REQUIRE_FULL=1`) 10290 pass / 36 skip /
      431 todo / **4 fail** — `corpus-twins.test.ts` "the IDE builds the twins…" for awa-palletizer, bakon-nano, lenze-mid,
      pro2193: each `network-twins.codesys.json` is of the old twins (hash mismatch; the corpora's network text was
      respelled in 2.1). The fixture map is current (`map.test.ts` green). BLOCKER: re-recording needs a live CODESYS
      (`scripts/record-network-twins.ts`, one per corpus, the `.project` files in `Documents/codesysproject`), and
      `ide.ps1 up -Instance network-output-member` refuses beside a CODESYS it does not own (pid 35692, SP21 Patch 4, GUI
      started 15:36 with no project argument). Re-run the gate once that IDE is closed: record the four (2.3), then the
      full suite.

## 3. Close

- [ ] 3.1 Cold full suites, the small release matrix (latest CODESYS + TwinCAT), archive.
