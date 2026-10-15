## 1.1 Design — a spelling per census shape

**Target.** The 12 UNSUPPORTED bodies of tasks 0.1 pull as network text on both vendors, except S4, which stays refused
by name. Every addition is a text that is refused or unwritten today, so no existing text changes meaning.

| # | nets | spelling / rule | rejected (one line each) |
|---|---|---|---|
| S1 bit operator, stored slot | 7 | **If the probe shows the stored slot carries no meaning** (`nwl-bitop-stored-slot`: the stored form and the plain form build and run the same, and a pushed plain box builds): both READERS drop a bit operator's stored slot and output list at read, in the same place on both vendors (precedent: `WithoutStoredTypes`, N23's editor caches), and it is written as today's `(a AND b)` / `NOT(a)`. If the probe finds a difference, it **stays refused by name** and goes back to the owner | call form `AND(a,b)` meaning "has a slot": `NOT(a)` is already the NOT box with no slot, and call and group are one model (reader L639) · a new slot suffix: the output's name is `""`, so ST has nothing to write after the dot |
| S2 assign below top level | 6 | ExST assignment as an expression, in its own pair: `MOVE(EN := (Mach1_AuxData.ADS_StopOnZeroPulse := (w188 AND …)), 750, => Cor_numerator);` and the same with `S=` / `R=`. Grammar: `core += "(" , lvalue , op , { lvalue , op } , value , ")"`. A pair holding `:=`/`S=`/`R=` at its own depth is the third pair kind. Today it is "neither", so it is refused | a wire at the split: adds a Demux the vendor does not store (v2: names only at vendor Demux) · IF form: v1, retired |
| S3a leaf-fed wire, untyped | 2 | The wire takes the leaf's **declared** type, which the text carries by name and the scope resolves from the same declarations on both sides (`NetworkScope` gains variable types: own, owner's, GVLs). A leaf with no plain declaration (array element, member path of an untyped holder) stays refused by name | (i) the callee's pin type: `TON`/`R_TRIG` are library FBs, and Volt.Engine has no library signatures · (ii) `InputParam.Types`: Volt's own push writes it empty, so it is an IDE cache (as N23) and cannot be read back from text |
| S3b rail-fed wire | 4 | Already spelled: `g2 := ;` (a lone wire target fed by the empty Terminator, as `coil := ;`). Only the type rule is new: in **LD** a Terminator-fed wire is BOOL (the left rail). In FBD it stays refused by name | `g2 := TRUE;`: TRUE pulls as a Leaf, a different node |
| S6 pin flag | 1 | On the formal, which forces the named form: `L_FirstErrCaptureErrorAccess(NOT xEnable := xStructError)`. An operator box's unnamed pin is written with its default formal (`AND(NOT IN1 := a, b)`). Negation only (census 1.13: 6 of 6 pins). An edge on a pin stays refused by name | `f(xEnable := NOT x)`: that puts the flag on the value, a different node (the docs table already distinguishes the two) |
| S5 `SUPER^` call | 1 | `` `SUPER^`(…) ``. The scope maps `SUPER^` to the POU's `EXTENDS` type (the declaration is already in scope) | marker kept: the fix is cheap, so the triage rule says fix it |
| S4 main output ≠ slot 0 | 1 | **Stays refused by name:** "niche: accepted loss (1 occurrence in the corpora)". `MainOutputIndex` is read-only on a constructed `BoxTreeBox` (N21), so no push can build it. To name the slot (`.xErrorActive`), the reader would also need the library FB's output order | — |

**Also stays refused by name** (0 in the corpora, as tasks 0.1 measured): an edge on a pin, rising and falling together,
a terminator-fed FBD wire, a flag on a Parallel or Demux, and every other writer refusal the per-tree scan never hit.

**Build order (by corpus count).** S1, then S2, S3, S6, S5. The S1 probe runs first because its answer decides between
the two outcomes in the table. Each shape is built test-first (2.1): a fixture on both vendors, then writer, reader,
gate, LSP parser and checks.

**Code split (2.2).** In the LSP: `parser.ts` (1372 lines) splits into statement, value/group, call/pin and the
pair-kind decision. The lexer's `next` splits per token class. `network-analysis.ts` splits per check family, and
`network.test.ts` per service. These lists are then emptied: the shrink-only entries, and the dead exports `TokKind`,
`CONSTRUCT_WORDS`, `v1Refusal` and `resolveAnywhere`. In C#, the S2/S6 parsing goes into `NetworkTextReader` next to the
existing pair rule, and nothing else moves.

**Probe rows (2.3), both vendors:** `nwl-bitop-stored-slot`, `nwl-nested-assign`, `nwl-rail-fed-wire`,
`nwl-input-pin-flag`, `nwl-super-call`. They are **not** rows: `nwl-main-output-slot` (N21 already answers it),
`nwl-input-param-type` (S3a does not use it), and N23 and N25 (they stay as DIALECT records outside the table's
vocabulary, as `vendor-fact-probe` 4.2 left them).

**Migration.** A re-pull rewrites the 11 bodies that used to be UNSUPPORTED (S4's body keeps the marker). If S1 is
inert, its 5 bodies change no text that pulls today. `docs/network-text.html` gets S2's grammar line, S6's pin form, and
the S3/S5 type rules, and the "Marker on pull" row loses those entries.

## 1b.2 Disposition — every NWL member: spelled / editor cache / refused by name

**Target.** Every archived member of the 15 NWL classes and their base has exactly one disposition below (census 1b.1:
63 distinct members plus `AbstractNWLItem.Id` on 11 classes = the 74 archived fields, identical on both vendors). With
that, NWL → text → NWL (1b.3) is exact for every non-cache member, and a member missing from the table fails the oracle by
name. **The member table below IS the oracle's member list.**

**Choice: one generic node pragma, written only where the stored value differs from its derivation.** Every scalar member
that is not plain content gets a derivation (a constant, the tree, or the declarations). The writer sets the derived value,
and a stored value that differs is spelled `{Member := value}` directly after its node (an operand, a box's closing paren,
an assign target, the `NETWORK` line, the `IMPLEMENTATION` line). Network text uses no pragma brackets today, so no text
that pulls now changes meaning. A member that a future SP adds gets the same form with no grammar change. Rejected: a
bespoke spelling per member (the grammar grows per member) · a sidecar file (the item's text stops being its truth) · a
table keyed by node path (paths break on any edit) · dropping the unmeasured members (owner default 1b.1: no proof, no
exclusion).

**Codes.**
- **S**: spelled, existing form.
- **S+**: spelled, new form (listed for the owner in the close report).
- **D**: derived. The writer sets it, and the oracle proves the derivation on every corpus node. A counter-example is
  spelled by the pragma, never guessed.
- **C**: editor cache, already measured (the measurement is named).
- **R**: cache candidate. It is SPELLED by the pragma (owner default) unless its `vendor-facts` row shows that the IDE
  re-derives it identically (push without it, save/reopen, read back, build); then it becomes C. The row is recorded in
  **2.2**, before any 2.3 spelling lands.
- **X**: refused by name, per NETWORK (1b.4). These are tree shapes with 0 corpus occurrences and no witness of their
  meaning. Read refuses the network and never drops it, and a future witness turns the shape into a spelling.

Counts are from census 1b.1 (six corpora, both vendors).

| class | member | code | text form / derivation / evidence | corpus |
|---|---|---|---|---|
| `NWLImplementationObject` | `DefaultViewMode` | S | `IMPLEMENTATION LD\|FBD` | Ld 36 / Fbd 10 |
| | `NetworkList` | S | the `NETWORK … END_NETWORK` blocks, in order | 394 |
| | `NetworkListComment` | D | `""`; else `{NetworkListComment := '…'}` on the `IMPLEMENTATION` line | `""` ×46 |
| | `BranchCounter` | R `nwl-branch-counter` | no derivation found (it is not the Parallel count and not the max `VarId`); if not a cache, a pragma on the `IMPLEMENTATION` line | 0 ×23, 1…328 ×23 |
| | `ValidIds` | D | `true`; else pragma | true ×46 |
| `Network` | `Label` | S | `LABEL: x` | 2 |
| | `Title` | S (exact) | `TITLE: "…"`, every stored character: a trailing space inside the quotes, a CR LF as `$R$N` (the title escapes the format already has). Today's readers trim it (`NetworkText.Stored`: CODESYS `Clean`, TwinCAT `Trimmed`, `NetworkTextReader`) and the writers compare ignoring trailing whitespace (DIALECT C8, written when a quoted title could not hold a newline). That trim folds stored content, as C35 found for ST text, and 2.3 deletes it on both sides | 260; ends in whitespace 21 (`" "` 14, `"
"` 6, `" 
"` 1, all lenze-mid) |
| | `Comment` | S / D | the `//` lines under the header (S). The line break between them is D: CR LF (11 multi-line comments, every break CR LF; 0 LF-only, 0 lone CR). Today's `NetworkTextWriter` turns CR LF into LF and the readers trim the end. A stored comment that the lines and that break do not give back (a trailing space or a trailing CR LF on the last line, a bare LF) is spelled `{Comment := '…'}` on the `NETWORK` line. 2.3 deletes the trim and the CR LF fold | 20; CR LF inside 11; ends in whitespace 2 (`" "` 1, `"
"` 1, lenze-mid) |
| | `OutCommented` | S | `DISABLED` | 3 |
| | `NetworkItems` | S | the statements, in order | 808 trees |
| | `Connectors` | X if non-empty | — | empty ×394 |
| | `ILLines` | X if non-empty (with `ILStatement`) | — | empty ×394 |
| | `ILActive` | D | `false`; else pragma on the `NETWORK` line | false ×394 |
| | `ILValid` | D | `false`; else pragma | false ×394 |
| | `FBDValid` | D | `false`; else pragma | false ×394 |
| `BoxTreeAssign` | `OutputItems` | S | the targets `t1 := t2 := … value` | 489 (1–20 targets) |
| | `RValue` | S | the value | 489 |
| | `Flags` | R / X | The text `JMP l` / `RETURN` spells the TARGET operand's bit (the `Flags.Flags` row); it does not say whether the ITEM carries it too, and today's `NetworkTextWriter` ORs the two places together. The item bit is R `nwl-assign-item-flags`, derivation 0: the only control-flow assign in the corpora is IDE-drawn (lenze-mid `ATD_FQI` network 0, `RETURN`, target `???`) and has item `Flags` 0 with `Return` on the target (as `NetworkModel.cs` "both vendors keep Jump and Return on the operand" records). The other witness is a jump TwinCAT's importer built (`VltProbe_Jump.TcPOU`, C13): the bit on both. A stored item bit is spelled `{Flags := Jump}` / `{Flags := Return}` directly before the statement's `;` (unambiguous: an operand's `Flags` is always spelled by the text, never by the pragma). Volt's writers put the bit on both places today (C13); in 2.3 they write the item bit only where the text spells it (C13 measured that the item bit is not load-bearing for the build), unless the row shows the IDE re-derives it. Any other item bit is X | 0 ×489 (the one `RETURN` included) |
| `BoxTreeBox` | `BoxType` | S / D | the callee name of a function or operator (S). **An FB or program call's `BoxType` is not in the text** (1b.3): the text names the instance, and the push takes the type from its DECLARATION — it differs from the stored one on 15 corpus boxes (13 case-only, `TON`/`ton`, `R_TRIG`/`R_Trig`; 1 program call `generalmachineflags`; 1 namespace, `L_OEEA_FBs`/`L_OEEA_Lib.L_OEEA_FBs`). So D (derivation: the instance's declared type) with `{BoxType := '…'}` where the stored spelling differs | 1305 (98 distinct) |
| | `Instance` | S | the instance in `fb(…)`; its null operand on a function/operator is D | named 157 |
| | `OutputItems` | S / S+ / **open** | `=> x`, `.slot`, the main output in place. S4's main output ≠ slot 0 is `.name`, taken from the box's own `OutputParam.Names` (1b.4, S+). The null slot(s) are D. **Open (1b.3): a call's UNCONNECTED output pins** — the IDE draws the callee's whole output list (an empty operand per unconnected slot, its name in `OutputParam.Names`: up to 40 slots on one box) and the text spells only the connected ones, so a rebuilt call box has only those (DIALECT N21: the IDE derives no output list). 186 slot lists come back shorter on 144 networks. Needs a spelling (owner) | 1794 lists |
| | `Flags` | S | negation/edge of the box output (`NOT f(…)`, `R_EDGE(…)`) | 0 ×1305 |
| | `InputFlags` | S+ / R / X | a negated pin is `NOT IN1 := v` (S6, S+). D: null unless a pin is flagged, then `0` on the other pins. A zero-only list is R `nwl-input-flags-list`. An edge on a pin is X | lists ×7 (zero-only 2), negated pins 6 |
| | `InputItems` | S | the pin values | 1305 |
| | `InputParam` | S / D / R | `Names` are the formals and `EN :=` (S). D (1b.3): an operator with EN stores `['EN']` alone (71 boxes: MOVE and the arithmetic operators) where the writer lists every input (`['EN', '']`) — the list stops at the last named pin. `Types` is R `nwl-param-types` | 1305 |
| | `OutputParam` | S / D / R / **open** | `Names` are `=> formal`, `.ENO`, `.slot` (S). The function result pin `"   "` (or `"ENO"` when enabled) is D. The 14 boxes whose name count ≠ slot count (10 Program, 4 Function) are R `nwl-output-param-names`. **Open (1b.3):** the names of a call's unconnected outputs and of its connected main output (`['Q', 'ET']` on a `TON`) — the `OutputItems` gap above: 172 lists on 131 networks | 1305 |
| | `CallType` | R `nwl-call-type` (both vendors) / D | Derivation: `BoxType` + the declarations (an operator from its name, `Function`/`FunctionBlock`/`Program` from the callee's declaration, `None` on EXECUTE); each `BoxType` has exactly one `CallType` on all 1305 boxes, and the oracle proves the derivation per corpus box. Not yet a cache: the one measurement (`probe-nwl-boxoutputs`, `git show b2496efb4b`: a fresh CODESYS box reads `None`, and the same box reads `Move` after reload) covers 1 of the 19 values, an operator, which needs no declaration. The row pushes a Function, a FunctionBlock, a Program, an operator and an EXECUTE box without the value, on both vendors; re-derived on every kind makes it C, otherwise a differing value is spelled `{CallType := …}` after the box's closing paren | 19 values (FunctionBlock 157, Function 113, None 12, Program 11, …) |
| | `EN` | S / R | the `EN :=` pin when the box has an EN slot (N13); otherwise the stored bool is R `nwl-box-en-eno` | null 815, bool 490 |
| | `ENO` | S / R | `.ENO` when used; the stored bool is R `nwl-box-en-eno` (EN≠ENO on the 40 comparisons) | as `EN` |
| | `STSnippet` | S | the EXECUTE body text (the document itself: `STSnippet` row) | 12 |
| | `ContainsExtensibleInputs` | D | `false`; else pragma | false ×1305 |
| | `ProvidesSTSnippet` | D | true exactly when `STSnippet` is set | 12/12 |
| `BoxTreeOperand` | `Operand` | S | the operand (its members: the `Operand` rows) | 2926 |
| `BoxTreeDemux` | `VarId` | S | `g<VarId>`. When that name is taken, the wire is renamed and `{VarId := n}` spells the stored one (D) | 71 distinct |
| | `Input` | S | `g<n> := value;` defines the wire, `g<n>` uses it | fed 140, null 436 |
| `BoxTreeParallel` | `Trees` | S | `PARALLEL(b1, b2, …)` | 17 |
| | `Input` | S | `IN := v` | fed 12, null 5 |
| | `Mode` | S | `MODE := Sequential` (BoxShortCircuit is not written) | 16 / 1 |
| `BoxTreeTerminator` | `Input` | X if non-null (task 1.10) | — | null ×51 |
| | `Flags` | X if non-zero | — | 0 ×51 |
| `BoxTreeMux` | `VarId`, `InputIndex`, `Merger` | X (the node) | — | 0 |
| `ILStatement` | `Operator`, `Prefix`, `Operand`, `Postfix` | X (the node) | — | 0 |
| `STSnippet` | `STSnippet` | S / C / R | the text is S. CODESYS `TextDocument.LineInfoPersistence`/`TextBlobForSerialisation` are C (bridge-one-to-one `editor-caches`). The per-line `Id`/`Tag` on both vendors are ~~R~~ **C since 2.2** (`nwl-stsnippet-line-ids`, N30: CODESYS mints them on load) (CODESYS: consecutive, and the last one equals the snippet's own `Id`; TwinCAT: minted) | 12 snippets, 58 lines |
| `Operand` | `Operand` | S | the name / literal / expression. `""` is an unconnected pin. Null on a function/operator instance is D | name 3695, `""` 470, null 1148 |
| | `Type` | S / R | on a wire, its `VAR_TEMP` type (S). Elsewhere R `nwl-operand-type`, with the derivation: the declared type from the scope, and null/`""` on an unconnected pin as stored per position. **`Instance.Type`** is R `nwl-instance-type`, derivation `BoxType` on a named instance and `""` otherwise; it differs on 47: 20 case-only, 5 other (`SR` vs `RS`, 4 namespace-qualified), 22 And boxes storing `"AND"` | type 3777, `""` 1203, null 333 |
| | `Comment` | D | `""`; else `{Comment := '…'}` | `""` ×5313 |
| | `SymbolComment` | S+ | `""`; else `{SymbolComment := '…'}`. It is a stale copy of a declaration comment (1b.1), not re-derived. This lifts gate 1b-1's per-network refusal. CODESYS reads it from the ARCHIVE: the API property answers the sentinel on every operand (DIALECT N27, found by 1b.3's recording; the reader fixed in 1b.3) | 10 (pro2193 `SetAlarm`) |
| | `Address` | R `nwl-address-sentinel` | `""` vs the archive sentinel `Constant_Address_Serialization_Value`; a real address is spelled by the pragma | `""` 5055, sentinel 258 |
| | `Flags` | S | see the `Flags` row | — |
| | `LValue` | D | true exactly for an assign target or a box output slot | 1082/1082 |
| | `Boolean` | R `nwl-operand-boolean` | not derivable from `Type = BOOL` (they differ on 342) | true 2347 |
| | `IsInstance` | D | true exactly for the box's `Instance` | 1305/1305 |
| `Flags` | `Flags` | S / S+ / X | Negation `NOT`, Set `S=`, Reset `R=`, Jump `JMP` and Return `RETURN` (on an assign's TARGET operand; the item's own bit is the `BoxTreeAssign.Flags` row), Rtrig `R_EDGE`, Ftrig `F_EDGE` are S; a negated pin is S+ (S6). X: an edge on a pin, Rtrig+Ftrig together, an edge on a coil, any flag on a Parallel/Demux (N20) | neg 359, S 118, R 128, Return 1, Rtrig 1 |
| | `Fixed` | R `nwl-flags-fixed` | no derivation by position (box inputs: 1343 true / 1479 false) | true 1914 of 7180 |
| | `Extensible` | D | `false`; else pragma | false ×7180 |
| `OutputItemList` | `OutputItems` | S | through its owner (assign targets, box outputs) | 1794 |
| `ParamList` | `Names` | S | the formals (see the box rows) | 2610 |
| | `Types` | R `nwl-param-types` | the callee's pin types (BOOL 1488, `BOOL[REF]` 147, … 116 distinct) | 2610 |
| `AbstractNWLItem` | `Id` | ~~R~~ **C since 2.2** (`nwl-item-id`, DIALECT N29) | minted per body by the IDE itself (CODESYS on each commit and load, TwinCAT in the import) — an allocator no rebuild loses; unique among a body's items (0 duplicates in 46 bodies), which a push keeps: the TwinCAT splice mints a rebuilt network's Ids above the body's (gate 2-2) | 11,085 |

**The 2.2 rows this table adds (14):** `nwl-item-id`, `nwl-branch-counter`, `nwl-flags-fixed`, `nwl-operand-boolean`,
`nwl-operand-type`, `nwl-instance-type`, `nwl-param-types`, `nwl-box-en-eno`, `nwl-input-flags-list`,
`nwl-output-param-names`, `nwl-address-sentinel`, `nwl-stsnippet-line-ids`, `nwl-call-type`, `nwl-assign-item-flags`. Each
row records, on both vendors, whether a push without the value comes back with the stored one after save/reopen, and
whether it builds. "Re-derived identically" makes the member C. Anything else makes it the pragma, and its corpus count
goes in the close report. **Fixed** and **Boolean** answer the open loss candidate from gate 1b-1 (a CODESYS rebuild drops
both). **Id** decides whether every network that a push rebuilds is identical to one the IDE drew.

**The interim loss window, made visible.** Until a row lands, a rebuild of a network where an R candidate is non-default
(the CODESYS rebuild of a changed network; TwinCAT's import rebuild of a changed shape) keeps today's behaviour: the network
is built fresh and the stored value is dropped. Its reach in the corpora: `Flags.Fixed` true 1914 (1686 operands, 215
boxes, 13 pins), `Operand.Boolean` true 2347, the `Address` sentinel 258, `BranchCounter` non-zero on 23 bodies. No
candidate is refused meanwhile (a refusal on Fixed alone would refuse nearly every CODESYS LD/FBD edit on a guess). So that
the window is not silent: (1) 2.2 records these loss candidates FIRST (`nwl-flags-fixed`, `nwl-operand-boolean`,
`nwl-address-sentinel`, `nwl-branch-counter`, `nwl-item-id`), before the shape probes; (2) until each lands, both drivers'
rebuild paths log one `BridgeLog.Warn` per rebuilt network that names each R candidate it resets and how many stored
non-default values it held (test-first, at the head of 2.2), and a candidate leaves the warning when its row lands; (3) the
close report states the window's dates and that no release between this design and 2.2 claimed LD/FBD edits lossless.

**Decided by constant, with 0 pragmas in the corpora** (D rows with one value on every corpus node): `NetworkListComment`,
`ValidIds`, `ILActive`/`ILValid`/`FBDValid`, `ContainsExtensibleInputs`, `Operand.Comment` and `Flags.Extensible`. They
need no row, because a differing value is spelled and so nothing can be lost. Whether the IDE keeps a pushed non-default is
measured when a witness appears.

**Stays refused by name:** the X rows (all 0 in the corpora), and S4's push when its network changed (N21, read-only
`MainOutputIndex`; 1b.4). Once the pragma is spelled, both writers and both readers handle it, and the 1b-1
`SymbolComment` refusal (`NetworkText.RefuseSymbolCommentLoss`) is deleted with it.

**Migration.** Texts change only where a stored value differs from its derivation. pro2193 `SetAlarm` gains 10
`SymbolComment` pragmas. The 21 lenze-mid titles that end in whitespace gain it inside their quotes (`$R$N` or a space),
and its 2 comments that end in whitespace gain a `{Comment := '…'}` pragma; Volt-written jumps and returns stop carrying
the item bit unless their text spells it. `docs/network-text.html`'s row "Item Jump/Return bit … derived from the target
bit" is corrected with it (the corpus `RETURN` contradicts it). Every R row that the recording leaves "not re-derived" adds pragmas where its values sit; they are
counted in the row and listed for the owner in the close report. The LSP parser and `docs/network-text.html` gain the one
pragma production, `node += [ "{" , member , ":=" , literal , "}" ]`.

## 1b.3 The completeness oracle — what it found

**The oracle.** `CodesysNwlCompletenessOracleTests` (and `TcNwlCompletenessOracleTests`): every LD/FBD network of the
corpora, NWL → network text → NWL through the shipped reader, text writer/reader and writer, every archived member held
to the 1b.2 table (`test/shared/NwlCompleteness.cs` is that table, member for member; a member it does not name fails by
name). CODESYS's NWL is RECORDED (`scripts/record-nwl-corpus.py` → `test/fixtures/nwl-corpus/*.nwl.xml`: the whole
archive of the 44 bodies, plus the API answers the reader is handed where they differ from the archive); the doubles
are hydrated from it and each network is written into a FRESH aspect (a create — what every rebuilt network is), each
written node laid over a FRESH VENDOR OBJECT of its class (gate 1b-3: `scripts/record-nwl-live.py` made every object the
writer constructs in a live CODESYS, through the bridge's own `NwlInterop.New`, and recorded its archive), so a member the
writer never sets is judged against the vendor's fresh value, not a double's default. TwinCAT reads its `.TcPOU` archives
(copied to `nwl-corpus/twincat-project14`, gated byte for byte against the fixture and against the corpus's pulled text)
and runs what a push BUILDS — the in-place write of an unchanged body writes nothing, so it is no evidence (gate 1b-3): the
shipped lowering of each body (a create) and of each network alone (a rebuild) is committed as PLCopen, the XAE's IMPORT
of it is RECORDED (`scripts/record-tc-import.ps1`, a live XAE), and the shipped post-import code (`Adopted`, `Stamp`;
`Spliceable`, the splice, `Apply`) runs over the recording. Every loss found today is a known divergence with the task that closes it
(red first): the run must find exactly those, by member, kind and count.

**Numbers (2026-10-15).** 46 bodies / 394 networks (CODESYS 44 / 388, TwinCAT 2 / 6). CODESYS: 22 networks refused by
the text writer — the census's S1–S6 exactly (7, 6, 6, 1, 1, 1) — and 23 by the push (DIALECT N21: a consumed enabled
comparison, which no push can rebuild; an edit to one of these networks is refused today), 343 compared. TwinCAT (since gate 1b-3):
the CREATE compares no network — POUexecute's whole body is refused before the import (its wire network, unmeasured,
`TcUnmeasured`) and ladderLabel's import drops its empty network (PLCopen has no network element, D25), which the stamp
refuses; the REBUILD refuses 3 of 6 networks (the Execute box, the unmeasured wire, the empty network: the import
answers an empty body) and compares 3, with 22 known divergences over 15 members — Ids re-minted, `Type`/`LValue`/
`Boolean`/`Fixed`/`EN`/`ENO`/the param types as the import answers them before any build, and TON's `OutputParam.Names`
`['Q', 'ET']` imported as one generic `['Out1']` (the R rows' and the open output-pins gap's TwinCAT witnesses).
CODESYS findings: 49 known divergences over 31 members (each `Id` counted per class; 69 / 38 before gate 1b-3 judged the
unset members against the fresh vendor objects); every R row of 1b.2 shows its loss as predicted — read "changed"
against the fresh value (`Id` -1, `CallType` None, `Boolean` false, `Fixed` false) — and the D rows whose derivation is
the fresh object's own value (`Operand.Comment` "", `Flags.Extensible`, `ContainsExtensibleInputs`, `InputFlags` null, the
network's IL/FBD flags) come back without the writer setting them. Members that came back on every compared network: `DefaultViewMode`, `Label`,
`OutCommented`, the network items, the assign targets and values, the box instance / pins / slots as nodes, the Execute
text, `ProvidesSTSnippet`, `VarId`, a Demux/Parallel's feed, trees and mode, the operand text (but a function's null
instance), the flag bits (but the one assign item bit).

**What the table did not foresee (corrected in the rows above).** (1) An FB or program call's `BoxType` is derived from
the instance's declaration, not spelled — 15 boxes differ (D + pragma). (2) A call's UNCONNECTED output pins and their
names are not spelled at all (186 slot lists / 172 name lists shorter; N21: not re-derived) — open for the owner: a
spelling is needed before 2.3 can make the oracle green there. (3) An enabled operator's partial `InputParam.Names`
(`['EN']`, 71 boxes) is a derivation the writer does not follow (D). (4) **The CODESYS reader never saw a symbol
comment** (DIALECT N27): the API property answers the sentinel on every operand, so gate 1b-1's refusal could not fire
on CODESYS — the reader now reads the archive (fixed in 1b.3, test-first; gate 1b-3: witnessed LIVE — the shipped
reader, loaded into a CODESYS, read all ten comments of pro2193 `SetAlarm` #0 and the refusal fired on that model — and an
archive answer that is not text is refused UNREADABLE by name). A fresh operand archives `""` for `Address` and
`SymbolComment` (measured, gate 1b-3), so the Address ledger is the 258 stored sentinels' compared share, no more. (5) Two network headers the readers fold:
21 titles and 7 comments (the 1b.2 rows already planned the fix in 2.3).

## 1b.4 Shown always, refused per network — S4 and every network no push can build

**Target.** No LD/FBD body is UNSUPPORTED for one network. Pull shows every network; a push keeps every network whose
text did not change exactly as the IDE holds it, and refuses a network it cannot build only when THAT network changed,
naming the network (its position and title), the box and the reason. Supersedes the S4 row of 1.1 ("stays refused").

**Pull.** (a) S4: a call box consumed by its main output ≠ slot 0 is spelled `fb(…).name`, the name taken from the box's
own stored `OutputParam.Names[MainOutputIndex]` (no library signature). Written only where the main output is not slot 0,
so no text that pulls today changes; the text reader and the LSP parser gain `.name` after a call's closing paren.
(b) A network the text writer cannot spell (an X row, or an S shape before its 2.3 spelling lands) keeps its header and
comment, and its trees become the one line `UNSUPPORTED <shape>;` (the writer's refusal name), instead of the whole
body's `IMPLEMENTATION <LANG> UNSUPPORTED`. The LSP treats the line as an opaque network (no diagnostics inside it).

**Push — choice: pair live and pushed networks by their TEXT, in order, not by position.** Each live network is rendered
through the pull path (headers carry no number, so a render is position-free); the pushed list is aligned to the live
list by longest common subsequence of exact texts (equal texts are the same file, so a tie takes the earliest). A paired
network is kept: the vendor object is not touched. An unpaired live network between two pairs is replaced by the unpaired
pushed one(s) there (a rebuild in that slot, today's per-network path), any surplus is removed or inserted. Only a network
that is rebuilt or inserted is checked for buildability: S4 (`MainOutputIndex` read-only, N21), the N21 enabled
comparisons, and a pushed `UNSUPPORTED` line (it pairs with its live network or is refused; a live one with no pushed
counterpart is removed — the engineer deleted the network). The same alignment lifts TwinCAT's network-count refusal
(`TcNetworkWriter`: "Volt cannot tell WHICH network was removed", whose "tracked in graphical-vendor-parity-map" is
stale): a removal is the unpaired element dropped, an insertion is `RebuildNetwork`'s one-network import spliced in.

Rejected: per-body refusal (today's marker: one network hides the body; owner 2026-10-12) · positional pairing (today: an
inserted or removed network shifts every later one into "changed" — an untouched S4 network is refused and every shifted
network rebuilt, dropping its R members, 1b.2 loss window) · a network id spelled in the text (TwinCAT re-mints Ids on
rebuild, 1b.3; a copied network duplicates it) · pairing by title/label (mostly empty, not unique).

**Measured first, both vendors: `vendor-facts` row `nwl-keep-network-in-place`** (2.2's table, recorded at the head of
1b.4's implementation). A four-network LD body on the fixture; one `volt push` that inserts a network before #2, removes
#3 and edits #4. Recorded: network #2's identity — CODESYS its items' `Id`s and its archive (`GetSerializableValue`),
TwinCAT its `NetworkList` element bytes — before, after the push, and after save/close/reopen; and the build. This is
the only measurement: it decides whether a vendor can keep one network while its neighbours change. If a vendor
cannot, that vendor keeps positional pairing and refuses an unbuildable network whenever any network of its body
changed, stated as a DIALECT row; the pull still shows every network (never a missing one).

**Stays refused by name:** a changed (or inserted) network holding S4 or an N21 comparison — CODESYS per N21; TwinCAT
`TcUnmeasured` (no witness: S4 is one Lenze CODESYS network, "niche: accepted loss (1 occurrence in the corpora)" for
building it); an edited `UNSUPPORTED` line; on TwinCAT, an insertion whose import builds more than one network (D25).

**Migration.** Lenze `FirstErrorCapture` pulls as network text (`.xErrorActive`); its marker goes. Until each S shape's
2.3 spelling lands, its networks pull as `UNSUPPORTED <shape>;` lines in an otherwise editable body. The completeness
oracle compares the S4 network (it was refused by the text writer). `docs/network-text.html` gains `.name` and the
per-network line; its "Marker on pull" row moves to per network. Pushes that inserted or removed a network on CODESYS
stop rebuilding the networks after it.

**As built (2026-10-15) — where reality forced another choice than the text above.**
(1) **The pairing is a least-cost alignment, not the plain LCS.** Measured on the TwinCAT fixture `POU_PBD` (two networks
holding the SAME rung, one disabled): flipping DISABLED on both makes network 1's new text network 2's old one, and the
LCS kept network 2 for network 1 and built a copy of it from nothing where two header edits in place keep both
(`TcNetworkWriterTests.A_network_can_be_disabled_and_re_enabled`). `NetworkPairing.Plan` aligns in order at the least cost
of what the push then does — keep (equal text) 0 < header-only rewrite (equal trees) < removal < rebuild = insertion — so
every case above comes out as before (the measured push: #1, #2 kept, the new network inserted, one slot rewritten, one
removed) and the swap is two header edits. (2) **The line quotes its shape: `UNSUPPORTED "<shape>";`.** Bare words lex
as tokens, and a shape such as "an Execute box with pins" opens an EXECUTE body in the scope-free token walk
(`NetworkLexer.Walk`, used by the v1 scan and `SameTokens`); a quoted phrase is one string token in both lexers. A
header-only edit of an UNSUPPORTED network (its TITLE, LABEL, DISABLED, comment) is written in place: its trees pair. (3)
**S4's one corpus network also holds S1** (an AND box connected by a stored slot, after `.xErrorActive` is spelled), so
it pulls as `UNSUPPORTED "a bit operator box connected by a stored output slot";` until S1's spelling lands (2.3): Lenze
`FirstErrorCapture.call_FirstErrorCapture_FB` pulls as network text (its body marker goes) with networks #3, #4, #5 (S1)
and #9 (S6) as lines, and the completeness oracle still refuses that network at the text writer (S1 8 = 7 + 1; S4 0). `.name`
is proven on models (`ShownPerNetworkTests`, `CodesysNetworkPairingTests`) and in the LSP. (4) **CODESYS `Id`s are no
identity** (DIALECT N28, the row): the IDE renumbers every `Id` of a body on each commit and compacts them on load, so a
kept network on CODESYS is its content — the writer never touches its vendor object (offline: the doubles' network objects
and their item calls); on TwinCAT its archive `Id`s are the same before, after and across the reopen. Neither vendor
stays per-body. (5) **TwinCAT's Execute pre-scan is deleted**: it hid the whole body where CODESYS's reader now shows the
one network's UNSUPPORTED line; the reader refuses the box under the same name. (6) **The create's stamp stays positional**
(`TcNetworkWriter.Apply(…, byPosition: true)`): the archive is the import's answer to that very body, and a count that
differs is D25's regrouping, refused — never "repaired" by removing an imported network. (7) The strict writer stays for
the push gate and the pushed side of the pairing (a model the writer cannot spell pairs with nothing and is refused where
it is written); only the pull and the live side render per network (`NetworkTextWriter.WritePulled`, the readers'
`ReadShown`). (8) **Gate 1b-4: no pairing erases what the text does not show.** Pairing by text opened three paths a
positional rebuild had closed: a MOVED network is a removal plus an insertion, whose inserted copy (built from the text)
has no symbol comment — and neither step met the 1b-1 refusal; an `UNSUPPORTED` line replaced by trees (or emptied) under
its header paired as an in-place rebuild of a network whose shown model has no trees, so neither guard saw what it
erased; and two networks shown as the same text (two identical `UNSUPPORTED` lines) were told apart by the tie-break,
which removed the one the engineer kept. Now: a live network shown as its `UNSUPPORTED` line never pairs with other trees
(`NetworkKey.Unshown`, a cost above removal + insertion), and `NetworkPairing.RefuseUnseenLoss`, run by both drivers
before the list changes, refuses by name a removal of a network holding what the text does not show (its `UNSUPPORTED`
line, a symbol comment) in a push that also inserts one, and its removal beside a staying network that shows the same
text. Deleting such a network alone, and editing its header, still work. A stored main-output name that is a text word
(`Execute` opens an EXECUTE body in the token walk) is not written after the call: the network is shown as `UNSUPPORTED
"a named main output spelled like a text word"`. IDE-held R members of a moved network are the interim loss window 2.2
makes visible; not refused here.

## 2.2 The probe-table rows — what they answered

**Read through one new read.** `nwl` (`vendor-facts.table.ts`): the subject's graphical body as the vendor ARCHIVES it —
CODESYS `GetSerializableValue` from the NWL aspect down (the archive, never the API, N27), TwinCAT the backing file's
`<XmlArchive>` — flattened in one notation on both vendors (N1) and filtered by member in the runner (`nwlView`). Each R
row creates its subject through the shipped push, calls it from PLC_PRG, and reads it after the push, a build, a
save/close/reopen and a second build: the design's "push without it, save/reopen, read back, build".

**The R rows (DIALECT N29, N30).** No member a push leaves unwritten is filled by a build or a reopen on either vendor (on TwinCAT unmeasured for the
calls subject's five, whose build failed — "Found" below),
except two allocators: the item `Id` (both IDEs mint it — CODESYS on every commit and load, TwinCAT in the import) and the
Execute snippet's line ids (CODESYS mints them on load). Those two become **C**; the text never spells an id (1b.4 rejected
it) and no rebuild loses one the IDE would have kept. Every other R member stays **R → the pragma in 2.3**: `Fixed`,
`Boolean`, the `Address` sentinel, `BranchCounter` (the IDE counts the branches it constructs: 1 for one pushed Parallel),
`Operand.Type`, `Instance.Type`, `ParamList.Types`, `EN`/`ENO`, a zero-only `InputFlags`, `OutputParam.Names`, `CallType`.
TwinCAT's import answers its own values where CODESYS leaves the fresh one (`Fixed` true on every operand, `OutputParam`
`['Out1']` on a call, `CallType` `Function` on a PROGRAM call) — none of them the editor's distribution, so none is a cache.
`nwl-assign-item-flags` cannot be asked of today's CODESYS writer, which writes the item bit itself (C13); TwinCAT's import
leaves the item 0, as the IDE drew the corpus's one `RETURN`. 2.3 re-runs it once the writer stops ORing the bit.

**The interim loss window.** `RebuildLoss` (both drivers, test-first) warns per rebuilt network for `Fixed`, `Boolean` and
the `Address` sentinel; `Id` left it with its row. `BranchCounter` is on the body, which a network rebuild does not touch.
Gate 2-2: a stored value is judged against what the rebuild BUILT, owner by owner (an operand's flag set is not an
item's) — never against one vendor-neutral default, which on TwinCAT named every operand `Fixed` the import gives straight
back (`true`) and missed a stored `false` it turns `true`; on CODESYS it named the negated contact's `Fixed` the vendor
sets again with the negation. The Id's value is a cache, its uniqueness is not: a TwinCAT rebuild spliced the scratch
POU's ids 2..N unrenumbered and repeated Ids of the kept networks; `TcNetworkWriter.Splice` now mints them above the
body's, and the TwinCAT completeness oracle checks every body a push writes holds each Id once.

**The shape rows (N31–N36).** S1: the stored slot is the editor's form, the push builds the plain one, both build clean;
"run the same" is unmeasured, so per 1.1 S1 **goes back to the owner** (the TwinCAT import itself stores a consumed bit
operator with an output slot and the pull reads it back plain). S3a: a pushed leaf-fed wire stores no type anywhere; the
IDE-drawn one (WSM) stores the leaf's declared type on the leaf — 1.1's rule stands, and 2.3's writers put that type on the
leaf. S3b: `g := ;` builds the vendor's terminator-fed wire on both vendors (distinct from `g := TRUE;`), clean — only the
LD type rule is new. S2, S5, S6: today's reader refuses the designed spelling before any vendor write, on both vendors;
no committed fixture holds an IDE-drawn witness (lenze-mid's are recorded in `nwl-corpus`), so their build is measured by
2.3's per-shape fixtures and the rows re-run then.

**Found, not closed here.** TwinCAT's build of the pushed calls program (`VltF_RC`) fails — PLC_PRG reports it undefined,
the bridge's build names nothing in `VltF_RC` — while the same body builds clean on CODESYS: a vendor divergence the
shipped push produces, CAUSE UNMEASURED (the program call imported as `CallType Function` is one candidate). A failed build
is no evidence of what a successful one fills in, so for the five members read off that subject (`Instance.Type`,
`ParamList.Types`, `EN`/`ENO`, `OutputParam.Names`, `CallType`) "not filled by a build" is CODESYS's measurement alone;
they stay R on its strength until 2.3's call-type fixture builds the subject on TwinCAT. The S3a/S3b silent drops (a pushed
leaf-fed wire on CODESYS, `g1 := ;` on both, pulled back `UNSUPPORTED`) and the `g1 := TRUE;` wire divergence (CODESYS
round-trips it, TwinCAT refuses it) are the others. All four are pinned as known divergences in
`test/unit/vendor-facts.test.ts` ("the known divergences the 2.2 rows recorded"): each check states the divergence as
recorded and fails once a re-record closes it (gate 2-2).


## 2.3 The shapes and the members — one pragma, member ↔ text one to one

**Target.** Every S shape and every 1b.2 R/D member round-trips NWL → text → NWL on both vendors, so the completeness
oracle's known divergences reach 0 except the X rows and S4's build. Each lands test-first: a recorded fixture on both
vendors (pull → push → pull fixed point + build), then writer, reader, gate, LSP parser and checks, in 2.1's files.

**Choice: the 1b.2 pragma lands FIRST and S1 is its first user; the box's slot list is derived from its spelled
`OutputParam.Names`.** P1 (1b) supersedes 1.1's S1 outcome "drop the stored slot if inert": the 2.2 row left execution
unmeasured, and P1 forbids folding a member that carries data. So S1 is `(a AND b){OutputParam.Names := ['']}`
(`{OutputParam.Types := …}`, `{EN := …}`, `{ENO := …}` where they differ), and one rule gives the slots back: a box has
one output slot per stored name, empty unless the text connects it (`=> x`, `.name`, the main output in place). The same
rule closes 1b.3's open gap (a call's unconnected output pins, 186 slot / 172 name lists): `{OutputParam.Names := ['Q',
'ET']}` on the call. Pragma grammar: `"{" , member { "." member } , ":=" , literal | "[" literal { "," literal } "]" ,
"}"` after its node; literals are ST's (string, number, TRUE/FALSE, enum word). Rejected: drop S1's slot (execution
unmeasured, P1) · keep S1 refused for the owner (8 networks stay lines, and the pragma decides it without a run
measurement) · a bespoke `.slot`/empty `=>` per unconnected pin (no ST meaning; the grammar grows per member) · library
signatures for the output list (Volt.Engine has none).

**Then, in order:** S2 as 1.1 (the third pair kind, `(t := v)` / `S=` / `R=`). S3a: the wire's `VAR_TEMP` type IS the
leaf's stored `Operand.Type` (the IDE-drawn leaf holds its declared type, 2.2), written onto the leaf on push — so 1.1's
`NetworkScope` variable types are not built (rejected: a second source for a fact the text already carries). S3b as 1.1
(`g := ;`, BOOL in LD). S6 as 1.1 (`NOT xEnable := v`; the `0` on the other pins D, a zero-only list the pragma). S5:
`` `SUPER^` `` resolved through the POU's `EXTENDS` in `NetworkScope`. Then the members: every R row of 2.2 as the
pragma (`Fixed`, `Boolean`, `Address`, `BranchCounter`, `Operand.Type`, `Instance.Type`, `ParamList.Types`,
`EN`/`ENO`, `CallType`), the D rows' derivations in the writer, exact titles/comments, the item Jump/Return bit only
where spelled (then `nwl-assign-item-flags` re-runs). `RebuildLoss` loses each member as it is spelled; it is empty at
the end. `CallType` spelled lets TwinCAT import a PROGRAM call as `Program`; the five calls-subject rows re-run there.

**Inference deleted (count before → after, recorded under 2.3): 8 rule families → 0.** `ProducerType`/
`EveryUseIsBoolean` (wire type from its uses) · `WithoutStoredTypes` (stored output types stripped) · "slot 0 / the
`MainOutputIndex` default is the connected slot" where `OutputParam.Names` now says it · the S1 "stored slot" refusal ·
the title/comment trims (`NetworkText.Stored`, CODESYS `Clean`, TwinCAT `Trimmed`, the writers' `TrimEnd` compares) ·
the comment CR LF fold · the item-bit OR (C13) · `NetworkText.RefuseSymbolCommentLoss` (the pragma spells it).

**Stays refused by name:** the X rows; an edge on a pin; a terminator-fed FBD wire; a leaf-fed wire whose leaf stores no
type (only pre-2.3 Volt pushes); a changed network holding S4 or an N21 comparison (1b.4); a pragma naming a member the
1b.2 table does not hold, or a value its member cannot take.

**Migration.** The pragma appears only where a stored value differs from its derivation; a re-pull rewrites the
`UNSUPPORTED "<shape>";` lines of S1–S6 and adds the counted pragmas (listed in the close report). The LSP parser gains
the pragma, S2's pair, the pin `NOT` and `SUPER^`; `docs/network-text.html` gains all four and loses the per-shape
"Marker on pull" entries.
