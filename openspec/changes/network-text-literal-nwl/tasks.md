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
- [x] 1.3 The 17 Lenze `BoxTreeParallel`s: which of the 54 `X AND (a OR b)` shapes they are, `Mode` values, fed vs
      unfed. Until this lands, no design or golden publishes a single "after" spelling for that shape.
- [x] 1.4 `BoxTreeTerminator` with an Input: 0 → refused by name like Mux; >0 → a `TERMINATOR(x)` spelling.
- [x] 1.5 Do operator boxes carry `InputParams.Names`, and are they the operator's defaults? Infix is kept when the
      formals are absent or default — one text for both, the driver writes the defaults, the comparer treats them as
      equal; only a non-default name forces call form (ADD/MUL/GE/AND in TrayFiller N8) (review 7.9).
- [ ] 1.6 Output slots (review 7.3): frequency of a top-level box's unnamed result pin vs `Assign(Box)`; live on FBD
      and LD, which slot a consumer is connected to — an Assign over an enabled box (ENO?), box-in-box nesting with
      and without EN, `MainOutputIndex` values, and whether an enabled box is ever connected by its main output
      (if so, the "consumed enabled box needs `.ENO`" refusal becomes "no suffix = main output").
- [x] 1.7 Target Negation-only / Rtrig / Ftrig bits across all corpora (archive census, not pulled text). 0 → stay on
      the marker (today: 0 of 576); >0 → propose a spelling with a live constructor build, in its own change.
- [x] 1.8 Demux definition positions (every sample so far is top-level); a definition nested below the top level, or
      a reference stored before its definition — frequency; each gets a spelling or stays on the marker, never a
      silent reorder (review 7.7). TwinCAT single-consumer Demux frequency.
- [ ] 1.9 Chained `S=`/`R=` assignment parses on SP21 ST (readability/LSP parity only — network text is not compiled).
- [ ] 1.10 Delete `NetworkModel.Input.Flags` and any field 1.1–1.4 proves dead. **Blocked on 1.13**: the "null in
      22/22" count is TwinCAT-only.
- [x] 1.11 Is an Execute box ever consumed (its ENO continuing the rung), and with EN unwired? The value form
      `EXECUTE … END_EXECUTE.ENO` is specified either way (an Execute box's only output is ENO, so `.ENO` needs no
      EN — review 7.11); the census decides corpus golden vs synthetic.
- [x] 1.12 FB instances whose operand text is not a token (`fbs[1]`) — frequency; spelled as a backticked call head.
- [x] 1.13 **CODESYS `InputFlags` (review 7.1, blocking).** `CodesysNetworkReader.cs:199` writes `Flags.None` and
      `scripts/nwl-execute-compare.log:68` shows a populated `Array[Flags]`. Live: set an edge and a negation on a
      box-to-box pin, read where they land. Found → the pin spelling on the formal (`f(NOT IN1 := x)`,
      `f(R_EDGE(CLK) := x)`), distinct from the value's flag (`f(CLK := R_EDGE(x))`); until then a pulled pin flag
      goes to the marker.
- [ ] 1.14 `R_EDGE` / `F_EDGE` (review 7.12): check neither SP21 nor TwinCAT lets a POU or instance take the names;
      measure the vendor's evaluation order for Negation+Rtrig on one operand (the text's one order is
      `NOT R_EDGE(x)`).
- [ ] 1.15 Labels and jumps, live on both vendors, recording each build message: one LABEL on two networks of a body
      (can the IDE hold it; case-insensitive?); a LABEL on a DISABLED network as a jump target (still a target?); a
      `JMP` inside a DISABLED network; a `JMP` to a label no network carries. The gate refuses only what the IDE
      cannot hold; the rest is LSP parity (5.6).
- [ ] 1.16 TwinCAT ladder (review 7.16): the share of wires fed by a leaf in the TwinCAT corpora (lenze-mid: 66 of
      139). If alike, refusing "a Demux of a leaf" on a structural edit blocks about half of rung edits — the reason
      4.4 measures the import first.
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
- **1.3** Parallels: **17** — Mode `BoxShortCircuit` 16, **`Sequential` 1** (Lenze MainDrive net1), **unfed 5** → `MODE`
  must be carried (a non-default exists); the unfed form is real.
- **1.4** Terminator with an Input: **0** → refused by name.
- **1.5** `InputParams.Names`: AND/OR/NOT `[]` everywhere (643/182/3); arithmetic/compare/MOVE only `['EN']` → infix holds
  for every ladder rung; no default formals to reconcile.
- **1.6** Consumed enabled boxes: as an Assign value 18, as a box input 66, as a Demux input 2, in a Parallel 10; top-level
  boxes with a wired output pin 107. `MainOutputIndex` 0 on 456 boxes, **1 on 3 call boxes** (Lenze
  `call_FirstErrorCapture_FB`), None on 823 → the stored index is required (review 7.3), not slot 0 by convention. Output
  slot 0 is the null ENO slot except once (`Rneeee`, same POU). *Still open:* which output a consumed enabled box stands
  for — needs a constructed live network.
- **1.7** Coil targets: Set 246, Negation+Set (reset) 128, Return 1; **negation-only 0, edge 0** → the marker stays.
- **1.8** Demux definitions: **139, all at the top level**; references 434, all nested → define-before-use holds.
- **1.11** Execute boxes: 11 (Lenze 9, Bakon 2), **all top level, never consumed** → the value form gets a synthetic
  golden only.
- **1.12** Instance text not a token: **1** (`SUPER^`, Lenze ATD_TorqueControl).
- **1.13** **CODESYS `InputFlags`: populated, and LOAD-BEARING.** 6 pins carry a Negation there ONLY (operand and item
  unflagged): Lenze `call_FirstErrorCapture_FB` (3), pro2193 `SetAlarm` (3). The reader dropped them — inverted logic
  pulled into git (Lenze `FirstErrorCapture.prg:83` shows `fbFirstErrCapture.xIsWarningInfo` plain). **Hotfixed in v1**:
  both vendors refuse a pin flag by name (`CodesysNetworkReader.RefusePinFlags`, `TcNetworkReader.ReadInputs`), tests
  `A_negation_on_a_box_input_pin_is_refused_by_name_not_dropped`, `TcPinFlagTests`. v2 MUST spell pin flags (the
  `f(NOT IN1 := x)` form; for an operator box's unnamed pin a positional spelling is still to decide) — 1.10 is cancelled.
- **1.17** Wires by producer (Lenze 139): boolean **124** (AND 48, OR 5, TRUE/FALSE 51, variable 17, R_TRIG 3), FB/function
  outputs **11** (Alarms_V5 ×6, fc_CamC_CP_UDT ×2, Dryer, MOVE, ADD), fed by nothing **4** (`Terminator`) → BOOL-by-producer
  covers 124; the 11 need the FB/function declaration's output type (or the marker); the 4 need `g := ;`.
- Also measured: **7 TITLEs hold a newline** (Lenze) → needs a spelling, not the marker (review 7.4 revised); comments: 7
  lines starting with `//`, 2 with an inner blank line, 1 indented, 6 with trailing whitespace; **0 labels, 0 jumps** in
  every corpus (1 RETURN), 3 disabled networks → 1.15 can only be measured by BUILDING a probe project; no vendor split
  points.
- **Open:** 1.6 (live semantics of a consumed enabled box), 1.9, 1.14, 1.15 (constructed probe project), 1.16 (needs a real
  TwinCAT ladder project — the fixture has none of the shapes).

## 2. Oracle red first (tests-are-the-oracle)

- [ ] 2.1 A structural `NetworkModel` comparer (the model deliberately has none today). Its one equivalence: absent
      and default `InputParams` names (1.5, review 7.9).
- [ ] 2.2 Property test `Read(Write(m)) ≅ m` over every vendor-read fixture (Codesys reader doubles, `tc-pou/*.TcPOU`)
      and the Lenze-shape InlineData. **Must be red today** on: a `BoxTreeParallel` (reads back as AND/OR), a top-level
      box with a result pin (reads back as `Assign(Box)`).
- [ ] 2.3 v2 goldens for the SAME NWL shapes the split-only tests pin, red until the swap:
      `A_modifier_on_an_operand_does_not_force_a_hoisted_LET`, `An_operand_whose_own_text_is_unsafe_is_still_hoisted`,
      the en-chain InlineData (RoundTrip L56-67), `LET g28` single-consumer Demux (L139), the `i1 := DINT_TO_REAL`
      case (L144), `FanOutShapeTests` (chain vs wire), `UnspellableCoilTests` (negated/edge coils and both
      several-control-flow-target rungs still go to the marker).
      `LiteralFanoutBugTests` keeps its requirement: a Demux of a leaf is legal text, but a structurally changed
      TwinCAT network holding one is refused cleanly before it reaches the importer (which crashed on it), until 4.4
      measures the import live.
- [ ] 2.4 Ladder oracle goldens from lenze-mid: Mach1_MIDS N0, N10, N13, N82; TrayFiller N1, N6, N8 — each pinned as
      v2 text AND as a model, red until the swap. Positions with the `X AND (a OR b)` shape are pinned only after 1.3.
      (The design page shows N82 and N8 only.)
- [ ] 2.5 The slot rule (review 7.3), one test each, on the stored connection slot: a top-level box's positional `=>`
      fills slot 0; a consumed box connected by its main output has no suffix and its `=>` pins skip that slot; a
      consumed box connected by ENO says `.ENO` and its `=>` pins start at slot 0; ENO is never an `=>` slot; a
      connection by any other slot → marker; `.ENO` on a non-Execute box without EN and a consumed enabled box
      without it (`GT(ADD(EN := x, a, b), c)`) are refused; a consumed Execute box without EN writes `.ENO`.
- [ ] 2.6 Wire misuse, one test each: undefined, defined with `S=`/`R=`, chained, referenced before definition, not
      `g<digits>`, a second `VAR_TEMP` block, an undeclared `g<digits>` in no scope, a declared type unlike the
      producer's (`NETWORK_BAD_EXPRESSION`); declared or defined twice, a name equal to a declared variable differing
      only in case, to a global, to an FB member seen from a method (`NETWORK_DUPLICATE_NAME`, review 7.2); the
      block across lines accepted; the writer's collision rename to the lowest free `g<n>` read back by the reader
      with the same reserved set; the writer never reorders, and a vendor reference stored before its definition
      goes to the marker (review 7.7); a data-valued producer goes to the marker (1.17).
- [ ] 2.7 `NetworkKeywordBoundaryTests`: a statement on the line after `NETWORK` that starts `DISABLED :=`,
      `TITLE :=` or `LABEL :=` is a statement, not a header field (the header ends at its newline); a `//` comment
      ends at its newline; header fields out of order are `NETWORK_NOT_CANONICAL`.
- [ ] 2.8 Terminators and grammar holes (reviews 7.5, 7.10, 7.13, 7.14): `IF a THEN JMP Done; END_IF;` is one item
      with no empty item after it, and without the `;` is `NETWORK_PARSE`; `EXECUTE … END_EXECUTE;` likewise; the empty
      statement `;` on its own line is the empty item; `value;` for a top-level leaf, a wire reference,
      `PARALLEL(...)` and a flagged top-level box (`NOT f(x);`); `NOT(a)`, `NOT (a)`, `NOT a`, `NOT (a AND b)`,
      `NOT((a AND b))` read as box, box, modifier, modifier-on-group, box-around-group, and `((a AND b))` is refused;
      an operator box in call form (`AND(EN := go, a, b, => out);`) parses with its BoxType as head; a backticked
      lvalue and a backticked call head round-trip; `MOVE()` (no input slot) vs `MOVE(IN := )` (one unwired);
      `PARALLEL(IN := , a, b)` vs `PARALLEL(a, b)`.
- [ ] 2.9 EXECUTE: the empty body is exactly one empty line between `EXECUTE` and `END_EXECUTE`; the value form
      `… END_EXECUTE.ENO` round-trips.
- [ ] 2.10 Pull never throws (review 7.4), each a model fed to the writer: operand text with a backtick, a TITLE with a
      newline, a snippet holding a line whose first word is `END_EXECUTE` → marker, no exception; a snippet holding
      `NetworkState := 1;` round-trips and pushes.
- [ ] 2.11 Edges (reviews 7.8, 7.12): `R_EDGE(x)`/`F_EDGE(x)` read back as a flag on the operand, never a box;
      `NOT R_EDGE(x)` is Negation+Rtrig; `R_EDGE(NOT x)` → `NETWORK_BAD_EXPRESSION`; `R_EDGE(F_EDGE(x))` and a POU
      named `R_EDGE` → `NETWORK_UNSUPPORTED`; Rtrig+Ftrig on one pulled operand → marker; a flag on an empty slot →
      marker on pull, `NETWORK_UNSUPPORTED` on push.
- [ ] 2.12 Marker routing for unmeasured facts (reviews 7.1, 7.6): a CODESYS pin flag in `InputFlags`, a flag on a
      Demux item, a flag on an Assign item → marker on pull, the flag never dropped.
- [ ] 2.13 Untested shapes (review 7.17), each a golden text + model: a DISABLED header with and without LABEL, with
      and without a wire block (262 in lenze); an edge on EN (the pro2193 ActuatorFB shape); an LD rising contact;
      `R_EDGE((a AND b))`; an edge on a wire reference; an edge on a `.ENO`; NOT with an edge; edges in PARALLEL
      branches; ENO into a data pin (Lenze `fc_CamC_CP_UDT`); a negated-only coil → marker.
- [ ] 2.14 Comments and labels: a multi-line comment with an empty line (`//`), an indented line and a line starting
      `//` round-trips byte-identically; a blank line between `//` lines is layout; a `//` after a statement →
      `NETWORK_PARSE`; a comment on a network with LABEL, TITLE, DISABLED and a wire block writes header, comment,
      block, statements; a DISABLED network with a LABEL that is a jump target round-trips; a `JMP` to a missing
      label passes the gate; a duplicate label (case-differing) follows 1.15.

## 3. The swap (one change, no dual reader)

- [ ] 3.1 `NetworkTextWriter` as one fold, one arm per NWL class; state = VarId→name map only. Delete the m/i/en arms,
      `_prelude`/`Flush`, `_en/_i/_m` counters, `EnabledAssign`/`EnabledCall`, operand-position hoist,
      Parallel-as-AND/OR. Shrink the Unspellable detector to the marker-only shapes: a rung with several control-flow
      targets (coil + jump, two jumps) and a negated/edge coil; `JumpDestinationTests` keeps pinning it. Add the
      marker routing for unmeasured facts (pin and item flags, nested Demux, reference before definition, a data wire,
      Rtrig+Ftrig, a flag on an empty slot). Edges as `R_EDGE(…)`/`F_EDGE(…)`; wires in a per-network `VAR_TEMP` typed
      `BOOL` from the producer.
- [ ] 3.2 `NetworkTextReader` as a token stream + recursive descent; the `VAR_TEMP` wire set decides Demux; `.ENO`
      asserts EN (Execute excepted); every statement ends with `;`, the empty statement is the empty item; `value;`
      statements; structural parentheses; edges. Delete `MergeEnableEchoes`, `Build` classification, `CountRefs`,
      `Resolve`/`Combine`, `ReferencesToDemux`, `FoldableConsumers`, the OpaqueLeaf/MultiOutput/WireName regexes.
- [ ] 3.3 Body-level language on `(* @volt-implementation FBD|LD *)`, one marker per graphical body (method, action,
      accessor); ST bodies keep the bare marker; `(* @volt-graphical: CFC *)` unchanged. Update `ImplementationMarker`
      (today an exact match on the bare form), `StReader` and the LSP body detection. `RefuseViewModeChange` compares
      one header.
- [ ] 3.4 `NetworkTextGate`: token fixed point; newlines significant in the header, comments and EXECUTE bodies;
      whitespace significant only in backticks, TITLE, comments and EXECUTE (no `NOT(` lexeme, review 7.13).
      `NETWORK_NOT_CANONICAL` now reports a token difference only. The wire type is checked against the producer.
- [ ] 3.5 v1 text (`LET`, `NETWORK <n> <LANG>`) → `NETWORK_PARSE` naming "re-pull"; drop `NETWORK_DUPLICATE_NETWORK`.
- [ ] 3.6 Refuse by name (review 7.8): a backtick inside backticked text; a POU or instance named `PARALLEL`,
      `R_EDGE` or `F_EDGE`; nested edges; a flag on an empty slot; a non-default `Parallel.Mode`.
- [ ] 3.7 Groups 2.2–2.14 green; `NetworkTextRoundTripTests` convergence cases rewritten to v2 input.
- [ ] 3.8 Layout after push: the CLI records the IDE's re-materialized (canonical) text as `volt/ide` and brings the
      working tree to it; a black-box CLI test pushes a hand-wrapped call and asserts the next pull reports nothing.
- [ ] 3.9 One reserved-name set (review 7.2), built once and used by writer and reader: POU vars, globals, the owning
      FB's members from a method/action, keywords, literals, `PARALLEL`/`R_EDGE`/`F_EDGE`, case-insensitive. Wire
      names `g<digits>` only; the writer's collision rename takes the lowest free `g<n>`.
- [ ] 3.10 Model (review 7.3): carry the slot index on `Output` and the connection slot on a consumed `Box`
      (`ReadBoxOutputs` stops dropping null slots); both drivers read and write them; the slot rule reads them.
- [ ] 3.11 Pull never throws (review 7.4): every writer refusal becomes a marker route; EXECUTE ends at the first line
      whose first word is `END_EXECUTE`; the reader's `network` line check matches the whole word at a line start,
      outside EXECUTE bodies.
- [ ] 3.12 Comments: `//` plus one space is syntax, the rest is text; an empty line is `//`; `//` only between the
      header and the wire block or first statement.

## 4. Drivers

- [ ] 4.1 CODESYS: build `BoxTreeParallel` from the model; the unnamed output-slot operand for `=> v`; write each
      Demux's VarId verbatim (unchanged); read `InputFlags` into `Input.Flags` (1.13). Model-built tests for each.
- [ ] 4.2 TwinCAT: a value edit stays in place. A structurally changed network is imported (D22c/D25/D30/C25/C20);
      until measured live it refuses `PARALLEL`, a Demux of a leaf and a result pin `=> v` with `NETWORK_UNSUPPORTED`,
      the message naming the network and the reason (review 7.16). Offline tests for each refusal.
- [ ] 4.3 TwinCAT: delete `TcNetworkWriter.Unhoist`'s legacy fold; keep the D25 component count; the in-place
      tree-count check holds by construction.
- [ ] 4.4 Live e2e on both vendors (`pwsh packages/volt-cli/scripts/ide.ps1 up -Vendor codesys|twincat`, then
      `bun run test:e2e:codesys` / `test:e2e:twincat`): roundtrip, fanout, real-project-shapes, parity-fixes
      ("editing one operand leaves every wire name alone"), graphical-kinds (mixed ST FB + LD method, accessors),
      labels (1.15 shapes), and the TwinCAT Demux-of-a-leaf case from 2.3 (refused cleanly, or imported — measured;
      1.16 says how much rides on it). Stage explicit paths, never `git add -A`.
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
      (`network-graphical.ts`, `network-unresolved.ts`); re-record live only where a message moved.
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
