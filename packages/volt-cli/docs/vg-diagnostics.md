# VG (graphical body) format & diagnostics

VG is the textual form of an FBD/LD graphical body — **readable Structured Text** that round-trips exactly to the
PLCopen node graph. A wire used once is **inlined** into its consumer's expression; a wire that **fans out** (feeds
2+ consumers) keeps a name. The bridge **owns the format** (the LSP owns code correctness): a push whose VG isn't
valid/canonical is refused *before* it reaches the IDE, with a structured diagnostic. These rules are **general** —
they depend only on the VG text, never on the PLC code semantics — so they're computed next to the parser
(`Volt.Bridge.Core/Graphical/Vg/VgParser.cs`) with no IDE state.

## The readable form (what the parser accepts)

```
NETWORK <n> <FBD|LD>
  LET <name> := <expr>;     -- an internal wire (fan-out results g*, en*, opaque leaves i*); types are LSP-inferred
  <name> := <expr>;         -- a sink (outVariable / coil) — bare, no LET
  <statements>
END_NETWORK
```

- **Internal wires use `LET`.** A wire (a named producer — a fanned-out block result, an EN enable, or an opaque
  leaf) is introduced inline at its definition with `LET <name> := …`. There is **no `VAR_TEMP` block and no wire
  types** — the wire's identity is marked at its definition and the type is reconstructed by the IDE/LSP. A bare
  `<name> := …` (no `LET`) is a **sink** (an outVariable/coil). The `LET` names never reach the IDE — they're a
  VG-only construct stripped on push.
- **Operands inline.** A simple atom (a bare variable/literal) is written in place: `out := (a AND b)`. Only wires
  that need a name get one — see below — so the text reads like ST, not a node-per-line transcript.
- **Operator** (`(a OP b)`, fully parenthesised, nestable): `out := ((a AND b) OR c)`. One operator per
  parenthesised group; operators are `AND OR XOR + - * / MOD > < >= <= = <>`. No precedence — parens carry topology.
- **Named result** (`LET g := (…)` / `LET g := FN(…)`): a block result that **fans out** (2+ consumers) is named
  (else it's inlined). The name lets both consumers share the one box.
- **Opaque leaf** (`LET i := <text>`): an inVariable whose text has whitespace or parens (`a + 1`, `NOT x`) can't sit
  at an operand position as one token, so it's named and gets its own statement. Its text may NOT alias a wire.
- **Call** (`inst(PIN := arg, …)` / `g := FN(arg)`): an FB instance (always named) or function; args are expressions.
- **Output** (`out := <expr>`): an outVariable / coil sink. A block's non-boolean output (e.g. a timer's `ET`) is
  assigned the same way and embeds in the block's pin on write.
- **EN/ENO** box: `LET en := <src>; IF en THEN LET result := <expr>; END_IF` — the IF is its faithful ST. `en` is
  the box's enable echo (its `ENO`), so a downstream box chains off it (`LET en2 := NOT en1`). An EN/ENO body that
  writes straight to a sink stays bare (`IF en THEN out := <expr>; END_IF`).
- **Modifiers**: `NOT` (negation), `RISING`/`FALLING` (edge), `SET`/`RESET` (coil storage) ride on the CONSUMER
  (the operand/sink), never as their own statement (`out := NOT g1`, not `LET g2 := NOT g1`).

A simple leaf feeding two consumers is **inlined into each** (two separate boxes — the valid FBD shape), so the
canonical form never contains a single fanned-out leaf; only block results and opaque leaves are named-and-shared.

## Diagnostic codes

Each refusal carries a stable `code`, a 1-based `line`, and a message; the round-trip gate also returns the
canonical body to paste. (`PushConflict.code` / `.line` on the wire; the CLI prints `name:line [CODE] message`.)

| Code | Meaning |
|---|---|
| `VG_NOT_CANONICAL` | Parses, but `VgWriter(VgParser(x)) != x` — it would drift on the next pull. The message includes the exact canonical form. |
| `VG_PLCOPEN_DRIFT` | Does not converge through the PLCopen round-trip (`PlcOpenWriter`→`PlcOpenReader`) — it keeps changing every pull, an unstable shape the IDE can't store cleanly. (One-step canonicalisation, e.g. an LD negated contact, is fine — only non-convergence is refused.) |
| `VG_LEAF_REFERENCES_TEMP` | An opaque leaf's text aliases an internal wire (`LET g2 := NOT g1`) — a NOT/edge rides on the consumer, and an expression over wires is written inline (fully parenthesised) at its consumer. |
| `VG_BAD_EXPRESSION` | A malformed expression — a partially-parenthesised/unbalanced group (`(a AND b) OR c`) or mixed operators in one group (`(a AND b OR c)`). The writer fully-parenthesises, so each group is exactly one operator. |
| `VG_UNKNOWN_OPERATOR` | The operator symbol isn't a known FBD/LD operator. |
| `VG_DUPLICATE_NAME` | A wire/result/instance/label name is defined more than once in a network — the second silently orphans the first. |
| `VG_DUPLICATE_NETWORK` | A network index appears more than once — their localIds would collide and the IDE would merge/corrupt them on import. |
| `VG_LEAF_FANOUT` | A leaf (variable/literal) feeds more than one block in a network. TwinCAT draws one `inVariable` box per read and crashes on a shared one — give each read its own leaf statement. (A BLOCK output may fan out freely; that's a legitimate branch.) |
| `VG_NETWORK_NOT_CLOSED` | A `NETWORK` block is missing its `END_NETWORK`. |
| `VG_PARSE` | Any other structural parse error (unexpected `END_NETWORK`, a leftover `VAR_TEMP`/`END_VAR` line from the old block form, statement before a network, …). |

## Well-formedness invariants (the gate, in order)

`GraphicalCode.Validate` enforces a named, ordered set of rules — the language's well-formedness. A push is refused
unless ALL hold, so a graphical body never silently renames wires, drifts, or corrupts/crashes the IDE:

1. **Language** — FBD/LD only (`VG_*` parse codes otherwise).
2. **Parse** — structurally valid VG (the codes above).
3. **Leaf single-use** (`VG_LEAF_FANOUT`) — one `inVariable` box per read; a block output may fan out (read off the XML).
4. **VG-text round-trip** (`VG_NOT_CANONICAL`) — the VG ⇄ graph leg: `VgWriter(VgParser(x)) == x`.
5. **PLCopen convergence** (`VG_PLCOPEN_DRIFT`) — the graph ⇄ PLCopen ⇄ IDE leg: the body reaches a fixed point
   through `PlcOpenWriter`→`PlcOpenReader`, so the closed loop push → pull → push stabilises.

The two round-trip legs together are the backstop: nothing we accept can drift or be a shape the importer
rejects. See `Graphical/GraphicalCode.cs` (`Validate`) and `Vg/VgParser.cs`.
