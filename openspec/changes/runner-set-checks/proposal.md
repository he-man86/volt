> Owner, 2026-10-29 (from Sim-Assist): "whenever you find bugs in volt engine please report to volt ... this way both
> apps are becoming more stable". DRAFT, written from Sim-Assist. Measured, not started.

## Why

`Runner.set(path, value)` (`src/transpile/interp/runner.ts`) writes whatever it is handed into the variable's cell,
with no check against the variable's declared type. Sim-Assist drives it from user input (forcing a value in the editor)
and from a 3D scene (sensor values written into PLC inputs every scan), so a bad value is a normal event there, not a
programming error.

Measured on volt 5ed026b373 (Sim-Assist's bundle), a program `VAR i : INT; b : BYTE; t : TIME; x : REAL; END_VAR`:

| Call | `get` afterwards | Expected |
|---|---|---|
| `set("i", 70000n)` | `4464` (wrapped) | refused: 70000 is no INT |
| `set("b", 300n)` | `44` (wrapped) | refused |
| `set("t", -1n)` | `4294967295` (wrapped) | refused: a TIME is not negative |
| `set("x", 1e40)` | `Infinity` | refused: 1e40 is no REAL (float32) |
| `set("i", "abc")` | `"abc"`: a STRING in an INT cell | refused: wrong kind of value |

The last row is the serious one: the next scan reads a string where lowering promised an INT. CODESYS refuses all five
in its online write/force dialog ("value out of range" / "invalid value").

Sim-Assist now checks range and kind itself before calling `set` (its `plc/engine/volt-engine.ts` `toVal`), which is
the check every consumer would have to copy.

## What changes

- `Runner.set` checks the value against the variable's type and throws a named error (a `RunnerValueError` with the
  path, the type and the reason) instead of writing it: integer and bit types by range (bigint), TIME/LTIME, DATE/TOD/DT
  by their ranges, REAL by float32 (`Math.fround` finite), LREAL finite, BOOL a boolean, STRING/WSTRING a string within
  the declared length, and a struct/array value by its fields/elements.
- Nothing is written when the check fails.
- The hidden `__clock` keeps its own rule (a non-negative bigint).

## Open (for the owner)

1. Wrap or refuse is a choice the IEC leaves to the IDE; CODESYS refuses on write. Refusing is proposed; a test harness
   that wants wrap-around can still write the wrapped value.
2. STRING longer than its declared length: refuse, or truncate as an assignment in ST would?
