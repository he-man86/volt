# The network text Language — Design & Specification

> **Status:** shipped (inline-`LET` form; `VAR_TEMP` retired in commit `e1c94d806`).
> **Audience:** anyone building tooling for network text — primarily a **language server (LSP)**.
> This is the complete, self-contained spec. [`network-text-diagnostics.md`](./network-text-diagnostics.md) is a focused
> bridge-side quick-reference (a subset of §9–§10 here).

---

## 1. Purpose & context

**Network text** is Volt's **own textual language for FBD/LD graphical PLC bodies** — a graphical
network of boxes and wires rendered as *readable, ST-flavored* text. It reads like Structured Text but is a
**distinct language** with its own grammar, parser, and analysis. It exists so an AI agent and a language
server can work over a graphical body **as text**, even though it was authored graphically in the vendor IDE
(TwinCAT, CODESYS).

**Bodies are ST _or_ network text.** When a project is pulled, every writable POU materialises as a single kind-named file
(`.fb`/`.prg`/`.fun`) — a textual body as ST, an editable FBD/LD body as network text (the body language
rides on the network text `NETWORK` marker in the content, not the extension). When pushed, the bridge parses the network text back to the graphical node
tree and writes it through the vendor's own object model. The round trip is exact, so a graphical body
can be read, edited, and written entirely as network text. (CFC, SFC and IL are unsupported: a marker, not content.)

```
  Vendor IDE  ──vendor model──►  NetworkBody  ──NetworkTextWriter──►  network text   (pull / read)
  Vendor IDE  ◄─vendor model──   NetworkBody  ◄─NetworkTextReader──   network text   (push / write)
```

**Division of responsibility:**

- **The bridge owns FORMAT.** A push whose network text isn't structurally valid or canonical is **refused before it
  reaches the IDE**, with a structured diagnostic (§10). These checks depend only on the network text, never on PLC
  semantics, so they live next to the parser.
- **The LSP owns CODE correctness.** Type checking, undeclared-variable detection, hover, completion, and
  navigation are the language server's job. This document is written so that job can be implemented.

**The declaration/body split.** A materialised graphical POU is a normal ST POU document:

```
PROGRAM Foo
VAR
    a : BOOL;
    out : BOOL;
END_VAR

NETWORK 0 FBD
  out := (a AND a);
END_NETWORK
END_PROGRAM
```

The **declaration** (`PROGRAM`/`VAR … END_VAR`) is ordinary ST and belongs to the POU. The **body** is
everything from the first `NETWORK` marker onward. The bridge's `NetworkTextReader` is handed **only the body** — it
never sees the declaration. (This matters for type inference: see §8.) A graphical POU's declaration is edited
in the IDE, not via network text; a push writes the body only.

**Cross-vendor.** TwinCAT and CODESYS produce **identical** network text for the same logic. The form has no
vendor-specific syntax; the only per-vendor switch anywhere in the pipeline is the bridge port.

---

## 2. Design principles

1. **Reads like real ST.** A wire used once is inlined into its consumer's expression; only wires that *fan
   out* (feed 2+ consumers) get a name. `out := ((a AND b) OR c)` — not a four-line node-per-wire transcript.
2. **Round-trip-exact.** `NetworkTextWriter(NetworkTextReader(x)) == x` is enforced (§9). There is exactly one canonical text for
   any graph, so a body never silently reformats or drifts on the next pull.
3. **Topology-exact, no precedence.** Every operator group is fully parenthesised. Parentheses encode the
   wiring directly, so there is **no operator precedence** and a parser needs no precedence table.
4. **Self-contained body.** A wire's nature is marked **at its definition** with the `LET` keyword. The body
   parses without the declaration; a bare assignment is an output (a *sink*), a `LET` assignment is an internal
   wire.
5. **Wire types are never written.** An internal wire carries no type annotation. The LSP **infers** a wire's
   type from its defining expression (§8). The old form wrote a synthesised type and got it wrong; the new form
   cannot, because there is nothing to get wrong.

---

## 3. Lexical structure

network text is line-oriented: each statement is on its own line, terminated by an optional `;`. Leading/trailing
whitespace is insignificant; blank lines are ignored. **All keywords, operators, and modifier words are
case-insensitive** (`AND` = `and`, `LET` = `let`). Identifiers are matched ordinal (case-sensitive) — they are
real PLC identifiers and must round-trip verbatim.

| Category | Tokens |
|---|---|
| **Block keywords** | `NETWORK` … `END_NETWORK` |
| **Wire keyword** | `LET` |
| **Conditional keyword** | `IF` … `THEN` … `END_IF` |
| **Control-flow** | `JMP`, `RETURN` |
| **Language tags** | `FBD`, `LD` (on the `NETWORK` header) |
| **Header fields** | `LABEL:` (the jump target), `TITLE:` (free text) — both named, both on the header |
| **Network flags** | `DISABLED` (header) |
| **Operators** | `AND OR XOR  +  -  *  /  MOD  >  <  >=  <=  =  <>` (§7) |
| **Modifier words** | `NOT` (leading), `RISING` `FALLING` (trailing) |
| **Assignment** | `:=` (plain coil), `S=` (set coil), `R=` (reset coil) — ExST's own operators; the coil KIND is the operator (§8) |
| **Output pin** | `NAME => target` inside a call — a box's named output pin; the UNNAMED one is the call's assignment |
| **Punctuation** | `;` (terminator), `.` (member access), `(` `)` (group/call), `,` (arg sep) |
| **Comment** | `// …` to end of line (a network comment) |
| **Identifier** | a PLC name: `[A-Za-z_]\w*`, optionally `inst.Pin` for an FB output. A member access may carry **whitespace around its dot** (`a .b`) — engineers type it and the IDE keeps it, so it is part of the name and round-trips verbatim |
| **Empty slot** | *nothing*, where an operand belongs — a pin connected to nothing (see below) |
| **Literal** | any ST literal token inlined verbatim (`TRUE`, `FALSE`, `42`, `1.5`, `T#10ms`, `'str'`, …) |

`LET`, `JMP`, etc. are recognised on a **word boundary**, so an identifier such as `LETTER` or `RETURNED` is a
normal name, not a keyword.

### The empty slot — a pin connected to nothing

An unconnected input is written as **nothing at all**, in whichever operand position it occupies:

```
( * iRPM * 6);                      // a 3-input MUL box whose first pin is unwired
ctu(CU := a, RESET := , PV := );    // named pins with nothing on them
f(, a);   f(a, );                   // positional slots, leading and trailing
coil := ;                           // a rung nothing drives
;                                   // an item wired to nothing at all
```

It is a **position, not a token**, and that is deliberate. A sigil was tried first (`?`) and withdrawn: CODESYS writes `???` into a box whose instance is unresolved — a real compile error the engineer needs to see — so `?` was already content, and Volt carries `???` through verbatim rather than claiming a spelling of its own. Because the grammar is fully parenthesised with **no precedence** (§4), every operand sits between two structural marks, so finding the next mark where an operand should have started — end of input, `)`, `,`, or an operator symbol — says unambiguously that the pin is wired to nothing.

An **operator still needs a right-hand operand**: `(a AND )` is refused (`NETWORK_BAD_EXPRESSION`). The asymmetry with `( * iRPM * 6)` is honest rather than tidy — the empty FIRST pin is measured in a real project (14 of them), the empty right-hand one is not, and Volt refuses shapes it has not seen rather than inferring them from a model that looks like it should allow one.

### Three places whitespace and quoting are content

| Written | Means | Why it is not cosmetic |
|---|---|---|
| `NOT x` | the negation **modifier** — a dot on the pin | a space follows `NOT` |
| `NOT(x)` | a **box** named NOT — its own item on the rung | the `(` is adjacent |
| `"he said ""no"""` | a network title containing `"` | the quote is **doubled**; writing it raw ended the title early and lost the rest |
| `//     aligned` | a comment indented by the engineer | everything after the one separator space is the comment's text |

`DISABLED` is a header keyword and is recognised only **after** the title, never inside it — a network titled `TITLE: "DISABLED during commissioning"` stays enabled.

The optional header fields are **named**: `LABEL: <name>` is the jump target `JMP` resolves against, `TITLE: "…"` is free text the engineer wrote. They are two different things and both vendors' `INetwork` carries both, so naming them means neither can be mistaken for the other, for the language, or for `DISABLED` — and the order between them does not matter. The label was a `myLabel:` line in the BODY until 2026-09-04, which modelled a property of the network as a statement; that form is now refused with a message naming the header field.

---

## 4. Grammar (EBNF)

```ebnf
program        = declaration , body ;
declaration    = (* ordinary ST: PROGRAM/FUNCTION_BLOCK/… + VAR sections — NOT parsed by NetworkTextReader *) ;
body           = { network } ;

network        = network-header , { statement } , "END_NETWORK" ;
network-header = "NETWORK" , integer , language , { header-field } , [ "DISABLED" ] ;
header-field   = ( "LABEL:" , identifier ) | ( "TITLE:" , title ) ;   (* named; order-independent *)
title          = '"' , { char - '"' | '""' } , '"' ;          (* a literal quote is DOUBLED *)
language       = "FBD" | "LD" ;

statement      = wire-def | sink | call-stmt | en-eno-if | execute-box | control-flow | comment | empty-stmt ;

wire-def       = "LET" , name , ":=" , producer , [ ";" ] ;   (* an internal wire *)
sink           = lvalue , assign-op , operand , [ ";" ] ;     (* an outVariable / coil *)
assign-op      = ":=" | "S=" | "R=" ;                          (* the coil KIND lives here, §8 *)
call-stmt      = call , [ ";" ] ;                             (* an FB instance, OR a box whose output *)
                                                              (* goes nowhere: `MOVE(g0, iDec);` *)
empty-stmt     = ";" ;                                        (* an item wired to nothing at all *)
en-eno-if      = "IF" , name , "THEN" , ( wire-def | sink | fb-call ) , [ ";" ] , "END_IF" ;
execute-box    = [ "IF" , name , "THEN" ] ,                   (* an Execute box: ST-in-FBD/LD (§6) *)
                 "EXECUTE" , st-text , "END_EXECUTE" ,        (* st-text = verbatim ST, kept byte-for-byte *)
                 [ "END_IF" ] ;                               (* the IF/END_IF present iff the box has a wired EN *)
control-flow   = jump | return ;                              (* a LABEL is a header field, not a statement *)
jump           = "JMP" , name , [ ";" ]
               | "IF" , operand , "THEN" , "JMP" , name , [ ";" ] , "END_IF" ;
return         = "RETURN" , [ ";" ]
               | "IF" , operand , "THEN" , "RETURN" , [ ";" ] , "END_IF" ;
comment        = "//" , text ;

producer       = group | call ;                 (* a wire is always a block result or an opaque leaf *)
operand        = empty
               | [ "NOT" ] , core , [ "RISING" | "FALLING" ] ;
empty          = (* nothing — a pin connected to nothing, §3 *) ;
core           = group | call | member | name | literal ;
group          = "(" , operand , operator , operand , { operator , operand } , ")" ;
                 (* exactly ONE operator KIND per group; fully parenthesised; no precedence *)
call           = name , "(" , [ args ] , ")" ;  (* function: positional; FB: PIN := val *)
member         = name , [ ws ] , "." , [ ws ] , name ;  (* inst.Q — spacing is the engineer's, kept *)

fb-args        = fb-arg , { "," , fb-arg } ;
fb-arg         = name , ":=" , operand ;
out-arg        = name , "=>" , lvalue ;                (* an OUTPUT pin of the box, §6 *)
args           = ( operand | out-arg ) , { "," , ( operand | out-arg ) }
               | ( fb-arg | out-arg ) , { "," , ( fb-arg | out-arg ) } ;
operator       = "AND" | "OR" | "XOR" | "+" | "-" | "*" | "/" | "MOD"
               | ">" | "<" | ">=" | "<=" | "=" | "<>" ;
```

`lvalue` is any ST l-value the IDE accepts (a variable, `struct.field`, `array[i]`); the bridge treats it as
opaque text. An *opaque leaf* (`LET i1 := <text>`, §6) carries arbitrary inlined ST text as `core`.

---

## 5. Semantic model

network text is a 1:1 textual projection of the model in
`src/Volt.Engine/Format/Network/NetworkModel.cs` — a list of networks, each holding statement TREES.
Understanding the tree is the key to understanding what each statement *means*, and **`NetworkModel.cs` is the
description**: every record there carries the vendor measurement it was shaped by, and it is kept current
because the readers and writers compile against it.

> This section used to inline a second copy of the model — `GraphBody` / `GraphNode` / `Conn` / `Pin`, from
> `src/Volt.Engine/Body/Graph/GraphModel.cs`. That file was deleted with the graph-to-tree rewrite, and the copy
> stayed, describing `localId`/`refLocalId` wiring the format no longer has and a per-pin `Storage(None|Set|Reset)`
> that never belonged to a pin at all. A model documented in two places is documented in the one that rots.

The shapes a tree is built from: `Leaf` (an operand), `Assign` (a coil or outVariable, and — via its flags —
`JMP`/`RETURN`), `Box` (an operator, function or FB-instance call), `Demux` (a fan-out wire), `Parallel` (an LD
parallel branch) and `Terminator` (a rung end). `Flags` is the vendor's own bit-field.

**Wire vs sink — the central distinction.**

- A **sink** is a value consumer: `out := <expr>` (no `LET`). It maps to an **`OutVar`** node whose `Source`
  is the wire feeding it. `out` is a real l-value declared in the POU's `VAR` section.
- An **internal wire** is `LET <name> := <expr>`. The `<name>` is *not* a graph node of its own — it is a label
  for a producer, so that two or more consumers can reference the same box.

  A `LET` name used ONCE is a textual convenience and is substituted back into its consumer on read. A name used
  TWICE OR MORE is a structure, and it **does reach the IDE**: it becomes the vendor's own fan-out item
  (`BoxTreeDemux`, keyed by a `VarId`), which is how both CODESYS and TwinCAT represent one wire feeding several
  consumers. *(This inverts what this section said before — that LET names never reach the IDE and are stripped
  on push. That was true of the PLCopen transport, where wiring travelled as `localId`/`refLocalId` and a name
  had nowhere to go.)*

**Inlining.** A producer wired to exactly **one** consumer is **inlined** into that consumer's expression — it
emits no statement of its own. A producer that **fans out** (2+ consumers) must be **named** with `LET`, because
inlining it would duplicate its box. This rule is what makes the text both readable and lossless.

**What always gets a name** (a `LET`): a **fan-out block result** (`g*`), an **FB-instance reference**, an
**EN/ENO enable echo** (`en*`), and an **opaque leaf** (`i*`, §6). Everything else inlines.

**localId / network encoding.** Each node's `localId` encodes its network: `network index = localId / 10¹⁰`
(`GraphConstants.NetworkStride`). Network indices must be unique (§10, `NETWORK_DUPLICATE_NETWORK`). The integer on
the `NETWORK` header is that index, preserved verbatim so gapped/renumbered networks round-trip.

**Pins.** A `Block` input is a `Pin(FormalParameter, Source, Mods, Type?)`. Operator/function pins are
positional (`IN1`, `IN2`, …). FB-instance pins use the real parameter names (`IN`, `PT`, …). `Mods` on a pin is
how a per-pin negation/edge/storage is carried (§6). `Type` is read-only IDE metadata, never load-bearing.

---

## 6. Statement forms (reference)

### Wire definition — `LET name := producer`
A named internal wire (a fan-out result, an EN echo, or an opaque leaf). The producer is an operator group or a
call. Names are minted `g1, g2, …` for fan-out results, `en1, …` for EN echoes, `i1, …` for opaque leaves.
```
LET g1 := (a AND b);
out := g1;
out2 := g1;
```

### Sink — `lvalue := operand`
A bare assignment (no `LET`) → an `OutVar` (a coil/outVariable). The right side is any operand expression.
```
out := (a AND b);
done := t1.Q;
```

### Operator group — `( operand OP operand [OP operand …] )`
Fully parenthesised; **one operator kind per group**; nestable. No precedence — parentheses carry the topology.
```
out := ((a AND b) OR c);
```

### Function call — `FN(arg, …)`
A stateless function box; arguments are positional operands.
```
out := MAX(a, b);
out := LIMIT(lo, x, hi);
```
It may also stand alone as a **statement**, when the box's output is connected to nothing — an ordinary
shape in a ladder, and 34 of one real project's 373 networks:
```
MOVE(g0, iDec);
```

### FB instance call — `inst(PIN := arg, …)` and output read `inst.Pin`
A function-block instance is **always named** (it is stateful) and called as a bare statement; its outputs are
read elsewhere as `inst.Pin`. The instance is a real variable declared in `VAR`.
```
t1(IN := a, PT := pt);
done := t1.Q;
et   := t1.ET;
```

### The `LET` prefix carries the meaning
`g<n>` is a **fan-out wire**, `i<n>` an **opaque leaf**, `en<n>` an **enable echo** — those are the names
the writer mints for exactly those three things, and a reader must honour the prefix rather than guess from
how often the name is used. A `BoxTreeDemux` feeding a single consumer is still an item drawn on the rung,
and an opaque leaf is one `inVariable` rather than the expression its text happens to spell. A name the
writer did not mint is hand-authored, and there use count is the only signal available: used twice it is a
wire, or its value would be duplicated into both consumers.

### Opaque leaf — `LET i := <text>`
An `inVariable` whose text is **not a single safe token** — it has whitespace or parentheses (`a + 1`, `NOT x`,
`f(x)`) and so cannot sit at an operand position without mis-splitting. It is named and gets its own statement.
Its text may **not** alias an internal wire (that is `NETWORK_LEAF_REFERENCES_TEMP`).
```
LET i1 := NOT b;
out := (a AND i1);
```

### EN/ENO — `LET en := src; IF en THEN <result>; END_IF`
A box with an enable (`EN`) input renders as an `IF`. `en` is the box's enable echo (its `ENO` output), so a
downstream box chains off it. Three result shapes:
```
LET en1 := a;
IF en1 THEN out := (b AND c); END_IF      -- into a SINK (bare): result feeds one unmodified output

LET en2 := en1;
IF en2 THEN LET g1 := (b OR c); END_IF     -- into a NAMED wire (LET): result fans out
out  := g1;
out3 := g1;

LET en3 := a;
IF en3 THEN t1(IN := x, PT := pt); END_IF  -- gating an FB CALL; its outputs read via t1.Q elsewhere
done := t1.Q;
```

### Execute box — `EXECUTE … END_EXECUTE`
A CODESYS **Execute box** (the standard "ST inside FBD/LD" element: PlcOpen `fbdcalltype=execute` + an
`<STCode>` addData) is an EN/ENO block whose "call" is raw Structured Text. Its enable is NOT special — it
reuses the ordinary EN/ENO wire+`IF` (above); the only new token pair is `EXECUTE … END_EXECUTE` around the
**verbatim ST**, which may be arbitrarily complex (nested `IF`, comments, multiple statements):
```
LET en1 := bRun;
IF en1 THEN
EXECUTE
IF bStart THEN                       -- the box's own ST, kept byte-for-byte
	target := 40 + 2;   (* the answer *)
END_IF
END_EXECUTE
END_IF
```
A box with no wired EN renders as a bare `EXECUTE … END_EXECUTE` (no `IF`). The explicit `END_EXECUTE`
delimiter (not "until `END_IF`") disambiguates the ST's own nested `END_IF`s. The ST between the markers is
carried opaquely — the bridge reconstructs `<block typeName="EXECUTE">` from it on push (a real, live-verified
round-trip), and the LSP treats it as full ST rather than the simplified network text grammar.

### Box output pins — the call's assignment, and `=>`
A box has OUTPUT pins of its own, and they are wired to variables. The vendor names them
(`OutputParams.Names`, index-aligned with the slots), and the name decides how the pin is spelled — which is
IEC's own split, not a Volt convention: a function's RESULT is assigned, its `VAR_OUTPUT`s use `=>`.

```
dst := MOVE(src);                          -- the UNNAMED pin: the box's result
fc_MeanValue(20, oMeanValue => measured);  -- a NAMED pin
dst := f(src, oErr => err);                -- both on one box
```

An enabled box writes its own pin inside the `IF`, and the rung continues on the enable echo:

```
LET en1 := (g0 AND CopyMeasuredToDark);
IF en1 THEN DarkValue := MOVE(MeasuredValue); END_IF
CopyMeasuredToDark R= en1;
```

**These pins used to be DROPPED.** `Box.Outputs` was read and then never rendered — the writer consulted it
only to reserve names — so a pin an engineer wired straight off a box was absent from the file:
`MOVE(EN := rung, IN := 0)` with its output on `TempI` materialized as `MOVE(0)`, and `TempI` appeared
nowhere. ~250 such connections in one real project. The push side knew and said so, refusing any box that
carried outputs because "network text has no form for them"; this is that form.

Two rules keep it honest, and both refuse rather than guess:

* An **infix operator** has no argument list, so a named pin on one is refused (`NETWORK_UNSUPPORTED`).
  Operator boxes have unnamed outputs on every box measured, so this is a shape nobody has seen.
* **Two unnamed pins** would be two results with one assignment to give, so that is refused too. Every one of
  the 129 boxes with an unnamed output in a real project has exactly one.

An **unwired** pin is not written at all. A resolved FB box carries one slot per declared output whether or not
the engineer connected it — 29 empty slots on one 30-pin box — and the `ENO` echo occupies slot 0 whenever the
vendor names it so. Neither is a connection, so neither is spelled.

### Modifiers — ride on the consumer
`NOT` (negation, leading) and `RISING`/`FALLING` (edge, trailing). A modifier rides on the **operand or sink
that consumes the wire**, never as its own statement.
```
out := NOT (a AND b);     -- negation on a sink's source
out := clk RISING;        -- rising-edge
```

### Coil storage — the assignment operator
A coil's **kind** is spelled by the operator, using ExST's own (`docs/codesys-reference/01-languages-and-editors.md`):
```
out := v;                 -- a plain coil
out S= v;                 -- a set coil
out R= v;                 -- a reset coil
```
This is a property of the **coil**, so it is written on the coil. It used to be a trailing word on the value
(`out := v SET;`), which read backwards and cost three things:

* A whole translation layer (`CoilStorage`, deleted) existed to move the flag off the target on read and back
  on write, because both vendors keep it on the target.
* A **fan-out whose coils disagree could not be spelled at all** — one trailing word had to serve every
  target of the statement, so only the first coil's storage survived. Per target, it is just three lines:
  ```
  LET g1 := (a OR b);
  plain := g1;
  latched S= g1;
  cleared R= g1;
  ```
* A **RESET coil came out as a SET coil.** The vendors spell a reset coil `Negation + Set` on the target (one
  enum in two bits, not two modifiers — measured against CODESYS's own PLCopen export across 17 POUs), and the
  writer rendered no modifier on a target at all. `GeneralProgramFlags` network 0, comment *"Always Off"*,
  pulled as `AlwaysOff := AlwaysOff SET;`. Pushed back, the flag that must stay false latches true.

`S=`/`R=` are recognised only as a token of their own — preceded by whitespace, not followed by `=` — so a
comparison, or an l-value whose name ends in those letters, is never mistaken for one.
A modifier on a *bare-leaf operand inside a group* turns that leaf into an **opaque leaf** (because `NOT b` is no
longer a single token): `out := (a AND NOT b)` reads back as `LET i1 := NOT b; out := (a AND i1)`.

### Control flow
```
myLabel:                              -- a label (jump target)
JMP myLabel;                          -- unconditional jump
RETURN;                               -- unconditional early return
IF cond THEN JMP myLabel; END_IF      -- conditional jump
IF cond THEN RETURN; END_IF           -- conditional return
```

### Networks, comments, flags
```
NETWORK 0 FBD LABEL: myLabel TITLE: "optional title" DISABLED
                                          -- index, language (FBD|LD), then the NAMED optional fields
                                          -- LABEL: the jump target · TITLE: free text · then DISABLED
  // a network comment                    -- optional comment, FIRST in the body
  out := (a AND b);
END_NETWORK
NETWORK 1 LD                              -- a second network; index 1 → localIds in the 1×10¹⁰ band
  out2 := (c OR d);
END_NETWORK
```
The network **index** is verbatim and must be unique; it bases the network's `localId` band. The **language** tag
follows the index (a body may even mix FBD and LD networks, vendor permitting).

A network's **label comes before its comment**, mirroring the IDE's own header layout (the label above the
single comment box). The reader accepts them in either order — only the canonical form is fixed, and it is
fixed this way so that writing a network the way the IDE displays it is not refused.

---

## 7. Operators

The single canonical table (`src/Volt.Engine/Body/Graph/FbdOperators.cs`). The **symbol** is the infix network-text token; the **type** is
the underlying operator-box type in the graph/PLCopen. All are **case-insensitive**, **no precedence**, **one
kind per parenthesised group**.

| Class | Symbol(s) | Box type |
|---|---|---|
| Logic | `AND` `OR` `XOR` | `AND` `OR` `XOR` |
| Arithmetic | `+` `-` `*` `/` `MOD` | `ADD` `SUB` `MUL` `DIV` `MOD` |
| Comparison | `>` `<` `>=` `<=` `=` `<>` | `GT` `LT` `GE` `LE` `EQ` `NE` |

A group is `( a OP b )`, `( a OP b OP c )` (same `OP` repeated → one N-ary box), or nested
`( ( a AND b ) OR c )`. Mixing kinds in one group (`(a AND b OR c)`) is `NETWORK_BAD_EXPRESSION` — the writer always
fully parenthesises, so each group is exactly one operator. An unknown symbol is `NETWORK_UNKNOWN_OPERATOR`.

---

## 8. Type system & inference (the LSP's job)

network text **does not write wire types**. An internal wire (`LET g1 := …`) has no annotation, and the bridge does not
need one (the graph carries types in the PLCopen pins). For hover, completion, and type-checking, the **LSP must
infer** a wire's type from its defining expression and the POU declaration:

| Producer | Inferred type |
|---|---|
| logic op (`AND`/`OR`/`XOR`) | `BOOL` |
| comparison op (`>`,`=`,…) | `BOOL` |
| EN echo (`en*`) | `BOOL` |
| arithmetic op (`+`,`-`,`*`,`/`,`MOD`) | the operands' common/result type (e.g. `INT`, `REAL`) |
| function call `FN(…)` | the function's declared return type |
| FB output `inst.Pin` | the FB's output-pin type |
| a bare variable leaf | its type from the POU's `VAR` declaration |
| a literal | the literal's type (`TRUE`/`FALSE` → `BOOL`, `42` → an integer type, …) |

**The declaration is the authority for real variables.** The LSP has the full POU document (declaration +
body), so it can resolve `a`, `out`, `t1`, etc. to their `VAR` types and propagate through expressions. (The
bridge's parser deliberately does *not* — it only needs the wire/sink shape, which `LET` gives it directly.)

The `LET`-vs-bare distinction is also a **binding signal** for the LSP: a `LET` name is a single-assignment
local binding scoped to its network; a bare l-value is a write to a declared variable. Treat them differently
for go-to-definition and rename.

---

## 9. Well-formedness invariants (the gate)

`NetworkCode.Validate` enforces a named, ordered set of rules. A push is refused unless **all** hold, so an
accepted body can never silently rename a wire, drift on the next pull, or corrupt/crash the IDE. The LSP should
mirror these as diagnostics (so a body is fixed *before* it is pushed).

1. **Language** — the `NETWORK` marker's language is `FBD` or `LD` (else a parse error).
2. **Parse** — the body is structurally valid network text (the codes in §10).
3. **Leaf single-use** (`NETWORK_LEAF_FANOUT`) — a *leaf* (variable/literal `InVar`) feeds exactly one consumer.
   TwinCAT draws one `inVariable` box per read and crashes on a shared one. (A *block* output may fan out — that
   is a legitimate branch, and is why fan-out block results get a `LET` name.)
4. **network text-text round-trip** (`NETWORK_NOT_CANONICAL`) — the network text⇄graph leg: `NetworkTextWriter(NetworkTextReader(x)) == x`. The body must
   already be in canonical form (the writer's exact output). The diagnostic returns the canonical text to paste.
5. **PLCopen convergence** (`NETWORK_PLCOPEN_DRIFT`) — the graph⇄PLCopen⇄IDE leg: the body reaches a fixed point
   through `PlcOpenWriter`→`PlcOpenReader`, so the closed loop push → pull → push stabilises. (A one-step
   canonicalisation, e.g. an LD negated contact, is allowed — only non-convergence is refused.)

Rules 4 and 5 together are the backstop: nothing accepted can drift or be a shape the importer rejects.

---

## 10. Diagnostics

Every refusal carries a stable `code`, a 1-based `line`, and a message; the round-trip gate also returns the
canonical body. (On the wire: `PushConflict.code` / `.line`; the CLI prints `name:line [CODE] message`.)

| Code | Trigger |
|---|---|
| `NETWORK_NOT_CANONICAL` | Parses, but `NetworkTextWriter(NetworkTextReader(x)) != x` — would drift on the next pull. Message includes the exact canonical form. |
| `NETWORK_PLCOPEN_DRIFT` | Does not converge through `PlcOpenWriter`→`PlcOpenReader` — an unstable shape the IDE can't store cleanly. |
| `NETWORK_LEAF_REFERENCES_TEMP` | An opaque leaf's text aliases an internal wire (`LET g2 := NOT g1`). A `NOT`/edge rides on the consumer; an expression over wires is written inline at its consumer. |
| `NETWORK_BAD_EXPRESSION` | A malformed group — partial/unbalanced parens (`(a AND b) OR c`) or mixed operators in one group (`(a AND b OR c)`). |
| `NETWORK_UNKNOWN_OPERATOR` | The operator symbol is not in the §7 table. |
| `NETWORK_DUPLICATE_NAME` | A wire/result/instance/label name is defined more than once in a network — the second would orphan the first. |
| `NETWORK_DUPLICATE_NETWORK` | A network index appears more than once — their `localId`s would collide and the IDE would merge/corrupt them on import. |
| `NETWORK_LEAF_FANOUT` | A leaf (variable/literal) feeds more than one block in a network (see §9 rule 3). |
| `NETWORK_NOT_CLOSED` | A `NETWORK` block is missing its `END_NETWORK`. |
| `NETWORK_PARSE` | Any other structural error (unexpected `END_NETWORK`, a leftover legacy `VAR_TEMP`/`END_VAR` line, a statement before any network, …). |

> **Legacy note.** The pre-`LET` form declared wires in a per-network `VAR_TEMP … END_VAR` block. That block is
> **retired**: a `VAR_TEMP`/`END_VAR` line in a body is now refused (`NETWORK_PARSE`). Wires are marked inline with
> `LET` instead, and carry no written type.

---

## 11. LSP implementation guidance

network text is small and regular; a full-featured server is very achievable. Concrete targets per feature:

- **Tokenisation / semantic tokens.** Distinct classes: keywords (`NETWORK`/`LET`/`IF`/`THEN`/`JMP`/…),
  operators, modifier words, **wire names** (a `LET` binding), **sinks** (a bare l-value), **FB instances**
  (named call + `.Pin` reads), literals, comments. Highlighting wires vs. sinks vs. instances differently makes
  a network instantly legible.
- **Document symbols / folding.** Each `NETWORK … END_NETWORK` is a foldable region; its index + optional label
  is the symbol name. EN/ENO `IF … END_IF` blocks fold too.
- **Hover.** A wire → its **inferred** type (§8) and defining expression; a variable/sink → its declared type
  from the POU `VAR`; an operator → its semantics; an FB instance → its type and pin signature.
- **Completion.** Declared variables and FB instances (from the POU `VAR`), FB **pin names** inside
  `inst(… := …)`, operators, function names, and the keyword set.
- **Diagnostics.** Surface the §10 structural codes *as you type* (so a push is never refused), plus
  code-correctness checks the bridge doesn't do: undeclared variable, type mismatch (using §8 inference),
  unknown function/FB, wrong pin name, dead label / undefined jump target.
- **Go-to-definition & references.** A `LET` wire ↔ its uses (network-scoped, single-assignment); a variable ↔
  its `VAR` declaration; a `JMP` ↔ its label; an `inst.Pin` ↔ the `inst(…)` call.
- **Signature help.** Inside `inst(…)` or `FN(…)`, show the pin/parameter list with types.
- **Rename.** A `LET` wire is safe to rename within its network (it never escapes to the IDE). Renaming a real
  variable is a declaration-level rename.

Treat the bridge's `NetworkCode.Validate` as the source of truth for *structural* rules and the §8 table as
the source of truth for *types*; the LSP adds code-correctness on top.

---

## 12. Worked examples

```
-- 1. Simple operator (single-use → inlined)
NETWORK 0 FBD
  out := (a AND b);
END_NETWORK

-- 2. Nested, fully parenthesised
NETWORK 0 FBD
  out := ((a AND b) OR c);
END_NETWORK

-- 3. Fan-out: g1 feeds two sinks → named with LET
NETWORK 0 FBD
  LET g1 := (a AND b);
  out  := g1;
  out2 := g1;
END_NETWORK

-- 4. Opaque leaf: a negated operand can't inline → named i1
NETWORK 0 FBD
  LET i1 := NOT b;
  out := (a AND i1);
END_NETWORK

-- 5. EN/ENO into a sink
NETWORK 0 FBD
  LET en1 := a;
  IF en1 THEN out := (b AND c); END_IF
END_NETWORK

-- 6. EN/ENO whose result fans out → LET inside the IF
NETWORK 0 FBD
  LET en1 := a;
  IF en1 THEN LET g1 := (b OR c); END_IF
  out  := g1;
  out2 := g1;
END_NETWORK

-- 7. Timer FB: instance call + output reads
NETWORK 0 FBD
  t1(IN := start, PT := pt);
  done := t1.Q;
  et   := t1.ET;
END_NETWORK

-- 8. EN-gated FB call
NETWORK 0 FBD
  LET en1 := enable;
  IF en1 THEN t1(IN := start, PT := pt); END_IF
  done := t1.Q;
END_NETWORK

-- 9. Ladder: a parallel branch (OR) and a series (AND) on one rung
NETWORK 0 LD
  out := ((a OR b) AND c);
END_NETWORK

-- 10. Multiple networks (indices base the localId bands)
NETWORK 0 LD
  out1 := (a AND b);
END_NETWORK
NETWORK 1 LD
  out2 := (c OR d);
END_NETWORK

-- 11. Variable feedback (the fed-back read is a leaf, not a graph cycle)
NETWORK 0 FBD
  iCount := (1 + iCount);
END_NETWORK

-- 12. Control flow
NETWORK 0 FBD
  IF done THEN RETURN; END_IF
  step := (step + 1);
END_NETWORK
```

---

## 13. References (implementation)

| File | Role |
|---|---|
| `src/Volt.Engine/Body/NetworkText/NetworkTextReader.cs` | network text → graph (the grammar, the `LET`/sink dispatch, the gate's parse leg) |
| `src/Volt.Engine/Body/NetworkText/NetworkTextWriter.cs` | graph → network text (the canonical form: inlining, naming, `LET` emission) |
| `src/Volt.Engine/Body/Graph/GraphModel.cs` | the graph IR (`GraphBody`, `Block`, `InVar`, `OutVar`, `Conn`, `Pin`, `Mods`, …) |
| `src/Volt.Engine/Body/Graph/FbdOperators.cs` | the single operator table (symbol ↔ box type) |
| `src/Volt.Engine/Body/NetworkCode.cs` | `Validate` — the well-formedness gate (§9) |
| `docs/network-text-diagnostics.md` | the bridge-side quick-reference (a subset of §9–§10) |
| `test/Volt.Engine.Tests/Network text*Tests.cs`, `EnEnoTests.cs`, `LadderRoundTripTests.cs` | round-trip, diagnostics, and feature fixtures — a living example corpus |
