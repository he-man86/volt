> DRAFT, written from Sim-Assist. Not started.

## 1. Runner paths

- [ ] 1.1 Globals carry their GVL in the IR; `Runner.get/set` resolve `<GVL>.<name>`
- [ ] 1.2 Bare names only for a unique global of a non-`qualified_only` GVL

## 2. Test

- [ ] 2.1 The repro of proposal.md: `get("GVL_A.count")` is 1, `get("GVL_B.count")` is 2, `get("count")` refused
- [ ] 2.2 `set("GVL_B.count", 5n)` changes only `GVL_B.count`

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle and drops the same-name refusal in `mapGlobals`
