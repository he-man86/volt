# VG — the Volt Graphical language

VG is the editable, **ST-like** text projection of a graphical (FBD/LD) POU body. The AI and the
engineer read/edit VG; the bridge round-trips it to the IDE's PLCopenXML (`PlcOpenReader` ↔
`PlcOpenWriter`) and CODESYS/TwinCAT re-lay-out the diagram on import.

> **VG is ISOMORPHIC to the PLCopen node graph.** Every node is its own named statement — one
> statement ⇄ one XML node — and operands are *only* names or literals, never a nested
> sub-expression. inVariable leaves are named `i*`, operator/function results `g*`, and both are
> declared in a per-network `VAR_TEMP`; FB instances and outVariable sinks keep their real names.
> This shrinks the "expressible in VG but not in FBD" gap to ~zero (there's no syntax for a non-FBD
> shape), makes round-trip identical in all cases (fan-out preserved by shared names), and lets the
> LSP validate the whole body as a flat assignment list.

> VG reads as ST and the ST LSP loads it, but it is **not strictly valid ST** — a few pin
> modifiers (edge/storage) are VG extensions chosen so the modifier stays visible *at the pin*
> rather than synthesizing hidden `R_TRIG`/`SR` instances, and `NETWORK`/`END_NETWORK` are VG
> keywords. This is a deliberate trade (clarity over ST-purity). Keep this file in sync whenever the
> language changes.

## File extensions (CLI `registry/extensions.ts`)
| Body language | ext | access |
|---|---|---|
| ST | `.st` | rw |
| FBD | `.fbd` | rw (editable VG) |
| LD | `.ld` | rw (editable VG) |
| CFC | `.cfc` | r (read-only view, not transpiled) |
| SFC | `.sfc` | r (read-only view, not transpiled) |

A pure-graphical-root POU is one file. Graphical bodies are detected by their opening marker (see
`VgBody`): editable FBD/LD lead with `NETWORK <n> <LANG>`; read-only CFC/SFC (no networks) are a bare
`%LANG <lang>` placeholder. A graphical CHILD (action/method) embedded in a `.st` carries its
sub-folder as a leading `%FOLDER <path>` directive, then the body's own marker.

### FBD and LD are the same structure (IMPLEMENTED)
FBD and LD share ONE internal model — in the IDE the FBD↔LD switch is just a view toggle on the same
network. At the PLCopen level the body uses the SAME elements (`block`/`inVariable`/`outVariable`/…)
for both; only the wrapper/view differs. Confirmed live: the identical network as an FBD action and an
LD action round-trips to byte-identical VG. So LD needs no separate transpiler — it reads/writes
through the same pipeline. Two specifics:
- The authoritative language is the IDE's `DefaultViewMode` (CODESYS object property; TwinCAT
  `LanguageOf` on the NWL impl), threaded into the `NETWORK <n> <LANG>` marker — **TwinCAT serializes
  an LD body with an `<FBD>` wrapper**, so the wrapper name alone can't be trusted.
- `SpliceFbdLdBody` preserves the original `<FBD>`/`<LD>` wrapper on push (swaps contents only), so a
  graphical push never flips the wrapper or changes the editor's view.

Genuine LD-only elements (`<contact>`/`<coil>`/power rails) DO occur (a captured TwinCAT `<LD>` body
had them). They are **read-lowered** to the same boolean graph as the FBD twin so ladder READS as VG:
series contacts → `AND`, parallel branches → `OR`, normally-closed → `NOT`, coil → assignment, S/R
coil → `SET`/`RESET`, and a function block placed in a rung keeps its wiring. This is **read-only**:
the original `<contact>`/`<coil>` keeps the push guard refusing (no reverse lowering yet), so ladder
can never be corrupted — only viewed. (`PlcOpenReader.LowerLadder`.)

## Structure
```
NETWORK 0 FBD             block header: NETWORK <index> <LANG (FBD|LD)>; index = real PLCopen
  // comment              network index (localId / 10^10), preserved verbatim (gaps and all)
  VAR_TEMP                decl section: declares this network's synthetic temps (i*, g*)
    i1 : BOOL;            — leaf inVariable temps and operator/function result temps, with types
    g1 : BOOL;              from the IDE's param-types (else BOOL). A VG-only construct: stripped on
  END_VAR                  push, regenerated on pull (never load-bearing for round-trip).
  i1 := a;                impl section: every node is one statement
  g1 := (i1 AND ...);
END_NETWORK               explicit block terminator

NETWORK 1 FBD "label"     optional network label after the language
NETWORK 1 FBD DISABLED    an out-commented network
```
A body is a stack of `NETWORK … END_NETWORK` blocks. A network with no temps (control-flow-only /
empty) omits the `VAR_TEMP` block entirely.

## Statements (IMPLEMENTED)
| Form | Example | Meaning |
|---|---|---|
| Leaf input | `i1 := a;` | one `inVariable`; RHS is opaque pin text (literal/variable/expression, e.g. `a + 1`) |
| Operator (infix) | `g1 := (i1 AND i2);` | operator box; result named `g1`; operands are names only |
| Function call | `g1 := LIMIT(i1, i2, i3);` | stateless function box |
| FB instance call | `tmr(IN := i1, PT := i2);` | FB instance; inputs as `pin := value` |
| Block output ref | `done := tmr.Q;` | read a block's named output pin |
| Output assignment | `y := g1;` | outVariable sink (a wire feeding a variable) |
| Branch / fan-out | `out := g1;` + `out2 := g1;` | one node feeding many sinks — reference the name twice (one node, exactly) |

Operands are **always** a declared name (`i*`/`g*`/FB instance) or appear as their own leaf — never a
nested sub-expression and never a bare inline literal (`g1 := (TRUE AND i2)` is rejected; `TRUE` must
be its own `i*` leaf). This is what the parser enforces as the VG ⊆ FBD gate.

### Pin / operand modifiers (IMPLEMENTED — VG extensions)
| Modifier | Syntax | PLCopen attr | Valid ST? |
|---|---|---|---|
| Negation | `NOT operand` | `negated="true"` | yes (`NOT` is an ST operator) |
| Rising edge | `operand RISING` | `edge="rising"` | no (VG extension) |
| Falling edge | `operand FALLING` | `edge="falling"` | no (VG extension) |
| Set storage | `src SET` | `storage="set"` | no (VG extension) |
| Reset storage | `src RESET` | `storage="reset"` | no (VG extension) |

Example (live TwinCAT) — note operands are named leaves: `i1 := xtest;` `i2 := xtestr1;`
`SR_0(SET1 := NOT i1, RESET := i2 RISING);`

### Control flow (IMPLEMENTED — valid CODESYS ST)
| Element | VG | PLCopen |
|---|---|---|
| Label | `name:` | `<label label="name"/>` |
| Unconditional jump | `JMP name;` | `<jump label="name">` (no condition) |
| Conditional jump | `IF cond THEN JMP name; END_IF` | `<jump label="name">` + condition wire (`negated` → `IF NOT cond`) |
| Return | `RETURN;` / `IF cond THEN RETURN; END_IF` | `<return>` (± condition wire) |

These are real CODESYS/TwinCAT ST (`JMP`/labels are a CODESYS extension), so they round-trip 1:1
and the ST LSP parses them. Modeled as `Jump`/`Label`/`Return` in `GraphModel.cs`.

Operators live in `FbdOperators.cs` (type↔symbol): `OR AND XOR ADD(+) SUB(-) MUL(*) DIV(/) MOD GT(>) LT(<) GE(>=) LE(<=) EQ(=) NE(<>)`.

## Round-trip guarantees
- `VgWriter`→`VgParser`→`VgWriter` is a **fixed point** (deterministic emission).
- Round-trip is **structurally identical in all cases**: node identity is the name, so a fanned-out
  node round-trips as one node, and gapped network indices are preserved by the `NETWORK <n>` marker.
- The `VAR_TEMP` block is **stripped on push** (VgParser consumes it into no graph nodes) — CODESYS/
  TwinCAT reconstruct the param-types, and never receive temp declarations. Types are writer-owned
  and parser-ignored, so they can never cause drift.
- `PlcOpenReader`→`PlcOpenWriter` re-emits `fbdcalltype`, `inputparamtypes`/`outputparamtypes`, and
  the modifier attributes above.
- **Write-loss guard** (`PlcOpenDocument.SpliceFbdLdBody`): a push of a body containing any element
  VG can't yet represent (see Deferred) is **refused**, never silently dropped. Allowed body
  elements today: `inVariable`, `outVariable`, `block`, `label`, `jump`, `return`
  (+ cosmetic `vendorElement`).

## DEFERRED (not yet in VG — bodies using these are read-incomplete and refused on push)
- **Free comment boxes** (`<comment>`) — only network `//` comments exist.
- **LD-only elements** (`<contact>`/`<coil>`/power rails) — now **read-lowered** to boolean VG
  (`PlcOpenReader.LowerLadder`), so ladder READS as `AND`/`OR`/`NOT`/assignment. Still read-only:
  push is refused (no reverse lowering yet), so they remain on this list for the WRITE direction.
- **Connectors / continuations** (`<connector>`/`<continuation>`).
- **FB-call in-out pin wiring** (`<block><inOutVariables>`) — VAR_IN_OUT *declarations* already
  round-trip as plain decl text; only the graphical wiring of an in-out pin is unhandled.
- **Multi-output stateless functions** — an operator/function result is referenced as the bare temp
  `g1` (one output), so a stateless FUNCTION with several `VAR_OUTPUT`s can't be represented. This is
  **refused on push** by the write-loss guard (never silently dropped); such a POU stays a read-only
  view. (Rare — multi-output blocks are normally FB *instances*, which DO round-trip via `inst.pin`.)

## Jump encoding (reference — IMPLEMENTED, see "Control flow" above)
Confirmed against a real TwinCAT export (fixture `fixtures/tc-fbd/PLC_PRG_jump_sr.plcopen.xml`):
TC encodes jump and label as **separate flat elements** with a matching `label` attribute, each in
its own network (by localId index):
```xml
<inVariable localId="50000000000"><expression>cond</expression></inVariable>
<jump localId="50000000001" label="jump12">
  <connectionPointIn><connection refLocalId="50000000000"/></connectionPointIn>   <- condition wire (optional)
</jump>
<label localId="60000000000" label="jump12"/>
```
Rendered as valid CODESYS ST (see the Control flow table above): `IF cond THEN JMP jump12; END_IF`
and `jump12:`. `Jump`/`Label`/`Return` are real `GraphModel` nodes; `VgWriter` emits control-flow
statements after a network's dataflow (each jump/label is its own network, so execution order is
preserved by network order).

## Out-commented networks — TC drops them on export (FINDING)
An out-commented (disabled) network is **NOT included in TwinCAT's PLCopenXML export** — it shows
up only as a gap in the localId network numbering (we observed networks 1,2,4,5,6 with 3 missing,
no `<comment>` element). So via the PLCopen path the bridge **never sees** out-commented networks.
- Consequence: they can't be shown or edited (we don't receive them), AND — since the export
  already omits them — a push (export→splice→import) can **drop them from the IDE** without the
  write-loss guard noticing (the guard scans the export, which never had them). ⚠️ Open risk to
  resolve before trusting graphical push on POUs that contain out-commented networks.
- Free comment **boxes** (`<comment>`) were likewise absent — TC didn't export one here.
