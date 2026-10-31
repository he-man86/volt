## Refusals and missing members verified on CODESYS

Measured 2026-10-31 on live CODESYS 3.5.21.40 64-bit (`ide.ps1 -Run nwlref`, a CodesysTestProject fixture copy, English UI).

### Method

**Building each shape.** For every refusal reason in `shapes.v1.jsonl`, one representative was made in LD and in FBD (42 function blocks, including a plain control).

- A push built the base network, for example `y := AND(a, b);`.
- The probe then changed that network in-proc through the NWL object model (object manager `GetObjectToModify` / `SetObject`):
  - a flag was set on the holder: `Flags` properties, or a pin's `SetInputFlag`;
  - or a node was moved or created.
- Every created node got a fresh unique `Id` (from 900000 up).

**What was checked.**

| question | how |
|---|---|
| accepted | `SetObject` committed, and a UI Automation check of the IDE's windows found no dialog |
| kept | save, close and reopen the project; and `export_native`, delete, `import_native`. The stored model (`GetSerializableValue`, recursive) was compared before and after, ignoring only what the IDE derives on load: Ids, operand `Type`/`LValue`/`Boolean`, and the callee pin `Types` |
| builds | `clean` + build; the messages read per object from `MessageStorage`. The check itself was verified: an undefined operand gave C0032/C0046 against its own block |
| runs as | the IDE's own language model of the body (`NWLImplementationObject.GetImplementationSnippet`) |
| drawn | `IFrame.OpenEditorView`, then `DrawToBitmap` of the editor (sheets in `pictures/`) |
| Volt today | the bridge's pull of the same block |

**Common results.**

- No dialog appeared in any case.
- Opening the editor changed no probe's model; it filled only derived types.
- Both round trips kept every shape. The only difference was the ID renumbering on load, and those IDs are minted by the IDE.
- No shape raised a build error.
- LD and FBD behaved the same in every case; only the pictures differ.

### Task A: the 20 refusal categories

"Inert" means the IDE stores the bit and keeps it, but neither the picture nor the generated code shows it.

| # | reason (outcome) | representative built | runs as (IDE language model) | picture LD / FBD | Volt pull today | verdict |
|---|---|---|---|---|---|---|
| 1 | a lone leaf item (refused) | root item `BoxTreeOperand a` (moved out of `y := a;`) | `a;`, warning C0139 "has no effect" | contact with an open end / `a â€”` | `%UNSUPPORTED` | **needs a spelling** |
| 2 | a modifier on a box at the root (refused) | root `AND(a, b)`, `Box.Flags` Negation | `NOT(tmp := a AND b);` | box with a negation circle on its output, no coil | `%UNSUPPORTED` | **needs a spelling** |
| 3 | a coil flag on a pin (refused) | `y := AND(a, b)`, pin 0 `SetInputFlag` Set (bits 2, kept) | `y := a AND b;` (inert) | LD: no mark / FBD: an `S` box on pin a | `%UNSUPPORTED` | **needs a spelling** (inert, see list) |
| 4 | a jump or return flag on a receiver (refused) | pin 0 Jump | `y := a AND b;` | no mark | `%UNSUPPORTED` | **vendor cannot store**: the IDE's own `SetInputFlag` drops the Jump bit (InputFlags read `[0, 0]` straight after the call). Written past that setter into `InputFlags[0]`, the bit is kept but inert |
| 5 | a rising and falling edge on one node (refused) | pin 0 Rtrig+Ftrig (48, kept) | `R_TRIG` only: `y := RT.Q AND b;` | one rising-edge triangle | `%UNSUPPORTED` | **needs a spelling** (falling bit inert) |
| 6 | a flag on an FB instance (refused) | `y := fb1(â€¦).Q1`, `Instance.Flags` Negation | the IDE's own model emits `{error 'An inconsistent element has been detected. Please execute the 'Repair POU' command.'}`, then a plain call; the build reports nothing | no mark | `%UNSUPPORTED` | **vendor cannot store**: the IDE declares the element inconsistent and offers Repair POU to remove it. It is kept and builds clean only because the build does not run that check |
| 7a | a flag on an Assign item, Negation (vendor-refused) | `y := a`, `Assign.Flags` Negation | `y := NOT(a);` | a negation circle on the line before the coil (FBD: on the assignment input) | `%UNSUPPORTED` | **needs a spelling**. It is a third model, distinct from `NOT y := a` (target) and `y := NOT a` (leaf). Corpus: 0 of 484 Assign items |
| 7b | a flag on an Assign item, Set (refused) | `Assign.Flags` Set | `y := a;` (inert) | no mark | `%UNSUPPORTED` | **needs a spelling** (inert) |
| 8 | a mark on a jump or a return (refused) | `JMP.l := a`, target Negation+Jump (5) | `JMP(NOT(a)) l;` | negation circle before the jump arrow | `%UNSUPPORTED` | **needs a spelling**: `NOT JMP.l := a;` is listed today as the error "a mark the IDE stores no model for", and that is wrong |
| 9 | a return with a named target (refused) | target `l` with Return (8) | `RETURN(a);` (name ignored) | RETURN; the name is not shown | `%UNSUPPORTED` | **needs a spelling** (name inert) |
| 10 | a jump and a return on one target (refused) | target `l`, Jump+Return (12) | `RETURN(a) l;` (builds clean) | RETURN | `%UNSUPPORTED` | **needs a spelling** |
| 11 | a Parallel at the root (refused) | root `BRANCH(FEED := start, a, b)` (moved out of an assign) | `tmp := start AND (a OR b);` | branch with no coil / `start â”a bâ”˜` | `%UNSUPPORTED` | **needs a spelling** |
| 12 | a rail-only item (refused) | root `BoxTreeTerminator` | `TRUE;` | an empty rung / `TRUE â€”` | the whole body `%LANGUAGE â€¦ UNSUPPORTED` | **needs a spelling** |
| 13 | an item with no network-text form: BoxTreeMux (vendor-refused) | root `BoxTreeMux`. `Merger` and `InputIndex` have no setter and were set through private fields; `SetInputTree` throws `ValueError: ibtTree` | warning C0139 `a;` | **"An error encountered while drawing this network. The contents cannot be displayed. Object reference not setâ€¦"** | the whole body `UNSUPPORTED` | **vendor cannot store**: no code in the NWL, editor or ladder assemblies constructs a `BoxTreeMux` (IL scan for `newobj`), it has no public way to set its merger, the editor cannot draw one, and the corpus has 0 |
| 14 | a coil flag on an operand (refused) | `y := a`, leaf operand Set | `y := a;` (inert) | LD: contact drawn with an `S` inside / FBD: an `S` box | `%UNSUPPORTED` | **needs a spelling** (inert) |
| 15 | a coil flag on a box (refused) | `y := AND(a, b)`, `Box.Flags` Set | `y := a AND b;` (inert) | no mark | `%UNSUPPORTED` | **needs a spelling** (inert) |
| 16 | a modifier on an Execute box output (refused) | `y := EXECUTE(EN := go, 'â€¦').ENO`, `Box.Flags` Negation | `y := NOT(ENO);` | negation circle on ENO | `%UNSUPPORTED` | **needs a spelling** |
| 17 | a modifier on the rail (refused) | `y := RAIL()`, `Terminator.Flags` Negation | `y := TRUE;` (inert) | no circle | `%UNSUPPORTED` | **needs a spelling** (inert) |
| 18 | a Parallel fed by the empty terminator (vendor-refused) | `y := BRANCH(FEED := start, a, b)`, feed replaced by a new `BoxTreeTerminator` | `y := TRUE AND (a OR b);` (the same as `BRANCH(a, b)`) | differs from `BRANCH(a, b)`: LD has a wire stub from the rail, FBD has a `TRUE` source (`pictures/rail-fed-branch-vs-branch.png`) | `%UNSUPPORTED` | **needs a spelling** |
| 19 | a terminator with an input (vendor-refused) | `y := RAIL()`, `Terminator.SetInputTree(0, a)` | **`;`**: the whole network, coil `y` included, compiles to nothing | the input is invisible; coil `y` is drawn fed by the rail / `TRUE â€” y` | `%UNSUPPORTED` | **vendor cannot build it**: it builds with no error, but the IDE generates no code for a network whose picture shows a coil |

**Summary.** 4 categories are confirmed as refusals: #4, #6, #13 and #19. 16 need a spelling. Seven of those 16 hold inert bits: #3, #5 (its falling bit), #7b, #9 (its name), #14, #15 and #17.

### Gaps that need a spelling (proposed; each follows the decided rules)

Each proposal states the property on the side NWL stores it: a value takes a function, a receiver takes a prefix word, one spelling per model. Each reuses an existing word or form.

| # | stored model | proposed spelling |
|---|---|---|
| 1 | root leaf | `a;` (a root statement, like a root box closed by nothing) |
| 2 | negated root box | `NOT AND(a, b);` (the "box read where it stands" word, at a root) |
| 3 | Set / Reset on a pin | `AND(S= a, b)`, `t1(IN S= a)`, `R=` likewise (the coil-kind operator on the pin's receiver) |
| 5 | both edges on a pin | `t1(RISING FALLING IN := a)`, `AND(a, RISING FALLING := b)` (marks stack, edge first) |
| 7a / 7b | a mark on the Assign item | a word before `:=`, for all targets: `y NOT := a;`, `y S := a;` / `y R := a;` |
| 8 | a negated jump or return | `NOT JMP.l := a;`, `NOT RETURN := a;` (drop the NETWORK_PARSE refusal) |
| 9 | a return with a name | `RETURN.l := a;` (as `JMP.l`) |
| 10 | Jump+Return on one target | `RETURN JMP.l := a;` |
| 11 | root parallel | `BRANCH(FEED := start, a, b);` as a root call |
| 12 | root rail | `RAIL();` |
| 14 | Set / Reset on a value | `y := SET(a);` / `y := RESET(a)` (a function on the value, as `RISING(a)`) |
| 15 | Set / Reset on a box | `y := SET AND(a, b);` (the box word, as `NOT t1(â€¦).Q`) |
| 16 | negated Execute ENO | `y := NOT EXECUTE(EN := go, 'â€¦').ENO;` (the existing box-output rule) |
| 17 | negated rail | `y := NOT RAIL();` |
| 18 | rail-fed parallel | `y := BRANCH(FEED := RAIL(), a, b);` (two existing rules) |

**For the owner.** Seven of these models are inert: the IDE keeps the bit, but neither the editor nor the compiler acts on it. Read strictly, the rule gives them spellings anyway. Under the alternative reading they are "the IDE does not store a meaning", and a refusal would be right. The measurements above are the evidence for both readings.

### Task B: the 34 members the model lacks

Evidence comes from three sources:

- **Corpus counts:** the five CODESYS corpora (`test/fixtures/nwl-corpus/*.nwl.xml`), 44 bodies, 388 networks.
- **IL scan:** an in-proc scan of `NWLObject.plugin`, `NWLEditor.plugin` and the `Ladder*` assemblies for calls to each member's setter and stores to its field.
- **Live behaviour:** what the IDE did in the probes above.

| member(s) | non-default in the corpus | can a user set it? | verdict |
|---|---|---|---|
| `Id` on Network, Assign, Box, Demux, Mux, Operand, BoxTreeOperand, Parallel, Terminator, STSnippet, ILStatement (11) | n/a | No: minted by the IDE. On reopen, the control's Ids were renumbered (23â†’2, 27â†’6, â€¦), and every created node commits with the Id it is given | derived (allocator) |
| `Operand.Comment` | 0 / 5293 | **Yes.** The editor writes it (`ChangeTextAction.SetItemText` Redo/Undo, `NWLEditor.ExecuteStandardCommand`). The options page has "Show operand comment" and the sizes dialog has an operand-comment height. Set live on a leaf, it was stored, built clean, and **Volt's pull dropped it** (`y := BRANCH(a, b);`) | **GAP: data loss** |
| `Operand.Address` | 258 hold the archive sentinel `Constant_Address_Serialization_Value`; no real address | No: written only by `BoxTreeSymbolInfoSetter.SetOperandInfo` (from the declaration's `AT`; shown by "Show symbol address") | derived from the declaration |
| `Operand.Boolean` | true on 2346; differs from `Type = BOOL` on 334 | No: written only by `LDImplementationObjectFactory.Create` | editor cache |
| `ParamList.Types` (InputParam) | filled | No: the editor fills the callee's pin types on open (seen live: `OutputParam.Types` `''` â†’ `BOOL`) | derived from the callee |
| `Flags.Fixed` | true on 1908, including 1289 whose bits are 0 | No: it is a side effect of every modifier setter (`set_Negation`/`Set`/`Reset`/`Rtrig`/`Ftrig` all store `_bFixed`), so it records "a modifier was touched". Nothing draws or compiles it | editor-internal |
| `Flags.Extensible` | 0 / 7149 (including 499 boxes with more than 2 inputs) | The editor's `InsertInput` path calls `SetFlagExtensible`, yet no stored body holds it | editor-internal on the evidence; one UI check (Insert input, save, read) would settle it |
| `BoxTreeBox.ContainsExtensibleInputs` | 0 / 1300 | No caller of its setter | default only |
| `BoxTreeMux.VarId` / `InputIndex` / `Merger` | 0 Mux | No constructor in the IDE; no setter for `Merger`/`InputIndex`; the editor cannot draw one (Task A #13) | not storable |
| `BoxTreeTerminator.Input` | 0 / 50 | No; compiles to nothing (Task A #19) | refusal right |
| `NetworkListComment` (`NWLComment`) | 0 / 44 | No caller of `set_NWLComment` in any NWL, editor or ladder assembly | default only |
| `NWLImplementationObject.BranchCounter` | non-zero in 22 / 44 | No: an allocator (`GetNextBranchCounter` from the editor's InsertBranch, InsertDemux and Connect). It does not track the highest wire VarId (counter â‰¤ max VarId in 12 of 19 bodies with wires) | editor allocator |
| `ValidIds` | all true | No | editor-internal |
| `Network.Connectors` | 0 / 388 | No: `_connectors` is written only by `Network`'s constructor, and nothing appends to it | default only |
| `Network.ILActive` / `ILValid` / `FBDValid` | all false | Set only by the IL view (`ActivateIL`/`ActivateFBD`); a body in the IL view is `%LANGUAGE IL UNSUPPORTED` | IL-view cache |
| `Network.ILLines`, `ILStatement.Operator` / `Prefix` / `Operand` / `Postfix` | 0 / 388 | Only in the IL view (`BoxTreeILConverter`). Live, `ActivateIL` on an LD network left 0 lines and `ILActive` false | IL language: covered by the IL refusal |

**Data loss: one member, `Operand.Comment`.**

- **Proposed spelling:** the property sits on the operand, so on a value it is a function and on a receiver a prefix word: `x := COMMENT(a, 'why') AND b;` and `COMMENT('why') y := a;`.
- **Until it is spelled:** a pull must refuse a network whose operands hold one, by name, as `RefuseSymbolCommentLoss` does for symbol comments. Today it is lost silently.

## Owner decision, 2026-10-31

- **The boundary is whatever changes the program.** A shape gets a spelling when CODESYS stores it AND it changes the
  picture or the generated code: #1, #2, #7a, #8, #10, #11, #12, #16, #18. The inert bits (#3, #5's falling bit, #7b,
  #9, #14, #15, #17) stay refused by name, so a pull never loses them silently. #4, #6, #13 and #19 cannot be stored.
- **The operand comment is spelled now**, not refused, designed with Sim-Assist together with the shapes above.

## Decided by Volt + Sim-Assist, 2026-10-31 (the spellings)

- **#1** `a;`, **#2** `NOT AND(a, b);`, **#11** `BRANCH(FEED := start, a, b);`, **#12** `RAIL();`,
  **#16** `y := NOT EXECUTE(…).ENO;`, **#18** `BRANCH(FEED := RAIL(), a, b)`.
- **#8** `NOT JMP.l := a;`: the receiver prefix on a jump target. The old refusal "a mark on a jump or a return" goes.
- **#7a** `y := NOT := a;`: a mark before an empty receiver, as in `AND(a, NOT := b)`. The Assign item is the unnamed
  receiver between the value and every coil. It stands LAST in a chain (`y := x := NOT := a;`), and anywhere else it
  is refused by name. Marks stack as everywhere else; a stack the vendor does not store is refused.
  - Three texts for three models: `y := NOT a` (leaf), `NOT y := a` (target), `y := NOT := a` (item).
- **#10** a jump and a return on one target: drawn as a plain RETURN, and runs as RETURN, so it is inert and refused by
  name.
- **Operand comment:** ONE function wherever the operand stands: `COMMENT(a, 'why')` (value), `COMMENT(y, 'why') := a`
  (receiver), `IN := COMMENT(a, 'why')`, `Q => COMMENT(x, 'why')`.
  - COMMENT wraps only the operand name, and marks stay outside it (`NOT COMMENT(y, 'why') := a`,
    `RISING(COMMENT(a, 'why'))`).
  - The second argument is a literal string with ST escaping. An empty string is refused, because no comment is the
    plain operand.
