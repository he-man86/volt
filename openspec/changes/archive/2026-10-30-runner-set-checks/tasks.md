## 1. Decide

- [x] 1.1 Owner answers open points 1–2 (refuse vs wrap; long STRING) — BUILT AS THE DEFAULTS, both REFUSE (CODESYS's online write refuses), pending the owner's answer — owner 2026-10-30 left it to the recommendation: refuse (both points)

## 2. Build

- [x] 2.1 `RunnerValueError` (`path`, `type`, `reason`; exported from the transpile barrel) and ONE check, `interp/set-value.ts` `checkValue`, in `Runner.set` for every elementary type, structs and arrays: integers, bit strings, durations and dates a bigint within the type's range (a subrange's bounds; a duration or date the unsigned count of its unit in its width), BOOL and BIT a boolean, REAL a number a 32-bit float holds and LREAL a number — an infinity, or a NaN as its bits (`NaNBits` of the type's width; a JavaScript NaN states no bits and is refused), since a REAL holds both (the program makes them; the edge differential seeds them — the proposal's "finite" would have refused values the variable holds, an owner question), STRING/WSTRING a string within the capacity, a STRING's characters ASCII (past ASCII the byte is not measured — the lowering's `string-non-ascii` rule), a WSTRING's one UTF-16 unit each; a struct every field and nothing more, an array its length and every element, each named by its own path; an FB instance written whole, a POINTER, REFERENCE or INTERFACE refused by name
- [x] 2.2 Nothing written on a refusal (the check runs before any write, image-held variables included); `__clock` keeps its own rule — it is an LTIME, so a non-negative bigint below 2^64, the same check
- [x] 2.3 Tests: the five measured rows of proposal.md, each refused with the cell unchanged, plus every type's min and max accepted (`interp/set-value.test.ts`)

## 3. Consumers

- [x] 3.1 Sim-Assist regenerates its bundle (`npm run build:volt`) and may drop its own range check in `toVal` — handed to Sim-Assist 2026-10-30 (its task, not Volt's)

## 4. Class sweep

- [x] 4.1 `interp/set-value.test.ts`: every integer, bit-string, duration and date type (SINT…ULINT, BYTE…LWORD, TIME, LTIME, DATE, TOD, DT, LDATE, LTOD, LDT) at min and max written, min-1 and max+1 refused, a number refused; BOOL and BIT; REAL at ±max and the smallest subnormal, 3.5e38 refused, ±Infinity and a NaN's bits written, a JS NaN, a NaN of the other width and a bigint refused; LREAL the same with MAX_VALUE; STRING/WSTRING at and past capacity (a sizeless STRING's 80 included), past ASCII, a surrogate pair, a NUL (the value is the buffer: written, read back to the NUL); a subrange; a struct (each field, a missing and an extra field, a scalar); arrays (length, an element, two dimensions, an array of structs); an FB instance by its variables and refused whole; a GVL variable, the clock and a byte-image variable; a POINTER. `Runner.set` is the runner's only write path (no force, no initial-value API); the pipeline test that pinned wrap-on-set (`aggregates.test.ts`) now pins the refusal; the backends gate no longer swallows a refused seed (it would desync from the Rust's wrapped cast)
