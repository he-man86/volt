# Graphical-to-ST transpiler

Converts PLCopen TC6 v2.01 `<body>` XML (FBD / LD) into Structured Text
at pull time. The workspace stores only `.st` files — graphical bodies
never reach the workspace as XML.

## Where it lives

- **Implementation**: `transpile-graphical-to-st.ts`
- **Entry point**: `transpileGraphicalBodyToST(bodyXml: string) → TranspileResult`
- **Called from**: `materializeItem` in `ops.ts`
- **Tests**:
  - `transpile-graphical-to-st.test.ts` — pinned ST snapshots per pattern
  - `transpile-coverage.test.ts` — runs the transpiler against all 37
    real-world fixtures in `__fixtures__/` and reports pass/fail
  - Fixtures: `__fixtures__/fbd-bodies.ts` + `__fixtures__/ld-bodies.ts`

## Supported patterns

### FBD

| Pattern | Example output |
|---|---|
| Operator block, binary | `out := a AND b;` |
| Operator block, unary | `out := NOT a;` |
| Operator block, n-ary | `out := a AND b AND c;` |
| Operator block, function-shape | `out := SEL(g, a, b);` |
| FB instance (single output) | `r1(CLK := signal); done := r1.Q;` |
| Multi-network body | each network emits its own block, separated by `(* Network N *)` headers |
| Direct outVariable | `result := TRUE;` |

### LD

| Pattern | Example output |
|---|---|
| Single contact → coil | `c := a;` |
| Series contacts | `c := a AND b;` |
| Negated contact | `c := NOT a;` |
| Set coil `(S)` | `IF cond THEN out := TRUE; END_IF;` |
| Reset coil `(R)` | `IF cond THEN out := FALSE; END_IF;` |
| Negated coil `(/)` | `c := NOT (cond);` |
| Rising-edge contact `\|P\|` | synthesizes a `_volt_edge_<localId> : R_TRIG;` VAR_TEMP + `_volt_edge_*.Q` value |
| Falling-edge contact `\|N\|` | same with `F_TRIG` |
| FB block in a rung | `tmr(IN := trig, PT := T#1S); done := tmr.Q;` |
| Multi-rung LD body | each rung emits its assignment block |

## Loud-fail patterns

The transpiler refuses the pull (no silent best-effort output) when it
sees:

- **Body with neither `<FBD>` nor `<LD>`** — SFC/CFC out of scope
- **Duplicate `localId`** — the connection address space requires unique IDs
- **Dangling `refLocalId`** — connection points at a localId not in the network
- **Jump to undefined label**
- **Feedback loops** — cycle detection via `cycleGuard` set per walk

When pull fails, the error message names the offending body and the
defect. Users either restructure the body in the IDE so it transpiles,
or extend this file to handle a new pattern.

## Extending coverage

The transpiler is structured around three extension points:

1. **Operator tables** (`INFIX_OPERATORS`, `UNARY_OPERATORS`,
   `FUNCTION_OPERATORS`) — pure data. Add `{"SHL": "SHL", …}` to the
   appropriate table. Unknown operators fall through to a generic
   function call (`typeName(arg1, arg2, …)`) so most cases work
   without new code.

2. **Node-kind dispatch in `expressionForEdge` (FBD) / `ldConditionFromEdge`
   (LD)** — when you encounter a new node kind that needs special
   handling (e.g. for SFC's `<step>` or CFC's free-placement
   blocks), add a branch.

3. **`tempDeclarations` for stateful synthesis** — when a pattern
   needs an internal FB instance (edge contacts already use this),
   push the declaration string onto `ctx.tempDeclarations`. The
   agent splices these into a VAR_TEMP block in the POU's
   declaration shell.

## Determinism

Same XML input MUST produce byte-identical ST output. Enforced by:

- Sorted iteration where order matters (`...sort((a, b) => a.localId.localeCompare(b.localId))`)
- No timestamps, no random tempnames (tempnames derive from `localId`)
- Set guards (`cycleGuard`, `emittedBlockCalls`) prevent walk-order leaks
- Coverage test runs the transpiler N times against each fixture and
  asserts identical output

## License posture

Clean-room implementation, MIT-aligned with the rest of Volt.
Algorithm informed by Beremiz's `PLCGenerator.py` ("reverse value
propagation") — the public algorithm, not the GPL'd source.
See `TRANSPILER-RESEARCH.md` for the Phase 0 research that landed
on this approach.
