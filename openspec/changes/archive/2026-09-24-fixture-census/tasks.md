# Tasks

## Phase 0 — the machinery

- [x] The topic tree — `test/conformance/support/census.ts`. Cells derived from the LANGUAGE (the elementary-type
      table, the operator table, the vendor's reference), never from the fixtures, so a question nobody thought of
      still has a node.
- [x] `test/conformance/census.test.ts` — every defined cell has a fixture AND an answer, plus the report and a
      ratchet on the cell count. **1307 cells** closed across types / operators / conversions / declarations /
      strings / calls / semantics.
- [x] `PLANNED` listed the topics with NO cells defined at all, so an unmeasured topic was printed rather than
      silently absent. **It is now EMPTY** — every topic has cells. A topic in neither list is the failure the
      whole file exists to prevent, and the gate still enforces that.
- [x] Place the existing fixtures into the tree. 1307 cells closed across 7 topics, and **`PLANNED` is empty** —
      no topic is left with no cells defined at all. Fixtures that fit no cell are LISTED, not deleted.

## Phase 1 — conversions (20 × 20, plus the rounding family)

- [x] Define the cells. `conversions/real-to-integer.ts` (192), `real-to-integer-ladder.ts`,
      `integer-to-integer.ts` (176), `integer-to-real.ts` (80), `cross-family.ts` (76), `to-string-format.ts` (106).
- [x] Generate, record, and READ THE ANSWERS before implementing anything — which is how the destination-register
      rule was found rather than fitted.
- [x] `real_to_dint_below_range` and `real_to_dint_runtime_below` closed with it: the conversion happens at the
      DESTINATION'S register width, so a DINT gets the 32-bit indefinite and a LINT the 64-bit one.
- [x] `LREAL_TO_STRING` is exact in both backends. **`REAL_TO_STRING` is refused on purpose** — 70 cells and no
      rule: two exponential cells print eight significant digits beside four printing seven at the same
      magnitudes, and four fractions round their seventh digit where rounding the value does not.

## Phase 2 — operators

**`operations.md` is the checklist** — every operation there is, with what each has been asked.

- [x] Unary `-` and `NOT` — `operators/unary-operand.ts`, 35 probes, 2 product bugs.
- [x] Every primitive's default — `types/primitive-default.ts`, 29.
- [x] Every numeric primitive's edges — `types/primitive-bounds.ts`, 64.
- [x] Every integer type over its edge at run time, and `/`, `MOD`, `MIN / -1` — `operators/arithmetic-edges.ts`, 64.
- [x] The mixed-type meet for `+` and `/` — `operators/mixed-type.ts`, 70 pairs.
- [x] REAL overflow and the ten math functions' domain edges — `operators/real-overflow.ts`, `math-domain.ts`.
- [x] The same pairs for `-`, `*` and `MOD` — all five arithmetic operators, 175 cells. The meet does not depend
      on the operator, and that is now a measurement rather than a conclusion drawn from two of five.
- [x] Comparison: `= <> < > <= >=` per type, across signedness and width, on a REAL and on a NaN —
      `operators/comparison.ts`.
- [x] Bitwise: `AND OR XOR` per type; `SHL SHR ROL ROR`, including a shift at or past the width —
      `operators/bitwise.ts`. A shift past 32 bits is MASKED.
- [x] Binary: operator × left type × right type, by the wrong-destination trick. `commonType` in `arith.ts` was
      the model under test and it was wrong twice — `BYTE + BYTE` is USINT, and two STRINGs meet at the WIDER
      capacity rather than at the left one.
- [x] Comparison across mixed signedness and width — the neighbours `same_width_mixed_sign_order` lacked.
- [x] The selection functions (`MIN MAX LIMIT SEL MUX`), 49 cells — **MIN and MAX inferred `unknown`**.
- [x] The `__` atomic operators, 15 cells — every one-sample reading was wrong.
- [x] **CLOSED — the four items below ARE the census's output, not unfinished census work.** The goal was
      "group the questions by what they ask, and find the ones nobody asked": the topic tree is derived from the
      language in `test/conformance/support/census.ts`, `PLANNED` is empty, the gate runs in `suite.test.ts`,
      and the fixtures sit under topic directories instead of arrival batches. What follows is the gap list that
      produced — each one a question to ask in its own change, kept here as the record of what the census found.

- [ ] `EXPT` and the ten math functions across both widths at their own edges. `math-domain.ts` covers the domain
      edges; the width cross-product is not asked.

## Phase 3 — declarations and initialization

- [x] Every type's DEFAULT with no initializer — `types/primitive-default.ts`, 29 cells. The simulator is a
      64-bit target, and an alias displays under its canonical name.
- [x] What each VAR section does over three scans — `declarations/section-semantics.ts`, 22 cells. **A composite
      VAR_TEMP starts over too**, which retired the `var-temp-composite` refusal.
- [x] A variable AT a direct address, and two names on one storage — `declarations/addresses.ts`. The aliasing
      half is `not-lowered` on purpose: the model is measured at the refusal in `lower/storage.ts` and waits on a
      byte-addressable IR storage kind.
- [ ] `VarSectionKind` × type category × initializer FORM (none, literal, expression, type-level default). The
      sections and the types are each swept; the cross-product with the initializer form is not.
      - The initializer FORM itself was asked on its own (2026-09-21, four cells, both vendors) and it moved four
        checks: **an initializer is not a constant-only place** — a sibling VARIABLE initializes one — an unknown
        name there is an ordinary undefined identifier, and a `__` name the compiler does not know is a PARSE
        refusal. Every one of those was silent because the checks walked BODIES and stopped at the `:=`.

## Phase 4 — call shapes

- [x] Callee kind × argument form — `calls/call-grid.ts`, 16 cells across an FB, a FUNCTION, a METHOD and a
      PROPERTY, plus when an argument is evaluated and when an in-out is bound.
- [ ] The `not-lowered` blockers still live here, one fixture each: `call-inout-alias`, `expr-call`,
      `interface-any-input`, `for-bound-call`. Each is a shape the grid reaches and lowering refuses.

## Phase 5 — the rest

- [x] Strings — `strings/string-edges.ts` (47), `escapes.ts` (71), `ordering.ts` (8). **DELETE at position 0
      removes a character**; `$hh` is a Windows-1252 byte; two strings order unsigned, byte by byte.
      - `escapes.ts` was 42 and the WIDE half of it was four cells, which recorded a REFUSAL without its rule:
        "a WSTRING takes no `$` escape" and "a WSTRING escape is four digits" both fit `"$41"`, `"$FF"` and
        `"$C3$A9"` exactly and disagree about every valid string. Thirteen more separate them (2026-09-21, both
        vendors) — **the form is four hex digits**, `$00041` is four and then a `1`, the named escapes and both
        `WSTRING(n)` forms compile.
- [x] Statements at their edges — `semantics/statement-edges.ts`.
- [x] PRAGMAS, half of the thinnest pair — `{attribute '<name>'}` asked over the whole `Tc*` family
      (20 cells, 2026-09-21). **The catalog was one flat set**, so `{attribute 'TcRetain'}` was "known" to both
      vendors and the LSP said nothing where CODESYS says "The attribute TcRetain is unknown and will be ignored
      by the  compiler." It is dialect data like every other vocabulary table. One cell answers differently for a
      reason that is not the name: the attribute pass does not run on a GVL file, as it already did not on a DUT.
- [ ] LITERALS — the other half, and still the thinnest topic. A typed literal of each type into each target, the
      radix forms, and the `<prefix>#` shapes each vendor does and does not have.

## Standing rules for every phase

- **Record before implementing.** An implementation written first decides what the fixture asks.
- **One cell per fixture.**
- The recorded message goes in the fixture (`refused`); the whole table goes in the file header.
- A cell that cannot be asked says so in `execSkip`, in its own words.
- `unasked: 0` does not move.
