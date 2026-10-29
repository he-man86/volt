> DRAFT, written from Sim-Assist. Not started.

## 1. Lower

- [ ] 1.1 Global slots for FB instances declared in `VAR_GLOBAL` (qualified and unqualified GVLs)
- [ ] 1.2 Calls and member reads through `GVL.inst` and, for a non-`qualified_only` GVL, `inst`

## 2. Test

- [ ] 2.1 The repro of proposal.md lowers, runs, and `q` turns TRUE after 1 s on the injected clock
- [ ] 2.2 The same through an unqualified GVL

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle (`npm run build:volt`)
