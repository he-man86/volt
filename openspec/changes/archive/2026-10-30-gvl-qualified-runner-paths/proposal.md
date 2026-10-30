> DRAFT, written from Sim-Assist (change `plc-files`, 2026-10-29). Measured, not started.

## Why

The runner knows globals by their bare name only, and two `qualified_only` GVLs that declare the same name share that
name in the runner. CODESYS allows `GVL_A.count` and `GVL_B.count` side by side; that is what `qualified_only` is for.
Sim-Assist reads and forces globals (live values, trace) through `Runner.get/set` and lets users create several GVLs.

Measured on volt dev `9d5e54aebb` (and on Sim-Assist's vendored `5ed026b373`, same result):

```
GVL_A.gvl and GVL_B.gvl (identical):
{attribute 'qualified_only'}
VAR_GLOBAL
	count : INT;
END_VAR

Main.pou:
PROGRAM Main
VAR
END_VAR
GVL_A.count := 1;
GVL_B.count := 2;
END_PROGRAM
```

`computeDiagnostics`: no diagnostics. `lowerSource`: no diagnostics. `run(pou)`, one `scan()`:

| Call | Measured | Expected |
|---|---|---|
| `get("GVL_A.count")` | throws "no variable GVL_A.count in Main" | 1 |
| `get("GVL_B.count")` | throws "no variable GVL_B.count in Main" | 2 |
| `get("count")` | 1 | refused or ambiguous (two globals named `count`) |

The program wrote 2 to `GVL_B.count`, yet the only name the runner offers reads 1, so one of the two globals cannot be
observed or forced at all.

Sim-Assist works around it (`plc/engine/volt-engine.ts` `mapGlobals`): it refuses a program that uses the same global
name in two GVLs with its own `ambiguous-global` error, and maps `<GVL>.<name>` to the bare runner name.

## What changes

- `Runner.get/set` (and the pou's `globals` listing) accept the qualified path `<GVL>.<name>` for every global; the
  bare name stays valid only for a global declared once, in a GVL that is not `qualified_only`.
- Two globals with the same name in different GVLs get separate cells and separate qualified paths.

## Impact

- `src/transpile` (global naming in the IR and runner).
- Sim-Assist can drop its `ambiguous-global` refusal for same-named qualified globals after `npm run build:volt`.
