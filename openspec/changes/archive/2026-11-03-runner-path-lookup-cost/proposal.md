> Written from Sim-Assist (C20 `sim-perf`, 2026-11-03). Valid; built 2026-11-03. Owner (2026-10-29): "whenever you
> find bugs in volt engine please report to volt ... this way both apps are becoming more stable".

## Why

`Runner.get(path)` and `Runner.set(path, value)` resolve the path from scratch on every call
(`transpile/interp/runner.ts` → `resolvePath` → `transpile/ir/path.ts` `pathRoot`): `parsePath` (a regex `matchAll`),
`pou.slots.findIndex` with `sameName` (two `toLowerCase` per slot) and `unquoted` (a regex replace per slot), then a
fresh array of every global (`flatMap` + `map`, one object per global) searched the same way. So one call costs
O(slots + globals) and allocates per global.

A host copies its process image through these calls every scan. Sim-Assist does it for each IO variable of its scene
(one `set` per input, one `get` per output after the scan). Measured with Sim-Assist's bundle of volt dev (Node 24,
i7 laptop), its performance reference plant: 497 variables, of which 290 IO globals in one `qualified_only` GVL:

| call | cost |
| --- | --- |
| `get("IO.L1S1_Belt_Velocity")` (a global) | 31-37 µs |
| `set("IO.L10E5_Eye_Active", true)` | 33 µs |
| `get("step")` (a local) | 1.4 µs |
| `scan()` of the whole program | 0.09 ms |

The IO copy (290 resolves per scan after Sim-Assist's own reduction, 510 before) costs 10.5 ms of every 20 ms scan
cycle, the program itself 0.09 ms, and the copy allocates about 25 MB per scan (the per-call globals array and the
lowercased names). The cost grows with variables × IO, so a plant twice the size pays four times. In the browser this
is the largest part of the frame and its garbage causes the GC pauses in the 3D view.

## What Changes

- The runner resolves each distinct path once and keeps the resolved PLACE and type for later `get`/`set` of that path;
  `checkValue` still runs on every `set`.

## What was built, against the draft

The draft kept the located container and key, on the ground that containers are stable for the life of the runner. They
are not guaranteed to be: `a := b;` on a struct or an array may replace the record a path leads through, and a VAR_TEMP
starts over every scan, so a cached container could read a stale value and lose a write. A place depends on the POU alone,
so it is what is kept, and `machine.locate` still walks it on every call. No `ref(path)` API and no per-POU globals lookup:
neither is needed for this cost. A path that does not resolve is refused every time, never remembered.

## Impact

- `packages/volt-lsp-iec/src/transpile/interp/runner.ts` (`run`: get/set), `transpile/ir/path.ts` (`pathRoot`);
  colocated tests (same values as uncached, errors unchanged, a cached path after a write by the program).
- Sim-Assist: `plc/engine/plc-session.ts` skips the set and the read before the scan of an output the program already
  holds (exact, no change in behaviour); every input is still set every scan, which only this change makes cheap.
  The benchmark `npm run bench:sim` (Sim-Assist) shows the scan time; its budget tightens when the bundle has the fix.
