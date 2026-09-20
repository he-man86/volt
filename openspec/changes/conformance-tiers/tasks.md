# Tasks

- [ ] The new gate: a POU that lowers clean has not silently dropped a declaration's initial value. Lands first,
      in `lowering-totality.test.ts`, so it protects the tree during the rewrite rather than after it.
- [ ] Move the three one-off regressions out of `lowering-totality.test.ts` into `src/transpile/lower/`
      (date literal past JS `Date`'s range; pointer step over a zero-byte element; the temporal literals that
      prove that refusal did not widen).
- [ ] `fixtures.test.ts` — one driver, one row per evidence rating, replacing `replay` + `refused` + `transpile` +
      `confidence`. Every comment moves with its assertion; the two ratchets (per-vendor agreement, per-rating
      ceilings) keep their recorded history.
- [ ] `corpus.test.ts` — one walk: no false positive, totality + reach, self-consistency.
- [ ] Rename `backend-agreement` → `backends`, `memory-model.property` → `properties`, `census` +
      `construct-coverage` → `suite`, `error-catalog` → `catalog`.
- [ ] A `test/README.md` naming the four concerns and which file owns each.
- [ ] Verify no measured fact was lost: a diff of the removed files' prose against the new ones.
