> DRAFT, written from Sim-Assist (change `plc-files`, 2026-10-29). Measured, not started.

## Why

`lowerSource` diagnostics carry a span but no file. When the program spans several files, a consumer cannot tell
where the problem is. The clearest case is a reached LD/FBD POU: `graphical-body` is reported at the call site in the
main file, and the POU at fault is only named inside the message text.

Measured on volt dev `9d5e54aebb` (and on Sim-Assist's vendored `5ed026b373`, same result),
`lowerSource(main, "Main", [FB_L.pou, Standard…], "Main.pou")`:

```
FB_L.pou:
FUNCTION_BLOCK FB_L
VAR_INPUT
	i : BOOL;
END_VAR
VAR_OUTPUT
	o : BOOL;
END_VAR
%LANGUAGE LD
%NETWORK
o := i;
END_FUNCTION_BLOCK

Main.pou:
PROGRAM Main
VAR
	f : FB_L;
END_VAR
f(i := TRUE);
END_PROGRAM
```

| Field | Measured | Expected |
|---|---|---|
| `code` | `graphical-body` | `graphical-body` |
| `message` | "FB_L is plain-ST network text, which is not lowered yet" | unchanged |
| `uri` | (absent) | `FB_L.pou` |
| span | 5:1 (the call `f(...)` in `Main.pou`) | the body (or header) of `FB_L` in `FB_L.pou` |

With two instances (`f, g : FB_L;` both called) a second diagnostic follows, `call-body` "FB_L's body does not lower",
again at a call site in `Main.pou`.

Sim-Assist works around it (`plc/engine/volt-engine.ts` `attributeLowering`): it parses the POU name out of the
message, moves the error to that file at 1:1, drops the `call-body` follow-ups, and for other codes lowers every
additional file as its own entry to find which one reports the same diagnostic. Every consumer would have to copy that.

## What changes

- `LowerDiagnostic` gains `uri` (the file of the span), set for every diagnostic, including those raised while
  lowering a library POU's body.
- `graphical-body` is reported once per POU, on the POU's own span in its own file; calls of an unlowerable POU do not
  add `call-body` diagnostics for the same cause.

## Impact

- `src/transpile` (diagnostic shape; `.d.mts` of consumers).
- Sim-Assist can delete the message parsing and the per-file re-lowering after `npm run build:volt`.
