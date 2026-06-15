# VG — the Volt Graphical language

VG is the editable, **ST-like** text projection of a graphical (FBD/LD) POU body. The AI and the
engineer read/edit VG; the bridge round-trips it to the IDE's PLCopenXML (`PlcOpenReader` ↔
`PlcOpenWriter`) and CODESYS/TwinCAT re-lay-out the diagram on import.

> VG reads as ST and the ST LSP loads it, but it is **not strictly valid ST** — a few pin
> modifiers (edge/storage) are VG extensions chosen so the modifier stays visible *at the pin*
> rather than synthesizing hidden `R_TRIG`/`SR` instances. This is a deliberate trade (clarity over
> ST-purity). Keep this file in sync whenever the language changes.

## File extensions (CLI `registry/extensions.ts`)
| Body language | ext | access |
|---|---|---|
| ST | `.st` | rw |
| FBD | `.fbd` | rw (editable VG) |
| LD | `.ld` | rw (editable VG) |
| CFC | `.cfc` | r (read-only view, not transpiled) |
| SFC | `.sfc` | r (read-only view, not transpiled) |

A pure-graphical-root POU is one file; the `(* @volt-graphical: LANG vg *)` marker is used **only**
for a graphical CHILD (action/method) embedded in a file whose root language differs.

### FBD and LD are the same structure (IMPLEMENTED)
FBD and LD share ONE internal model — in the IDE the FBD↔LD switch is just a view toggle on the same
network. At the PLCopen level the body uses the SAME elements (`block`/`inVariable`/`outVariable`/…)
for both; only the wrapper/view differs. Confirmed live: the identical network as an FBD action and an
LD action round-trips to byte-identical VG. So LD needs no separate transpiler — it reads/writes
through the same pipeline. Two specifics:
- The authoritative language is the IDE's `DefaultViewMode` (CODESYS object property; TwinCAT
  `LanguageOf` on the NWL impl), threaded into the VG `%LANG` header — **TwinCAT serializes an LD body
  with an `<FBD>` wrapper**, so the wrapper name alone can't be trusted.
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
%LANG FBD                 header: FBD | LD
NETWORK                   one self-contained dataflow island; a body is a stack of these
  <statement>;
NETWORK "label"           optional network label
  // comment              network comment (one or more // lines under the header)
NETWORK DISABLED          an out-commented network
```

## Statements (IMPLEMENTED)
| Form | Example | Meaning |
|---|---|---|
| Operator (infix) | `g1 := (a AND b);` | operator box; result named `g1` (gates renumber per network) |
| Function call | `g1 := LIMIT(mn, x, mx);` | stateless function box |
| FB instance call | `tmr(IN := run, PT := t#5s);` | FB instance; inputs as `pin := value` |
| Block output ref | `done := tmr.Q;` | read a block's named output pin |
| Output assignment | `y := g1;` | outVariable sink (a wire feeding a variable) |
| Branch / fan-out | `out := g.Q1;` + `out2 := g.Q1;` | one output feeding many sinks (just reference it twice) |

### Pin / operand modifiers (IMPLEMENTED — VG extensions)
| Modifier | Syntax | PLCopen attr | Valid ST? |
|---|---|---|---|
| Negation | `NOT operand` | `negated="true"` | yes (`NOT` is an ST operator) |
| Rising edge | `operand RISING` | `edge="rising"` | no (VG extension) |
| Falling edge | `operand FALLING` | `edge="falling"` | no (VG extension) |
| Set storage | `src SET` | `storage="set"` | no (VG extension) |
| Reset storage | `src RESET` | `storage="reset"` | no (VG extension) |

Example (live TwinCAT): `SR_0(SET1 := NOT xtest, RESET := xtestr1 RISING);`

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
- `PlcOpenReader`→`PlcOpenWriter` re-emits `fbdcalltype` + the modifier attributes above.
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
