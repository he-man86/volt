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

- **Order.** `frontend-conformance` (syntax/symbols/types) runs first and is archived before this change starts; the rest of the
  LSP review (analysis, services, server) comes after. This change takes the front-end as frontend-conformance leaves it and adds
  only the shared facts the transpiler needs that it did not provide (design.md §6).
- **Structure first (phase 1), output-neutral.** `src/transpile/` gets the target tree of design.md §2: a new `semantics/` layer
  (the value model the interpreter runs and the Rust runtime mirrors, held together by shared case tables and a twin test),
  `ir/` reduced to the node contract plus one exhaustive walker, `lower/` split into concern folders (entry, project, diagnostics,
  core, values, storage, init, places, pointers, expressions, builtins, statements, calls, interfaces), `interp/` split into
  machine/frame/calls/runner, `emit/rust/` split into printers plus a `runtime/` registry replacing `prelude.ts`, and a
  `pipeline/` composition root. Every rule with several copies gets one home (design.md P1). Giant functions are split in place
  before they move. Every step is proven by a corpus snapshot (IR, Rust, source map, both backends' outputs, edge verdicts) and
  by test-title equality; the layering lint gains the transpile-internal rules, a size ratchet and a stale-citation check.
- **Design first, per model.** Each model gets its decision section in `design.md` BEFORE any code, after a measurement task:
  the target representation, how both backends (interpreter and Rust) implement it identically, what CODESYS does (recorded
  fixtures cited), the options considered and why one wins, and the migration of existing emitted Rust. The pointer model
  starts from `transpile-st-to-rust/pointer-model.md`'s census and weighs extended tags, a flat byte arena per program, and a
  per-pointer enum of targets against the recorded pointer fixtures, not taste.
- **Then implement each model**, test-first against its root causes' fixtures, which are known divergences today
  and must turn into passes (the suite enforces removing the marks).
- **Then the remaining root causes** (one task each, in the new structure; closed ones verified in their new home), the
  unverified appendix items (recorded first), and the removal of every parameter a neutral consolidation kept.
- **Then the lean groups**, in dependency order, each as "same program output, less Rust": the corpus-output snapshot and the
  `edge` differential must be byte-identical before and after; the map's `size`, `pedantic` and lint counts must move in the
  promised direction; the ALLOWED lint list shrinks accordingly. Every review note is tagged with the task that resolves it.
- **Every step reports its delta in the map:** fixtures changed, `edge` verdicts, median `size`, `pedantic` total,
  notes resolved (a resolved note is deleted from the authored table; the gate enforces no orphans).
- **Hand-offs are filed, not dropped:** LSP-only gaps found here go to a new change `lsp-transpile-review-gaps`;
  transpile-st-to-rust's overlapping open tasks are marked superseded.

## Non-goals

- No change to what CODESYS behaviour Volt claims: the recordings stay the oracle.
- No new transpiler features (unsupported constructs stay refused); the 315 fixtures that do not lower are out of
  scope unless a model change makes one lower for free.
- The front-end's structure and conformance (syntax/symbols/types) belong to `frontend-conformance`; this change touches
  the front-end only for the shared facts design.md §6 lists, with the LSP gates. Analysis, services and server are out of
  scope (the rest of the LSP review); LSP-only gaps found here are handed to `lsp-transpile-review-gaps`.

## Impact

- `packages/volt-lsp-iec/src/transpile/**` (every file moves: design.md §4 maps each symbol), the shared front-end facts of
  design.md §6, `test/conformance/**` support (split), `scripts/` (snapshot, size, citation tools).
- Nearly every fixture's emitted Rust changes; `map.generated.ts` regenerates at every step.
- Docs: `packages/volt-lsp-iec/docs/architecture.md` and `data-model.md` describe the new models.
- Supersedes `transpile-lean-candidates` (its groups are tasks here); archive that change unapplied when this lands.
