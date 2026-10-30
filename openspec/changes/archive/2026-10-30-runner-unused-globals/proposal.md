> DRAFT, written from Sim-Assist (change `plc-trace`, 2026-10-29). Measured, not started.

## Why

A global that the program never references is not in the lowered POU, so the runner cannot read or force it. CODESYS
monitors every declared global, used or not; Sim-Assist shows live values, forcing and trace for GVL globals and
users expect a freshly declared `gSpeed` to be visible before code uses it.

Measured on Sim-Assist's vendored volt `5ed026b373` (`lowerSource` + `runWithOptions`):

```
GVL_V1.gvl:
{attribute 'qualified_only'}
VAR_GLOBAL
gTotal : INT;
gSpeed : REAL := 1.5;
END_VAR

Main.pou:
PROGRAM Main
VAR
x : INT;
END_VAR
GVL_V1.gTotal := GVL_V1.gTotal + 1;
END_PROGRAM
```

`computeDiagnostics`: no errors. `lowerSource`: no diagnostics. `run(pou)`:

| Call | Measured | Expected |
|---|---|---|
| `pou.globals` | `gTotal` only | `gTotal` and `gSpeed` |
| `get("gTotal")` | `0n` | `0n` |
| `get("gSpeed")` | throws "no variable gSpeed in Main" | `1.5` |

Sim-Assist lists only the globals the program uses (`plc/engine/volt-engine.ts` `collectVariables`) and tells the user
in the trace picker that unused globals are not available.

## What changes

- Lowering keeps every global of every GVL library file passed in (with its initial value) in `pou.globals`, used or
  not; the runner can `get`/`set` it.

## Impact

- `src/transpile` (global collection during lowering).
- Sim-Assist lists all GVL globals after `npm run build:volt` and drops its note.
