> DRAFT, written from Sim-Assist. Built together with `gvl-qualified-runner-paths` and `runner-unused-globals` (one root:
> a GVL global was not a first-class runner variable).

## 1. Lower

- [x] 1.1 Global slots for FB instances declared in `VAR_GLOBAL` (qualified and unqualified GVLs) — every list variable is declared up front with its whole layout (`places/globals.ts` `declareLists`)
- [x] 1.2 Calls and member reads through `GVL.inst` and, for a non-`qualified_only` GVL, `inst`: `GVL.inst(…)` is an instance call (`namesListMember`, the one test a place, a call statement and a method call ask), and the `call-global-instance` refusal of a body call, a METHOD and a PROPERTY on a GVL instance is gone. The Rust backend calls the instance moved out of `Globals` and back (`emit/rust` `movesOut`/`movedOut`, as a PROGRAM is moved out of `Programs`); lowering refuses by name (`call-global-reentrant`, not-modelled) the one case that cannot run that way — a run that could reach the variable it is moved out of: its touched set holds the slot, it calls through an interface, or the instance is reached through a runtime index (`calls/reentrancy.ts` `globalReentrant`). A GVL instance held by an interface and called through it stays `call-global-instance` (conformance `interface_holds_gvl_instance`, unchanged)

## 2. Test

- [x] 2.1 The repro of proposal.md lowers, runs, and `q` turns TRUE after 1 s on the injected clock — in the interpreter and in the emitted Rust (`pipeline/globals.test.ts`)
- [x] 2.2 The same through an unqualified GVL

## 3. Consumers

- [ ] 3.1 Sim-Assist regenerates its bundle (`npm run build:volt`)

## 4. Class sweep

- [x] 4.1 `pipeline/globals.test.ts`, both backends where it runs: an FB instance called qualified and bare, an unreferenced one read and written by member, one called from another FB's body, a METHOD and a PROPERTY (get and set) on GVL instances, Standard's TON in a GVL; the three `call-global-reentrant` refusals (own body, runtime index, interface call); `lower/entry/totality.test.ts`'s former `call-global-instance` pin rewritten to the new rule (a GVL instance call and METHOD lower; a body reaching its own GVL instance is refused)
