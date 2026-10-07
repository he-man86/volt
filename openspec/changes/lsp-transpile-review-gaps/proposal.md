## Why

The transpiler work (`transpile-review-2026-09-29`, then `transpile-restructure`) records CODESYS's answer for every construct it
touches. Some of those recordings show the LSP disagreeing with the compiler — a program CODESYS refuses that the LSP accepts in
silence, or one CODESYS builds and runs that the LSP reports an error on. Those are LSP findings, not transpiler ones:
`transpile-restructure`'s scope stops at `src/transpile/` and the front-end facts it shares (its design.md §6, "Out of scope:
`analysis/`, `services/`, `server/`, and any LSP-only diagnostic gap"). Fixing them there would mix the two reviews; dropping them
would lose a recorded disagreement. This change receives them, one task each, for "the rest of the LSP review" to consume.

## What Changes

- One task per LSP-only finding the transpiler work exposed, naming its fixtures, the recorded CODESYS answer and the mark that
  holds it today (`fixtures.test.ts` `MEASURED_SILENT` for a silent LSP, `support/divergences.ts` `KNOWN_DIVERGENCES.codesys` for a
  false positive).
- `transpile-restructure` appends a task here, in the same commit, whenever one of its steps finds another ("Filed", its tasks.md
  acceptance shorthands). Its task 8.4 checks every hand-off of its design.md §7.1 has a line here.
- Closing a task here removes its mark: the expected-failure guard fails the suite the day a marked fixture starts matching, so the
  mark and the fix land together.

## Non-goals

- Transpiler behaviour. A fixture listed here may also be refused or lowered by the transpiler; that half is `transpile-restructure`'s.
- New recordings for their own sake. Every task starts from a fixture already recorded; a task that needs a new shape records it
  with `bun run record:language` (`RECORD_ONLY=<fixture>`) before changing the LSP.

## Impact

- `packages/volt-lsp-iec/src/analysis/**` (the checks that make each refusal), and the marks in
  `packages/volt-lsp-iec/test/conformance/fixtures.test.ts` and `test/conformance/support/divergences.ts`.
- Ordered after `transpile-restructure`, as part of the rest of the LSP review.
