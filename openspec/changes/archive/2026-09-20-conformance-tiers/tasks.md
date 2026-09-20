# Tasks

- [x] The new gate: a POU that lowers clean has not silently dropped a declaration's initial value. **Built as a
      corpus check, measured, and rejected** — 386 findings on 3,051 POUs, all false: a slot at its default is
      indistinguishable from one initialized to its default, and the escape hatch needed a second evaluator.
      Replaced by a guard at the line that creates the silence (`init-dropped`, `lower/storage.ts`), which needs
      no corpus and covers every caller. See design.md "The new gate, concretely"; pinned in
      `src/transpile/lower/init-sequence.test.ts`.
- [x] Move the three one-off regressions out of `lowering-totality.test.ts` into `src/transpile/lower/`
      (date literal past JS `Date`'s range; pointer step over a zero-byte element; the temporal literals that
      prove that refusal did not widen).
- [x] `fixtures.test.ts` — one driver, one row per evidence rating, replacing `replay` + `refused` + `transpile` +
      `confidence`. Every comment moved with its assertion; both ratchets keep their recorded history. Three things
      the merge found, none visible to the four separate files: `lsp-gap` has TWO sources and only one is declared
      (the table's totality check caught the two measured ones); eleven `not-lowered` refusals read as unregistered
      because the check read `LOWER_CODES` instead of `lowerCodeKind`, which knows the templated families; and the
      rustc hang guard had grown into its constant (1857 cases in 179s against 180s) — it is proportional now.
- [x] `corpus.test.ts` — one walk, THREE questions (the LSP can read it, it invents nothing, lowering is total),
      replacing `corpus` + `build-conformance` + `warning-conformance` + `lowering-totality`. The parse was being
      done four times over, and five times within the first file alone. Two normalizers were comparing the same
      messages — measured across all five recorded projects, they agree exactly, so the stricter one survives.
- [x] Rename `backend-agreement` → `backends`, `memory-model.property` → `properties`, `census` +
      `construct-coverage` → `suite` (merged — one file, three authorities), `error-catalog` → `catalog`.
- [x] A `test/README.md` naming the four concerns and which file owns each — plus TESTING.md's tier detail,
      which listed three files that no longer exist and one (`coverage.test.ts`) that never did, and twice
      repeated the "a corpus project compiles clean" premise the build oracle exists to correct.
- [x] Verify no measured fact was lost. Done MECHANICALLY rather than by eye (`git show` each removed file,
      extract every date, multi-digit number and backticked identifier from its comments, check each against the
      surviving tree): **359 of 360 survive**, and the one that does not is a path spelling. Four were restored
      after the check found them — the 967→2332 fixture growth behind an explicit budget, the `FB_Lenze_i550.fb:23`
      measurement proving `documentDiagnostics` sees what `computeSemanticDiagnostics` structurally cannot, the
      `ir-coverage.test.ts` second walk that blew its own timeout, and the transpiler's input contract. The
      sentence-level diff over-reports (prose was deliberately reflowed and rewritten); the fact-level one is the
      check that means something.
- [x] One BEHAVIOUR disagreement the merge exposed, fixed toward the sound side: `build-conformance` gated errors
      AND warnings unconditionally, while `warning-conformance` withheld the warning half when the build failed
      before typify or hit CODESYS's 100-warning cap — in both cases a warning of ours absent from the recording
      may be a real one the build never reached. Errors are gated always; warnings only against a complete oracle.
      It changes nothing today (awa-palletizer is the only build-failed project and the LSP emits no warning on
      it) and stops a false failure the first time that is untrue. Truncation now reports instead of throwing: it
      caps WARNINGS, so throwing refused to check the error half that was still sound.
