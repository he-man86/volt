## 0. Census

- [x] 0.1 Pull the six corpora on both vendors (own `ide.ps1 -Instance ld-fbd-coverage`, corpus copies only) and count every
      LD/FBD body that pulls `IMPLEMENTATION LD|FBD UNSUPPORTED`, per vendor, per reason/shape, with one example network
      each; plus the bodies that pull as network text today (the denominator).

      **Measured 2026-10-12** (bridge built from `2f17c5ce7c`, `VOLT_GRAPHICAL` on; CODESYS SP21 Patch 4, TcXaeShell 15.0).
      Each corpus served as a COPY by `ide.ps1 up -Instance ld-fbd-coverage` (CODESYS: the variant project files named in
      `refresh-corpus.ts`; TwinCAT: `-Fixture 14`), one `fetch {knownItems:{}}` over the instance's pipe; per item the
      `IMPLEMENTATION LD|FBD` lines of `sourceText` (shown) and the wire's `unsupported[]` (`member`, `language`, `reason`).
      Example networks from the IDE's own `export_native` of each refused object (the harness probe in
      `run_pipe_production.py`), dumped as NWL trees. Scripts were scratch (census / native-export / tree dump), not kept.
      "Both vendors" in practice: the five CODESYS corpora open only in CODESYS and Project14 only in TwinCAT, so each
      corpus is pulled by its own vendor. Every pull matches the committed `test-corpus/` counts exactly (no drift).

      | corpus (vendor) | items | LD shown | FBD shown | LD UNSUPPORTED | FBD UNSUPPORTED |
      |---|---|---|---|---|---|
      | lenze-mid (CODESYS) | 7833 | 24 | 5 | 10 | 1 |
      | pro2193 (CODESYS) | 8106 | 0 | 1 | 0 | 1 |
      | awa-palletizer (CODESYS) | 6485 | 0 | 1 | 0 | 0 |
      | bakon-nano (CODESYS) | 6664 | 0 | 1 | 0 | 0 |
      | CodesysTestProject (CODESYS) | 851 | 0 | 0 | 0 | 0 |
      | twincat-project14 (TwinCAT) | 252 | 2 | 0 | 0 | 0 |
      | **total** | | **26** | **8** | **10** | **2** |

      12 of 46 LD/FBD bodies (26 %) pull UNSUPPORTED — all on CODESYS, 11 of them in lenze-mid. TwinCAT pulls none hidden,
      but its one corpus holds only 2 LD bodies: every shape below is the shared NWL model (DIALECT N1), so its TwinCAT half
      has no corpus witness and is measured by the step-2 fixture.

      **The wire reports a body's FIRST refusal only** (`NetworkText.Pulled` catches the first `UnrepresentableBodyException`),
      so the network-level census below is a SECOND measurement, made 2026-10-12 (gate step 0, review finding 2) to
      replace a heuristic scan that looked only for the five shapes the bridge named. A scratch build of the bridge whose
      `NetworkTextWriter.Write` caught the refusal of EVERY top-level tree of every network (instead of letting the
      body's first one escape) served lenze-mid and pro2193 again (`ide.ps1 -Instance ld-fbd-coverage`, same project
      files) and the 12 refused bodies' reasons were read off one fetch each; the patch was reverted and the bridge
      rebuilt. Every writer refusal was in scope, not five. What the scan still cannot see: a second refusal INSIDE one
      tree (the writer stops at a tree's first). "a wire referenced before its definition" hits were all cascades of the
      scan itself — the trees that use a wire whose defining tree had just been refused (VarIds checked) — and are
      not counted. No body was refused by a READER (all 12 reached the writer). Same LD/FBD counts as the first pull;
      the fetch reported 7852 lenze-mid items against 7833 then (8106 pro2193 both times) — not investigated, the
      LD/FBD bodies and their reasons are identical.

      | # | refusal (writer) | bodies (first reason) | networks (per-tree scan) | where |
      |---|---|---|---|---|
      | S1 | `a bit operator box connected by a stored output slot` | 3 (LD 2, FBD 1) | 7 in 5 bodies (AND, OR, NOT) | pro2193 `Cylinder_53ValveFB.SetAlarm` 0; lenze `ServoControl` 15, `Mach1_MotionControl` 9, `Mach1_MIDS` 42/64, `FirstErrorCapture.call_FirstErrorCapture_FB` 3/4 |
      | S2 | `an assign below the top level` | 4 (LD) | 6 in 4 bodies | lenze `SpeedCalculationDryer` 0, `Mach1_MIDS` 7/29/52, `Dryer` 1, `TrayFiller` 30 |
      | S3 | `a wire of unknown type` | 3 (LD) | 6 in 3 bodies | (a) leaf-fed: lenze `WSM` 10, `GeneralMachineFlags` 6; (b) terminator-fed: `GeneralProgramFlags` 4/5/6/7 |
      | S4 | `a main output other than slot 0` | 1 (FBD) | 1 | lenze `FirstErrorCapture.call_FirstErrorCapture_FB` 2 |
      | S5 | `an FB instance the declarations do not name` | 1 (LD) | 1 | lenze `ATD_TorqueControl` 0 |
      | S6 | `a flag on a box input pin` | 0 | 1 | lenze `FirstErrorCapture.call_FirstErrorCapture_FB` 8 (a negation on `L_FECA.L_FirstErrCaptureErrorAccess.xEnable`, fed by `xStructError`) |

      Corrections to the first (heuristic) scan: S6 was "not seen" — it is in `call_FirstErrorCapture_FB` 8, which the
      heuristic had filed under S1 (and the "S4 also net 8" was this network too); S1 adds `Mach1_MIDS` 42 (a NOT) and
      drops `Mach1_MIDS` 52/62 (52 is the nested assign; the heuristic's bit-operator hit there may sit behind it in the
      same tree, and 62 writes clean — a heuristic false positive). Not seen on either corpus, measured by the per-tree
      scan: every other writer refusal (a vendor split point, a terminator with an input, a Parallel fed by the empty
      terminator, a negated/edge coil, a lone unconnected Parallel branch, …). The four CODESYS corpora with no refused
      body and Project14 need no scan: a body that writes has no refusal.
      Network numbers are 0-based positions in the body's `NetworkList` (the title the engineer gave is often
      "NETWORK n" with another n); the proposal's `Mach1_MIDS` net41 / `TrayFiller` net12 were not those positions
      (proposal corrected).
- [x] 0.2 Per shape: the NWL tree it is (which node kinds, which flags, where the current writer/reader refuses), and whether
      a vendor fact is missing to spell it (→ a probe-table row, never a probe script).

      All six are READ by both readers into the model without loss — every one is a **writer** refusal
      (`NetworkTextWriter`), i.e. a model the text has no spelling for, not a vendor object Volt cannot read.

      - **S1 — a bit operator stored in full-box form.** `BoxTreeBox` `AND`/`OR` (and `NOT`, `Mach1_MIDS` 42/64) consumed as an input of another box or the
        RValue of an Assign, carrying what a plain contact-logic AND/OR never carries: `OutputParam` `Names=[""]`
        `Types=["BOOL"]`, one stored `OutputItems` slot (null = the connected one), `EN`/`ENO` members as bools. SetAlarm:
        `SetAlarm := AND(OR(AND(xOutput, xOutInv, xSensor), AND(...), AND(...)), EnableOutputs.Q)` with every inner AND
        in that form, the OR not. The reader reads `ConnectedSlot = 0` off it; `Suffix` refuses
        (`NetworkTextWriter.cs` ~477) because the text reads a consumed bit operator back as connected by NO slot (census 1.6).
        Missing vendor fact: whether the stored form is semantically inert (same build, same execution) and whether a
        push can BUILD it on each vendor — a probe-table row (`nwl-bitop-stored-slot`), not a probe script; without it the
        honest spelling is a marker on the box, never folding it into the plain form.
      - **S2 — an Assign below the top level (a coil mid-rung).** `BoxTreeAssign` as an `InputItems` entry of a `Box` (a
        MOVE's EN, an AND input) — the coil writes its targets and its value flows on. SpeedCalculationDryer net 0:
        `MOVE(EN := (Mach1_AuxData.ADS_StopOnZeroPulse := w188 AND (I133_1 OR ADS_StopOnZeroPulse)), 750) => Cor_numerator`.
        Read as `Assign(value, targets)` nested; refused by the writer's node walk (`case Assign`, ~388). Missing vendor fact: that a push can build an Assign as a box input on each
        vendor and read it back nested (pull needs none) — a probe-table row (`nwl-nested-assign`).
      - **S3 — a Demux whose producer states no type** (`WireType`, ~693). Two sub-shapes:
        (a) a LEAF-fed wire (`Demux(VarId, Leaf)`) used as an FB/function input — WSM net 10: `w46 := stFeedForward;`
        feeding `R_TRIG.CLK` and `TON.IN`. `ProducerType` types a leaf-fed wire only when every use is boolean
        (`EveryUseIsBoolean`), and a call-box input does not count. **A vendor fact or a text fact is missing — not none**
        (corrected, gate step 0 review finding 1). The consumer's stored input type (`InputParam.Types` = `BOOL`) cannot
        be the rule's input: the model carries no input types (`Box`, `NetworkModel.cs` ~120, has `OutputTypes` only, so
        both readers drop them); Volt's own push writes them EMPTY on purpose (`CodesysNetworkWriter.cs` ~396, "the IDE's
        to resolve"), so a pushed body has none until the IDE resolves it — an editor cache like the operand `Type` N23
        dismisses; and `ProducerType`/`EveryUseIsBoolean` is ONE rule shared by the writer and the reader over what the
        text carries (the writer even strips stored output types, `WithoutStoredTypes`) — a rule keyed on a stored input
        type could not be applied when the text is read back, so the same body would type on pull and come back untyped
        or refused from its text. 1.1 picks one of two: (i) the type from something the text DOES carry — the callee's
        declared pin type (`R_TRIG.CLK`, `TON.IN` are BOOL), which needs the scope to resolve callee signatures on both
        sides; or (ii) a vendor fact — whether `InputParam.Types` is authoritative and survives a push on both vendors
        (a probe-table row, `nwl-input-param-type`), and then the model must carry input types.
        (b) a RAIL-fed wire (`Demux(VarId, Terminator)`) — GeneralProgramFlags nets 4–7: `w2 := <left rail>;` feeding two
        `AND` inputs of a TON pair (a flip-flop). In LD that is the power rail, BOOL TRUE; the text has no spelling for a
        wire fed by nothing. Missing vendor fact: whether a Demux fed by a Terminator is what a pushed `w := TRUE;` builds
        or a distinct stored form (it is distinct today: TRUE pulls as a Leaf) — a probe-table row (`nwl-rail-fed-wire`).
      - **S4 — a call box consumed by an output other than slot 0.** `BoxTreeBox L_FECA.L_FirstFASTErrCapture` (instance
        `fbFirstErrCapture`) as the RValue of the coil `GVL_FirstErrCapture.xFirstErrorBit`, its stored `OutputItems`
        null at slot 1 = `xErrorActive` (`MainOutputIndex` 1); `Suffix` refuses (~503) because the text reads a consumed
        box as connected by slot 0. The census-1.6 "3 Lenze call boxes store main output 1" are these. Missing vendor fact:
        whether a push can SET the main output of a call box (`MainOutputIndex`) on each vendor — a probe-table row
        (`nwl-main-output-slot`); the spelling would name the pin (`fb(...).xErrorActive`, as `.ENO` is named).
      - **S5 — a call through `SUPER^`.** `BoxTreeBox ATD_FQI` whose instance operand is `SUPER^` (an FB extending
        `ATD_FQI` calling its base body). Not an NWL-shape gap: the scope (`_scope.InstanceType`) has no declaration named
        `SUPER^`, so the writer refuses (~584) rather than let it read back as a function. The fact needed is the POU's
        `EXTENDS` (declaration text Volt already has), not a vendor one; push of a SUPER^ box is unmeasured — a
        probe-table row (`nwl-super-call`) only if the build step cannot pin it by fixture.

      - **S6 — a negation on a box input pin.** `call_FirstErrorCapture_FB` net 8: the input `xEnable` of the call box
        `L_FECA.L_FirstErrCaptureErrorAccess` carries `InputFlags` negation, fed by the leaf `xStructError`. Both readers
        read pin flags into `Input.Flags` (CODESYS `PinFlags`, TwinCAT `TcNetworkReader`); the WRITER refuses (`BoxCore`,
        `NetworkTextWriter.cs` ~406: "a modifier on the PIN has no spelling yet"). Pull needs no vendor fact; push needs
        whether a pin flag can be built on each vendor — a probe-table row (`nwl-input-pin-flag`) unless the build step
        pins it by fixture.

      Deferred facts carried in (proposal): N23 and N25 stay NOT rows (both build/open NWL nodes outside the table's
      vocabulary, as recorded in DIALECT); the `nwl-*` rows above are the candidates for 1.1 to accept or replace.

      **Gate step 0 (2026-10-12).** Review findings: (1) S3(a) "no vendor fact missing" was wrong — corrected above;
      (2) the census claimed every other refusal 0 without measuring it — re-measured per tree, which found S6 and moved
      S1's network list; (3) the proposal's net41/net12 "6 bodies" — corrected in proposal.md. No code changed (the
      per-tree scan was a reverted scratch patch). Gate: typecheck clean (5 packages); LSP full suite with
      `VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset: 10047 tests, 9591 pass, 35 skip, 421 todo, 0 fail (815 s);
      `Volt.Engine.Tests` 2371 pass / 1 skip (was 1 FAIL on HEAD — `WireVocabularyGuardTests` flagged the install
      folder `{app}\codesys` in `Volt.Connector/VoltEnv.cs`, from installer-rebuild; a different vocabulary than the
      vendor id, allowlisted with the reason, committed separately), `Volt.Ide.Codesys.Tests` 318 pass,
      `Volt.Ide.Twincat.Tests` 453 pass. Fixture map unchanged (no fixture or transpiler change).

## 1. Design (owner review before code)

- [x] 1.1 design.md: a network-text spelling per census shape, consistent with the NWL model and identical on both vendors;
      the grammar delta for `docs/network-text.html`; what stays refused by name and why; the order to build the shapes
      (by corpus count); the split of the network-text code by concern (parser, lexer, checks, tests); which deferred
      `probe-nwl-*` / N23 / N25 facts become rows. Done: design.md (7eae9777ff).
- [x] 1.2 STOP for the owner's review of 1.1 (a file-format extension). Record the decision here.
      **Owner decision 2026-10-12: design APPROVED** ("yes do both, start the build"), with two amendments:
      (a) **S3a open case → a probe row, not a refusal:** what CODESYS (and TwinCAT) store as the wire type when a leaf of
          one type feeds a pin of another (INT leaf → DINT pin) and when the leaf's type is an alias is recorded first, as a
          `vendor-facts` row (`nwl-leaf-wire-type`), before S3a is built; S3a's rule follows the recording.
      (b) **Order: split first, then shapes** — the network-text code is split by concern (output-neutral) BEFORE any
          shape is added, so every shape lands once, in its place. Section 2 is renumbered accordingly.
      S4 stays refused by name ("niche: accepted loss (1 occurrence in the corpora)") as designed; S1 follows its probe.

## 1b. Close every gap, future-proof (owner 2026-10-12, before the build)
n**Order (owner 2026-10-12):** this change runs AFTER `bridge-one-to-one`, which rebuilds the item contract and the push/driver
write paths; build 1b.4 and the shapes on that new contract, and reuse its vendor-facts rows and oracle harness.

Owner: "we have control over the resulting code so we must make it as easy for ourself" — "this is the moment to close all
gaps and make it futureproof". **Rule P1: network text is the NWL tree one to one for every member that is not a measured
editor cache.** Nothing is folded or guessed ("probably inert"); a member that carries data is spelled. The census covers
the vendor's whole SCHEMA, not only the shapes the six corpora happen to use, so a new project's shape is already decided.

- [ ] 1b.1 Schema census: every class and member of the NWL object model on both vendors (the shipped DLLs' types —
      `BoxTreeBox`, `BoxTreeOperand`, `BoxTreeAssign`, `BoxTreeDemux`, `Parallel`/`Terminator`, `Operand`, `Flags`,
      `Network`, `OutputItemList`, `InputParam`/`OutputParam`, jumps/labels/returns, EXECUTE, every other class the DLL
      defines), with each member's value distribution over the six corpora (all networks, both vendors). Found already:
      the reader takes `Operand.SymbolComment` into the model and the writer never writes it; `Operand.Comment` is not read
      at all — measure both (non-empty counts per corpus, and whether either is engineer-typed or derived from the
      declaration). A measure, not a probe script; any vendor fact it needs is a `vendor-facts` row.
      **Default (owner 2026-10-12, "better to be safe and make it as 1 to 1 as possible"): a member is SPELLED unless a
      measurement proves it an editor cache** (derived from other members or the declarations, and rebuilt by the IDE on
      push). No proof, no exclusion — an unforeseen case can then only make the text longer, never lose data.
- [ ] 1b.2 The disposition table in design.md: every member → **spelled** (its text form), **editor cache** (with the
      measurement that it is derived and rebuilt on push), or **refused by name** (with the measurement that no push can
      build it). No member left undecided; members with 0 corpus occurrences still get a decision. New spellings follow
      the existing style (trees, one named node per split point) and are listed for the owner in the close report.
- [ ] 1b.3 The completeness oracle (red first): for every corpus network on both vendors, NWL → text → NWL reproduces every
      non-cache member exactly (an extension of `ModelRoundTripOracleTests` over the corpora); a member the table does
      not list fails the gate by name — so a vendor adding a member in a future SP surfaces as a red test, not a silent loss.
- [ ] 1b.4 **S4 and every shape no push can build: shown always, refused per NETWORK, never per body** (owner 2026-10-12,
      "it sounds like we should improve this"). (a) Pull spells a call box whose main output is not slot 0 with the output
      named from the box's own stored `OutputParam.Names` — `xFirstErrorBit := fbFirstErrCapture(…).xErrorActive;` — so no
      library signature is needed and the body is never UNSUPPORTED for it (design.md's "the reader would also need the
      library FB's output order" is superseded: the names are stored on the box). (b) A push leaves every network whose
      text did not change exactly as the IDE holds it and rebuilds only the changed ones; an unbuildable shape (S4's
      read-only `MainOutputIndex`, N21) is refused only when ITS network changed, naming the network and the reason.
      (c) Measured first, both vendors, as a `vendor-facts` row (`nwl-keep-network-in-place`): whether a body's network
      list can keep one network object untouched while its neighbours are replaced, and the object's identity after
      save/reopen. If a vendor cannot, that vendor stays per-body for unbuildable shapes, stated in DIALECT, and the
      text still shows the network (read-only body, never a missing one).
## 2. Build (after 1.2)

- [ ] 2.1 The network-text code split by concern, OUTPUT-NEUTRAL (design "Code split"): `parser.ts` into statement,
      value/group, call/pin and the pair-kind decision; the lexer's `next` per token class; `network-analysis.ts` per check
      family; `network.test.ts` per service. The shrink-only entries and the dead-export allowlist emptied. The full LSP
      suite, the fixture map and the network e2e identical before/after.
- [ ] 2.2 The probe-table rows, recorded on both vendors BEFORE the shapes they decide: `nwl-bitop-stored-slot` (decides
      S1's outcome), `nwl-leaf-wire-type` (decides S3a, owner amendment a), `nwl-nested-assign`, `nwl-rail-fed-wire`,
      `nwl-input-pin-flag`, `nwl-super-call`; DIALECT N-rows updated.
- [ ] 2.3 Per shape AND per member the 1b.2 table spells, in the design's order (S1 per its probe, S2, S3, S6, S5, then the 1b.2 members), test-first: a recorded fixture on both
      vendors (pull → push → pull fixed point + build), writer, reader, gate, LSP parser and checks — each landing in the
      split structure of 2.1.
      **And delete the inference a spelled member replaces** (owner 2026-10-12, "also simplifies the code"): writer and
      reader map member ↔ text one to one; guesses such as the wire type from its uses (`EveryUseIsBoolean`), "slot 0 is
      the main output" and "a stored slot is inert" go wherever the member is now spelled. The count of such rules before
      and after is recorded under this task.
## 3. Verify and close

- [ ] 3.1 Re-pull the six corpora: no LD/FBD body UNSUPPORTED (S4 shown per 1b.4; an unbuildable network refused only when edited); e2e on both
      vendors; full LSP suite cold; archive.
