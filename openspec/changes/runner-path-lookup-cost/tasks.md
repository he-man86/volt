> DRAFT, written from Sim-Assist. Not started.

## 1. Path lookup

- [ ] 1.1 `run()` caches the resolution of each path (`Map<string, Found>`) for `get` and `set`; `checkValue` still
      runs on every `set`. Test (colocated): 10 000 `get`s of a GVL member of a 400-variable POU run in under 20 ms; a
      value written by the program is read through the cached path; a `RunnerValueError` is unchanged.
- [ ] 1.2 `pathRoot` builds its globals lookup once per POU instead of per call. Test: same results for listed,
      bare, ambiguous, `qualified_only` and unlowered globals as before (existing path tests stay green).
- [ ] 1.3 Measure with the repro: Sim-Assist's reference plant (497 variables, 290 IO globals) copies its IO in under
      0.5 ms per scan.
