# VG (graphical body) format & diagnostics

VG is the textual form of an FBD/LD graphical body — isomorphic to the PLCopen node graph, so it round-trips
exactly. The bridge **owns the format** (the LSP owns code correctness): a push whose VG isn't valid/canonical is
refused *before* it reaches the IDE, with a structured diagnostic. These rules are **general** — they depend only
on the VG text, never on the PLC code semantics — so they're computed next to the parser
(`Volt.Bridge.Core/Graphical/Vg/VgParser.cs`) with no IDE state.

## The strict form (what the parser accepts)

```
NETWORK <n> <FBD|LD>
  VAR_TEMP
    <name> : <type>;        -- one per intermediate wire; types are writer-owned (normalised to BOOL on read)
  END_VAR
  <statements>
END_NETWORK
```

- **Leaf** (`i1 := <expr>`): an inVariable source. The right-hand side is opaque text over real variables/literals
  — it may NOT derive from another temp (a temp is a graph node, not a sub-expression).
- **Operator** (`g := (a OP b [OP c …])`): exactly one operator per statement (`AND OR XOR + - * / MOD > < >= <= = <>`).
  Split nested expressions into separate temps.
- **Call** (`inst(PIN := arg, …)` / `g := FN(arg)`): an FB instance or function; each arg references a temp/instance.
- **Output** (`out := <temp|inst.PIN>`): a coil / outVariable sink. A block's non-boolean output (e.g. a timer's
  `ET`) is assigned the same way and embeds in the block's pin on write.
- **Modifiers**: `NOT` (negation), `RISING`/`FALLING` (edge), `SET`/`RESET` (coil storage) ride on the CONSUMER
  (the operand/leaf/sink), never as their own statement (`out := NOT g1`, not `g2 := NOT g1`).

## Diagnostic codes

Each refusal carries a stable `code`, a 1-based `line`, and a message; the round-trip gate also returns the
canonical body to paste. (`PushConflict.code` / `.line` on the wire; the CLI prints `name:line [CODE] message`.)

| Code | Meaning |
|---|---|
| `VG_NOT_CANONICAL` | Parses, but `VgWriter(VgParser(x)) != x` — it would drift on the next pull. The message includes the exact canonical form. |
| `VG_LEAF_REFERENCES_TEMP` | A leaf's RHS derives from a temp (a nested expression not decomposed, or `g2 := NOT g1`). |
| `VG_UNRESOLVED_OPERAND` | An operand references something that isn't a declared temp or FB instance. |
| `VG_BAD_OPERATOR_STMT` | An operator statement isn't `a OP b [OP c …]`. |
| `VG_UNKNOWN_OPERATOR` | The operator symbol isn't a known FBD/LD operator. |
| `VG_MIXED_OPERATORS` | More than one distinct operator in a single statement. |
| `VG_NETWORK_NOT_CLOSED` | A `NETWORK` block is missing its `END_NETWORK`. |
| `VG_PARSE` | Any other structural parse error (unexpected `END_NETWORK`, unclosed `VAR_TEMP`, statement before a network, …). |

The round-trip gate is the backstop: anything that wouldn't re-emit identically is refused, so a graphical push
never silently renames temps or corrupts the IDE. See `Graphical/GraphicalCode.cs` (`Validate`) and `Vg/VgParser.cs`.
