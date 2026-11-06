## The method

Every IDE, every model, in this order:

1. **Census.** Everything the model can store, read from the vendor's own DLL or schema, committed as a generated file.
2. **Editor reference.** The IDE itself creates each object (NWL: the real `InsertBox`), and what it stores is recorded. A
   pushed object must store what the editor would.
3. **Fixture per state.** Every stored state is created by us and committed, including states no project is known to hold.
4. **Measure.** Build it, run it, compare the picture, save and reopen. A preview or a pull is not proof: the run is.
5. **Map.** One row per option (format below).
6. **Completeness gate.** A test fails when the census holds something the map does not.
7. **Language last.** Derived from the map: a state that changes the program gets a spelling, the rest a refusal by name.

## The row

| Field | Holds |
|---|---|
| `model`, `class`, `member`, `kind` | Where the option lives; `kind` is the object kind where it matters (NWL box: FUNCTION, FB, PROGRAM, operator, comparison, Execute) |
| `option` | The stored value or state |
| `source` | `census`, `editor` or `created` |
| `picture`, `code`, `run`, `persists` | `same`, `differs`, `not-measured`; `faults` where the IDE raises an error on it |
| `status` | `spelled`, `lost-inert` (held, no text and no refusal: a pull shows another state's text, nothing runs apart), `refused-inert`, `refused-gap` (refused, changes the code or the run, no text), `refused-fault`, `cannot-store`, `not-measured` |
| `text` | The spelling or the refusal's wording |
| `fixture` | The test that pins it |

`not-measured` is a real status: such a state stays refused by name and is listed, never counted as known. Nothing in the row
format names a vendor except `model`. A verification on another IDE of the same model adds its own column of results to the row.

## The order

1. **CODESYS SP21.** The map is built and the language derived there.
2. **TwinCAT.** It stores the same NWL in another format, so the same rows and fixtures are replayed on it. Each row is confirmed or
   gets a measured difference. A form with no measured archive stays refused by name until then, and this step is where each
   such refusal is measured and lifted or kept.
3. **Other IDEs, in the future.** See "A new IDE".

## One source of truth

A language-behaviour question is answered by the map and its fixtures. A new fact becomes a row, not a probe, a DIALECT row or a
side list. Tests of Volt's own code (e2e, exec twins, release matrix) stay: they check the code against the map and do not define
the language. ST oracles (`record:exec`, `record:language`, the build recordings) stay: they cover ST, not the stored model.

Limit, stated: the gate proves every declared option has a row. Behaviour inside the compiler can only be sampled, so a row
covers what was run, and combinations cover what the shape generator reaches.

## Old patterns this rules out

- Designing the language first and finding gaps from outside.
- Arguing from how often a shape appears in real projects. A real project is a check at the end, never an argument.
- Guessing a stored form instead of measuring it.
- Trusting a preview or a pull instead of running the program.
- A new probe or list per fact.
- Calling something unmeasured without checking the map, or measured without a fixture.
- Concluding that the IDE ignores a stored form before measuring the form its editor draws.
- Running one vendor's or one version's tests and assuming the rest: a change names what it did not run.

## Machine rules for measuring

A full measurement needs a quiet machine and free disk (other sessions' heavy work paused, disk checked), and a dialog stops a
batch at once, because a modal dialog blocks the IDE and hides what follows. Every created object gets a unique id.

## Combinations against the map (task 2.3, decided 2026-11-06)

`shapes.v2` stays the generator of combinations; the map gives each shape its verdict.

- **A shape is its states.** The flag value on its holder is one state: the holder's member, the place it names (`on the
  operand`, `on the target`, `on the output`, `on the instance`, `on the pin`, `on the line`, `on the terminator`, a box's
  `on AND|FUNCTION|FB|MOVE|EXECUTE`, a comment's `on the value|coil|output|instance`) and the value (`Negation+Rtrig`). Each
  class in a slot is another: the slot's member and the class's word (`operand`, `assign`, `terminator`, `box`, `parallel`,
  `wire`, `mux`); a box in an assign's value is also every box row stored `consumed`.
- **A state resolves** to the map rows of that member whose option names that place or word, and, for a flag, whose first
  word is that value. Nothing else is matched: the rows are not rewritten for the shapes.
- **The verdict.** A spelled shape with a state whose rows all refuse fails the gate: a pull would show text for a state
  the map refuses. A refused shape needs its refusal's wording on a refused row (a whole-body refusal stands as its
  `%LANGUAGE … UNSUPPORTED` line); a shape with a state the object model cannot hold (every row of it `cannot-store`) is
  one the IDE never stores and needs none. One whose refusal no row holds is listed.
  A refused shape whose states' rows all spell is listed too: the rows lack the context that refuses it.
- **Not covered.** A state no row resolves is listed in `shapes.v2.coverage.txt` with the number of shapes it reaches. That
  list is the measurement queue for combinations; a state measured later becomes rows, and the list shrinks.
- **The queue closed (2026-11-06).** 211 queued states, measured live as class-states 0146-0581 (each LD and FBD; a Mux
  FBD only): every pairwise flag stack on a pin, the line, a box (AND, FB, FUNCTION, MOVE, EXECUTE), the terminator, an
  FB instance, a box output, an operand and a coil target; the operand comments on an instance and an output; each class
  in each slot (a box, parallel, assign, terminator, wire or Mux in a box pin, a parallel's feed or leg, a wire's
  definition, under a rail; a non-box as a Mux's merger is `cannot-store`). Existing states are cited where they hold the
  class in the slot (class-states 0106, 0125, 0126, 0128, 0143-0145; assign-states 0379-0380). Found: the reader refuses a
  terminator's input before the Mux under it (0540), so the generator now names that refusal first; a terminator's input
  is ignored by the compiler (refused-inert), a wire under a rail does not build. What stays listed, by design: the two
  root Mux shapes (a root holds no slot state; every Mux is the reader's refusal, 0143-0145, 0536-0539), and the
  refused shapes whose rows spell in another context (a Jump or Return bit on the line or target of a jump or return).

## What the 3.1 sweep found (2026-11-06)

- **A stored CallType the IDE does not build** was `lost-inert` (box-states 0934-0944, 0953-0956, 0965-0968): a consumed
  box whose CallType reads its value by an output's name, read at a function's result pin `'   '` (C0004), and a call
  stored as Method or Action of a callee that is neither (C0409, C0035). Refused by name, one refusal for both: `a box
  storing a call type its callee does not build`. The reader decides the first from the stored tree; the second needs the
  callee, so the reader carries a stored Method/Action and the writer checks it against the scope's callee. Where the same
  stored value builds (Action on a PROGRAM or a root FUNCTION) the refusal is refused-inert.
- The box-states offline twin read an unknown CallType as `And`; it now parses every stored member (Action, Sel added).
- Root boxes now show a run: an FB's instance outputs and a PROGRAM's own outputs after the run (`observe`), equal across
  the EN/ENO forms and their spelled twins (box-states 0025, 0078, 0249, 0295, 0609, 0617, 0689, 0697, 1037, 1055). A
  FUNCTION at a root that nothing reads (bmF0: 0649, 0208, 0218) has no effect a run can show; one writing its VAR_IN_OUT
  (edFv) runs once per call in the EN/ENO and the EN-only form, and not at all with EN false (class-states 0557-0564). EN
  false is run for the root FB and PROGRAM too: nothing is called and no output written (class-states 0541-0556).
- LD boxes with formal pins (`LIMIT(MN := 0, IN := v, MX := 100)`, `SEL(G := g, IN0 := a, IN1 := b)`) pull back, build
  and run as the FBD ones (e2e nwl-box-states). An FBD wire carrying an array (`w1 := MOVE(arr); ASSIGN(w1, Q => out);`)
  builds and runs; the lowering declares a wire of an array of elementary values.

## A new IDE

1. Find what plays NWL's part: the stored model, how to read it, how to create objects through the IDE, how to run the result.
2. Run the method on one small object kind end to end before anything else, and write down what did not fit.
3. Only then extract shared code, and only what both models actually repeated.

## Open

- **Is there one language or one per model?** The language is being fitted to NWL as closely as possible, and another vendor's
  model may not fit it 1:1. Either each model gets its own close-fitting language by this method, or one language gives up some
  fit. To decide when a second model has been mapped, with the owner.

## Language direction (owner, 2026-11-05)

Settled for now; built in task 5 after the maps. Each rule is checked against its rows before it is built, and a row that
contradicts it reopens the rule here.

**The principle.** The text is the stored NWL tree written as ST calls. Every stored node is one call holding its stored
parts inside its `()`, and the flow is each call's return.

**Decided:**

- A mark on a value is a function, nested in run order: `INVERT(a)`, `RISING(a)`, `FALLING(a)`, `RISING(INVERT(a))`. This
  covers contacts, pins, EN, the line into a coil and a box's own output: `IN := RISING(a)`, `EN := INVERT(c)`,
  `ASSIGN(INVERT(t1(IN := a)), Q => y)`. `INVERT`, not `NOT`: `NOT(a)` stays NWL's NOT box. A chain deeper than the store
  holds is refused by name.
- A mark on a receiver is its output name: `Q_INVERTED => x`, `Q_SET => x`, `Q_RESET => x`. An edge on a receiver cannot be
  drawn and is refused.
- A pin mark and a value mark that run alike read alike: a changed network is rebuilt to one drawing, the outer mark on the
  pin. An unchanged network keeps its own.
- A box's default output flows on: ENO when EN is shown, otherwise its value; an FB's or a program's its first output. A dot
  is written only when another output flows on: `ASSIGN(t1(IN := a).Q2, Q => x);`, a function after the editor's Set
  Output `ASSIGN(F(n := i, OUT => k).q, Q => y);`. No `.ENO`, no `GT_EN`, no `ENO()`.
  ```
  ASSIGN(GT(a, b), Q => x);
  ASSIGN(GT(EN := c, a, b, OUT => v), Q => y);
  ```
- Kept as they are: wires (`VAR w1 : ANY;`, `w1 := …`, the one `:=` a network holds), `RAIL()`, `BRANCH()`,
  `BRANCH_SHORTCIRCUIT()`, `EXECUTE()`, `OPERAND()`, the `%` lines.
- A project POU, variable or pin with one of these names (`INVERT`, `RISING`, `FALLING`, `ASSIGN`, `<pin>_INVERTED`,
  `<pin>_SET`, `<pin>_RESET`) is refused by name.

- Every coil, jump and return is an `ASSIGN`, one target too, because NWL stores each as one assign node (`BoxTreeAssign`: a
  value, its targets, its own mark). The target is an output; its mark is in the output's name:
  ```
  ASSIGN(a, Q => y);
  ASSIGN(a, Q_SET => y);
  ASSIGN(RISING(a), Q_INVERTED => y);
  ASSIGN(a, Q => JMP.l);
  ASSIGN(a, Q => RETURN);
  ```
  `y := a;`, `y S= a;`, `y R= a;`, `JMP.l := a;` and `RETURN := a;` are no network text.

**Open, decided from the assign map:**

- Several coils. Measured from the editor's own commands (LD and FBD, stored form only, not yet built or run, no rows yet):
  coils drawn in parallel are ONE assign with a list of targets, top to bottom; a coil drawn in series is an assign nested in
  an assign's value; a coil inside a rung is an assign as a box input. So both shapes exist and each has its own call:
  ```
  ASSIGN(a, Q => x, Q => y);                     // parallel coils: one node, two targets
  ASSIGN(ASSIGN(a, Q => x), Q => y);             // series coils: two nodes
  ASSIGN(AND(ASSIGN(a, Q => x), b), Q => y);     // a coil inside a rung
  ```
  Measured by the run (assign map, 2026-11-06): a target list runs in list order; a mark on one coil of several acts on
  that coil only, in all three shapes, and a mark on the line into the inner coil reaches both. A jump in the list is
  taken in its place: the targets after it are not written when it is (`ASSIGN(a, Q => x, Q => JMP.l, Q => y)`,
  assign-states#0490-0495). A full stack runs
  innermost first: `NOT(NOT(R_TRIG(R_TRIG(a))))`. Settled as written above.
- `BoxTreeTerminator` is what LD stores as the value of a coil, S, R, jump or return with no contact in front; FBD stores
  `???` there instead. It runs as always TRUE, like `RAIL()`, so its text is `RAIL()`: `ASSIGN(RAIL(), Q => y)`.
- `???` (an empty operand, as the editor shows it) is written bare: `q1 => ???`. Not `'???'`, a STRING constant a user
  can type, and not `OPERAND('???')`. Bare `???` is no ST name, number or string, so it means nothing else. NWL stores
  it as the operand text `???` (not null: null is an output with nothing drawn on it), and the IDE's build refuses it with
  `C0007 Expression expected instead of '?'` on its first `?`; the text keeps it and gives the same error, nothing is
  refused on push. On a jump's label it is a label no network holds, `C0117 No such label '???'` (assign-states#0496).
  A slot past a FUNCTION's or a PROGRAM's stored output names (lenze-mid's `[null,'???']` under names `[ENO]`) is drawn,
  compiled and run as no slot, whatever it holds and whether a PROGRAM's box stores CallType Program or Function: `???`
  there has no text (lost-inert), a variable there is refused by name (box-states#1099-1118, 1127-1132, 1138-1143). On an
  FB the stored CallType decides: under FunctionBlock the slot builds and runs as none, under Function it is C0409 on the
  slot's lazy variable (box-states#1133-1137, 1144-1148), so that state is refused by name: an FB box storing call type
  Function with an output past its names.
- `INVERT` on a value that is not BOOL runs as the bitwise `NOT` (MOVE's value or pin, an FB's INT output). On a plain
  INT coil a mark on the value or the target is stored and not in the code, so it gets no text (lost-inert); only a
  mark on the line runs.
- An assign with a null target faults the IDE's language model; an assign with a null value cannot be saved. Both are
  refused by name.
- A function showing EN and no ENO: only a direct write makes it (the editor shows EN and ENO together). Settled by the
  map: a function keeps its text, `GT(EN := go, i, j);` with no target is a statement like any box whose flow ends; an FB
  is refused, `an ENO output on a box showing no ENO`.

**Parked by the owner:** comments on an operand.
