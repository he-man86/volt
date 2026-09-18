# Tasks

## Phase 0 — the machinery

- [ ] `scripts/fixture-census.ts` — reads `ALL_TESTS` + the topic definitions and prints `topic / subtopic / case`
      with each cell's status (answered / skipped-with-reason / EMPTY).
- [ ] `test/conformance/census.test.ts` — every defined cell is closed. Red until it is.
- [ ] Place the existing 1,002 fixtures into the tree. Fixtures that fit no cell are LISTED, not deleted: either
      the tree is missing a topic, or the fixture is asking something nobody wrote down.

## Phase 1 — conversions (20 × 20, plus the rounding family)

- [ ] Define the cells. Axes: source type × destination type × value class (in range, at the boundary, out of
      range, negative, NaN / infinity for the reals).
- [ ] Generate, record, and READ THE ANSWERS before implementing anything.
- [ ] `real_to_dint_below_range` and `real_to_dint_runtime_below` are cells in this topic and close with it.

## Phase 2 — operators

**`operations.md` is the checklist** — every operation there is, with what each has been asked.

- [x] Unary `-` and `NOT` — `operators/unary-operand.ts`, 35 probes, 2 product bugs.
- [x] Every primitive's default — `types/primitive-default.ts`, 29.
- [x] Every numeric primitive's edges — `types/primitive-bounds.ts`, 64.
- [x] Every integer type over its edge at run time, and `/`, `MOD`, `MIN / -1` — `operators/arithmetic-edges.ts`, 64.
- [x] The mixed-type meet for `+` and `/` — `operators/mixed-type.ts`, 70 pairs.
- [x] REAL overflow and the ten math functions' domain edges — `operators/real-overflow.ts`, `math-domain.ts`.
- [ ] The same 35 pairs for `-`, `*` and `MOD`.
- [ ] Comparison: `= <> < > <= >=` per type, across signedness and width, on a REAL and on a NaN.
- [ ] Bitwise: `AND OR XOR` per type; `SHL SHR ROL ROR`, including a shift at or past the width.
- [ ] Binary: operator × left type × right type. The same wrong-destination trick names the result type.
      `commonType` in `arith.ts` is the model under test.
- [ ] Comparison across mixed signedness and width — `same_width_mixed_sign_order` exists; its neighbours do not.

## Phase 3 — declarations and initialization

- [ ] `VarSectionKind` × type category × initializer form (none, literal, expression, type-level default).
- [ ] Every type's DEFAULT with no initializer. The enum rule (zero enumerator, else the first) was measured; the
      other nineteen types were measured only where a fixture happened to exist.

## Phase 4 — call shapes

- [ ] Callee kind × argument form. The `not-lowered` blockers live here: `call-inout-alias`, `expr-call`,
      `interface-any-input`, `call-inout-order`, `call-open-array`, `call-program-method`.

## Phase 5 — the rest

- [ ] Statements, literals, pragmas, addressing, strings — ordered by what the census says is emptiest.

## Standing rules for every phase

- **Record before implementing.** An implementation written first decides what the fixture asks.
- **One cell per fixture.**
- The recorded message goes in the fixture (`refused`); the whole table goes in the file header.
- A cell that cannot be asked says so in `execSkip`, in its own words.
- `unasked: 0` does not move.
