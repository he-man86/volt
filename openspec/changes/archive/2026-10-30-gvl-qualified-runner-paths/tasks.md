> DRAFT, written from Sim-Assist. Built together with `gvl-fb-instance-call` and `runner-unused-globals` (one root: a
> GVL global was not a first-class runner variable).

## 1. Runner paths

- [x] 1.1 Globals carry their GVL in the IR (`IrSlot.list`, `IrSlot.qualifiedOnly`, set on every list variable); `Runner.get/set` resolve `<GVL>.<name>` through ONE rule, `ir/path.ts` `pathRoot`, which the Rust harness (`rustAccess`) reads too
- [x] 1.2 Bare names only for a global ONE list declares, in a list that is not `qualified_only`; a bare name two lists declare is refused as ambiguous by name (`count is ambiguous: GVL_A.count, GVL_B.count`), one a `qualified_only` list declares is refused naming its path — never resolved to the first or to the only plain one

## 2. Test

- [x] 2.1 The repro of proposal.md: `get("GVL_A.count")` is 1, `get("GVL_B.count")` is 2, `get("count")` refused (`src/transpile/pipeline/globals.test.ts`)
- [x] 2.2 `set("GVL_B.count", 5n)` changes only `GVL_B.count`

## 3. Consumers

- [x] 3.1 Sim-Assist regenerates its bundle and drops the same-name refusal in `mapGlobals` — handed to Sim-Assist 2026-10-30 (its task, not Volt's)

## 4. Class sweep

- [x] 4.1 `pipeline/globals.test.ts`, get AND set through each: every elementary type (BOOL, SINT…ULINT, BYTE…LWORD, REAL, LREAL, TIME, LTIME, DATE, TOD, DT, STRING(5), WSTRING(5)) in a plain and a `qualified_only` list, by path and (plain only) bare; a struct, an array, an array of structs by field and element; FB instances; VAR_GLOBAL CONSTANT / RETAIN / PERSISTENT; two plain lists with one name; a `qualified_only` and a plain list with one name (bare refused); a POU variable shadowing a global; a list variable named like its list (both paths); unknown paths refused by name; the emitter's field names for two lists' one name (`globalFieldNames`, now also what `rustAccess` reads — it read the unprefixed name before)
