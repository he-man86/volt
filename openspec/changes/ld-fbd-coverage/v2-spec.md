# Network text v2 — specification (draft, 2026-10-17)

Sources: readability.md "2R.6 proposal v2" + "v2 review" (fixes adopted by the owner), tasks.md 2R.6 (latest wins: the
10:01 "option 1 — v2 with the staircase" entry supersedes the 09:32 "FINAL" paragraph above it, which kept open lines),
v2-measurements.md (5706cb890e, CODESYS SP21 runs; TwinCAT stores/builds), DIALECT N16 N17 N20 N21 C11, awkward-sweep.md.
Yardstick (owner): "just follow the NWL and write it down in human readable text — a 1 to 1 transpiler."

## 1. The one rule

The **writer** walks each network's NWL items in stored order and each item's tree root first; every node is written
by the one template of its kind (section 2), its children where NWL holds them, in stored order. The **reader** is the
inverse: it accepts exactly the token sequences the writer produces, with any layout (section 4), and builds the tree
they name. One tree has one text; a text the writer would not produce for its tree (a redundant bracket, `TITLE: ""`,
a call form where the word fits) is refused because no tree prints it, not by a rule of its own. Nothing is reordered,
hoisted or reconstructed. What does not fit this is listed in section 5.

## 2. Node table

Model: `Format/Network/NetworkModel.cs`. "Walk" = the template only, no look outside the node.

| NWL node · member | spelling | example | walk |
|---|---|---|---|
| body `DefaultViewMode` | `IMPLEMENTATION LD` / `FBD` | | yes |
| `NetworkList` order | network order | | yes |
| network `Label`, `OutCommented`, `Title` | `NETWORK [LABEL: x] [DISABLED] [TITLE: "…"]` — title exact, empty = none | `NETWORK LABEL: Done TITLE: "Fill"` | yes |
| network `Comment` | one `//` line per CR LF-separated line | `// start the pump` | yes (X14) |
| a network the text cannot spell (Volt's `Unsupported`) | `UNSUPPORTED "<shape>";` alone | `UNSUPPORTED "a flag on a box input pin";` | yes |
| item | its tree, then `;` | `lamp := a;` | yes |
| **Assign** `Targets` | coils left to right, value after the last | `lamp := motor := start;` | yes |
| target `Set` / `Reset` (the vendor's Negation+Set bits) | `S=` / `R=` | `x S= a;` `x R= ;` | yes (X7) |
| target `Negated` / `Rising` / `Falling` | before the coil | `NOT x := a;` `R_EDGE x := a;` | yes |
| `Jump` / `Return` | the coil `JMP label` / `RETURN` | `JMP Done := a AND b;` `RETURN := NOT ready;` | yes (X5) |
| `Value` = **Terminator** | nothing | `lamp := ;` | yes |
| Terminator `Negated` | `NOT` | `x := NOT ;` | yes (X16) |
| **Leaf** `Operand.Text` | the token; backticked when it is a word, `split<n>` or not one token | `a` `` `ENO` `` `` `INT_TO_TIME(n)` `` `-1` `'txt'` | yes |
| Leaf `Negated` | `NOT x` | `lamp := NOT a;` | yes |
| Leaf `Rising` / `Falling` (+`Negated`) | `R_EDGE(x)` / `F_EDGE(x)`; both bits `R_EDGE(NOT x)` | `up := R_EDGE(clk);` | yes (X8) |
| **Box**, operator: `BoxType` + `Inputs` | the word between its inputs, slot order; MOVE before its one input | `x := a ADD b ADD c;` `MOVE b => a;` | yes |
| Box, function: `BoxType` + `Inputs` | `name(pins)` | `y := LIMIT(0, v, 100);` | yes |
| Box, FB: `Instance` + `Inputs` | `instance(pins)` | `t1(IN := a, PT := T#1S);` | yes |
| Box, FB with `Instance` `???` | `??? : TYPE(pins)` | `??? : TON(IN := a);` | yes (X6) |
| Box `StCode` (Execute) | `EXECUTE` ⏎ raw ST ⏎ `END_EXECUTE` | | yes |
| `Input.Formal` (call) | `name := v`; positional when none | `t1(IN := a)` | yes |
| `Input.Value` = Terminator | nothing | `ctu(CU := a, RESET := , PV := 10);` `x := MUL a MUL 6;` | yes |
| `Input.Flags` | **PROPOSAL** `[NOT]` / `[R_EDGE]` / `[F_EDGE]` before the pin (P-2) | `x := a AND [NOT] c;` | yes |
| `Outputs` (data, slot order) | `=> x` after a word box; `name => x` / `=> x` inside a call's brackets | `a ADD b => x;` `f(a, err => e)` | yes (X10) |
| `HasEnoOutput` on a box with EN | `ENO` after the outputs | `MOVE 0 => x ENO EN c;` | yes (X9) |
| the ENO slot wired to a variable | `ENO => v` | `MOVE 7 => x ENO => lamp EN c;` | yes (X12) |
| `Enable` (input slot 0) | `EN src` after `ENO`; Terminator = bare `EN` | `MOVE 1 => a ENO EN start;` `x ADD 1 => x ENO EN;` | **no** (X1) |
| `EnableFlags` | `NOT EN` (PROPOSAL P-2: `[NOT] EN`) | `MOVE 5 => y ENO NOT EN c;` | yes |
| Box `Flags` | `NOT (…)` / `R_EDGE(…)` around the box | `lamp := NOT (MOVE 1 => t ENO EN c);` | yes |
| `ConnectedSlot` + `MainOutputIndex` | the consumer's connection: `ENO` shown → through ENO; no `ENO` → the value; `.name` → that output | `lamp := a GT 5 EN c;` | yes (X9–X11) |
| `MainOutputName` | `.name` after the call | `x := fb(go := a).busy;` | yes (X11) |
| **Parallel** `Input`, `Branches`, `Mode` | `[feed] BRANCH (b1, b2, …)`, `SHORTCIRCUIT` for `BoxShortCircuit`, nothing for `Sequential` | `lamp := start BRANCH (a, , b) SHORTCIRCUIT;` | yes (X13) |
| **Demux** with `Input` / without | `split<VarId> := v` (nested: bracketed) / `split<VarId>` | `split1 := a AND b;` `lamp := split1;` | yes (X17) |

**Members not carried** (B7, design "2R.2"/"2R.4"; an unchanged network is never rebuilt and keeps them byte for byte,
N28; a rebuild that drops a stored value is named by `RebuildLoss`):

| member | why not in the text |
|---|---|
| `CallType`, a FUNCTION's input formals and output list, FB `BoxType`, `Kind` | derived on push from the declarations (2R.4) |
| `OutputParam.Names` / `.Types` of calls, `Operand.Type`, `Instance.Type`, `Comment`/`IsLValue`/`IsInstance`, the `EN`/`ENO` bools, zero `InputFlags`, `Extensible`, `IL*`/`FBDValid`, the item's Jump/Return echo (C13), a return's `???` target | derived (D) or editor cache (C), measured to run the same |
| item `Id`s, STSnippet line ids, TextDocument caches, `BranchCounter`, `Fixed`, `Boolean`, the `Address` sentinel | cache (2R.4) |
| a function's result name `'   '`, a bit operator's stored slot `['']`, a split's stored type that differs from its feeder's (N25) | lost on rebuild (L), measured inert |
| `SymbolComment` | shown, edit refused (E) — no measured door to write it |
| `NetworkListComment`, `ValidIds` | body-level, derived; a differing value makes the body UNSUPPORTED (P11) |
| `BoxTreeMux`, `ILStatement`/`ILLines`, `Connectors`, a Terminator with an `Input` | no spelling: the network is `UNSUPPORTED` (unmakeable, unmeasured, or crashes CODESYS — #5, #7, #8, #6b) |

## 3. Grammar

```ebnf
body      = "IMPLEMENTATION" , ( "LD" | "FBD" ) , NL , { network } ;
network   = header , NL , { comment } , ( unsupported | { item } ) , "END_NETWORK" ;
header    = "NETWORK" , [ "LABEL:" , name ] , [ "DISABLED" ] , [ "TITLE:" , string ] ;
comment   = "//" , [ " " , { char - NL } ] , NL ;
unsupported = "UNSUPPORTED" , string , ";" ;
item      = [ top ] , ";" ;                                    (* one NWL item; `;` alone = the empty item *)
top       = assign | split | slot ;
assign    = coil , { coil } , [ slot | "NOT" ] ;               (* targets in stored order; nothing = the rail *)
coil      = [ modifier ] , ( target | "JMP" , name | "RETURN" ) , ( ":=" | "S=" | "R=" ) ;
split     = splitname , ":=" , slot ;
slot      = box | parallel | operand ;                         (* coil value, EN source, pin, argument, branch, split value *)
box       = ( wordbox | movebox | call | execute ) , pinstate ;
wordbox   = opnd , word , opnd , { word , opnd } , { "=>" , target } ;   (* one word kind per box *)
movebox   = "MOVE" , opnd , { "=>" , target } ;
call      = head , "(" , [ pin , { "," , pin } ] , ")" , [ "." , name ] ;
head      = target | "???" , ":" , name ;
pin       = [ pinmark ] , [ name , ":=" ] , [ slot ] | [ name ] , "=>" , [ target ] ;
execute   = "EXECUTE" , NL , { st-line } , "END_EXECUTE" ;
pinstate  = [ "ENO" , [ "=>" , target ] ] , [ [ pinmark | "NOT" ] , "EN" , [ slot ] ] ;
parallel  = [ opnd ] , "BRANCH" , "(" , [ slot ] , "," , [ slot ] , { "," , [ slot ] } , ")" , [ "SHORTCIRCUIT" ] ;
opnd      = [ pinmark ] , ( operand | "(" , ( compound | assign | split ) , ")" ) | (* empty slot *) ;
compound  = box | parallel ;                                   (* never a call with no pinstate: it carries its own brackets *)
operand   = [ "NOT" ] , ( atom | "(" , compound , ")" ) | edge ;
edge      = ( "R_EDGE" | "F_EDGE" ) , "(" , [ "NOT" ] , ( atom | compound ) , ")" ;
atom      = token | backtick | splitname | call ;              (* a call here has no pinstate *)
pinmark   = "[" , modifier , "]" ;                             (* PROPOSAL P-2 *)
modifier  = "NOT" | "R_EDGE" | "F_EDGE" ;
target    = token | backtick ;
splitname = "split" , digit - "0" , { digit } ;
backtick  = "`" , { char - "`" } , "`" ;
word      = "AND" | "OR" | "XOR" | "ADD" | "SUB" | "MUL" | "DIV" | "MOD" | "GT" | "GE" | "EQ" | "NE" | "LE" | "LT" ;
```

Reserved (case-insensitive): `EN ENO BRANCH SHORTCIRCUIT JMP RETURN EXECUTE END_EXECUTE NOT R_EDGE F_EDGE NETWORK
END_NETWORK UNSUPPORTED MOVE`, the words, `split<digits>`. The bracket rule is the `opnd` production: a box, a parallel,
an assignment or a split definition standing as a word's operand, a modifier's operand or a BRANCH feed is bracketed;
a slot never is. Brackets mean nothing else.

## 4. Layout (the writer's, never the reader's)

Whitespace and newlines are layout everywhere outside the header line, a `//` line and an EXECUTE body; the reader
ignores indentation. The writer's canonical layout, which the next pull shows:

```
lamp := MOVE 3 => c ENO EN                 // staircase: a box in an EN slot on the next line, one step deeper
          MOVE 2 => b ENO EN
            MOVE 1 => a ENO EN start;

lamp := start BRANCH (a,                   // one branch per line
                      b AND c,
                      d);

done := EXECUTE
i := i + 1;
  END_EXECUTE ENO EN go;
```

`lamp := MOVE 3 => c ENO EN MOVE 2 => b ENO EN MOVE 1 => a ENO EN start;` on one line reads to the same tree.

## 5. Exceptions — for the owner to sign

Everything that is not "node → its template".

| # | rule | status |
|---|---|---|
| X1 | EN is input slot 0 but written last, after the outputs (`MOVE 1 => a ENO EN c`). The only place text order ≠ stored child order. | **OWNER** (v2 rule 1). Fixed per template; the reader puts it back at slot 0, so a round trip keeps the run order. Removable only by an EN-first spelling (`EN c MOVE 1 => a`). |
| X2 | Word or call: an operator box is its word; a function/FB a call. A word-named box the word cannot hold is a call with a backticked head (P1). | **REDUCED-BY** P-1…P-4 to two-input/zero-input MOVE (P-4, measure). |
| X3 | An enabled operator box read through ENO needs its data output wired: `x := MOVE 1 => t ENO EN c`. | **VENDOR** (measurement 3c: every other form stores and does not build, both vendors). |
| X4 | Unmeasured compositions: a modified jump or return; an edge beside `NOT`/`S=`/`R=`; an edge with `NOT` on one pin; an edge on EN; `NOT ;` outside one plain coil; a modified coil beside another coil; a split read inside its own definition (`r5-unmeasured.cases`). The grammar spells them; the push refuses by name. | **MEASURE** — each lifts with a store/build/run. |
| X5 | The lone unconditional jump/return is `JMP l;` / `RETURN;`, not `JMP l := ;` like every other coil on the rail. | **REMOVE-BY** writing `JMP l := ;` / `RETURN := ;` (the coil template; C11's Terminator is already the stored value). Owner to choose. |
| X6 | An FB box whose instance is `???` writes its type (`??? : TON(…)`); every other FB box's type comes from its instance's declaration. | **VENDOR** (`Box.UnnamedInstance`: `???` is declared nowhere). |
| X7 | No negated set or reset coil (`NOT x S=`): Negation+Set IS reset. | **VENDOR** (`Flags.CoilFromVendor`, the two bits). |
| X8 | `R_EDGE(NOT x)` means negate first. TwinCAT refuses both bits by name. | **VENDOR** (N17; TwinCAT unmeasured, no runtime licence). |
| X9 | `ENO` appears only on a box with EN: ENO without EN does not build on an operator ("Missing EN pin") or a function ("'ENO' is no component"); an FB that declares `ENO` has an ordinary output, read by rule or by `.ENO`/`.Q`. | **VENDOR** (measurements 4a–4c). |
| X10 | On a box with EN, "shows `ENO`" = "connected through ENO". A box with EN and ENO read by its value or `.name` is refused. A positional `=> x` fills the next output slot after ENO and the connected one. | **VENDOR** (3a, 3b: stores, never builds, both vendors; slot layout N16 + measurement 12: the null's position is the connection, and the push can write it). |
| X11 | `.name` is written only where the connected output is not the call's rule slot. A push needs the slot index of `name`: a project callee's declaration gives it; a library callee's signature does not yet. | **VENDOR + OPEN** (2R.4b). Measurement 12 removes N21's "pull-only": the connection is writable. |
| X12 | `ENO => v` stores and builds at the top level but never writes `v`: spelled, LSP warning. With a consumer it does not build: refused. | **VENDOR** (7a, 7b). |
| X13 | A parallel needs ≥ 2 branches; an operator ≥ 2 inputs; SUB, DIV, MOD and the comparisons exactly 2. | **VENDOR** (C0023, C0022, 2R.5 #4: stores, does not build). |
| X14 | A comment holding a bare LF (not CR LF) has no spelling; a trailing CR LF is a final bare `//`. | **TEXT LIMIT** — removable by an escape, 0 in the corpora. Owner to choose. |
| X15 | No flag on a parallel or a split (`NOT (s BRANCH (a, b))` is refused; `NOT s BRANCH (a, b)` negates the feed). | **VENDOR** (N20: the IDE holds none). |
| X16 | `NOT ;` (a negated empty slot) writes TRUE. | **VENDOR** semantics (N41), not a grammar rule. |
| X17 | A split is defined once per network; a reference in an earlier item reads the previous scan. | **VENDOR** (VarId; #19, measurement 2). |

Gone from the language (each was an exception): open lines and their ordering (P3), `;` as a signal, the word `ENO` as
a reference, "an enabled box is the root of its line", the enabled-comparison bracket (P4 (2)), the line-end rule (P2).

## 6. Flow

- **Text order = stored order.** Networks, items, an Assign's coils, a box's inputs and outputs, a parallel's branches
  are all written in stored order. Moving text moves stored order, and stored order is run order: two coils on one
  variable, the last wins (measurement 11).
- **Within an item the text is root first; the run is deepest first.** A box runs after everything nested in it, EN
  slot first, then its inputs in slot order — **whether or not it is enabled** (1b, 1c: a CTU under a disabled MOVE
  counts). Inline word operands read after every nested box ran (1e). A chain runs in one scan (1a).

```
MOVE (MOVE 2 => t ENO EN d) => x ENO EN    // written: outer, input box, EN box
  MOVE 1 => s ENO EN c;                     // runs:    MOVE 1 (EN slot), MOVE 2 (input), outer
```

- Read a staircase bottom-up for the run order. The LSP shows a run-order hint on a chain; the doc says nothing
  suggesting a disabled box skips its inputs.

## 7. What gets deleted, and what the case set gains

**Writer** (`NetworkTextWriter`, `NetworkText`, `NetworkSpelling`): open-line hoisting (`Item()` levels + reverse,
`EnoRead`, `TextHasEno`); the enabled-comparison special path (`EnabledComparison*`); `EnoCarried` as a fact that decides
ENO (ENO is the pin, written from `HasEnoOutput`); the operator call form (if P-1…P-3 land); the `JMP l;` rail form (if
X5 is removed). **Reader** (`NetworkTextReader`, `NetworkLexer`): the open-line queue and `Role.Eno`; `LineEnd*` (P2);
"root of its line"; the enabled-comparison bracket check. **Drivers:** `CodesysNetworkWriter.RefuseUnbuildableEno`
replaced by X3/X9/X10/X12 as one Engine gate shared with the LSP; `CodesysNetworkReader.UnstoredMainOutput` re-examined
(the null's position states the connection, measurement 12). **LSP** (`frontend/syntax/network/`): the same in
`statements.ts` (LineEnd), `values.ts` (OpenLine), `boxes.ts`, `words.ts`; ENO hover ("the line it takes") goes.
**Implementation item, not language:** the CODESYS writer's one-commit Execute box does not run until recommitted
(measurement 9) — a run check before 2R.6 lands.

**Case set** (`test/fixtures/network-text/`):
- Rewrite root first: all of `accept/b4-eno-lines.cases` (16), `split-of-eno`, `r5-comparison-eno`, `named-eno-pin`,
  `r5-named-eno-pin-and-output`, `execute-*`, `eno-feeds-parallel`, `branch-camc`, `call-without-en-read-by-eno`
  (→ `ready := dryer(iOn := on);`, X9).
- Delete (their rule is gone): refuse `open-line-*` (3), `eno-after-semicolon`, `eno-one-line-read-twice`,
  `eno-root-*` (4), `eno-modifier-on-root`, `jump-no-semicolon`, `enabled-comparison-unbracketed`,
  `enabled-comparison-in-tail-unbracketed`, `enabled-comparison-in-branch-unbracketed`, `en-in-call-argument`,
  `two-statements-one-line`; accept `line-wrapped`, `enabled-comparison-top`/`-value`/`-in-call` (re-spelled unbracketed).
- Turn into accepts (EN without ENO is ordinary, measurement 5): `enabled-add-as-value`, `enabled-move-coil`,
  `enabled-call-as-value`, `enabled-call-in-word` (bracketed as an operand).
- Per proposal: `empty-slot-call-form`, `negated-pin-call-form`, `lowercase-call-form`, `not-box`, `move-call-form-*`,
  `r5-rising-pin`, `r5-negated-en*`.
- Gain, one case per measurement row: 1a (chain), 1d (EN box vs input box, both orders), 2 (split in EN / input slot),
  3a/3b/3c/4b/4c/7b (refusals by name), 4a (`.Q` on an FB declaring ENO), 5 (`y := MOVE k EN c`), 6 (`lamp := a GT 5 EN
  c`), 7a (`ENO => lamp`), 8 (`NOT`/`R_EDGE` on an ENO box), 9 (EXECUTE in a chain, a BRANCH feed, an AND operand), 10
  (CTU ENO in AND / BRANCH feed), 11 (two coils, both orders); layout: staircase, one line and odd indentation read to
  one model; brackets: an EN box as a BRANCH feed and under `NOT`; old forms: `MOVE 1 => a EN c` ⏎ `x := ENO;` refused.

## 8. Proposals and open questions for the owner

**P-1 empty slot (PROPOSAL):** nothing, as in `EN`, `x := ;`, `(a, , b)`: `MUL(, a, 6)` → `x := MUL a MUL 6;`;
`MOVE(IN := , => x)` → `MOVE => x;`.
**P-2 pin modifier (PROPOSAL):** `[NOT]`, `[R_EDGE]`, `[F_EDGE]` before the pin: `AND(a, NOT IN2 := b)` → `x := a AND
[NOT] b;` (`NOT b` stays the negated contact). Every in-place mark without a bracket collides: `NOT IN2 b` reads as a
negated call `IN2(…)` before a bracket, and `NOT IN2 := b` as a negated coil in a fan-out (`x := NOT y := c`). `[` is
unused (indexed operands are backticked). Optional, same rule everywhere: `[NOT] EN c` for `NOT EN c`, `f([NOT] IN := v)`
for `f(NOT IN := v)` — one pin-modifier spelling. 4 boxes in 3 corpus networks.
**P-3 NOT box (PROPOSAL):** a call whose head is a word is backticked (P1, as a callee named BRANCH): `NOT(IN := a)` →
``x := `NOT`(a);``. No rule of its own; 0 in the corpora. Alternative: keep `NOT(IN := a)`.
**P-4 stored case and odd MOVEs (PROPOSAL):** a word is written as `BoxType` stores it (`and(a, b)` → `a and b`), so
case is a fact, not a form switch. MOVE with 0 or 2 inputs (awkward #34: stores, builds, run unmeasured): run it; runs
→ ``` `MOVE`(a, b, => x) ``` by P-3's rule; does not run → refused by name.

Open: (1) X1 — keep EN last? (2) X5 — `JMP l := ;` or keep `JMP l;`? (3) X14 — escape a bare LF or refuse it?
(4) X12 — confirm `ENO => lamp` is spelled with a warning (the 09:32 paragraph refused it; v2 review and measurement 7a
spell it). (5) Confirm the 09:32 "FINAL" paragraph in tasks.md 2R.6 is superseded by v2.
