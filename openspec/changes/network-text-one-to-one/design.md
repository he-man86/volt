# Design: network-text-one-to-one (step 2.1, measured)

## Method

Live CODESYS 3.5.21.40 64-bit, 2026-10-31 (`ide.ps1 -Run o2o -Instance o2o`, a CodesysTestProject copy). A throwaway probe
pushed each text into a new FB, read the stored tree in-proc through the object manager, drew the editor
(`IFrame.OpenEditorView`, then `DrawToBitmap`), and built and ran everything in simulation (one holder PROGRAM called from
`PLC_PRG`; the run probe refuses on any build error). A shape the text cannot spell was made by editing a pushed network
in-proc; every node the probe created got a unique Id. A UI Automation watcher on the IDE saw no dialog.

Corpus counts: the five CODESYS NWL archives (`test/fixtures/nwl-corpus/*.nwl.xml`, 388 networks) and, for ST call forms,
the six LSP corpora (`volt-lsp-iec/test-corpus`). Finding 7 (marked coils in a chain) is measured with the mark family
(`network-rail-and-pin-negation`), not here. Paths below are under `packages/volt-cli/src`.

## F2 — an operand holding an ST expression

| operand text | operands | networks |
|---|---|---|
| a call (25 type conversions `X_TO_Y(…)`/`TO_INT(…)`, 6 `fc_dinttotime(…)`) | 31 | 19 |
| arithmetic only (`a*b*1500` ×3, `x.y*10`) | 4 | 2 (1 also holds calls) |
| holding `AND` / `OR` / `NOT` | 0 | 0 |
| **all** (lenze-mid only; 9 direct addresses `%IB26` and 5 `???` are plain operands, not counted) | **35** | **20** |

- Every call re-reads as a box. The arithmetic is refused by the reader ("in a network every box is a call",
  `StNetworkReader.cs:673`). So all 35 operands collide, not a subset.
- **Rule (revised).** Write the operand's own text, with ONE spelling for every operand that is not a plain operand. The
  text must not be read as boxes. Owner choice: a network-only function holding the text as a string, e.g.
  `OPERAND('INT_TO_WORD(x)')`, so no syntax is added. Volt's proposal holds; the "only the colliding subset" part does not.

## F3 — a root box's main output

- `MainOutputIndex` has no setter and no field. Its getter is `Common.GetBoxMainOutputIndex` (IL read live): **the index
  of the first null in `Outputs.List`**, or null when the list is empty or holds no null.
- So a rebuild sets it: put the null at slot k (`InsertOutputItem(k, null)`), as the writer already does for a consumed
  box.
- Made live: a root `c2 : CTU` with names `['Q', 'CV']`, outputs `[Op '', null]`.
  - It stores `MainOutputIndex = 1`, builds clean and runs.
  - It is drawn with CV as the box's main output line, and an empty operand box on Q.
  - Today it pulls as `c2(CU := a, PV := 5);`, which drops the index. The text `c2(…).CV;` is refused
    (`NETWORK_PARSE`, "a box at a root hands nothing on").
- Corpus root boxes: 172 store index 0, 1 stores 1 (lenze-mid), and 10 store none. Those 10 hold no output names.
- Also found: a pushed root box stores NO output list (`out = []`, index none) and is drawn without pin names. A drawn
  root CTU stores `['Q', 'CV']` with index 0.
- **Rule (confirmed).** `.NAME` at a root names the stored main slot. A root with no closer is slot 0, the drawn default.
  The writer writes a root box's output list with the null at its main slot. Only a box with no output names has no
  index.

## F6 — a coil inside an AND chain

| text | stored | LD picture | FBD picture |
|---|---|---|---|
| `y := a AND (x := b) AND c;` | `AND(a, Assign[x] ← b, c)` | a 3-input AND box; coil x branches off the b contact | one AND box; x branches off b |
| `z := (w := a AND b) AND c;` | `AND(Assign[w] ← AND(a, b), c)` | one rung: a, b, then coil w on a branch, then c, coil z | two AND boxes; w on the wire between them |

- These are two distinct models with two distinct pictures, and both build. Sim-Assist's premise ("draw as one rung") is
  refuted: CODESYS draws a coil on a non-first AND operand as an AND box.
- Corpus: an `Assign` at a contact AND's pin 0 occurs 2 times, at pin > 0 0 times; at other boxes' pins, 2 at pin 0 and
  2 at pin > 0.
- **Rule (revised).** No refusal. Each model already has its own text, and refusing the second form would leave a
  storable, drawn, building model unspellable. Sim-Assist's editor draws it as CODESYS does (an AND box). Jump targets
  were not measured.

## F8 — wires keep their value

The probe used an LD body whose wire is read before it is defined (`y := w1; w1 := a;`), and ran it in simulation, two
scans:

| case | calls | result | meaning |
|---|---|---|---|
| FB, two instances | scan 1: `i1(a := TRUE)`, `i2(a := FALSE)`; scan 2: `i2(a := FALSE)`, then `i1(a := FALSE)` | `i2.y = FALSE`, `i1.y = TRUE` | the wire's memory is **per instance**, across scans |
| FUNCTION | `F(TRUE)`, another function, `F(TRUE)`; next scan `F(FALSE)`, `F(FALSE)` | all four FALSE | **no** memory across calls: fresh each call |

A PROGRAM keeps it across scans (measured 2026-10-27, `st-spellings-run`).

- This is exactly ST's `VAR`: per instance in an FB or PROGRAM, initialized on every call in a FUNCTION.
- `VAR_TEMP` would hold nothing across scans, which is wrong for the FB.
- **Rule (confirmed).** Declare wires as `VAR w1 : ANY; END_VAR`. `ANY` stays (the Demux stores no type).

## F10 — a box pin drawn as a contact or as a value (LD)

| text (LD) | stored | picture |
|---|---|---|
| `x := ADD(i, j);` | `Leaf i`, `Leaf j` at the pins | values on the pins, box off the rail, x assigned |
| `q := rs1(SET := a, RESET1 := b);` | `Leaf a`, `Leaf b` | **both** pins are contacts on the rail; coil q |
| `x := SEL(a, i, j);` · `y := SEL(a, b, TRUE);` | leaves | G is a contact; `i` and `j` are values; `b` and `TRUE` on the ANY pins IN0/IN1 are contacts |
| `y := MOVE(a);` · `k := F(n := i, c := a);` | leaves | a is a contact (on an ANY pin; on F's second pin) |

- The stored model is one shape: a `Leaf` at the pin.
- What decides the picture is **the operand's own type**: a BOOL operand is a contact, anything else is a value. Neither
  the pin's position nor its declared type decides it.
- `Operand.Boolean` decides nothing. It was set both ways in-proc (`i` true, `a` false), and after reopening the picture
  was unchanged. In the corpus it varies on drawn LD pins: true on 340 BOOL and 19 other operands, false on 58 BOOL operands. It is already a held
  member.
- **Rule (confirmed, sharpened).** No text rule: one model, one text. The editor draws by the operand's type, not the
  pin's (Sim-Assist said "declared type").

## F11 — infix AND/OR versus the call AND/OR

| view | call form: names `['']`, index 0, EN/ENO false | contact form: names `[]`, index null, EN/ENO null |
|---|---|---|
| FBD bodies | 13 (lenze-mid 9, pro2193 4) | **1** (pro2193, an OR) |
| LD bodies | 2 | 814 |

- Live: `y := AND(a, b);` and `z := a AND b;` draw **alike**: one AND box in FBD, two contacts in series in LD.
- **Rule (revised).** The count is not 0, so infix stays in FBD. These are two models with one picture in both views,
  and each keeps its text. Today a push of the call form stores EN/ENO null where the drawn call form stores false
  (a held member).

## F12 — positional versus named pins (SEL / MUX / LIMIT / shifts)

- ST corpora: SEL 209, LIMIT 62, SHL 524, SHR 10, MAX 310, MIN 57, MUX/ROL/ROR 0. **All 1,172 are positional.** The NWL
  corpus holds none of these boxes.
- Live, FBD: `SEL(G := a, IN0 := i, IN1 := j)`, `SHL(IN := i, N := 2)` and `LIMIT(MN := 0, IN := i, MX := 5)` store
  their pin names (`InputParam.Names`). The positional forms store `[]`.
- Pictures: SEL and LIMIT are drawn alike either way (labels from the operator). Positional SHL is drawn without pin
  labels.
- All build, run (`LIMIT` gives 5, `SHL` 12) and pull back as pushed.
- **Rule (revised).** Positional versus named is the stored `InputParam.Names`: two models, not two spellings. Refusing
  either form leaves a storable model unspellable. The text spells the stored names, as `ADD(EN := a, i, j)` already
  does (`['EN', '', '']`). The doc says so, and its `f(a, b)` example stays.

## F13 — EN/ENO on the Execute box

| model | how it was made | picture | runs (`n := n + 1`, 99 scans) | pulls as |
|---|---|---|---|---|
| EN true, ENO true | `EXECUTE(EN := e, CODE := '…')` (all 11 in the corpus) | EN and ENO pins | under `e` | as pushed |
| EN true, ENO false | in-proc | EN only | under `e` | **the row above** (lossy) |
| EN false, ENO true | in-proc | ENO only | every scan (99) | `EXECUTE(CODE := '…')` |
| EN false, ENO false | in-proc | no pins | every scan (99) | `EXECUTE(CODE := '…')` (lossy: two models, one text) |
| EN **null**, ENO true | `EXECUTE(CODE := '…')` pushed | ENO only | **never (0)** | as pushed |

- EN and ENO switch off. Each model stores, draws without the pin, builds and runs.
- **Rule (confirmed).** Drop the exception: the Execute box follows every box. `EN :=` means EN shown, `.ENO` (at a
  root as elsewhere) means ENO shown, and no EN is stored as false.
- **Defect, for the owner:** today's EN-less push stores EN null, and its code never ran. The cause (null against
  false, or the single-commit Execute fault of `ld-fbd-coverage` 2R.6a) is not isolated.

## F15 — `(a AND b) AND c` versus `a AND b AND c`

| text | stored | LD | FBD |
|---|---|---|---|
| `y := (a AND b) AND c;` | `AND(AND(a, b), c)` | three contacts in series | two boxes |
| `z := a AND b AND c;` | `AND(a, b, c)` | three contacts in series (**alike**) | one 3-input box |

- Both build. Corpus: 3 drawn LD contact ANDs take a contact AND directly as an input (lenze-mid), so the nested model
  is one CODESYS stores from drawings.
- **Rule (revised).** Keep both texts: the brackets carry the model, as in `NOT(a)` / `NOT a`. Keeping one would rebuild
  those 3 networks onto another model. They draw alike only in LD.

## Found in passing (for the owner)

1. **An FB instance named `r` is not read.** `q := r(SET := a, RESET1 := b);` is refused `NETWORK_PARSE` ("an operand at
   'r(…'"); the same text with `rs1` lands. The reader takes `r` as the `R=` stem.
2. **A pushed `EXECUTE` without EN never runs** (F13).
3. **Pushed boxes differ from drawn ones in held members.** The call-form AND stores EN/ENO null where a drawn one stores
   false (F11). A root box stores no output list where a drawn one stores its names with the null at slot 0 (F3).

## Decided by Volt + Sim-Assist, 2026-10-31

- **F2: `OPERAND('…')`**, one spelling for an operand that holds ST text. Its argument is a literal string with normal ST
  escaping (`$'`, `$$`). Any other argument is refused by name.
- **F3:** `.NAME` is allowed at a root box. **F8:** wires are `VAR w1 : ANY; END_VAR`. **F13:** EXECUTE follows the
  general EN/ENO rule.
- **F6, F10, F11, F12, F15:** no Volt change. The measurements show distinct stored models, or a picture decided by the
  operand's own type. Sim-Assist fixes its editor (layout keyed on the operand's type, no merging of nested series).
