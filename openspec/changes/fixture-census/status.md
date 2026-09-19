# Status — 2026-09-19

## Where it stands

```
2237 fixtures        confirmed 1681 (75.1%)   refused 448 (20.0%)
                     not-lowered 47           lsp-gap 30    diverges 4    unaskable 27
                     unasked 0

the vendor has ANSWERED 2180 of 2237 (97.5%)
of the 1685 we both EXECUTE, we match 1681 — 99.8%

census: 1213 cells closed across types / operators / conversions / declarations / strings
        4 topics still have no cells defined at all
```

The suite was 967 fixtures when this change was written. It is 2237 now, and every one has been put to a real
CODESYS — `unasked: 0` has held since the day it was reached.

## The sweeps, and what each found

| sweep | cells | found |
|---|---|---|
| primitive defaults | 29 | the simulator is a 64-bit target; an alias displays under its canonical name |
| primitive bounds | 64 | an unsigned type accepts `-1`; a signed one refuses its own minimum minus one |
| unary operators | 35 | **minus widens an 8-bit operand; NOT was implemented for signed integers only** |
| arithmetic edges | 64 | **integer division is not wrapping — `MIN / -1` STOPS at 32 and 64 bits** |
| the meet lattice | 175 | **`BYTE + BYTE` is USINT; every mixed expression inferred `unknown`, silencing every check** |
| real overflow + math domain | 28 | **the fault model was wrong — it is dividing by zero and the logarithm of zero** |
| comparison + bitwise | 175 | cross-signedness comparison is width-dependent; a shift past 32 bits is masked |
| REAL → integer | 192 | **the conversion happens at the DESTINATION's register width — the two oldest divergences** |
| integer → integer | 176 | a pure two's-complement reinterpretation; no saturation anywhere |
| integer → REAL, rounding | 80 | half away from zero, confirmed on eight halves instead of one |
| selection functions | 49 | **MIN and MAX inferred `unknown`**; MUX clamps past its last input |
| string edges | 47 | **DELETE at position 0 removes a character** |
| cross-family conversions | 76 | **28 date conversions were refused as "not measured"; now one tick rule** |
| to-string formats | 36 | LTIME implemented; REAL's format measured and deliberately NOT reproduced |
| section semantics | 22 | **a composite VAR_TEMP starts over too** — `var-temp-composite` retired |
| platform integers | 18 | **`__XINT` / `__UXINT` / `__XWORD` were missing from the type system entirely** |

**Sixteen product bugs, in sweeps that mostly confirmed what we already did.** The ones in bold changed behaviour.

## What the census cost, twice

The replay gate timed out twice, and both times it was a real O(n²) in the harness rather than a budget:

1. it rebuilt a symbol table per fixture from every OTHER fixture's declarations — 2.1M file-binds per vendor;
2. after that was fixed, `linkExtends` still walked every child TWICE per fixture.

Both are gone and both agreement counts are unchanged to the fixture, which is what makes the fix safe to believe.
Separately, `build-conformance` and `warning-conformance` ran byte-identical analysis and each threw the other's
half away — 68s of a 523s suite.

## The four topics with no cells

- **calls / callee kind × argument form** — the biggest remaining `not-lowered` cluster lives here.
- **strings / STRING(n) truncation, escapes and non-ASCII** — where `string_high_byte_escape` still diverges.
- **declarations / RETAIN, PERSISTENT, CONSTANT and direct addresses** — the parts a scan cannot see.
- **statements / every statement kind at its edges.**

## What is left that is NOT a census topic

- **30 `lsp-gap`** — the vendor rejects a source and we do not. Sixteen are the reserved IL operators, still blocked
  on the parse-error cascade (`docs/reserved-il-operators.md`).
- **47 `not-lowered`** — 22 are the REAL-to-text format, refused on purpose with the table in `lower/builtins.ts`.
- **4 `diverges`** — two vendor ROUTINES, not two rules we have wrong: trig argument reduction for a huge angle,
  and STRING being UTF-8 bytes.
- **`batches/`** — six files named after the batch they arrived in. Should shrink to nothing.
- **D6, the METHOD/ACTION bodies** — still governs everything at ~0.10% of corpus bodies lowering.
