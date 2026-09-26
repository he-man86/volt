## ADDED Requirements

### Requirement: one statement per NWL network item

Network text SHALL render each top-level NWL network item as exactly one statement, and each owned child subtree
(an input slot, an assign's value, the EN slot, a Parallel branch) nested at the position the vendor holds it. No
item SHALL produce a second statement, and no statement SHALL be hoisted, split or substituted back. Every statement
SHALL end with `;`, the IF form (`… END_IF;`) and EXECUTE (`… END_EXECUTE;`) included; that `;` SHALL belong to its
statement and SHALL never create an item. The empty item (a top-level `BoxTreeTerminator` with no input) SHALL be
the empty statement — a `;` that closes no statement, written on its own line. A top-level item with no target
(a box, leaf, wire reference or Parallel whose output goes nowhere) SHALL be the statement `value;`.

#### Scenario: a single-consumer producer is nested
- **WHEN** a network holds `BoxTreeAssign{RValue: BoxTreeBox OR{InputItems: [BoxTreeBox AND{a, b}, c]}, Outputs: [out]}`
- **THEN** it is written `out := ((a AND b) OR c);` and reads back as the same two nested boxes

#### Scenario: a multi-output assign is one statement
- **WHEN** one `BoxTreeAssign` drives `x :=` and `y S=` from value `v`
- **THEN** it is written as the chained assignment `x := y S= v;` (one target per line canonically) and reads back as
  ONE assign with two outputs, never as a Demux feeding two assigns

#### Scenario: END_IF; is one item, not two
- **WHEN** a network contains `IF a THEN JMP Done; END_IF;` and nothing else
- **THEN** it reads back as exactly one Assign with a jump target, and no empty item follows it

#### Scenario: a missing terminator is a parse error
- **WHEN** a network contains `IF a THEN JMP Done; END_IF` with no `;` after `END_IF`
- **THEN** it is refused with `NETWORK_PARSE`

#### Scenario: the empty statement is the empty item
- **WHEN** a network contains `out := a;` followed by a line holding only `;`
- **THEN** it reads back as two items, the second a `BoxTreeTerminator` with no input, and writes back identically

#### Scenario: a top-level box with nothing connected
- **WHEN** a top-level `BoxTreeBox f` carries the Negation flag and its output is connected to nothing
- **THEN** it is written `NOT f(x);` and reads back as the same flagged top-level box

### Requirement: a wire is a Demux declared in its network's VAR_TEMP block

A `BoxTreeDemux` SHALL be the only named intermediate. A network holding a Demux SHALL carry exactly one
`VAR_TEMP … END_VAR` block after its comment lines and before its first statement; a network without one SHALL carry
none. The block SHALL be written on one line (`VAR_TEMP g1, g2 : BOOL; END_VAR`) and SHALL be read across lines as
well. `name := tree;` SHALL be a declared wire's definition and a bare `name` elsewhere a reference. Wire-ness SHALL
be decided by the declaration alone, never by use count or name prefix, and a wire name SHALL be `g<digits>`,
carrying the vendor VarId. The writer SHALL emit items in vendor order and SHALL never reorder them.

#### Scenario: a single-consumer Demux survives on CODESYS
- **WHEN** a Demux with VarId 28 fed by an AND box feeds exactly one consumer and the network is pushed to CODESYS
- **THEN** it is written with `VAR_TEMP g28 : BOOL; END_VAR` and `g28 := …;`, and the push rebuilds it as a Demux
  with VarId 28

#### Scenario: the block across lines
- **WHEN** a network declares its wires as `VAR_TEMP`, `g1 : BOOL;`, `g2 : BOOL;`, `END_VAR` on four lines
- **THEN** the gate accepts it, and the canonical form is the one-line block

#### Scenario: an undeclared assignment is a coil
- **WHEN** a body contains `g5 := x;`, `g5` is not declared in the network's `VAR_TEMP` and the POU declares `g5`
- **THEN** it reads back as an Assign to the variable `g5`, never as a Demux

#### Scenario: an undeclared wire-shaped name
- **WHEN** a body references `g5`, which neither the network's `VAR_TEMP` nor any scope declares
- **THEN** it is refused with `NETWORK_BAD_EXPRESSION`

#### Scenario: a wire defined twice
- **WHEN** a network declares `g1` and contains `g1 := a;` and `g1 := b;`
- **THEN** it is refused with `NETWORK_DUPLICATE_NAME`

#### Scenario: a second block
- **WHEN** a network carries two `VAR_TEMP … END_VAR` blocks
- **THEN** it is refused with `NETWORK_BAD_EXPRESSION`

#### Scenario: a wire not named g<digits>
- **WHEN** a network declares `VAR_TEMP speed : BOOL; END_VAR`
- **THEN** it is refused with `NETWORK_BAD_EXPRESSION`

#### Scenario: a wire referenced but never defined
- **WHEN** a network declares `g1`, contains `out := g1;` and no `g1 := …;`
- **THEN** it is refused with `NETWORK_BAD_EXPRESSION`

#### Scenario: a wire defined with a storage operator
- **WHEN** a network declares `g1` and contains `g1 S= a;`
- **THEN** it is refused with `NETWORK_BAD_EXPRESSION`

#### Scenario: a wire defined inside a chain
- **WHEN** a network declares `g1` and contains `g1 := out := a;`
- **THEN** it is refused with `NETWORK_BAD_EXPRESSION`

#### Scenario: a wire referenced before its definition
- **WHEN** a network declares `g1` and contains `out := g1;` before `g1 := a;`
- **THEN** it is refused with `NETWORK_BAD_EXPRESSION`

#### Scenario: the vendor stores a reference before its definition
- **WHEN** a pulled network holds a Demux reference in an item before the Demux item that defines it
- **THEN** the body materializes as the unsupported marker; the writer does not reorder the items

### Requirement: a wire's type is read off its producer

The Demux holds no type, so the text SHALL NOT invent one. A wire whose producer is boolean by itself — an operand
used as a boolean, an AND/OR/XOR/NOT box, a comparison box, `TRUE`/`FALSE`, an edge, `.ENO`, a Parallel — SHALL be
declared `BOOL`, in FBD and LD alike. A wire whose producer is a data value SHALL materialize the body as the
unsupported marker until type inference exists in the writer; its type SHALL never be guessed. The gate SHALL refuse,
by name, a declared type that differs from the producer's.

#### Scenario: a boolean producer
- **WHEN** a Demux is fed by `(a AND b)`
- **THEN** its wire is declared `BOOL`

#### Scenario: a data producer
- **WHEN** a pulled Demux is fed by an ADD box
- **THEN** the body materializes as the unsupported marker

#### Scenario: a hand-edited type
- **WHEN** a pushed network declares `VAR_TEMP g1 : INT; END_VAR` and defines `g1 := (a AND b);`
- **THEN** the push is refused with `NETWORK_BAD_EXPRESSION`, naming the wire and the producer's type

### Requirement: reserved names are one case-insensitive set on write and read

The writer and the reader SHALL use the same reserved set: every name in scope (the POU's variables, globals, the
owning FB's members seen from a method or action), keywords, literals, and `PARALLEL`, `R_EDGE`, `F_EDGE`, matched
case-insensitively. A wire name matching the set SHALL be refused with `NETWORK_DUPLICATE_NAME`; the writer SHALL
rename a colliding `g<VarId>` to the lowest free `g<n>`. A POU or FB instance named `PARALLEL`, `R_EDGE` or `F_EDGE`
SHALL be refused with `NETWORK_UNSUPPORTED`.

#### Scenario: a wire that differs from a variable only in case
- **WHEN** a network declares wire `g3` and the POU declares a variable `G3`
- **THEN** it is refused with `NETWORK_DUPLICATE_NAME`

#### Scenario: the writer avoids a collision
- **WHEN** a Demux with VarId 3 is pulled from a POU whose owning FB declares a member `G3`
- **THEN** the wire is written as the lowest `g<n>` in no scope, and the reader accepts it

#### Scenario: a POU named like an edge word
- **WHEN** a project holds a function named `R_EDGE` and a body calls it
- **THEN** the push is refused with `NETWORK_UNSUPPORTED`

### Requirement: the network header and its comment

The `NETWORK` header SHALL be `NETWORK [LABEL: x] [TITLE: "…"] [DISABLED]`, in that order, with no order number, and
SHALL end at its newline; another field order SHALL be `NETWORK_NOT_CANONICAL`. A line after the header that starts
with `DISABLED`, `TITLE` or `LABEL` SHALL be read as a statement. The network comment SHALL be the `//` lines between
the header and the wire block (or first statement); per line the `//` and one following space SHALL be syntax and
the rest — leading indentation and a leading `//` included — text. An empty comment line SHALL be `//`; a blank line
between comment lines SHALL be layout. A `//` line after a statement SHALL be refused with `NETWORK_PARSE`. The
drivers SHALL compare a comment ignoring trailing whitespace.

#### Scenario: a variable named like a header field
- **WHEN** a network's first statement, on the line after `NETWORK`, is `DISABLED := x;`
- **THEN** it reads back as an Assign to the variable `DISABLED`, and the network is not disabled

#### Scenario: a multi-line comment keeps its shape
- **WHEN** a network comment is `"step:\n\n    indented\n// quoted"`
- **THEN** it is written as `// step:`, `//`, `//     indented`, `// // quoted` and reads back as the same four lines

#### Scenario: a comment below a statement
- **WHEN** a network holds a `//` line after its first statement
- **THEN** it is refused with `NETWORK_PARSE`, never moved into the network comment

#### Scenario: a comment on a fully-headed network
- **WHEN** a network has a LABEL, a TITLE, DISABLED, a comment and a wire
- **THEN** it is written header line, then the `//` lines, then the `VAR_TEMP` block, then the statements

### Requirement: labels and jumps round-trip what the IDE holds

The gate SHALL refuse only a label or jump shape the IDE cannot hold; label resolution SHALL remain the compiler's,
and the LSP SHALL report what the recorded build reports. Labels SHALL match case-insensitively and travel verbatim.
A `JMP` to a label no network of the body carries SHALL be accepted by the gate. One label on two networks of a body
SHALL be refused with `NETWORK_DUPLICATE_NAME` if and only if the label census shows the IDE cannot hold it. A LABEL on
a DISABLED network and a `JMP` inside a DISABLED network SHALL round-trip.

#### Scenario: a jump to a missing label
- **WHEN** a body holds `JMP Nowhere;` and no network labelled `Nowhere`
- **THEN** the gate accepts it and the LSP reports the recorded build message for it

#### Scenario: a disabled network that is a jump target
- **WHEN** a network `NETWORK LABEL: Done DISABLED` is the target of `JMP Done;` in another network
- **THEN** both networks round-trip unchanged

#### Scenario: a label on two networks
- **WHEN** two networks of one body carry `LABEL: Done` and `LABEL: DONE`
- **THEN** the push follows the label census: refused with `NETWORK_DUPLICATE_NAME` if the IDE cannot hold it, else
  accepted with the build's message in the LSP

### Requirement: EN is a pin, ENO is spelled, and output slots are stored

A box's enable (input slot 0, named EN) SHALL be written as the named pin `EN := value`, with `EN := ,` for an EN
shown but unwired. The model SHALL carry each output's slot index and, on a consumed box, the slot its consumer is
connected to. A consumed box connected by its main output (`MainOutputIndex`) SHALL carry no suffix; connected by
ENO it SHALL be suffixed `.ENO`; connected by any other slot the body SHALL materialize as the unsupported marker.
Positional `=> v` pins SHALL fill the remaining output slots in order, skipping the connected one; ENO SHALL never be
an `=>` slot. Until the slot census shows an enabled box connected by its main output, the gate SHALL refuse a
consumed enabled box without `.ENO`, and SHALL refuse `.ENO` on a box without EN except on an Execute box, whose only
output is ENO. A call's head SHALL be its BoxType verbatim (keywords included) or its FB instance.

#### Scenario: an enabled box drives a lamp
- **WHEN** `Assign(Box MOVE{EN: c, IN: 0, result → Status}, [lamp])` is written
- **THEN** it is `lamp := MOVE(EN := c, 0, => Status).ENO;` and no `LET` or `IF` appears

#### Scenario: a missing ENO is refused
- **WHEN** a pushed body contains `lamp := MOVE(EN := c, 0, => Status);`
- **THEN** the push is refused with `NETWORK_BAD_EXPRESSION`

#### Scenario: an enabled box nested without ENO
- **WHEN** a pushed body contains `out := GT(ADD(EN := x, a, b), c);`
- **THEN** it is refused with `NETWORK_BAD_EXPRESSION`, never read as GT on ADD's ENO

#### Scenario: a consumed box without EN keeps its main output for its consumer
- **WHEN** a box `f` without EN is consumed by `out :=` through its main output and its output slot 1 is wired to `err`
- **THEN** it is written `out := f(src, => err);` and `err` reads back on slot 1

#### Scenario: a connection by an unspellable slot
- **WHEN** a pulled consumer is connected to a box's output slot that is neither its main output nor ENO
- **THEN** the body materializes as the unsupported marker

#### Scenario: a consumed Execute box without EN
- **WHEN** an Execute box with no EN wired is consumed by `out :=`
- **THEN** it is written `out := EXECUTE … END_EXECUTE.ENO;` and reads back as the same box

#### Scenario: an operator box in call form
- **WHEN** an AND box has EN wired to `go` and its own output wired to `out`
- **THEN** it is written `AND(EN := go, a, b, => out);`

### Requirement: parentheses are structural

Every pair of parentheses SHALL be one box: a group's (it holds an infix operator) or a call's argument list (it
follows a head). After `NOT`, a pair holding an operator SHALL be a group under the negation modifier and any other
pair the NOT box's argument list. Whitespace SHALL play no part in telling them apart. A pair that is neither SHALL be
refused with `NETWORK_BAD_EXPRESSION`.

#### Scenario: the NOT box and the modifier
- **WHEN** a body contains `o1 := NOT(a);`, `o2 := NOT a;`, `o3 := NOT (a AND b);` and `o4 := NOT((a AND b));`
- **THEN** they read back as a NOT box on `a`, a negated operand `a`, a negated AND box, and a NOT box around an AND box

#### Scenario: spacing does not change the box
- **WHEN** a body contains `out := NOT (a);`
- **THEN** it reads back as the NOT box on `a`, exactly as `out := NOT(a);`

#### Scenario: a redundant pair
- **WHEN** a body contains `out := ((a AND b));`
- **THEN** it is refused with `NETWORK_BAD_EXPRESSION`

### Requirement: edges are R_EDGE and F_EDGE flags

A `Rtrig` or `Ftrig` flag on an operand, box, Parallel or wire reference SHALL be written `R_EDGE(x)` or `F_EDGE(x)`,
and SHALL read back as that flag on `x`, never as a box. With negation the one spelling SHALL be `NOT R_EDGE(x)`. The
argument of an edge SHALL carry no modifier: a modifier inside it SHALL be refused with `NETWORK_BAD_EXPRESSION`, and
nested edges with `NETWORK_UNSUPPORTED`. Rising and falling on one operand SHALL materialize the body as the marker on
pull.

#### Scenario: an edge on EN
- **WHEN** a MOVE box's EN is fed by operand `bStart` carrying `Rtrig`
- **THEN** it is written `MOVE(EN := R_EDGE(bStart), 1, => nMode);` and reads back with no R_TRIG box and the flag on
  the operand

#### Scenario: negation with an edge
- **WHEN** an operand `x` carries `Negation` and `Ftrig`
- **THEN** it is written `NOT F_EDGE(x)`

#### Scenario: a modifier inside an edge
- **WHEN** a body contains `out := R_EDGE(NOT x);`
- **THEN** it is refused with `NETWORK_BAD_EXPRESSION`

#### Scenario: rising and falling on one operand
- **WHEN** a pulled operand carries both `Rtrig` and `Ftrig`
- **THEN** the body materializes as the unsupported marker

### Requirement: pull never throws; unmeasured vendor facts go to the marker

Materializing a body SHALL never throw. A shape the writer cannot spell SHALL materialize the body as the existing
unsupported marker; a push SHALL refuse it by name. This SHALL cover: a flag on an input pin (`Input.Flags`) until the
pin-flag census names its spelling; a Negation or edge flag on a Demux or Assign item until the item-flag census
does; a Demux definition below the top level; a flag on an empty slot; operand text containing a backtick; a TITLE
containing a newline; an EXECUTE snippet holding a line whose first word is `END_EXECUTE`. `Input.Flags` SHALL NOT be
deleted from the model until the pin-flag census on CODESYS finds it empty. An EXECUTE body SHALL end at the first
line whose first word is `END_EXECUTE`, and a header SHALL be recognised only as the whole word `NETWORK` at a line
start outside an EXECUTE body.

#### Scenario: a pin flag on CODESYS
- **WHEN** a CODESYS box input pin carries a Negation flag in `InputFlags`
- **THEN** the body materializes as the unsupported marker, and the flag is not dropped

#### Scenario: a backtick in operand text
- **WHEN** a pulled operand's text contains a backtick
- **THEN** the body materializes as the unsupported marker and no exception escapes the pull

#### Scenario: a newline in a title
- **WHEN** a pulled network's TITLE contains a newline inside its text
- **THEN** the body materializes as the unsupported marker

#### Scenario: a snippet line starting with END_EXECUTE
- **WHEN** a pulled Execute snippet holds a line whose first word is `END_EXECUTE`
- **THEN** the body materializes as the unsupported marker

#### Scenario: a snippet line starting with Network
- **WHEN** an Execute snippet holds the line `NetworkState := 1;`
- **THEN** it reads back as snippet text, and the push is not refused

#### Scenario: a flag on an empty slot
- **WHEN** a pushed body contains `f(NOT , a);`
- **THEN** it is refused with `NETWORK_UNSUPPORTED`

### Requirement: an opaque operand is backticked in place

A `BoxTreeOperand`, an assign target, an `=>` target or an FB instance whose text is not exactly one token SHALL be
written verbatim between backticks at its own position, and SHALL read back as one operand whose text is never
parsed into boxes. Pushed text containing a backtick inside backticks SHALL be refused by name.

#### Scenario: a typed call stays one operand
- **WHEN** an FB pin is fed by the operand text `fc_dinttotime(T.Start,2)`
- **THEN** it is written ``P := `fc_dinttotime(T.Start,2)` `` and reads back as one `BoxTreeOperand`

### Requirement: every NWL item class has a distinct spelling

A `BoxTreeParallel` SHALL be written `PARALLEL([IN := feed,] branches)`, distinct from AND/OR boxes; `IN := ,` SHALL
be a feed slot wired to nothing and a missing `IN` no feed. A top-level box's own unnamed output pin SHALL be written
`=> target` inside the call, distinct from an Assign over the box. `f()` SHALL be a box with no input slot and a lone
unconnected slot SHALL be written with its formal (`MOVE(IN := )`). A non-default `Parallel.Mode` SHALL be refused
with `NETWORK_UNSUPPORTED`. An Execute box SHALL be written `EXECUTE[(EN := c)]` … verbatim ST … `END_EXECUTE`,
suffixed `.ENO` where consumed; an empty snippet SHALL be written as exactly one empty line.

#### Scenario: a Parallel is not rebuilt as AND/OR on CODESYS
- **WHEN** a network holding `BoxTreeParallel{Input: g54, Trees: [a, b]}` is pulled, edited elsewhere and pushed to CODESYS
- **THEN** it is written `PARALLEL(IN := g54, a, b)` and the rebuilt network holds a `BoxTreeParallel`

#### Scenario: an unwired Parallel feed
- **WHEN** a `BoxTreeParallel` has an Input that is a `BoxTreeTerminator` with no input
- **THEN** it is written `PARALLEL(IN := , a, b)`, and `PARALLEL(a, b)` reads back as a Parallel with no Input

#### Scenario: zero inputs versus one unwired input
- **WHEN** a MOVE box has one input slot connected to nothing
- **THEN** it is written `MOVE(IN := )`, and `MOVE()` reads back as a box with no input slot

#### Scenario: a result pin is not an assign
- **WHEN** a top-level `BoxTreeBox MOVE` has its unnamed output slot wired to `dst`
- **THEN** it is written `MOVE(src, => dst);` and `dst := MOVE(src);` reads back as a different item, an Assign

#### Scenario: an empty Execute box
- **WHEN** an Execute box with an empty snippet is written
- **THEN** exactly one empty line separates `EXECUTE` and `END_EXECUTE`, and it reads back with an empty snippet

### Requirement: infix treats absent and default formals as one

An operator box with no EN, no instance and no output pin SHALL be written infix when its `InputParams` names are
absent or are the operator's defaults; a non-default name SHALL force call form. The driver SHALL write the defaults,
and the model oracle SHALL treat absent and default names as equal — its one equivalence.

#### Scenario: default formals read as infix
- **WHEN** an AND box carries the input names `IN1`, `IN2`
- **THEN** it is written `(a AND b)`

#### Scenario: a non-default formal forces call form
- **WHEN** an ADD box carries a non-default input name `X` on slot 0
- **THEN** it is written in call form with `X :=` on that pin

### Requirement: TwinCAT structural edits are refused where the import is unmeasured

On TwinCAT, a value edit SHALL be written in place. A structurally changed network is rebuilt through PLCopen
import; until measured live, a structurally changed TwinCAT network containing `PARALLEL`, a Demux whose input is a
leaf, or a result pin `=> v` SHALL be refused with `NETWORK_UNSUPPORTED` before it reaches the importer, and the
message SHALL name the network and the reason.

#### Scenario: a Parallel in a structurally changed TwinCAT network
- **WHEN** a TwinCAT network containing `PARALLEL(IN := g1, a, b)` gains a coil and is pushed
- **THEN** the push is refused with `NETWORK_UNSUPPORTED`, naming the network and `PARALLEL`

#### Scenario: a wire of a leaf in a structurally changed TwinCAT network
- **WHEN** a TwinCAT network declaring wire `g1` with `g1 := TRUE;` gains a coil and is pushed
- **THEN** the push is refused with `NETWORK_UNSUPPORTED`, naming the network and the leaf wire, and the importer is
  never called

### Requirement: marker-only shapes stay on the existing marker

A body SHALL materialize as the existing unsupported-body marker, not as network text, when it contains a rung with
several control-flow targets (a coil and a jump, or two jumps), a target with a Negation-only or edge bit, or a Mux.

#### Scenario: a rung driving two jumps
- **WHEN** one Assign drives two jump targets
- **THEN** the body materializes as the unsupported marker

#### Scenario: an edge coil
- **WHEN** a body with a rising-edge coil is pulled
- **THEN** the body materializes as the unsupported marker

### Requirement: the round trip is checked on tokens and on models

The gate SHALL accept a body iff `Tokens(Write(Read(x))) == Tokens(x)`, whitespace being significant only inside
backticks, TITLE strings, comments and EXECUTE bodies. `NETWORK_NOT_CANONICAL` SHALL report a token difference only.
After a successful push the CLI SHALL record the IDE's re-materialized text as `volt/ide` and bring the working tree
to it. A test oracle SHALL check `Read(Write(m)) ≅ m` structurally for every vendor-read fixture.

#### Scenario: re-wrapping a call is accepted
- **WHEN** an engineer lays out a 30-pin FB call one pin per line
- **THEN** the gate accepts it

#### Scenario: a hand layout does not come back as an IDE change
- **WHEN** that body is pushed and the project is pulled again with no IDE edit
- **THEN** the pull reports nothing to pull, and the working tree holds the canonical layout

#### Scenario: pull-side loss is caught
- **WHEN** a writer arm drops a flag that the vendor reader filled
- **THEN** the model oracle fails even though the text round trip is a fixed point

### Requirement: the body language and the v1 refusal

A graphical body SHALL carry its language (FBD or LD) on its own implementation marker
`(* @volt-implementation FBD|LD *)`, one per body (POU, method, action, accessor); an ST body SHALL keep the bare
`(* @volt-implementation *)`. Text written in the previous form (`LET` statements or `NETWORK <n> <LANG>` headers) SHALL be refused with `NETWORK_PARSE` and a message to re-pull; there SHALL be no translator.

#### Scenario: a v1 body is refused, not translated
- **WHEN** a push carries `NETWORK 0 LD` and `LET g0 := TRUE;`
- **THEN** it is refused with `NETWORK_PARSE`, naming a re-pull

#### Scenario: a view change is one comparison
- **WHEN** a pushed body's marker says `FBD` and the IDE body is LD
- **THEN** the push is refused as a view-mode change

#### Scenario: an ST function block with an LD method
- **WHEN** an FB has an ST body and an LD method
- **THEN** the FB body carries the bare marker and the method carries `(* @volt-implementation LD *)`
