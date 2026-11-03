> Written from Sim-Assist. The cost is real; the draft's reason for caching the container is not (proposal, "What was built"). Built 2026-11-03.

## 1. Path lookup

- [x] 1.1 `run()` keeps each path's resolved PLACE (`Map<string, ...>`) for `get` and `set` and locates it on every call; `checkValue` still runs on every `set`. Tests (`interp/runner-paths.test.ts`): a path read after the program assigned the whole struct or array it leads through, a write through it, an unknown path and a bad index refused every time, a value out of range refused on every `set`. No timing assertion: a test under CI load would flake, so 1.3 measures instead.
- [x] 1.2 Not built: with 1.1, `pathRoot` runs once per distinct path, so its per-call array is gone from the hot path and a per-POU lookup would only speed up the first read.
- [x] 1.3 Measured in Volt (Bun, a 497-variable POU, 290 globals in one `qualified_only` GVL): 290 `get`s 0.013 ms per scan, 290 `set`s 0.034 ms. Sim-Assist confirms on its reference plant under Node when its bundle has this build.
