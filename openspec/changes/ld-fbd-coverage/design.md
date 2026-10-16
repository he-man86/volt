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

**As built (gate 2-3, 2026-10-16) — where reality forced another choice, and why.**
- **The derivation is per box kind, not "one slot per name, empty".** A pragma is written only where the stored value
  differs from the DERIVATION (`NetworkMembers.OfBox`), so the derivation had to be the layout a push builds: an
  operator's result slot is `''` (after `ENO` when it has EN); a FUNCTION has no derived result slot; ENO's and a
  comparison's type is `BOOL`, a wire-fed slot takes the wire's declared type, every other type `''`. Why: a drawn
  function's result pin is named `'   '` (three spaces, 97 of 97 corpus boxes), and a box Volt builds with that name
  does not compile ("'   ' is no component of 'F'" — its main output index is read-only, N21; DIALECT N37). So
  `'   '` is spelled by its pragma and is a vendor-limit loss on rebuild (`NetworkMembers.Buildable` builds the
  derivation, `RebuildLoss` names it); an unchanged network is never rebuilt (1b.4).
- **Unwired output slots are the vendor's null, measured.** `AppendOutputItem(null)` throws; `InsertOutputItem(i, null)`
  takes it and the network builds (live SP21, single-use probe, deleted). The CODESYS writer lays slots out by NAME
  (`OutputSlots`), so a named output lands where the vendor's own box holds it (found by the e2e `VltRefArrow`, which
  put a named pin on the wrong slot under the first cut).
- **S1 needs no slot rule of its own:** a bit operator's connected slot is `Box.BitOperatorSlot(names count)`, read by
  both drivers and the text reader from the stored names — the "a stored slot is inert" rule and the S1 refusal are gone.
- **S3a's type also drives the reader**, not only the writer: a leaf-fed wire's producer type is the leaf's own
  (`NetworkSpelling.ProducerType`, the LSP's `producerType`), set from the wire's declaration on read; `TRUE`/`FALSE` are
  BOOL. In FBD a terminator-fed wire stays refused by name ("a wire fed by the empty terminator in FBD").
- **S6's operator pin is spelled on its default formal `IN<n>`** (an operator's pins have no formal in the model; the
  reader normalises `IN<n>` back). A negated pin of a call with no formal stays refused ("a negated unnamed pin of a
  call", 1 network in the corpora: niche, accepted loss).
- **TwinCAT refuses S2, S3a, S5 and S6 by name before its import** (`TcUnmeasured`), as the design's "TwinCAT structural
  edits are refused where the import is unmeasured" says — the import was not measured for them in this step. S1 and S3b
  round-trip and build on TwinCAT. A program call storing no output name and no slot is read through its result
  (`TcNetworkReader.ConnectedSlot`), which closed 2.2's `VltF_RC` build divergence (DIALECT N37).
- **Not reached in this gate (the 1b.2 members after S5):** `Fixed`, `Boolean`, `Address`, `BranchCounter`,
  `Operand.Type` on a box's operands, `Instance.Type`, input `ParamList.Types`/`InputFlags` zero-list, `EN`/`ENO`,
  `CallType`, exact titles/comments, the item Jump/Return bit, `SymbolComment`. Their inference rules stand (below in
  tasks 2.3: 8 families → 4) and their ledger entries are unchanged.

## 2R.1 The readability checks C1–C5 — what they answered (2026-10-16)

Evidence: the vendor-fact row `nwl-editor-refill` (DIALECT N38), the nine recorded fixtures `ng_r1_<op>_three_inputs`
(`network-graphical-c.ts`), and a census of every LD/FBD network of the six corpora — the five CODESYS archives
(`test/fixtures/nwl-corpus`, 44 bodies, 388 networks; CodesysTestProject holds none) and twincat-project14 (2 bodies, 6
networks) — read through the shipped reader and today's writer (a single-use probe, deleted). The owner's word on this
run: "a := b is the assignment without a move" — B2 as written: `a := b` is a coil fed by a leaf, `a MOVE b` a MOVE box;
two trees, two texts.

**C1 — does an IDE refill `OutputParam` (or any member B7 would drop) itself? CODESYS, on a network a push wrote: no.**
Two pushed bodies (DIALECT N38 — after review widened from one LD program of six single-box networks, where every member
sat at its empty value, to an LD body of ten networks with a negated contact, a `PARALLEL`, an enabled MOVE and an
enabled function through its ENO, plus an FBD body with an operator tree, a negated operator pin, an enabled function
and an enabled MOVE), each opened in its own editor (`IFrame.OpenEditorView`, the view's `Editor` checked to hold that
object, `CloseView`), built, reopened, and all three again: 493 archived members identical at all seven points, both
builds clean. That covers `OutputParam.Names`/`.Types` (the push's derivation stays — never the drawn `'   '` /
`['Q', 'ET']` lists), `EN`/`ENO`, `CallType`, `InputFlags`, and `Flags.Fixed`, `Operand.Boolean`, `Address`,
`BranchCounter` AT THE VALUES A PUSH WRITES. So on a pushed network no member is a cache the IDE re-derives. **What C1
does not show:** an engineer's EDIT in the editor (open and close, no edit); what the editor does with a network it
DREW — a push cannot write the drawn values of `Fixed`, `Boolean`, the `Address` sentinel or `BranchCounter` (N29), so
the probe cannot ask whether the editor keeps, recomputes or needs them; and whether code generation reads them. Those
are 2R.4's to measure per member (an IDE-drawn fixture network, edited and rebuilt, built and RUN against the
original). **TwinCAT: owed.** The row and its `editor` step (DTE project item opened, closed saving) are written; the run
was blocked — an orphaned `VoltBridgeTwincat --xae-pid 13656` of this change's own instance (its XAE gone) locks the
bridge DLLs, so `ide.ps1 up` cannot rebuild, and stopping the worker was refused by this session's permission policy.

**C2 — two trees with one text, or one text with two readings (the model census, rule by rule).**
- *Negation on an operator input — no B1 spelling.* FBD stores a negation on the box PIN (`InputFlags`: 4 AND boxes and
  1 call, 2 bodies — lenze-mid `call_FirstErrorCapture_FB`, pro2193 `SetAlarm`; 0 negated operands in the 10 FBD
  bodies); LD stores it on the OPERAND (605 negated contacts in 34 LD bodies, 0 pin flags). Today the pin is
  `AND(x, NOT IN2 := y)`; under B1 `x AND NOT y` would name both trees. → **Open item 3 below.**
- *EXECUTE's enable.* 11 networks (lenze-mid; 5 of them an empty EN) and TwinCAT's `POUexecute` write
  `EXECUTE(EN := c)`. B3 deletes `EN :=` on a box; "Unchanged" keeps `EXECUTE … END_EXECUTE`. → **Open item 4 below.**
- *An enabled box consumed by its parent* — distinct, as the vendor stores it: 57 non-comparison boxes, every one through
  its ENO (`( … ).ENO`), 40 comparisons, every one through its result (bare `(a GT 40 ENABLE c)`), N21. A bare enabled
  non-comparison or a comparison's `.ENO`: 0 in the corpora — refused by name.
- *`ENABLE (A).ENO` vs `A THEN B`*: one tree (B's EN is A's ENO), two texts — the reader refuses the first where `THEN`
  says it (13 chains, 16 coils on an ENO, 57 consumed ENOs, in 28 networks). `( … THEN … ).ENO` is a chain read by a
  consumer. **Re-counted at gate 2R.2 from the nwl-corpus archives** (a box whose null output slot is its `ENO`, by
  parent): 58 ENO uses in 29 networks — 31 into a box's EN, 7 into another box input, 16 coils, 3 split feeders, 1
  parallel feed (TwinCAT 0). "13 + 16 + 57 = 86" double-counts: the 57 consumed ENOs already hold the chains and the
  coils. 58 / 29 is the figure; B4 writes one `ENO`-reading line per use.
- *`ENABLE` as a name.* CODESYS reserves no `ENABLE`: one FB formal (`BLINK_0(ENABLE := TRUE, …)`, lenze-mid
  `General` #6) and 3 variables named `Enable` (none read in a network). No second reading — the keyword stands only
  after a complete box, a formal only before `:=`, an operand only where an operand is expected — but the LSP must lex
  it in context, not as a reserved word. `THEN` is reserved; no FB declares an output `ENO`.
- *`split<n>`*: 0 of the 140 split names collide with a declared name (140 definitions — 139 lenze-mid in 99 networks, 1
  TwinCAT `POUexecute` VarId 1; 573 + 3 = 576 Demux nodes in all; no declaration in the six test-corpus trees matches
  `split<digits>`, gate 2R.2); a collision is refused by name, as `g<n>` is today.
- *NOT box vs a negated value*: no box stores a negated OUTPUT (0 box `Flags` ≠ 0), and the NOT box keeps its formal
  (`NOT(IN := a)`, 3 boxes) — `NOT (a OR b)` has one reading.
- *`ENABLE`'s reach*: at the statement head it runs to `;` or `THEN`; anywhere else the box is bracketed, so `)` ends it
  (a `,` is never reached). An IF/JMP condition counts as "anywhere else" (0 enabled boxes there in the corpora).
- *n-ary vs nested, B5*: brackets are box boundaries; B5 drops only the bracket around a whole coil value, and the
  reader refuses a redundant one (`x := (a AND b)`) so one tree keeps one text.
- *MOVE vs an operator's output pin*: `a MOVE b` (the target first) and `a ADD b => x` (the pin after) read one way each;
  `MOVE b => a` is refused (B2's spelling only).

The mechanical half of C2 — print every corpus network under B1–B8 and read it back to the same tree — needs the new
writer; 2R.3's pull → push → pull fixed point over the corpora is that check.

**C3 — does an IDE store a 3-input SUB/DIV/MOD/comparison box? It stores it and REFUSES TO BUILD IT.** CODESYS took the
nine pushes and every build failed: "'-' needs exactly '2' operands" (`'/'`, `'MOD'`, `'>'`, `'>='`, `'<'`, `'<='`,
`'='`, `'<>'`). The corpora hold 0 of them (every SUB/DIV/MOD/comparison box has 2 inputs; only AND/OR have more, up
to 9). B1's guard is the compiler's rule. Disagreement pinned by the nine recordings: today's push and LSP accept the
group (the LSP is silent on all nine — each fixture carries `deferred.lsp`, so the gap replays as an expected
failure and the mark goes stale the day the LSP agrees); B1's guard lands in 2R.3. TwinCAT not recorded (C1's blocker).

**C4 — networks B7 would refuse, per member, if neither cache nor derivable.** C1 found no refill on a pushed network
(not a proof that no member is a cache on a DRAWN one — C1's limits above), and 1b.2 found no derivation for these four:

| member | CODESYS nodes | CODESYS networks (of 388) | TwinCAT (of 6) |
|---|---|---|---|
| `Flags.Fixed` true | 1908 | 340 | 5 |
| `Operand.Boolean` true | 2346 | 296 | 1 |
| `Address` sentinel | 258 | 27 | 0 |
| `BranchCounter` ≠ 0 | — | 22 of 44 bodies | 1 of 2 bodies |
| any of the first three | | **348 (90 %)** | 5 |

Plus the drawn names 2.3 spells by pragma today (`'   '`, an FB's unwired output list): 195 networks carry a pragma
(counted in the 2.3 writer's TEXT, not in the archives — gate 2R.2 could not re-derive it from the nwl-corpus files).
**More than a handful → Open item 5 below.**

**C5 — corpus reach per rule (CODESYS networks; TwinCAT's 6 add EXECUTE, an empty named pin, one split — `POUexecute`
VarId 1, 1 definition + 2 references — 2 bit-operator boxes with a stored slot and 2 TON calls; corrected at gate 2R.2,
which also corrects B4 and B6 below — see 2R.2's corpus reach).** B1 operator
words: 74 SUB/ADD/MUL/DIV/comparison boxes in 35 networks (every one enabled — `GT(EN := …)` today), plus 826 AND/OR
groups whose spelling is unchanged · B2 MOVE: 102 boxes in 44 networks · B3 ENABLE: 225 enabled boxes in 95 networks ·
B4 THEN / `.ENO`: ~~86 ENO uses in 28 networks~~ 58 in 29 (C2) · B5: 483 bracketed values in 211 networks · B6 split:
~~573 wires~~ 139 split definitions (573 Demux nodes) in 99 networks · B7: 249 `OutputParam.Names` + 288 `.Types` pragmas in 195 networks · B8 PARALLEL: 17 in 12 networks · small:
7 back-ticked strings, 3 NOT boxes, 3 disabled networks. **Lines before** (NETWORK … END_NETWORK, non-blank): lenze-mid
1820, bakon-nano 86, pro2193 11, awa-palletizer 6, CodesysTestProject 0, twincat-project14 22 — **1945**. **After:**
measured by 2R.3's re-pull (no B-writer exists yet).

### 2R.1 Open — for the owner (2R.1 stops here)

1. **The empty enable** (readability.md Open): 37 in 33 lenze-mid networks — MOVE 6, GE 5, EXECUTE 5, LT 4, EQ 2,
   LE/GT/MUL/ADD 1 each, 11 program/FB calls. Alternatives: **(a) `ENABLE` with nothing after it** (`tInt MOVE 0
   ENABLE;`, `IDB_WSM(…) ENABLE`) — distinct from no ENABLE and from `ENABLE TRUE` · (b) `ENABLE` followed by the
   empty back-tick pair — no: that pair is the empty-text OPERAND (lenze-mid's `fbTonEnableDelay` `PT`), another tree ·
   (c) `ENABLE ???` — no: `???` is the unnamed instance. A named input left empty (`t2(IN := , PT := e1)`, TwinCAT) keeps `IN := ,`. **Default: (a).**
2. **An operator box with an output pin and no EN** (readability.md Open): 0 in the corpora. Alternatives: **(a) `a ADD
   b => x;`** (B3 without its ENABLE) · (b) refuse it by name (niche: 0). **Default: (a).**
3. **A negated operator pin (C2).** Alternatives: **(a) the body's language decides — in FBD `NOT x` on an operator's
   operand IS the pin's negation, in LD the contact's** (the corpora partition exactly so; a text that needs the other
   one is refused by name) · (b) keep the call form for it, `AND(x, NOT IN2 := y)` (a second spelling of AND) · (c) its
   network `UNSUPPORTED` (niche: 4 boxes in 2 bodies). **Default: (a).**
4. **EXECUTE's enable (C2).** Alternatives: **(a) `EXECUTE ENABLE c` … `END_EXECUTE;`** (B3's word; an empty one per
   item 1) · (b) keep `EXECUTE(EN := c)` as the one exception. **Default: (a).**
5. **B7 against C4.** Strict B7 refuses 90 % of the corpora's networks. Alternatives: **(a) these members are LOST ON
   REBUILD, not refused** — an unchanged network is never rebuilt (N28), so a pull/push keeps every one byte for byte;
   a network the engineer edits is built fresh with the push's values, and `RebuildLoss` names each value it drops
   (today's interim window, made the rule) · (b) strict B7: those networks `UNSUPPORTED` · (c) keep the member pragma
   (rejected by the owner, 2R). **Default: (a)** — but (a) is NOT shown safe. What 2.2 recorded is only that a pushed
   network without them BUILDS clean on both vendors. Whether the vendor's code generation reads `Address` or
   `Operand.Boolean` (or `Fixed`, `BranchCounter`), so that a rebuilt network could BEHAVE unlike the drawn one, has not
   been asked: no run or exec comparison of a rebuilt network against its drawn original exists. Before (a) becomes the
   rule, 2R.4 measures it per member — a drawn corpus-shaped network and its rebuild, both run (`record:exec`) on the
   same inputs, outputs compared — and a member whose loss changes behaviour makes its network refused on rebuild
   ((b) for that member), not lost.

## 2R.2 Readability — the grammar 2R.3 builds, and every member under B7 (2026-10-16)

**Target.** `readability.md` AS IT IS NOW is the grammar, whole: B1–B8, the small ones, P1–P16 — one rule, a box is its
NAME (`a ADD b`, `a GT 40`, `MOVE b => a`), `:=`/`S=`/`R=` are coils only (`a := b`: a coil, no box), `EN` the enable
after the box, a line without `;` hands its root box's ENO to the next line's one `ENO` (one `;` = one NWL item), jumps
are coils (`JMP l := c;`), `split<VarId>` with no `VAR_TEMP` (type inline only where it differs), the drawn parallel as
`BRANCH` lines combined by `feed INTO BRANCHES [SHORTCIRCUIT]` (inline `INTO (BRANCH … BRANCH …)` only inside a branch).
That file is the spec; 2R.3 writes `docs/network-text.html` from it. This section's earlier draft (`ENABLE`/`THEN`/`FEED`)
is replaced, not amended. Model, drivers and push pairing (1b.4) do not change.
readability.md's B7 and "Open" now state Open item 5 as decided (lost on rebuild, not refused) — gate 2R.2; before it
they still read "rare → `UNSUPPORTED`, common → STOP", and this section is what overrode them.
2R.1's C2 bullets were read against that draft's spellings (`ENABLE`, `THEN`, `.ENO`, `a MOVE b`). Re-checked at gate
2R.2, bullet by bullet, against C2's own question (two trees with one text, or one text with two readings):
- *MOVE.* B2 reverses the bullet: `MOVE b => a` is the spelling, `a MOVE b` is refused (P14). One reading: `MOVE` is a
  box word (P1) and opens the line, `a ADD b => x` is infix with the pin after — no text is both. All 102 corpus MOVEs
  have one value input (101 enabled, 1 not), so all print in the word form; P16's call form `MOVE(a, b)` / `MOVE()` /
  `MOVE(IN := ) => x` has 0 corpus reach. Owed to 2R.3: the reader refuses the call form where the word form fits, so
  one tree keeps one text.
- *Named ENO pin vs coil on ENO* (P16, `MOVE(0, ENO => lamp) EN c` vs `MOVE 0 => x EN c⏎ lamp := ENO`): two STORED
  trees (an operand in the box's ENO output slot; an Assign reading the box through its ENO), two texts — not a C2
  collision. Whether the IDE treats them as one is P16's open measurement (2R.3); 0 corpus boxes store an operand in an
  ENO slot.
- *`ENABLE`.* No longer a keyword (`EN` is, reserved per P1), so the context-lexing note is moot. The two counts measure
  different things and both stand: C2's 1 FB formal + 3 variables are what the NETWORKS wire (in the archives one box,
  lenze-mid's `BLINK`, has an `ENABLE` formal); readability's "about 60 FBs" was declarations, re-counted: 30 distinct
  FBs with an `ENABLE` input (80 declarations across the five CODESYS test-corpus trees; MC_*, BLINK, …).
- *ENO uses, splits:* re-counted (C2 above) — 58 in 29 networks, 140 split names.
The other C2 bullets (negated pin, EXECUTE, NOT box, n-ary vs nested) are tree facts and stand as written; their
spellings follow B1–B8.

**2R.1's open items (owner, tasks 2R.2).** 1 empty enable → bare `EN` (`iRPM MUL 6 => oDrive EN;`; 37 in 33 networks).
Rejected: ``EN `` `` (the empty-text operand, another tree), `EN ???` (the unnamed instance). · 2 operator box with an
output pin and no EN → `a ADD b => x;` (0; rejected: refuse — refusing a buildable tree for no gain). · 3 negated
operator pin → P10's call form `AND(a, NOT IN2 := b)` (4 boxes, 3 networks). Rejected: "the IMPLEMENTATION line decides"
(`NOT x` would mean the pin in FBD and the operand in LD — one text, two trees across bodies); `UNSUPPORTED` (the call
form already exists). · 4 → `EXECUTE EN c … END_EXECUTE` (11 networks + TwinCAT 1; rejected: keep `EXECUTE(EN := c)`, a
second EN spelling). · 5 B7 vs C4 → **lost on rebuild, not refused**: an unchanged network is never rebuilt (N28) and
keeps every member byte for byte; an edited one is built with the derivation and `RebuildLoss` names each dropped value
(P15's code lens). Rejected: strict B7 (90 % of networks, 348 of 388, uneditable over members no run has shown to
matter); the pragma (owner, 2R). 2R.4 runs drawn vs rebuilt per member (`record:exec`); a member whose loss changes
behaviour makes its networks refused on rebuild.

**Member disposition (no pragma; codes: S spelled · D derived on push from text + declarations, as the editor does ·
C editor cache, dropped · L lost on rebuild until 2R.4 · E shown, edit refused · X the network `UNSUPPORTED`).**
- **S:** `DefaultViewMode`, `NetworkList`, `Label`, `OutCommented`, `Title` exact (21 differ from today's trim — the
  trims go), `Comment` verbatim (P12; the CR LF fold goes), items, Assign targets/value, `BoxType` of an operator or
  function, `Instance`, inputs, `STSnippet`, Demux `VarId`/`Input`, Parallel `Branches`/`Input`/`Mode` (`SHORTCIRCUIT`
  where it differs from the editor's `Sequential`: 16 of 17), Operand name + flags, box `Flags`, a negated pin.
- **D:** an FB/program `BoxType`, a call's whole output list and `InputParam`/`OutputParam` `Types` from the callee's
  declaration (a library POU through the bridge's signature read — 2R.3 measures it on both vendors first, L until
  then; it covers every call box — 281: 157 FB, 113 Function, 11 Program; CODESYS 279 in 206 networks, TwinCAT 2 TON —
  and replaces today's pragmas, 249 `Names` + 288 `Types` in 195 networks as counted in the 2.3 writer's text; the
  earlier "413 derivations" had no source and is withdrawn), `CallType`, the stored `EN`/`ENO`
  bools, `InputFlags` null-or-zeros, `Instance.Type`, `Operand.Type` (a split's differing type is S, 0 in the corpora),
  `Comment`/`LValue`/`IsInstance`, `Extensible`, `IL*`/`FBDValid`, the item's Jump/Return bit (0 — the writer stops ORing
  it), body `NetworkListComment`/`ValidIds` (a differing value → the body `UNSUPPORTED`, P13; 0).
- **C:** item `Id`s, STSnippet line ids, the TextDocument caches (N29, N30, C1/N38: no refill on a pushed network).
- **L:** `Fixed` (340 networks), `Boolean` (296), the `Address` sentinel (27), a function's result name `'   '` (105 of
  the 113 Function boxes, in 82 networks, all CODESYS — no box Volt builds can hold it, N37), a bit operator's stored
  slot `['']` (17 And/Or boxes in 8 networks: 15 CODESYS in 7, 2 TwinCAT in 1 — tasks.md census "S1 17"; the earlier
  "11" withdrawn; counts re-taken from the nwl-corpus archives at gate 2R.2), stored values that differ from D
  (15 `BoxType` spellings, 47 `Instance.Type`, stale `Operand.Type`, `EN`/`ENO`, zero-only `InputFlags`). Body
  `BranchCounter` (22 of 44 bodies): a network rebuild never writes the body, so it survives; a body create takes the
  IDE's count.
- **E:** `SymbolComment` (10 operands, 1 network; `RefuseSymbolCommentLoss` stays until 2R.4), S4 `fb(…).name` and an
  enabled comparison value (N21, P5), as 1b.4.
- **X / refused by name:** non-default `Terminator`, `BoxTreeMux`, `ILStatement`, `Connectors`, `ILLines`; a box
  consuming two ENOs; a one-branch parallel (C0023); a 3-input SUB/DIV/MOD/comparison (C3); every old spelling (P14) —
  all 0 in the corpora.

**Corpus reach (C5; 388 CODESYS + 6 TwinCAT networks, 392 of 394 spell clean, P16).** B1 74 non-AND/OR boxes in 35
networks + 826 AND/OR groups · B2 102 MOVEs / 44 · B3 225 enabled boxes / 95 · B4 58 lines reading `ENO` / 29 (one per ENO use,
re-counted from the archives: 31 EN chains, 7 other box inputs, 16 coils, 3 split feeders, 1 parallel feed; C2's "86 /
28" double-counted) · B4b 1 conditional `RETURN`, 0 `JMP` · B5 483 bracketed values / 211 · B6 140 split definitions in
100 networks (lenze-mid 139 / 99 + TwinCAT `POUexecute` 1; 576 Demux nodes = 140 definitions + 436 references,
tasks.md census), inline types 0 · B7 195 networks lose their pragma (the 2.3 writer's text) · B8 17 parallels / 12 (5 unfed) · P1 backticks 4 · P10 call form 4 pins. Lines: 1945 before; after: 2R.3.

**Migration.** No users, no compat: 2R.3 replaces writer, reader, gate and LSP parser in one pass, deletes every V2
spelling (`NetworkPragma.cs`, the pragma text half, `syntax/network/pragma.ts`) and refuses each old form with a pointer
to the new (P14); recordings stand (the model is unchanged), goldens and the corpora are re-pulled.
