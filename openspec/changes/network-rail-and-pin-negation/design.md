# Design: network-rail-and-pin-negation (step 1.1, for the owner to pick)

Five stored shapes have no spelling: the text writes them as another shape, which a rebuild then stores (the pull,
push, pull is a fixed point, but on a different model). This design gives each shape 1–2 candidate spellings, the
stored model each candidate builds, and a recommendation. Nothing is built until the owner picks.

## Measured

**Corpus** (`test/fixtures/nwl-corpus/*.nwl.xml`, the five CODESYS archives, census 2026-10-31; the three-column counts
are from the archived `network-text-st` design, CODESYS / TwinCAT / Sim-Assist samples):

| shape | count |
|---|---|
| coil on the bare rail (`BoxTreeAssign.RValue` = `BoxTreeTerminator`) | 3 (lenze-mid); 4 / 2 / 0 |
| other values on the rail: wire definitions · box input pins | 4 · 52 |
| negated box pin (`InputFlags[i].Negation`) | 6 (lenze-mid `FirstErrorCapture`) |
| negated coil (target `Negation` without `Set`) | 0; 0 / 2 / 3 |
| edge coil (target `Rtrig` / `Ftrig`) | 0; 0 / 3 / 0 |
| coil and jump/return on one item, value not repeatable | 0 |
| root wire read ONLY as the whole value of root coils | 13 (12 read twice, 1 six times) |

**Live, CODESYS 3.5.21.40 64-bit** (2026-10-31, `ide.ps1 -Run nrpn`, fixture copy; a throwaway e2e probe pushed each
text into a new LD FB, pulled it back, built it, and counted the stored items in the IDE's own native export):

| pushed text (first network; the second is `skip: x := a;`) | stored items | pull | build |
|---|---|---|---|
| `w1 := t1(IN := c, PT := T#1S).Q; y := w1; JMP(skip, w1);` | **3**: Demux(def) · Assign[y] ← Demux · Assign[jump] ← Demux | identical | clean |
| `y := c; JMP(skip, c);` | **2**: Assign[y] ← c · Assign[jump] ← c | identical | clean |
| `y := JMP(skip, t1(…).Q);` | 1: Assign[y] ← Assign[jump] ← box (jump nested under the coil) | identical | clean |
| `JMP(skip, (y := t1(…).Q));` | 1: Assign[jump] ← Assign[y] ← box (coil nested under the jump) | identical | clean |

The model the five shapes need is not new: the CODESYS writer already writes a Terminator value, `InputFlags`
negation and edges, and target `Negation` / `Rtrig` / `Ftrig` (`CodesysNetworkWriter`, S6), and the stored
counterparts were read from drawn projects above. What is missing is only the TEXT. Each candidate below builds one
of these existing models; step 2.1 proves each on the drawn samples (pull, push, pull identical, models equal).

## The principle

The text spells a flag where the model holds it. Today it can spell a flag on a NODE: `NOT a` (a leaf's negation),
`R_EDGE(x)` (a leaf's or a box's edge), and the coil kinds `S=` / `R=` on a TARGET. It cannot spell:

- **the rail as a node** (`Terminator`): it writes the operand `TRUE`;
- **a flag on a RECEIVER**: a box pin (`Input.Flags`), the EN pin (`Box.EnableFlags`), a coil target's negation or edge
  (`Operand.Flags`). It moves the flag onto the value;
- **a jump or return as one more TARGET of a coil's item** (`Assign.Targets` = `[y, skip(Jump)]`). It repeats the value.

So the five shapes are three gaps, and each gap gets one rule, valid wherever the model holds the fact.

## 1. The rail: `RAIL()`

Model: `Terminator` (Flags none) wherever a value stands.

| candidate | builds | plain ST | collision |
|---|---|---|---|
| **A. `RAIL()`**, an element function with no argument: `y := RAIL();` `t1(IN := RAIL(), PT := T#1S);` `w1 := RAIL();` | `Assign[y] ← Terminator`; the pin's value `Terminator`; `Demux(def) ← Terminator` | yes (a call) | none: `TRUE` stays the operand `TRUE` (the TRUE contact). A POU named `RAIL` in reach is refused by the rule every element head has (`RequireElementHead`) |
| B. Keep `TRUE` for the rail, give the TRUE contact another text (`BOOL#TRUE`) | `TRUE` → Terminator | yes | **yes**: an operand's text is its spelling; `BOOL#TRUE` stores the operand text `BOOL#TRUE`, and a drawn contact typed `True` would have no spelling. Rejected |

- LSP: `RAIL` joins `NETWORK_ELEMENTS`; a BOOL value, no argument.
- Exec twin: `RAIL()` → `TRUE`.
- **Recommendation: A, in every value position** (coil, pin, EN, wire, branch feed). Limited to coils it would be a
  rule with an exception, and the 4 wires and 52 pins on the rail would stay rebuilt as TRUE contacts.
- Counter-case: 52 drawn box pins now pull as `RAIL()` instead of `TRUE`. The text is noisier for a fact that does not
  change what runs.
- Grammar defect to resolve (owner): an unconditional jump or return is `Assign[jump] ← Terminator`, today `JMP l;`
  and `RETURN;`. With `RAIL()` a value, `JMP(l, RAIL())` is a second spelling of the same model. Either `JMP l;` /
  `RETURN;` go (they become `JMP(l, RAIL())` / `RETURN(RAIL())`, or under 5.B `JMP.l := RAIL();`), or `RAIL()` is
  refused as a jump's value, which is an exception. Recommendation: drop `JMP l;` / `RETURN;`. The empty item `;` (an
  item that is only the rail) stays, because there is no value position.

## 2. A negated box pin (and the EN pin, and pin edges)

Model: `Input(Formal, Value, Flags { Negated })`; for EN, `Box.EnableFlags`; the same slot holds `Rising` / `Falling`.

| candidate | builds | plain ST | collision |
|---|---|---|---|
| **A. A receiver function as the pin's whole value**: `t1(IN := NEGATED(a), PT := T#1S);` `MOVE(EN := NEGATED(c), …)`; edges `RISING(a)` / `FALLING(a)`; both `RISING(NEGATED(a))` (the IDE negates first, N17) | `Input(IN, Leaf a, Negated)`, the value unflagged | yes (a call) | none: `NOT a` stays the negated operand (the negated contact), `NOT(a)` the NOT box, `R_EDGE(a)` the edge contact |
| B. `NOT` on the formal: `t1(NOT IN := a)` (the v2 spelling) | the same | **no**: IEC permits `NOT` only on an output formal (`NOT Q => x`) | none |

- LSP: three new element heads. They are valid only as the whole value of a pin, EN or coil (section 3); anywhere else
  they are refused by name, as `JMP(…)` is outside a statement.
- Exec twin: `NEGATED(v)` → `NOT (v)`; `RISING(v)` / `FALLING(v)` → the `R_TRIG` / `F_TRIG` detector `R_EDGE` already uses.
- **Recommendation: A.**
- Counter-case: two texts now run the same and draw differently (`IN := NOT a` and `IN := NEGATED(a)`). That is the
  point, but an author has to know which picture they want. In FBD the two pictures look nearly alike.
- Names are an owner question (below). `NEGATED`, `RISING` and `FALLING` sit beside `NOT` / `R_EDGE` / `F_EDGE`, and the
  difference is only where the flag sits.

## 3. A negated coil `-(/)-`, and the rising/falling edge coils

Model: the target `Operand.Flags { Negated }` (the vendor's `Negation` without `Set`), or `{ Rising }` / `{ Falling }`.
These are flags on the target, and each target of a chained coil has its own.

| candidate | builds | plain ST | collision |
|---|---|---|---|
| **A. The same receiver functions, as the coil's whole value**: `y := NEGATED(a);` `y := RISING(a);` `y S= RISING(a);` | `Assign([y {Negated}], Leaf a)` | yes | none (`y := NOT a;` stays a negated contact, `y := NOT(a);` a NOT box) |
| B. A coil operator per target, beside `S=` / `R=`: `y /= a;` `y P= a;` `y N= a;` (IEC's `(/)`, `(P)`, `(N)` coils) | the same, per target | **no** | none |

- LSP / twin: as in section 2. **Measured semantics differ** (archived `network-text-st` 1.3: CODESYS runs an edge coil
  as a plain coil). So the twin's `RISING(v)` at a coil is `v`, and at a pin it is a detector (pin edges are
  unmeasured). One function with two meanings by position is an edge case, reported below. Step 2.1 measures both.
- **Recommendation: A**: one family for every receiver, plain ST, the same rule for pins and coils.
- Counter-case (B is exact where A is not):
  - A wraps the VALUE, and a chain has one value for several targets. So `y := x := NEGATED(a)` cannot say WHICH
    target is negated. A still refuses "a negated coil among several" (0 measured), which is a defect of A.
  - `y S= NEGATED(a)` names a model the vendor cannot hold: `Negation + Set` IS the reset coil (`Flags.CoilFromVendor`),
    so it must be refused, or it must read as `y R= a`, which is a second spelling. B has neither problem, because
    each target carries its kind (an enum, as the vendor encodes it), but it is not ST.

## 4. A coil sharing its value with a jump or return

Model: ONE item `Assign(Value v, Targets [y, skip{Jump}])` (target order as stored; TwinCAT's drawn rung stores the
jump first, `TcDrawnJumpTests`).

The leading candidate fails the check the brief asked for. **The reader cannot build one item from the wire form.**
Measured above, `w1 := v; y := w1; JMP(skip, w1);` already IS a spelling: a root Demux plus two items, which CODESYS
stores and builds clean. 13 drawn networks hold that same shape with coils (a wire read only by whole coils). A rule
that folds such a wire into one item gives one text two models. If the fold applies only when a jump reads the wire,
that is an exception, and it still folds a drawn Demux that feeds a jump. The repeated form `y := c; JMP(skip, c);` is
not one item either: it stores 2 (measured). So today even the repeatable case is a stored member, with no spelling.
The two nestings (`y := JMP(skip, v)`, `JMP(skip, (y := v))`) are taken too: each is a stored model of its own that
builds clean (measured).

| candidate | builds | plain ST | collision |
|---|---|---|---|
| A. The wire form `w1 := v; y := w1; JMP(skip, w1);` plus a fold rule | one item only by the fold | yes | **yes**: the Demux model above (measured; 13 drawn). Rejected |
| **B. The jump or return is a TARGET in the coil chain**, spelled where the model holds it: `y := JMP.skip := v;` `JMP.skip := y := v;` (the order is the stored target order) `y S= RETURN := v;` | `Assign(v, [y, skip{Jump}])`, in the written order | syntax yes (a chained assignment; `JMP.skip` is a member access). It uses the keywords `JMP` / `RETURN` as targets, the same licence `JMP(l, v)` takes | none, IF every jump is spelled this way (see the counter-case) |

- B is the coil rule applied to jumps. The lone jump is `JMP.skip := v;`. A jump inside a tree is `x := (JMP.l := a)`,
  as a mid-rung coil is `(x := a)`. The unconditional jump is `JMP.l := RAIL();` (section 1).
- B removes the writer's special cases: `Repeatable`, `Reads`, "coils first", and the two refusals in
  `StNetworkWriter.AssignItem`. Any value works, because it is written once.
- LSP: a target `JMP.<label>` is checked against the labels; `RETURN` as a target takes nothing.
- Exec twin: `t := v; y := t; IF t THEN JMP skip; END_IF;`.
- **Recommendation: B, replacing `JMP(l, v)`, `RETURN(v)`, `JMP l;` and `RETURN;`.** Kept beside them, the lone jump
  would have two spellings.
- Counter-case: it reverses the owner's 2026-10-28 choice of `JMP(label, value)`, and it moves the most familiar ST
  form, `RETURN;`, to `RETURN := RAIL();`. The alternative is to keep the current forms and leave this shape refused
  by name (0 in every corpus), which the "every shape" rule forbids.

## Grammar defects found (for the owner, not doc content)

1. `JMP l;` / `RETURN;` versus a rail value (section 1).
2. A receiver function on a chained coil cannot name its target, and `S= NEGATED(…)` names no vendor model
   (section 3, candidate A).
3. `RISING` / `FALLING` would run differently on a coil (as a plain coil, measured) and on a pin (a detector,
   unmeasured).
4. These already exist and are not new: the brackets in `NOT(a)` versus `NOT a`, and in `JMP(skip, (y := v))` versus a
   named argument `JMP(skip, y := v)`, carry the model.

Out of scope, but in the same family and still stored members: a negated box OUTPUT (`Box.Flags.Negated`, written as a
NOT box), and TwinCAT's empty-operand unconditional jump.

## Questions for the owner

1. Rail: `RAIL()` in every value position, with `JMP l;` / `RETURN;` dropped? (default: yes)
2. Receivers: plain-ST functions on the value (`NEGATED` / `RISING` / `FALLING`, defects 2 and 3), or per-target coil
   operators `/=` `P=` `N=` (exact, not ST) for coils plus functions for pins? Names? (default: the functions, these
   names)
3. Shared value: jumps and returns as chain targets (`y := JMP.skip := v;`), reversing `JMP(label, value)`? Or keep
   `JMP(…)` and leave the shape refused? (default: targets)

## Decided (owner, 2026-10-31)

1. **Jumps and returns are targets.** Every jump and return is an assignment target, with one spelling for all cases:
   `JMP.skip := v;` and `RETURN := v;`, and chained after coils, `y := JMP.skip := v;` (one stored item). This replaces
   `JMP(l, v)`, `RETURN(v)`, `JMP l;` and `RETURN;`, and it closes both writer refusals for a coil sharing its value
   with a jump. It also covers Sim-Assist's `network-jump-one-spelling`.
2. **Rail.** The owner prefers no extra function but requires 100% coverage. `RAIL()` is used only if no spelling
   without a function exists that builds the stored rail as distinct from a TRUE contact. Before building, that
   question goes to Sim-Assist (an editor consumer) for review.
3. **Negation and edges.** On pins they are functions: `NEGATED(a)`, `RISING(a)`, `FALLING(a)`. On coils the coil kind
   is the assignment operator, as `S=` and `R=` already are: `y /= a;`, `y P= a;`, `y N= a;`.

## Measured 2026-10-31 (joint review with Sim-Assist)

Live CODESYS 3.5.21.40 64-bit (`ide.ps1 -Run nrpm`, CodesysTestProject fixture copy). A throwaway e2e probe pushed
each text into a new FB, pulled it, built it (instantiated from PLC_PRG, so the build compiles it), exported the IDE's
own native archive, and took the editor's picture (`DrawToBitmap` of the opened view). A shape the text cannot spell
was made by editing the pushed network in-proc (object manager checkout, `BoxTreeBox.SetInputTree`, `SetInputFlag`,
the target's `Flags.Negation`), then committed, and the pull/rebuild repeated on it. Corpus counts are the five
CODESYS archives (`test/fixtures/nwl-corpus/*.nwl.xml`, 388 networks).

**Probe fault, found and fixed (owner report).** The first in-proc edits raised a MODAL dialog on the commit:
`Internal error while object 'VltE2E_np_q1_fbd_rail' is providing language model information: Object reference not
set to an instance of an object.` (read by UI Automation; reproduced on `VltE2E_np_q1_ld_rail`). Cause: a node created
and set into an attached tree keeps `Id = -1` (the IDE numbers what its editor or a fresh network adds; re-appending
the tree does not renumber it), and CODESYS cannot build the language model of a body holding an Id of -1. It is a
probe fault, not a model CODESYS refuses: given a unique Id, the same models commit, build clean and draw, with no
dialog (a UI Automation watcher on the IDE saw none in the re-run). Every result below is from the re-run; the
first run's results were discarded.

### 1. The rail versus an unconnected input — DISTINCT stored models

| text pushed / shape made | stored at the pin | picture | build | pulls as |
|---|---|---|---|---|
| `y := t1(PT := T#1S).Q;` (IN omitted) | `BoxTreeOperand`, operand text `""` | an empty box at IN (`???`) | clean | `t1(PT := T#1S)` (stable) |
| TON IN set to the rail (LD) | `BoxTreeTerminator` (`Input` null) | IN wired to the left rail | clean | `t1(IN := TRUE, …)` |
| `y := t1(IN := TRUE, …).Q;` | `BoxTreeOperand` `TRUE` | a contact-less `TRUE` operand | clean | as pushed |
| EN set to the rail (LD, `MOVE`) | `BoxTreeTerminator` | EN on the rail | clean | `MOVE(EN := TRUE, …)` |
| EN set to an empty operand (LD and FBD) | `BoxTreeOperand` `""` | empty EN | **refused**: `Cannot convert type 'Unknown type: ''' to type 'BOOL'`, `Identifier '' not defined` | `%UNSUPPORTED "an empty operand"` |

- On a named pin, the rail and the unconnected input are two classes, drawn differently. They also run differently:
  the rail feeds TRUE every scan, the unconnected FB input keeps its value (measured 2026-10-27, `StNetworkWriter`).
- On EN there is no valid unconnected form: an empty EN operand does not build. The rail is the only drawn
  "nothing wired" on EN (36 in the corpus).
- Sim-Assist's spellings, pushed today: `y := t1(IN := , PT := T#1S).Q;`, `y := ;` and
  `x := MOVE(EN := , 5, OUT => n).ENO;` are each refused `NETWORK_PARSE` ("an operand at …").
- **Recommendation: not safe as THE rail spelling on a named pin.** `IN := ,` already is ST. CODESYS builds
  `t1(IN := , PT := T#1S);` in a plain ST POU (measured, clean). The LSP parses it as an input "routed from nowhere"
  (`parse/postfix.ts`), which is the unconnected input, not the rail. Spelled as the rail, one text would mean TRUE
  in a network and "not passed" in ST, which the LSP and the exec twin read as ST.
  - A forgotten operand: today it is a `NETWORK_PARSE` refusal. Under the empty value it becomes the rail, an input
    or EN that is always TRUE, with no diagnostic.

### 2. The corpus's rail-fed pins and wires pull LOSSILY — today's writer spells the rail `TRUE`

The rail-fed pins are 43, not 52: 36 EN plus 7 data pins. The 7 are all named first inputs: an FB's `IN`, `WSM`'s
first pin, and five functions' first pins. No positional operator pin is fed by the rail. All 4 wires and all 3
coils hold the rail too, so 50 Terminators in all.

Measured round trips (each is pull, recreate from the pulled text, export):

| rail at | pulled | rebuilt model |
|---|---|---|
| FB pin (LD, FBD) | `t1(IN := TRUE, …)` | `BoxTreeOperand TRUE` |
| EN | `MOVE(EN := TRUE, …)` | `BoxTreeOperand TRUE` |
| operator pin | `AND(a, TRUE)` | `BoxTreeOperand TRUE` |
| wire | `w1 := TRUE;` | `Demux ← BoxTreeOperand TRUE` |
| coil | `y := TRUE;` | `Assign ← BoxTreeOperand TRUE` |

Every build was clean, before and after. **Lossy**: the Terminator becomes an operand `TRUE` (another class, another
picture: an operand box instead of a wire to the rail). It runs the same. The pull, push, pull loop is a fixed
point on the wrong model.

**Recommendation:** every one of these needs a rail spelling that is not `TRUE`.

### Scope (a): where a Terminator sits in the corpus model

| position | Terminators | named / positional |
|---|---|---|
| `Assign.RValue`, a coil | 3 | (no slot) |
| `Assign.RValue`, a jump or return | 0 (the 1 return holds an operand) | (no slot) |
| `Box` EN (input slot 0 with `EN` shown) | 36 | named (`EN :=`) |
| `Box` data pin, FB | 2 | named (`IN`, `WSM` slot 0) |
| `Box` data pin, function | 5 | named (slot 0, `iEN` / `i_xEnable`) |
| `Box` pin of an operator (`AND`, `ADD`, …) | 0 | (positional) |
| `Demux.Input`, a wire definition | 4 | (no slot) |
| `Parallel.Input` (feed) · a `Parallel` branch arm | 0 · 0 | (positional) |
| a root item · a box output · `Terminator.Input` | 0 · 0 (schema: `OutputItems` holds `Operand` or null) · 0 | none |

### Scope (b): positional empties

- `x := AND(a, );` and `n := ADD(n, , 1);` are refused today (`NETWORK_PARSE`). They are not ST either: the
  LSP's ST parser (`parse/postfix.ts`) refuses a positional empty with "Expression expected", as CODESYS does.
- A Terminator set at `AND` slot 1 (made in-proc, LD and FBD) **stores** as `BoxTreeTerminator`, builds clean, and
  pulls as `AND(a, TRUE)`, which is lossy as in 2. So `AND(a, )` would be a distinct model, not one in the corpus
  (0).
- `x := BRANCH(FEED := c, a, );` is refused today (`NETWORK_PARSE`). A branch arm that is only the rail is in no
  corpus body (0). It was not built live: the `Parallel` has no in-place arm setter the probe found.
- **Recommendation:** the empty value is non-ST in every positional slot, so a forgotten operand there is
  indistinguishable from an intended rail.

### Scope (c): an empty `=>`

No Terminator sits on an output: the schema's `OutputItems` holds an `Operand` or null. An unwired output is
spelled by leaving the `=>` out (null 485, empty operand 279). In ST, `out => ,` is the same "not connected" (LSP
`parse/postfix.ts`). So an empty `=>` would be a second spelling of an omission. **Refusing it by name is consistent;
confirmed.**

### 3. FBD negations — four distinct stored models, four pictures

| text | stored | picture |
|---|---|---|
| `x := NOT a;` | `Assign ← BoxTreeOperand a`, the operand's `Flags.Negation` | `a ○── x`: circle on the source side |
| `x := NOT(a);` | `Assign ← BoxTreeBox NOT` | a NOT box |
| `x := AND(NOT a, b);` | the operand `a` negated, `InputFlags` null | circle next to `a`, apart from the box |
| pin negation (made in-proc) | `InputFlags[0].Negation`, operand plain | circle ON the box's pin edge |
| `x := AND(NOT(a), b);` | a NOT box feeding the pin | two boxes |
| target negation (made in-proc) | the target `x`'s `Flags.Negation` | `a ──○ x`: circle on the target side |
| LD `x := AND(NOT a, b);` | a negated contact (operand flag) | `-|/|-` |

- `x := NOT a` builds an **operand negation**, which is neither a NOT box nor a target negation. Its circle sits
  after `a`, at the assignment's input. So Sim-Assist's FBD drawing of `x := NOT a` (a mark on the assignment
  input) is right. The target negation's mark sits at `x`.
- **Today both flags written on a receiver are lossy**, and each build is clean:
  - The target negation pulls as `x := NOT a;` and rebuilds as an operand negation; the diff of the two archives
    moves `Flags=1` from `x` to `a`.
  - The pin negation pulls as `AND(NOT a, b)` and rebuilds with `InputFlags` null and the operand negated.
- **Recommendation:** the decided spellings hold. `x /= a` is the target negation, `NEGATED(a)` the pin flag, and
  `NOT a` stays the operand. In FBD, the pin flag and the operand flag look nearly alike (a circle on the pin
  versus a circle beside the operand). An editor should draw them apart.

### 4. Plain CODESYS ST (a small FB per text, built alone)

| text | build |
|---|---|
| `x S= a;` · `x R= a;` · `JMP skip; … skip: y := b;` | clean |
| `t1(IN := , PT := T#1S);` | clean |
| `x /= a;` | `'((x / !!!'ERROR'!!!) = a);' is no valid statement`, `Expression expected instead of '='` |
| `JMP.skip := a;` | `Invalid destination . for JMP`, `';' expected instead of 'skip'`, `No such label 'INVALID: .'` |
| `y := ;` | `Expression expected instead of ';'` |
| `IF s=0 THEN …` / `y := p=0;` / `b := n=0;` (`s`, `p` INT) | `s` fails as a name, already at its declaration (`Unexpected token 's'`, …), and `Expression expected instead of 's='`. `p=0` and `n=0` build. |

- CODESYS lexes `S=` and `R=` with no context: a variable `s` is unusable, and `s=0` is the set operator. `P` and
  `N` are ordinary names: `n=0` is a comparison.
- **Recommendation:**
  - The coil operators `/=` `P=` `N=` and the targets `JMP.l :=` / `RETURN :=` are network-text grammar, not ST.
  - So are the empty values `y := ;` and `AND(a, )`.
  - An unconnected named pin, `IN := ,`, is ST and builds.

### 5. LSP lexer and parser (`packages/volt-lsp-iec/src/frontend/syntax`, read only)

- **`/=`.** It is not in `MULTI_CHAR_PUNCT` (`lex/prefixes.ts`), so it lexes as `/` then `=`. No valid ST holds
  `/=`, so a new two-character token collides with nothing. `assignOpOf` (`parse/statements.ts`) and
  `parseBracketed` (`parse/expression.ts`) need to accept it.
- **`P=` / `N=`: collision.** `S=` / `R=` / `REF=` are made in the LEXER, context-free: a word that is exactly the
  stem, then `=` (`lex/words.ts`). The same rule for `P` / `N` would turn valid ST such as `b := n=0;` into an
  assignment operator. CODESYS reads that line as a comparison (measured above). The operator has to be recognized
  in the PARSER, only where an assignment operator stands: after a complete target, the word `P` / `N` followed by
  `=`. Not in the lexer.
- **`JMP.skip :=`.** `JMP` is a keyword. `parseJmp` takes `.` as the start of its destination expression, which is a
  parse error today, so the form needs a new branch there.
- **`RETURN := v`.** The `RETURN` case calls `endStatement` and wants `;` next.
- **No lexer collision for either form**, because neither is valid ST today (measured).
- **The empty value.**
  - `y := ;` and `F(a, )` are parse errors in the ST front-end, as in CODESYS.
  - `IN := ,` already parses, as an unconnected input. Giving it the rail meaning is the one place where the
    network text would change what a valid ST text means.

### The rail verdict

**No: the empty value is not safe as THE rail spelling.** The models are distinct (1), but the empty value
collides on a named pin:

- **`IN := ,`.** It is already ST for an unconnected input: CODESYS builds it, and the LSP reads it so.
  Network text spells the unconnected pin by omission, so the rail would give that text a second meaning.
- **Elsewhere** (coil, wire, EN, positional pin, branch arm, jump/return) the empty value is not ST, so it
  collides with nothing. It is one more non-ST form, beside `/=` and `JMP.l :=`.
- **Everywhere**, a forgotten operand stops being a parse refusal and becomes a TRUE rail with no diagnostic.

With `RAIL()` dropped, the remaining choice is the owner's (see the leftovers below).

## The model table (one spelling per stored node or flag)

The table is built from the model (`Format/Network/NetworkModel`, the NWL archive members), not from the text. Counts
are from the CODESYS corpus, 388 networks. Spellings are the decided ones. "∅" is the empty value proposed for the
Terminator.

| stored node / flag | where it occurs (parent · slot) | corpus | spelling |
|---|---|---|---|
| `Network.Title` | network | 260 | `%NETWORK "title"` |
| `Network.Comment` | network | 20 | `// …` lines |
| `Network.Label` | network | 0 | `l:` first statement |
| `Network.OutCommented` | network | 3 | `%DISABLED` |
| `Assign` | root 478 · EN 1 · FB pin 3 · operator pin 2 | 484 | `t := v;` at a root, `(t := v)` nested |
| `Assign`, several targets | root | 40 | the chain `a := b := v` (stored order) |
| target Flags none | `Assign.OutputItems` | 328 | `:=` |
| target `Set` | `Assign.OutputItems` | 118 | `S=` |
| target `Negation+Set` (reset) | `Assign.OutputItems` | 128 | `R=` |
| target `Negation` | `Assign.OutputItems` | 0 (TwinCAT 2, Sim-Assist 3) | `/=` |
| target `Rtrig` · `Ftrig` | `Assign.OutputItems` | 0 · 0 (TwinCAT 3 edge coils, both kinds together) | `P=` · `N=` |
| target `Jump` | `Assign.OutputItems` | 0 | `JMP.l :=` |
| target `Return` (text `???`) | `Assign.OutputItems` | 1 | `RETURN :=` |
| `Leaf` (`BoxTreeOperand`) | every value slot | 2918 | the operand text |
| `Leaf` with text `""` | named FB pin 187 | 187 | the pin left out |
| `Leaf` with text `""` | root | 1 | the empty item `;` |
| `Leaf.Flags` `Negation` | AND/OR pin 343 · function pin 5 · FB pin 4 · wire 4 · EN 1 · coil 1 · arm 1 | 359 | `NOT a` |
| `Leaf.Flags` `Rtrig` · `Ftrig` | EN | 1 · 0 | `R_EDGE(a)` · `F_EDGE(a)` |
| `Box`, FB with an instance | every value slot | (in 1300) | `inst(…)` |
| `Box`, FB with no instance (`???`) | | 4 | `T(…)` (its type) |
| `Box`, function · operator | | (in 1300) | `F(…)` · `AND(…)` |
| `Box.STSnippet` (Execute) | | 11 | `EXECUTE(EN := e, CODE := '…')` |
| `Box.En` (EN shown), slot 0 | | 224 | `EN :=` first |
| `Box.Eno` (ENO shown) | | 184 | `.ENO` |
| `Box` output with a variable | `OutputItems` | 221 | `NAME => v` |
| `Box` output null or `""` | `OutputItems` | 485 · 279 | no `=>` |
| `Input.Flags` `Negation` | box pin | 6 | `NEGATED(a)` |
| `Input.Flags` `Rtrig` · `Ftrig` | box pin | 0 · 0 | `RISING(a)` · `FALLING(a)` |
| `Box.EnableFlags` `Negation` · `Rtrig` · `Ftrig` | EN slot | 0 · 0 · 0 | `EN := NEGATED(c)` · `RISING(c)` · `FALLING(c)` |
| `Demux` definition · reference | wire | 139 · 434 | `w := v` · `w` |
| `Parallel` `BoxShortCircuit` · `Sequential` | | 16 · 1 | `BRANCH_SHORTCIRCUIT(…)` · `BRANCH(…)` |
| `Parallel.Input` (feed) | | 12 (5 without) | `FEED :=` first |
| `Terminator` | coil 3 · EN 36 · named pin 7 · wire 4 (none elsewhere, see (a)) | 50 | ∅: `y := ;` `IN := ,` `EN := ,` `w := ;` |

**Both ways.** Every node class and every flag value in the corpus has a row. The node classes are `BoxTreeAssign`,
`BoxTreeBox`, `BoxTreeDemux`, `BoxTreeOperand`, `BoxTreeParallel` and `BoxTreeTerminator`. The nonzero flags are
target none / Set / Negation+Set / Return, `Leaf` Negation / Rtrig, and `InputFlags` Negation. No `Assign.Flags`,
`Box.Flags`, box output flag or `Terminator.Flags` is nonzero in the corpus.

Two rows share a spelling:

- **`;`**: the empty item, a root `Leaf ""` (1). A root `Terminator` (0) is written `;` too (`StNetworkWriter`), so
  there are two models for one text.
- **`IN := ,` versus the pin left out**: an unconnected named FB pin is ST's `IN := ,` (verdict above). If ∅ is the
  rail, two texts name different models, and ST's own meaning is the third.

**Leftovers, for the owner** (no spelling, or a defect of the row):

1. **The rail on a named pin**: ∅ collides with ST's `IN := ,`. No collision-free non-function spelling has been
   found.
2. **The root `;`**: an empty-operand item versus a rail-only item. One of them needs another text, or one is
   refused by name.
3. **`Box.Flags.Negated`, a negated box OUTPUT**: 0 in the corpus. Today it is written as a NOT box, which is lossy.
4. **A box output operand's flags**: 0. No spelling.
5. **`Terminator.Flags`**: 0 in the corpus, but N41 measured `x := NOT ;` storing and writing TRUE. No spelling under
   ∅ (`NOT` before nothing).
6. **`Assign.Flags`** (the item's Jump/Return cache, C13): 0 nonzero. Derived from the target, so it needs no
   spelling. Confirm that it is not a member.
7. **TwinCAT's empty-operand unconditional jump**: an `Assign ← Leaf ""` with a Jump target, where CODESYS stores a
   Terminator. Under `JMP.l := ;` the two vendors' models share one text.
8. **Target flag combinations**: `Set+Rtrig`, `Negation+Rtrig` and others. One operator per target spells one
   value; a combination has no row.
9. **An unconnected EN (`""`)**: it does not build (measured), so it needs no spelling. It is refused by name today
   (`%UNSUPPORTED "an empty operand"`).
10. **An empty operand on a function pin**: 0 in the corpus, refused today. Unmeasured.
11. **An empty `Parallel` arm**: N41 found that it stores. Its stored form (Terminator, `Leaf ""` or none) was not
    re-measured here.

## Joint proposal (Volt + Sim-Assist, 2026-10-31) — APPROVED by the owner the same day

- **The rail is `RAIL`.** A bare keyword, written like `TRUE` (not a call), is the only spelling of a `Terminator` in
  every slot: `y := RAIL;`, `t1(IN := RAIL)`, `MOVE(EN := RAIL, …)`, `w1 := RAIL;`, `JMP.skip := RAIL;`. An identifier
  named `RAIL` is refused, as `R_EDGE` is. An unconnected pin stays omitted; `IN := ,` is refused by name. A forgotten
  operand stays a parse error. The empty value was measured out: `IN := ,` is ST for "unconnected".
- **Jumps and returns are targets** (decided): `JMP.l := v;`, `RETURN := v;`, `y := JMP.l := v;`. They take only `:=`;
  any other operator is refused by name.
- **Pins** use functions (`NEGATED`, `RISING`, `FALLING`; `NOT a` stays the operand negation). **Coils** use operators
  (`/=`, `P=`, `N=`, recognised only at a statement's target, because `n=0` is a comparison).
- **Refused by name until seen in a corpus:**
  - a rail-only item with no target (leftover 2);
  - a negated box output (3). `NEGATED(F(…))` collides with a negated pin fed by `F`;
  - combined target flags (8).
- **One text, one stored form per vendor:** TwinCAT's empty-operand jump and CODESYS's Terminator jump (7).
- **Docs:** a contact / pin / coil × plain / negated / rising / falling table at the top of `network-text.html`.

## Measured 2026-10-31 (mark family)

The method was the same as the joint review's: live CODESYS 3.5.21.40 64-bit (`ide.ps1 -Run mfam`, a fixture copy).

- A throwaway e2e probe pushed each text into a new FB and read the stored tree in-proc through the object manager.
- It built the FB, instantiated from PLC_PRG, and pulled it.
- It drew the editor (`IFrame.OpenEditorView`, then `DrawToBitmap`).

A shape the text cannot spell was made by setting a flag on a node that a push had already built:

- a pin or EN: `SetInputFlag`;
- a coil or output operand: its `Flags`;
- a box: `Box.Flags`.

The probe created no node, so no Id was minted. A UI Automation watcher on the IDE saw no dialog. "Builds" means a clean build. Running these shapes was not measured.

### 1. `NOT a` and `NOT(a)` are two stored models, in LD and in FBD

| text (LD and FBD alike) | stored | pulls as today |
|---|---|---|
| `x := NOT a;` (coil value) | `Assign ← Op a[Negation]` | as pushed |
| `x := NOT(a);` · `x := NOT (a);` | `Assign ← Box NOT(Op a)` (`CallType Not`) | `x := NOT(a);` |
| `x := NOT (a OR b);` | `Box NOT(Box OR(a, b))` | `x := NOT(a OR b);` |
| `x := AND(NOT a, b);` (operator pin value) | `Op a[Negation]` at the pin, pin flags 0 | as pushed |
| `x := AND(NOT(a), b);` | a NOT box at the pin | as pushed |
| `y := t1(IN := NOT a, …).Q;` (FB pin value) | `Op a[Negation]`, pin flags 0 | as pushed |
| `y := t1(IN := NOT(a), …).Q;` | a NOT box at the pin | as pushed |
| LD `x := NOT a AND b;` | contact `a[Negation]` | as pushed |

- Both forms build. They are distinct models with distinct pictures (section 3 of the joint review: a circle against a box).
- At run time they compute the same value. The model is all that differs: a flag on the leaf against a node of its own.
- The writer spells each model with one text today. A leaf negation is `NOT a`. A NOT box is `NOT(…)`.
- **Spacing does not matter.** Both readers read a word followed by a `(` token as a call: C# `KeywordCallHead`/`Unary` (`StNetworkReader.cs:686-704`), the LSP `isKeywordCallHead` (`plain-st.ts:362-371`). So `NOT (a)` and `NOT (a OR b)` are the NOT box, and pull back as `NOT(…)`.
- **Corpus.**
  - Leaf `Negation`: 359.
  - NOT box (`BoxType NOT`, `CallType Not`): 3, all in lenze-mid.
  - Every NOT box negates a node that has no negation flag of its own: two `R_TRIG` outputs and one wire. A Demux carries no flags.
  - `Box.Flags.Negated` occurs 0 times. So the NOT box is the only spelling those 3 networks have.

**The owner's question: should the mark always be written `NOT(a)`?**

- **(A) `NOT a` is the mark and `NOT(a)` is the box.** This is today's form. Each model keeps its own text, and both texts are ST.
- **(B) `NOT(a)` is the mark.** The box then needs a name other than its stored `BoxType` `NOT`. That breaks "every box is a call of its type". It also gives `NOT(a)` a meaning that ST does not have, since in ST `NOT(a)` and `NOT a` are one expression.
- **(C) Interchangeable?** Only at run time. The drawings differ, and so do the node classes, so a 1:1 text must tell them apart.

**Recommendation: (A).**

- Counter-case: `NOT a` and `NOT(a)` differ only by brackets.
  - An ST habit of writing `NOT(a)` gets a NOT box. It runs the same and draws as a box.
  - The value mark `NOT a` is a prefix while `RISING(a)` is a function. NOT is the one mark that ST already owns as an operator.

### 2. Every row of the family stores, builds, and draws its own mark

The table shows the flag set on a pushed plain shape, then what is stored, how CODESYS draws it, and the text the writer gives today. Every row builds clean in LD and in FBD.

| family text | stored | drawn | today's pull |
|---|---|---|---|
| `x := RISING(a);` · `FALLING(a)` (value; today `R_EDGE`/`F_EDGE`) | `Op a[Rtrig]` · `[Ftrig]` | an LD P/N contact | `R_EDGE(a)` (lossless) |
| `t1(NOT IN := a, …)` | `InputFlags[IN] = Negation`, operand plain | a circle ON the IN pin (FBD) | `IN := NOT a` (**lossy**) |
| `t1(RISING IN := a, …)` · `FALLING` | `InputFlags[IN] = Rtrig` · `Ftrig` | an edge triangle on the IN pin (LD, FBD) | `IN := R_EDGE(a)` (**lossy**) |
| `MOVE(NOT EN := c, …)` · `RISING EN` · `FALLING EN` | `InputFlags[0]` (EN) Negation · Rtrig · Ftrig | a circle or triangle on EN | `EN := NOT c` · `R_EDGE(c)` (**lossy**) |
| `NOT y := a;` | the target `y[Negation]` | FBD `a ──○ y`, LD `(/)` | `y := NOT a;` (**lossy**) |
| `RISING y := a;` · `FALLING y := a;` | `y[Rtrig]` · `y[Ftrig]` | an LD `(P)` · `(N)` coil | `y := a;` (**lossy: the edge is dropped**) |
| `NOT y := RISING x := a;` (chain) | `Assign ← a → y[Negation], x[Rtrig]` | | `%UNSUPPORTED "a negated coil among several"` |
| `t1(…, NOT Q => x)` | output operand `x[Negation]` | a circle on Q, with x on it | `%UNSUPPORTED "a modifier on an output pin"` |
| `t1(…, RISING Q => x)` · `FALLING` | output operand `x[Rtrig]` · `[Ftrig]` | | `%UNSUPPORTED` (same) |
| a negated box output, read: `y := NOT t1(…).Q;` (proposed below) | `Box.Flags.Negated` on the TON, `y` plain | a circle on Q, wired on to y | `NOT(t1(…).Q)` (**lossy**: rebuilds as a NOT box) |
| the same on an AND box (FBD) | `Box AND[Negation]` | | `NOT(AND(a, b))` (**lossy**) |
| combined `NOT RISING y := a` (refused by name) | `y[Negation+Rtrig]` | | `y := NOT a;` (**lossy**) |
| combined `RISING y S= a` (refused by name) | `y[Set+Rtrig]` | | `y S= a;` (**lossy**) |

- **The negated output pin and the negated box output are two models.**
  - The output pin's flag sits on the output operand: `NOT Q => x`.
  - The box output's flag sits in `Box.Flags`, on the value the tree consumes.
  - They are drawn alike: a circle on Q.
- **A combined mark stores and builds** (`Negation+Rtrig`, `Set+Rtrig`). Refusing it by name is the owner's choice (joint proposal), not a CODESYS limit.
- **An edge mark on an output stores and builds** (`x[Rtrig]`, `x[Ftrig]`). Refusing it is likewise a choice. The receiver rule spells it with no new word: `RISING Q => x`.
- **`NOT y S= a` must be refused.** `Negation+Set` is the stored reset coil, which `y R= a` already spells.
- **CODESYS ST is not the reference for the receiver marks.** A plain ST FB built alone refuses both:
  - `t1(…, NOT Q => x);`: `',' or ')' expected instead of '=>'`.
  - `t1(NOT IN := a, …);`: `'NOT(IN)' is no valid assignment target`.

  IEC 61131-3 has `NOT Q => x`, but CODESYS ST does not. Both receiver marks are network-only syntax, as `/=` was.

### 3. Parser feasibility (code read, nothing changed)

**A pin mark: `NOT IN := a`, `RISING IN := a`, `NOT Q => x`.**

- A fixed lookahead of three tokens is enough: the mark word, a name, then `:=` or `=>`.
- C# `Args` checks only "an Ident, then `:=` or `=>`" (`StNetworkReader.cs:758`, `:766`). Today it reads `NOT IN` as a value and then fails at `Expect(")")`.
- The LSP `parseCallArg` needs `atNameStart` (`postfix.ts:194-196`), so the argument falls through to the expression path.
- No pin can be named NOT, because NOT is a keyword in both readers.

**A coil mark: `NOT y := a;`, `RISING y := a;`.**

- Neither is ST, so neither collides with a valid statement. The LSP refuses `NOT x;` at the start of a statement (`statements.ts:197`, recording `stmt_bare_not`).
- The target can be a full `s.x[i]`, so it must be parsed whole before the operator is examined. One token of lookahead is not enough.
  - C#: `TryOperandSpan` (`:788-823`) looks ahead without consuming, so a new branch at the head of `Statement`, and in the target loop of `AssignTail` (`:607-622`), is enough.
  - The LSP: `parseExprOrAssign` parses an expression and then looks for `:=` (`:253-257`). With the line-197 refusal lifted in a network body, `NOT y := a` already parses as an assignment to `unary(NOT, y)`. The chain loop (`:268-274`) already accepts `y := NOT x := a`.
  - The LSP's `unaryOp` knows `-`, `+` and NOT (`precedence.ts:48-49`). `RISING`/`FALLING` need a network-only prefix, or a token rewrite in `plain-st.ts` like the one for `JMP(`.
- **Value or receiver?** After the mark and a whole operand:
  - an assignment operator (`:=` `S=` `R=` `=>`) makes it a receiver mark;
  - anything else makes it the value mark: `NOT y` gives a leaf flag, and `NOT t1(…).Q` gives `Box.Flags`.
  - A `(` straight after the word makes it a call: the NOT box, or the value function `RISING(…)`.
  - No receiver starts with `(`, so the three cases never overlap.
- **A variable named RISING or FALLING.**
  - `RISING := a` (a variable `RISING` as the target) is told apart from `RISING y := a` by the token after the word.
  - A value read `y := RISING;` is not told apart. So RISING and FALLING become network-reserved, refused when declared in reach, like `R_EDGE`/`RAIL` today: C# `ElementHead`/`InReach` (`:949-955`), the LSP `NETWORK_ELEMENTS` (`types/names.ts:56`).

**A named adjustment: the mid-rung NOT.**

- `y := NOT (x := a)` is a NOT box whose argument list holds a named pin `x`, because a word followed by `(` is a call. Pushed today, it is refused: `NETWORK_UNSUPPORTED "a NOT box with pins"` (measured, LD and FBD).
- The writer's form is `y := NOT((x := a));`, the nested assignment bracketed as a positional argument. It stores as `Box NOT(Assign(a → x))`, builds, and round-trips (measured).
- So the scenario is `NOT((x := a))`, not `NOT (x := a)`.

### Scenarios, as measured

- The chain `y := NOT x := a`: the mark binds to its target `x` only. It stores `[y plain, x Negation]`, distinct from `y := NOT x` (a value).
- The round trip `NOT y := RISING x := a`: it stores `y[Negation], x[Rtrig]` in text order and builds. Today it pulls as `%UNSUPPORTED`.
- The mid-rung NOT: `y := NOT((x := a))` round-trips. The form `NOT (x := a)` is refused (above).
- `NOT y S= a` is refused by name: `Negation+Set` is `R=`.
- `RISING y S= a` is refused by name (combined marks). It stores `Set+Rtrig` and builds.
- An edge mark on an output: the IDE stores it. Refusing it is a choice, and `RISING Q => x` would spell it.
- RISING and FALLING are reserved in network bodies, like `RAIL` and `R_EDGE`.

### Word census: the syntax list and the function list

The owner's rule (2026-10-31): a network-only function name costs nothing, because its meaning is ours and stated in the "what it runs as" table. What should be minimal is syntax that is not a call and not ST. Corpus counts are for the 388 CODESYS networks.

**Syntax** (forms that are not a call; the ones already in CODESYS ST are marked):

| form | stored model | corpus |
|---|---|---|
| `NOT a` (ST), as a value mark on a leaf, or on a box read in place (`NOT t1(…).Q`) | `Leaf.Flags` / `Box.Flags` `Negation` | 359 / 0 |
| a receiver mark, `NOT`, `RISING` or `FALLING` before a pin formal, an output formal or a coil target. One rule and three words, the same ones the value side uses | `Input.Flags`, `EnableFlags`, output-operand flags, target flags | 6 + 0 + 0 + 0 |
| `S=` / `R=` (ST) | target Set / Negation+Set | 118 / 128 |
| `JMP.l :=` / `RETURN :=` (decided, a target form) | target Jump / Return | 0 / 1 |
| `VAR_TEMP w1 : ANY; END_VAR` | Demux (wire) | 139 defined, 434 read |
| `.ENO`, `OUT =>` on a function | `Box.Eno`, an unnamed output slot | 184 / (uncounted) |
| `%NETWORK` / `%DISABLED` / `%UNSUPPORTED` lines | network, `OutCommented`, refusal | 388 / 3 / (n/a) |

**Functions** (network-only names, reserved in network bodies):

| function | stored model | corpus |
|---|---|---|
| `NOT(…)` (ST's own box) | Box `NOT` | 3 |
| `RISING(v)` · `FALLING(v)` (rename `R_EDGE`/`F_EDGE`) | `Leaf`/`Box` `Rtrig` · `Ftrig` | 1 · 0 |
| `RAIL()` | Terminator | 50 |
| `BRANCH(FEED := f, …)` · `BRANCH_SHORTCIRCUIT(…)` | Parallel, Mode Sequential · BoxShortCircuit | 1 · 16 |
| `EXECUTE(EN := e, '…')` | `Box.STSnippet` | 11 |

**The reduction candidates:**

- **Drop `ANY`: no.**
  - The Demux stores no type (`<o t="BoxTreeDemux" VarId= Id=>`), so a declared type would be a fact Volt infers, not one CODESYS stores.
  - The archived ld-fbd-coverage census found 6 wires whose type cannot be inferred, among them the 4 rail-fed ones. That is the exec twin's refusal #1. They would be unspellable.
  - `ANY` is the one honest declaration.
  - **Separately, `VAR_TEMP` is misleading.** A wire read above its definition gives the previous scan's value. The twin declares wires `VAR` for that reason (`network-twin.ts:58`, measured 2.3), while ST's `VAR_TEMP` holds nothing across scans. This is a defect in the grammar, for the owner. `VAR` would say what the twin runs.
- **Drop `FEED`: no.**
  - An unfed Parallel (`Input` null, 5) and one fed by `RAIL()` (a Terminator: 0 in the corpus, refused by name today) are distinct models.
  - A first positional slot cannot tell "no feed" from "the first arm".
  - `FEED :=` is a named pin of a function, which is not syntax.
- **`a OR b` against `BRANCH(a, b)`: two models, not two spellings.**
  - Infix `OR` is an OR contact box: 182 in lenze-mid.
  - `BRANCH` is a `BoxTreeParallel`: 17.
  - Both stay.
- **BRANCH and BRANCH_SHORTCIRCUIT** are one node with a `Mode` flag. They could become one function with a mode argument, but that adds a pin name and saves no syntax. Two function names cost nothing under the owner's rule. `OR_ELSE` is binary and has no feed, so it cannot carry the n-ary branch.
- **Drop the `CODE` name: possible.**
  - The Execute box takes no other pin or instance (`StNetworkWriter.cs:798-799`), so `EXECUTE(EN := e, '…')` with a positional string collides with nothing.
  - The LSP's `codeAt`/`takeCode` (`plain-st.ts:217-219`) key on `CODE :=` and would change.
- **`R_TRIG a` / `F_TRIG a` as the edge marks: no.**
  - `R_TRIG` is a Standard FB type that is in reach in every project. Its unnamed box is spelled `R_TRIG(…)`: 18 R_TRIG and 4 F_TRIG boxes are in the corpus, 4 FB boxes have no instance.
  - So the mark and an FB box with state would differ by a bracket, and the in-reach refusal would fire on every use.
  - `RISING`/`FALLING` cost two reserved function names and no syntax.
- **`JMP`, `RETURN`, `S=`, `R=`, `NOT`, `VAR_TEMP` stay**, all ST words. `RAIL()` is a function, not the bare literal, so it adds no syntax.

### Verdict (mark family)

**Possible, with two named adjustments.** Every row of the family is a distinct stored model, measured live in LD and FBD:

- the value side: a leaf or box flag;
- the receiver side: a pin's `InputFlags`, `EnableFlags`, an output operand's flags, a target's flags.

Each stores, builds, and draws its own mark. Today's writer loses every receiver row: it pulls them as value marks, drops them, or writes `%UNSUPPORTED`. The family makes them lossless with no new word: NOT, RISING and FALLING are a function or prefix on the value and a prefix on the receiver.

Both readers can parse it without ambiguity:

- a `(` after the word is a call;
- an assignment operator after the whole operand is a receiver mark;
- anything else is a value mark.

RISING and FALLING become network-reserved.

The adjustments:

1. **The mid-rung NOT is `NOT((x := a))`, not `NOT (x := a)`.** The second form is a NOT box with a named pin, refused today in both readers.
2. **The value mark `NOT` also spells `Box.Flags.Negated`, as `NOT t1(…).Q`.** This is not an extra word. It replaces the joint proposal's refusal of a negated box output. The model is distinct from the NOT box and from `NOT Q => x`, and today it pulls lossily as a NOT box.

For the owner:

- Combined marks and edge marks on outputs store and build, so refusing them is a choice.
- `VAR_TEMP` misstates the wires' cross-scan memory.
