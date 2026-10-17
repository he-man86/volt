# Network text v2.1 — specification (draft, 2026-10-17)

Sources: readability.md "2R.6 proposal v2" + "v2 review", tasks.md 2R.6 (the 10:01 "option 1" entry), the four-lens
review panel (one-to-one, plain walk, flow, exceptions), v2-measurements.md (CODESYS SP21 runs; TwinCAT stores/builds),
DIALECT N16 N17 N20 N21 N41 C11 C13, awkward-sweep.md. Model: `Format/Network/NetworkModel.cs`.
Yardstick (owner): "just follow the NWL and write it down in human readable text — a 1 to 1 transpiler."

## 1. The one rule

The **writer** walks each network's NWL items in stored order and each item's tree root first; every node is written
by the one template of its kind (section 2), its children where NWL holds them, in stored order. The **reader** is the
inverse: it accepts exactly the token sequences the writer produces, with any layout that passes the one indentation
check (section 4), and builds the tree they name. One tree has one text; a text the writer would not produce for its
tree (a redundant bracket, `TITLE: ""`, a call form where the word fits) is refused because no tree prints it, not by
a rule of its own. Nothing is reordered, hoisted or reconstructed. Section 5 lists what is not "node → template".

## 2. Node table

| NWL node · member | spelling | example |
|---|---|---|
| body `DefaultViewMode` | `IMPLEMENTATION LD` / `FBD` | |
| network `Label`, `OutCommented`, `Title` | `NETWORK [LABEL: x] [DISABLED] [TITLE: "…"]`; empty title = none | `NETWORK LABEL: done TITLE: "Fill"` |
| network `Comment` | one `//` line per stored CR LF line | `// start the pump` |
| a network the text cannot spell | `UNSUPPORTED "<shape>" #<hash>;` alone; hash = 8 hex of the stored network | `UNSUPPORTED "a Mux box" #3f9a01c2;` |
| item | its tree, then `;` | `lamp := a;` |
| **Assign** `Targets` | coils left to right, value after the last | `lamp := motor := start;` |
| target coil state (the Negation + Set bits: four states) | `:=` · `NOT x :=` · `x S=` · `x R=` | `NOT x := a;` `x S= a;` `x R= ;` |
| target `Rising` / `Falling` | before `NOT`: `R_EDGE x :=` / `F_EDGE NOT x :=` | `R_EDGE x := a;` |
| `Jump` / `Return` | the coil head `JMP label` / `RETURN` | `JMP done := a;` `RETURN := ;` |
| nested **Assign** | bracketed, in any slot | `y := (x := a);` |
| `Value` = **Terminator** | nothing; `Negated` = `NOT` | `lamp := ;` `x := NOT;` |
| **Leaf** `Operand.Text` | the token; backticked when reserved, `split<n>` or not one token | `a` `` `ENO` `` `` `arr[i]` `` `-1` `'txt'` |
| Leaf / Box `Flags` | prefix `[R_EDGE\|F_EDGE] [NOT]` (negate first, N17); a box after a modifier is bracketed | `up := R_EDGE clk;` `x := R_EDGE NOT clk;` `y := R_EDGE (a AND b);` `lamp := NOT (MOVE 1 => t ENO EN c);` |
| **Box**, operator | the word as `BoxType` stores it, between its inputs, slot order; MOVE before its one input | `x := a ADD b ADD c;` `MOVE b => a;` |
| Box, operator the word cannot hold (NOT box; MOVE with 0 or 2 inputs) | backticked head, positional pins | ``x := `NOT`(a);`` |
| Box, function / method | `f(pins)` / `inst.m(pins)` | `y := LIMIT(MN := 0, IN := v, MX := 100);` |
| Box, FB: `Instance` + `BoxType` | `inst : TYPE(pins)` | `t1 : TON(IN := a, PT := T#1S);` `??? : TON(IN := a);` |
| Box `StCode` (Execute) | `EXECUTE` ⏎ ST ⏎ `END_EXECUTE` | |
| `Inputs` of a word box | operands, positional, slot order | `a SUB b` |
| `Inputs` of a call | `formal := v`, stored slot order, before the outputs; `()` = zero pins | `f(IN := a)` `g()` |
| `Input.Value` = Terminator | nothing | `x := MUL a MUL 6;` `c1 : CTU(CU := a, RESET := , PV := 10);` |
| `Input.Flags` | `mods` before the pin's formal, in a call (a word box with a flagged pin is written as its backticked call with formals) | `f(NOT IN := v)` (pin) vs `f(IN := NOT v)` (contact); `` x := `AND`(IN1 := a, NOT IN2 := b); `` |
| `Outputs` (data, slot order) | word box: `=> x`, positional; call: `name => x`, after the inputs | `a ADD b => x;` `f(IN := a, err => e)` |
| output pin flags | `mods` before the output's name, in a call | `` `MOVE`(a, NOT => x); `` (MEASURE) |
| `HasEnoOutput` on a box with EN | `ENO` after the outputs | `MOVE 0 => x ENO EN c;` |
| the ENO slot wired | `ENO => v` | `MOVE 7 => x ENO => lamp EN c;` |
| `Enable` (input slot 0) | `EN src`, last; Terminator = bare `EN` | `MOVE 1 => a ENO EN start;` `x ADD 1 => x ENO EN;` |
| `EnableFlags` | `mods EN src` | `MOVE 5 => y ENO NOT EN c;` (pin) vs `MOVE 5 => y ENO EN NOT c;` (contact) |
| `ConnectedSlot` (the null's position, measurement 12) | `ENO` shown → through ENO; FB → `.name`; nothing on an FB → its declared `ENO`; word or function → its value | `lamp := a GT 5 EN c;` |
| `MainOutputName` | `.name` on every FB read by a data output; never on a function, never `.ENO` | `x := t1 : TON(IN := a, PT := T#1S).Q;` |
| **Parallel** `Input`, `Branches`, `Mode` | `[feed] BRANCH (b1, b2, …)`; `SHORTCIRCUIT` = `BoxShortCircuit`, nothing = `Sequential`; no feed = `BRANCH (…)` | `lamp := start BRANCH (a, , b) SHORTCIRCUIT;` |
| **Demux** with `Input` / without | `split<VarId> := v` (nested: bracketed) / `split<VarId>` | `split1 := a AND b;` `MOVE 1 => t ENO EN (split1 := c);` |

A pin flag is written before the pin's name, never as a mark (owner 2026-10-17: no new keyword or mark).
A word box has no pin names, so the rare word box with a flagged pin is written as its backticked call with formals;
that is the word/call choice's one remaining case beside MOVE with 0 or 2 inputs. On EN, `NOT EN c` negates the pin and
`EN NOT c` the contact: two positions, no collision, because a word box's operands never carry a pin flag.

**Text.** Delimited text (a `//` line, a `"title"`, a `` `backtick` `` operand) is verbatim with one
escape, IEC's: `$$` `$'` `$"` `$L` `$N` `$R` `$T`; inside backticks a backtick is doubled. A comment's stored CR LF is
the next `//` line; a bare LF or CR is `$L` / `$R`. **An EXECUTE body is ST and stays
exactly as written, with no escape** (owner 2026-10-17): its stored CR LF is a text line end, its lines are text, not
items, and the indent of `END_EXECUTE` is layout. A body holding a line that starts with `END_EXECUTE`, or a lone CR or
LF, has no text and is refused by name.

**Members not carried** (B7; an unchanged network is never rebuilt and keeps them byte for byte, N28; a rebuild that
drops a stored value is named by `RebuildLoss`):

| member | why not in the text |
|---|---|
| `CallType`, a function's output list, `Kind` | derived on push from the declarations (2R.4) |
| `OutputParam.Names` / `.Types` of calls, `Operand.Type`, `Instance.Type`, `Comment`/`IsLValue`/`IsInstance`, the `EN`/`ENO` bools, zero `InputFlags`, `Extensible`, `IL*`/`FBDValid`, the item's Jump/Return echo (C13), a return's `???` target | derived (D) or editor cache (C), measured to run the same |
| item `Id`s, STSnippet line ids, TextDocument caches, `BranchCounter`, `Fixed`, `Boolean`, the `Address` sentinel | cache (2R.4) |
| a function's result name `'   '`, a bit operator's stored slot `['']`, a split's stored type that differs from its feeder's (N25) | lost on rebuild (L), measured inert |
| two stored values, one text: an operator pin's default formal (`IN1`/`IN2`) vs none; `Title`/`Comment` `""` vs null; a Leaf whose `Operand.Flags` echoes `Leaf.Flags` vs null | lost on rebuild (L), deliberately |
| `SymbolComment` | shown, edit refused (E) — no measured door to write it |
| `NetworkListComment`, `ValidIds` | body-level, derived; a differing value makes the body UNSUPPORTED (P11) |
| `BoxTreeMux`, `ILStatement`/`ILLines`, `Connectors`, a Terminator with an `Input` | `UNSUPPORTED` (unmakeable, unmeasured, or crashes CODESYS — #5, #7, #8, #6b) |

## 3. Grammar

```ebnf
body      = "IMPLEMENTATION" , ( "LD" | "FBD" ) , NL , { network } ;
network   = header , NL , { comment } , ( unsupported | { item } ) , "END_NETWORK" ;
header    = "NETWORK" , [ "LABEL:" , name ] , [ "DISABLED" ] , [ "TITLE:" , string ] ;
comment   = "//" , [ " " , text ] , NL ;
unsupported = "UNSUPPORTED" , string , "#" , hex8 , ";" ;
item      = [ top ] , ";" ;                               (* `;` alone = the empty item *)
top       = assign | split | slot ;
assign    = coil , { coil } , slot ;
coil      = [ edge ] , ( [ "NOT" ] , head , ":=" | head , ( "S=" | "R=" ) ) ;
head      = target | "JMP" , name | "RETURN" ;
split     = splitname , ":=" , slot ;
slot      = box | parallel | term | "(" , ( assign | split ) , ")" ;
term      = [ mods ] , ( atom | call ) | mods , "(" , box , ")" | splitname | "NOT" | (* empty *) ;
operand   = term | "(" , ( box | parallel | assign | split ) , ")" ;
box       = ( wordbox | movebox | call | execute ) , pinstate ;
wordbox   = opnd , word , opnd , { word , opnd } , { output } ;   (* one word per box *)
movebox   = "MOVE" , opnd , { output } ;
opnd      = operand ;
output    = "=>" , target ;
call      = [ name , ":" ] , ( target | "`" , word , "`" ) , "(" , [ pin , { "," , pin } ] , ")" , [ "." , name ] ;
pin       = [ mods ] , name , ":=" , slot | [ mods ] , name , "=>" , target | operand ;
execute   = "EXECUTE" , NL , { text , NL } , "END_EXECUTE" ;
pinstate  = [ "ENO" , [ output ] ] , [ [ mods ] , "EN" , slot ] ;
parallel  = [ operand - empty ] , "BRANCH" , "(" , slot , "," , slot , { "," , slot } , ")" , [ "SHORTCIRCUIT" ] ;
mods      = edge , [ "NOT" ] | "NOT" ;
edge      = "R_EDGE" | "F_EDGE" ;
atom      = token | backtick ;
target    = token | backtick ;
name      = token | backtick ;
splitname = "split" , digit - "0" , { digit } ;
backtick  = "`" , { char - "`" | "``" } , "`" ;
word      = "AND" | "OR" | "XOR" | "ADD" | "SUB" | "MUL" | "DIV" | "MOD" | "GT" | "GE" | "EQ" | "NE" | "LE" | "LT" ;
```

`S=` and `R=` are single tokens. Reserved (case-insensitive): `EN ENO BRANCH SHORTCIRCUIT JMP RETURN EXECUTE
END_EXECUTE NOT R_EDGE F_EDGE NETWORK END_NETWORK UNSUPPORTED MOVE`, the words, `split<digits>`; a name spelled like
one is backticked (a callee, an instance, a pin, a `.name`). The positional `pin` is the backticked operator call's
only. Brackets mean one thing: a compound (box, parallel, assignment, split definition) standing as an operand, after
a modifier, or nested in a slot. A call is never bracketed for itself (it carries its own); a call with no pinstate is
the same node as a term or a box. The reader is LL(1) except the coil head, which looks ahead to `:=` / `S=` / `R=`
over a bounded `[edge] [NOT] head`.

## 4. Layout

Whitespace and newlines are layout outside the header line, a `//` line and an EXECUTE body. **The one check:** a
continuation line of an item is indented deeper than the item's first line; a line that is not is refused "missing
`;`?". It refuses; it never decides meaning. The writer's layout, which the next pull shows — the staircase for every
EN source holding a box (inside brackets too), one branch per line where a branch holds a chain:

```
lamp := MOVE 3 => c ENO EN
          MOVE 2 => b ENO EN
            MOVE 1 => a ENO EN start;

x := a AND (MOVE 1 => t ENO EN
              MOVE 2 => u ENO EN c);

lamp := start BRANCH (a,
                      MOVE 1 => t ENO EN
                        MOVE 2 => u ENO EN c,
                      d);

done := EXECUTE
i := i + 1;
  END_EXECUTE ENO EN go;
```

`lamp := MOVE 3 => c ENO EN MOVE 2 => b ENO EN MOVE 1 => a ENO EN start;` on one line reads to the same tree.

## 5. Exceptions

**Removed** (each was an exception; what replaces it):

| # | was | now |
|---|---|---|
| X2 | operator vs call form | the word; a word-named call head is backticked (P1). Left: MOVE with 0/2 inputs (MEASURE) |
| X5 | lone `JMP l;` / `RETURN;` | `JMP l := ;` / `RETURN := ;` (C11: the stored value is the Terminator of `x := ;`) |
| X6 | `??? : TYPE` only for an unnamed instance | every FB writes `inst : TYPE` |
| X7, X15 | no `NOT x S=`; no flag on a parallel or split | the model: a coil has four states; Parallel/Demux hold no flag (N20). The grammar does not spell `NOT x S=`, `NOT (s BRANCH …)`, `NOT split1` |
| X11 (library) | a library callee's `.name` slot unknown | a Volt gap: the in-proc library signatures are reachable (section 7) |
| X14, text limits | bare LF in a comment; other unspellable text | one escape (section 2, Text) |
| reserved-name refusals | POU/instance named `R_EDGE`, a pin named `EN`, a `.name` spelled like a word | the backtick (P1) |

**Vendor fact** (measured; the refusal names it):

| # | rule | measured |
|---|---|---|
| X3 | an operator box with EN read through ENO needs its data output wired: `x := MOVE 1 => t ENO EN c` | 3c, both vendors |
| X8 | `R_EDGE NOT x` negates first | N17 (TwinCAT: MEASURE) |
| X9 | `ENO` only on a box with EN; an FB that declares `ENO` is read by rule or by `.Q`, never `.ENO` (refused) | 4a–4c |
| X10 | on a box with EN, "shows `ENO`" = "connected through ENO"; read by its value or `.name` is refused; a positional `=> x` fills the next output slot after ENO and the connected one | 3a, 3b, 12 (N16) |
| X12 | `ENO => v` at top level is spelled (LSP warning: never writes `v`); with a consumer it is refused | 7a, 7b |
| X13 | a parallel needs ≥ 2 branches; an operator ≥ 2 inputs; SUB exactly 2 | C0023, C0022; DIV/MOD/comparisons by analogy (MEASURE) |
| X17 | a split is defined once per network | #19, measurement 2 |

**Vendor semantics → LSP hints** (spelled as stored; the IDE runs them so, N41, 1b, 1c, 1e, 7a):
`x := NOT;` writes TRUE · an edge coil runs as a plain coil · `S=`/`R=` on JMP/RETURN latches nothing · a jump nested
in a coil skips that coil when taken · an empty branch is a shorted branch · operator words read their operands after
the nested boxes ran · a disabled box's input boxes still run · `ENO => v` never writes `v`.

**MEASURE, then spell or refuse by name** (spelled by the grammar; the push refuses by name until measured):
a modified jump or return; an edge beside `S=`/`R=`; an edge on EN; `NOT;` beside another coil; a modified coil
beside another coil; a negated output pin; rising and falling on one node; a flag on an Execute box; a Terminator-fed
Parallel (`NOT BRANCH (…)`); a split read inside its own definition; a split referenced and never defined; MOVE with
0 or 2 inputs; 3-input DIV/MOD/comparisons; X3 on functions; a function read by a declared output; a call pin stored
without a formal; TwinCAT edge order (needs the owner's trial licence, N17).

**Owner-kept text orders** (section 6, D1): EN and ENO.

## 6. Flow

- **Text order = stored order**, with two exceptions: `EN` is input slot 0 but written last (X1), and `ENO` is output
  slot 0 but written after the data outputs. Networks, items, an Assign's coils, a box's inputs and outputs, a
  parallel's branches are written in stored order. Moving text moves stored order.
- **Run rules** (measured):
  1. Every box nested in a box runs before it — its EN source first, then its inputs in slot order — whether or not
     it is enabled (1a–1d).
  2. Operator words read their operands after all nested boxes have run (1e).
  3. Coils are written after the value; on one variable the last stored coil wins (11).
- A pure EN chain therefore runs bottom-up; nothing else is read from layout. Within an item a split's position is
  irrelevant; across items, a read before the definition is the previous scan (X17).

```
MOVE (MOVE 2 => t ENO EN d) => x ENO EN
  MOVE 1 => s ENO EN c;
```

Written: the outer MOVE, its input box, its EN box. Runs: `MOVE 1` (EN slot), `MOVE 2` (input), the outer MOVE.

**MEASURE** before the doc claims more: a Parallel's run order, and whether `SHORTCIRCUIT` skips later branches'
boxes (rule 1 covers boxes nested in a box, not branches); an operator box with an output pin read by its consumer
(`(a ADD 1 => t) GT t`); the reach of 1e (its own consumer, or the whole item); a coil and an output pin writing one
variable; a plain `JMP`/`RETURN` coil beside a data coil.

## 7. Implementation

**BLOCKING:** the CODESYS writer builds an Execute box in one `SetObject` commit; measurement 9 shows its ST does not
run until committed again or reloaded. Today's writer probably has it too. Fix and run-check before 2R.6 lands.

**Checks out of the walk:** one shared validator over the model — splits defined once and referenced, the jump
item-flag echo (C13), X3/X9/X10/X12/X13, the unmeasured compositions — called by both vendor readers, the text
reader, the writer and the LSP. `NetworkTextGate`'s write + re-read becomes a test oracle, not a runtime step; the
writer's UNSUPPORTED catch-and-retry goes (validate first).

**Writer** (`NetworkTextWriter`, `NetworkText`, `NetworkSpelling`): one buffer, the column passed down — no
`Layout()` post-pass, no U+0001–U+0003 markers. Deleted: open-line hoisting (`Item()` levels + reverse, `EnoRead`,
`TextHasEno`), `EnabledComparison*`, `EnoCarried` (ENO is the pin, written from `HasEnoOutput`), the operator call form,
the `JMP l;` rail form.
**Reader** (`NetworkTextReader`, `NetworkLexer`): recursive descent; `consumed` passed down from the parent; outputs
numbered at the node's end (local); no `BoxSyn`/`Finalize(role)`, no open-line queue, no `Role.Eno`, no `LineEnd*`.
**Model:** drop `MainOutputIndex` (measurement 12: the null's position is the connection); `HasEnoOutput`,
`ConnectedSlot` and `Output.Slot` become total (no null).
**Drivers:** `CodesysNetworkWriter.RefuseUnbuildableEno` → the shared validator; `CodesysNetworkReader.UnstoredMainOutput`
re-examined (measurement 12). A push of `.name` needs the slot index of `name`: a project callee's declaration, or
the in-proc library signature (reachable; 2R.4b).
**LSP** (`frontend/syntax/network/`): the same in `statements.ts` (LineEnd), `values.ts` (OpenLine), `boxes.ts`,
`words.ts`; the ENO hover ("the line it takes") goes.
**Size:** core ~3,229 → ~1,450 lines; LSP port ~3,054 → ~1,300.
**TwinCAT:** `TcUnmeasured`'s structural-edit refusals on dev (parallel, `=> v`, pin flags, nested assigns/splits,
edge/negated coils, …) guard the PLCopen route the native-writer merge (in progress) removes; re-check the list after
it lands.
**Flag (D8):** `NetworkPairing`/`RebuildLoss`/`NetworkMembers`/`NetworkDerivation` (~724+ lines) re-render live networks
because the text does not carry cache members (B7) — the "complex rerendering" the owner warned about; the
alternative is carrying them. Out of scope for 2R.6 unless the owner says otherwise.

**Case set** (`test/fixtures/network-text/`):
- Rewrite: all of `accept/b4-eno-lines.cases` (16), `split-of-eno`, `r5-comparison-eno`, `named-eno-pin`,
  `r5-named-eno-pin-and-output`, `execute-*`, `eno-feeds-parallel`, `branch-camc`, `call-without-en-read-by-eno`
  (→ `ready := d1 : Dryer(iOn := on);`, X9); every call to named pins and `inst : TYPE`; every FB read to `.name`;
  every lone jump/return to `JMP l := ;` / `RETURN := ;`; every `R_EDGE(…)` to the prefix; pin flags in word boxes to the backticked call with formals.
- Delete: refuse `open-line-*` (3), `eno-after-semicolon`, `eno-one-line-read-twice`, `eno-root-*` (4),
  `eno-modifier-on-root`, `jump-no-semicolon`, `enabled-comparison-unbracketed`,
  `enabled-comparison-in-tail-unbracketed`, `enabled-comparison-in-branch-unbracketed`, `en-in-call-argument`,
  `two-statements-one-line`; accept `line-wrapped`, `enabled-comparison-top`/`-value`/`-in-call`.
- Turn into accepts (measurement 5): `enabled-add-as-value`, `enabled-move-coil`, `enabled-call-as-value`,
  `enabled-call-in-word` (bracketed as an operand).
- Re-spell: `empty-slot-call-form`, `negated-pin-call-form`, `lowercase-call-form`, `not-box`, `move-call-form-*`,
  `r5-rising-pin`, `r5-negated-en*`.
- Gain, one case per row: 1a, 1d (both orders), 2 (split in EN / input slot: `EN (split1 := c)`), 3a/3b/3c/4b/4c/7b
  (refusals by name), 4a (`.Q`, and the bare read through a declared `ENO`), 5, 6, 7a, 8, 9 (EXECUTE in a chain, a
  BRANCH feed, an AND operand), 10, 11 (both orders); `y := (x := a)` vs `y := x := a`; `NOT EN c` vs `EN NOT c`;
  `R_EDGE NOT x`, `R_EDGE (a AND b)`, `f(R_EDGE NOT IN := v)`; `BRANCH (…)` with no feed; escapes (`$L`
  in a comment, a `# Network text v2.1 — specification (draft, 2026-10-17)

Sources: readability.md "2R.6 proposal v2" + "v2 review", tasks.md 2R.6 (the 10:01 "option 1" entry), the four-lens
review panel (one-to-one, plain walk, flow, exceptions), v2-measurements.md (CODESYS SP21 runs; TwinCAT stores/builds),
DIALECT N16 N17 N20 N21 N41 C11 C13, awkward-sweep.md. Model: `Format/Network/NetworkModel.cs`.
Yardstick (owner): "just follow the NWL and write it down in human readable text — a 1 to 1 transpiler."

## 1. The one rule

The **writer** walks each network's NWL items in stored order and each item's tree root first; every node is written
by the one template of its kind (section 2), its children where NWL holds them, in stored order. The **reader** is the
inverse: it accepts exactly the token sequences the writer produces, with any layout that passes the one indentation
check (section 4), and builds the tree they name. One tree has one text; a text the writer would not produce for its
tree (a redundant bracket, `TITLE: ""`, a call form where the word fits) is refused because no tree prints it, not by
a rule of its own. Nothing is reordered, hoisted or reconstructed. Section 5 lists what is not "node → template".

## 2. Node table

| NWL node · member | spelling | example |
|---|---|---|
| body `DefaultViewMode` | `IMPLEMENTATION LD` / `FBD` | |
| network `Label`, `OutCommented`, `Title` | `NETWORK [LABEL: x] [DISABLED] [TITLE: "…"]`; empty title = none | `NETWORK LABEL: done TITLE: "Fill"` |
| network `Comment` | one `//` line per stored CR LF line | `// start the pump` |
| a network the text cannot spell | `UNSUPPORTED "<shape>" #<hash>;` alone; hash = 8 hex of the stored network | `UNSUPPORTED "a Mux box" #3f9a01c2;` |
| item | its tree, then `;` | `lamp := a;` |
| **Assign** `Targets` | coils left to right, value after the last | `lamp := motor := start;` |
| target coil state (the Negation + Set bits: four states) | `:=` · `NOT x :=` · `x S=` · `x R=` | `NOT x := a;` `x S= a;` `x R= ;` |
| target `Rising` / `Falling` | before `NOT`: `R_EDGE x :=` / `F_EDGE NOT x :=` | `R_EDGE x := a;` |
| `Jump` / `Return` | the coil head `JMP label` / `RETURN` | `JMP done := a;` `RETURN := ;` |
| nested **Assign** | bracketed, in any slot | `y := (x := a);` |
| `Value` = **Terminator** | nothing; `Negated` = `NOT` | `lamp := ;` `x := NOT;` |
| **Leaf** `Operand.Text` | the token; backticked when reserved, `split<n>` or not one token | `a` `` `ENO` `` `` `arr[i]` `` `-1` `'txt'` |
| Leaf / Box `Flags` | prefix `[R_EDGE\|F_EDGE] [NOT]` (negate first, N17); a box after a modifier is bracketed | `up := R_EDGE clk;` `x := R_EDGE NOT clk;` `y := R_EDGE (a AND b);` `lamp := NOT (MOVE 1 => t ENO EN c);` |
| **Box**, operator | the word as `BoxType` stores it, between its inputs, slot order; MOVE before its one input | `x := a ADD b ADD c;` `MOVE b => a;` |
| Box, operator the word cannot hold (NOT box; MOVE with 0 or 2 inputs) | backticked head, positional pins | ``x := `NOT`(a);`` |
| Box, function / method | `f(pins)` / `inst.m(pins)` | `y := LIMIT(MN := 0, IN := v, MX := 100);` |
| Box, FB: `Instance` + `BoxType` | `inst : TYPE(pins)` | `t1 : TON(IN := a, PT := T#1S);` `??? : TON(IN := a);` |
| Box `StCode` (Execute) | `EXECUTE` ⏎ ST ⏎ `END_EXECUTE` | |
| `Inputs` of a word box | operands, positional, slot order | `a SUB b` |
| `Inputs` of a call | `formal := v`, stored slot order, before the outputs; `()` = zero pins | `f(IN := a)` `g()` |
| `Input.Value` = Terminator | nothing | `x := MUL a MUL 6;` `c1 : CTU(CU := a, RESET := , PV := 10);` |
| `Input.Flags` | `mods` before the pin's formal, in a call (a word box with a flagged pin is written as its backticked call with formals) | `f(NOT IN := v)` (pin) vs `f(IN := NOT v)` (contact); `` x := `AND`(IN1 := a, NOT IN2 := b); `` |
| `Outputs` (data, slot order) | word box: `=> x`, positional; call: `name => x`, after the inputs | `a ADD b => x;` `f(IN := a, err => e)` |
| output pin flags | `mods` before the output's name, in a call | `` `MOVE`(a, NOT => x); `` (MEASURE) |
| `HasEnoOutput` on a box with EN | `ENO` after the outputs | `MOVE 0 => x ENO EN c;` |
| the ENO slot wired | `ENO => v` | `MOVE 7 => x ENO => lamp EN c;` |
| `Enable` (input slot 0) | `EN src`, last; Terminator = bare `EN` | `MOVE 1 => a ENO EN start;` `x ADD 1 => x ENO EN;` |
| `EnableFlags` | `mods EN src` | `MOVE 5 => y ENO NOT EN c;` (pin) vs `MOVE 5 => y ENO EN NOT c;` (contact) |
| `ConnectedSlot` (the null's position, measurement 12) | `ENO` shown → through ENO; FB → `.name`; nothing on an FB → its declared `ENO`; word or function → its value | `lamp := a GT 5 EN c;` |
| `MainOutputName` | `.name` on every FB read by a data output; never on a function, never `.ENO` | `x := t1 : TON(IN := a, PT := T#1S).Q;` |
| **Parallel** `Input`, `Branches`, `Mode` | `[feed] BRANCH (b1, b2, …)`; `SHORTCIRCUIT` = `BoxShortCircuit`, nothing = `Sequential`; no feed = `BRANCH (…)` | `lamp := start BRANCH (a, , b) SHORTCIRCUIT;` |
| **Demux** with `Input` / without | `split<VarId> := v` (nested: bracketed) / `split<VarId>` | `split1 := a AND b;` `MOVE 1 => t ENO EN (split1 := c);` |

A pin flag is written before the pin's name, never as a mark (owner 2026-10-17: no new keyword or mark).
A word box has no pin names, so the rare word box with a flagged pin is written as its backticked call with formals;
that is the word/call choice's one remaining case beside MOVE with 0 or 2 inputs. On EN, `NOT EN c` negates the pin and
`EN NOT c` the contact: two positions, no collision, because a word box's operands never carry a pin flag.

**Text.** Delimited text (a `//` line, a `"title"`, a `` `backtick` `` operand) is verbatim with one
escape, IEC's: `$$` `$'` `$"` `$L` `$N` `$R` `$T`; inside backticks a backtick is doubled. A comment's stored CR LF is
the next `//` line; a bare LF or CR is `$L` / `$R`. **An EXECUTE body is ST and stays
exactly as written, with no escape** (owner 2026-10-17): its stored CR LF is a text line end, its lines are text, not
items, and the indent of `END_EXECUTE` is layout. A body holding a line that starts with `END_EXECUTE`, or a lone CR or
LF, has no text and is refused by name.

**Members not carried** (B7; an unchanged network is never rebuilt and keeps them byte for byte, N28; a rebuild that
drops a stored value is named by `RebuildLoss`):

| member | why not in the text |
|---|---|
| `CallType`, a function's output list, `Kind` | derived on push from the declarations (2R.4) |
| `OutputParam.Names` / `.Types` of calls, `Operand.Type`, `Instance.Type`, `Comment`/`IsLValue`/`IsInstance`, the `EN`/`ENO` bools, zero `InputFlags`, `Extensible`, `IL*`/`FBDValid`, the item's Jump/Return echo (C13), a return's `???` target | derived (D) or editor cache (C), measured to run the same |
| item `Id`s, STSnippet line ids, TextDocument caches, `BranchCounter`, `Fixed`, `Boolean`, the `Address` sentinel | cache (2R.4) |
| a function's result name `'   '`, a bit operator's stored slot `['']`, a split's stored type that differs from its feeder's (N25) | lost on rebuild (L), measured inert |
| two stored values, one text: an operator pin's default formal (`IN1`/`IN2`) vs none; `Title`/`Comment` `""` vs null; a Leaf whose `Operand.Flags` echoes `Leaf.Flags` vs null | lost on rebuild (L), deliberately |
| `SymbolComment` | shown, edit refused (E) — no measured door to write it |
| `NetworkListComment`, `ValidIds` | body-level, derived; a differing value makes the body UNSUPPORTED (P11) |
| `BoxTreeMux`, `ILStatement`/`ILLines`, `Connectors`, a Terminator with an `Input` | `UNSUPPORTED` (unmakeable, unmeasured, or crashes CODESYS — #5, #7, #8, #6b) |

## 3. Grammar

```ebnf
body      = "IMPLEMENTATION" , ( "LD" | "FBD" ) , NL , { network } ;
network   = header , NL , { comment } , ( unsupported | { item } ) , "END_NETWORK" ;
header    = "NETWORK" , [ "LABEL:" , name ] , [ "DISABLED" ] , [ "TITLE:" , string ] ;
comment   = "//" , [ " " , text ] , NL ;
unsupported = "UNSUPPORTED" , string , "#" , hex8 , ";" ;
item      = [ top ] , ";" ;                               (* `;` alone = the empty item *)
top       = assign | split | slot ;
assign    = coil , { coil } , slot ;
coil      = [ edge ] , ( [ "NOT" ] , head , ":=" | head , ( "S=" | "R=" ) ) ;
head      = target | "JMP" , name | "RETURN" ;
split     = splitname , ":=" , slot ;
slot      = box | parallel | term | "(" , ( assign | split ) , ")" ;
term      = [ mods ] , ( atom | call ) | mods , "(" , box , ")" | splitname | "NOT" | (* empty *) ;
operand   = term | "(" , ( box | parallel | assign | split ) , ")" ;
box       = ( wordbox | movebox | call | execute ) , pinstate ;
wordbox   = opnd , word , opnd , { word , opnd } , { output } ;   (* one word per box *)
movebox   = "MOVE" , opnd , { output } ;
opnd      = operand ;
output    = "=>" , target ;
call      = [ name , ":" ] , ( target | "`" , word , "`" ) , "(" , [ pin , { "," , pin } ] , ")" , [ "." , name ] ;
pin       = [ mods ] , name , ":=" , slot | [ mods ] , name , "=>" , target | operand ;
execute   = "EXECUTE" , NL , { text , NL } , "END_EXECUTE" ;
pinstate  = [ "ENO" , [ output ] ] , [ [ mods ] , "EN" , slot ] ;
parallel  = [ operand - empty ] , "BRANCH" , "(" , slot , "," , slot , { "," , slot } , ")" , [ "SHORTCIRCUIT" ] ;
mods      = edge , [ "NOT" ] | "NOT" ;
edge      = "R_EDGE" | "F_EDGE" ;
atom      = token | backtick ;
target    = token | backtick ;
name      = token | backtick ;
splitname = "split" , digit - "0" , { digit } ;
backtick  = "`" , { char - "`" | "``" } , "`" ;
word      = "AND" | "OR" | "XOR" | "ADD" | "SUB" | "MUL" | "DIV" | "MOD" | "GT" | "GE" | "EQ" | "NE" | "LE" | "LT" ;
```

`S=` and `R=` are single tokens. Reserved (case-insensitive): `EN ENO BRANCH SHORTCIRCUIT JMP RETURN EXECUTE
END_EXECUTE NOT R_EDGE F_EDGE NETWORK END_NETWORK UNSUPPORTED MOVE`, the words, `split<digits>`; a name spelled like
one is backticked (a callee, an instance, a pin, a `.name`). The positional `pin` is the backticked operator call's
only. Brackets mean one thing: a compound (box, parallel, assignment, split definition) standing as an operand, after
a modifier, or nested in a slot. A call is never bracketed for itself (it carries its own); a call with no pinstate is
the same node as a term or a box. The reader is LL(1) except the coil head, which looks ahead to `:=` / `S=` / `R=`
over a bounded `[edge] [NOT] head`.

## 4. Layout

Whitespace and newlines are layout outside the header line, a `//` line and an EXECUTE body. **The one check:** a
continuation line of an item is indented deeper than the item's first line; a line that is not is refused "missing
`;`?". It refuses; it never decides meaning. The writer's layout, which the next pull shows — the staircase for every
EN source holding a box (inside brackets too), one branch per line where a branch holds a chain:

```
lamp := MOVE 3 => c ENO EN
          MOVE 2 => b ENO EN
            MOVE 1 => a ENO EN start;

x := a AND (MOVE 1 => t ENO EN
              MOVE 2 => u ENO EN c);

lamp := start BRANCH (a,
                      MOVE 1 => t ENO EN
                        MOVE 2 => u ENO EN c,
                      d);

done := EXECUTE
i := i + 1;
  END_EXECUTE ENO EN go;
```

`lamp := MOVE 3 => c ENO EN MOVE 2 => b ENO EN MOVE 1 => a ENO EN start;` on one line reads to the same tree.

## 5. Exceptions

**Removed** (each was an exception; what replaces it):

| # | was | now |
|---|---|---|
| X2 | operator vs call form | the word; a word-named call head is backticked (P1). Left: MOVE with 0/2 inputs (MEASURE) |
| X5 | lone `JMP l;` / `RETURN;` | `JMP l := ;` / `RETURN := ;` (C11: the stored value is the Terminator of `x := ;`) |
| X6 | `??? : TYPE` only for an unnamed instance | every FB writes `inst : TYPE` |
| X7, X15 | no `NOT x S=`; no flag on a parallel or split | the model: a coil has four states; Parallel/Demux hold no flag (N20). The grammar does not spell `NOT x S=`, `NOT (s BRANCH …)`, `NOT split1` |
| X11 (library) | a library callee's `.name` slot unknown | a Volt gap: the in-proc library signatures are reachable (section 7) |
| X14, text limits | bare LF in a comment; other unspellable text | one escape (section 2, Text) |
| reserved-name refusals | POU/instance named `R_EDGE`, a pin named `EN`, a `.name` spelled like a word | the backtick (P1) |

**Vendor fact** (measured; the refusal names it):

| # | rule | measured |
|---|---|---|
| X3 | an operator box with EN read through ENO needs its data output wired: `x := MOVE 1 => t ENO EN c` | 3c, both vendors |
| X8 | `R_EDGE NOT x` negates first | N17 (TwinCAT: MEASURE) |
| X9 | `ENO` only on a box with EN; an FB that declares `ENO` is read by rule or by `.Q`, never `.ENO` (refused) | 4a–4c |
| X10 | on a box with EN, "shows `ENO`" = "connected through ENO"; read by its value or `.name` is refused; a positional `=> x` fills the next output slot after ENO and the connected one | 3a, 3b, 12 (N16) |
| X12 | `ENO => v` at top level is spelled (LSP warning: never writes `v`); with a consumer it is refused | 7a, 7b |
| X13 | a parallel needs ≥ 2 branches; an operator ≥ 2 inputs; SUB exactly 2 | C0023, C0022; DIV/MOD/comparisons by analogy (MEASURE) |
| X17 | a split is defined once per network | #19, measurement 2 |

**Vendor semantics → LSP hints** (spelled as stored; the IDE runs them so, N41, 1b, 1c, 1e, 7a):
`x := NOT;` writes TRUE · an edge coil runs as a plain coil · `S=`/`R=` on JMP/RETURN latches nothing · a jump nested
in a coil skips that coil when taken · an empty branch is a shorted branch · operator words read their operands after
the nested boxes ran · a disabled box's input boxes still run · `ENO => v` never writes `v`.

**MEASURE, then spell or refuse by name** (spelled by the grammar; the push refuses by name until measured):
a modified jump or return; an edge beside `S=`/`R=`; an edge on EN; `NOT;` beside another coil; a modified coil
beside another coil; a negated output pin; rising and falling on one node; a flag on an Execute box; a Terminator-fed
Parallel (`NOT BRANCH (…)`); a split read inside its own definition; a split referenced and never defined; MOVE with
0 or 2 inputs; 3-input DIV/MOD/comparisons; X3 on functions; a function read by a declared output; a call pin stored
without a formal; TwinCAT edge order (needs the owner's trial licence, N17).

**Owner-kept text orders** (section 6, D1): EN and ENO.

## 6. Flow

- **Text order = stored order**, with two exceptions: `EN` is input slot 0 but written last (X1), and `ENO` is output
  slot 0 but written after the data outputs. Networks, items, an Assign's coils, a box's inputs and outputs, a
  parallel's branches are written in stored order. Moving text moves stored order.
- **Run rules** (measured):
  1. Every box nested in a box runs before it — its EN source first, then its inputs in slot order — whether or not
     it is enabled (1a–1d).
  2. Operator words read their operands after all nested boxes have run (1e).
  3. Coils are written after the value; on one variable the last stored coil wins (11).
- A pure EN chain therefore runs bottom-up; nothing else is read from layout. Within an item a split's position is
  irrelevant; across items, a read before the definition is the previous scan (X17).

```
MOVE (MOVE 2 => t ENO EN d) => x ENO EN
  MOVE 1 => s ENO EN c;
```

Written: the outer MOVE, its input box, its EN box. Runs: `MOVE 1` (EN slot), `MOVE 2` (input), the outer MOVE.

**MEASURE** before the doc claims more: a Parallel's run order, and whether `SHORTCIRCUIT` skips later branches'
boxes (rule 1 covers boxes nested in a box, not branches); an operator box with an output pin read by its consumer
(`(a ADD 1 => t) GT t`); the reach of 1e (its own consumer, or the whole item); a coil and an output pin writing one
variable; a plain `JMP`/`RETURN` coil beside a data coil.

## 7. Implementation

**BLOCKING:** the CODESYS writer builds an Execute box in one `SetObject` commit; measurement 9 shows its ST does not
run until committed again or reloaded. Today's writer probably has it too. Fix and run-check before 2R.6 lands.

**Checks out of the walk:** one shared validator over the model — splits defined once and referenced, the jump
item-flag echo (C13), X3/X9/X10/X12/X13, the unmeasured compositions — called by both vendor readers, the text
reader, the writer and the LSP. `NetworkTextGate`'s write + re-read becomes a test oracle, not a runtime step; the
writer's UNSUPPORTED catch-and-retry goes (validate first).

**Writer** (`NetworkTextWriter`, `NetworkText`, `NetworkSpelling`): one buffer, the column passed down — no
`Layout()` post-pass, no U+0001–U+0003 markers. Deleted: open-line hoisting (`Item()` levels + reverse, `EnoRead`,
`TextHasEno`), `EnabledComparison*`, `EnoCarried` (ENO is the pin, written from `HasEnoOutput`), the operator call form,
the `JMP l;` rail form.
**Reader** (`NetworkTextReader`, `NetworkLexer`): recursive descent; `consumed` passed down from the parent; outputs
numbered at the node's end (local); no `BoxSyn`/`Finalize(role)`, no open-line queue, no `Role.Eno`, no `LineEnd*`.
**Model:** drop `MainOutputIndex` (measurement 12: the null's position is the connection); `HasEnoOutput`,
`ConnectedSlot` and `Output.Slot` become total (no null).
**Drivers:** `CodesysNetworkWriter.RefuseUnbuildableEno` → the shared validator; `CodesysNetworkReader.UnstoredMainOutput`
re-examined (measurement 12). A push of `.name` needs the slot index of `name`: a project callee's declaration, or
the in-proc library signature (reachable; 2R.4b).
**LSP** (`frontend/syntax/network/`): the same in `statements.ts` (LineEnd), `values.ts` (OpenLine), `boxes.ts`,
`words.ts`; the ENO hover ("the line it takes") goes.
**Size:** core ~3,229 → ~1,450 lines; LSP port ~3,054 → ~1,300.
**TwinCAT:** `TcUnmeasured`'s structural-edit refusals on dev (parallel, `=> v`, pin flags, nested assigns/splits,
edge/negated coils, …) guard the PLCopen route the native-writer merge (in progress) removes; re-check the list after
it lands.
**Flag (D8):** `NetworkPairing`/`RebuildLoss`/`NetworkMembers`/`NetworkDerivation` (~724+ lines) re-render live networks
because the text does not carry cache members (B7) — the "complex rerendering" the owner warned about; the
alternative is carrying them. Out of scope for 2R.6 unless the owner says otherwise.

**Case set** (`test/fixtures/network-text/`):
- Rewrite: all of `accept/b4-eno-lines.cases` (16), `split-of-eno`, `r5-comparison-eno`, `named-eno-pin`,
  `r5-named-eno-pin-and-output`, `execute-*`, `eno-feeds-parallel`, `branch-camc`, `call-without-en-read-by-eno`
  (→ `ready := d1 : Dryer(iOn := on);`, X9); every call to named pins and `inst : TYPE`; every FB read to `.name`;
  every lone jump/return to `JMP l := ;` / `RETURN := ;`; every `R_EDGE(…)` to the prefix; pin flags in word boxes to the backticked call with formals.
- Delete: refuse `open-line-*` (3), `eno-after-semicolon`, `eno-one-line-read-twice`, `eno-root-*` (4),
  `eno-modifier-on-root`, `jump-no-semicolon`, `enabled-comparison-unbracketed`,
  `enabled-comparison-in-tail-unbracketed`, `enabled-comparison-in-branch-unbracketed`, `en-in-call-argument`,
  `two-statements-one-line`; accept `line-wrapped`, `enabled-comparison-top`/`-value`/`-in-call`.
- Turn into accepts (measurement 5): `enabled-add-as-value`, `enabled-move-coil`, `enabled-call-as-value`,
  `enabled-call-in-word` (bracketed as an operand).
- Re-spell: `empty-slot-call-form`, `negated-pin-call-form`, `lowercase-call-form`, `not-box`, `move-call-form-*`,
  `r5-rising-pin`, `r5-negated-en*`.
- Gain, one case per row: 1a, 1d (both orders), 2 (split in EN / input slot: `EN (split1 := c)`), 3a/3b/3c/4b/4c/7b
  (refusals by name), 4a (`.Q`, and the bare read through a declared `ENO`), 5, 6, 7a, 8, 9 (EXECUTE in a chain, a
  BRANCH feed, an AND operand), 10, 11 (both orders); `y := (x := a)` vs `y := x := a`; `NOT EN c` vs `EN NOT c`;
  `R_EDGE NOT x`, `R_EDGE (a AND b)`, `f(R_EDGE NOT IN := v)`; `BRANCH (…)` with no feed; escapes (`$L`
  in a comment,  kept verbatim in an EXECUTE body, a doubled backtick); `UNSUPPORTED` with a hash; layout: staircase, one line,
  odd indentation read to one model, and a continuation line not deeper refused "missing `;`?"; refused: `.ENO`,
  `NOT x S=`, `NOT split1`.

## 8. Owner decisions (defaults applied above)

- **D1** EN written last (X1) — keep.
- **D2** FB boxes write `inst : TYPE(…)` — yes.
- **D3** item boundary: the continuation-indentation check — yes.
- **D4** `JMP l := ;` / `RETURN := ;` — yes.
- **D5** one escape for comments, titles and backticked operands — yes; an EXECUTE body stays verbatim ST (owner).
- **Pin flags** are written before the pin's name (`f(NOT IN := v)`, `NOT EN c`), no mark (owner: no new keyword).
- **D6** named input pins in every call — yes.
- **D7** `ENO => v` spelled with an LSP warning — yes.
- **D8** the B7 re-render machinery — out of scope for 2R.6; flagged.

The 09:32 "FINAL" paragraph of tasks.md 2R.6 is superseded by this spec.
