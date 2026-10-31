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
