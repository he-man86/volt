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
- [x] 1b.2 The disposition table in design.md: every member → **spelled** (its text form), **editor cache** (with the
      measurement that it is derived and rebuilt on push), or **refused by name** (with the measurement that no push can
      build it). No member left undecided; members with 0 corpus occurrences still get a decision. New spellings follow
      the existing style (trees, one named node per split point) and are listed for the owner in the close report.
      **Done 2026-10-15** (design.md "1b.2"): a per-member table over all 64 archived (class, member) pairs of the
      shipped schema (63 + `AbstractNWLItem.Id`; checked mechanically against the 1b.1 schema dump, none missing), each
      S / S+ / D / C / R / X. Per member: S 24, D 11 (8 of them single-valued constants, 0 pragmas in the corpora),
      R 6, X 11 (`Connectors`, `ILLines`, Terminator `Input`/`Flags`, the 3 Mux and 4 ILStatement members), S+ 1
      (`SymbolComment`), and 11 split by value or position (S with S+/R/D/C/X parts: Assign `Flags`, `Flags.Flags`,
      `OutputItems`, `InputFlags`, `InputParam`, `OutputParam`, `EN`, `ENO`, `CallType`, `STSnippet`, `Operand.Type`).
      12 distinct cache-candidate rows for 2.2 (14 after gate 1b-2, below). New spellings for the owner: the `{Member := value}` pragma (only where
      a stored value differs from its derivation), `{SymbolComment := '…'}` ×10, S4's `.name`, S6's `NOT IN1 :=`. Corrected against the census dumps while writing it: `Instance.Type`
      differs from `BoxType` on 47 boxes (20 case-only, 5 other, 22 And boxes storing "AND"), not 5; `ValidIds` and the
      three `Network` IL/FBD flags are single-valued, so they are decided by constant (no row); ~~`CallType` is already a
      measured CODESYS cache~~ (wrong: one value of 19 measured; R since gate 1b-2); the cache rows go in 2.2 (not 2.3), before any spelling.
      **Gate step 1b-2 (2026-10-15).** Review findings, all four taken (design-only; no code changed, so no failing test
      applies — the 1b.3 oracle is where each becomes red/green): (1) `BoxTreeAssign.Flags` was coded S on the claim that
      the vendor writes Jump/Return on the item AND the target; the corpus's only control-flow assign (IDE-drawn `RETURN`,
      lenze-mid `ATD_FQI` net 0) has item `Flags` 0 and `Return` on the target `???` (re-run over the census dumps: item 0
      ×489), so the item bit is now R `nwl-assign-item-flags`, derivation 0, a stored bit spelled `{Flags := Jump|Return}`
      before the `;`, and 2.3 writes it only where spelled (`NetworkTextWriter`'s OR of the two places goes; the docs row
      "derived from the target bit" is corrected); (2) `Title`/`Comment` were plain S though the readers trim
      (`NetworkText.Stored`) and the text writer folds CR LF: re-counted, titles ending in whitespace 21 (`" "` 14, CR LF 6,
      `" 
"` 1), comments with CR LF inside 11 (0 bare LF, 0 lone CR), comments ending in whitespace 2 — all lenze-mid.
      Now Title is S exact (`$R$N` and trailing spaces inside the quotes; the trim goes in 2.3, as C35 did for ST),
      Comment S with its line break D (CR LF) and a `{Comment := '…'}` pragma where the lines do not give it back; `Label`
      has no such value (2 labels); (3) `CallType` was C on one measured value (`MOVE` → `Move`) of 19: now R
      `nwl-call-type` on both vendors (Function, FunctionBlock, Program, operator, EXECUTE), derivation `BoxType` +
      declarations; (4) the interim loss window (rebuild drops Fixed 1914, Boolean 2347, Address sentinel 258,
      BranchCounter) is named with its reach, made visible by a per-network `BridgeLog.Warn` at the head of 2.2
      (test-first), and its rows are recorded first. 2.2 rows 12 → 14.
      Gate: typecheck clean (5 packages); `openspec validate` valid; `Volt.Engine.Tests` 2533 pass / 1 skip,
      `Volt.Ide.Codesys.Tests` 406, `Volt.Ide.Twincat.Tests` 504, `Volt.Repo.Gates` 243, `Volt.Cli.Tests` 295 (all 0 fail,
      unchanged); LSP full suite with `VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset: 10616 tests, 10154 pass, 34 skip, 428
      todo, 0 fail (574 s). Fixture map unchanged (no fixture or transpiler change).
- [x] 1b.3 The completeness oracle (red first): for every corpus network on both vendors, NWL → text → NWL reproduces every
      non-cache member exactly (an extension of `ModelRoundTripOracleTests` over the corpora); a member the table does
      not list fails the gate by name — so a vendor adding a member in a future SP surfaces as a red test, not a silent loss.
      **Done 2026-10-15** (design.md "1b.3"). The CODESYS NWL is RECORDED, not re-walked by hand: `scripts/record-nwl-corpus.py`
      (own CODESYS, `ide.ps1 -Instance ld-fbd-coverage -RunScript`, one run over copies of the five corpus projects) wrote
      `packages/volt-cli/test/fixtures/nwl-corpus/<corpus>.nwl.xml` — the whole archive of the 44 bodies (40 / 2 / 1 / 1 / 0,
      the census's) and the API answers the reader is handed where they differ from the archive; the TwinCAT archives are
      the two corpus `.TcPOU`s, copied to `nwl-corpus/twincat-project14`. The oracle: `test/shared/NwlArchive.cs` (the
      archive model, both vendors), `test/shared/NwlCompleteness.cs` (the 1b.2 table member for member — an unlisted member
      fails by name; a C member is skipped only while its `vendor-facts` row exists; the known-divergence ledger, which
      fails an unexpected, a moved or a stale entry), `CodesysNwlCompletenessOracleTests` (hydrate the suite's doubles from
      the recording, read per network, text round trip, write the body into a FRESH aspect — a create, so nothing survives
      by object identity — and compare) and `TcNwlCompletenessOracleTests` (~~`TcNetworkReader` → text → `TcNetworkWriter.Apply`
      on the stored archive; the import rebuild is the IDE's, measured by the 2.2 rows~~ — the recorded import since gate 1b-3); `NwlCompletenessHarnessTests` shows
      each verdict failing. `CorpusProject` moved to `test/shared/CorpusProjects.cs` (output-neutral; the engine oracle uses it).
      **Numbers:** 394 networks (CODESYS 388, TwinCAT 6). CODESYS: 22 refused by the text writer (S1–S6: 7/6/6/1/1/1, the
      census exactly), 23 by the push (N21, consumed enabled comparisons), 343 compared; ~~**69 known divergences over 38
      members**~~ (49 over 31 since gate 1b-3) (the ledger in `CodesysNwlCompletenessOracleTests.Known`, each with its closing task: 2.2 for the 14 R rows +
      `text-blob-serialisation`, 2.3 for the D derivations and the spellings). ~~TwinCAT: 6 compared, 0 findings~~ (gate 1b-3: no evidence — the rebuild compares 3, 22 divergences). **Root
      cause found and fixed (test-first):** the CODESYS reader read `IOperand.SymbolComment`, which answers the archive
      sentinel on every operand (DIALECT N27, recorded) — no CODESYS pull held a symbol comment and the 1b-1 refusal could
      not fire live; it now reads `GetSerializableValue("SymbolComment")`
      (`CodesysNetworkReaderTests.A_symbol_comment_is_read_from_the_archive_where_the_vendor_property_answers_the_sentinel`,
      red before; the NWL doubles answer the property as recorded and the archive through `StoredSymbolComment`).
      **Corrected in the 1b.2 table:** `BoxType` of an FB/program call is derived from the instance's declaration (15
      differ: D + pragma); an enabled operator's `InputParam.Names` `['EN']` is D (71); **open for the owner: a call's
      UNCONNECTED output pins** (the callee's whole output list the IDE draws — 186 slot lists / 172 name lists come back
      shorter; N21: not re-derived) have no spelling — 2.3 cannot turn those entries green without one.
      **Gate step 1b-3 (2026-10-15).** Review findings, all five taken, each test-first: (1) **the TwinCAT half compared
      the archive with itself** — an unchanged push's `TcNetworkWriter.Apply` answers null, so `?? bodyXml` made every
      member it does not write match by construction ("6 compared, 0 findings" showed only that a no-op is a no-op). Now
      `An_unchanged_push_writes_nothing` says exactly that, and the oracle runs what a push BUILDS: the shipped lowering of
      each body (create) and of each network alone, renumbered to 0 (rebuild), is committed as PLCopen
      (`nwl-corpus/twincat-project14/import/*.plcopen.xml`, gated against today's lowering), the XAE's IMPORT of each is
      RECORDED (`scripts/record-tc-import.ps1`, own XAE, `ide.ps1 -Instance ld-fbd-coverage -Fixture 14`: 5 imports), and
      the shipped post-import code runs over it — `TcObjectModel.Adopted` + `BeckhoffDriver.Stamp` (create),
      `BeckhoffDriver.Spliceable` + the splice + `TcNetworkWriter.Apply` (rebuild), split out of `ResolveGraphicalBody` /
      `RebuildNetwork` output-neutrally (Repo.Gates `Allowed`, with the reason). Result: the CREATE compares no network
      (POUexecute's lowering refused — its unmeasured wire network; ladderLabel's import drops the EMPTY network, D25,
      and the stamp refuses the count), the REBUILD refuses 3 of 6 (Execute box, unmeasured wire, the empty network's
      import answering an empty body) and compares 3: **22 known divergences over 15 members** (`KnownRebuild`: Ids
      re-minted; `Type`, `LValue`, `Boolean`, `Fixed`, `EN`/`ENO`, the param types as the import answers before any
      build; TON's `OutputParam.Names` `['Q', 'ET']` → `['Out1']`), each with its 2.2 row / 2.3 task. (2) **The CODESYS
      doubles' initial values stood for a fresh vendor object unmeasured** — `scripts/record-nwl-live.py` (own CODESYS)
      made every object the writer constructs through the bridge's own `NwlInterop.New` and recorded its archive
      (`nwl-corpus/live.codesys.xml`); measured: a fresh operand archives `""` for BOTH `Address` and `SymbolComment` (the
      hypothesis that it archives the sentinel is refuted — the Address ledger 27/7/181 stands), and
      `The_doubles_start_as_a_fresh_vendor_object` holds every double to it (except the 4 members the writer always
      sets, named). The written doubles are now laid over the fresh objects, so every member the writer never sets is
      judged against the vendor's fresh value: the ledger is **49 known divergences over 31 members** (was 69 / 38) — the
      R rows read "changed" against `Id` -1, `CallType` None, `Boolean` false, `Fixed` false (no longer "not written"),
      and 20 entries are gone because the fresh value IS what every compared network stores (`Operand.Comment` "",
      `Flags.Extensible`, `ContainsExtensibleInputs`, `InputFlags` null, `Network.ILActive`/`ILValid`/`FBDValid`,
      `Flags.Fixed` on assign items, instances and box outputs, `Boolean` on instances and box outputs). (3) **A
      non-string archived `SymbolComment` was read as no comment** — now refused UNREADABLE by name
      (`CodesysNetworkReaderTests.A_symbol_comment_archived_as_anything_but_a_string_is_refused_by_name`, red first;
      WireVocabulary census +1, `CodesysNetworkReader.cs`). (4) **No live witness of the N27 reader fix** — the same live
      run loaded the SHIPPED reader from the built bridge DLL into CODESYS and read pro2193 `SetAlarm` #0: all ten stored
      comments, through `NwlInterop`'s reflection over the real `_3S.CoDeSys.NWLObject.Operand`, and the shipped
      `RefuseSymbolCommentLoss` refused that model (`The_shipped_reader_reads_the_stored_symbol_comments_live`; DIALECT
      N27). Not done: a live PULL of a symbol comment — the only corpus network holding one is S1-refused text, so its
      e2e witness follows S1 in 2.3. (5) **The TwinCAT archive copies were untied** —
      `The_archives_are_the_fixtures_and_the_corpus_is_their_pull` holds each `.TcPOU` byte for byte to the one fixture
      file of its name and the corpus file's body to the text the shipped pull writes from that archive.
      Gate: typecheck clean (5 packages); `Volt.Engine.Tests` 2533 pass / 1 skip, `Volt.Ide.Codesys.Tests` 422 pass
      (+16 since gate 1b-2: the 1b.3 oracle and harness, the reader tests), `Volt.Ide.Twincat.Tests`
      512 (+8, the oracle), `Volt.Repo.Gates` 243, `Volt.Cli.Tests` 295, `Volt.Contracts.Tests` 37, `Volt.Connector.Tests`
      148, volt-cli `test/unit` 150 (all 0 fail); LSP full suite with `VOLT_REQUIRE_FULL=1`, `VOLT_FIXTURES` unset: 10616
      tests, 10154 pass, 34 skip, 428 todo, 0 fail (679 s). Fixture map unchanged (no fixture or transpiler change).
- [x] 1b.4 **S4 and every shape no push can build: shown always, refused per NETWORK, never per body** (owner 2026-10-12,
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
      **Done 2026-10-15** (design.md "1b.4", its "As built"). (a) `Box.MainOutputName` (the readers state it where the main
      output is not slot 0, `Box.NameOfMainOutput`), written `fb(…).name` (`NetworkSpelling.NamedMainOutput`), read back by
      the C# reader and the LSP parser (`NetworkCall.output`, typed as the instance's output `fb.name`). (b)
      `Network.Unsupported`: a refusal met in a network's trees is shown as `UNSUPPORTED "<shape>";`, header and comment
      kept (`NetworkTextWriter.WritePulled`, `CodesysNetworkReader.ReadShown` / `TcNetworkReader.ReadShown`); TwinCAT's
      Execute pre-scan is deleted (parity). Push: `NetworkPairing` aligns live and pushed networks by text (least cost —
      the plain LCS swapped two identical-rung networks on `POU_PBD`), both drivers keep the paired ones untouched, rewrite
      a slot, remove, or insert (CODESYS `InsertNetwork(Int32, INetwork)`, TwinCAT the one-network import spliced in);
      TwinCAT's network-count refusal is lifted (the create's stamp stays positional). A changed network holding S4 is
      refused naming the network and the output (CODESYS N21; TwinCAT unmeasured); a pushed `UNSUPPORTED` line no live
      network pairs with is refused (`NETWORK_UNSUPPORTED`); its header is editable. (c) vendor-facts row
      `nwl-keep-network-in-place`, both vendors, DIALECT **N28**: TwinCAT keeps the kept network's 9 archive `Id`s through
      the push and the reopen; CODESYS renumbers EVERY `Id` of a body on each commit and on load (no identity — the kept
      network is its untouched content); both pulls are the pushed text, both builds clean. Neither vendor stays per-body.
      **Numbers:** the corpora's 12 UNSUPPORTED LD/FBD bodies (tasks 0.1) pull as network text, holding exactly the text
      writer's 22 refusals as `UNSUPPORTED` lines (`CodesysNwlCompletenessOracleTests.Every_body_pulls_as_network_text…`):
      S1 8 (7 + the S4 network, which also holds S1), S2 6, S3 6, S5 1, S6 1; S4 0. Push refusals unchanged (23, N21).
      Tests added: `ShownPerNetworkTests` (engine, 33 cases), `CodesysNetworkPairingTests` (6) + the oracle's body test,
      `TcNetworkPairingTests` (4), TwinCAT's deletion test rewritten (removes the unpaired network) and the Execute
      pre-scan tests replaced (2), LSP `network-analysis.test.ts` (+3) and `services/network/named-output.test.ts` (2). The LSP size ratchet held without a new entry: the rules moved to `syntax/network/shown.ts`, the header loop to `parseHeader`, the wire-producer helpers to `wire-producer.ts` (moved unchanged) — `parser.ts` 1372 → 1367 lines, `parseCall` 90 → 88, `parseNetwork` off the list. Docs:
      `network-text.html` (`.name`, the network line, the pairing, the marker row per network).
      **Gate step 1b-4 (2026-10-15).** Review findings, all five taken, each test-first (18 new cases red before the fix,
      green after; design.md "1b.4" As built (8)): (1) **a moved network lost its symbol comments unrefused** — a move is
      Remove + Insert, and neither step met the 1b-1 refusal; (2) **an `UNSUPPORTED` line replaced by trees, or emptied,
      under its header** paired as an in-place rebuild of a shown model with no trees, so nothing saw what it erased; (3)
      **two networks shown as the same text** (two identical `UNSUPPORTED` lines) were told apart by the tie-break, which
      removed the one the engineer kept. Fixed in the shared pairing: a live `UNSUPPORTED` network never pairs with other
      trees (`NetworkKey.Unshown`, a cost above removal + insertion), and `NetworkPairing.RefuseUnseenLoss` — called by
      both drivers right after the plan, before the list changes — refuses by name (`NETWORK_UNSUPPORTED`) a removal of a
      network holding what the text does not show (its line, a symbol comment) in a push that also inserts one, and its
      removal beside a staying network that shows the same text; deleting such a network alone and editing its header
      still work. The stale `TreesUnchanged`/`Unchanged` doc comments corrected (both vendors). (4) **`.Execute` after a
      call** opened an EXECUTE body in the token walk: a stored main-output name that is a text word
      (`NetworkSpelling.TextWords`) is refused by the writer, shown as `UNSUPPORTED "a named main output spelled like a
      text word"` (0 in the corpora: the only S4 boxes are Lenze's 3 `xErrorActive`; fixed, being cheap). (5) **The
      hand-edited `completeness.known.ts` reason is now RECORDED**: a live TwinCAT completeness run (own instance
      `ld-fbd-coverage`, `--only Project14/ladderLabel.pou`) produced that exact string — 1 expected, 0 unexpected, 0
      stale. IDE-held R members of a moved network stay the interim loss window 2.2 makes visible. Tests:
      `ShownPerNetworkTests` 33 → 44 (4 alignment rows with an UNSUPPORTED live network, the 3 loss refusals, 4 text-word
      names; `A_network_with_no_text_pairs_with_nothing`'s second assertion changed from Rebuild to "X0 I0" — its premise,
      an UNSUPPORTED live network rebuilt from a model with no text, is what design 1b.4 lists as "stays refused by name"),
      `CodesysNetworkPairingTests` 6 → 11, `TcNetworkPairingTests` 4 → 6; `WireVocabularyTests` census for
      `NetworkPairing.cs` 1 → 3 (`NETWORK_UNSUPPORTED`, same situation). **Numbers:** C# Engine 2577 pass (1 skip),
      CODESYS 434, TwinCAT 518, Cli 295, Connector 148, Contracts 37, Repo.Gates 243 — 0 fail; volt-cli unit 150 pass;
      LSP full suite (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset) 10159 pass, 34 skip, 428 todo, 0 fail over 363 files
      (its first run failed one: 1b.4's `services/network/named-output.test.ts` is named after no source file — listed
      in `test/package/structure.test.ts`'s `TOPIC_SUITES` as a network-text topic suite, beside its siblings); typecheck
      clean. No fixture or transpiler change: the fixture map
      is not regenerated.
## 2. Build (after 1.2)

- [x] 2.1 The network-text code split by concern, OUTPUT-NEUTRAL (design "Code split"): `parser.ts` into statement,
      value/group, call/pin and the pair-kind decision; the lexer's `next` per token class; `network-analysis.ts` per check
      family; `network.test.ts` per service. The shrink-only entries and the dead-export allowlist emptied. The full LSP
      suite, the fixture map and the network e2e identical before/after.
      **Done (2026-10-15).** `syntax/network/parser.ts` 1367 → 357 lines, one class chain, one concern per file:
      `cursor.ts` 253 (tokens, positions, findings, ST fragments) → `values.ts` 299 (operands, groups, NOT, edges) →
      `calls.ts` 261 (call/pin, PARALLEL, EXECUTE; `parseCall` 88 → 60 lines, the box-type decision its own method) →
      `statements.ts` 121 → `parser.ts` (body, network, header, wires); `pair-kind.ts` 117 (the pair scan and `Walk`
      out of the lexer, plus empty-slot / pin-name / storage decisions); `words.ts` 52; the producer walk into
      `wire-producer.ts` 145. `lexer.ts` 414 → 344, `next` 95 → 22 lines (comment, backticked, address, wordLike,
      symbol). `checks/network/network-analysis.ts` 521 → 70 (the pass) over `_labels.ts` 53, `_boxes.ts` 222,
      `_operands.ts` 93, `_assignments.ts` 105, each with its `_<family>.test.ts` (rule A6). The 76 tests of
      `services/network/network.test.ts` moved byte-identical by subject: `network-services.test.ts` 12,
      `network-symbols.test.ts` 1, the check families 33, `network-analysis.test.ts` +12, `types/network/
      network-analyze.test.ts` 1, `network-implementation-line.test.ts` +3, and `types/network/network-reader.test.ts`
      14 — a topic suite (the reader whole) that takes the old file's `TOPIC_SUITES` entry, since `network-parse.test.ts`
      (473) has no room and a front-end test reaches neither analysis nor `test/support`; shared helpers in
      `test/support/network-docs.ts`. `CEILINGS` 4 → 0, `FUNCTION_CEILINGS` 2 → 0, `DEAD_EXPORT_ALLOWLIST` 4 → 0
      (`TokKind` inlined; `CONSTRUCT_WORDS`/`v1Refusal` imported from `words.ts`; `resolveAnywhere` unexported).
      Before/after: test/frontend + test/conformance 6991 pass, 385 todo, 0 fail over 7376 tests both times; the network
      targeted set 225 = 225 tests; test/analysis census 13 pass; `rate:fixtures` leaves `map.generated.ts` unchanged;
      typecheck and `bun run lint` (layering, size, dead exports, citations) clean. No C# change, so the bridge e2e is
      untouched; the full suite is the gate's.
      **Gate 2-1 (2026-10-15):** typecheck and `bun run lint` clean (0 ceilings, 0 dead-export allowlist); `rate:fixtures`
      leaves `map.generated.ts` unchanged (edge agree 3399, disagree 0, not-run 227); LSP full suite (VOLT_REQUIRE_FULL=1,
      VOLT_FIXTURES unset) 10159 pass, 34 skip, 428 todo, 0 fail over 370 files (10621 tests) — identical to gate 1b-4's
      10159/34/428 over 363 files, the +7 files being the split's test files. No C# change, so the C# suites stand at 1b-4.
- [x] 2.2 The probe-table rows, recorded on both vendors BEFORE the shapes they decide: `nwl-bitop-stored-slot` (decides
      S1's outcome), `nwl-leaf-wire-type` (decides S3a, owner amendment a), `nwl-nested-assign`, `nwl-rail-fed-wire`,
      `nwl-input-pin-flag`, `nwl-super-call`; and the 1b.2 cache-candidate rows (design.md "1b.2", code R):
      `nwl-item-id`, `nwl-branch-counter`, `nwl-flags-fixed`, `nwl-operand-boolean`, `nwl-operand-type`,
      `nwl-instance-type`, `nwl-param-types`, `nwl-box-en-eno`, `nwl-input-flags-list`, `nwl-output-param-names`,
      `nwl-address-sentinel`, `nwl-stsnippet-line-ids`, `nwl-call-type`, `nwl-assign-item-flags` (added by gate 1b-2);
      DIALECT N-rows updated. **First, test-first (gate 1b-2, design "The interim loss window, made visible"):** both
      drivers' rebuild paths log one `BridgeLog.Warn` per rebuilt network naming each R candidate it resets and its count
      of stored non-default values; then the loss-candidate rows FIRST (`nwl-flags-fixed`, `nwl-operand-boolean`,
      `nwl-address-sentinel`, `nwl-branch-counter`, `nwl-item-id`), each leaving the warning as it lands.
      **Done 2026-10-15** (design.md "2.2"; DIALECT N29–N36). **The warning first, test-first:** `RebuildLoss` (engine, the
      one rule) + `CodesysNetworkWriter.WriteNetwork` (a changed network, before its items go) and `TcNetworkWriter.Apply`
      (an import rebuild, before the element is replaced) — red then green: `RebuildLossTests` (3), `CodesysRebuildLossTests`
      (2), `TcRebuildLossTests` (2); `Id` left it when its row landed (C), `Fixed`/`Boolean`/the `Address` sentinel stay
      until 2.3 spells them; the NWL doubles gained `Fixed`, `Boolean`, `Id` and the archived `Address`. **The rows:** 20
      `vendor-facts` rows, each run live on BOTH vendors (own instance `ld-fbd-coverage`, CODESYS SP21 Patch 4 on
      CodesysTestProject / a Pro2193 copy, TcXaeShell 15.0 on Project14), loss candidates first in the table, through one
      new read `nwl` (the body flattened from the vendor's own archive, one notation on both vendors; runner `nwlView`,
      self-check `test/unit/vendor-facts.test.ts` +4). Snapshots: +20 facts per vendor, every committed fact unchanged.
      **Numbers:** of the 14 R rows, 2 become C (`nwl-item-id`, `nwl-stsnippet-line-ids`: IDE allocators), 11 stay R → the
      pragma in 2.3 (not re-derived by a build or a reopen on either vendor), 1 cannot be asked of today's writer
      (`nwl-assign-item-flags`: CODESYS's push writes the item bit itself; re-run in 2.3). Shape rows: S1 build-equal
      (drawn stored form and pushed plain form both clean), execution unmeasured → **back to the owner** (design 1.1);
      S3a no type stored on a pushed leaf, the IDE-drawn leaf holds its declared type → 1.1's rule stands; S3b `g := ;`
      builds the vendor's terminator-fed wire on both vendors, clean; S2/S5/S6 refused by today's reader on both vendors,
      no committed IDE witness → measured by 2.3's per-shape fixtures (rows re-run then). Completeness ledgers: CODESYS
      49 → 36 known divergences (13 `Id` / `api.Lines` entries gone with C), TwinCAT rebuild 22 → 14 (8 `Id`). **Found,
      not closed:** TwinCAT's build of the pushed calls program fails (PLC_PRG: `VltF_RC` not defined) where CODESYS builds
      it clean — candidate: the program call imported as `CallType Function`; 2.3's call-type spelling. **Not done:** the
      `text-blob-serialisation` row the CODESYS ledger cites (bridge-one-to-one's, not in this task's list). Tests: Engine
      2580 pass / 1 skip, CODESYS 436, TwinCAT 520, Repo.Gates 243, Cli 295, volt-cli unit 154 — 0 fail. No LSP or
      fixture change (the fixture map is not regenerated).
      **Gate 2-2 (2026-10-15): the seven review findings, each fixed test-first or pinned.**
      (1) **The item `Id` (high).** C stands for its VALUE (an IDE allocator), not its uniqueness: a TwinCAT rebuild
      spliced the one-network import (scratch POU ids 2..N) unrenumbered, repeating Ids of the kept networks. Red first:
      the TwinCAT completeness oracle's new `Every_body_a_push_writes_holds_each_id_once` (with the old
      `ReplaceWith` splice: POUexecute's rebuilt networks 1 and 3 each held 10 and 11 twice, ladderLabel's 5). Fix:
      `TcNetworkWriter.Splice` (rebuild) and the insertion mint the spliced network's Ids above the body's, value for
      value; the oracle splices through it; `TcRebuildLossTests.A_rebuilt_network_is_spliced_with_ids_no_other_network_holds`.
      The `IdText` invariant ("unique among a body's NWL items, 0 duplicates in 46 bodies") is back, DIALECT N29 and design
      say so. Whether XAE tolerates a duplicate stays unmeasured — it no longer gets one.
      (2) **`RebuildLoss` (medium).** It judged "non-default" by one vendor-neutral test; it now diffs what the live network
      held against what the rebuild BUILT, per member AND owner (an operand's flag set is not an item's), value by value.
      Both drivers read the network before and after (CODESYS after the items are rebuilt, TwinCAT after the import and
      the stamp). Tests: engine `RebuildLossTests` 3 → 5 (a value given back is no loss, one changed is; another owner's
      value does not stand in); `TcRebuildLossTests` 2 → 4 against the import's recorded answer (operand `Fixed` true,
      item `Fixed` false): the operand `Fixed`s it gives back are not named, a stored `false` it turns `true` is;
      `CodesysRebuildLossTests` 2 → 3 (a negated contact's `Fixed`, which the vendor sets with the negation — now the
      double's `Flags.Negation` does too, vendor-facts `nwl-flags-fixed` — is not named).
      (3) **TwinCAT's failed calls build (medium).** A failed build is no evidence: the five members read off `VltF_RC`
      (`Instance.Type`, `ParamList.Types`, `EN`/`ENO`, `OutputParam.Names`, `CallType`) are "not filled by a build" on
      CODESYS's measurement alone and stay R on it; the cause is unmeasured (the `Function` call type a candidate, no
      longer stated as the cause) — design "2.2", DIALECT N30. Pinned as a known divergence (below).
      (4) **S3a/S3b silent drops (medium).** Pinned, not refused: a refusal would also stop the very rows that measure
      them (`nwl-leaf-wire-type`, `nwl-rail-fed-wire`), and 2.3 spells them next. `test/unit/vendor-facts.test.ts` "the
      known divergences the 2.2 rows recorded" — four checks over the committed snapshots, each stating the divergence as
      recorded and failing once a re-record closes it: TwinCAT does not build the calls program CODESYS builds clean; a
      leaf-fed wire accepted on CODESYS pulls back UNSUPPORTED ×3; `g1 := ;` accepted on both pulls back UNSUPPORTED;
      `g1 := TRUE;` round-trips on CODESYS and is refused on TwinCAT. DIALECT N30, N32, N33 name them.
      (5) **TwinCAT `nwl` read without a save (low).** `NwlRead` now runs `File.SaveAll` first (as `ArchiveRead`), so
      @built and @rebuilt observe the IDE after each build. Re-recorded live (own instance `ld-fbd-coverage`, TcXaeShell
      15.0 / Project14), all 20 `nwl-*` rows: **0 differences** — every TwinCAT value was already the post-build one, so
      the 2.2 claims stand, now measured.
      (6) **German CODESYS facts (low).** This machine's Windows UI language (nl-NL) is one CODESYS does not ship, so it
      wrote German (DIALECT V9). `ide.ps1 -CodesysCulture <name>` passes CODESYS's own `--culture` switch (opt-in; no
      default changed for other runs), and the vendor-facts runner starts CODESYS with `-CodesysCulture en-US` (the
      snapshot's language; `ide-identity.ui-culture` en-US, as committed). Re-recorded live (SP21 Patch 4,
      CodesysTestProject copy) `nwl-nested-assign`, `nwl-input-pin-flag`, `ide-identity`: 4 facts back to English, every
      other value as committed; 0 German strings left in `vendor-facts.codesys.json`.
      (7) **The `text-blob-serialisation` ledger owner (low).** The CODESYS completeness ledger entry now names 2.3
      (carried, not in 2.2's row list); 2.3 lists it below.
      **Numbers:** Engine 2582 pass / 1 skip (+2), CODESYS 437 (+1), TwinCAT 523 (+3), Repo.Gates 243, Cli 295,
      volt-cli unit 158 (+4) — 0 fail; typecheck clean, lint clean (warnings only, none new in a touched file's new code).
      LSP full suite (VOLT_REQUIRE_FULL=1, VOLT_FIXTURES unset): 10159 pass, 34 skip, 428 todo, 0 fail over 370 files (10621 tests) — identical to gate 2-1. No LSP, fixture or transpiler change: the
      fixture map is not regenerated. The CODESYS completeness ledger's counts did not move with the negation double.
- [x] 2.3 **Closed 2026-10-16 by the owner — the rest moves to 2R (no member pragmas in the text).** Per shape AND per member the 1b.2 table spells, in the design's order (S1 per its probe, S2, S3, S6, S5, then the 1b.2 members), test-first: a recorded fixture on both
      vendors (pull → push → pull fixed point + build), writer, reader, gate, LSP parser and checks — each landing in the
      split structure of 2.1.
      **And delete the inference a spelled member replaces** (owner 2026-10-12, "also simplifies the code"): writer and
      reader map member ↔ text one to one; guesses such as the wire type from its uses (`EveryUseIsBoolean`), "slot 0 is
      the main output" and "a stored slot is inert" go wherever the member is now spelled. The count of such rules before
      and after is recorded under this task.
      **Carried from 2.2 (gate 2-2):** the `text-blob-serialisation` vendor-facts row the CODESYS completeness ledger
      cites; the four known divergences in `test/unit/vendor-facts.test.ts` ("the known divergences the 2.2 rows
      recorded" — the TwinCAT calls build, the S3a leaf-fed and S3b terminator-fed silent drops, the `g1 := TRUE;` wire
      divergence), each mark removed in the step whose re-record closes it; and the five calls-subject rows re-run on
      TwinCAT once its build of the subject succeeds (until then their TwinCAT half is unmeasured).
      **Gate 2-3 (2026-10-16) — the shapes S1, S2, S3a, S3b, S6, S5 and the first member (`OutputParam.Names`/`Types`)
      landed; the other 1b.2 members did not (design "2.3", as built), so 2.3 stays open.** The pragma
      (`NetworkPragma.cs`, `NetworkMembers.cs`; LSP `syntax/network/pragma.ts`) is written after a box only where the
      stored value differs from the derivation. Writer, reader, gate (`NetworkTextFacts.Carried`, `NetworkModelEquality`
      compare `Box.Members`), both drivers, the LSP parser/checks (`nested_assign`, `NOT name :=`, `SUPER^` through
      EXTENDS, `producerType` from the leaf / LD rail / pragma) and `docs/network-text.html` (section "Members — the pragma").
      **Recorded on both vendors** (own instance `ld-fbd-coverage`): vendor-facts all 21 `nwl-*` rows re-run (CODESYS
      SP21 Patch 4 en-US, TwinCAT TcXaeShell 15.0 / Project14); e2e `test/e2e/graphical/census-shapes.test.ts` (6 shapes:
      round-trip + build on CODESYS; TwinCAT round-trips S1 and S3b and refuses S2, S3a, S5, S6 by name, `TcUnmeasured`);
      LSP conformance fixtures `ng_s1_stored_slot`, `ng_s2_nested_assign`, `ng_s3a_leaf_wire`, `ng_s3b_rail_wire`,
      `ng_s5_super_call`, `ng_s6_negated_pin` (`network-graphical-b.ts`): CODESYS 6 build clean, TwinCAT 2 build clean and
      4 `vendorRefuses`; the LSP raises nothing on any (parse/analysis baselines: counts only).
      **Carried from 2.2:** the TwinCAT calls build CLOSED (`VltF_RC` builds and pulls on both; the five calls rows
      re-ran on TwinCAT); S3a CLOSED on CODESYS; S3b CLOSED on both; `g1 := TRUE;` stands (TwinCAT refuses a leaf-fed wire,
      N22) — `test/unit/vendor-facts.test.ts` now asserts the closed three as facts. `text-blob-serialisation` row: not run.
      DIALECT N31–N36 carry the re-runs; N37 is new (a drawn function's result pin `'   '` cannot be built by Volt;
      `InsertOutputItem(i, null)` measured).
      **Inference rule families: 8 → 4.** Deleted: `EveryUseIsBoolean` (wire type from its uses; C# and LSP),
      `WithoutStoredTypes`, the S1 stored-slot refusal, and the bit operator's "no stored slot" connected-slot default
      (now `Box.BitOperatorSlot` from the stored names). Remaining, with their members: the title/comment trims
      (`NetworkText.Stored`, CODESYS `Clean`, TwinCAT `Trimmed`), the comment CR LF fold, the item-bit OR (C13),
      `NetworkText.RefuseSymbolCommentLoss`. (The unstored main output of a Volt-built non-bit box stays N21's measured
      read, not a guess.)
      **Completeness oracle, CODESYS:** text refusals 22 → 0 (S1 8, S2 6, S3 6, S5 1, S6 1); push refusals N21 comparison
      23 → 26, S4 named output 2; the `OutputParam` Names/Types entries closed; OutputItems divergences 160/227 + 60/111 →
      1/1 + 83/108 (N37 function result, 10 PROGRAM-call boxes); new N37 entries (75 networks / 98 nodes); Known 39
      entries. TwinCAT: 2 stale `OutputParam` entries removed. Round-trip oracle 40/40, refused: a pin flag 1, "a negated
      unnamed pin of a call" 1 (niche: accepted loss, 1 occurrence in the corpora), a consumed box 1.
      **Gate 2-3 review (2026-10-16), five findings, each test-first:** (1) TwinCAT's in-place write erased a box-fed
      wire's stored output type (no pragma: the declared type is the derivation; `WriteOutputParam` derived without it) —
      the Demux arm now hands its producer `NetworkText.WithDeclaredType`, as CODESYS does
      (`TcDemuxTests.An_in_place_push_keeps_the_stored_type_of_a_box_fed_wire`). (2) S3a with a declaration unlike the
      leaf's variable — RECORDED, no code change: CODESYS types the wire's uses by the VARIABLE (`ng_s3a_leaf_wire_mistyped`
      `g1 : INT := a(BOOL)` into an INT use: "Cannot convert type 'BOOL' to type 'INT'"; `…_mistyped_bool_use` into a
      BOOL use: builds clean), which is the LSP's producer rule — both agree; `docs/network-text.html` says so. The
      related one-happy-path gap: `ng_s1_stored_type_mistyped` (a Types pragma `['INT']` on an AND consumed by a BOOL —
      clean on both vendors, LSP agrees), `ng_s2_nested_set_reset` (S=, R= and a chained pair nested — clean, agrees),
      `ng_s6_negated_int_pin` (a negated INT pin of ADD — CODESYS warns twice of a sign change through UINT; the LSP is
      silent: `deferred.lsp` "niche: accepted loss (0 occurrences in the corpora)", ceiling exception
      `NEGATED_INT_PIN`); TwinCAT refuses the S2/S3a/S6 ones before its import (`TWINCAT_REFUSES`). (3) TwinCAT's
      in-place write applied `NetworkMembers.Buildable` (a CONSTRUCTION limit) and replaced a spelled `'   '` with the
      derivation — it writes `Effective` now (`TcDemuxTests.An_in_place_push_keeps_a_spelled_function_result_name`), and
      its `Held` names `OutputParam.Names` `'   '` like CODESYS's. (4) The enabled PROGRAM call's second null output slot
      is a `RebuildLoss` candidate (`OutputItemList.OutputItems`, "<slots> slots for <names> names", row
      `nwl-output-param-names`) on both drivers (`CodesysRebuildLossTests.A_rebuilt_enabled_program_call_names_the_output_slot_it_drops`).
      (5) `$hh` in a pragma string is exactly two hex digits in C# too (`'$A '` refused, as the LSP refuses it; cases in
      both `NetworkPragmaTests` and `network-pragma.test.ts`).
      **Gate 2-3 numbers:** C# Engine 2624 + 1 skipped, CODESYS 438, TwinCAT 526, Cli 295, Connector 148, Contracts 37,
      Repo.Gates 243 — all green; volt-cli unit 158; LSP full suite (VOLT_REQUIRE_FULL=1, 10632 tests, 626 s) 10169 pass, 34 skip, 1 fail — `structure.test.ts`: `network-pragma.test.ts` named after no file beside it, now a listed topic suite (re-run green); typecheck, lint, `bun run check` green; recordings:
      CODESYS +5 fixtures (recorder testCount 5595 → 5606, the ten 2.3 ones), TwinCAT +1 (5572 → 5575); fixture map unaskable 95 → 106 (the
      ten `ng_s*` rows now in the map); analysis census CODESYS TP 5843 → 5844, GAP 518 → 520 (2 excepted).
      **Remaining in 2.3:** the members `Fixed`, `Boolean`, `Address`, `BranchCounter`, box-operand `Operand.Type`,
      `Instance.Type`, input `ParamList.Types` / `InputFlags`, `EN`/`ENO`, `CallType` (then TwinCAT's program-call
      import), exact titles/comments, the item Jump/Return bit (`nwl-assign-item-flags` re-run), `SymbolComment`; TwinCAT
      import measurement for S2/S3a/S5/S6; the `text-blob-serialisation` row; `RebuildLoss` empty.
## 2R. Readability rewrite (owner 2026-10-16)

Owner: "i think the V1 was much more readable then what we have now", "remove all and implement in the new way".
The rules are `readability.md` — ONE rule: a box is always its NAME (`a ADD b`, `a GT 40`, `MOVE b => a`), `:=`/`S=`/`R=`
are coils only (`a := b` is the assignment without a box), `EN` is the enable input, `ENO` the enable output of the line above (`;` ends the NWL item) (B1–B8 +
the small ones). The model, the drivers and the push pairing stay; the TEXT layer (writer, reader, gate, LSP
parser/checks, docs, goldens) is rewritten to it, and every V2 spelling the rules replace is DELETED, not kept beside the
new one (`+ - * / > <` …, `MOVE(…, => x)`, `EN :=` on a box, `.ENO`, the member pragma).

- [x] 2R.1 The checks C1–C5 of `readability.md`, live on own instances (`ide.ps1 -Instance ld-fbd-readability`, both
      vendors where the fact exists on both) and on the six corpora. Each answer recorded in design.md with its evidence.
      A check that contradicts a rule, and either of the two "Open" items: write it and the alternatives into design.md
      and STOP for the owner.
      **Stopped 2026-10-16 for the owner:** design.md "2R.1" — C1 (CODESYS: no refill, N38), C2, C3 (CODESYS builds
      refuse every 3-input SUB/DIV/MOD/comparison; 0 in the corpora), C4 (90 % of networks), C5 answered; five Open items
      with a default each. Owed: TwinCAT's C1/C3 runs (an orphaned worker of this instance blocks `ide.ps1 up`).
      **Gate 2R.1 (2026-10-16) — the three review findings, fixed:** (1) the nine `ng_r1_<op>_three_inputs` carry
      `deferred.lsp` (2R.3's B1 guard), so lsp-replay holds them as expected failures that go stale the day the LSP
      agrees; their nine census GAPs are ceiling exceptions (`baseline-c.ts` `THREE_INPUT_OPERATORS`), census baseline
      re-measured (CODESYS GAP 520 → 529, fixtures measured 5603 → 5612). (2) N38/C1 narrowed to what was measured
      AND the row widened and re-run live (CODESYS SP21, own instance `ld-fbd-coverage`, 27.7 s): an LD body of ten
      networks (negated contact, PARALLEL, enabled MOVE, enabled function's ENO) and an FBD body of four (operator
      tree, negated pin, enabled function, enabled MOVE), the `editor` step now checking the view's `Editor` holds that
      object; 493 members identical at all seven points, both builds clean. Stated as NOT measured: an edit, a DRAWN
      network's `Fixed`/`Boolean`/`Address`/`BranchCounter`, execution; the LD body's `BranchCounter` read 0 with a
      Parallel (N29's read 1) — unexplained, recorded. (3) Open item 5's default (a) no longer reads as safe: only a
      clean BUILD is recorded; 2R.4 owes a run comparison of a rebuilt network against its drawn original per member.
      **Numbers:** C# Engine 2624 + 1 skipped, CODESYS 438, TwinCAT 526, Cli 295 (one `BridgePackagingTests` case
      failed under the parallel LSP run and passed alone — openspec `packaging-test-sweep-access-denied`), Connector
      148, Contracts 37, Repo.Gates 243; volt-cli unit 158; typecheck, lint, `bun run check` (18) green; fixture map
      unaskable 106 → 115 (the nine `ng_r1_*`); LSP full suite (VOLT_REQUIRE_FULL=1, 10632 tests, 533 s) 10170 pass, 34 skip, 0 fail (a first run under the parallel C# suites timed out two `ir-walk.test.ts` cases at 7.8 s / 8.5 s against 5 s — 4.7 s alone; re-run with nothing beside it, green).
- [x] 2R.2 **Owner 2026-10-16 ("build it"), after 2R.1:** build `readability.md` AS IT IS NOW (B1–B8 with the
      `BRANCH` lines + `feed INTO BRANCHES [SHORTCIRCUIT]` parallel, B4 `ENO` + one `;` per item, B6 `split<VarId>`
      without `VAR_TEMP`, P1–P16). The partial 2R.2 section already in design.md was written against an older
      readability.md (`ENABLE`/`THEN`/`FEED`): rewrite it, do not build on it. 2R.1 Open items: 1 → bare `EN`; 2 → (a)
      `a ADD b => x;`; 3 → P10 call form `AND(a, NOT IN2 := b)`; 4 → `EXECUTE EN c`; 5 → **(a) lost on rebuild, NOT
      refused**, with 2R.4's behaviour measurement per member deciding — a member whose loss changes behaviour makes
      its network refused on rebuild. design.md section "Readability": the final grammar from `readability.md` + 2R.1, and the member disposition
      re-done under B7: every NWL member is an editor cache (dropped), derived by the bridge on push from the declaration
      (as the editor does), or its network is `UNSUPPORTED` — never a pragma. Corpus reach per rule (C5).
      **Done 2026-10-16:** design.md "2R.2 Readability" — the grammar is readability.md whole (B1–B8, P1–P16), the five
      Open items as decided, every member S/D/C/L/E/X (none a pragma), corpus reach per rule; 2R.1's C2 spellings
      marked superseded (B2 `MOVE b => a`). Re-checked against the archives: 74 non-AND/OR operator boxes, 102 MOVEs,
      139 split definitions (573 Demux nodes). No code, no tests, no fixtures (a design step).
      **Gate 2R.2 (2026-10-16) — the five review findings, fixed** (doc findings: no failing test applies — each was
      re-counted from `packages/volt-cli/test/fixtures/nwl-corpus` by a scratch census, not by the 2.3 writer):
      (1) readability.md B7 and "Open" now state Open item 5 as decided (lost on rebuild, not refused), with the
      counts. (2) B6 across all corpora: 140 split definitions in 100 networks (lenze-mid 139 / 99 + TwinCAT
      `POUexecute` VarId 1: 1 definition, 2 references; 576 Demux nodes); C5's "TwinCAT adds only EXECUTE and an empty
      pin" corrected (also a split, 2 stored-slot And/Or, 2 TON calls); C2's "0 of 573 wires" → 0 of 140 split names
      collide (no test-corpus declaration matches `split<digits>`). (3) The L counts: `'   '` result name 105 of 113
      Function boxes in 82 networks (82 was networks; "97 of 97" withdrawn); the stored And/Or slot 17 boxes in 8
      networks (15 CODESYS / 7, 2 TwinCAT / 1; "11" withdrawn). (4) "413 derivations" withdrawn — D covers every call
      box, 281 (157 FB, 113 Function, 11 Program; CODESYS 279 in 206 networks); the 249 + 288 / 195 pragma figures are
      marked as the 2.3 writer's text count. B4 58 / 29 re-derived (31 EN chains, 7 other inputs, 16 coils, 3 split
      feeders, 1 parallel feed); C2's 86 / 28 double-counted (the 57 consumed ENOs hold the chains and coils). (5) C2
      re-checked bullet by bullet under B2: `MOVE b => a` has one reading; all 102 MOVEs are one-input (P16's MOVE call
      form 0 in the corpora; 2R.3 owes refusing it where the word form fits); the named-ENO-pin vs coil-on-ENO pair is
      two stored trees and two texts (0 in the corpora), P16's measurement stays in 2R.3; ENABLE — C2's count is what
      networks wire (1 BLINK formal), readability's is declarations, re-counted 30 distinct FBs / 80 declarations.
      **Numbers:** typecheck, lint, `bun run check` (18), `openspec validate` green; LSP full suite (VOLT_REQUIRE_FULL=1,
      10632 tests, 544 s, nothing beside it) 10170 pass, 34 skip, 0 fail; C# Engine 2624 + 1 skipped, CODESYS 438,
      TwinCAT 526, Cli 295, Connector 148, Contracts 37, Repo.Gates 243; volt-cli unit 158. Fixture map unchanged (no
      fixture or transpiler change).
      **2R.2 amended 2026-10-16 (owner, "yes put it in"):** readability.md simplified (S1–S4, S6, S8, S11 of the
      review; parallel = `feed BRANCH (a, b)`), design.md "2R.2" updated to match. The P-numbers in this entry are the
      old P1–P16: now P10 → P5, P14 → P12, P15 → P13, P16 → P5 (MOVE call form, named ENO pin) / the corpus line.
- [x] 2R.3 **Owner note 2026-10-16:** readability.md was simplified 2026-10-16 after 2R.3 started; the uncommitted
      partial rewrite in the working tree was written against BRANCH lines and the old bracket/ENO rules — adapt it to
      the current readability.md, don't build on the old rules.
      The rewrite, test-first, both vendors (pull → push → pull fixed point + build): B1 operator words with their
      guards, B2 `MOVE b => a`, B3 `EN`, B4 `ENO` takes the oldest open line above (P3; an enabled box is its line's root), one `;` per NWL item (`.ENO` and `THEN` deleted), B4b jumps as coils (`IF … THEN JMP` deleted), B5 brackets on exactly three things (P4), P5 word or call, B6 `split<VarId>` with no `VAR_TEMP` and no type, B7 the pragma DELETED — a member is written only where it differs from the derivation, in a natural spelling
      (`NetworkPragma.cs`, `NetworkMembers.cs` text half, LSP `syntax/network/pragma.ts`, the "Members — the pragma" doc
      section) with its members derived in the drivers, B8 `[feed] BRANCH (a, b, …) [SHORTCIRCUIT]` (P6), the small ones, and every "Precise rules" P1–P13 item. The LSP
      refuses while typing what a push would refuse. `docs/network-text.html` rewritten to the result; the corpora
      re-pulled and their before/after line counts recorded.
      **Done 2026-10-16 (uncommitted, for the gate).** The shared case set `volt-cli/test/fixtures/network-text`: 109
      accept + 126 refuse cases (every readability.md example, P1–P13, every P12 old spelling naming its new one), read
      by the bridge's `NetworkTextCaseTests` and the LSP's `network-cases.test.ts`, green on both. Writer, reader and gate
      (C#) and the LSP parser rewritten to them; `NetworkPragma.cs`, the text half of `NetworkMembers.cs`, the LSP's
      `pragma.ts`/`wire-producer.ts`/`pair-kind.ts`/`shown.ts` deleted. **Corpus, offline then live:** all 46 LD/FBD
      bodies / 394 networks of the six corpora round-trip archive → text → model (`ModelRoundTripOracleTests`, 0
      refused, `SUPER^` now a scope key); re-pulled live (CODESYS SP21, TwinCAT Project14) — **before:** 157 networks
      spelled, 12 bodies hidden under the marker, 1085 non-blank NETWORK…END_NETWORK lines (lenze-mid 740, bakon-nano
      243, pro2193 41, awa-palletizer 39, twincat-project14 22; the 1945 above was 2R.1's count of all 394 networks in the
      2.3 writer's text); **after:** 394 networks, 0 bodies hidden, **2083** lines (lenze-mid 1736, bakon-nano 243,
      pro2193 44, awa-palletizer 39, twincat-project14 21) — the rise is the 237 networks the old pull hid, plus one line
      per open ENO line and per branch; only the LD/FBD files were taken from the re-pull (design "2R.3", as built).
      **Live, both vendors:** the 60 graphical conformance fixtures pushed and built in one batch per vendor (English UIs)
      — 50 CODESYS / 34 TwinCAT rows re-recorded, the rest refused by name; the graphical e2e tier pull → push → pull
      green: CODESYS 135 tests, TwinCAT 143 tests run file by file (the whole tier in one process gutted the TwinCAT
      project copy's folders mid-run — a cross-file harness interaction, not a format failure; every file passes on its
      own); P5's two ENO trees measured (design). Found and fixed: a TwinCAT comment's CR LF lost in the archive's XML
      (`TcCommentLineEndTests`). **Numbers:** C# Engine 2931 + 1 skipped, CODESYS 439, TwinCAT 529, Cli 295, Repo.Gates
      243, Contracts 37, Connector 148; volt-cli unit 158; LSP src, test/frontend, test/conformance, test/analysis,
      test/corpus green (final counts in the gate's run); `rate:fixtures` rewritten (`map.generated.ts`). Not built: P13's
      code lens and P9's renumber quick fix (design "2R.3", as built); the vendor-facts table now pushes 2R.3 text, its
      recordings are not re-run.
      **Owner 2026-10-16 (docs):** `docs/network-text.html` explains ONLY the current implementation — no history, no
      "VAR_TEMP / IF … THEN / PARALLEL(…) are gone", no list of retired words; a refused spelling appears only as the
      error a push gives today.
      And it must be much SMALLER than today's (owner: "if we did a good job the doc should be much smaller") — code
      examples over prose, one example per rule, the P-rules as a compact reference.
      No edge cases in the language (owner): a rule the doc can only state with an exception or a special case is a
      grammar defect — list each one for the owner in the step's report instead of documenting it.
      Examples are small made-up networks (`a`, `b`, `start`, `lamp`), never taken from the corpora (owner).
      **Review fixes 2026-10-16 (uncommitted, for the gate).** (1) `RebuildLoss` names every member 2R.2 files L: a box's
      whole stored `OutputParam`/`InputParam` Names and Types (a TON's unwired ET, a bit operator's `['']`, a function's
      `'   '`), its `BoxType` spelling, `Instance.Type`, `Operand.Type`, `EN`/`ENO`, `CallType`, `InputFlags` — both
      drivers collect them (`RebuildLossTests`, `CodesysRebuildLossTests`, `TcRebuildLossTests`; on TwinCAT the stamp's
      derivation over the import's `['']` is now named). (2) `TcArchive.Text` writes through an XmlWriter that entitizes
      new lines: a bare LF stays LF (it became CR LF in every multi-line value of the body), a real CR stays `&#xD;`
      (`TcCommentLineEndTests`). (3) `??? :=` read off a box's ENO gives "The assignment target is not specified." —
      the re-recorded answer on both `_target_of_*` fixtures (re-recorded again, same answer); the coil over a call's own
      value stays unmeasured and silent; their `MEASURED_SILENT` marks went. (4) The TwinCAT graphical tier ran WHOLE in
      one process on Project14 (VOLT_VENDOR=twincat): 134 pass, 1 skip, 0 fail, and a FileSystemWatcher on the copy saw
      no deletion during it — the earlier gutting is not reproduced by Volt; a copy found gutted at 21:28:20, before any
      test ran and before the worker attached, points outside the run (unexplained, not the product). (5) vendor-facts
      re-run for every nwl row on both vendors (`--write --only`): CODESYS 52 differences (the 2R.3 texts; N32's split
      leaf `Type ""`, DIALECT N32 re-run note); TwinCAT 57 — and a NEW TwinCAT FINDING, left red in
      `vendor-facts.test.ts` ("CLOSED 2.3: the pushed calls program builds clean"): `VltF_RC` (NWL_R_CALLS) is created,
      fetches back as pushed, yet the build says "Identifier 'VltF_RC' not defined" (C2i-like); its enabled program
      call stores `OutputParam.Names ['Out1']` where it stored `['ENO']`, and pushed bit operators/functions keep the
      import's `['']`/`['Out1']` (no stamp on a create). `nwl-editor-refill` was never run on TwinCAT and aborts there
      (both creates refused, then `editor re` has no handle — a probe bug), so it was left out. (6) The LSP case-set
      test compares each accept case's model SHAPE (derived members dropped), so an ENO pairing change fails it.
      (7) A split beside a declaration of its name is written and accepted (P1 makes the variable `` `split1` ``):
      writer and LSP refusal deleted; `rcc_network_wire_named_like_variable` re-recorded, `[]` on both vendors.
      **Gate 2R.3 (2026-10-16) — the four review findings, test first.** (1) TwinCAT's CREATE stamp wrote no member:
      the by-position arm of `TcNetworkWriter.Apply` ran outside `Stamping`, AND (found live) the change gate skipped
      every network the text cannot tell from the import (the import's `[Out1]` is no text, B7), so the stamp wrote
      nothing on a plain call. Both fixed: the by-position loop runs under `Stamping`, and `WriteNetwork`'s change gate
      does not apply while stamping (`TcStructuralEditTests` `The_create_stamp_writes_the_derived_output_names_over_the_imports`,
      `…_on_a_network_the_text_cannot_tell_apart`, red first). Live, TwinCAT Project14 (`-Instance ld-fbd-coverage`):
      the five calls rows (`nwl-instance-type`, `nwl-param-types`, `nwl-box-en-eno`, `nwl-output-param-names`,
      `nwl-call-type`) re-run `--write`, 18 differences: `VltF_RC` builds clean again ("Identifier not defined" gone),
      the enabled program call stores `['ENO']`/`['BOOL']`, a function/FB call no name, AND none; `vendor-facts.test.ts`
      "CLOSED 2.3" green. (2) The CR LF halves: whether the XAE hands a CR as `&#xD;` or raw stays UNMEASURED, so
      neither is assumed — an archive whose VALUES carry a raw CR (told apart by a normalizing vs non-normalizing parse;
      formatting white space between elements is not a value) is refused by name on write (`TcRawLineEndRefusal`,
      never swallowed by the create's catch); an entitized one is written back as it came (`TcCommentLineEndTests`, 3
      new). The measurement that lifts it: the archive string the bridge receives for a two-line comment
      (`comments.test.ts` on TwinCAT pushes over one — if the XAE hands raw CRs, that test turns red with this refusal).
      (3) `ide.ps1`: (a) a pid record without a start time names nothing (skipped, said aloud) — the start time now
      comes from the `Start-Process` object, which answers after the process exits (measured: equal to CIM's to the
      microsecond); the e2e harness reads records by the same rule (`parseRecords`, `fixture-ide.test.ts`); repro
      verified: a bare record of a running XAE's dead parent no longer claims it (`down -DryRun`). (b) An instance is
      exclusive: `up`/`down` hold a named mutex (`Local\volt-ide-<vendor>[-<instance>]`, a second caller refused by
      name — verified), and `up` refuses an instance whose IDE is still running instead of replacing it (`down` ends
      an instance). (4) LSP `??? := ENO` reports only on the recorded heads (an operator, a PROGRAM, a FUNCTION); an
      FB instance's or an EXECUTE box's ENO is unrecorded and says nothing (`_boxes.test.ts`, red first).
      Also fixed for green (all in this step's uncommitted work): `values.ts` (909 lines, `finalize` 83) split into
      `boxes.ts` / `targets.ts` / `values.ts` (309 / 240 / 367; `finalize` under 80) and its four dead exports and
      `LineRead` un-exported; `network-cases.test.ts` imports through `syntax/index.js` (layering); a comment's "(B6)"
      read as a DIALECT citation (`bun run check`); DIALECT N39's `[PROBE: tc-languagemodel]` marker dropped — its probe
      was single-use and deleted, so no table row exists (Repo.Gates, red at HEAD from twincat-inproc-host).
      **Numbers:** C# Engine 2935 + 1 skipped, CODESYS 446, TwinCAT 547, Cli 297, Repo.Gates 243, Contracts 42,
      Connector 146; volt-cli unit 154; LSP full (VOLT_REQUIRE_FULL=1) 10366 pass, 34 skip, 428 todo, 0 fail (10828 tests, 372 files); volt-vscode 39; `bun run check` 16/16;
      `rate:fixtures` — map unchanged.
- [x] 2R.4 The members 2.3 left open (`Fixed`, `Boolean`, `Address`, `BranchCounter`, `Operand.Type`, `Instance.Type`,
      `ParamList.Types`/`InputFlags`, `EN`/`ENO`, `CallType`, exact titles/comments, the item Jump/Return bit,
      `SymbolComment`) under B7: cache, derived, or network `UNSUPPORTED` — measured per member, no pragma.
      **Done 2026-10-17 (uncommitted, for the gate).** Measured per member by running the drawn value against Volt's in
      CODESYS simulation (SP21 3.5.21.40; native-archive edits, two input sets each; design "2R.4", DIALECT N40): **cache**
      (runs the same) — `Fixed`, `Boolean`, the `Address` sentinel (FBD and LD coils), `BranchCounter` (328 vs 0),
      `Operand.Type`, `Instance.Type` (`TON`/`ton`/`TOF`), `ParamList.Types`, a zero-only `InputFlags`, a stored
      `EN`/`ENO` false on a box with no enable, the item Jump/Return bit (JMP and RETURN), trailing title/comment white
      space (S exact since 2R.3), an FB's, PROGRAM's and conversion's `CallType`, `SymbolComment` (sweep #24; its E
      refusal stays for 2R.5, which owns its spelling); **derived** (load-bearing: the box does not compile without it) — a
      FUNCTION's `CallType` and input names, a METHOD's `CallType`, a FUNCTION's whole output list (`'   '` or `ENO`, then
      every VAR_OUTPUT — N37's "cannot be built" was a box without the CallType), `EN`/`ENO` true from the enable. No
      member's loss changes behaviour, so no network is refused on rebuild for one. Built: `NetworkScope.Callee`,
      `NetworkDerivation` (input names derived once in the push's gate — both vendors; CallType and output list in the
      CODESYS writer, TwinCAT's import resolves both), `StDeclaration.IsFunction`/`InputNames`/`OutputNames`; the LSP's
      `checkBoxArity` (a function box given too many positional values, as the ST check); `network-missing-en` and its
      message deleted (its last recorded case now builds clean). New fixtures `ng_m_*` (9, `network-graphical-d.ts`),
      recorded on both vendors with all 69 graphical fixtures in one batch each (CODESYS en, TwinCAT Project13 LCID
      1033): CODESYS 8 clean + `ng_m_function_too_many` (the arity error); moved to a clean build: `ng_box_output_arrow`,
      `rcc_network_eno_function_without_en`; TwinCAT 7 clean, `ng_m_function_enabled` refused (output pin, as
      `ng_box_output_arrow`), `ng_m_function_too_many` adds "Identifier '' not defined" (niche: accepted loss, 0 in the
      corpora — ceiling exceptions `EXTRA_POSITIONAL_PIN_TC`). A positional FUNCTION call now pulls back named
      (`f(a)` → `f(i := a)`, the gate's canonical form); two e2e texts (`callee-seed-lag`, `refused-shapes`) push the
      named form. **For the owner:** (1) the one header read the kind gate now allows (`StDeclaration.IsFunction`, the
      CALLEE's header — a box's CallType, never an item's kind); (2) positional FUNCTION pins are accepted and normalized
      to named on pull (default) — the alternative is refusing them as P5 refuses a call form the word fits.
      **Numbers:** C# Engine 2959 + 1 skipped, CODESYS 453, TwinCAT 547, Cli 297, Repo.Gates 243, Contracts 42,
      Connector 146; volt-cli unit 154; graphical e2e CODESYS 135/135 (TwinCAT: the two changed files, 12/12); LSP
      test/conformance 6964 pass / 385 todo / 0 fail, test/frontend 25/25 (baselines rewritten: counts only), src 2993/2993,
      test/analysis census 13/13 (TP 5846 → 5845, GAP 515 → 514, unowned 83 → 82), test/baseline green; typecheck,
      lint (warnings only), `bun run check` 16/16; `rate:fixtures` — unaskable 109 → 118 (the nine `ng_m_*`); recorder
      testCount CODESYS 5616 → 5625.
      **Gate 2R.4 (2026-10-17) — the seven review findings, test first** (recorded on own instances,
      `ide.ps1 -Instance ld-fbd-coverage`: CODESYS SP21 `en`, TwinCAT Project13 LCID 1033; 13 new `ng_m_*` fixtures, one
      batch per vendor). (1) **The CLI's post-push check** took `F(n)` held as `F(a := n)` for another program, so the
      next pull brought the names in as an IDE change: `PushedText.SameBody` now lends the held box's names to the pushed
      box's positional pins (`NetworkDerivation.NamedAs` — the same type at the same place, every pin named; a pin the text
      named keeps its name) — `PushedTextTests` 7 rows, and live `graphical/positional-call-cli.test.ts` (`volt push` of a
      positional call: the workspace holds `F(a := n)`, `status` empty, `pull` "already up to date"; both vendors). The two
      e2e texts push the POSITIONAL form again and state what pulls back (`pulls`). (2) `StDeclaration.InputNames` read
      `VAR_IN_OUT CONSTANT` (any qualifier) into the first statement and dropped its variable: a qualifier now opens the
      block (6 rows); `ng_m_function_constant_in_out` and `ng_m_function_in_out_first` (VAR_IN_OUT before VAR_INPUT) build
      clean on both — the declaration's order across both kinds is CODESYS's positional order. (3) **A library function's
      box** (`ng_m_library_function{,_named,_qualified}`, `…_eno`, `…_qualified_eno`): CODESYS answers the pushed box "The
      assignment source is incorrect." with its input named or not (TwinCAT: clean named, "'' is no input of 'LEN'"
      positional), and read through ENO "'ENO' is no component of 'LEN'" + the coil's conversion (TwinCAT refuses that
      push, `TcEnoRefusal` — `vendorRefuses`). The LSP gives the ENO pair again (`enoOfALibraryFunction`, in place of the
      deleted `enoOfAFunction`); it does NOT give the assignment-source error: the box the editor DRAWS builds, and
      firing on bakon-nano's REPLACE/DELETE boxes was 2 corpus false positives. It is the push's defect, not the text's —
      **2R.4b**. (4) `CalleeOf` gives `CallType Method` to a METHOD through an INTERFACE variable (`ng_m_interface_method`
      clean on both; before the gate it was built without one); an instance ACTION with `CallType Method` is now measured
      (`ng_m_action_call`, clean on both). The FB's own METHOD without an instance (`ng_m_own_method`): CODESYS "The
      assignment source is incorrect.", TwinCAT clean — deriving it needs the POU's members, which no scope holds: niche,
      accepted loss (0 own-method boxes in the six corpora). (5) Fixtures for the derivation's edges: too FEW values and a
      positional value then a named pin of the same formal answer "Function 'F' requires exactly 'n' inputs" on both;
      a METHOD called positionally, CODESYS "Function 'M_twice' requires exactly '1' inputs", TwinCAT "'' is no input of
      'M_TWICE'" + "Identifier '' not defined" (the push names no method's pins — niche, 0 in the corpora). The LSP's
      `checkCallBoxes` replaces `checkBoxArity`: a project function's pins against its inputs once named (too few counts
      inputs with no default), and a method's positional pin (`methodBoxPositionalPins`, each vendor's wording).
      (6) **For the owner — not decided here:** the kind gate's third header read (`StDeclaration.IsFunction`, the
      callee's header) stays as the implementer wrote it, marked OPEN in `NoKindFromTextTests`; the alternative is the IDE
      object's own POU type, which no driver reports yet. (7) The BOM is gone from `StDeclaration.cs`; DIALECT N37 no longer
      names a pragma; N40 carries the gate's measurements; `removed-push-checks.ts` no longer describes the deleted check.
      Ceiling exceptions `UNNAMED_CALL_BOXES` (`baseline-c.ts`); no ceiling raised. **Side finding (for the owner, not
      Volt's):** a variable named `s` in any POU's VAR — ST too — does not build on CODESYS SP21 ("Unexpected token 's'
      found", single-use probe, deleted); the library fixtures use `txt`.
      **Numbers:** C# Engine 2974 + 1 skipped, CODESYS 453, TwinCAT 547, Cli 297, Repo.Gates 243, Contracts 42, Connector
      146; volt-cli unit 154; graphical e2e CODESYS 136/136 (the new CLI test included), TwinCAT the three changed files
      13/13; LSP full suite (`VOLT_REQUIRE_FULL=1`, no `VOLT_FIXTURES`) 10368 pass / 34 skip / 428 todo / 0 fail; src 2994/2994, test/frontend 25/25 (baselines rewritten:
      counts only), test/analysis census 13/13 (CODESYS TP 5845 → 5852, GAP 514 → 518, all four excepted; TwinCAT TP
      7032 → 7035, GAP 880 → 886, all six excepted); typecheck, lint (warnings only), `bun run check` 16/16;
      `rate:fixtures` — unaskable 118 → 131; recorder testCount CODESYS 5625 → 5638, TwinCAT 5594.
- [ ] 2R.4b **A LIBRARY function's box is built without its CallType** (2R.4 gate, finding 3). Measured (SP21,
      `ng_m_library_function{,_named,_qualified}`): CODESYS answers the box a push builds "The assignment source is
      incorrect." — positional or named — where the editor's drawn box (CallType Function) builds; so an EDITED network
      holding one does not build. 3 boxes in the corpora (bakon-nano `Recipes`: REPLACE ×2, DELETE). The push holds no
      declaration of a library's function to derive the CallType (and positional names) from: owed is the driver's read
      of it (the IDE's library signature) — measure first. TwinCAT builds the named box (its import resolves it). Until
      then the LSP cannot say it (the drawn box builds) and the census carries the three as ceiling exceptions.
- [x] 2R.5 **Owner 2026-10-16: "if it is possible then we should be able to encode and decode it."** Zero in the corpora
      is NOT a reason to refuse. Every shape the IDE can STORE (draw, or hold after an import) gets a spelling, a
      fixture on both vendors and a round trip — whether it compiles or not. Applies to every X / refused-by-name row
      in design.md's member disposition: a box consuming two ENOs, a one-branch parallel (C0023), a 3-input
      SUB/DIV/MOD/comparison (C3), `BoxTreeMux`, a non-default `Terminator`, `Connectors`, `ILStatement`/`ILLines`,
      and the E rows (`SymbolComment`, S4 `fb(…).name`, an enabled comparison value). Per row: first make it live in
      the editor (or by import) on both vendors; a row the IDE cannot store stays refused, with that measurement as
      its reason. Only old spellings (P12) stay refused by design.
      **"Possible" = the IDE stores it and it RUNS** (owner, same day, after running it in simulation: "it is an
      editor issue — the logic behind it works"). How well the editor draws it does not decide. Measured 2026-10-16,
      CODESYS 3.5.21 (EnoDemo, scratchpad move-demo): an AND fed by two MOVE ENOs pushes, round-trips, builds (0
      errors) and runs correctly in simulation; the editor draws it broken (the second ENO and a third AND input
      dangle) → "a box consuming two ENO outputs" GETS a spelling: readability.md P3 (2026-10-16) —
      `MOVE 1 => A EN c` / `MOVE 2 => B EN d` / `x := ENO AND ENO;`, each `ENO` takes the oldest open line above it,
      top to bottom, left to right within a line (a chain reads as before; one tree, one order). Owed: its fixture on
      both vendors and the round trip. Each other row: push it, build it, run it in simulation on both vendors; spell
      what stores and runs. Side finding to check in 2R.3: that body was pushed as `IMPLEMENTATION FBD`, the editor
      showed it as LD, and after the owner opened/ran it a pull returned `IMPLEMENTATION LD`.
      **Measured list: `awkward-sweep.md`** (36 cases, CODESYS 3.5.21, 2026-10-16): 20 shapes to spell (re-spell each under
      the current readability.md — the sweep's proposals predate the simplification), 5 refusals justified (C0023/C0022,
      a Terminator with an Input crashes CODESYS), 3 losses shown inert, 4 unmeasured + all of TwinCAT. Folds into
      earlier steps: CallType + input formal names are D for project FUNCTION and METHOD boxes too (today's push builds
      them non-compiling — #18, #27; 2R.3/2R.4); P3's "a comparison has no ENO" is false (#22); the E rows #25/#26 are
      writer limits (build as the PLCopen importer does); the edge-coil network hides its whole body (#14, pull bug).
      Not NWL: SP21's new Ladder editor (`LadderDataModel`, #32) — every PLCopen LD import lands there and Volt pulls
      `IMPLEMENTATION LADDER UNSUPPORTED`. **Owner 2026-10-16: it is LD2 (the export says `<!--ObjectVersion: LD2-->`);
      not in this change, not implemented yet; its body line should end up `IMPLEMENTATION LD2`.
      **Done 2026-10-17 (uncommitted, for the gate)** — design "2R.5", as built. Every row the sweep measured S B R, and
      the empty branch (readability Open c, measured here by a native-archive edit: it stores, builds and runs as a
      shorted branch), is spelled by an existing rule with its refusal clause removed — in the bridge's writer, reader
      and gate and the LSP parser alike (the shared case set: `accept/r5-stored-shapes.cases`, 23 cases; refuse cases
      moved or narrowed): a jump or a return is a coil beside other coils, with S=/R=, modified, nested (#9–#12); a
      coil's `NOT`/`R_EDGE`/`F_EDGE` before it (#13, #14 — the pull that hid #14's body went with the refusal); an edge
      on a pin before its formal (#15); `NOT EN c` (#16, a new model field `Box.EnableFlags`); `x := NOT ;` (#6a); an
      element of an array of FBs as a call head, `` `fbs[1]`(…) `` (#17 — backticked like every operand that is no token;
      `StDeclaration.TypeOfArrayElement`, the LSP's `instanceFb` on an index head); a split referenced above its
      definition and one nested, `(split1 := …)` (#19, #20); a comparison read through its ENO (#22); the named ENO pin
      read by both drivers (#23, the reader refusal `RefuseWiredEno` deleted); an enabled comparison read as a value
      built as the editor draws it, EN true / ENO false (#26, the N21 push refusal deleted); `(a, , b)`. Drivers: CODESYS
      writes each target's own bits (a coil beside a jump was a second jump), the EN slot's and every pin's flags read
      back bit by bit, the ENO pin's variable on the ENO slot; TwinCAT's in-place writer writes each target's bits
      (`WriteTargetBits`, red first: `TcDrawnJumpTests`), its reader reads the named ENO, and `TcUnmeasured` refuses every
      new shape before the PLCopen import by name. **Refused, with measurement:** an operator box with fewer than two
      inputs (`ng_r5_one_input_*`, recorded through the push first: "'+' needs at least '2' operands" on both vendors) —
      `ADD(a)` left P5. **Measured per row, CODESYS SP21:** the 19 `ng_r5_*` fixtures pushed and built in one batch (all
      clean; `ng_r5_array_instance` warns the WORD → INT sign change of `CV => i`), round-tripped exactly
      (`test/e2e/graphical/stored-shapes.test.ts`, 8 tests), and run in simulation as Volt pushed them (a headless
      CODESYS serving the bridge, a fresh login per case, 24 cases): every row runs as its stored tree says — DIALECT N41,
      with the IDE's own semantics the drawing hides (an edge coil runs as a plain coil, `S=` on a jump latches nothing,
      `NOT ;` writes TRUE, the named ENO's variable is never written, a taken nested jump skips its coil, an empty branch is
      shorted). **TwinCAT (Project13, LCID 1033):** 18 of 19 refused by Volt's driver before the import (`TWINCAT_REFUSES`,
      the refusal's words), `ng_r5_enabled_comparison_value` clean and round-tripped; no TwinCAT measurement of the
      stored shapes exists on the PLCopen route — that is the native archive writer's (twincat-inproc-host, on branch
      `twincat-native-writer`, not on dev).
      **Not done, for the owner:** (1) **SymbolComment stays E** — the design's D (the callee pin's declaration comment)
      needs a measured door to write `SymbolComment` on a built operand, and its refusal is pinned by the live recording
      `nwl-corpus/live.codesys.xml` (re-recorded by `scripts/record-nwl-corpus.py`); 10 occurrences (pro2193 `SetAlarm`),
      measured a cache (2R.4). (2) **S4 (#25) stays refused on rebuild**: building `fb(…).name` needs the named output's
      slot index, which is the callee's signature — a project FB's declaration would give it, a library FB's (the
      sweep's CTU) is 2R.4b's open read; 3 corpus boxes. (3) **The LSP warnings design 2R.5 names** (#19 a split read
      above its definition, #23 a named ENO pin never written) are not built: each is an LSP-only message the build does
      not give — a census FP by the parity rule. (4) **Unmeasured, still refused by name:** `BoxTreeMux` and
      `ILStatement`/`ILLines` (not makeable by an archive edit; the editor's IL option is owed), `Connectors` (the PLCopen
      import drops them). (5) **A wire divergence** in the design's sense (one vendor stores, the other refuses) exists
      for every row — but the refusal is Volt's PLCopen route, not the XAE; it closes with the native writer, so not
      stopped on. (6) **Found, not 2R.5's:** on TwinCAT (Project13 and 14) the XAE hands a two-line network comment's
      archive with a raw CR on an edit, so `TcRawLineEndRefusal` refuses `rebuild.test.ts`'s metadata edit — the
      measurement 2R.3's gate named as owed. **Edge cases the doc needed** (owner rule: grammar defects, listed not
      documented): the lone `JMP l;` keeps its own rail form while a jump beside a coil writes `x := JMP l := ;` (P7's one
      spelling for the lone one); `NOT x S=` is no text (the reset coil's own two bits); a comparison is the one enabled
      value (P4 (2), a vendor fact: #21 vs #26).
      **Numbers:** C# Engine 3001 + 1 skipped, CODESYS 454, TwinCAT 548, Cli 297, Repo.Gates 243, Contracts 42, Connector
      146; volt-cli unit 154; case set 258 per side (C# and LSP); LSP src 3019, test/frontend 25/25 (baselines: counts),
      test/analysis 13/13 (CODESYS GAP 518 → 519, excepted: `OUTPUT_PIN_SIGN_CHANGE`; measured 5619 → 5638), test/conformance
      6964 pass / 385 todo / 0 fail; graphical e2e CODESYS 144/144, TwinCAT Project14 142 pass / 1 skip / 1 fail (item 6);
      typecheck, lint (warnings only), `bun run check` 16/16; `rate:fixtures` unaskable 131 → 152 (the 21 `ng_r5_*`);
      recorder testCount CODESYS 5638 → 5659, TwinCAT 5594 → 5597.
      **Gate 2R.5 (2026-10-17) — the nine review findings, test first.** (1) TwinCAT's in-place write dropped the S= of a
      lone `RETURN S= ;` and reported success: `WriteTargetBits` now writes a lone return's bits too, and (3) writes no bit
      change whose result is a coil shape no TwinCAT edit measured (`TcUnmeasured.InPlace`, the import's
      `UnmeasuredCoil` list: S=, NOT or an edge beside a jump, a set return) nor a negated empty slot — refused, the
      network goes to the import, which refuses it by name (`TcDrawnJumpTests`, 5 rows). (2) The named ENO pin: the
      in-place write now writes and refuses deleting the ENO slot (`Dropping_the_named_ENO_pin_…`, `Retargeting_…`); the
      text writer reads `ENO => v` as a fact that decides the box's ENO (`NetworkSpelling.EnoCarried`), so a box with an
      ENO and neither EN nor an ENO reader goes to the marker ("an ENO output the text reads otherwise") instead of
      pulling text its own gate refuses. (4) The unmeasured composites are refused by name, `NETWORK_UNSUPPORTED`, in the
      reader, the writer and the LSP alike (`refuse/r5-unmeasured.cases`, 13 cases; `r5-edge-set-coil` moved there): NOT,
      R_EDGE, F_EDGE or R= on a jump or return; an edge beside a coil's NOT/S=/R=; an edge with NOT on one pin; an edge on
      EN; a negated empty slot outside a coil's value. 0 of each in the six corpora (counted: the LD/FBD bodies hold 4
      plain RETURNs and 1 edge, `EN R_EDGE(output)`). (5) A split read inside its own definition: refused the same way.
      (6) A split defined inside its own definition is NETWORK_DUPLICATE_NAME on both sides (defined before its value is
      read). (7) `StDeclaration.TypeOfArrayElement` takes one index per dimension (`m[0]` of a 2-D array is a row, not
      an FB). (8) The doc lost the special cases (`NOT x S=`, the enabled comparison value, the lone-JMP rail); the
      grammar's `coil` rule now states S=/R= take no modifier. (9) `ng_r5_array_instance` wires `CV => w : WORD` and
      measures #17 alone — re-recorded on both (CODESYS SP21 en: clean; TwinCAT Project13 LCID 1033: the same import
      refusal); the ceiling exception `OUTPUT_PIN_SIGN_CHANGE` is deleted, GAP 519 → 518.
      **For the owner:** each new refusal in (4)/(5) is a measurement owed, not a design — a store/build/run per row lifts
      it; a box that holds an ENO with no EN (only `EnoSlot.derived.TcPOU`, no vendor-drawn one is known) has no spelling.
      **Gate 2R.5, second review (2026-10-17) — six findings, test first.** (1) The LSP's `instanceFb` counts indices: an
      element head needs one per dimension, as `StDeclaration.TypeOfArrayElement` reads it — `m[0]` of a 2-D array and
      `fbs[1, 2]` of a 1-D one are "an FB instance the declarations do not name" (`network-analyze.test.ts`, red first;
      the shared case scope `instance fbs[] T` stays dimension-blind on both sides, each side's unit test pins it). (2)
      The unmeasured compositions in the same class are refused by name in the reader, the writer and the LSP alike
      (`NetworkSpelling.UnmeasuredModifiedFanOut`, `UNMEASURED_MODIFIED_FAN_OUT`): a negated or edge coil beside another
      coil (`y := NOT xn := c;`, `NOT x := y R= c;`, `R_EDGE x := y S= c;`, `R_EDGE x := JMP Done := c;`) — the accept
      case `r5-modified-coil-in-a-fan-out` moved to `refuse/r5-unmeasured.cases` — and a negated empty slot outside ONE
      plain coil's value (`x S= NOT ;`, `x := y := NOT ;`); 6 refuse cases, writer rows in `NetworkTextWriterTests`. 0 of
      each in the six corpora (counted over the 46 LD/FBD files: no modified coil head, no `NOT ;`). TwinCAT's two
      `TcDrawnJumpTests` rows that edited into `NOT`/`R_EDGE` beside the drawn jump now meet the shared reader's refusal
      first — their premise (the text spells it) is gone, so they are one theory asserting that refusal; the S= rows stay.
      Wire census: NETWORK_UNSUPPORTED in NetworkTextReader 25 → 26. (3) `docs/network-text.html` carries no
      customer-corpus name (0 of Mach1/Lenze/Trayfiller/MainDrive/MIDS): the lead network, the splits example, the coil
      chain and both ladder-oracle rungs are generic networks of the same shapes (each checked through the LSP reader:
      no diagnostic); the stray blank lines are gone. (4) The grammar now produces `coil := ;` and `x := NOT ;`
      (`value = [ level ]`; `assign = coil , { coil } , ( value | "NOT" )`). (5) The UnmeasuredFlow text names `RETURN S=`
      beside `JMP l S=` (C# and words.ts). (6) `isFbCallHead`'s JSDoc line is whole again. Also: `values.ts` was 411
      lines (size gate) — the split bookkeeping (`splitRef`, `definingValue`, `parseNestedSplit`) moved beside `splitId`
      in `targets.ts`; the dead export `CoilHead` unexported.
      **For the owner (grammar edge cases, not documented):** `NOT ;` is a value only for ONE plain coil (the grammar's
      `"NOT"` alternative is wider than what is measured); a `NOT`/`R_EDGE`/`F_EDGE` coil stands alone on its item. Each
      lifts with a store/build/run of the row.
      **Numbers:** C# Engine 3019 + 1 skipped, CODESYS 454, TwinCAT 556, Cli 297, Repo.Gates 243, Contracts 42, Connector
      146; volt-cli unit 154; case set 276 LSP tests; LSP full suite (`VOLT_REQUIRE_FULL=1`, no VOLT_FIXTURES) 10409 pass /
      34 skip / 428 todo / 1 fail, re-run green: the one failure was `test/package/structure.test.ts` reading a CRLF checkout
      of `docs/architecture.md` — green on LF, no content change; graphical e2e CODESYS 144/144, TwinCAT Project14
      142 pass / 1 skip / 1 fail (item 6, the raw CR, unchanged); typecheck clean, lint warnings only (LSP lint green),
      `bun run check` 16/16. No fixture or transpiler change this round: `rate:fixtures` re-run, map unchanged; no recording.

- [ ] 2R.6 **Owner 2026-10-17: the call form is unreadable ("i cant read this"); ENO first.** A box's ENO output wired
      to a variable is an output pin written after the enable, in drawing order, never inside call brackets:
      `MOVE 0 EN c ENO => lamp;` (MOVE's own output unwired), `MOVE 0 => x EN c ENO => lamp;` (both wired) — owner:
      "this reads much cleaner". It replaces `MOVE(0, ENO => lamp) EN c;`, which becomes a refusal naming the new
      spelling. Reader, writer, LSP parser and the case set together; the coil-on-ENO form (`… EN c` / `lamp := ENO;`)
      stays a separate stored tree. Starts after the native-writer merge (it is translating tests to today's grammar).
      **Owner 2026-10-17, same step: an enabled box always writes BOTH pins it has, wired or not** — `EN [source]` then
      `ENO [=> target]`: `MOVE 0 => x EN c ENO;` (ENO unwired), `MOVE 0 => x EN c ENO => lamp;`. No `ENO` written = the
      box has no ENO pin (so the enabled comparison used as a value needs no rule of its own). Reading an ENO below
      stays the open line and the word `ENO`, so a chain reads `MOVE 2 => b EN ENO ENO` (in from above, own pin). A
      separate word for the incoming wire (e.g. `above`) was offered and is NOT decided — owner: "not sure about adding
      a new keyword yet". Measure first: a box with ENO and no EN (a call that hands its ENO on), and EN with no ENO,
      both get the same rule (write the pin that exists).
      **SUPERSEDED the same day by readability.md "2R.6 proposal v2" (the text in CODESYS's order, root first; owner:
      "staying closer to CS would make our logic a better fit"). v2 goes to the owner for review before any code; what
      follows is kept as the record.**
      **Owner 2026-10-17: "think we should refactor like this" — v2 is the direction.** Order: (1) the read-only review
      of the whole language under v2 (running) folded into readability.md v2; (2) the live measurements v2 lists, both
      vendors; (3) after the native-writer merge lands: writer, reader, LSP parser, case set and network-text.html
      together, the open-line machinery deleted, not kept beside; (4) full gates + graphical e2e on both vendors. The
      flow must stay identical (owner): text order = stored order, a round trip never changes evaluation order.
      **FINAL (owner 2026-10-17, supersedes the "always write both pins" paragraph above and the `EN ENO ENO` form):**
      no bare own-`ENO` on a box's line. The word `ENO` means ONE thing, the ENO of the open line above (today's P3,
      unchanged); a line without `;` hands its ENO on; `=> x` AFTER the EN part is the box's own ENO driving the coil x
      (data outputs are always written before `EN`, so no ambiguity, no new word). A chain:
      `MOVE 1 => a EN start` / `MOVE 2 => b EN ENO` / `MOVE 3 => c EN ENO => lamp;`. Owner: "that looks pretty nice".
      What it gives up: an unused ENO pin is not shown. The details below that this keeps:
      **Decided (owner 2026-10-17): `ENO => lamp` is the COIL on the box's ENO** — "write eno on every block and
      directly set the var to it": `MOVE 2 => b EN ENO ENO => lamp;` replaces `… EN ENO ENO` / `lamp := ENO;`. The other
      stored tree, the ENO PIN wired to a variable (awkward-sweep #23), is REFUSED by name: measured SP21 it stores and
      builds but never writes the variable (AwNamedEno, c = TRUE: x = 7, lamp = FALSE), so it fails "stores AND runs".
      This supersedes the `MOVE 0 EN c ENO => lamp` = pin reading at the top of this task. Live check of the step: push
      `MOVE 1 => a EN start ENO` / `MOVE 2 => b EN ENO ENO => lamp;` on CODESYS and TwinCAT, build, run, lamp follows
      start; pull gives the same text.
      Next, same principle, owner to confirm per row: the other call-form shapes (an unconnected word-box input
      `MUL(, a, 6)`, a negated box pin `AND(a, NOT IN2 := b)`, an empty MOVE `MOVE(IN := , => x)`, the NOT box
      `NOT(IN := a)`) — count each in the corpora, propose an in-place mark in the word form, no call form left.


## 3. Verify and close

- [ ] 3.1 Re-pull the six corpora: no LD/FBD body UNSUPPORTED (S4 shown per 1b.4; an unbuildable network refused only when edited); e2e on both
      vendors; full LSP suite cold; archive.
- [ ] 3.2 **Turn LD/FBD on for PLCAssist** (owner 2026-10-14). Until this change closes, PLCAssist treats LD/FBD exactly like
      CFC/SFC/IL — always read-only, `networkText: false` in its LSP snippet check, its read-only rule in its
      plcRead tool description naming LD/FBD with CFC/SFC/IL (`docs/VOLT_UPDATE_2026-10-14.md` in the PLCAssist repo). At close,
      write the PLCAssist update note that undoes that: which bodies are now editable network text, which networks stay
      refused and with what code, the format reference (`packages/volt-cli/docs/network-text.html`) with examples, and
      the bridge release that carries it. Owner's go before the note says "turn it on".
