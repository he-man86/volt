## 1. Measure (before any format change)

Census on live CODESYS SP21 (Lenze_MID-S100) and the TwinCAT fixtures, with the existing probe scripts. Each answer
either deletes a model field or fixes a spelling; none is assumed. Every rung example on the design page is
conditional on 1.3 and 1.5. Until a census answers, the shape it asks about materializes as the marker on pull —
never dropped, never guessed.

- [x] 1.1 Item-level Negation/edge Flags on Demux and Assign items (vs flags on their value). None → delete from the
      model; some → a position distinct from the value's flags, decided here (the old `g1 := NOT (x)` relied on the
      `NOT(` whitespace rule, which is gone). Until then: marker on pull, refused by name on push (review 7.6).
- [x] 1.2 `Assign.Value` null vs `Terminator(null)` — keep ONE representation of "unconnected"; the same question for
      `Parallel.Input` null vs `Terminator(null)` (`PARALLEL(a, b)` vs `PARALLEL(IN := , a, b)`, review 7.10).
      *Parallel half answered in the second pass (review: the first census counted `inp is not None` only):* null 5,
      the empty terminator 0 across five projects. `PARALLEL(a, b)` is the one unfed form; both readers refuse a
      Parallel fed by the empty terminator by name and the v2 text refuses `IN := ,` (`A_Parallel_fed_by_the_empty_
      terminator_is_refused_by_name` on both drivers, `A_Parallel_feed_wired_to_nothing`).
- [x] 1.3 The 17 Lenze `BoxTreeParallel`s: which of the 54 `X AND (a OR b)` shapes they are, `Mode` values, fed vs
      unfed. Until this lands, no design or golden publishes a single "after" spelling for that shape.
- [x] 1.4 `BoxTreeTerminator` with an Input: 0 → refused by name like Mux; >0 → a `TERMINATOR(x)` spelling.
- [x] 1.5 Do operator boxes carry `InputParams.Names`, and are they the operator's defaults? Infix is kept when the
      formals are absent or default — one text for both, the driver writes the defaults, the comparer treats them as
      equal; only a non-default name forces call form (ADD/MUL/GE/AND in TrayFiller N8) (review 7.9).
- [x] 1.6 Output slots (review 7.3): frequency of a top-level box's unnamed result pin vs `Assign(Box)`; live on FBD
      and LD, which slot a consumer is connected to — an Assign over an enabled box (ENO?), box-in-box nesting with
      and without EN, `MainOutputIndex` values, and whether an enabled box is ever connected by its main output
      (if so, the "consumed enabled box needs `.ENO`" refusal becomes "no suffix = main output").
      *Done 2026-09-26:* `scripts/probe-nwl-slots.py` -> `nwl-slots.log`, DIALECT N16. It IS: 40 enabled comparison
      boxes are connected by their main output and have no ENO. The refusal is lifted in the spec; 2.5 is reopened.
      *Re-measured the same day, connection by connection* (review: the first run tallied the two sides apart and
      paired nothing): side C pairs each NWL box with its export block and compares. Of 374 export connections to a
      block, 338 are checked and 0 disagree (337 name exactly `MainOutputIndex`, the index-1 call box included; 1 OR
      box stores no index); 22 name no slot (an LD coil join names the coil — 18 on single-output boxes, 4 on a
      TON whose index is 0 = `Q`, confirmed by NWL alone); 14 are unpaired (10 type-count mismatches, 4 in a name two
      objects share). Where ENO is also the main output the spec now says `.ENO` wins.
- [x] 1.7 Target Negation-only / Rtrig / Ftrig bits across all corpora (archive census, not pulled text). 0 → stay on
      the marker (today: 0 of 576); >0 → propose a spelling with a live constructor build, in its own change.
- [x] 1.8 Demux definition positions (every sample so far is top-level); a definition nested below the top level, or
      a reference stored before its definition — frequency; each gets a spelling or stays on the marker, never a
      silent reorder (review 7.7). TwinCAT single-consumer Demux frequency.
- [x] 1.9 Chained `S=`/`R=` assignment parses on SP21 ST (readability/LSP parity only — network text is not compiled).
      *Done 2026-09-26:* every mix builds CLEAN against a failing control (`scripts/probe-st-chained-set.py` ->
      `st-chained-set.log`): `a := b S= c;`, `a S= b := c;`, `a S= b R= c;`, `a := b S= d R= c;`.
- [x] 1.10 Delete `NetworkModel.Input.Flags` and any field 1.1–1.4 proves dead. **Blocked on 1.13**: the "null in
      22/22" count is TwinCAT-only.
      *Done 2026-09-26:* `Input.Flags` stays (1.13: load-bearing). Deleted: `Terminator.Input` (1.4: 0) and the null
      `Assign.Value` (1.2: the empty Terminator is the one "unconnected"). Both readers refuse the vendor shapes by
      name — "a terminator with an input", "an assignment with no value" — tests
      `CodesysNetworkReaderTests.A_terminator_with_an_input_is_refused_by_name` /
      `An_assignment_holding_no_value_is_refused_by_name` and their `TcDrawnJumpTests` twins. Item flags on
      Demux/Assign (1.1: 0) are no field of their own (`Node.Flags`; an Assign's Jump/Return live there) and stay
      refused by name.
      *And `Demux.Flags` / `Parallel.Flags` (review of section 1 — N20 proves them dead):* the two records carry no
      Flags (always None). The vendor stores none, and the field let the v1 text `out := NOT g1;` reach
      `CodesysNetworkWriter`, which set the bit on the unstored `IFlags`: the push succeeded and the IDE ran
      `out := g1`. **v1 hotfix, like 1.13's:** the v1 reader refuses a modifier on a wire reference
      (`NETWORK_UNSUPPORTED`, `NetworkTextDiagnosticsTests.A_negated_wire_reference_never_reaches_a_driver`); both
      vendor readers refuse a bit reported on a Demux/Parallel by name ("a flag on a wire" / "a flag on a Parallel",
      `CodesysNetworkReaderTests`, `TcDrawnJumpTests`); the v2 writer's two refusals of that state went with the
      field. `Parallel.Mode` lost its default: both readers read it (absent/unknown → "an unmeasured Parallel
      mode"), the CODESYS writer sets it (`A_built_Parallel_carries_the_models_mode`) and TwinCAT's in-place writer
      refuses a mode change — the 4.1/4.2 halves of N20's `Sequential` finding.
      *Third pass (review of section 1):* the "cannot carry" was only a missing constructor parameter — `with {
      Flags = … }` still built a flagged Demux/Parallel through the inherited init, and every consumer that refused
      it was gone. `Node.Flags` is virtual now and both records close it (a non-None value throws;
      `A_wire_or_a_Parallel_cannot_carry_a_flag`). The N20 refusal and the new Assign-item refusal live ONCE in
      `UnheldFlags` (Volt.Engine), which both readers call, so the marker cannot drift between vendors. The item
      flags of 1.1 were refused only by the v2 writer: both vendor readers now refuse an Assign item's negation or
      edge by name ("a flag on an Assign item", `A_negation_or_edge_on_an_Assign_item_is_refused_by_name` on both
      drivers) and v1 `Unspellable` names it (v1 printed it on the value — `out := NOT g1;`, which its own push
      refuses since N20). The mode claims were untested and one was false: both writers' no-change gates compare v1
      TEXT, which has no mode, so a mode-only edit was "unchanged" — CODESYS never rebuilt it and TwinCAT never
      reached its refusal. Both now also compare modes (`ParallelModes.Agree`;
      `A_Parallel_whose_only_change_is_its_mode_is_rebuilt`, `The_in_place_writer_refuses_a_Parallel_mode_change`,
      `A_Parallel_with_an_unmeasured_mode_is_refused_by_name`). And v1 pull no longer merges the modes: v1 spells a
      Parallel with no mode, so a `Sequential` one (Lenze MainDrive net1) materializes as the marker ("a Parallel in
      Sequential mode", `A_sequential_Parallel_is_named_rather_than_merged_with_the_default_mode`) until v2 ships
      `MODE := Sequential`.
- [x] 1.11 Is an Execute box ever consumed (its ENO continuing the rung), and with EN unwired? The value form
      `EXECUTE … END_EXECUTE.ENO` is specified either way (an Execute box's only output is ENO, so `.ENO` needs no
      EN — review 7.11); the census decides corpus golden vs synthetic.
- [x] 1.12 FB instances whose operand text is not a token (`fbs[1]`) — frequency. Decided: not spelled — the FB type
      comes from the instance's declaration, which names a NAME, so such an instance goes to the marker on pull and a
      backticked non-name head is refused on push (was "spelled as a backticked call head"; review 2026-09-26, third pass).
- [x] 1.13 **CODESYS `InputFlags` (review 7.1, blocking).** `CodesysNetworkReader.cs:199` writes `Flags.None` and
      `scripts/nwl-execute-compare.log:68` shows a populated `Array[Flags]`. Live: set an edge and a negation on a
      box-to-box pin, read where they land. Found → the pin spelling on the formal (`f(NOT IN1 := x)`,
      `f(R_EDGE(CLK) := x)`), distinct from the value's flag (`f(CLK := R_EDGE(x))`); until then a pulled pin flag
      goes to the marker.
- [ ] 1.14 `R_EDGE` / `F_EDGE` (review 7.12): check neither SP21 nor TwinCAT lets a POU or instance take the names;
      measure the vendor's evaluation order for Negation+Rtrig on one operand (the text's one order is
      `NOT R_EDGE(x)`).
      *Done 2026-09-26 (DIALECT N17, N18):* BOTH vendors let a function, an FB, an instance and a variable be named
      `R_EDGE`/`F_EDGE` (clean builds), so the spec's refusal of such a call stands. The ORDER is the other way round:
      SP21 evaluates `Negation+Rtrig` as `R_EDGE(NOT x)` (run in simulation, `edge-names-order.log`), so the text's
      `NOT R_EDGE(x)` stated other logic; the spec now spells it `R_EDGE(NOT x)` and 2.11 is reopened.
      *Second pass (review):* the names are now measured as the FULL set on each vendor (FUNCTION and FB, each named
      `R_EDGE` and `F_EDGE`: clean on both). The order is measured on an AND BOX too — the same as the operand. On a
      Parallel and a wire reference it cannot be: the IDE holds no flag there (DIALECT N20), so the text refuses one
      (`A_flag_on_a_wire_reference_or_a_Parallel*`). *BLOCKED (TwinCAT order):* running a TwinCAT PLC needs a runtime
      licence this machine does not have — `C:\TwinCAT\3.1\Target\License` exists but is empty (re-checked
      2026-09-26) and the `UmRT_Default` target holds none; a TC1200 trial licence is issued through XAE's interactive security-code dialog, which no probe can
      answer. Until measured, the spec sends a TwinCAT Negation+edge on one node to the marker (4.2). *Third pass:*
      still BLOCKED — `C:\TwinCAT\3.1\Target\License` is still empty (re-checked 2026-09-26). The CODESYS half is
      in the v2 text now: 2.11 is rewritten and green.
- [x] 1.15 Labels and jumps, live on both vendors, recording each build message: one LABEL on two networks of a body
      (can the IDE hold it; case-insensitive?); a LABEL on a DISABLED network as a jump target (still a target?); a
      `JMP` inside a DISABLED network; a `JMP` to a label no network carries. The gate refuses only what the IDE
      cannot hold; the rest is LSP parity (5.6).
      *Done 2026-09-26 (DIALECT N19):* both IDEs HOLD every shape, so the gate refuses none of them. The messages
      (5.6's parity targets): `The label 'DONE' is a duplicate` (same case or not); `No such label 'DONE' within
      the scope of the JMP statement` (a disabled network's label is no target; TwinCAT adds a `.`); `The label
      'DONE' has not been referenced` (a JMP in a disabled network is no reference; a warning); `No such label
      'NOWHERE' ...`. Labels match case-insensitively — on CODESYS first, and on TwinCAT in the second pass (review):
      `JMP DONE` to `LABEL: Done` builds clean (`tc-labels-edge-names.log`, "jump spelled in another case").
- [ ] 1.16 TwinCAT ladder (review 7.16): the share of wires fed by a leaf in the TwinCAT corpora (lenze-mid: 66 of
      139). If alike, refusing "a Demux of a leaf" on a structural edit blocks about half of rung edits — the reason
      4.4 measures the import first.
      *BLOCKED 2026-09-26:* no engineer-drawn TwinCAT ladder project exists on this machine. The one TwinCAT corpus
      (`twincat-project14`, the fixture) holds ONE wire (`POUexecute`, fed by the leaf `b`): 1 of 1, no share. The
      other `.TcPOU` files holding a Demux are Volt's own test and scratch bodies, and Beckhoff's
      `PlcSample_BasicPlcElements` holds none. Needs a real TwinCAT ladder project.
- [x] 1.17 Wires by producer kind across every corpus: boolean (operand used as a boolean, AND/OR/XOR/NOT, comparison,
      TRUE/FALSE, edge, ENO, Parallel) vs data (e.g. `g1 := ADD(a, b)` fanned out; a non-boolean leaf). All boolean →
      the rule is `BOOL`, a data wire goes to the marker by name; data wires found → type inference in the writer is
      its own change. A leaf producer counts as boolean only when it is TRUE/FALSE or every use is boolean.

### Census results — 2026-09-26, live CODESYS SP21 (`scripts/probe-nwl-census-v2.py`)

Five projects: Lenze_MID-S100 (40 POUs, 373 networks), pro2193 (2/3), AWA (1/2), Bakon (1/10), CodesysTestProject (0);
TwinCAT: the Project14 fixture only (4 graphical POUs — no negation, edge or Parallel, `InputFlags` null). Per task:

- **1.1** Item flags on Demux/Assign items: **0**. Only operand items carry flags (Negation 359 on Lenze operands, one Rtrig
  in pro2193 `Counters`). → no item-flag spelling; refused by name.
- **1.2** Unconnected assign: `RValue` null **0**, `Terminator(null)` **3** → Terminator(null) is the one representation.
  Unfed Parallel (second pass, the probe now tells the feed three ways — `nwl-census-v2.log`): Input null **5**, the
  empty terminator **0**, a tree 12 → the null feed is the one representation; the terminator feed is refused by name.
- **1.3** Parallels: **17** — Mode `BoxShortCircuit` 16, **`Sequential` 1** (Lenze MainDrive net1), **unfed 5** → `MODE`
  must be carried (a non-default exists); the unfed form is real.
- **1.4** Terminator with an Input: **0** → refused by name.
- **1.5** `InputParams.Names`: AND/OR/NOT `[]` everywhere (643/182/3); arithmetic/compare/MOVE only `['EN']` → infix holds
  for every ladder rung; no default formals to reconcile.
- **1.6** Consumed enabled boxes: as an Assign value 18, as a box input 66, as a Demux input 2, in a Parallel 10; top-level
  boxes with a wired output pin 107. `MainOutputIndex` 0 on 456 boxes, **1 on 3 call boxes** (Lenze
  `call_FirstErrorCapture_FB`), None on 823 → the stored index is required (review 7.3), not slot 0 by convention. Output
  slot 0 is the null ENO slot except once (`Rneeee`, same POU). Which output a consumed enabled box stands for is
  answered in the second pass (below; DIALECT N16).
- **1.7** Coil targets: Set 246, Negation+Set (reset) 128, Return 1; **negation-only 0, edge 0** → the marker stays.
- **1.8** Demux definitions: **139, all at the top level**; references 434, all nested → define-before-use holds.
- **1.11** Execute boxes: 11 (Lenze 9, Bakon 2), **all top level, never consumed** → the value form gets a synthetic
  golden only.
- **1.12** Instance text not a token: **1** (`SUPER^`, Lenze ATD_TorqueControl).
- **1.13** **CODESYS `InputFlags`: populated, and LOAD-BEARING.** 6 pins carry a Negation there ONLY (operand and item
  unflagged): Lenze `call_FirstErrorCapture_FB` (3), pro2193 `SetAlarm` (3). The reader dropped them — inverted logic
  pulled into git (Lenze `FirstErrorCapture.prg:83` shows `fbFirstErrCapture.xIsWarningInfo` plain). **Hotfixed in v1**:
  both vendors refuse a pin flag by name (`CodesysNetworkReader.RefusePinFlags`, `TcNetworkReader.ReadInputs`), tests
  `A_negation_on_a_box_input_pin_is_refused_by_name_not_dropped`, `TcPinFlagTests`. So 1.10 keeps
  `Input.Flags` (it deleted other fields instead — see 1.10). **Owner
  decision 2026-09-26 (phase 1): v2 spells NO pin flag yet** — the writer refuses one by name ("a flag on a box input
  pin"), so it reaches the marker, never the floor; a spelling (`f(NOT IN1 := x)`, and one for an operator box's unnamed
  pin) is its own decision.
- **1.17** Wires by producer (Lenze 139): boolean **124** (AND 48, OR 5, TRUE/FALSE 51, variable 17, R_TRIG 3), FB/function
  outputs **11** (Alarms_V5 ×6, fc_CamC_CP_UDT ×2, Dryer, MOVE, ADD), fed by nothing **4** (`Terminator`) → BOOL-by-producer
  covers 124; the 11 need the FB/function declaration's output type (or the marker); the 4 need `g := ;`.
- Also measured: **7 TITLEs hold a newline** (Lenze) → needs a spelling, not the marker (review 7.4 revised); comments: 7
  lines starting with `//`, 2 with an inner blank line, 1 indented, 6 with trailing whitespace; **0 labels, 0 jumps** in
  every corpus (1 RETURN), 3 disabled networks → 1.15 can only be measured by BUILDING a probe project; no vendor split
  points.
- **Open:** 1.16 (needs a real TwinCAT ladder project — the fixture has none of the shapes) and 1.14's TwinCAT order
  (BLOCKED: no licensed runtime). 1.6, 1.9, 1.15 and 1.14's CODESYS half were measured the same day (below).

### Census results — 2026-09-26, second pass (constructed and live measurements)

- **1.6** (`probe-nwl-slots.py`, consumed boxes in four projects, each NWL box paired with its PLCopen export block
  and every connection compared — 338 checked, 0 disagreeing, 22 naming no slot, 14 unpaired; DIALECT N16): the
  consumer is connected to `MainOutputIndex` wherever the export says (a call box storing 1 is read through output
  #1), and that slot is ENO exactly when the box's outputs start `ENO`. MOVE/ADD/calls showing EN/ENO are read
  through ENO (66 connections); an enabled COMPARISON (`GT`/`LT`/`LE`/`EQ` with EN, 40 boxes) has one output `''` and is
  read through it (53) — an enabled box connected by its main output, with no ENO; an FB declaring `ENO` as a variable
  without `EN` (Lenze `Dryer`) is read through ENO. `.ENO` means "connected to the ENO output", not "the box has EN".
- **1.9** chained `:=`/`S=`/`R=` in any mix: clean on SP21.
- **1.10** `Terminator.Input` and the null `Assign.Value` deleted; readers refuse both by name.
- **1.14** names: legal on both vendors, the full set on each. Order: SP21 computes `Negation+Rtrig` as `R_EDGE(NOT x)`
  and `Negation+Ftrig` as `F_EDGE(NOT x)` (simulation, `x = 00110010`), on an operand and on an AND box alike; a
  Parallel and a wire reference hold no flag (N20). TwinCAT's order: BLOCKED (no licensed runtime).
- **1.15** held on both vendors; build messages as in 1.15 above.
- **1.16** BLOCKED: no real TwinCAT ladder corpus.

## 2. Oracle red first (tests-are-the-oracle)

- [x] 2.1 A structural `NetworkModel` comparer (the model deliberately has none today). Its one equivalence: absent
      and default `InputParams` names (1.5, review 7.9).
      *Done (phase 1):* `test/shared/NetworkModelEquality.cs` + `NetworkModelEqualityTests`, strict with no
      equivalence. The one equivalence is in the oracle's normalisation, `NextNetworkTextFacts.Carried`, which
      erases an infix box's formals (absent or `IN<n>`, `NextSpelling.IsInfix`) on both sides — the list of what
      the text does not carry, kept in one place (review of section 2 corrected a note that said it was not built).
- [x] 2.2 Property test `Read(Write(m)) ≅ m` over every vendor-read fixture (Codesys reader doubles, `tc-pou/*.TcPOU`)
      and the Lenze-shape InlineData. **Must be red today** on: a `BoxTreeParallel` (reads back as AND/OR), a top-level
      box with a result pin (reads back as `Assign(Box)`).
      *Progress (phase 1):* the v2 oracle `Read(Write(m)) ≅ m` runs over every v1 test text and model, the LSP corpus (per body and per network) and the TwinCAT `tc-pou` archives (`ModelRoundTripOracleTests`, `TcModelRoundTripOracleTests`), green or refused by name. Open: the CODESYS reader doubles are not fed to it yet; the "red on v1" half belongs to the swap (3.7).
      *Done (section 2):* the CODESYS reader doubles run through the same oracle (`CodesysModelRoundTripOracleTests`,
      the shared oracle now compiled into the CODESYS suite): 31 round-trip, 1 refused by name (MOVE's result pin —
      the reader fills no output slot or ENO fact yet, 3.10/4.1), pinned. The three Execute doubles were
      `BoxType = "Execute"` with an unnamed data pin, a shape no vendor emits; they are now the measured shape
      (`Nwl.ExecuteBox`: `'EXECUTE'`, EN/ENO shown, the one input the EN wire — `nwl-execute-compare.log`). The red
      half: `The_oracle_is_red_on_v1_for_a_Parallel_and_a_result_pin` shows the model comparison failing on v1's
      round trip (the Parallel reads back a box, the result pin an Assign) while v1's text is a fixed point, and the
      same models passing v2; it goes with v1 at the swap.
      *Review of section 2:* the doubles are transcribed by hand (a double built inside a test cannot be
      harvested), so `Every_reader_test_is_transcribed_or_says_why_not` holds them to the reader tests that exist —
      every reader test is transcribed under its name or excused with a reason. It found one the list had missed
      (`A_negation_or_edge_on_an_Assign_item_is_refused_by_name`, a reader refusal).
      *Second review of section 2:* the oracle only ever wrote a body against `ScopeOf(m)`, a scope holding every
      word of the body — so it passed a writer that left an undeclared `g5` bare for its own reader to refuse (a
      pull whose scope lacks a GVL global, until 3.9). `NextModelOracle.Check` now also writes each body against
      `CallablesOf(m)` (its POUs and instances, no variable) and requires the same outcome
      (`The_oracle_writes_against_a_scope_without_the_bodys_variables`); it found two v1 test models the writer had
      broken. The writer-golden copy got the transcription guard the doubles have: `WriterGoldens` is keyed by the
      writer test that pins each model, and `Every_writer_test_is_a_golden_or_says_why_not` found 14 section-2
      models missing from it (all round-trip).
- [x] 2.3 v2 goldens for the SAME NWL shapes the split-only tests pin, red until the swap:
      `A_modifier_on_an_operand_does_not_force_a_hoisted_LET`, `An_operand_whose_own_text_is_unsafe_is_still_hoisted`,
      the en-chain InlineData (RoundTrip L56-67), `LET g28` single-consumer Demux (L139), the `i1 := DINT_TO_REAL`
      case (L144), `FanOutShapeTests` (chain vs wire), `UnspellableCoilTests` (negated/edge coils and both
      several-control-flow-target rungs still go to the marker).
      `LiteralFanoutBugTests` keeps its requirement: a Demux of a leaf is legal text, but a structurally changed
      TwinCAT network holding one is refused cleanly before it reaches the importer (which crashed on it), until 4.4
      measures the import live.
      *Done (section 2):* `NextSplitShapeGoldensTests`, keyed by the v1 test each answers — the four modifier
      statements, the unsafe operand (backticked in place), L56-67 (unwired EN, SideCorrection, the pin-less inner
      box, the fed Parallel of comparisons), L139 (`g28` with one consumer), L144 (`DINT_TO_REAL` backticked),
      FanOutShape's chain vs wire (five shapes), a Demux of a literal leaf as legal text, and UnspellableCoil's six
      marker shapes by name. The enabled comparisons carry the measured fact (EN unwired, no ENO — TrayFiller N8's
      GE), not v1's `IF en` claim. Green against Next/; the v1 tests are rewritten to them at the swap (3.7). The
      TwinCAT refusal of a structurally changed leaf-Demux network stays `LiteralFanoutBugTests` until 4.2/4.4.
- [x] 2.4 Ladder oracle goldens from lenze-mid: Mach1_MIDS N0, N10, N13, N82; TrayFiller N1, N6, N8 — each pinned as
      v2 text AND as a model, red until the swap. Positions with the `X AND (a OR b)` shape are pinned only after 1.3.
      (The design page shows N82 and N8 only.)
      *Progress (phase 1):* Mach1_MIDS N0 and TrayFiller N8 pinned as v2 text + model (`NextNetworkTextWriterTests`); N10, N13, N82, TrayFiller N1, N6 open.
      *Done (section 2):* all seven in `NextLadderOracleTests`, text and model both ways (writer golden + model
      oracle + gate). The models are transcribed from a live SP21 dump of those very networks on a copy of the
      project (`scripts/probe-nwl-oracle-rungs.py` -> `nwl-oracle-rungs.log`), not from their v1 text, which holds
      none of the v2 facts. It settled the page's two-way positions: only ‹E4› (TrayFiller N8) is a Parallel,
      ‹E1›–‹E3› are AND/OR boxes; and the GE on ‹E4›'s branch has EN shown, unwired and NO ENO output
      (`OutputParams.Names = ['']`), so it carries no `.ENO` — phase 1's TrayFiller golden (`GE(EN := , …).ENO`) and
      the page claimed the ENO. Both corrected (page "The ladder oracle" rewritten to the measured spellings).
- [x] 2.5 The slot rule (review 7.3), one test each, on the stored connection slot: a top-level box's positional `=>`
      fills slot 0; a consumed box connected by its main output has no suffix and its `=>` pins skip that slot; a
      consumed box connected by ENO says `.ENO` and its `=>` pins start at slot 0; ENO is never an `=>` slot; a
      connection by any other slot → marker; `.ENO` on a non-Execute box without EN and a consumed enabled box
      without it (`GT(ADD(EN := x, a, b), c)`) are refused; a consumed Execute box without EN writes `.ENO`.
      *Done (phase 1), on v2:* `NextNetworkTextWriterTests` / `NextNetworkTextReaderTests` / `NextNetworkTextGateTests` slot-rule tests.
      *Reopened by 1.6 (2026-09-26):* the premise "an enabled box is consumed through ENO" is measured false for the
      40 enabled comparisons (EN, one output, no ENO), and ENO exists without EN (`Dryer`). `NextSpelling.EnoSlot`
      keys ENO on `Box.Enable`; it must key on the ENO output (`Box.HasEnoSlot` over the output names). The refusals
      "consumed enabled box without `.ENO`" and "`.ENO` on a box without EN" go; `GT(ADD(EN := x, a, b), c)` is the
      case to re-decide (ADD shows ENO, so its consumer reads ENO and the text must say `.ENO`).
      *And the precedence (review):* where ENO is also the main output (outputs start `ENO`), the writer says `.ENO`;
      the PUSH refusal of a suffix-less consumer of such a box (spec, "ENO is the main output") is 4.1's test (below):
      this task's checkbox covers the writer and reader halves.
      *Done (section 2):* the model carries the fact, `Box.HasEnoOutput` (the vendor's outputs start `ENO`; null =
      not read), and `NextSpelling.EnoSlot` keys on it — never on `Enable`. The text states ENO only by `.ENO` and
      reads every other box by ONE rule both sides use (`NextSpelling.TextHasEno`: Execute or `.ENO` → has one; a
      consumer without the suffix reads a main output that is not ENO → has none; a top-level box → by its EN), and
      compares it only where it decides the text (`EnoCarried`: a consumed box's suffix, a positional pin's slot).
      Gone: "consumed enabled box without `.ENO`" and "`.ENO` on a box without EN" (both premises measured false).
      Tests: `An_enabled_comparison_consumed_by_its_main_output_has_no_suffix`, `ENO_wins_where_it_is_also_the_main_output`,
      `A_box_with_ENO_and_no_EN_consumed_by_its_ENO`, `ENO_is_never_an_output_pin`,
      `A_box_whose_ENO_output_was_not_read_goes_to_the_marker`, `A_top_level_box_whose_ENO_the_text_would_misread_goes_to_the_marker`,
      `An_enabled_box_consumed_without_a_suffix_reads_its_main_output`, `ENO_without_EN_reads_as_a_box_with_an_ENO_output`,
      and the gate's `A_consumed_enabled_box_without_ENO_is_valid_text` (`GT(ADD(EN := x, a, b), c)` re-decided: valid
      text, ADD read as connected by its main output with no ENO) and `ENO_on_a_box_without_EN_is_valid_and_on_a_box_nothing_consumes_is_not`.
      The PUSH refusals (`.ENO` on a box the IDE gives no ENO output; a suffix-less consumer of a box whose main output
      is ENO) compare the text's model with the box the IDE builds, so their one test each is the driver's — moved
      to 4.1. Not writable offline yet (review of section 2): a double holds exactly what the CODESYS writer
      appends, and the writer appends an ENO echo on EVERY enabled box (the v1 premise 1.6 refuted for the 40
      enabled comparisons) — so a refusal keyed on it would refuse the valid `out := GT(EN := c, a, b);`, and one
      keyed on the text would pass `.ENO` on a GT the IDE builds without ENO. Both need the IDE's own output list
      for the box type, which 4.1 measures live; the TwinCAT half is 4.2's.
      *Review of section 2:* an operator box consumed by its ENO is a call (`out := ADD(a, b).ENO;`), never the
      group `(a + b)` — a group has no suffix position, and it was the text of the main-output box
      (`An_operator_box_consumed_by_its_ENO_is_a_call_with_the_suffix_not_a_group`; spec "infix" and "an operator
      box consumed by its ENO"); an unread `HasEnoOutput` is refused by that name before the slot rule reads it;
      the top-level `.ENO` refusal is specified (spec ".ENO on a box nothing consumes", page NETWORK_BAD_EXPRESSION).
      *Second review of section 2:* an unread `MainOutputIndex` on a consumed box that is no bit operator is refused
      by that name too (`A_consumed_box_whose_main_output_was_not_read_goes_to_the_marker`) — it was refused as "a
      connection by an unspellable output slot" with a main output of "none", a vendor shape census 1.6 measured
      only on AND/OR.
- [x] 2.6 Wire misuse, one test each: undefined, defined with `S=`/`R=`, chained, referenced before definition, not
      `g<digits>`, a second `VAR_TEMP` block, an undeclared `g<digits>` in no scope, a declared type unlike the
      producer's (`NETWORK_BAD_EXPRESSION`); declared or defined twice, a name equal to a declared variable differing
      only in case (`NETWORK_DUPLICATE_NAME`, review 7.2; the global and FB-member cases are 3.9's); the
      block across lines accepted; the writer's collision rename to the lowest free `g<n>` read back by the reader
      with the same reserved set; the writer never reorders, and a vendor reference stored before its definition
      goes to the marker (review 7.7); a data-valued producer goes to the marker (1.17).
      *Progress (phase 1):* every misuse has a v2 gate/reader test except a wire named like a global and like an FB member seen from a method — those need the one reserved-name set (3.9).
      *Review of section 2:* the global and FB-member cases MOVE to 3.9. A test here could only state them as a flat
      name set — the input `A_wire_named_like_a_variable_in_scope` already uses — so a test named after a global
      could not fail for a global's reason (`NextNetworkScope` has no notion of one). That duplicate was deleted; the
      rename-and-accept half is `A_renamed_wire_reads_back_under_its_new_VarId`. What is open is building the scope
      from the declarations, and 3.9 now names the tests.
      *Second review of section 2:* the reader refuses a bare undeclared `g<digits>`, and the writer had no matching
      rule — a pulled operand or target named `g5` that the scope lacks was written bare and refused by its own
      reader, and the gate crashed re-spelling a backticked `` `g5` `` bare. One rule now, in `NextSpelling`
      (`ReadsAsUndeclaredWire`): the writer backticks such a name, and between backticks it is the variable of that
      name (`A_wire_shaped_name_the_scope_does_not_hold_is_backticked`,
      `A_backticked_wire_shaped_name_in_no_scope_is_the_variable_and_canonical`; spec, "a backticked wire-shaped name").
- [x] 2.7 `NetworkKeywordBoundaryTests`: a statement on the line after `NETWORK` that starts `DISABLED :=`,
      `TITLE :=` or `LABEL :=` is a statement, not a header field (the header ends at its newline); a `//` comment
      ends at its newline; header fields out of order are `NETWORK_NOT_CANONICAL`.
      *Progress (phase 1):* v2 tests cover a `DISABLED :=` statement after the header, header fields out of order and the `//` newline end; `TITLE :=` / `LABEL :=` statements and the v1 `NetworkKeywordBoundaryTests` rewrite remain (3.7).
      *Done (section 2):* `NextNetworkKeywordBoundaryTests`, the v2 form of the v1 file (the swap replaces the v1 one
      with it): `NETWORK_OK`/`NETWORK_ERR`/`NETWORKSTATE` are statements, a real header still opens a network,
      `DISABLED :=`/`TITLE :=`/`LABEL :=` on the line after the header are statements (and canonical), the same
      words ON the header line are its fields, a `//` comment ends at its newline, and three header orders are
      `NETWORK_NOT_CANONICAL`.
- [x] 2.8 Terminators and grammar holes (reviews 7.5, 7.10, 7.13, 7.14): `IF a THEN JMP Done; END_IF;` is one item
      with no empty item after it, and without the `;` is `NETWORK_PARSE`; `EXECUTE … END_EXECUTE;` likewise; the empty
      statement `;` on its own line is the empty item; `value;` for a top-level leaf, a wire reference,
      `PARALLEL(...)` and a flagged top-level box (`NOT f(x);`); `NOT(a)`, `NOT (a)`, `NOT a`, `NOT (a AND b)`,
      `NOT((a AND b))` read as box, box, modifier, modifier-on-group, box-around-group, and `((a AND b))` is refused;
      an operator box in call form (`AND(EN := go, a, b, => out);`) parses with its BoxType as head; a backticked
      lvalue and a backticked call head round-trip; `MOVE()` (no input slot) vs `MOVE(IN := )` (one unwired);
      `PARALLEL(IN := , a, b)` vs `PARALLEL(a, b)`.
      *Progress (phase 1):* covered on v2 (`END_IF;`, the empty item, `value;` forms, the NOT/parentheses table, `((a AND b))`, operator call form, backticks, `MOVE()` vs `MOVE(IN := )`, `PARALLEL(…)` as the one unfed form and `PARALLEL(IN := , …)` refused — 1.2) except an explicit `END_EXECUTE` without its `;` → `NETWORK_PARSE` test.
      *Done (section 2):* `END_EXECUTE_without_its_semicolon` — the statement and the `.ENO` value form both
      `NETWORK_PARSE` without it; with it, one Execute item and no empty item after it.
- [x] 2.9 EXECUTE: the empty body is exactly one empty line between `EXECUTE` and `END_EXECUTE`; the value form
      `… END_EXECUTE.ENO` round-trips.
      *Done (phase 1), on v2:* `Execute_boxes_statement_empty_and_value_forms`, `EXECUTE_bodies_are_verbatim_lines`, and the writer-golden read-back.
- [x] 2.10 Pull never throws (review 7.4), each a model fed to the writer: operand text with a backtick, a TITLE with a
      newline, a snippet holding a line whose first word is `END_EXECUTE` → marker, no exception; a snippet holding
      `NetworkState := 1;` round-trips and pushes.
      *Done (phase 1), on v2:* backtick in operand text and `END_EXECUTE` snippet line → marker; `NetworkState := 1;` round-trips and passes the gate. Owner decision: a TITLE newline is now spelled with `$N` escapes (round-trips), not the marker.
- [x] 2.11 Edges (reviews 7.8, 7.12): `R_EDGE(x)`/`F_EDGE(x)` read back as a flag on the operand, never a box;
      `R_EDGE(NOT x)` is Negation+Rtrig (was `NOT R_EDGE(x)`; reopened by 1.14, the vendor negates first);
      `NOT R_EDGE(x)` → `NETWORK_BAD_EXPRESSION`; `R_EDGE(F_EDGE(x))` and a POU
      named `R_EDGE` → `NETWORK_UNSUPPORTED`; Rtrig+Ftrig on one pulled operand → marker; a flag on an empty slot →
      marker on pull, `NETWORK_UNSUPPORTED` on push.
      *Reopened by 1.14 (2026-09-26):* `Negation_with_an_edge_is_NOT_outside`, `A_modifier_inside_an_edge` and the
      goldens writing `NOT F_EDGE(…)` pinned the order the vendor does NOT compute (DIALECT N17).
      *Done (review of section 1), on v2:* rewritten to N17 first, red, then the writer (`R_EDGE(NOT x)`, on an
      operand and a box) and the reader (NOT inside an edge is the flag; NOT outside one is
      `NETWORK_BAD_EXPRESSION`; a second modifier inside is refused; `R_EDGE(NOT F_EDGE(x))` is nested) —
      `Negation_with_an_edge_is_NOT_inside`, `A_negation_goes_inside_an_edge_and_nowhere_else`,
      `Edges_are_flags_on_their_operand_never_a_box`, `An_edge_on_a_NOT_box_round_trips`, `Nested_edges`,
      `A_POU_or_instance_named_like_a_construct`, `Rising_and_falling_on_one_operand_goes_to_the_marker`,
      `A_flag_on_an_empty_slot(_goes_to_the_marker)`. The TwinCAT marker for Negation+edge is 4.2.
- [x] 2.12 Marker routing for unmeasured facts (reviews 7.1, 7.6): a CODESYS pin flag in `InputFlags`, a flag on a
      Demux item, a flag on an Assign item → marker on pull, the flag never dropped.
      *Done (phase 1), on the v2 writer:* pin flag, Demux-item and Assign-item flags → marker by name. The CODESYS driver reading `InputFlags` into the model is 4.1.
- [x] 2.13 Untested shapes (review 7.17), each a golden text + model: a DISABLED header with and without LABEL, with
      and without a wire block (262 in lenze); an edge on EN (the pro2193 ActuatorFB shape); an LD rising contact;
      `R_EDGE((a AND b))`; an edge on a `.ENO`; NOT with an edge; edges in PARALLEL branches; ENO into a data pin
      (Lenze `fc_CamC_CP_UDT`); a negated-only coil → marker. (An edge on a wire REFERENCE was on this list; N20
      showed the IDE cannot hold one, so it is a refusal, not a golden — `A_flag_on_a_wire_reference_or_a_Parallel`.)
      *Progress (phase 1):* DISABLED/LABEL headers, an edge on EN, `R_EDGE((a AND b))`, an edge on `.ENO`, NOT with an edge and the negated-only coil are pinned on v2; an LD rising contact, edges in PARALLEL branches and ENO into a data pin still need their golden.
      *Done (section 2):* `NextUntestedShapesTests`, text + model each: an LD rising contact (and a negated falling
      one, `F_EDGE(NOT a)`), edges and a negation on a Parallel's feed and branches (the Parallel holds none, N20),
      and ENO into a data pin in Lenze AHWF's `fc_CamC_CP_UDT` shape (a MOVE's `.ENO` into `iEN : BOOL`).
      *Second review of section 2:* the DISABLED headers were pinned only as `header.full` (LABEL, TITLE, comment and
      block together) and as gate acceptances; the four combinations — with and without LABEL, with and without a
      wire block, nothing else in the header — are now golden text + model in `NextUntestedShapesTests`.
- [x] 2.14 Comments and labels: a multi-line comment with an empty line (`//`), an indented line and a line starting
      `//` round-trips byte-identically; a blank line between `//` lines is layout; a `//` after a statement →
      `NETWORK_PARSE`; a comment on a network with LABEL, TITLE, DISABLED and a wire block writes header, comment,
      block, statements; a DISABLED network with a LABEL that is a jump target round-trips; a `JMP` inside a
      DISABLED network round-trips; a `JMP` to a missing label passes the gate; one label on two networks
      (`Done` / `DONE`) follows 1.15: held on both vendors, so accepted and kept verbatim.
      *Progress (phase 1):* comment shape, `//` after a statement, header/comment/block/statement order, a DISABLED labelled jump target and a jump to a missing label are pinned on v2.
      *Done (review of section 1):* the two 1.15 shapes no task carried — `A_jump_inside_a_disabled_network_round_trips`,
      `A_label_on_two_networks_is_accepted_and_kept_verbatim`.
      *Second review of section 2:* the lone-CR rule (spec, "a line ending in a lone CR") covered only a CR at a
      line's END. A lone CR ends a line wherever it stands — an editor breaks the line there — and inside a `//` line
      the lexer read everything after it as comment, so a statement the engineer saw vanished from the push. Now a
      comment or EXECUTE line holding any CR but the one of its CR LF goes to the marker on pull and is
      `NETWORK_PARSE` on push (`A_lone_CR_inside_a_comment_or_snippet_line_goes_to_the_marker`,
      `A_lone_CR_inside_a_comment_or_snippet_line_is_refused`).

## 3. The swap (one change, no dual reader)

- [x] 3.1 `NetworkTextWriter` as one fold, one arm per NWL class; state = VarId→name map only. Delete the m/i/en arms,
      `_prelude`/`Flush`, `_en/_i/_m` counters, `EnabledAssign`/`EnabledCall`, operand-position hoist,
      Parallel-as-AND/OR. Shrink the Unspellable detector to the marker-only shapes: a rung with several control-flow
      targets (coil + jump, two jumps) and a negated/edge coil; `JumpDestinationTests` keeps pinning it. Add the
      marker routing for unmeasured facts (pin and item flags, nested Demux, reference before definition, a data wire,
      Rtrig+Ftrig, a flag on an empty slot). Edges as `R_EDGE(…)`/`F_EDGE(…)`; wires in a per-network `VAR_TEMP` typed
      `BOOL` from the producer.
      *Done (swap, 2026-09-26):* the section-2 writer IS `Format/Network/NetworkTextWriter` now; the v1 writer, its
      arms, prelude and counters are deleted, and so is `Unspellable` — every shape it named is the writer's own
      refusal (`NetworkUnrepresentableException`), which both drivers' pulls turn into the marker. `JumpDestinationTests`
      pins it on v2: a coil beside a jump goes to the marker by name in either order, a lone jump names its flagged
      target. The marker routing is pinned by the writer tests of 2.10–2.12.
- [x] 3.2 `NetworkTextReader` as a token stream + recursive descent; the `VAR_TEMP` wire set decides Demux; `.ENO`
      asserts EN (Execute excepted); every statement ends with `;`, the empty statement is the empty item; `value;`
      statements; structural parentheses; edges. Delete `MergeEnableEchoes`, `Build` classification, `CountRefs`,
      `Resolve`/`Combine`, `ReferencesToDemux`, `FoldableConsumers`, the OpaqueLeaf/MultiOutput/WireName regexes.
      *Done (swap):* the section-2 reader is `Format/Network/NetworkTextReader`; the v1 reader and every function named
      here are gone from `src/`. (".ENO asserts EN" is superseded by 1.6/2.5: `.ENO` means the ENO output, independent
      of EN — the spec wins.) The v1 reader survives ONLY as a test fixture, `test/shared/V1CorpusReader.cs`, which
      reads the v1 LSP corpus into models for the oracle until 6.1 re-pulls it; nothing in `src/` can reach it.
- [x] 3.3 Body-level language on `(* @volt-implementation FBD|LD *)`, one marker per graphical body (method, action,
      accessor); ST bodies keep the bare marker; `(* @volt-graphical: CFC *)` unchanged. Update `ImplementationMarker`
      (today an exact match on the bare form), `StReader` and the LSP body detection. `RefuseViewModeChange` compares
      one header.
      *Done:* `ImplementationMarker` matches the bare and the language form and splits/joins a body's own marker
      line; `StWriter` writes a graphical body's marker in the bare one's place (POU, method, action, accessor —
      after it the `%FOLDER` directive), `StReader` puts it back in front of the body, so a body alone says what it is
      (`NetworkText.Is`/`LanguageOf` read the first line). Golden: `ChildDirectiveTests.An_ST_function_block_with_an_LD_method_and_an_FBD_getter`
      and the rewritten `Folder_and_language_round_trip_as_directives`. Both drivers refuse a view change against the
      model's language, which is the marker's. LSP: `isGraphicalBody` reads the marker (`graphicalMarkerLanguage`,
      `network.test.ts`), and keeps the `NETWORK`-first-token test for the v1 bodies its parser reads until 5.1/6.1.
- [x] 3.4 `NetworkTextGate`: token fixed point; newlines significant in the header, comments and EXECUTE bodies;
      whitespace significant only in backticks, TITLE, comments and EXECUTE (no `NOT(` lexeme, review 7.13).
      `NETWORK_NOT_CANONICAL` now reports a token difference only. The wire type is checked against the producer.
      *Done (swap):* the section-2 gate is THE gate; the push path reaches it through `NetworkText.Validate(body,
      scope)`, which throws the first finding as `NetworkTextException` (code + line) for `PushService`'s conflict.
- [x] 3.5 v1 text (`LET`, `NETWORK <n> <LANG>`) → `NETWORK_PARSE` naming "re-pull"; drop `NETWORK_DUPLICATE_NETWORK`.
      *Done:* a v1 body sits behind the BARE marker, so nothing calls it network text; the push pre-flight refuses it by
      name (`NetworkText.RefuseV1`) before it could be written as ST — `PushServiceTests.A_v1_body_is_refused_naming_a_re_pull_and_nothing_is_written`;
      inside a v2 body the reader refuses `LET` and a numbered header (`V1_text_is_refused_naming_a_re_pull`).
      `NETWORK_DUPLICATE_NETWORK` is gone from `ConflictCodes` and the generated docs; `DocDataTests` now also pins that
      no `NETWORK_*` literal stands in for a const. (The LSP still carries its own copy of the code until 5.1.)
- [x] 3.6 Refuse by name (review 7.8): a backtick inside backticked text; a POU or instance named `PARALLEL`,
      `R_EDGE` or `F_EDGE` (a backticked head too); nested edges; a flag on an empty slot; an unmeasured
      `Parallel.Mode` (owner decision: `Sequential` is carried as `MODE := Sequential`).
      *Done:* the gate tests of section 2 (`A_backtick_inside_backticked_text`, `A_POU_or_instance_named_like_a_construct`,
      `A_backticked_head_named_like_a_construct_is_refused_at_the_call`, `Nested_edges`, `A_flag_on_an_empty_slot`,
      `An_unmeasured_Parallel_mode`) run on the swapped gate, and against a scope BUILT from a project's declarations:
      `NetworkScopeTests.A_project_function_named_R_EDGE_makes_its_call_unspellable` (bare and backticked) and its
      complement.
- [x] 3.7 Groups 2.2–2.14 green; `NetworkTextRoundTripTests` convergence cases rewritten to v2 input.
      *Done:* the section-2 tests moved out of `next/` under their final names and are green. `NetworkTextRoundTripTests`
      is rewritten: every convergence and real-project case is its v2 text, pinned CANONICAL (the gate accepts it and
      the writer gives back the same bytes) against a scope built from a declaration. The v1 tests whose shapes are v2
      goldens are deleted (`FanOutShapeTests`, `UnspellableCoilTests`, `LiteralFanoutBugTests`,
      `NetworkTextDiagnosticsTests`, `MetadataPlacementTests`, the v1 `NetworkKeywordBoundaryTests`; the
      `ParallelRenderTests` class), as are the oracle's v1-text harvest and `The_oracle_is_red_on_v1_…`, which went
      with v1. Every other suite's v1 input is v2 now (ChildDirective, StFormatRoundTrip, AccessorPreflight, Hasher,
      PouMergeWrite, PushService, RenameBeforeWrite; the TwinCAT suites through `TcText`; `ladderLabel.prg`).
      *TwinCAT's `LiteralFanoutBugTests` requirement* (a structurally changed network holding a Demux of a leaf is
      refused before the importer) has no v2 test yet: the text is legal (golden `LiteralFanout.a-Demux-of-a-leaf`) and
      the refusal is 4.2's.
- [x] 3.8 Layout after push: the CLI records the IDE's re-materialized (canonical) text as `volt/ide` and brings the
      working tree to it; a black-box CLI test pushes a hand-wrapped call and asserts the next pull reports nothing.
      *Done:* `Commands.Push` hashes each pushed item's text as the IDE's version is hashed; where the receipt's version
      differs, ONE directed fetch returns the IDE's own text, which is committed as `volt/ide` on top of HEAD and
      fast-forwarded into the working tree (the sidecar keeps the fetched versions). `FakeIde` holds a written
      graphical body as the model re-materialized, as a real IDE does. Test:
      `PushCommandTests.A_hand_wrapped_graphical_call_is_adopted_in_the_IDEs_layout_after_the_push`.
- [x] 3.9 One reserved-name set (review 7.2), built once and used by writer and reader: POU vars, globals, the owning
      FB's members from a method/action, keywords, literals, `PARALLEL`/`R_EDGE`/`F_EDGE`, case-insensitive. Wire
      names `g<digits>` only; the writer's collision rename takes the lowest free `g<n>`. Tests (moved from 2.6,
      review 7.2), each with the scope BUILT from the declarations, never stated as a name list: a wire named like a
      GVL global and like the owning FB's member, read in a method and in an action → refused
      `NETWORK_DUPLICATE_NAME` on read, case-insensitively; the writer renames around each and the reader accepts
      that text against the same built scope.
      *Done:* `NetworkScope.FromDeclarations(declaration, declarationOf, globals)` — the body's declarations innermost
      first (`SourceScopes.Scope`), the project's items by name, every GVL read lazily — and `ProjectDeclarations`, the
      one per-operation index both drivers and `FakeIde` build it from (`ICodeStore.NetworkScopeFor`; the engine's
      pre-flight asks the driver, so it reads a body exactly as the write will). An FB instance's type comes from the
      declaration that makes it (a member, a GVL global, a qualified path through a GVL and a struct), so the drivers'
      v1-only type resolvers (`CodesysNetworkWriter.ResolveBoxType` and its pre-flight, `TcPlcOpenWriter.TypeNameOf`)
      are deleted. Tests: `NetworkScopeTests` (GVL global and owner member, in a method and in an action, refused and
      renamed-and-accepted; instance types; a POU named `R_EDGE`), `PushServiceTests.A_wire_named_like_a_projects_global_is_refused_by_the_pre_flight`.
- [x] 3.10 Model (review 7.3): carry the slot index on `Output` and the connection slot on a consumed `Box`
      (`ReadBoxOutputs` stops dropping null slots); both drivers read and write them; the slot rule reads them.
      *Done:* CODESYS reads `MainOutputIndex`, the connection slot of a consumed box (= its main output, DIALECT N16),
      `HasEnoOutput` and each output's slot; TwinCAT reads the same facts, the connection slot from the one NULL output
      item the archive stores for it (the archive serializes no `MainOutputIndex`; DIALECT N16 now records both
      spellings — confirmation on a live TwinCAT is 4.4). Both writers place a positional pin at its slot (CODESYS
      pads a passed-over slot with the empty operand an unwired pin is; TwinCAT's in-place write matches a positional
      pin by slot, a named one by name). Tests: `CodesysNetworkReaderTests.A_consumed_box_is_connected_by_its_main_output_and_an_operator_by_none`,
      `An_unnamed_output_pin_is_the_boxs_own_result_pin_not_an_assign`, `CodesysCoilFlagTests.A_positional_output_pin_is_written_at_its_slot`,
      `TcDemuxTests.A_consumed_box_records_the_slot_its_consumer_reads`; the oracle tallies: CODESYS doubles 33/33 with
      no refusal, TwinCAT archives 13 bodies / 21 networks with one (the drawn coil-and-jump rung, marker-only).
- [x] 3.11 Pull never throws (review 7.4): every writer refusal becomes a marker route; EXECUTE ends at the first line
      whose first word is `END_EXECUTE`; the reader's `network` line check matches the whole word at a line start,
      outside EXECUTE bodies.
      *Done:* both drivers' pulls catch the writer's one exception and materialize the marker (the `Unspellable`
      pre-pass is gone); the writer raises nothing else (argument nulls aside). The EXECUTE and header rules are the
      section-2 reader's (`NetworkState := 1;` in a snippet, `END_EXECUTE` goldens). The change gates render the live
      network with the body's scope, and a live network the writer cannot spell is refused on push rather than
      destroyed and rebuilt (CODESYS) or treated as changed and walked structurally (TwinCAT).
- [x] 3.12 Comments: `//` plus one space is syntax, the rest is text; an empty line is `//`; `//` only between the
      header and the wire block or first statement.
      *Done:* the section-2 rules (2.14 tests), on the swapped reader and writer.

*Review of section 3 (2026-09-26), each fix pinned by a test that was red first:* both vendor readers fill
`Box.OutputTypes` from `OutputParams.Types` (a wire a WORD AND or an ADD feeds is declared with the stored type —
`TcDemuxTests.A_wire_fed_by_a_box_is_declared_with_its_stored_output_type`,
`CodesysNetworkReaderTests.A_wire_fed_by_a_data_box_is_declared_with_its_stored_output_type`); the CODESYS writer
writes the ENO echo from `HasEnoOutput`, not EN (`The_ENO_slot_is_written_for_the_box_that_has_one_…`); the CLI
adopts only a LAYOUT after a push — an IDE holding other tokens stays an IDE-side change the next pull brings
(`PushCommandTests.A_pushed_body_the_IDE_holds_as_other_tokens_is_not_adopted_as_a_layout`,
`NetworkTextGate.SameTokens`); the scope follows `EXTENDS`, reads a namespace-qualified type whole
(`t : Standard.TON`), compares an instance's type case-insensitively, and reads a pushed GVL by its first code line
(`NetworkScopeTests`, review section); the reader's second view check and its `language` parameter are gone — the
marker says the language and `RefuseViewModeChange` is the one comparison. *Still unmeasured live:* whether CODESYS
builds an enabled box Volt creates without an ENO slot (the shape of 40 vendor comparisons), and a base FB the project
does not hold (a library base) still contributes no inherited names — 4.x.

*Second review of section 3 (2026-09-26), each fix pinned by a test that was red first:* the post-push comparison
reads a `.task` as a descriptor, not ST — it threw after the IDE had applied the push
(`PushCommandTests.A_pushed_task_the_IDE_holds_in_its_canonical_layout_is_adopted`); an item the directed fetch does
not give back is named as such, never "another program" (`…_whose_text_the_IDE_does_not_give_back_…`); the spec's
round-trip requirement now says only a LAYOUT is adopted; `SameTokens` compares a VAR_TEMP block by what it declares,
as the gate does (`NetworkSpelling.WireBlockKey`, one spelling for both), and enters EXECUTE bodies through the lexer's
one scope-free walker (`NetworkLexer.Walk`, shared with `PairAheadHoldsOperator`) so a nested snippet stays verbatim
(`NetworkTextGateTests`, post-push section); an FB instance box's type SPELLING is listed beside the oracle
(`NetworkTextFacts`) and the scope tests read their text back; TwinCAT's in-place writer compares box types by
`StDeclaration.SameType`, so `t : Tc2_Standard.TON` over a stored `TON` is edited in place
(`TcRoundTripTests.An_FB_call_typed_by_its_declarations_spelling_is_edited_in_place`); the view-change refusal has a
test through each driver's write (`CodesysViewModeTests`, `TcRoundTripTests.A_marker_naming_the_other_view_…`);
`SUPER^` and the inherited scope share one EXTENDS scanner (`StCallTargetTests.SUPER_in_a_member_is_its_owners_base`);
TwinCAT reads an `OutputParam` with no `Types` as null, as CODESYS does
(`TcDemuxTests.An_OutputParam_with_no_stored_types_reads_as_none_read`); the CODESYS build takes an unstated ENO from
the text's rule (`NetworkText.HasEnoOutput`) rather than a copy of it; the pull scope is
`ProjectDeclarations.ScopeForPull`, one empty push map instead of three.

## 4. Drivers

- [x] 4.1 CODESYS: build `BoxTreeParallel` from the model; the unnamed output-slot operand for `=> v`; write each
      Demux's VarId verbatim (unchanged); read `InputFlags` into `Input.Flags` (1.13). Model-built tests for each.
      The push half of 2.5 (spec, "EN is a pin, ENO is spelled"): after building a box, refuse by name `.ENO` on a
      box the IDE gives no ENO output, and a suffix-less consumer (`HasEnoOutput` false) of a box whose main output
      is ENO — one test each, and read `HasEnoOutput` from `OutputParams.Names` (`Box.HasEnoSlot`).
      `Parallel.Mode` both ways — *done (review of section 1):* the reader reads it and the writer sets it (a freshly
      built `BoxTreeParallel` is `Sequential`, DIALECT N20); no flag is written on a Demux or a Parallel (the model
      has none).
      *Done offline (section 4):* `InputFlags` reads into `Input.Flags` (the EN slot's flag has no model place and stays
      refused by name); the text writer refuses it as before, so a pull still names the pin by its feed
      (`A_negation_on_a_box_input_pin_is_read_into_the_model_and_the_pull_names_it`, `An_edge_on_a_box_input_pin_is_read_onto_that_pin`,
      `A_flag_on_the_enable_pin_is_refused_by_name`, `Pin_flags_stay_aligned_past_the_enable`; the oracle tally now
      refuses 3 by that name). Demux VarId verbatim: `A_wire_is_written_under_the_models_VarId_verbatim`; a model pin
      flag never reaches a rebuild: `A_pin_flag_in_the_model_is_refused_by_name_not_dropped`. **The ENO refusals rest on
      a live measurement that corrects this task's premise** (DIALECT N21, `scripts/probe-nwl-eno-build.py` → built and
      RUN in simulation): the vendor derives no `OutputParams` for a box Volt constructs and `MainOutputIndex` is
      read-only, so "the IDE's box" cannot be read back from `OutputParams.Names` — the compiler reads a box Volt builds
      through ENO exactly when it has EN (MOVE, whatever list Volt writes), a consumed enabled comparison does not
      compile in any form, and ADD without EN carrying ENO is "Missing EN pin". `CodesysNetworkWriter.RefuseUnbuildableEno`
      refuses those by name before the network is destroyed
      (`A_consumer_the_built_box_would_read_otherwise_is_refused_by_name_before_anything_is_destroyed`, 4 rows;
      `A_consumer_the_built_box_reads_as_written_is_built`); `The_ENO_slot_is_written_…`'s two GT rows were exactly the
      unbuildable shapes and are MOVE/LIMIT rows now; spec scenario "the box CODESYS builds decides by EN" added.
- [x] 4.2 TwinCAT: a value edit stays in place. A structurally changed network is imported (D22c/D25/D30/C25/C20);
      until measured live it refuses `PARALLEL`, a Demux of a leaf and a result pin `=> v` with `NETWORK_UNSUPPORTED`,
      the message naming the network and the reason (review 7.16). Offline tests for each refusal. Read
      `Parallel.Mode` (done, below). Until 1.14 measures TwinCAT's evaluation order, a pulled Negation+edge on one
      node goes to the marker by name (spec, "edges are R_EDGE and F_EDGE flags"). The push half of "EN is a pin,
      ENO is spelled" is vendor-neutral, so TwinCAT carries it too: refuse by name `.ENO` on a box the IDE gives no
      ENO output, and a suffix-less consumer of a box whose main output is ENO — one test each, the imported box's
      output list read as CODESYS reads it (`Box.HasEnoSlot`).
      *`Parallel.Mode` done (review of section 1):* read by member name, an absent/unknown value refused by name; the
      in-place writer refuses a changed mode (no committed archive holds a Parallel, so the scalar is never authored)
      — reachable only since the no-change gate compares modes (`The_in_place_writer_refuses_a_Parallel_mode_change`).
      *Done (section 4):* `TcUnmeasured.RefuseImport` refuses `PARALLEL`, a wire fed by a leaf and a result pin
      `=> v` in a changed network with `NETWORK_UNSUPPORTED`, naming the network and the shape, before `resolve` (the
      import) — and in the PLCopen lowering, so a create and its pre-flight refuse the same way
      (`TcStructuralEditTests`: the three refusals with a `resolve` that fails the test if reached, a retype that still
      reaches it, `A_create_holding_an_unmeasured_shape_is_refused_by_the_lowering`, and
      `A_value_edit_on_a_network_holding_a_Parallel_is_written_in_place`). The ENO refusals are `TcEnoRefusal`, raised
      by the post-import compare against the imported box's `OutputParam/Names` (`Box.HasEnoSlot`) and never swallowed
      by the create path's regrouping catch (`A_consumer_without_ENO_on_a_box_the_import_gives_an_ENO_main_output_…`,
      `ENO_on_a_box_the_import_gives_no_ENO_output_…`). A negation with an edge on one node is the marker on pull
      ("a negation with an edge", operand and box) and refused on push (`A_negation_with_an_edge_*`).
- [x] 4.3 TwinCAT: delete `TcNetworkWriter.Unhoist`'s legacy fold; keep the D25 component count; the in-place
      tree-count check holds by construction.
      *Done (section 4):* `Unhoist` is gone; `Rungs` counts connected components by the wires each top-level item
      defines or reads, at any depth — the fold joined only `out := g1;`, and census 1.8 found all 434 references
      nested, so such a network was refused as "would split it" (`TcStructuralEditTests.A_wire_read_inside_its_consumers_is_one_rung_and_reaches_the_importer`,
      red first; `Two_rungs_sharing_no_wire_are_still_refused_as_a_split`). It only counts, so the in-place item-count
      check compares the model in its own shape.
- [x] 4.4 Live e2e on both vendors (`pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys|twincat`, then
      `bun run test:e2e:codesys` / `test:e2e:twincat`): roundtrip, fanout, real-project-shapes, parity-fixes
      ("editing one operand leaves every wire name alone"), graphical-kinds (mixed ST FB + LD method, accessors),
      labels (1.15 shapes), and the TwinCAT Demux-of-a-leaf case from 2.3 (refused cleanly, or imported — measured;
      1.16 says how much rides on it). Stage explicit paths, never `git add -A`.
      *Done (section 4), live on both vendors (fixture copies via `ide.ps1`, Project14 on TwinCAT):* the six suites are
      network text v2 now and green — roundtrip 13, fanout 2, real-project-shapes 7, parity-fixes 9, graphical-kinds
      18, labels 9: **58 pass on CODESYS and 58 on TwinCAT** (the operand oracle and its offline self-check,
      `test/unit/oracle.test.ts`, moved to v2 with them). Labels gained the four 1.15 shapes, round-tripped exactly on
      both. The leaf wire of 2.3 (`fanout.test.ts`): CODESYS round-trips it; TwinCAT refuses it by name before the
      import (`NETWORK_UNSUPPORTED`, network and wire named) — and the import was MEASURED with the refusal lifted
      (DIALECT N22): no crash, but reshaped both ways (a coil-read leaf wire folds into a chained assign, a box-read
      one returns under an importer-minted VarId `g1883419948`), so the refusal stands. The live run found five
      driver bugs, each fixed with an offline test on a committed capture: a consumed box Volt BUILT pulled as the
      marker on both vendors — CODESYS stores no `MainOutputIndex` on it (read-only), measured by running
      `MAX(1, 2)`/`ADD(1, 2)` to read slot 0 (N21, `A_consumed_box_Volt_built_is_connected_as_the_compiler_reads_it`),
      TwinCAT's import stores no null slot (`importer-max.TcPOU`, `A_consumed_box_the_import_built_is_connected_by_its_one_output`
      and `…_before_the_repair_too`); TwinCAT's import kept Volt's own `In1`/`In2` pin names, so `MAX(a, b)` came back
      named and the stamp silently wrote nothing (`Positional_pins_are_written_over_the_names_the_import_took_from_Volt`,
      `A_pin_name_the_IDE_holds_is_not_blanked_by_a_positional_push`, plus a live build: `a created stateless function
      call compiles`); and an unwired pin the import built came back as an empty backticked name
      (`importer-unwired.TcPOU`, `An_unwired_pin_the_import_built_reads_as_the_empty_slot_and_pushes_back_unchanged`).
      Test changes whose premise the measurements refuted: the EN-pin test pushes `AND(EN := go, a, b).ENO` (N21: the
      suffix-less form is refused on CODESYS) and accepts TwinCAT's named ENO refusal; `parity-fixes`' wire count and the
      fixed-point test's shape are vendor-stated (D22/C25: TwinCAT's import folds a wire; a titled network holding one
      is refused rather than stamped, so the fixed point uses the chained assign both vendors create).
- [ ] 4.5 Ladder census round trip: lenze-mid pull → gate → push into an empty project → re-pull; per network compare
      Demux (573), multi-output Assign (40), Parallel (17), EN boxes.

## 5. LSP and editor

- [ ] 5.1 Parser: the per-network `VAR_TEMP` wire block into network scope, chained targets, backticks (inner text
      parsed as an Expr; backticked targets and call heads), `.ENO` (BOOL), `=> v`, `EN :=` on any call including
      PROGRAM calls, `R_EDGE`/`F_EDGE` (builtins, BOOL→BOOL), structural parentheses (no `NOT(` lexeme), `PARALLEL`,
      `value;` statements, `END_IF;`/`END_EXECUTE;`, EXECUTE value form. Delete the LET branch, `isEnBinding`,
      `parseEnEnoIf`, IF-body flattening.
- [ ] 5.2 `collectVoidCallTargets`, `isBoxOutput` and `checkHoles` learn the `=> v` pin form and `.ENO`
      (`??? := PRG_void_callee()` may become `PRG_void_callee(EN := , => ???)`, `??? := MOVE(src)` may become
      `MOVE(src, => ???)` — unresolved-marker.test.ts L148, L162). Re-measure against the recorded builds; the recorded
      false positive must not return.
- [ ] 5.3 Wire semantic-token class resolved through the network scope; hover shows `g22 : BOOL` and its producer.
- [ ] 5.4 volt-vscode TextMate rules for backticks, `VAR_TEMP` in a network, `R_EDGE`/`F_EDGE`.
- [ ] 5.5 corpus.test.ts and build-conformance re-measured; no new LSP-only message.
- [ ] 5.6 Label diagnostics at parity with the builds recorded in 1.15 (missing label, duplicate label, label on a
      DISABLED network) — a conformance fixture each; no message the build does not give.

## 6. Migration and docs

- [ ] 6.1 Bump MATERIALIZATION 2 → 3; re-pull the six corpora; rewrite e2e bodies and conformance fixtures
      (`network-graphical.ts`, `network-unresolved.ts`); re-record live only where a message moved. Delete
      `test/shared/V1CorpusReader.cs` with the re-pull (the swap kept it only to read the v1 corpus for the oracle).
- [ ] 6.2 Replace `docs/network-text.html` with `docs/network-text-next.html`; fix the stale model doc for the
      unconditional jump (NetworkModel.cs vs DIALECT C11), the reader header ("decided by USE COUNT") and the
      ParallelRenderTests "forces a g" comment.
- [ ] 6.3 Archive: check the spec delta still describes what was built; delete the recreated `openspec/specs/`.
- [ ] 6.4 Release notes / CLI message: push pending graphical edits before upgrading — un-pushed v1 edits meet the
      re-materialization as a whole-body conflict and cannot be pushed as v1.
- [ ] 6.5 Ship CLI, LSP and volt-vscode together; a version check compares the workspace MATERIALIZATION with the
      LSP's and names the mismatch instead of flagging every body `NETWORK_PARSE`.
- [ ] 6.6 Grep `network-text.html#` (about 27 links in source, tests, wire.html and DIALECT.md: #diagnostics, #grammar, #let, #opaque, #sink, #eneno,
      #unnamed-instance, #fb, #empty-slot, #group, #whitespace) and confirm each id exists on the new page or rewrite
      the link.
- [ ] 6.7 Add `network-text-next.html` to the docs nav (`assets/doc.js` GROUPS) as "Network text (next)" and to
      `index.html` until the swap.
- [ ] 6.8 Fix `packages/volt-lsp-iec/docs/codesys-reference/01-languages-and-editors.md:33-34`: `S=`/`R=` are
      level-triggered (set/reset while the operand is TRUE), not transitions (review 7.15).

## 7. Review 2026-09-26 — index

Three independent reviews found the gaps below before any code; each is now a rule on the design page and a spec
requirement, and its work lives in the phase above.

| review | where it went |
|---|---|
| 7.1 CODESYS `InputFlags` unread | 1.13, 1.10 blocked, 2.12, 4.1 |
| 7.2 wire names vs case | 3.9, 2.6 |
| 7.3 output slots not in the model | 1.6, 3.10, 2.5 |
| 7.4 refuse on push, never throw on pull | 3.11, 2.10 |
| 7.5 `statement = value ";"` | 3.2, 2.8 |
| 7.6 item-level flags | 1.1, 2.12 |
| 7.7 nested Demux, vendor item order | 1.8, 2.6 |
| 7.8 refuse by name | 3.6, 2.11 |
| 7.9 infix vs default formals | 1.5, 2.1 |
| 7.10 empty slots `MOVE()`, `PARALLEL(IN := , …)` | 1.2, 2.8 |
| 7.11 consumed Execute without EN | 1.11, 2.5 |
| 7.12 `R_EDGE` / `F_EDGE` | 1.14, 2.11, 3.1, 5.1 |
| 7.13 no `NOT(` whitespace rule | 3.4, 2.8, 5.1 |
| 7.14 `END_IF;`, the empty item | 3.2, 2.8 |
| 7.15 keep `S=`/`R=`, chained assignment | 6.8 |
| 7.16 TwinCAT leaf-wire scale | 1.16, 4.2, 4.4 |
| 7.17 untested shapes | 2.13 |
| owner, same day: comments, labels, jumps | 1.15, 2.14, 3.12, 5.6 |
| owner, same day: per-network `VAR_TEMP` wires typed from the producer | 1.17, 2.6, 3.1, 5.1, 5.3 |
