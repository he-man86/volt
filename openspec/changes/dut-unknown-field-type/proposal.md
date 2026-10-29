> DRAFT, written from Sim-Assist (change `plc-files`, 2026-10-29). Measured, not started.

## Why

A STRUCT field of an unknown type gets no diagnostic. The program only fails at lowering, with a message about a
variable and a position in the main file, not in the DUT that holds the mistake. Sim-Assist users now write DUT files
by hand, so a typo in a field type is a normal event.

Measured on volt dev `9d5e54aebb` (and on Sim-Assist's vendored `5ed026b373`, same result):

```
ST_Data.dut:
TYPE ST_Data :
STRUCT
	value : INT;
	other : NoSuchType;
END_STRUCT
END_TYPE

Main.pou:
PROGRAM Main
VAR
	d : ST_Data;
END_VAR
d.value := 1;
END_PROGRAM
```

| Step | Measured | Expected |
|---|---|---|
| `computeDiagnostics` on `ST_Data.dut` | no diagnostics | an error on `NoSuchType` (4:10), as for an unknown type in a VAR block |
| `lowerSource(main, "Main", …)` | `slot-unknown` "other is a unknown variable, which has no runtime representation yet" at 1:1 | not reached (the diagnostic stops it), or at least the DUT's span |

## What changes

- The type checker resolves STRUCT (and UNION) field types like variable declarations and reports an unknown type on
  the field's type span, in the DUT's own file.

## Impact

- `src/analysis` (type resolution of DUT fields). No runtime change.
