> DRAFT, written from Sim-Assist. Built together with `gvl-qualified-runner-paths` and `gvl-fb-instance-call` (one root:
> a GVL global was not a first-class runner variable).

## 1. Lowering

- [x] 1.1 Collect every `VAR_GLOBAL` of the GVL files into `pou.globals`, referenced or not (`places/globals.ts` `declareLists`, before the body, in list and declaration order; a library's lists stay unmodelled). Each declaration is first lowered ALONE (its own shared state, answered once per prepared project): one that refuses there — or makes storage no backend holds (`entry/checks.ts` `storageRefusal`, now one function for this and the POU's own check) — is declared nowhere and listed in `IrPou.unlowered` with its refusal; the runner refuses its path by name; a body that reaches it is refused as before. An unreferenced instance whose init the init step does not walk (FB_Init, `instance-path`, a slot METHOD in a GVL) refuses the POU (`attr-init-unreached`): CODESYS runs that init before the first scan, and it was silently skipped before

## 2. Test

- [x] 2.1 The repro of proposal.md: `pou.globals` lists `gSpeed`, `get("GVL_V1.gSpeed")` is 1.5 (`pipeline/globals.test.ts`; the draft's bare `get("gSpeed")` is refused there: `GVL_V1` is `qualified_only`, `gvl-qualified-runner-paths`)
- [x] 2.2 `set("GVL_V1.gSpeed", 2.0)` then `get` is 2.0; the program's scan is unchanged

## 3. Consumers

- [x] 3.1 Sim-Assist regenerates its bundle, lists all GVL globals and drops its "not used by the program" note — handed to Sim-Assist 2026-10-30 (its task, not Volt's)

## 4. Class sweep

- [x] 4.1 `pipeline/globals.test.ts`: every elementary type unreferenced at its initial value, then set; struct / array / array of structs with initial values; unreferenced FB instances; CONSTANT, RETAIN, PERSISTENT sections (the runner has no restart, so RETAIN/PERSISTENT are plain storage within its life — pinned, and an owner question); an unreferenced declaration that does not lower (`string-non-ascii`) and one whose type does not resolve (`slot-unknown`) listed in `unlowered` and refused at the runner, the same one reached by the body refusing the POU; an unreferenced FB instance with an FB_Init refusing the POU. Emitted Rust holds every kind (`Globals` built and read in the Rust parity test)
- [x] 4.2 Corpus (`test/corpus/corpus-lowering.test.ts`): REACH 54 → 45 and ROUTINES 13 → 0, all pro2193 — 33 POUs whose lists hold `instance-path` FB instances, now `attr-init-unreached` (measured per POU, before/after)
