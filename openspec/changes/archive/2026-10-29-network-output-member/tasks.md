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
- [x] 2.3 Exec twin: translate `.X`, `EN :=`, `FB :=` to ST; twin builds re-recorded live (lenze-mid, pro2193): 0
      errors; exec traces equal on the spelled cases.
      The root `f(…).ENO;` → the call statement. ENO without EN (`function-eno-without-en`) added to
      `st-spellings-run.test.ts` and RUN live before its translation is trusted (1b: only built so far).
      Done 2026-10-29 (design.md "As built (2.3 / 2.5)"), measured live on CODESYS 3.5.21.40 (`st-spellings-run.test.ts`
      green, its hand twin corrected to what CODESYS runs: ENO without EN FALSE, an enabled box's pins every scan, a wire
      read before its definition the previous scan's): both writers now set ENO without EN (`CodesysNetworkWriter`,
      `TcArchiveBuilder`; `TcCalleeDerivationTests`); the twin's rules per the measurement; a root box / an FB showing ENO
      without EN refused (CODESYS compiles neither; fixture `rcc_network_eno_function_without_en_root`, recorded on both
      vendors, GAP named "niche: accepted loss (0 occurrences in the corpora)" in `baseline-c.ts`). The four corpus twin
      builds re-recorded: 0 errors. LSP: a FUNCTION box's `OUT =>` is its value pin, not a named output
      (`network-box.ts`; test `call-arguments.test.ts` "a FUNCTION box's value pin…", red first).
- [x] 2.4 `docs/network-text.html`: the suffix table becomes one sentence and one example; the FB rows follow the rule.
      Fix the stale anchors: `test/e2e/graphical/roundtrip.test.ts:53` (`#opaque`, LET/`i*`), the LSP conformance
      fixtures `graphical/network-unresolved.ts`, `network-graphical-a.ts`, `network-graphical-c.ts` (`#unnamed-instance`,
      `#sink`, `#eneno`, `#fb`, `#group`, `#operator-group--…`, `#execute-box--…`), `NetworkModel.cs:167`.
      Done 2026-10-28: the suffix table is `#outputs`, one paragraph and one example block; FB rows `TON(FB := t1, …)`;
      every stale anchor points at a section that exists (`#elements`, `#outputs`, `#wires`, `#execute`, `#lines`,
      `#subset`); the roundtrip.test.ts comment says the current spelling.
- [x] 2.5 Live e2e on CODESYS and TwinCAT; the graphical conformance fixtures re-recorded.
      Done 2026-10-29: graphical conformance fixtures re-recorded on both vendors; the e2e texts still in the network-text-st
      spelling respelled (`_EN`/`_ENONLY` → `EN :=` + `.ENO`, a function with a VAR_OUTPUT read by its value `.OUT`, the
      preflight's refusal `EN := stands first`); new `create-shapes` "a box showing its ENO without EN survives a create".
      Live (own instance network-output-member, run one vendor at a time): CODESYS 3.5.21.40 621 pass + the respelled
      `refused-shapes` 9/9; TwinCAT Project14 606 pass / 0 fail.

- [x] 2.6 The Execute box as `EXECUTE(EN := …, CODE := '<ST>')` (design.md, last section): writer, reader, LSP, exec twin, doc;
      `%EXECUTE` / `%END_EXECUTE` deleted. Count first: an Execute box without EN, and one whose ENO chains on.
      Built 2026-10-29 (design.md "As built (2.6)"), the live measurement open. Counts: 12 Execute boxes (CODESYS 11,
      TwinCAT 1), without EN 0, ENO chaining on 0 (all roots showing EN); case set: without EN 3, read through ENO 5.
      `StNetworkWriter`/`StNetworkReader` (`ExecuteCall`/`ExecuteBox`, `NetworkSpelling.EscapeCode`/`UnescapeCode`, the
      string-aware line loops, the read-once Execute wire machinery deleted); the LSP lexer's CODE string, `plain-st.ts`
      (the code's tokens after its statement), the network check (`checkExecute`, `checkStrings`, the Execute wire rules
      deleted), the twin (`executeRead`); doc `#execute`; the corpora's 12 boxes respelled (`VOLT_WRITE_CORPUS_TEXT=1`).
      Cases: accept `execute-through-a-wire`, `execute-lines-are-its-code`; refuse `execute-without-code`,
      `-code-escape`, `-declared-in-reach`, `string-across-a-line`, `execute-closed-by-a-member` respelled; deleted with
      the rule they pinned (the read-once Execute wire, no longer in the grammar): `execute-unclosed`,
      `execute-wire-read-before-its-box`, `execute-wire-not-directly-before-its-read`,
      `wire-defined-by-an-execute-box-read-once`; `reserved-pin-and-head-backticked` → `reserved-pin-names` (`Execute` is now
      the text's own head). BLOCKER: whether CODESYS takes a raw line break in a string literal is unmeasured —
      `ide.ps1 up -Instance network-output-member` refuses beside the hand-started CODESYS pid 35692.
      Review of 2.6 (2026-10-29), five findings:
      (1)+(2) FIXED, one fix: the LSP's file lexer again ends EVERY string at its line (`lex/strings.ts` back to the last
      commit — a plain ST POU's `CODE := 'abc` no longer swallows the lines below it); the Execute box's CODE string is
      rejoined in `network/execute-code.ts` (split out of `plain-st.ts`, which `check-size` put over its limits), in a
      network body only, where `CODE :=` opens the pin of an open `EXECUTE(` call, from the body's own tokens — so one not
      closed runs to the BODY's end and no further, "an unclosed string" in the bridge's words, and the units after it
      keep their findings. The network check walks the rejoined tokens (`PlainStText.tokens`). Tests (red first):
      `lexer.test.ts` "every string ends at its line…", `_plain-st.test.ts` "an Execute box's CODE string not closed
      yet…"; refuse case `execute-code-unclosed`. The bridge's lexer spans lines only for a `'…'` CODE string (a `"…"`
      one spanned there and not in the LSP).
      (3) design narrowed to what is built: `EXECUTE` follows the one rule of the text's own words (`BRANCH`, `R_EDGE`):
      anything in reach under it is refused, a variable too — narrowing it for EXECUTE alone would make two rules. Niche
      either way: LD/FBD bodies with an `Execute` in reach 0 (the corpus oracle meets no unspellable Execute box). Pinned
      by the refuse case `execute-beside-a-variable-named-execute`.
      (4) FIXED, coverage: refuse cases `execute-code-unclosed`, `-code-not-last`, `-eno-pin`, `-code-wstring`,
      `-code-wstring-across-a-line`, `code-string-of-another-call`, `a-box-named-execute` (the refusal
      `reserved-pin-and-head-backticked` used to accept), `execute-beside-a-variable-named-execute`; writer test
      `An_Execute_box_the_text_cannot_spell_is_refused_by_its_reason` (EXECUTE in reach, a lone CR, consumed not by
      its ENO, a modifier, a box of type Execute that is no Execute box). Not added: `$` at the end of the code — only an
      unclosed string can end in one, and that is refused as unclosed first.
      (5) FOR THE OWNER (grammar special cases, per CLAUDE.local.md listed here, not documented as exceptions): the CODE
      string is the one string that spans lines (whether CODESYS takes a raw line break in a literal is still
      unmeasured, blocker above), and it has its own escape set — only `$'` and `$$`; IEC's `$N`/`$L`/`$R`/`$T`/`$hh` are
      refused there (`execute-code-escape`), while `%NETWORK` titles and `//` lines read IEC escapes
      (`NetworkSpelling.Unescape`). One network text, two escape rules: an IEC-correct `'a$Nb'` typed into CODE is
      refused. Options: IEC escapes in CODE too (a line break could then be `$N` and the string an IEC literal), or
      no escapes anywhere but `$'`/`$$`.
      Gate (2026-10-29): NOT green, nothing committed. Typecheck, lint, `bun run check` green; fixture map current
      (`rate:fixtures`, no change); C# Engine 2489 (+1 skip) / Cli 378 / Codesys 538 / Twincat 785 / Connector 156 /
      Contracts 56 / Repo.Gates 276, 0 fail; volt-cli `test/unit` 235, volt-vscode 34, 0 fail; LSP full suite
      (`VOLT_REQUIRE_FULL=1`) 10301 pass / 36 skip / 431 todo / **4 fail** — the same four `corpus-twins.test.ts` "the IDE
      builds the twins…" (awa-palletizer, bakon-nano, lenze-mid, pro2193) as gate 2a: the recorded
      `network-twins.codesys.json` are of the old twins. BLOCKER (unchanged): re-recording needs a live CODESYS and
      `ide.ps1 up -Instance network-output-member` refuses while the hand-started CODESYS pid 35692
      (`CodesysTestProject.3.5.21.60.project*`, unsaved) still runs; Volt never closes an IDE it did not start. The
      working tree keeps the 2.6 build and these fixes uncommitted (not reset: it is the only copy of the work).
      Built 2026-10-29 (451c689db0); C# suites green, LSP 10301 pass with only the 4 corpus-twins recordings red (live
      re-record blocked by a hand-opened CODESYS; 2.3 re-records them).
- [x] 2.7 An FB box is a call on its instance (design.md "FB boxes"); the code on this branch still writes
      `TYPE(FB := inst, …)`.
      Done 2026-10-29 (design.md "As built (2.7)"): `StNetworkReader.Callee` / the LSP's `network-box.ts` `instanceOf`
      read a call head that is an FB instance in reach as the FB box of its declared type, an FB type as the box with no
      instance (`???`); the writer heads an FB box with its instance where a declaration holds it, else with its type
      (refused by name where no declaration states the type as a block). `FB :=` gone from writer, reader, LSP (box check,
      network scope, `???` lexing, the unresolved-name skip), twin comments, doc, case set, corpora (`VOLT_WRITE_CORPUS_TEXT=1`),
      the TwinCAT import texts, conformance fixture sources (recordings unchanged: of the IDE's model). Test first: writer
      test `An_FB_box_with_no_declared_instance_is_the_call_of_its_type`, the case set respelled red before the code.
      Deleted refuse cases (the rule they pinned is gone with `FB :=`): `instance-called` (an instance called is now THE
      spelling), `fb-type-without-instance` (now the `???` spelling, accept `unnamed-instance`), `array-element-called`
      (accept `array-element-instance`), `instance-not-a-variable`, `instance-of-another-type` (no text can state it; the
      writer's refusal stays, `Two_namespaces_are_two_types`), `instance-pin-on-an-operator`, `instance-pin-on-a-function`,
      `instance-pin-not-an-instance`; the LSP test "FB := stands only on an FB box" replaced by "an FB box is the call of
      its instance…". `NetworkSpelling.IsIecOperator` private (its one outside caller was the `FB :=` refusal).
      TALLY SHIFT (owner): CODESYS oracle identical 316 / stored 72 → 301 / 87 (unsupported 0, gaps 0): 24 lenze-mid boxes
      whose stored type is spelled otherwise than the instance's declaration read back as declared (`an FB type spelled as
      its declaration`), the ledger's `BoxTreeBox.BoxType — changed` (24) a known loss again — the design's consequence, no
      spelling for it without a second FB form. TwinCAT 143 / 8 unchanged.
      Gate: typecheck, lint, `bun run check` green; C# Engine 2482 (+1 skip) / Cli 378 / Codesys 538 / Twincat 785 /
      Connector 156 / Contracts 56 / Repo.Gates 276, 0 fail; volt-cli `test/unit` 235, volt-vscode 34; LSP full suite
      (`VOLT_REQUIRE_FULL=1`) 10293 pass / 36 skip / 431 todo / 4 fail — only the 4 known `corpus-twins.test.ts` live
      recordings (awa-palletizer, bakon-nano, lenze-mid, pro2193), which need the live re-record (2.3).
- [x] 2.8 Wires as `VAR_TEMP w1 : ANY; END_VAR` at the network start (design.md "Wires"): writer, reader, LSP, exec
      twin, doc; `%WIRES` deleted.
      Done 2026-10-29 (design.md "As built (2.8)"): one line `VAR_TEMP w1 : ANY; w2 : ANY; END_VAR` after the `%` lines,
      before the comment — `StNetworkWriter`, `StNetworkReader.WireDeclaration`, the LSP's `plain-st.ts` (`takeWires`,
      `wiresOf`; `read` split into helpers for `check-size`), the network check (`%` line order, the comment check skips the
      declaration), the twin (wires in a `VAR_TEMP` block with their inferred types; ENO temps and edge detectors stay in
      `VAR`), the doc `#lines`/`#wires`, the VS Code grammar (`%WIRES` no key), the e2e word lists and coverage regex, the
      case set, corpora (`VOLT_WRITE_CORPUS_TEXT=1`), TwinCAT import texts, conformance fixture sources. Test first: the
      case set respelled red before the code, 5 new refuse cases (`wires-not-any`, `wires-after-the-comment`,
      `wires-across-lines`, `wires-as-a-list`, `percent-wires`), `disabled-after-wires` re-phrased. Oracle tallies
      unchanged (CODESYS 301 / 87, TwinCAT 143 / 8, 0 unsupported, 0 gaps). Open for 2.3 (live): a wire read before its
      definition now reads a twin `VAR_TEMP`, initialised each call.
      Gate: typecheck, lint, `bun run check` green; C# Engine 2487 (+1 skip) / Cli 378 / Codesys 538 / Twincat 785 /
      Connector 156 / Contracts 56 / Repo.Gates 276, 0 fail; volt-cli `test/unit` 235, volt-vscode 34; LSP full suite
      (`VOLT_REQUIRE_FULL=1`) 10298 pass / 36 skip / 431 todo / 4 fail — only the 4 known `corpus-twins.test.ts` live recordings (2.3).
- [x] 2a Gate of 2.1/2.2/2.4 (2026-10-28): NOT green, nothing committed. Typecheck, lint, `bun run check` green; C#
      Engine 2478 (+1 skip) / Cli 378 / Codesys 538 / Twincat 785 / Connector 156 / Contracts 56 / Repo.Gates 276, 0 fail;
      volt-cli `test/unit` 235, volt-vscode 34, 0 fail; LSP full suite (`VOLT_REQUIRE_FULL=1`) 10290 pass / 36 skip /
      431 todo / **4 fail** — `corpus-twins.test.ts` "the IDE builds the twins…" for awa-palletizer, bakon-nano, lenze-mid,
      pro2193: each `network-twins.codesys.json` is of the old twins (hash mismatch; the corpora's network text was
      respelled in 2.1). The fixture map is current (`map.test.ts` green). BLOCKER: re-recording needs a live CODESYS
      (`scripts/record-network-twins.ts`, one per corpus, the `.project` files in `Documents/codesysproject`), and
      `ide.ps1 up -Instance network-output-member` refuses beside a CODESYS it does not own (pid 35692, SP21 Patch 4, GUI
      started 15:36 with no project argument). Re-run the gate once that IDE is closed: record the four (2.3), then the
      full suite.
      Green 2026-10-29 (after 2.3/2.5): typecheck, lint, `bun run check` (16/16), `rate:fixtures` current; C# Engine 2487
      (+1 skip) / Cli 378 / Codesys 538 / Twincat 786 / Connector 156 / Contracts 56 / Repo.Gates 276, 0 fail; volt-cli
      `test/unit` 235, volt-vscode 34; LSP full suite (`VOLT_REQUIRE_FULL=1`) 10306 pass / 36 skip / 431 todo / 0 fail.

## 3. Close

- [x] 3.1 Cold full suites, the small release matrix (latest CODESYS + TwinCAT), archive.
      2026-10-29: cold LSP full suite (`VOLT_RUSTC_CACHE=0 VOLT_REQUIRE_FULL=1`) 10306 pass / 0 fail; spec delta checked
      against the build (the `.NAME`-on-a-VAR_OUTPUT refusal worded as built), `openspec validate` valid. BLOCKED: the small
      matrix (`release:matrix --only codesys-3.5.22.40-64,twincat-32`) refuses to start beside another run's IDEs
      (CODESYS pid 34440 and XAE 23992 + worker 4892 of the worktree `agent-ac1125d49fda0c8d6`, change
      lsp-field-false-positives), still running after 50 min; Volt never closes an IDE it did not start. Not archived:
      run the matrix once they are closed, then archive.

3.1 done 2026-10-29: small release matrix at 5ed026b373 — codesys-3.5.22.40-64 GREEN 559 pass / 82 skip, transcript
identical; twincat-32 GREEN 558 pass / 86 skip after its reference transcript was re-recorded for the new spelling
(test/transcripts/twincat-32.jsonl). Open finding (to twincat-crash-and-redial-identity 1.2): on the same commit the
TwinCAT cell went 1 fail (hidden-declaration timed out; the XAE process was gone mid-test), then 64 fail (the
--record-transcripts run; its log was overwritten, cause not captured), then 0 — XAE instability to soak, not this change.
