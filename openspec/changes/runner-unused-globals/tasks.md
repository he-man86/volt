> DRAFT, written from Sim-Assist. Not started.

## 1. Lowering

- [ ] 1.1 Collect every `VAR_GLOBAL` of the GVL library files into `pou.globals`, referenced or not

## 2. Test

- [ ] 2.1 The repro of proposal.md: `pou.globals` lists `gSpeed`, `get("gSpeed")` is 1.5
- [ ] 2.2 `set("gSpeed", 2.0)` then `get("gSpeed")` is 2.0; the program's scan is unchanged

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle, lists all GVL globals and drops its "not used by the program" note
