> DRAFT, written from Sim-Assist (change `plc-files`, 2026-10-29). Measured, not started.

## Why

A function block instance declared in a global variable list cannot be called. CODESYS allows it (a timer or a
motor FB in a GVL, called from the program), and Sim-Assist users now create GVL files next to their program.

Measured on volt dev `9d5e54aebb` (and on Sim-Assist's vendored `5ed026b373`, same result), with
`parseDocument` + `buildSymbolTable` + `computeDiagnostics` + `lowerSource(main, "Main", [GVL_A.gvl, Standard…], "Main.pou")`:

```
GVL_A.gvl:
{attribute 'qualified_only'}
VAR_GLOBAL
	t : TON;
END_VAR

Main.pou:
PROGRAM Main
VAR
	q : BOOL;
END_VAR
GVL_A.t(IN := TRUE, PT := T#1S);
q := GVL_A.t.Q;
END_PROGRAM
```

| Step | Measured | Expected |
|---|---|---|
| `computeDiagnostics` (both files) | no diagnostics | no diagnostics |
| `lowerSource` | `place-not-local` "GVL_A is a gvl_block, which has no frame slot yet" at 5:1 | lowers; the TON lives in the global frame |
| `run` + `scan` | (not reached) | `get("q")` is FALSE at 0 ms, TRUE after 1 s |

## What changes

- Lowering gives an FB instance declared in a `VAR_GLOBAL` a global slot (with its instance layout), so
  `GVL.inst(...)`, `GVL.inst.Q` and the unqualified form for a non-`qualified_only` GVL call and read it like a local
  instance.
- Until then, `computeDiagnostics` could flag the call with the same message, so an editor shows it before Start.

## Impact

- `src/transpile` (lowering of global places, runner frame layout).
- Sim-Assist: no change needed beyond `npm run build:volt`; today it shows the lowering refusal at the call site.
