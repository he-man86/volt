# Tasks

- [x] The new gate: a POU that lowers clean has not silently dropped a declaration's initial value. **Built as a
      corpus check, measured, and rejected** — 386 findings on 3,051 POUs, all false: a slot at its default is
      indistinguishable from one initialized to its default, and the escape hatch needed a second evaluator.
      Replaced by a guard at the line that creates the silence (`init-dropped`, `lower/storage.ts`), which needs
      no corpus and covers every caller. See design.md "The new gate, concretely"; pinned in
      `src/transpile/lower/init-sequence.test.ts`.
- [ ] Move the three one-off regressions out of `lowering-totality.test.ts` into `src/transpile/lower/`
      (date literal past JS `Date`'s range; pointer step over a zero-byte element; the temporal literals that
      prove that refusal did not widen).
- [ ] `fixtures.test.ts` — one driver, one row per evidence rating, replacing `replay` + `refused` + `transpile` +
      `confidence`. Every comment moves with its assertion; the two ratchets (per-vendor agreement, per-rating
      ceilings) keep their recorded history.
- [ ] `corpus.test.ts` — one walk, two questions: no false positive, totality + reach.
- [ ] Rename `backend-agreement` → `backends`, `memory-model.property` → `properties`, `census` +
      `construct-coverage` → `suite`, `error-catalog` → `catalog`.
- [ ] A `test/README.md` naming the four concerns and which file owns each.
- [ ] Verify no measured fact was lost: a diff of the removed files' prose against the new ones.
