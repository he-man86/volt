## Why

The overnight review (`transpile-review-2026-09-29`, 48 root causes) and the lean survey (`transpile-lean-candidates`,
10 groups) point at the same thing: most remaining defects and most of the bloat come from a few **models** the
transpiler holds, not from individual lines. Fixing symptoms one at a time keeps paying for the model; changing the
model removes whole classes. The owner's call (2026-09-29): do the restructure now, fully, while the transpiler is
freshly measured and the safety net is in place:

- every root cause is pinned by a CODESYS-recorded fixture;
- known divergences run as expected failures and fail the suite when fixed (`transpile-fix-all`, Guard);
- `map.generated.ts` records per fixture: `shape`, `edge` (interpreter vs Rust on edge inputs), `pedantic`, `size`,
  and the review notes.

The four models and what hangs on them:

| Model | Today | Root causes | Lean groups it unlocks |
|---|---|---|---|
| **Loop execution** | every loop panics after 1,000,000 passes; the backends count differently | 27, 35, 36 | 5 (10-line FOR headers, `manual_assert` 1,474) |
| **String storage** | a STRING(n) keeps only its first `len` bytes; bytes past the terminator are lost; conversions cut at 80 | 11, 34, 45 | 4 (≈570 double copies, O(n·N) cursor reads, string fixtures up to 38× their ST) |
| **Pointers and references** | a pointer is a TAG re-resolved per reading instance, not an address | 14, 15, 16, 17, 44 (+ parts of 18, 20) | 6 (temporaries as persistent pub fields) |
| **Instance initialization** | field initializers run after FB_Init; VAR_TEMP resets ignore initializers; element defaults ignored | 22, 23, 24, 25, 30 | 7, 8 (routine signatures, derives, aggregate syntax) |

Plus the model-independent lean groups: 1 (prelude on demand, ≈20k lints), 2 (constants folded in one place),
3 (one emission per construct, ≈14k cast lints), 9 (prelude helpers), 10 (transpiler source cleanup, ≈100 LOC).

## What Changes

- **Design first, per model.** Each model gets a short design section in this change (`design.md`) BEFORE any code:
  the target representation, how both backends (interpreter and Rust) implement it identically, what CODESYS does
  (recorded fixtures cited), the options considered and why one wins, and the migration of existing emitted Rust.
  The pointer model has the widest option space (extended tags, a flat byte arena per program, Rust references with
  an address table) and must decide against the recorded pointer fixtures, not taste.
- **Then implement each model**, test-first against its root causes' fixtures, which are known divergences today
  and must turn into passes (the suite enforces removing the marks).
- **Then the lean groups**, in dependency order, each as "same program output, less Rust": the whole corpus's
  recorded values and the `edge` differential must be byte-identical before and after; the map's `size`,
  `pedantic` and lint counts must move in the promised direction; the ALLOWED lint list shrinks accordingly.
- **Every step reports its delta in the map:** fixtures changed, `edge` verdicts, median `size`, `pedantic` total,
  notes resolved (a resolved note is deleted from the authored table; the gate enforces no orphans).

## Non-goals

- No change to what CODESYS behaviour Volt claims: the recordings stay the oracle.
- No new transpiler features (unsupported constructs stay refused); the 315 fixtures that do not lower are out of
  scope unless a model change makes one lower for free.
- Syntax/symbols/analysis are out of scope (the LSP review plan covers them).

## Impact

- `packages/volt-lsp-iec/src/transpile/**` (lower, ir, emit/rust incl. the prelude, interp), `src/types/**` where a
  model needs a type fact.
- Nearly every fixture's emitted Rust changes; `map.generated.ts` regenerates at every step.
- Docs: `packages/volt-lsp-iec/docs/architecture.md` and `data-model.md` describe the new models.
- Supersedes `transpile-lean-candidates` (its groups are tasks here); archive that change unapplied when this lands.
