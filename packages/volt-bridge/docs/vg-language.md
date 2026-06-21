# The VG Language — Design & Specification

> **Status:** shipped (inline-`LET` form; `VAR_TEMP` retired in commit `e1c94d806`).
> **Audience:** anyone building tooling for VG — primarily a **language server (LSP)**.
> This is the complete, self-contained spec. [`vg-diagnostics.md`](./vg-diagnostics.md) is a focused
> bridge-side quick-reference (a subset of §9–§10 here).

---

## 1. Purpose & context

**VG** ("Volt Graphical") is the **textual form of an FBD/LD graphical PLC body** — a graphical network of
boxes and wires rendered as readable Structured Text. It exists so that an AI agent and a language server
can work in **one language (ST)** across an entire project, even though some POU bodies are authored
graphically in the vendor IDE (TwinCAT, CODESYS).

**The workspace is ST-only.** When a project is pulled, every body — textual *or* graphical — is materialised
as `.st` text; an FBD/LD body becomes its VG rendering. When pushed, the bridge parses the VG back to the
graphical node graph and writes it through the vendor's PLCopen XML transport. The round trip is exact, so a
graphical body can be read, edited, and written entirely as text.

```
  Vendor IDE  ──PLCopen XML──►  graph (GraphBody)  ──VgWriter──►  VG text   (pull / read)
  Vendor IDE  ◄─PLCopen XML──   graph (GraphBody)  ◄─VgParser──   VG text   (push / write)
```

**Division of responsibility:**

- **The bridge owns FORMAT.** A push whose VG isn't structurally valid or canonical is **refused before it
  reaches the IDE**, with a structured diagnostic (§10). These checks depend only on the VG text, never on PLC
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
everything from the first `NETWORK` marker onward. The bridge's `VgParser` is handed **only the body** — it
never sees the declaration. (This matters for type inference: see §8.) A graphical POU's declaration is edited
in the IDE, not via VG; a push writes the body only.

**Cross-vendor.** TwinCAT and CODESYS produce **identical** VG for the same logic. The form has no
vendor-specific syntax; the only per-vendor switch anywhere in the pipeline is the bridge port.

---

## 2. Design principles

1. **Reads like real ST.** A wire used once is inlined into its consumer's expression; only wires that *fan
   out* (feed 2+ consumers) get a name. `out := ((a AND b) OR c)` — not a four-line node-per-wire transcript.
2. **Round-trip-exact.** `VgWriter(VgParser(x)) == x` is enforced (§9). There is exactly one canonical text for
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

VG is line-oriented: each statement is on its own line, terminated by an optional `;`. Leading/trailing
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
| **Network flags** | `DISABLED` (header), `"…"` quoted network label (header) |
| **Operators** | `AND OR XOR  +  -  *  /  MOD  >  <  >=  <=  =  <>` (§7) |
| **Modifier words** | `NOT` (leading), `RISING` `FALLING` `SET` `RESET` (trailing) |
| **Punctuation** | `:=` (assign), `;` (terminator), `.` (member access), `(` `)` (group/call), `,` (arg sep), `:` (label) |
| **Comment** | `// …` to end of line (a network comment) |
| **Identifier** | a PLC name: `[A-Za-z_]\w*`, optionally `inst.Pin` for an FB output |
| **Literal** | any ST literal token inlined verbatim (`TRUE`, `FALSE`, `42`, `1.5`, `T#10ms`, `'str'`, …) |

`LET`, `JMP`, etc. are recognised on a **word boundary**, so an identifier such as `LETTER` or `RETURNED` is a
normal name, not a keyword.

---

## 4. Grammar (EBNF)

```ebnf
program        = declaration , body ;
declaration    = (* ordinary ST: PROGRAM/FUNCTION_BLOCK/… + VAR sections — NOT parsed by VgParser *) ;
body           = { network } ;

network        = network-header , { statement } , "END_NETWORK" ;
network-header = "NETWORK" , integer , language , [ string ] , [ "DISABLED" ] ;
language       = "FBD" | "LD" ;

statement      = wire-def | sink | fb-call | en-eno-if | control-flow | comment ;

wire-def       = "LET" , name , ":=" , producer , [ ";" ] ;   (* an internal wire *)
sink           = lvalue , ":=" , operand , [ ";" ] ;          (* an outVariable / coil *)
fb-call        = name , "(" , [ fb-args ] , ")" , [ ";" ] ;   (* a bare FB instance invocation *)
en-eno-if      = "IF" , name , "THEN" , ( wire-def | sink | fb-call ) , [ ";" ] , "END_IF" ;
control-flow   = label | jump | return ;
label          = name , ":" ;
jump           = "JMP" , name , [ ";" ]
               | "IF" , operand , "THEN" , "JMP" , name , [ ";" ] , "END_IF" ;
return         = "RETURN" , [ ";" ]
               | "IF" , operand , "THEN" , "RETURN" , [ ";" ] , "END_IF" ;
comment        = "//" , text ;

producer       = group | call ;                 (* a wire is always a block result or an opaque leaf *)
operand        = [ "NOT" ] , core , [ "RISING" | "FALLING" ] , [ "SET" | "RESET" ] ;
core           = group | call | member | name | literal ;
group          = "(" , operand , operator , operand , { operator , operand } , ")" ;
                 (* exactly ONE operator KIND per group; fully parenthesised; no precedence *)
call           = name , "(" , [ args ] , ")" ;  (* function: positional; FB: PIN := val *)
member         = name , "." , name ;            (* an FB instance output, e.g. inst.Q *)

fb-args        = fb-arg , { "," , fb-arg } ;
fb-arg         = name , ":=" , operand ;
args           = operand , { "," , operand } | fb-args ;
operator       = "AND" | "OR" | "XOR" | "+" | "-" | "*" | "/" | "MOD"
               | ">" | "<" | ">=" | "<=" | "=" | "<>" ;
```

`lvalue` is any ST l-value the IDE accepts (a variable, `struct.field`, `array[i]`); the bridge treats it as
opaque text. An *opaque leaf* (`LET i1 := <text>`, §6) carries arbitrary inlined ST text as `core`.

---

## 5. Semantic model

VG is a 1:1 textual projection of a **graph** (`GraphBody`, `src/.../Graphical/GraphModel.cs`). Understanding
the graph is the key to understanding what each statement *means*.

```
GraphBody    = Language("FBD"|"LD") , Network+
GraphNetwork = Order(int) , Label?(string) , Comment?(string) , Disabled(bool) , Node+

GraphNode (abstract: LocalId, ExecOrder?)
  ├─ InVar   (Expression, Mods)                              -- a value source: literal / variable / opaque text
  ├─ OutVar  (Expression, Mods, Source:Conn?)               -- a value sink (l-value): a coil / outVariable
  ├─ Block   (TypeName, InstanceName?, Inputs:Pin[],         -- an operator, function, or FB-instance box
  │           OutputPins:string[], CallType?, OutputTypes?)
  ├─ Label   (Name)                                          -- a jump target
  ├─ Jump    (Target, Condition:Conn?, Mods)                 -- JMP
  ├─ Return  (Condition:Conn?, Mods)                         -- RETURN
  └─ OpaqueNode (Kind, RawXml)                               -- a node kind preserved verbatim (contacts, rails…)

Conn = RefLocalId(long) , FormalParameter?(string)           -- a directed wire (producer localId + output pin)
Pin  = FormalParameter , Source:Conn? , Mods , Type?         -- one input pin of a Block
Mods = Negated(bool) , Edge(None|Rising|Falling) , Storage(None|Set|Reset)
```

**Wire vs sink — the central distinction.**

- A **sink** is a value consumer: `out := <expr>` (no `LET`). It maps to an **`OutVar`** node whose `Source`
  is the wire feeding it. `out` is a real l-value declared in the POU's `VAR` section.
- An **internal wire** is `LET <name> := <expr>`. The `<name>` is *not* a graph node of its own — it is a label
  for a producer (a `Block` result or an `InVar`) so that two or more consumers can reference the same box.
  `LET` names are a **VG-only construct: they never reach the IDE** (they are stripped on push; the wiring is
  carried by `localId`/`refLocalId` in the XML).

**Inlining.** A producer wired to exactly **one** consumer is **inlined** into that consumer's expression — it
emits no statement of its own. A producer that **fans out** (2+ consumers) must be **named** with `LET`, because
inlining it would duplicate its box. This rule is what makes the text both readable and lossless.

**What always gets a name** (a `LET`): a **fan-out block result** (`g*`), an **FB-instance reference**, an
**EN/ENO enable echo** (`en*`), and an **opaque leaf** (`i*`, §6). Everything else inlines.

**localId / network encoding.** Each node's `localId` encodes its network: `network index = localId / 10¹⁰`
(`GraphConstants.NetworkStride`). Network indices must be unique (§10, `VG_DUPLICATE_NETWORK`). The integer on
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

### FB instance call — `inst(PIN := arg, …)` and output read `inst.Pin`
A function-block instance is **always named** (it is stateful) and called as a bare statement; its outputs are
read elsewhere as `inst.Pin`. The instance is a real variable declared in `VAR`.
```
t1(IN := a, PT := pt);
done := t1.Q;
et   := t1.ET;
```

### Opaque leaf — `LET i := <text>`
An `inVariable` whose text is **not a single safe token** — it has whitespace or parentheses (`a + 1`, `NOT x`,
`f(x)`) and so cannot sit at an operand position without mis-splitting. It is named and gets its own statement.
Its text may **not** alias an internal wire (that is `VG_LEAF_REFERENCES_TEMP`).
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

### Modifiers — ride on the consumer
`NOT` (negation, leading), `RISING`/`FALLING` (edge, trailing), `SET`/`RESET` (coil storage, trailing). A
modifier rides on the **operand or sink that consumes the wire**, never as its own statement.
```
out := NOT (a AND b);     -- negation on a sink's source
out := a SET;             -- a set coil
out := clk RISING;        -- rising-edge
```
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
NETWORK 0 FBD "optional title" DISABLED   -- index, language (FBD|LD), optional quoted label, optional DISABLED
  // a network comment
  out := (a AND b);
END_NETWORK
NETWORK 1 LD                              -- a second network; index 1 → localIds in the 1×10¹⁰ band
  out2 := (c OR d);
END_NETWORK
```
The network **index** is verbatim and must be unique; it bases the network's `localId` band. The **language** tag
follows the index (a body may even mix FBD and LD networks, vendor permitting).

---

## 7. Operators

The single canonical table (`Graphical/FbdOperators.cs`). The **symbol** is the infix VG token; the **type** is
the underlying operator-box type in the graph/PLCopen. All are **case-insensitive**, **no precedence**, **one
kind per parenthesised group**.

| Class | Symbol(s) | Box type |
|---|---|---|
| Logic | `AND` `OR` `XOR` | `AND` `OR` `XOR` |
| Arithmetic | `+` `-` `*` `/` `MOD` | `ADD` `SUB` `MUL` `DIV` `MOD` |
| Comparison | `>` `<` `>=` `<=` `=` `<>` | `GT` `LT` `GE` `LE` `EQ` `NE` |

A group is `( a OP b )`, `( a OP b OP c )` (same `OP` repeated → one N-ary box), or nested
`( ( a AND b ) OR c )`. Mixing kinds in one group (`(a AND b OR c)`) is `VG_BAD_EXPRESSION` — the writer always
fully parenthesises, so each group is exactly one operator. An unknown symbol is `VG_UNKNOWN_OPERATOR`.

---

## 8. Type system & inference (the LSP's job)

VG **does not write wire types**. An internal wire (`LET g1 := …`) has no annotation, and the bridge does not
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

`GraphicalCode.Validate` enforces a named, ordered set of rules. A push is refused unless **all** hold, so an
accepted body can never silently rename a wire, drift on the next pull, or corrupt/crash the IDE. The LSP should
mirror these as diagnostics (so a body is fixed *before* it is pushed).

1. **Language** — the `NETWORK` marker's language is `FBD` or `LD` (else a parse error).
2. **Parse** — the body is structurally valid VG (the codes in §10).
3. **Leaf single-use** (`VG_LEAF_FANOUT`) — a *leaf* (variable/literal `InVar`) feeds exactly one consumer.
   TwinCAT draws one `inVariable` box per read and crashes on a shared one. (A *block* output may fan out — that
   is a legitimate branch, and is why fan-out block results get a `LET` name.)
4. **VG-text round-trip** (`VG_NOT_CANONICAL`) — the VG⇄graph leg: `VgWriter(VgParser(x)) == x`. The body must
   already be in canonical form (the writer's exact output). The diagnostic returns the canonical text to paste.
5. **PLCopen convergence** (`VG_PLCOPEN_DRIFT`) — the graph⇄PLCopen⇄IDE leg: the body reaches a fixed point
   through `PlcOpenWriter`→`PlcOpenReader`, so the closed loop push → pull → push stabilises. (A one-step
   canonicalisation, e.g. an LD negated contact, is allowed — only non-convergence is refused.)

Rules 4 and 5 together are the backstop: nothing accepted can drift or be a shape the importer rejects.

---

## 10. Diagnostics

Every refusal carries a stable `code`, a 1-based `line`, and a message; the round-trip gate also returns the
canonical body. (On the wire: `PushConflict.code` / `.line`; the CLI prints `name:line [CODE] message`.)

| Code | Trigger |
|---|---|
| `VG_NOT_CANONICAL` | Parses, but `VgWriter(VgParser(x)) != x` — would drift on the next pull. Message includes the exact canonical form. |
| `VG_PLCOPEN_DRIFT` | Does not converge through `PlcOpenWriter`→`PlcOpenReader` — an unstable shape the IDE can't store cleanly. |
| `VG_LEAF_REFERENCES_TEMP` | An opaque leaf's text aliases an internal wire (`LET g2 := NOT g1`). A `NOT`/edge rides on the consumer; an expression over wires is written inline at its consumer. |
| `VG_BAD_EXPRESSION` | A malformed group — partial/unbalanced parens (`(a AND b) OR c`) or mixed operators in one group (`(a AND b OR c)`). |
| `VG_UNKNOWN_OPERATOR` | The operator symbol is not in the §7 table. |
| `VG_DUPLICATE_NAME` | A wire/result/instance/label name is defined more than once in a network — the second would orphan the first. |
| `VG_DUPLICATE_NETWORK` | A network index appears more than once — their `localId`s would collide and the IDE would merge/corrupt them on import. |
| `VG_LEAF_FANOUT` | A leaf (variable/literal) feeds more than one block in a network (see §9 rule 3). |
| `VG_NETWORK_NOT_CLOSED` | A `NETWORK` block is missing its `END_NETWORK`. |
| `VG_PARSE` | Any other structural error (unexpected `END_NETWORK`, a leftover legacy `VAR_TEMP`/`END_VAR` line, a statement before any network, …). |

> **Legacy note.** The pre-`LET` form declared wires in a per-network `VAR_TEMP … END_VAR` block. That block is
> **retired**: a `VAR_TEMP`/`END_VAR` line in a body is now refused (`VG_PARSE`). Wires are marked inline with
> `LET` instead, and carry no written type.

---

## 11. LSP implementation guidance

VG is small and regular; a full-featured server is very achievable. Concrete targets per feature:

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

Treat the bridge's `GraphicalCode.Validate` as the source of truth for *structural* rules and the §8 table as
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
| `src/Volt.Bridge.Core/Graphical/Vg/VgParser.cs` | VG text → graph (the grammar, the `LET`/sink dispatch, the gate's parse leg) |
| `src/Volt.Bridge.Core/Graphical/Vg/VgWriter.cs` | graph → VG text (the canonical form: inlining, naming, `LET` emission) |
| `src/Volt.Bridge.Core/Graphical/GraphModel.cs` | the graph IR (`GraphBody`, `Block`, `InVar`, `OutVar`, `Conn`, `Pin`, `Mods`, …) |
| `src/Volt.Bridge.Core/Graphical/FbdOperators.cs` | the single operator table (symbol ↔ box type) |
| `src/Volt.Bridge.Core/Graphical/GraphicalCode.cs` | `Validate` — the well-formedness gate (§9) |
| `docs/vg-diagnostics.md` | the bridge-side quick-reference (a subset of §9–§10) |
| `test/Volt.Bridge.Tests/Vg*Tests.cs`, `EnEnoTests.cs`, `LadderRoundTripTests.cs` | round-trip, diagnostics, and feature fixtures — a living example corpus |
