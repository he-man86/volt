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
**Order (owner 2026-10-12):** this change runs AFTER `bridge-one-to-one`, which rebuilds the item contract and the push/driver
write paths; build 1b.4 and the shapes on that new contract, and reuse its vendor-facts rows and oracle harness.

Owner: "we have control over the resulting code so we must make it as easy for ourself" — "this is the moment to close all
gaps and make it futureproof". **Rule P1: network text is the NWL tree one to one for every member that is not a measured
editor cache.** Nothing is folded or guessed ("probably inert"); a member that carries data is spelled. The census covers
the vendor's whole SCHEMA, not only the shapes the six corpora happen to use, so a new project's shape is already decided.

- [x] 1b.1 Schema census: every class and member of the NWL object model on both vendors (the shipped DLLs' types —
      `BoxTreeBox`, `BoxTreeOperand`, `BoxTreeAssign`, `BoxTreeDemux`, `Parallel`/`Terminator`, `Operand`, `Flags`,
      `Network`, `OutputItemList`, `InputParam`/`OutputParam`, jumps/labels/returns, EXECUTE, every other class the DLL
      defines), with each member's value distribution over the six corpora (all networks, both vendors). Found already:
      the reader takes `Operand.SymbolComment` into the model and the writer never writes it; `Operand.Comment` is not read
      at all — measure both (non-empty counts per corpus, and whether either is engineer-typed or derived from the
      declaration). A measure, not a probe script; any vendor fact it needs is a `vendor-facts` row.
      **Default (owner 2026-10-12, "better to be safe and make it as 1 to 1 as possible"): a member is SPELLED unless a
      measurement proves it an editor cache** (derived from other members or the declarations, and rebuilt by the IDE on
      push). No proof, no exclusion — an unforeseen case can then only make the text longer, never lose data.

      **Measured 2026-10-15.** Two halves, both mechanical; the scripts were scratch (as 0.1's), not kept, and no product
      code changed. (1) **Schema** — `MetadataLoadContext` over the shipped assemblies: CODESYS SP21 Patch 4
      `Common\NWLObject.dll` + `PlugIns\d35e1e67…\4.6.0.0\NWLObject.plugin.dll` (4.6.0.0), TwinCAT
      `Components\Plc\Common\NWLObject.dll` (3.5.13.0) + `Plugins\d35e1e67…\3.5.13.30\NWLObject.plugin.dll`; a member is
      ARCHIVED when its field carries `[DefaultSerialization("<name>")]` (that name is the archive's — the `<v n=…>` of a
      `.TcPOU`, the `SerializableValueNames` of a live CODESYS object). (2) **Values** — every NWL body of the six corpora,
      its WHOLE archive: CODESYS by an in-proc runscript (`ide.ps1 up -Instance ld-fbd-coverage -Fixture <corpus copy>
      -RunScript`, the 0.1 project files; `GetAllObjects` → each object whose archive `Implementation` is an
      `NWLImplementationObject` → `SerializableValueNames`/`GetSerializableValue` recursively, no depth cut), TwinCAT by
      parsing the `<NWL><XmlArchive>` of the Project14 `.TcPOU`s offline (the corpus is the two in the `.plcproj`; the two
      outside it, `ladder`/`POU_PBD`, were checked separately and add no member or value). Bodies found = 0.1's exactly:
      **46** (lenze-mid 40, pro2193 2, awa-palletizer 1, bakon-nano 1, CodesysTestProject 0, twincat-project14 2), **394
      networks** (373 / 3 / 2 / 10 / 0 / 6), `DefaultViewMode` `Ld` 36 / `Fbd` 10. 11,085 archived nodes, none unreadable.

      **The schema is identical on both vendors — 15 concrete archived classes + their base, 74 archived members**, same
      TypeGuids, names, CLR types, `StorageVersion`s and defaults; every corpus body's archive member set equals that
      contract exactly, on both vendors (nothing extra, nothing missing), and the `.TcPOU` order is the field declaration
      order (own fields, then `Id`). Types: CODESYS 210 / TwinCAT 174 (145 / 116 public); the CODESYS-only ones are the
      PLCopen importer/exporter (`PLCopenXML.*`), `Modification.*` (normalization/parallelization services), `Edge`,
      `OperandExtensions`, `IPLCopenXMLAddData*` — none archived. Shared types differ in 6, none archived (`Flags.None`/
      `Negated` static helpers, PLCopen plumbing on `APEnvironment`/`DependencyBag`, `Strings`, `Ad.DefaultBooleanType`,
      `AbstractNWLStructuredSnippetProvider.BranchInput`). Every other public type (≈100: `I*` interfaces, visitors,
      checkers, factories, comparers, `NetworkBuilder`, `ImplicitVariable*`, enums `NWLDisplayMode` LD/FBD/IL,
      `OperationMode` Sequential/BoxShortCircuit, `FlagsModifier`, …) is behaviour or a member-less component registration,
      never body content. `Flags.Flags` is a bit field: Negation 1, Set 2, Reset 3 (= both), Jump 4, Return 8, Rtrig 16,
      Ftrig 32. **The claim covers the 15 NWL classes, not the ST document an EXECUTE box embeds:** `STSnippet.STSnippet`
      is an `STImplementationObject` → `TextDocument` from the ST/TextDocument assemblies, and THAT archive differs per
      vendor (TwinCAT 3.5.13: `TextDocument.TextLines` — `Id`, `Tag`, `Text` per line; CODESYS SP21: `TextDocument.
      LineInfoPersistence` + `TextBlobForSerialisation`, the text through the aspect) — see the `STSnippet` row.

      The members with their value distribution (n = occurrences over the six corpora; per corpus where it is not all
      lenze-mid; `—` = 0 occurrences):

      | class (corpora count) | member: values |
      |---|---|
      | `AbstractNWLItem` (base) | `Id` Int64, on every node that derives from it (Network, every BoxTree*, Operand, STSnippet, ILStatement); 11,085 ids, none `-1`, **unique within each body** (0 duplicates in 46) |
      | `NWLImplementationObject` 46 | `DefaultViewMode` "Ld" 36 / "Fbd" 10 · `NetworkList` 1–17 networks · `NetworkListComment` "" ×46 · `ValidIds` true ×46 · `BranchCounter` 0 ×23, else 1…328 — not the Parallel count, ≥ the largest Demux `VarId` in most bodies but not all (10 vs 9, 38 vs 37): a counter, unmeasured |
      | `Network` 394 | `Title` non-empty 260 (lenze-mid; 257 distinct) · `Comment` non-empty 20 (lenze 17, pro2193 2, bakon 1) · `Label` non-empty 2 (twincat-project14 `testLabel`/`testLabe2`) · `OutCommented` true 3 · `NetworkItems` 0–17 trees (Assign 483, Box 184, Demux 140, Operand 1) · `Connectors` empty ×394 · `ILLines` empty ×394 · `ILActive`/`ILValid`/`FBDValid` false ×394 |
      | `BoxTreeAssign` 489 (lenze 479, pro 1, bakon 4, tc 5) | `OutputItems` 1 target ×449, 2–5 ×39, 20 ×1 · `RValue` Box 400 / Demux 56 / Operand 22 / Parallel 7 / Terminator 4 · `Flags` 0 and `Fixed` false ×489 |
      | `BoxTreeBox` 1305 (lenze 1282, pro 7, awa 2, bakon 9, tc 5) | `BoxType` 98 distinct (AND 648, OR 184, MOVE 102, …, EXECUTE 12) · `CallType` 19 values (And 648, Or 184, FunctionBlock 157, Function 113, Move 102, Add 17, Ge 13, None 12, Gt 11, Program 11, Lt 10, Eq 7, Mul 5, Sub 5, Le 3, Not 3, Div 2, Ne 1, Conversion 1) · `EN`/`ENO` null ×815 (every And/Or without a stored slot), else bool; EN≠ENO on 40 (the comparisons Ge/Gt/Lt/Le/Eq/Ne: EN true, ENO false) · `InputItems` 1–40 (Operand 2822, Box 627, Demux 376, Terminator 43, Assign 6, Parallel 6) · `InputFlags` null ×1298, a list as long as the inputs ×7 (22 pin flags: negation 6, 0 ×16; lenze 16, pro2193 6) · `InputParam` `Names`/`Types` always the same length; empty ×842 (every And/Or/Not, 5 Eq, 1 Move, 1 Conversion), = the input count on every call (FB/Function/Program/None), otherwise a partial list (operators naming some pins) · `OutputParam` `Names` = the output slot count except 10 Program + 4 Function boxes; a function's result pin is named `"   "` (three spaces) ×105, `""` elsewhere · `OutputItems` slots 0–40, exactly one null slot on every box with slots except 10 Program boxes (2 of 2 null); And/Or with a stored slot (S1) 17, Not 3 of 3 · `Instance` operand: `Operand` null ×1148, a name ×157 (FB instances); `Type` = `BoxType` on 152 of 157 FB instances, "AND" on 22 And boxes, "" otherwise · `STSnippet` set ⇔ `ProvidesSTSnippet` true, 12 (EXECUTE) · `ContainsExtensibleInputs` false ×1305 · `Flags` 0 ×1305, `Fixed` true ×215 |
      | `BoxTreeOperand` 2926 | `Operand` (an `Operand`) |
      | `BoxTreeDemux` 576 (lenze 573, tc 3) | `VarId` 71 distinct · `Input` a producer (Operand 69, Box 67, Terminator 4) on the 140 at the top level, null ×436 (every use) |
      | `BoxTreeParallel` 17 (lenze) | `Mode` BoxShortCircuit 16 / Sequential 1 · `Trees` 2 ×16, 3 ×1 (Box 23, Operand 8, Parallel 4) · `Input` null ×5, else Box/Operand/Demux 4 each |
      | `BoxTreeTerminator` 51 (lenze 50, tc 1) | `Input` null ×51 · `Flags` 0, `Fixed` false ×51 |
      | `BoxTreeMux` — | `VarId`, `InputIndex`, `Merger` (an `IBoxTreeBox`) — 0 occurrences |
      | `ILStatement` — | `Operator`, `Prefix`, `Operand` (IOperand), `Postfix` — 0 occurrences (`Network.ILLines` always empty) |
      | `STSnippet` 12 (lenze 9, bakon 2, tc 1) | `STSnippet` an `STImplementationObject` (archives `TextDocument` only, both vendors) → `TextDocument`, whose archive DIFFERS by vendor. **TwinCAT** (1 snippet, `POUexecute`): `TextLines` 2 lines, each `Id` (17, 14 — minted, not sequential, in the body's NWL id space, no collision; the snippet node is 18), `Tag` null ×2, `Text`; `TcNetworkReader` keeps only the `Text`, and `TcNetworkWriter` edits a line's text in place (Ids kept) and refuses a line-count change. **CODESYS** (11): the archive names are `LineInfoPersistence` and `TextBlobForSerialisation`, both null as `GetSerializableValue` answers them on every snippet (as on every ST body, bridge-one-to-one's `editor-caches` / `text-blob-serialisation`); the lines live in the in-memory document — re-walked 2026-10-15 (gate 1b-1, own CODESYS on bakon-nano, scratch probe, not kept): `GetLineId`/`GetLineTag` per line, 56 lines over the 2 snippets, Ids consecutive (1336…1386, 1534…1538), `Tag` null ×56, and **the LAST line's Id equals the STSnippet node's own `Id`** (1386, 1538 — both snippets): the line ids share the body's id space and are NOT disjoint from the NWL ids, so "unique within each body" (row 1) holds for NWL items only. CODESYS's writer builds a fresh `STSnippet` on a rebuilt network (line ids minted by the IDE) |
      | `Operand` 5313 | `Operand` (the expression): a name ×3695, "" ×470 (281 unconnected box outputs, 188 box inputs, 1 lone tree), null ×1148 (function/operator instances) · `Type` a type ×3777, "" ×1203, null ×333 · **`Comment` "" ×5313 — 0 non-empty in all six corpora, both vendors** · **`SymbolComment` "" ×5303, non-empty 10** (below), the sentinel `Constant_SymbolComment_Serialization_Value` ×0 and null ×0 (re-counted from the census's raw archive dumps, gate 1b-1: the dumps hold raw values — they carry the Address sentinel ×258 — and no SymbolComment sentinel in any corpus; per corpus "" lenze 5199, awa 13, bakon 59, pro2193 12, tc 20) · `Address` "" ×5055, the archive sentinel `Constant_Address_Serialization_Value` ×258 (lenze-mid) — no real address anywhere · `LValue` true ⇔ the operand is an assign target or a box output slot (1082 / 1082, no exception) · `IsInstance` true ⇔ it is a box's `Instance` (1305 / 1305) · `Boolean` true 2347 — NOT `Type = BOOL` (323 BOOL-typed are false, 18 untyped are true) · `Flags` 0 ×4706, Negation 359 (box inputs 353, Demux input 4, others 2), Set 118 / Reset 128 / Return 1 (all assign targets), Rtrig 1 (box input), Jump/Ftrig 0; `Fixed` true ×1686 (box inputs 1343, assign targets 250, Demux inputs 64, …), never on a box output or instance |
      | `Flags` 7180 | `Flags` as above · `Fixed` true ×1914 (operands 1686, boxes 215, input pins 13; never on Assign/Terminator) — not read by either reader, meaning unmeasured · `Extensible` false ×7180 |
      | `OutputItemList` 1794 | `OutputItems` 0–40 slots (Operand 1082, null 490) |
      | `ParamList` 2610 | `Names` / `Types` index-aligned string lists (Types 116 distinct: BOOL 1488, `BOOL[REF]` 147, …) |

      **`Operand.Comment`:** 0 non-empty of 5313 (every corpus, both vendors), so there is no witness of who writes it; no
      reader takes it (the CODESYS and TwinCAT readers read `SymbolComment`, never `Comment`). **`Operand.SymbolComment`:**
      10 non-empty, all in pro2193 `Cylinder_53ValveFB.SetAlarm` (FBD), each the verbatim text of a `//` declaration
      comment in the project (the leading space is the one after `//`) — so **derived from a declaration, not typed in
      the network** — but not always the operand's OWN: `xOutInv` ×3 and `xSensor` ×3 carry their own declaration's
      comment, while `xOutput` ×3 carries `" Condition to set the alarm."` (`SetErrorFB.alarmCondition`'s; its own is
      `" The output"`) and the `SetAlarm` coil `" Alarm is active."` (`SetErrorFB.active`'s) — a copy taken when the
      operand was placed and never resynchronized — so the IDE does NOT re-derive it from the operand's own symbol (the
      `TcNetworkWriter` comment that said it does was corrected in gate 1b-1). By the owner's default it is SPELLED until a
      `vendor-facts` row proves otherwise.

      **A live loss, closed in gate 1b-1 (until 2.3 spells it): a rebuild erased `SymbolComment`.** The CODESYS writer
      builds every operand of a CHANGED network fresh (`NwlInterop.New`) and never sets it, and TwinCAT's import rebuild of
      a changed SHAPE does the same — so any edit to pro2193 `SetAlarm` silently erased all 10, with no text diff (the text
      never held them). Both drivers now refuse such a network before the rebuild, per NETWORK, `NETWORK_UNSUPPORTED`,
      naming the network and operands (`NetworkText.RefuseSymbolCommentLoss`; tests
      `CodesysNetworkWriterGateTests.A_changed_network_holding_a_symbol_comment_is_refused_before_the_tear_down`,
      `TcStructuralEditTests.A_structural_change_to_a_network_holding_a_symbol_comment_is_refused_before_the_importer`, red
      before the fix); an unchanged network is never rebuilt, so pull → push unchanged still works. Corpus reach: 1
      network (pro2193 `SetAlarm`). **The same CODESYS rebuild also drops `Flags.Fixed` (1914 set) and `Operand.Boolean`
      (2347 true)** — whether the IDE re-derives them is unmeasured, so this is a loss CANDIDATE on every rebuilt CODESYS
      network (TwinCAT edits in place and keeps both; its import rebuild is the same candidate): 1b.2 measures both
      (`vendor-facts`) and 2.3 spells them unless the row proves a cache. They are not refused meanwhile: Fixed is set on
      1686 operands, so a refusal would refuse nearly every CODESYS LD/FBD edit on a guess.

      **Open for 1b.2 — every member the table shows unexplained, unwitnessed or undecided** (each a `vendor-facts` row
      before it can be called a cache; no vendor fact was needed for this census):
      - `Operand.SymbolComment` (spelling; rebuilt on push?), `Flags.Fixed` (what it is; 1914 set), `Operand.Boolean` (not
        derivable from `Type` — from what?) — the three a CODESYS rebuild drops (above).
      - `Network.FBDValid`/`ILValid`/`ILActive`, `NWLImplementationObject.BranchCounter`/`ValidIds`,
        `NWLImplementationObject.NetworkListComment` ("" ×46, never non-empty — no witness of who writes it).
      - `AbstractNWLItem.Id` (unique per body among NWL items, re-minted on push?).
      - `STSnippet`'s document: TwinCAT `TextLines[].Id` (minted, kept by the in-place write, an invented one refused) and
        `TextLines[].Tag` (null ×2); CODESYS per-line Ids/Tags (consecutive, the last = the snippet's own `Id`; Tag null
        ×56) and `TextDocument.LineInfoPersistence`/`TextBlobForSerialisation` (null as read; bridge-one-to-one's caches
        for ST bodies, no `vendor-facts` row yet). Whether a CODESYS rebuild re-mints them and whether the shared id is
        load-bearing is unmeasured.
      - `BoxTreeBox.EN`/`ENO` stored values (EN≠ENO on 40 comparisons — EN true, ENO false; null ×815) and
        `BoxTreeBox.InputFlags` (a list on 7 boxes, 22 pin flags: negation 6, 0 ×16 — where 0 is stored rather than null).
      - `ParamList` names/types of calls (= the callee's signature?), the function result pin's `"   "`, and the 14 boxes
        whose `OutputParam.Names` count differs from the output slot count (10 Program — both slots null — and 4 Function).
      - `Box.Instance.Type` (= `BoxType` on 152 of 157 FB instances: the 5 that differ, and "AND" on 22 And boxes).
      - `BoxTreeParallel.Mode` (read and written today; Sequential 1) and `BoxTreeParallel.Input` (null ×5, else
        Box/Operand/Demux 4 each — a fed Parallel).
      - `BoxTreeDemux.VarId` (71 distinct; kept verbatim, renumbered, or minted on push?).
      - `BoxTreeAssign.Flags` and `BoxTreeTerminator.Flags` (0 on all 489 / 51; `Fixed` false on all) and
        `BoxTreeTerminator.Input` (null ×51 — readers refuse one by name, task 1.10).
      - `Operand.Address`: "" or the archive sentinel ×258 (= unset: no real address in any corpus); `SymbolComment`'s
        sentinel occurs 0 times (above), so "= unset" is the CODESYS reader's rule without a corpus witness.
      Derivable from position in every corpus operand (cache candidates by measurement, push rebuild still to show):
      `Operand.LValue`, `Operand.IsInstance`, `BoxTreeBox.ProvidesSTSnippet`. Zero occurrences, decided without a corpus
      witness: `BoxTreeMux`, `ILStatement`, `Network.Connectors`/`ILLines`, `Operand.Comment`,
      `NWLImplementationObject.NetworkListComment` (non-empty), Jump/Ftrig flags, `Flags.Extensible`,
      `BoxTreeBox.ContainsExtensibleInputs`.

      **Gate step 1b-1 (2026-10-15).** Review findings, all five taken: (1) STSnippet's document was outside the census —
      the vendor difference is stated (the schema claim scoped to the 15 NWL classes), CODESYS's snippet lines re-walked
      live (own CODESYS, `ide.ps1 -Instance ld-fbd-coverage`, bakon-nano: per-line Ids, the last one = the snippet's
      own Id), and every member listed open for 1b.2; (2) the `SymbolComment` live loss — refused per network on both
      vendors before a rebuild (test-first, red then green), `Flags.Fixed`/`Operand.Boolean` recorded as the open loss
      candidate; (3) the open list now names every unexplained member the table shows; (4) `TcNetworkWriter`'s "the comment
      from the symbol" corrected; (5) `SymbolComment` distribution completed from the census's raw dumps ("" ×5303,
      sentinel 0). Gate: typecheck clean (5 packages); `Volt.Engine.Tests` 2533 pass / 1 skip, `Volt.Ide.Codesys.Tests`
      406 pass (+2), `Volt.Ide.Twincat.Tests` 504 pass (+2), `Volt.Repo.Gates` 243 pass (the `NETWORK_UNSUPPORTED`
      raise-site census +1, `NetworkText.cs`), `Volt.Cli.Tests` 295 pass; LSP full suite with `VOLT_REQUIRE_FULL=1`,
      `VOLT_FIXTURES` unset: 10616 tests, 10154 pass, 34 skip, 428 todo, 0 fail (736 s). Fixture map unchanged (no fixture or transpiler change).
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
- [ ] 3.2 **Turn LD/FBD on for PLCAssist** (owner 2026-10-14). Until this change closes, PLCAssist treats LD/FBD exactly like
      CFC/SFC/IL — always read-only, `networkText: false` in its LSP snippet check, its read-only rule in its
      plcRead tool description naming LD/FBD with CFC/SFC/IL (`docs/VOLT_UPDATE_2026-10-14.md` in the PLCAssist repo). At close,
      write the PLCAssist update note that undoes that: which bodies are now editable network text, which networks stay
      refused and with what code, the format reference (`packages/volt-cli/docs/network-text.html`) with examples, and
      the bridge release that carries it. Owner's go before the note says "turn it on".
