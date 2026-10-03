# Tasks: transpile-restructure

Structure first, then the four models, then the open root causes, then lean. Paths are relative to `packages/volt-lsp-iec/`, and
file names are the NEW structure (design.md §2). Front-end paths (`types/…`, `symbols/…`, `syntax/…`) mean that concern's home in
the structure `frontend-conformance` built (design.md "Order", §6). "RC n" = transpile-review-2026-09-29 task n. "Lean g.i" =
transpile-lean-candidates item g.i. Hex ids are NOTES constructs in `map.generated.ts`.

**Prerequisite:** `openspec/changes/frontend-conformance` is archived (`.claude/workflows/execute-change.js` checks it).

**Format.** Every task is one `- [ ] <id> <what>` line, followed by `Where:` (files), `Accept:` (acceptance) and `Depends:` (task
ids) continuation lines, and `What:` where the line needs detail. A step writes its numbers under its task when it closes it.

**Acceptance shorthands** (design.md §8):
- **G:** `bun typecheck`, `bun run lint` (layering, size, citations) and `bun test` in the package are green; `bun run check` at the
  repo root is green.
- **G+LSP:** G, plus the LSP corpus gate (`bun run test:corpus`), the build-conformance oracle and `lsp-replay.test.ts` (or its
  predecessor in `fixtures.test.ts`) unchanged.
- **S:** `bun run snapshot:transpile check` is identical in all layers (canonical IR, emitted Rust + source map, interpreter outputs,
  Rust outputs, edge verdicts) against the 0.5 baseline.
- **S-out:** outputs and edge verdicts are identical; the Rust may change.
- **T:** `bun scripts/suite-snapshot.ts --compare <before>` is identical (every test title kept; design.md §8).
- **M:** `bun run rate:fixtures` regenerated. The delta is written under the task: fixtures whose Rust changed, `edge`, median `size`,
  `pedantic` total, lint totals, ALLOWED excused counts, and notes resolved (deleted from the authored table; the gate enforces no
  orphans).
- **F(x):** fixture x's divergence mark is removed and it passes. The expected-failure guard fails the suite until the mark is removed.
- **Filed:** a line appended to `openspec/changes/lsp-transpile-review-gaps/tasks.md` (0.7) in the same commit.

**Loop per step:** implement, one data-lens review, fix, commit. Commit type: `refactor(lsp)` for phase 1, `fix(lsp)` for phases
2-6, `perf(lsp)`/`refactor(lsp)` for phase 7, `docs(openspec)` for design sections. A second review round happens only on a high
finding. A task that turns out not to be output-neutral where it promised S is split: the neutral part lands, the rest is filed under
its RC or lean id in this file.

## 0. Baseline

- [ ] 0.0 Gate: `transpile-fix-all` has finished and its changes are committed; `frontend-conformance` is archived.
  - Where: the git tree; `openspec/changes/archive/`.
  - Accept: `git status` is clean under `packages/volt-lsp-iec/` (including `fixtures.test.ts` and `support/expected-failure.ts`);
    `openspec/changes/archive/<date>-frontend-conformance` exists; `bun test` is green.
  - Depends: none.
- [ ] 0.1 Reconcile root causes and re-read the code.
  - What: for every RC (1-48, incl. 2.3) and every Appendix A/B line, record open, closed-upstream (commit), or closed-by-frontend-
    conformance (its task 5.2 report). Known on 2026-09-29: RC 1-5, 7-10, 13 (transpiler half), 29 (3dd773b9d7) and 30 (e06405f97c)
    closed. A closed RC's task below becomes "verify in the new home" (its src test moves with its module; its fixture stays
    confirmed). Also re-run the top-level declaration inventory of `src/transpile/**` and the `describe` list of `lower.test.ts` and
    `emit.test.ts`; add every name or describe not in design.md §4/§5 to those tables (same commit).
  - Where: this file (a table under 0.1); design.md §4, §5.
  - Accept: every RC and appendix line has a status and a commit or "open"; design.md §4 lists every top-level declaration found.
  - Depends: 0.0.
- [ ] 0.2 Baseline numbers.
  - What: copy the map header (evidence counts, tier lowered/clean, surviving and allowed lints with excused counts, edge
    agree/disagree/not-run and each disagreement, the pedantic top ten and total, the size median and top ten, shapes and constructs,
    notes and improvable fixtures) and the open divergence marks per RC.
  - Where: this file, under 0.2.
  - Accept: the numbers match `map.generated.ts` at the 0.0 commit.
  - Depends: 0.0.
- [ ] 0.3 Snapshot tool (S).
  - What: `scripts/transpile-snapshot.ts` (`write [--baseline] | check [--layers ir,rust,outputs,edge]`) with
    `test/conformance/support/snapshot.ts`, as design.md §8 defines S. Rust outputs are built through `support/rustc.ts`'s batch path
    (the one `fixtures.test.ts` uses today). Files go to `test/conformance/.snapshot/`; `check` prints the first difference per fixture.
  - Where: `scripts/transpile-snapshot.ts`, `test/conformance/support/snapshot.ts`, `package.json` script `snapshot:transpile`,
    `.gitignore` (`test/conformance/.snapshot/`), `scripts/README.md`.
  - Accept: write then check on an unchanged tree reports identical; a deliberate one-character change to one emitted literal is
    reported with its fixture name; `git status` shows no `.snapshot` file; the run time is written here.
  - Depends: 0.0.
- [ ] 0.4 Test-move gate (T).
  - What: `scripts/suite-snapshot.ts` gains `--dirs` and a default set that includes `src/transpile`, `src/types`, `src/symbols`,
    `src/syntax` and `test/libraries` beside `test/conformance` and `test/exec`.
  - Where: `scripts/suite-snapshot.ts`, `scripts/README.md`.
  - Accept: write then `--compare` on an unchanged tree is identical; renaming one test title in a scratch copy is reported.
  - Depends: 0.0.
- [ ] 0.5 Baseline snapshots.
  - What: `snapshot:transpile write --baseline` and `suite-snapshot.ts <file>` at the 0.0 commit; both hashes recorded here.
  - Where: `test/conformance/.snapshot/baseline/` (untracked); this file.
  - Accept: `check` and `--compare` are identical.
  - Depends: 0.3, 0.4.
- [ ] 0.6 Tag every NOTE with its task.
  - What: the authored `NOTES` gain a `task` field: a task id of this file (`7.4.1`, `2.3`, `6.15`, …) or `keep:<reason>` for a note
    that says nothing needs to change. The generator refuses a note without a tag and a tag naming an id that is not in this file.
    Every note that fits no existing task gets a new task in phase 7 (same commit); the 520 notes no task cited on 2026-09-29 are
    placed this way. The exact `keep` count is written here (it replaces the estimated "13").
  - Where: `test/conformance/support/transpile-confidence.ts` (or `support/notes/notes.data.ts` after 1.8.3), `scripts/rate-fixtures.ts`;
    this file.
  - Accept: M (no row change); all 776 notes carry a valid tag; the map header prints a per-task note count; no task id in it is
    missing from this file.
  - Depends: 0.2.
- [ ] 0.7 Create the LSP hand-off change `lsp-transpile-review-gaps`.
  - What: `proposal.md` (why: LSP-only gaps found by the transpiler work, consumed by "the rest of the LSP review") and `tasks.md`
    with one task per row of design.md §7.1 (RC 13, 35, 37, 20, 38 halves), each naming its fixtures.
  - Where: `openspec/changes/lsp-transpile-review-gaps/`.
  - Accept: `npx --yes openspec validate lsp-transpile-review-gaps` passes; every "Filed" in this file names a line there.
  - Depends: 0.1.
- [ ] 0.8 Reconcile `transpile-st-to-rust`'s 39 open tasks.
  - What: per design.md §7.3, each open task is marked "superseded by transpile-restructure <id>" or "stays"; the pointer tasks point
    at 4.2; the VAR_OUTPUT copy-back task at 4.11.
  - Where: `openspec/changes/transpile-st-to-rust/tasks.md`; this file (the list).
  - Accept: every open task there carries a verdict; none is ticked without its superseding task being done.
  - Depends: 0.1.
- [ ] 0.9 What the front-end already provides.
  - What: for each of the 15 needs in design.md §6, record "met by frontend-conformance at <path>" or "unmet"; for each met one, the
    matching 1.1 task becomes a verification that the transpiler uses that home (and nothing else). If frontend-conformance moved the
    folders (e.g. under `frontend/`), rewrite the front-end paths of design.md §2.7 and of this file in the same commit.
  - Where: this file (a table under 0.9); design.md §2.7, §6.
  - Accept: every need has a verdict and a path; design.md names only existing front-end paths or planned ones.
  - Depends: 0.1.

## 1. Structure (output-neutral: every step G + S unless it says otherwise)

Every step moves or splits code without changing behaviour. Where a consolidation would change behaviour, the old behaviour is kept
behind a named parameter, listed under the task, and its removal is the task named in design.md P6.

### 1.0 Tooling

- [ ] 1.0.1 Amend layering rule 4 and add rules 4b and 6.
  - What: design.md P2. Among transpile folders: `ir/` imports only itself; `semantics/` imports `ir/`; `lower/` imports `ir/` and
    `semantics/`; `interp/` imports `ir/` and `semantics/`; `emit/` imports `ir/`; `pipeline/` and `index.ts` are composition roots.
    Frontend imports stay governed by rule 3 (syntax, symbols, types only; `semantics/` and `interp/`/`emit/` may import `types`,
    `semantics/` also `syntax`). Rule 4b: the `lower/` leaves (`diagnostics`, `core`, `values`, `project`) import only what P2 allows.
    Rule 6: a file under `src/` (test files included) may not import `test/`.
  - Where: `scripts/check-layering.ts`, a fixture test of the lint beside it.
  - Accept: lint green on today's tree except the known `emit.test.ts → test/…/rustc.ts` edge, listed as a temporary exception that
    1.5.13 removes; the fixture test shows each new rule catching a planted violation.
  - Depends: 0.5.
- [ ] 1.0.2 Size ratchet.
  - What: design.md §8. The 12 oversize files of 2026-09-29 (`lower/calls.ts`, `emit/rust/emit.ts`, `lower/lower.ts`,
    `lower/storage.ts`, `ir/ir.ts`, `lower/pointers.ts`, `lower/interfaces.ts`, `ir/values.ts`, `lower/builtins.ts`; tests
    `lower/lower.test.ts`, `interp/interp.test.ts`, `emit/rust/emit.test.ts`) are ceilings at their current line counts; functions over
    80 lines are printed as a warning list.
  - Where: `scripts/check-size.ts`, `package.json` `lint`.
  - Accept: green with 12 entries; a new 401-line file fails; the function list is printed.
  - Depends: 1.0.1.
- [ ] 1.0.3 Citation check.
  - What: design.md §8: report `file.ts:NNN` / `file.ts` citations in `src/**` comments, fixture comments, the authored NOTES and
    LEAN texts, `docs/*.md` and open openspec changes' `tasks.md` whose file does not exist. Warning-only until 1.9.3.
  - Where: `scripts/check-citations.ts`, `package.json` `lint`, `scripts/README.md`.
  - Accept: runs in lint; prints today's count (expected ≈ 0 missing today, since no file has moved yet).
  - Depends: 1.0.1.
- [ ] 1.0.4 Dead-export scope and exclusion.
  - What: `scripts/dead-exports.ts` gains `--scope <dir>` and excludes the IR union members and the §2.1.1 barrel names (design.md §8).
  - Where: `scripts/dead-exports.ts`.
  - Accept: `--scope src/transpile` prints the filtered NOBODY list; the list is written here as the starting point for 1.7.20.
  - Depends: 1.0.1.

### 1.1 Front-end facts the transpiler shares (built only where 0.9 says "unmet"; else verified)

Each task below: if 0.9 found the home already built, the task is "the transpiler uses that home and no copy of its own", accepted
by G+LSP and S. Otherwise it builds the home in the front-end structure, accepted as written.

- [ ] 1.1.1 `sameName` in the identifier module.
  - What: move it from `interp.ts:289-292`; `types/compat.ts:107` uses it.
  - Where: `syntax/identifier.ts`, `interp/interp.ts`, `types/compat.ts`.
  - Accept: G+LSP, S.
  - Depends: 1.0.1, 0.9.
- [ ] 1.1.2 `extendsChain(scope)` for FBs and interfaces.
  - What: base first, cycle guarded, reports incomplete; one function for FB and interface EXTENDS. Re-export `precedence.ts` from
    the symbols barrel; `types/resolve.ts` imports it through the barrel.
  - Where: `symbols/scope-nav.ts`, `symbols/index.ts`, `symbols/scope-nav.test.ts`.
  - Accept: G+LSP; unit tests for a cycle, an unresolved base and an interface chain.
  - Depends: 1.0.1, 0.9.
- [ ] 1.1.3 `peelArray` and `elementOf` into `types/arrays.ts`.
  - What: from `ir/ir.ts:66-81`; every caller updated (interp, emit, about 20 in lower).
  - Where: `types/arrays.ts`, `ir/ir.ts`, callers.
  - Accept: G, S.
  - Depends: 1.0.1, 0.9.
- [ ] 1.1.4 `typeZero` in `types/defaults.ts`.
  - What: `defaultValueOf` from `ir/ir.ts:49-58`, same behaviour, renamed.
  - Where: `types/defaults.ts`, `ir/ir.ts`, callers.
  - Accept: G, S.
  - Depends: 1.1.3.
- [ ] 1.1.5 Type predicates.
  - What: `isBit`, `isBoolValued` (= isBit || BOOL), `isIntegral`, `holdsIntegerBits`, `stringKind`, `isReal`/`floatBits`,
    `hasTextFormat` (= today's `isTemporal` text part, same answer). Only call sites whose result is identical switch: `lower/convert.ts`
    16-19, 76, 95; `builtins.ts:276`; `values.ts` `fit`; `emit.ts:52` `rustType`. Every site that does not switch is listed here with
    why (it is 6.B.1's input); the emitter's conversion dispatch (`emit.ts:666-667`) is RC 31 (6.9).
  - Where: `types/predicates.ts`, `types/predicates.test.ts`, the listed sites.
  - Accept: G+LSP, S; predicate unit tests; the not-switched list is written here.
  - Depends: 1.1.4.
- [ ] 1.1.6 Widths in `types/width.ts`.
  - What: `integerOfWidth` (from `arith.ts:84-87`), `widthOf` (from `ir/evaluate.ts:23`), `wrapToWidth(value, elem)` as the core of
    `heldAs`, `stored` and `fit`. Each caller keeps its own family guard; the guards are listed here (6.B.2's input). The three
    `infer.ts` ladder spellings (95, 426, 471) use `integerOfWidth`.
  - Where: `types/width.ts`, `types/width.test.ts`, `types/const-eval.ts`, `lower/convert.ts`, `ir/values.ts`, `ir/evaluate.ts`, `types/infer.ts`.
  - Accept: G+LSP, S; the guard list is written here.
  - Depends: 1.1.5.
- [ ] 1.1.7 Literal typing in `types/literal.ts`.
  - What: `literalType`, `literalCheckType`, `literalErrorType` (infer.ts 323-374, the duplicated negated-literal unwrap merged),
    `integerLiteralType` (elementary.ts 245), `contextLiteralType` (lower `constants.ts:316-329`, rule unchanged).
    `literal-check.test.ts` becomes `literal.test.ts`.
  - Where: `types/literal.ts`, `types/literal.test.ts`, `types/infer.ts`, `types/elementary.ts`, `lower/constants.ts`.
  - Accept: G+LSP, S, T.
  - Depends: 1.1.6.
- [ ] 1.1.8 Split `types/arith.ts` into `arith/runtime.ts`, `arith/checked.ts`, `arith/temporal.ts`.
  - What: also move the NOT and bitwise result rules (infer.ts 87-96, 420-429), the typed-literal sum (465-474) and `exptResultType`
    into `checked.ts`. `arith.test.ts` becomes `arith/runtime.test.ts`; `checked.test.ts` and `temporal.test.ts` gain the missing
    cases (`promoteForRuntime`, `checkedNegationType`, `temporalResultType`, `exptResultType`).
  - Where: `types/arith/*`, `types/infer.ts`.
  - Accept: G+LSP, S, T (plus the new cases).
  - Depends: 1.1.7.
- [ ] 1.1.9 Split `types/const-eval.ts` into `const/constancy.ts` and `const/fold.ts`.
  - What: no merge yet; `heldAs` sits on `width.wrapToWidth`. `const-eval.test.ts` plus `types.test.ts:103-148` become
    `const/fold.test.ts`, keeping every case (the `**` case at 113 stays until 6.A.20).
  - Where: `types/const/*`.
  - Accept: G+LSP, S, T.
  - Depends: 1.1.8.
- [ ] 1.1.10 `parseConversionName` into `types/conversion-name.ts`.
  - What: from `elementary.ts:260`; `conversion-name.test.ts` follows it.
  - Where: `types/conversion-name.ts`, `types/elementary.ts`.
  - Accept: G+LSP, T.
  - Depends: 1.1.9.
- [ ] 1.1.11 Dissolve `types/types.test.ts`.
  - What: into `resolve.test.ts`, `compat.test.ts` and `elementary.test.ts` (its 103-148 already went in 1.1.9).
  - Where: `types/*.test.ts`.
  - Accept: G, T.
  - Depends: 1.1.10.
- [ ] 1.1.12 `calendarNanoseconds` into the literal valuation module.
  - What: from lower `constants.ts:294-313`. `inTicks` stays in lowering (it reads `types/` `tickNs`) and moves to
    `values/literals.ts` in 1.6.10.
  - Where: `syntax/literal-value.ts`, `lower/constants.ts`.
  - Accept: G+LSP, S.
  - Depends: 1.0.1, 0.9.
- [ ] 1.1.13 Split `types/infer.ts` into `infer/expr.ts`, `infer/member.ts`, `infer/callee.ts`.
  - What: mandatory (no other plan claims it). `fbChainSections` goes on `extendsChain`; the orphan doc at infer.ts:258 (lean 10.4) is
    deleted; `resolveCallee` exported for lowering's parameter view (6.B.4).
  - Where: `types/infer/*`.
  - Accept: G+LSP, S.
  - Depends: 1.1.2, 1.1.8.
- [ ] 1.1.14 The types barrel exports every new module.
  - What: `types/index.ts` re-exports predicates, width, arrays, defaults, literal, conversion-name, arith, const, infer (and enums
    after 1.7.14); every consumer imports from the barrel, never a deep path (architecture.md mechanism 2).
  - Where: `types/index.ts`, consumers.
  - Accept: G+LSP; a grep finds no deep `types/<module>` import outside `types/`.
  - Depends: 1.1.13.

### 1.2 `ir/`

- [ ] 1.2.1 Split `ir/ir.ts` into `ir/expr.ts`, `ir/stmt.ts` and `ir/program.ts`.
  - What: a pure move. `holdsCall` moves verbatim into a new `ir/walk.ts` (rebuilt in 1.2.3); `IrValue` into `program.ts`. Move the
    misplaced `import type { Type }` (line 41) to the top, delete the orphan doc at 252-254, and drop the abandoned sentence at 320-322.
  - Where: `transpile/ir/*`.
  - Accept: G, S.
  - Depends: 1.1.5.
- [ ] 1.2.2 Codes and lowering results leave `ir/`.
  - What: `ir/codes.ts` and `ir.ts` 548-575 move to `lower/diagnostics/codes.ts` and `diagnostic.ts`, `codes.test.ts` beside them. The
    transpile barrel exports `LOWER_CODES`, `LOWER_CODE_PREFIXES`, `lowerCodeKind`. The deep-path consumers change in the same commit:
    `test/corpus/corpus.test.ts:55`, `test/conformance/fixtures.test.ts:48`. Fix the stale header (test name, "six families") and the
    misplaced comment at 127-131.
  - Where: `transpile/lower/diagnostics/*`, `transpile/ir/*`, `transpile/index.ts`, the two consumers.
  - Accept: G, S, T; a grep finds no `transpile/ir/codes` import.
  - Depends: 1.2.1.
- [ ] 1.2.3 `ir/walk.ts` rebuilt on an exhaustive `childrenOf`.
  - What: `childrenOf(node)` as a switch over node kinds; `forEachExpr`, `forEachStmt`, `somePlace`, `holdsCall`, `mapPlaces`,
    `blocksOf`, `exitsAfter`, `loopUses`.
  - Where: `transpile/ir/walk.ts`, `walk.test.ts`.
  - Accept: G, S; `walk.test.ts` checks totality over every node kind and that the new `holdsCall` equals the old reflective one on
    every lowered fixture's IR.
  - Depends: 1.2.1.
- [ ] 1.2.4 `ir/faults.ts`.
  - What: fault kinds plus message texts. The interpreter's literals (interp.ts 117, 185, 193; values.ts 40, 203, 241) and the emitter's
    panic texts (emit.ts 640, 1266 and others) import them; strings byte-identical.
  - Where: `transpile/ir/faults.ts`, interp, emit.
  - Accept: G, S.
  - Depends: 1.2.1.
- [ ] 1.2.5 `ir/path.ts`: the IDE path grammar; `Runner.get` and `rustAccess` both parse through it.
  - Where: `transpile/ir/path.ts`, `path.test.ts`, `interp/interp.ts`, `emit/rust/emit.ts`.
  - Accept: G, S; `path.test.ts`.
  - Depends: 1.2.1.

### 1.3 `semantics/`

- [ ] 1.3.1 Move `ir/values.ts` and `ir/evaluate.ts` to `semantics/` as they are.
  - What: update the imports in interp and `lower/storage.ts`; `values.ts`'s self-import of the ir barrel becomes direct imports.
  - Where: `transpile/semantics/*`, importers.
  - Accept: G, S; lint shows `lower → semantics` and `interp → semantics` allowed and a planted `emit → semantics` rejected.
  - Depends: 1.0.1, 1.2.4.
- [ ] 1.3.2 Split `semantics/values.ts`.
  - What: into `value.ts`, `store.ts`, `convert.ts`, `text.ts`, `parse.ts`, `string.ts`, `arith.ts`, `math.ts`, `instantiate.ts` per
    design.md §4.5; delete the orphan docs at 106 and 309-313.
  - Where: `transpile/semantics/*`.
  - Accept: G, S.
  - Depends: 1.3.1.
- [ ] 1.3.3 Split `semantics/evaluate.ts`.
  - What: into `builtins.ts`, `operators.ts` (`binaryValue` typed `IrBinOp`), `fold.ts` (with private `evaluate`) and `faults.ts`
    (`LoweringBug`, `IecFault`); `widthOf` already left in 1.1.6.
  - Where: `transpile/semantics/*`.
  - Accept: G, S.
  - Depends: 1.3.2.
- [ ] 1.3.4 One convert, const and short-circuit rule (lean 10.3).
  - What: `convertValue`, `constValue` and `shortCircuit` are exported; `interp.ts` 172-173, 196-197 and 208-209 call them.
  - Where: `semantics/convert.ts`, `semantics/arith.ts`, `interp/interp.ts`.
  - Accept: G, S.
  - Depends: 1.3.3.
- [ ] 1.3.5 `storeAs(value, type)` replaces the four interpreter ternaries (81, 108, 161, 354).
  - Where: `semantics/value.ts`, `interp/interp.ts`.
  - Accept: G, S.
  - Depends: 1.3.4.
- [ ] 1.3.6 The first case table.
  - What: `semantics/cases.ts` (the `Case` contract, design.md P3); `semantics/text.cases.ts` from `lreal-text.test.ts`'s data;
    `interp/lreal-text.test.ts` becomes `semantics/text.test.ts`.
  - Where: `transpile/semantics/cases.ts`, `text.cases.ts`, `text.test.ts`.
  - Accept: G, T.
  - Depends: 1.3.2.
- [ ] 1.3.7 Split `coerce`.
  - What: into `toBool`, `toReal`, `realToInt`, `toText`, `fromText` (the last calling `parse.ts`), with `coerce` a dispatcher over them;
    no rule changes (RC 47's single rounding is 6.19).
  - Where: `semantics/convert.ts`, `semantics/parse.ts`.
  - Accept: G, S.
  - Depends: 1.3.4.
- [ ] 1.3.8 `semantics/numeric.cases.ts` with the 192 REAL→int cells.
  - What: one case per recorded cell of `fixtures/conversions/real-to-integer-ladder.ts` (and `real-to-integer.ts`), each naming its
    recording; `semantics/convert.test.ts` runs them against `realToInt`.
  - Where: `semantics/numeric.cases.ts`, `semantics/convert.test.ts`.
  - Accept: G; 192 cases green; the case count is written here.
  - Depends: 1.3.6, 1.3.7.

### 1.4 `interp/` and `pipeline/`

- [ ] 1.4.1 Split `interp/interp.ts` into `machine.ts`, `frame.ts`, `calls.ts` and `runner.ts`.
  - What: one frame builder for invoke and FB call (the key list at 88/260 once). `resolvePath` on `ir/path` plus `frame.locate`, its
    VAR_STAT handling moved into `locate`. Inline `import()` types become named imports; the orphan comment at 41 is deleted; the barrel
    no longer re-exports `Val`.
  - Where: `transpile/interp/*`.
  - Accept: G, S.
  - Depends: 1.3.5, 1.2.5.
- [ ] 1.4.2 `pipeline/index.ts`.
  - What: `load` moves unchanged (same signature and return) from `transpile/index.ts:58-66`; `lowerAndEmit` is added; the barrel
    re-exports both. Tests that call lowerSource+emitRust in a pair use `lowerAndEmit`.
  - Where: `transpile/pipeline/index.ts`, `transpile/index.ts`, `index.test.ts`, test callers.
  - Accept: G, S.
  - Depends: 1.4.1.
- [ ] 1.4.3 Split `interp/interp.test.ts` into `pipeline/{arith,control,calls,aggregates,pointers,time,strings}.test.ts`.
  - What: the charAt/setChar unit cases (1164-1222) go to `semantics/string.test.ts`.
  - Where: `transpile/pipeline/*.test.ts`, `semantics/string.test.ts`.
  - Accept: G, T.
  - Depends: 1.4.2.

### 1.5 `emit/rust/`

- [ ] 1.5.1 `Printer` methods become module functions `(p: Printer, …)` inside emit.ts (mechanical `this`→`p`).
  - Where: `emit/rust/emit.ts`.
  - Accept: G, S.
  - Depends: 1.2.1.
- [ ] 1.5.2 Split the giant functions in place.
  - What: design.md §4.0: `expr` (574-842) into one function per node kind, `stmt` (850-988) per statement kind, `emitRust`
    (1158-1323) into struct/init/scan/routine/runtime assembly functions — still in emit.ts.
  - Where: `emit/rust/emit.ts`.
  - Accept: G, S; no function in emit.ts over 80 lines.
  - Depends: 1.5.1.
- [ ] 1.5.3 `names.ts`.
  - What: `snake`, `RUST_KEYWORDS`, `RESERVED_FN_NAMES`, `fieldNames` (with its stranded doc from 133-137), `rustName`, `baseFnName`,
    `routineFnNames`, `globalsParams`/`globalsArgs`. The four `g`/`prg` renderings go through one builder only where the text is
    identical; the ones that differ are listed here (7.7.5's input). `tmp(purpose, n)` produces the existing `__` spellings exactly; the
    unprefixed `t`, `program` and `v` stay (7.8.10).
  - Where: `emit/rust/names.ts`, `names.test.ts`.
  - Accept: G, S.
  - Depends: 1.5.2.
- [ ] 1.5.4 `types.ts`.
  - What: `rustType`, `inoutType`, `genericList`, `isCopy`, `stringType`, `isString`, `isReal32` on `types/predicates` (the three
    string spellings and six real spellings collapse only where identical; the rest listed here).
  - Where: `emit/rust/types.ts`.
  - Accept: G, S.
  - Depends: 1.5.3, 1.1.5.
- [ ] 1.5.5 `values.ts`.
  - What: `literal`, `shortestF32`, `byteString`, `unitsLiteral`, and both `initOf` functions (the free one is folded in by 5.4).
  - Where: `emit/rust/values.ts`.
  - Accept: G, S.
  - Depends: 1.5.4.
- [ ] 1.5.6 `printer.ts` and `place.ts`.
  - What: the Printer state, `Frame`, `inFrame`, `push`, `withUri(uri, fn)` (the two save/restore copies at 1046/1098 and 1219), the
    guards, lend and copy-back helpers; `place`, `movedOut`, `stringPath` (the stale stacked doc at 535-539 is deleted).
  - Where: `emit/rust/printer.ts`, `place.ts`.
  - Accept: G, S.
  - Depends: 1.5.5.
- [ ] 1.5.7 `expr.ts`, `convert.ts` and `builtins.ts`.
  - What: the builtins as a name→printer table; `unparen`/`unparenHead`, `WRAPPING`, `INFIX`, `INVERSE`, `negated` in `expr.ts`;
    `castTo`, `fromF64` in `convert.ts`; `RUST_MATH` in `builtins.ts`.
  - Where: `emit/rust/expr.ts`, `convert.ts`, `builtins.ts`.
  - Accept: G, S.
  - Depends: 1.5.6.
- [ ] 1.5.8 `calls.ts`.
  - What: invoke, dispatch, select, the call statement, and one `callArguments` where the two builders print identical text (the
    difference, if any, listed here). The program move-out stays two spellings until 7.8.10.
  - Where: `emit/rust/calls.ts`.
  - Accept: G, S.
  - Depends: 1.5.7.
- [ ] 1.5.9 `stmt.ts` and `loops.ts`.
  - What: `block`, the statement arms; loop/break/continue. `hasStatementAfterReturn` and `nestedBlocks` go to `ir/walk.ts`
    (`exitsAfter`, `blocksOf`) with today's behaviour.
  - Where: `emit/rust/stmt.ts`, `loops.ts`, `ir/walk.ts`.
  - Accept: G, S.
  - Depends: 1.5.8, 1.2.3.
- [ ] 1.5.10 `routine.ts`, `structs.ts` and `module.ts`.
  - What: `printRoutine`; `printStruct` reproducing all four blocks byte-identically, `defaultImpl`; `emitRust`, `Emitted`. The stray blank
    line at 1099 and the misplaced iec_div comment (1268-1270) are fixed in the move (neither reaches the output).
  - Where: `emit/rust/routine.ts`, `structs.ts`, `module.ts`.
  - Accept: G, S.
  - Depends: 1.5.9.
- [ ] 1.5.11 `runtime/`.
  - What: `prelude.ts` splits into `runtime/string.ts`, `text.ts`, `parse.ts`, `numeric.ts` (iec_max/min); the inline helpers at emit.ts
    1264-1301 go into `numeric.ts` and `pointer.ts`. `runtime/index.ts` is a registry with `runtimeText(id)` that reproduces TODAY's
    gating exactly (the string blob on `IecStr`, plus per-helper sniffing). The source-map shift uses the registry's line count; the map's
    `size` exclusion counts exactly the lines the string prelude had (design.md §8). `prelude.ts` is deleted; the two deep
    `STRING_PRELUDE` consumers (`fixtures.test.ts:80`, `support/transpile-confidence.ts:24`) import `runtimeText("string")` in the
    same commit — no re-export shim.
  - Where: `emit/rust/runtime/*`, `module.ts`, the two consumers.
  - Accept: G, S, M identical (size median unchanged).
  - Depends: 1.5.10.
- [ ] 1.5.12 `rustAccess` to `test/conformance/support/rust-access.ts`; the barrel narrowed.
  - What: `emit/rust/index.ts` exports only `emitRust`, `Emitted`, `rustType`; the transpile barrel drops `fieldNames`, `snake`,
    `rustAccess`, `sameName`, `holdsCall`, `peelArray`, `elementOf`, `isBit`, `defaultValueOf` (one deliberate `index.test.ts` edit per
    name). Consumers changed in the same commit: `fixtures.test.ts:47`, `backends.test.ts:31`, `support/transpile-confidence.ts:23`,
    `test/libraries/{standard,stringutils,util}.test.ts` (design.md §2.1.1 table).
  - Where: `emit/rust/index.ts`, `transpile/index.ts`, `index.test.ts`, `test/conformance/support/rust-access.ts`, the consumers.
  - Accept: G, S; `index.test.ts` lists exactly design.md §2.1.1.
  - Depends: 1.5.11, 1.4.2.
- [ ] 1.5.13 Split `emit.test.ts` per design.md §4.6.
  - What: text shapes → `names/values/expr/stmt/calls/loops.test.ts`; the compile suite (497-690) → `test/conformance/emit-build.test.ts`;
    the VAR_TEMP reset describe (800) → `values.test.ts`; the cap describe (398) stays (in `loops.test.ts`) until 2.3. The temporary lint
    exception from 1.0.1 is removed.
  - Where: `emit/rust/*.test.ts`, `test/conformance/emit-build.test.ts`, `scripts/check-layering.ts`.
  - Accept: G, T.
  - Depends: 1.5.12.
- [ ] 1.5.14 Delete `emit.ts`; lower the ceilings.
  - Where: `emit/rust/`, `scripts/check-size.ts`.
  - Accept: G, S; `emit.ts` and `emit.test.ts` are gone; every `emit/rust/**` file is 400 lines or less and off the ceiling list.
  - Depends: 1.5.13.
- [ ] 1.5.15 The twin harness.
  - What: `test/conformance/runtime-twins.test.ts` per design.md §8, running `text.cases.ts` against `runtime/text.ts` and
    `numeric.cases.ts` against `runtime/numeric.ts`; a case naming a recording is also checked against it. Divergences found today
    (e.g. RC 32/33 cells) are marked expected failures with their RC.
  - Where: `test/conformance/runtime-twins.test.ts`.
  - Accept: G; every case either passes or is an expected failure naming its RC.
  - Depends: 1.5.11, 1.3.8.

### 1.6 `lower/` (split giant functions in place first, then move leaves first; each file moves with its tests from 1.8.1)

- [ ] 1.6.1 Split `lowerInvoke` in place.
  - What: design.md §4.0: the ANY binding, the cursor binding, the form-2 borrowed binding, output bindings, the program move-in/out and
    argument binding become named functions in calls.ts with explicit parameters.
  - Where: `lower/calls.ts`.
  - Accept: G, S; `lowerInvoke` is 80 lines or less.
  - Depends: 1.2.2.
- [ ] 1.6.2 Split `lowerCallStatement` and `lowerSuperCall` in place (input stores, in-out binding, open bounds, output copy).
  - Where: `lower/calls.ts`.
  - Accept: G, S; each 80 lines or less.
  - Depends: 1.6.1.
- [ ] 1.6.3 Split `lowerExpr` in place, one function per arm.
  - Where: `lower/expressions.ts`.
  - Accept: G, S; the dispatch is 80 lines or less.
  - Depends: 1.2.2.
- [ ] 1.6.4 Split `lowerStmt` in place, one function per arm.
  - Where: `lower/statements.ts`.
  - Accept: G, S.
  - Depends: 1.2.2.
- [ ] 1.6.5 Split `lowerBuiltin` in place, one function per builtin group.
  - Where: `lower/builtins.ts`.
  - Accept: G, S.
  - Depends: 1.2.2.
- [ ] 1.6.6 `initStep`'s closures become module functions taking `lw` (design.md §4.1 list).
  - Where: `lower/lower.ts`.
  - Accept: G, S; no closure over `lw` is left inside `initStep`.
  - Depends: 1.2.2.
- [ ] 1.6.7 `lowerUnit`'s and `lowerSource`'s closures become module functions.
  - Where: `lower/lower.ts`.
  - Accept: G, S.
  - Depends: 1.6.6.
- [ ] 1.6.8 `core/build.ts`.
  - What: `cast`, `binaryOf` (convert.ts 102-109) and `ZERO_SPAN` (lowering.ts 372; the inline re-spelling at lower.ts 766 is deleted).
  - Where: `lower/core/build.ts`.
  - Accept: G, S.
  - Depends: 1.6.7.
- [ ] 1.6.9 `builtins/arity.ts`, a leaf.
  - What: `BUILTIN_ARITY`, `isConstantCallee`, `oneArgument`, which breaks the constants↔builtins import cycle.
  - Where: `lower/builtins/arity.ts`.
  - Accept: G, S; no cycle reported.
  - Depends: 1.6.8.
- [ ] 1.6.10 `values/`.
  - What: `constants.ts` → `values/literals.ts` (incl. `inTicks`, `TEMPORAL_LITERAL_KINDS`), `values/fold.ts` (incl. `enumValueOf`),
    `values/enums.ts` (the orphan calendarOf doc at 249-254 fixed); `convert.ts` → `values/convert.ts`, `LINT_MAX` and
    `integerFoldType` → `fold.ts`, `stored` → `types/width` (1.1.6); `meetOperands` not yet (1.7.15).
  - Where: `lower/values/*`.
  - Accept: G, S.
  - Depends: 1.6.9, 1.1.6, 1.1.12.
- [ ] 1.6.11 `storage/`.
  - What: `storage.ts` → `layout.ts`, `declare.ts`, `statics.ts`, `addresses.ts` (+ `addressSharedByInstances` from lower.ts); the init
    parts → `init/initial-values.ts` (incl. `runnableInit`) and `init/temp-resets.ts`; `bytes.ts`, `unions.ts` → `storage/`; `sizeOf`,
    `adrDifference` → `builtins/sizeof.ts`; `rootType` → `places/path.ts`; `foldedCall` → `values/fold.ts`; storage's `holdsCall` →
    `core/ast-walk.ts` `exprHoldsCall`. The duplicate doc at 300 is deleted.
  - Where: `lower/storage/*`, `lower/init/*`, `lower/builtins/sizeof.ts`, `lower/places/path.ts`, `lower/core/ast-walk.ts`.
  - Accept: G, S.
  - Depends: 1.6.10.
- [ ] 1.6.12 `places/`.
  - What: `places.ts` → `places.ts` (+`Indexed`), `names.ts` (precedence as it is; `ownMember`, `methodOf` from calls.ts), `self.ts`
    (`selfFb`, `thisPlace`, `instancePlace` from calls.ts), `globals.ts`, `bounds.ts` (+`openDims`/`boundName` from lowering.ts),
    `path.ts`; `throughReference` → `pointers/deref.ts` (created here, completed in 1.6.13).
  - Where: `lower/places/*`.
  - Accept: G, S.
  - Depends: 1.6.11.
- [ ] 1.6.13 `pointers/`.
  - What: `pointers.ts` → `state.ts` (+`PointerTarget`, `Cursor` and the pointer maps from lowering.ts), `address.ts`, `store.ts`,
    `deref.ts` (+`storeThrough` from statements.ts, `describePointer`, `unsuppliedInput`, `nullDeref`), `cursor.ts`, `borrowed.ts`
    (`borrowedInOut`); `through`, `refuseConstantWrite`, `loadValue` → `places/access-guards.ts`; `sameStorage`, `sameTarget` →
    `places/path.ts`.
  - Where: `lower/pointers/*`, `lower/places/*`.
  - Accept: G, S.
  - Depends: 1.6.12.
- [ ] 1.6.14 `expressions/`.
  - What: the dispatch, `operators.ts` (+`BIN_OPS`, `COMPARISONS`, `LIFTED`), `calendar.ts`, `partial-access.ts`; the `.diSize` read →
    a new `pointers/any.ts`.
  - Where: `lower/expressions/*`, `lower/pointers/any.ts`.
  - Accept: G, S.
  - Depends: 1.6.13, 1.6.3.
- [ ] 1.6.15 `builtins/`.
  - What: `builtins.ts`, `value-functions.ts` (+`checkedBits`, `UNARY_MATH`), `system.ts`, `clock.ts` (+`CLOCK_KEY`), `conversions.ts`;
    `lower/index.ts` takes `CLOCK` from `clock.ts`.
  - Where: `lower/builtins/*`.
  - Accept: G, S.
  - Depends: 1.6.14, 1.6.5.
- [ ] 1.6.16 `statements/`.
  - What: `statements.ts`, `assign.ts`, `loops.ts`, `case.ts`. The `__TRY` note (249-271) moves to docs/architecture.md; the empty banner
    at 348 is deleted.
  - Where: `lower/statements/*`, `docs/architecture.md`.
  - Accept: G, S.
  - Depends: 1.6.15, 1.6.4.
- [ ] 1.6.17 `interfaces/`.
  - What: `tags.ts` (the doc at 85-89 reattached to `interfaceKey`), `lend.ts` (`heldAt`, `instanceRelative`, `lendPlace`,
    `refusedLends`, per-callee lend), `dispatch.ts` (+`interfaceProperty`, `accessorCall`), `query.ts` (+`isQuery`), `state.ts`;
    `finishInterfaces`, `onEachTag`, `bodiesOf` and the lend driver → `entry/finish.ts`, which runs the bindings' dispatches too;
    `callsIn` → `ir/walk.ts`.
  - Where: `lower/interfaces/*`, `lower/entry/finish.ts`, `ir/walk.ts`.
  - Accept: G, S.
  - Depends: 1.6.16.
- [ ] 1.6.18 `calls/`.
  - What: `routines.ts`, `facts.ts`, `variants.ts`, `parameters.ts`, `invoke.ts`, `fb-call.ts`, `outputs.ts`, `binding.ts`, `super.ts`
    (+`isSuper`), `property.ts`, `specialize.ts` (from specialize.ts), `last-binding.ts` (from bindings.ts), `reentrancy.ts`
    (+`touchesOf`), `namespace.ts`; the ANY, cursor and borrowed functions extracted in 1.6.1 → `pointers/{any,cursor,borrowed}.ts`;
    `FbType`, `RoutineSymbol` → `core/lowering.ts`. The orphan docs at 63-65, 364-368 and 948-949 are deleted. Every name of
    design.md §4.3 lands where it says.
  - Where: `lower/calls/*`, `lower/pointers/*`.
  - Accept: G, S; no `calls/*` file over 400 lines.
  - Depends: 1.6.17, 1.6.2.
- [ ] 1.6.19 `init/`.
  - What: `init-sequence.ts` → `init/sequence.ts`; `initStep` → `init/step.ts`, `fb-init.ts`, `instance-init.ts`, `attributes.ts`
    (+`INIT_ATTRIBUTE`); `ownProgram` → `calls/reentrancy.ts`; `writesGlobal` → `ir/walk.ts`; the init state → `init/state.ts`.
  - Where: `lower/init/*`.
  - Accept: G, S.
  - Depends: 1.6.18, 1.6.6.
- [ ] 1.6.20 `entry/` and `project/`.
  - What: the rest of `lower.ts` → `entry/lower-unit.ts`, `entry/lower-source.ts`, `entry/checks.ts`, `project/prepare.ts`
    (+`LoweringProject`, `AttributeLookup`), `project/library-base.ts`. `lower/index.ts` gets explicit exports; `lower.ts` is deleted.
  - Where: `lower/entry/*`, `lower/project/*`, `lower/index.ts`.
  - Accept: G, S.
  - Depends: 1.6.19.
- [ ] 1.6.21 `core/lowering.ts` and `core/shared.ts` slimmed.
  - What: `Lowering` holds the frame, `bail`, slots, modes and `resolve` only; `Shared`, `newShared`, `PendingBody`, `CalledRoutine` →
    `core/shared.ts`; `tempPlace`/`temp` → `core/temps.ts`; `fail` → `calls/routines.ts`; `baseOf` → `core/chain.ts`. The `frame` getter
    and the empty banners (176-178, 364-368, 380) are deleted.
  - Where: `lower/core/*`.
  - Accept: G, S; `core/lowering.ts` is 250 lines or less.
  - Depends: 1.6.20.

### 1.7 Consolidations (one home per concern; neutral by construction, proven by S)

- [ ] 1.7.1 AST walkers into `core/ast-walk.ts`: `overridesCalled`, `borrowedPointerNames`, `reachedNames`, `exprHoldsCall`,
  `queryCondition`'s leading-query scan.
  - Where: `lower/core/ast-walk.ts`.
  - Accept: G, S.
  - Depends: 1.6.21.
- [ ] 1.7.2 One `oneArgument` check for the five builtin sites.
  - Where: `lower/builtins/arity.ts` and its callers.
  - Accept: G, S.
  - Depends: 1.6.21.
- [ ] 1.7.3 One EXTENDS chain (lean 10.1, widened).
  - What: the 13 lowering sites (lower.ts 164-169, 179-188, 232, 247-252, 261, 326-335; calls.ts 93-102, 107-117, 635-640; bytes.ts
    81-83; interfaces.ts 47-70 incl. `interfaceChain`; storage.ts 77-87) use `core/chain.ts` over `symbols.extendsChain`. A site whose
    order or cycle handling differs keeps a documented parameter, listed here (6.B.3's input).
  - Where: `lower/core/chain.ts` and the sites.
  - Accept: G, S; a grep finds no hand-written EXTENDS walk in `lower/`.
  - Depends: 1.6.21, 1.1.2.
- [ ] 1.7.4 One IR walker.
  - What: `touchesOnlyItsOwn`, `writesOnlyLocals`, `reachesDispatch`, `writesGlobal`, `callsIn`, `callsNothing` (→ `!holdsCall`),
    `mapPlaces`, `exitsAfter`, `blocksOf` and the init-sequence read walk run on `ir/walk.childrenOf`. The init-sequence walk keeps its
    current skip set (select, freezes) as an explicit option (removed in 5.9).
  - Where: `transpile/ir/walk.ts` and callers.
  - Accept: G, S; a grep finds no reflective IR walk outside `ir/walk.ts`.
  - Depends: 1.2.3, 1.6.21.
- [ ] 1.7.5 `guardWrite(place, checks)`.
  - What: each store site passes its current check list explicitly (the per-site subsets listed here). Making them uniform is 6.A.18.
  - Where: `lower/places/access-guards.ts` and the store sites.
  - Accept: G, S.
  - Depends: 1.6.21.
- [ ] 1.7.6 `core/nested.ts`.
  - What: one diagnostic drain replaces the 12 hand-written drains; one `declareGlobals` replaces places.ts 47-53, storage.ts 139-154 and
    calls.ts 228-229.
  - Where: `lower/core/nested.ts` and the sites.
  - Accept: G, S.
  - Depends: 1.6.21.
- [ ] 1.7.7 One body pipeline `bodyOf(unit)`, replacing the five copies (calls.ts 545/656, 687/698, 802/821, 1303/1313; lower.ts 71/113).
  - Where: `lower/calls/routines.ts`.
  - Accept: G, S.
  - Depends: 1.7.6.
- [ ] 1.7.8 One routine cache.
  - What: `instanceInitRoutine` and `specializeRoutine` go through `once`, which gains the lowering/failed states and the recursion guard.
  - Where: `lower/calls/routines.ts`, `init/instance-init.ts`, `calls/specialize.ts`.
  - Accept: G, S; a grep finds one writer of the routine cache.
  - Depends: 1.7.7.
- [ ] 1.7.9 One ADR recognizer `adrOperand`, replacing pointers.ts 96, calls.ts 337-343 and bytes.ts 173-174.
  - Where: `lower/pointers/address.ts` and the sites.
  - Accept: G, S.
  - Depends: 1.6.21.
- [ ] 1.7.10 One path walk and one field lookup.
  - What: `typeAlong` for the six type-along-path walks (incl. `insideInstance`), `fieldOf` for the ~15 upper-cased field lookups.
  - Where: `lower/places/path.ts` and the sites.
  - Accept: G, S; a grep finds no `toUpperCase()` field lookup outside `path.ts`.
  - Depends: 1.6.21.
- [ ] 1.7.11 One place identity `staticKey`.
  - What: replaces `stringIdentity`, `staticPath`, `placeKey`, `instanceKey`, `suffixOf`/`sameStep`, `sameTarget`, `sameStorage`;
    `pointerKey` and `interfaceKey` are built on it. Any copy whose identity differs keeps it behind a named option, listed here (4.15's
    input).
  - Where: `lower/places/path.ts`, `pointers/state.ts`, `interfaces/tags.ts`, `calls/last-binding.ts`.
  - Accept: G, S.
  - Depends: 1.7.10.
- [ ] 1.7.12 One `programReentrant`, used by the five inlined sites and the init step's two.
  - Where: `lower/calls/reentrancy.ts`.
  - Accept: G, S.
  - Depends: 1.6.21.
- [ ] 1.7.13 `reachesFbInit`: `holdsFbInit` and `reaches` merged (lean 10.1).
  - Where: `lower/init/fb-init.ts`.
  - Accept: G, S.
  - Depends: 1.6.21.
- [ ] 1.7.14 Enum numbering and default in `types/enums.ts`.
  - What: `numberEnumerators` replaces `defaultOfValues` and `enumConstant`'s numbering; `enumDefaultValue` replaces the value part of
    `enumDefault`/`inlineEnumDefault`; `lower/values/enums.ts` keeps only `enumStorage`/`enumConstant` (IR). If 0.9 found an enum home
    in the front-end, use it.
  - Where: `types/enums.ts`, `types/enums.test.ts`, `types/index.ts`, `lower/values/enums.ts`.
  - Accept: G+LSP, S.
  - Depends: 1.6.21, 1.1.14.
- [ ] 1.7.15 One operand meet `meet(lw, operands, context)`.
  - What: replaces expressions.ts 61-67/253-279, builtins.ts `meetOperands` and statements.ts 321-323; a context whose rule differs keeps
    it as a named context, listed here.
  - Where: `lower/values/promote.ts`.
  - Accept: G, S.
  - Depends: 1.6.21.
- [ ] 1.7.16 No fallback in the refusal kind.
  - What: `bail` calls `lowerCodeKind`; an unregistered code throws `LoweringBug`.
  - Where: `lower/core/lowering.ts`, `lower/diagnostics/codes.ts`.
  - Accept: G, S; `codes.test.ts` green, plus a test that an unregistered code throws.
  - Depends: 1.2.2, 1.6.21.
- [ ] 1.7.17 One VAR_TEMP reset site `resetTemps(lw)`, called from the three places (lower.ts 117, calls.ts 821 and 1313 before the moves).
  - Where: `lower/init/temp-resets.ts`, `calls/routines.ts`, `entry/lower-unit.ts`.
  - Accept: G, S.
  - Depends: 1.7.7.
- [ ] 1.7.18 Lowering's call parameter view in `calls/parameters.ts`.
  - What: `positionalParameters`, `inOutSections`, `prefixed`, `positionalOf` in one module; a differential test compares its parameter
    list with `types/infer/callee.resolveCallee` over every call in the lowered fixtures and writes the differences here (6.B.4's input).
  - Where: `lower/calls/parameters.ts`, `parameters.test.ts`.
  - Accept: G, S; the difference list is written here.
  - Depends: 1.6.21, 1.1.13.
- [ ] 1.7.19 One tag encoding `core/tags.ts`.
  - What: `NO_TAG`, `tagOfIndex`, `indexOfTag`; the pointer, interface-instance and `__inout_binding` schemes number through it.
    Whether the schemes merge is 4.2/4.14.
  - Where: `lower/core/tags.ts`, `pointers/state.ts`, `interfaces/tags.ts`, `calls/last-binding.ts`.
  - Accept: G, S; a grep finds no `+ 1`/`- 1` tag arithmetic outside `core/tags.ts`.
  - Depends: 1.6.21.
- [ ] 1.7.20 Registries and surface in place.
  - What: the transpile barrel exports exactly design.md §2.1.1; `lower/index.ts` the lower row; the dead-export list of 1.0.4 is cleared
    (each name deleted, un-exported, or used).
  - Where: `transpile/index.ts`, `lower/index.ts`, `scripts/dead-exports.ts` output.
  - Accept: G, S; `dead-exports.ts --scope src/transpile` (filtered per design.md §8) prints nothing.
  - Depends: 1.7.1-1.7.19.

### 1.8 Tests and conformance support

- [ ] 1.8.1 Split `lower/lower.test.ts` per design.md §5 (133 tests into about 36 colocated files).
  - Where: `lower/**/*.test.ts`.
  - Accept: G, T; `lower.test.ts` deleted.
  - Depends: 1.6.20.
- [ ] 1.8.2 Move the remaining lower tests: `calls.test.ts` → `calls/routines.test.ts` + `calls/binding.test.ts`;
  `init-sequence.test.ts` → `init/sequence.test.ts`; `totality.test.ts` → `entry/totality.test.ts`.
  - Where: `lower/**/*.test.ts`.
  - Accept: G, T.
  - Depends: 1.8.1.
- [ ] 1.8.3 Split `support/transpile-confidence.ts` (4032 lines).
  - What: into `support/transpile/{tier,correctness,lint-policy,shape,edge,row}.ts` and `support/notes/{lean,notes,render}.ts` with the
    authored tables as `notes.data.ts`, `lean.data.ts`; `rate-fixtures.ts` imports updated.
  - Where: `test/conformance/support/**`, `scripts/rate-fixtures.ts`.
  - Accept: G, M (identical map content except the type import path).
  - Depends: 0.6.
- [ ] 1.8.4 `support/recordings.ts`, the one `codesys.run.json` reader (for fixtures.test.ts, evidence.ts and the correctness module).
  - Where: `test/conformance/support/recordings.ts` and the three readers.
  - Accept: G, M identical.
  - Depends: 1.8.3.
- [ ] 1.8.5 `support/display.ts`: `ideValue`, `asDisplayed`, `interpRender`, `rustRender`.
  - Where: `test/conformance/support/display.ts`.
  - Accept: G, S.
  - Depends: 1.8.4.
- [ ] 1.8.6 `support/differential.ts`, used by `backends.test.ts` and the edge verdict.
  - Where: `test/conformance/support/differential.ts`, `backends.test.ts`, `support/transpile/edge.ts`.
  - Accept: G, S (edge layer identical).
  - Depends: 1.8.5.
- [ ] 1.8.7 Split `fixtures.test.ts` into `transpile-replay.test.ts`, `map.test.ts` and `lsp-replay.test.ts`.
  - What: the LSP replay binds through `lower/project/library-base.ts`; `project-libraries.ts` uses it too.
  - Where: `test/conformance/*.test.ts`, `support/project-libraries.ts`.
  - Accept: G+LSP, T, M identical.
  - Depends: 1.8.6, 1.6.20.
- [ ] 1.8.8 `libraries/index.ts` takes the manifest's `folder` instead of slicing the URI (l.70).
  - Where: `libraries/index.ts`.
  - Accept: G, S.
  - Depends: 1.6.20.
- [ ] 1.8.9 The fold-agreement test (design.md P3a).
  - What: for every constant expression the lowered fixtures fold, `types/const/fold.constEval` (AST) and `semantics/fold.constantValue`
    (IR) give the same value and type; each disagreement found is an expected failure naming its RC or a new 6.A task.
  - Where: `test/conformance/fold-agreement.test.ts`.
  - Accept: G; the disagreement count is written here.
  - Depends: 1.8.4, 1.3.3.

### 1.9 Close the structure phase

- [ ] 1.9.1 architecture.md's transpile section.
  - What: the folder map (design.md §2.0), the layer table (P2), the ownership rows (§2.8), the two folds (P3a); the `__TRY` note from 1.6.16.
  - Where: `docs/architecture.md`.
  - Accept: `check-citations` reports no missing path in it.
  - Depends: 1.8.7.
- [ ] 1.9.2 data-model.md and scripts README.
  - What: data-model.md's `## types` section corrected (it still documents the deleted ResolvedType/InferredType and lacks `length`,
    `bounds`, `tickNs`, `mantissaBits`) and a `## transpile IR` section; `scripts/README.md` gains the snapshot, size and citation tools.
  - Where: `docs/data-model.md`, `scripts/README.md`.
  - Accept: `check-citations` reports no missing path in them.
  - Depends: 1.9.1.
- [ ] 1.9.3 Re-point every stale path citation.
  - What: every citation `check-citations` reports (src comments, fixture comments such as `oop/lifecycle.ts`, `memory/memory-model.ts`,
    `syntax/literal-value.ts:170`, the ~60 NOTES/LEAN texts such as 'emit.ts:517', 'expressions.ts:241-247', and the open openspec
    changes' tasks such as 'lower.test.ts:614') names its new file; `check-citations` becomes an error in lint.
  - Where: the cited files; `support/notes/*.data.ts`; `openspec/changes/*/tasks.md`; `scripts/check-citations.ts`.
  - Accept: G; M (only note texts change); `check-citations` reports 0.
  - Depends: 1.9.2.
- [ ] 1.9.4 Checkpoint review.
  - What: a fresh-implementation review of the new tree (memory: review at checkpoints); findings fixed or filed as tasks here.
  - Where: all of `src/transpile/**`.
  - Accept: the size ceiling list for `src/transpile/**` is empty and the >80-line function list is empty; S identical to 0.5; T
    identical to 0.5.
  - Depends: 1.9.3.

## 2. Model 1: loops (RC 27, 35, 36, 39; RC 13's transpiler half; RC 13 guard)

- [ ] 2.1 Measure.
  - What: (a) interpreter wall time on `tr_27_loop_cap_while_5000000` and `tr_27_loop_cap_for_1000001` with the cap disabled; (b) every
    test, recording and fixture that reaches `LOOP_CAP_MESSAGE`; (c) how the harness distinguishes a CODESYS stop (timeout) from a
    runaway; (d) record `for_counter_at_type_max` (INT counter to 32767 with an EXIT guard), `for_runtime_step_changed_in_body`
    (the body changes the step variable) and `for_runtime_step_same_type` (INT variable step on an INT counter).
  - Where: this file (numbers); fixtures in `test/conformance/fixtures/semantics/execution.ts`.
  - Accept: recordings committed (`record:exec`); the numbers written here.
  - Depends: 1.9.4.
- [ ] 2.2 Design "§3.1 Decision: loops".
  - What: the cap (option a or b), the counting rule, the step rule (refuse only a non-converting step, per 2.1's runtime-step
    recordings), literal vs typed limit, loop depth, labels by pre-scan, what stays refused (by code), and which of `lower.test.ts:278`,
    `:1076` and `emit.test.ts:696` change and on which recording.
  - Where: `design.md`.
  - Accept: committed before any code.
  - Depends: 2.1.
- [ ] 2.3 The cap leaves the semantics (RC 27).
  - What: `ir/stmt.ts` loses `LOOP_ITERATION_CAP`/`LOOP_CAP_MESSAGE`; `interp/runner.ts` gains the `loopBudget` option raising
    `HarnessBudget`; `emit/rust/loops.ts` prints no counter (or a `cfg` guard, per 2.2). The cap describe (then in `loops.test.ts`) is
    deleted (premise contradicted by `tr_27`); `index.test.ts` loses the two names.
  - Where: `ir/stmt.ts`, `interp/machine.ts`, `interp/runner.ts`, `semantics/faults.ts`, `emit/rust/loops.ts`, tests.
  - Accept: F(`tr_27_loop_cap_for_1000000`, `_for_1000001`, `_repeat_1000001`, `_while_5000000`); a conformance boundary test at the old
    CAP and CAP+1 for FOR/WHILE/REPEAT in both backends; M (`manual_assert` and `unreadable_literal` fall).
  - Depends: 2.2.
- [ ] 2.4 FOR step (RC 35).
  - What: a folded constant step is wrapped to the counter width, its direction from the signed literal. A step whose type does not
    convert implicitly to the counter type (`types/compat.isAssignable`), or a folded step that does not fit, is refused with a
    registered code. A convertible runtime step keeps lowering, evaluated per 2.1's recording.
  - Where: `lower/statements/loops.ts`, `lower/diagnostics/codes.ts`.
  - Accept: F(`tr_35_for_byte_step_minus_one`, `tr_35_for_uint_step_minus_two`); `tr_35_for_byte_step_255` and
    `callshape_for_runtime_step` stay confirmed; `tr_35_for_byte_runtime_int_step` and `tr_35_for_sint_step_300` are refused by the
    transpiler (LSP half Filed); `loops.test.ts` and `bounds.test.ts` green (changed only as 2.2 says); M.
  - Depends: 2.3.
- [ ] 2.5 FOR literal limit in its own type (RC 36).
  - What: a literal limit is lowered without the counter as the expected type; the compare runs in the meet (`values/promote.ts`).
  - Where: `lower/statements/loops.ts`.
  - Accept: F(`tr_36_for_literal_limit_beyond_counter`) (n = 300, small = 44); src test; M.
  - Depends: 2.4.
- [ ] 2.6 A typed FOR limit wider than the counter is refused (RC 13's transpiler half).
  - What: a non-literal limit whose type does not convert implicitly to the counter type is refused with the implicit-conversion code.
  - Where: `lower/statements/loops.ts`.
  - Accept: `for_limit_wider_than_counter_dint_var`, `_dint_expr`, `_upper_bound` are refused by the transpiler (their `rust`/`tier`
    columns disappear; the LSP half is Filed); `for_limit_wider_than_counter_uint_n_minus_1` and the `5 TO -5 BY -1` fixture stay
    confirmed; src test red then green; M.
  - Depends: 2.5.
- [ ] 2.7 EXIT/CONTINUE outside a loop (RC 39).
  - What: a loop-depth counter beside `conditional`; a new code `stmt-exit-outside-loop`.
  - Where: `lower/statements/loops.ts`, `lower/core/lowering.ts`, `lower/diagnostics/codes.ts`.
  - Accept: `cc2_exit_outside_loop` is refused by the transpiler with the new code (it was edge `not-run`, rust `rejected`; its
    `rust`/`tier` columns disappear); src test red then green; M.
  - Depends: 2.3.
- [ ] 2.8 Labels from the IR pre-scan.
  - What: whether a loop needs `'loop_N`/`'body_N` comes from `ir/walk.loopUses`, not from rewriting printed lines (`loops.ts`, was
    emit.ts 934-935); the printed text is unchanged.
  - Where: `emit/rust/loops.ts`, `ir/walk.ts`.
  - Accept: S-out and Rust identical (S on the rust layer).
  - Depends: 2.3.
- [ ] 2.9 RC 13 regression guard.
  - What: `emit/rust/loops.test.ts` compiles the UINT `n-1` loop.
  - Where: `emit/rust/loops.test.ts`.
  - Accept: G; `for_limit_wider_than_counter_uint_n_minus_1` and the negative-step fixture stay confirmed after 2.4-2.6 (the three typed
    wider limits are refused, per 2.6).
  - Depends: 2.6.
- [ ] 2.10 Model delta.
  - What: architecture.md's loop paragraph; the map delta written here.
  - Where: `docs/architecture.md`; this file.
  - Accept: M.
  - Depends: 2.3-2.9.

## 3. Model 2: strings (RC 11, 34, 45; appendix string items)

- [ ] 3.1 Measure.
  - What: M1 (re-read `tr_45` cell by cell against RC 45's LIVE text; record `string_literal_nul_tail` if unresolved), M2
    (`string_assign_tail_narrow`, `string_assign_tail_wide`), M3 (WSTRING twins), M4 (`string_compare_tail`), M5
    (`string_conversion_result_capacity`, `concat_result_capacity`), M6 (interpreter time per representation on the `string_*` fixtures),
    M7 (how CODESYS prints a sizeless STRING in `codesys.build.json` messages, and every LSP message/hover that renders one).
  - Where: `test/conformance/fixtures/strings/string-edges.ts`; numbers here.
  - Accept: recordings committed; M1-M7 answered here.
  - Depends: 1.9.4.
- [ ] 3.2 Design "§3.2 Decision: strings".
  - What: the representation (a/b/c) in TS and Rust (incl. the `B = n+1` const parameter), literal NUL, assignment across capacities,
    comparison, conversion capacity, where the capacity default is applied (transpile-side, per type.ts:36-38 unless M7 contradicts), the
    commonType item per M7, the tests that change and why.
  - Where: `design.md`.
  - Accept: committed.
  - Depends: 3.1.
- [ ] 3.3 Every string Type the transpiler holds carries its capacity.
  - What: `core/lowering.resolve` applies `DEFAULT_STRING_LENGTH` to every sizeless STRING/WSTRING it returns; `withStringCapacity`
    (`storage/layout.ts`) is deleted; `types/resolve.ts` is unchanged. The appendix item "commonType treats a sizeless STRING as capacity
    0" is fixed in `types/arith/runtime.ts` or closed with M7 as the reason, per 3.2.
  - Where: `lower/core/lowering.ts`, `lower/storage/layout.ts`, `types/arith/runtime.ts` (if 3.2 says so).
  - Accept: G+LSP (LSP output byte-identical unless 3.2 names the change); S-out (list any Rust that printed capacities differently).
  - Depends: 3.2.
- [ ] 3.4 `semantics/string.ts` new model plus `string.cases.ts`; the interpreter runs it.
  - Where: `semantics/string.ts`, `string.cases.ts`, `string.test.ts`, `interp/frame.ts`.
  - Accept: `semantics/string.test.ts` green on the case table (`tr_34`, `tr_45`, `lib_prim_char_past_length`, M1-M5 cells).
  - Depends: 3.3.
- [ ] 3.5 `emit/rust/runtime/string.ts` new model.
  - Where: `emit/rust/runtime/string.ts`, `emit/rust/types.ts`, `values.ts`.
  - Accept: `runtime-twins.test.ts` runs `string.cases.ts` through rustc and matches.
  - Depends: 3.4.
- [ ] 3.6 Bytes behind the terminator (RC 34).
  - What: a store at or past `len` rescans; a same-capacity copy keeps the units.
  - Where: `semantics/string.ts`, `runtime/string.ts`, `lower/places/places.ts` (`s[i]`).
  - Accept: src pipeline test (right-to-left digit fill gives '4321'; 'abcdef' with `t[2]:=0; t[2]:=88` gives 'abXdef');
    `tr_34_lib_prim_char_behind` flips only at 4.12 (it needs POINTER TO BYTE).
  - Depends: 3.5.
- [ ] 3.7 `$00` in a literal (RC 45).
  - What: the literal valuation keeps the decoded units; `values/literals.stringLiteralText` builds a buffer whose `len` is the first 0,
    the bytes behind per M1. If frontend-conformance closed the decoding half (0.1), only the lowering half remains.
  - Where: `syntax/literal-value.ts`, `lower/values/literals.ts`.
  - Accept: F(`tr_45_string_embedded_nul`); G+LSP; M.
  - Depends: 3.6.
- [ ] 3.8 Conversions without the 80 cut (RC 11).
  - What: an operand keeps its own capacity; a wide result is sized by the source (M5).
  - Where: `lower/builtins/conversions.ts`.
  - Accept: F(`tr_11_string_conversion_beyond_80`), which now lowers; `xo3_string_wide_conversions` stays confirmed; M.
  - Depends: 3.6.
- [ ] 3.9 Tests that pinned the old model.
  - What: `pipeline/strings.test.ts`, `semantics/string.test.ts`, `builtins/conversions.test.ts`, `places/places.test.ts`,
    `builtins/value-functions.test.ts`, `pointers/cursor.test.ts`, `test/libraries/{standard,stringutils}.test.ts`: each changed
    expectation cites its recording.
  - Where: those files.
  - Accept: G; the diff lists every changed expectation with its recording.
  - Depends: 3.8.
- [ ] 3.10 Whole-string cursor store (appendix).
  - What: record `cursor_whole_store_capacity`; fix it or refuse it by name.
  - Where: `lower/pointers/cursor.ts`.
  - Accept: recorded; F or a named refusal; M.
  - Depends: 3.9.
- [ ] 3.11 StrReplaceA past LEN (appendix).
  - What: re-run `STRREPLACEA.fun` on the new model; fix the library body only if it is still wrong against its recording.
  - Where: `libraries/StringUtils/**`.
  - Accept: the `stringutils.test.ts` case green against the recorded value.
  - Depends: 3.9.
- [ ] 3.12 Model delta.
  - What: architecture.md's string paragraph; the map delta (string fixture sizes).
  - Where: `docs/architecture.md`; this file.
  - Accept: M.
  - Depends: 3.6-3.11.

## 4. Model 3: pointers and references (RC 14, 15, 16, 17, 18, 20, 26, 44)

- [ ] 4.0 RC 26: SIZEOF of an FB (the layout the arena option needs).
  - What: skip replaced scalar VAR CONSTANTs; add 8 bytes per implemented interface.
  - Where: `lower/storage/bytes.ts`, over `core/chain.implementsOf`.
  - Accept: F(`mem_fb_var_constant_scalar` 16, `mem_fb_implements_one` 24, `mem_fb_implements_two` 32); `mem_fb_var_constant_non_replaced`
    and `mem_fb_var_constant_struct` stay confirmed; M.
  - Depends: 1.9.4.
- [ ] 4.1 Measure.
  - What: the census starting from `transpile-st-to-rust/pointer-model.md` (re-run parse-based, diffed against 2026-09-20): every
    `indirect` fixture, every not-lowered pointer/any/interface/call-fb-inout row (`scripts/probe-lowering-refusals.ts`), every pointer
    `rejects` fixture, each with its predicted verdict under (a) tags, (b) arena, (d) per-pointer enum. A spike of (a), (b), (d) on the
    ten fixtures of design.md §3.3. New recordings: `pointer_to_dword_roundtrip`, `pointer_order_compare`, `adr_difference_two_arrays`,
    `pointer_byte_walk_struct_padding`, `pointer_step_past_end`.
  - Where: this file (census table, spike numbers); fixtures in `test/conformance/fixtures/memory/`.
  - Accept: the census table here; recordings committed.
  - Depends: 4.0.
- [ ] 4.2 Design "§3.3 Decision: pointers".
  - What: the decision by fixtures, then Rust cost, then LOC; whether the three tag schemes unify (and why not, if not); which `staticKey`
    options become removable; the refused list by code; which transpile-st-to-rust pointer tasks it supersedes (update 0.8's list); the
    rewrite of architecture.md's "pointers will become indices" paragraph.
  - Where: `design.md`; `openspec/changes/transpile-st-to-rust/tasks.md`.
  - Accept: committed.
  - Depends: 4.1.
- [ ] 4.3 IR for the decision.
  - What: `ir/expr.ts` changes (reinterpret / load-bytes / store-bytes nodes if (b); an enum-handle node if (d)); `ir/walk.ts` extended.
  - Where: `ir/expr.ts`, `ir/walk.ts`, `walk.test.ts`.
  - Accept: G; `walk.test.ts` totality green.
  - Depends: 4.2.
- [ ] 4.4 Both backends implement the representation.
  - What: `semantics/memory.ts` (if (b)), `interp/frame.ts`, `emit/rust/runtime/pointer.ts`, `emit/rust/types.ts`; lowering in
    `pointers/state.ts`, `address.ts`, `deref.ts`, `store.ts`.
  - Where: those files.
  - Accept: every currently confirmed `indirect` fixture stays confirmed; S-out on all non-pointer fixtures; M.
  - Depends: 4.3.
- [ ] 4.5 One below the first element (RC 44).
  - Where: `lower/pointers/state.ts`, `address.ts`.
  - Accept: F(`tr_44_pointer_step_below_first_element`) (lowers; isNull = FALSE); M.
  - Depends: 4.4.
- [ ] 4.6 S=/R= through a multi-target pointer (RC 14).
  - What: the latch goes inside each arm of `storeThrough`; independent of the decision.
  - Where: `lower/pointers/deref.ts`.
  - Accept: F(`tr_14_set_reset_through_multi_target_pointer`); src test; M.
  - Depends: 1.9.4.
- [ ] 4.7 An FB copy keeps its ADR(own member) address (RC 15).
  - What: modelled (foreign target / arena / enum) or refused by name.
  - Where: `lower/pointers/state.ts`, `statements/assign.ts`.
  - Accept: F(`tr_15_fb_copy_keeps_pointer_address`), or its refusal code in the design's refused list and the fixture rated accordingly; M.
  - Depends: 4.4.
- [ ] 4.8 An FB copy carries its in-out binding (RC 16).
  - Where: `lower/calls/last-binding.ts`, `entry/finish.ts`.
  - Accept: F(`tr_16_fb_copy_carries_inout_binding`) (first = 11, second = 100; no `_ => panic` reached); src test in `last-binding.test.ts`; M.
  - Depends: 4.4.
- [ ] 4.9 ANY pValue and the pointer's type (RC 17).
  - What: reinterpret under (b), or a `pointer-type` refusal plus arm pruning by constant diSize under (a)/(d).
  - Where: `lower/pointers/any.ts`.
  - Accept: F(`tr_17_any_pvalue_dint_via_real`, `_byte_via_sint`, `_uint_via_int`, `_dint_write_via_byte`) or their named refusal;
    `state_any_int_pointer_increment` still lowers; M.
  - Depends: 4.4.
- [ ] 4.10 `__QUERYINTERFACE` into a global (RC 18).
  - What: compute the foreign edge as `storeInterface` does and model it (CODESYS accepts: r1 = r2 = 1).
  - Where: `lower/interfaces/query.ts`.
  - Accept: F(`tr_18_queryinterface_into_global`); M.
  - Depends: 4.4.
- [ ] 4.11 Routine outputs copied out after the call (RC 20).
  - Where: `lower/calls/outputs.ts`, `calls/binding.ts` (freeze loop).
  - Accept: F(`tr_20_output_index_moved_by_callee`) (arr[1] = arr2[1] = 5); src test; the LSP false positive stays in
    `KNOWN_DIVERGENCES.codesys` and is Filed; the transpile-st-to-rust VAR_OUTPUT task is ticked "superseded by 4.11"; M.
  - Depends: 1.9.4.
- [ ] 4.12 Fixtures the pointer model unblocks.
  - What: `tr_34_lib_prim_char_behind` (RC 34; u = 'abcBC', lenU = 5) and, if the decision supports reinterpretation,
    `tr_28_minmax_limit_nan_signed_zero_{real,lreal}` now lower.
  - Where: per 4.2.
  - Accept: F(`tr_34_lib_prim_char_behind`); `tr_28_*` lower (their values are 6.7's) or stay refused by the code 4.2 names.
  - Depends: 4.4, 3.6.
- [ ] 4.13 Appendix pointer items, each recorded first, then fixed or refused by name.
  - What: (a) a target set read while growing (`pointers/state.ts`); (b) a null source copied into a multi-target pointer
    (`pointers/store.ts`); (c) `0 = p` recognition (`expressions/operators.ts`); (d) `r.3` on a REFERENCE (`places/places.ts`); (e) an ANY
    input given a REFERENCE TO failing E0308 (`pointers/any.ts`); (f) a GVL FB never callable through an interface (`interfaces/lend.ts`
    `lendPlace`).
  - Where: as listed.
  - Accept: each has a fixture plus F or a named refusal; M.
  - Depends: 4.4.
- [ ] 4.14 The three tag schemes per 4.2.
  - What: merged into one scheme, or each kept with the reason 4.2 recorded, all numbering through `core/tags.ts`; the
    transpile-st-to-rust `instanceRelative` task resolved or left with a reason.
  - Where: `lower/pointers/state.ts`, `interfaces/tags.ts`, `calls/last-binding.ts`, `core/tags.ts`.
  - Accept: S-out; design.md P1's "Tag encodings" row states the final home.
  - Depends: 4.4.
- [ ] 4.15 Remove the `staticKey` named options 1.7.11 listed, where the model made them unnecessary; the rest carry a reason.
  - Where: `lower/places/path.ts` and callers.
  - Accept: S-out; no option without a written reason.
  - Depends: 4.14.
- [ ] 4.16 Model delta.
  - What: architecture.md "Places, not references" rewritten per 4.2; the refused list in docs; the map delta.
  - Where: `docs/architecture.md`; this file.
  - Accept: M.
  - Depends: 4.5-4.15.

## 5. Model 4: instance initialization (RC 22, 23, 24, 25; RC 30 closed upstream)

- [ ] 5.1 Measure.
  - What: record `init_extends_interleaving`, `init_struct_field_fb_init_scope`, `init_structured_after_fb_init` (or cite its existing
    recording), `init_gvl_program_slot_order`, `init_this_in_initializer`, `var_temp_dynamic_init_method`,
    `var_temp_dynamic_init_function`, and `var_temp_dynamic_aggregate_init` (a VAR_TEMP array and struct with a dynamic initializer).
  - Where: `test/conformance/fixtures/declarations/` and `oop/`; numbers here.
  - Accept: committed recordings.
  - Depends: 1.9.4.
- [ ] 5.2 Design "§3.4 Decision: initialization".
  - What: the one ordered walk, the static-versus-dynamic split, the VAR_TEMP reset form decided by `var_temp_dynamic_aggregate_init`,
    the lift of `init-reads-instance`, the IR doc corrections.
  - Where: `design.md`.
  - Accept: committed.
  - Depends: 5.1.
- [ ] 5.3 Element defaults (RC 25).
  - What: `types/defaults.typeDefault` covers enum (via `types/enums`), alias initializer, alias array and elements;
    `init/initial-values.ts` fills `IrInit` completely; `semantics/instantiate.ts` and `emit/rust/values.initOf` no longer call `typeZero`
    for an element.
  - Where: `types/defaults.ts`, `lower/init/initial-values.ts`, `semantics/instantiate.ts`, `emit/rust/values.ts`.
  - Accept: F(`array_element_type_default`); partial tails stay zero (r_alias_part2 = 0); G+LSP; M.
  - Depends: 5.2.
- [ ] 5.4 RC 30 verified in the new home; the free `initOf` folded in.
  - What: RC 30 was fixed upstream (e06405f97c: `fresh` prints the init-aware `initOf`). The free `initOf(t, IrValue)` becomes a case of
    the one `initOf(t, IrInit)`.
  - Where: `emit/rust/values.ts`, `expr.ts`.
  - Accept: `decl_temp_array_init_resets`, `decl_temp_struct_init_resets` stay confirmed, edge agree; S-out; one `initOf` left (grep).
  - Depends: 5.3.
- [ ] 5.5 A dynamic VAR_TEMP initializer runs on every call (RC 24).
  - Where: `lower/init/temp-resets.ts`, per 5.2's form.
  - Accept: F(`var_temp_dynamic_init`, `var_temp_dynamic_init_method`, `_function`, `var_temp_dynamic_aggregate_init`); M.
  - Depends: 5.4.
- [ ] 5.6 Field initializers before FB_Init (RC 22).
  - Where: `lower/init/step.ts`, `init/instance-init.ts`.
  - Accept: F(`tr_22_fb_init_reads_adr_field`, `tr_22_fb_init_reads_call_field`); `tr_22_fb_init_reads_this_field` passes if 5.2 lifts THIS,
    else stays not-lowered with its reason written here; the EXTENDS order per `init_extends_interleaving`; M.
  - Depends: 5.2.
- [ ] 5.7 Declaration-ordered interleaving (RC 23).
  - Where: `lower/init/step.ts`, `init/sequence.ts`, `init/fb-init.ts`.
  - Accept: F(`tr_23_fb_init_argument_from_pending_init` got = 4, `tr_23_fb_init_argument_from_pending_init_reversed` got = 0);
    `init-reads-instance` lifted where legal; `initseq_*` fixtures stay confirmed; M.
  - Depends: 5.6.
- [ ] 5.8 Appendix init items.
  - What: the scope of a STRUCT field's FB_Init arguments (per `init_struct_field_fb_init_scope`); `insideInstance` refusing
    `holder.started` while allowing `holder.Get()`, made consistent.
  - Where: `lower/init/fb-init.ts`, `init/sequence.ts`, `places/path.ts`.
  - Accept: fixtures plus F or a named refusal.
  - Depends: 5.7.
- [ ] 5.9 The init-sequence read walk no longer skips `select` and freezes (appendix).
  - What: drop the skip option kept in 1.7.4.
  - Where: `ir/walk.ts`, `lower/init/sequence.ts`.
  - Accept: a src test with a select or freeze read in an initializer; S-out.
  - Depends: 5.7.
- [ ] 5.10 Model delta.
  - What: `ir/program.ts` docs (`IrPou.init`, `IrFresh`) corrected; architecture.md initialization paragraph; the map delta.
  - Where: `ir/program.ts`, `docs/architecture.md`; this file.
  - Accept: M.
  - Depends: 5.3-5.9.

## 6. Remaining open root causes (one task each, in the new structure)

Each task: a src test red first, the fix, then F and M. A RC closed upstream or by frontend-conformance (0.1) becomes "verify in the
new home": its test and fixture stay green, nothing else. RC 26 is task 4.0; RC 30 is task 5.4.

- [ ] 6.1 RC 2.3: a CONSTANT reference lowers to its folded value.
  - Where: `lower/places/names.ts`, `values/fold.ts`, `types/const/fold.ts` (`asConstant`).
  - Accept: F(`named_const_expression_keeps`) (d2 = 128 and e = 258 read); `named_const_literal_wrap` stays confirmed; G+LSP.
  - Depends: 1.9.4.
- [ ] 6.2 RC 6: an out-of-range literal keeps its own type.
  - Where: `types/literal.ts` `contextLiteralType` (range rule), `values/convert.adopt`, `values/promote.meet`.
  - Accept: F(`tr_6_literal_beyond_dint_neighbour`) (gNegLint TRUE, sumNegLint -2999999995, sumUdLint 5000000005, …);
    `cc_literal_3e9_into_dint` stays confirmed; G+LSP.
  - Depends: 1.9.4.
- [ ] 6.3 RC 12: LDT/LDATE/LTOD → STRING.
  - Where: `semantics/text.ts` + `text.cases.ts` (the 11 recorded cells, incl. the wrap past 2262), `runtime/text.ts`, `emit/rust/convert.ts`,
    `types/predicates.hasTextFormat` for the gate in `builtins/conversions.ts`.
  - Accept: F(`tr_12_fmt_long_dates`) (the Rust compiles); twin test green.
  - Depends: 1.9.4.
- [ ] 6.4 RC 19: a METHOD's in-out shadows a field or VAR_STAT.
  - Where: `lower/places/names.ts`.
  - Accept: F(`tr_19_method_inout_shadows_member`, `tr_19_method_inout_shadows_var_stat`) (res = v = 101).
  - Depends: 1.9.4.
- [ ] 6.5 RC 21: a FUNCTION keyed and scoped by symbol identity.
  - What: bare calls use `symbols/precedence.pickForAsker`; `resolveNamedType` requires an asker, its callers (entry/lower-unit,
    places/globals, storage/layout, storage/bytes, types/infer `enumValueType` — appendix) pass one.
  - Where: `lower/calls/variants.ts`, `calls/namespace.ts`, `types/resolve.ts`.
  - Accept: F(`tr_21_namespace_qualified_first`, `tr_21_namespace_bare_first`) (a = 1020, b = 3); G+LSP.
  - Depends: 1.9.4.
- [ ] 6.7 RC 28: MAX/MIN/LIMIT on REAL.
  - What: compare-select `IF a>b THEN a ELSE b` (MIN: `a<b`), LIMIT = MIN(MAX(mn, in), mx).
  - Where: `ir/expr.ts` contract, `semantics/builtins.ts` + `numeric.cases.ts`, `emit/rust/builtins.ts`.
  - Accept: `semantics/builtins.test.ts` on the recorded NaN and ±0 cells; twin test; F(`tr_28_minmax_limit_nan_signed_zero_{real,lreal}`)
    once 4.12 lowers them.
  - Depends: 1.9.4, 4.12.
- [ ] 6.8 RC 29 verified in the new home.
  - What: closed upstream (3dd773b9d7): `RESERVED_FN_NAMES` (new, call, scan, clone, to_owned, clone_into, into, try_into) in `names.ts`.
  - Where: `emit/rust/names.ts`, `names.test.ts`.
  - Accept: all eight `tr_29_method_named_{clone,to_owned,into,try_into}_{result,no_result}` stay confirmed, edge agree.
  - Depends: 1.9.4.
- [ ] 6.9 RC 31: BIT conversions decide bool-ness via `isBoolValued`.
  - Where: `emit/rust/convert.ts`.
  - Accept: F(`tr_31_bit_conversions`) (compiles; 'TRUE'; INT_TO_BIT(2) = TRUE).
  - Depends: 1.9.4.
- [ ] 6.10 RC 32: `iec_ltime_text(ns: u64)`, no `i64` cast for LTIME (the LDT/LDATE `as i64` stays, per RC 12).
  - Where: `runtime/text.ts`, `emit/rust/convert.ts`.
  - Accept: F(`tr_32_fmt_ltime_past_i64`); twin test.
  - Depends: 6.3.
- [ ] 6.11 RC 33: LREAL_TO_STRING rounds a tie half-up (17 exact digits).
  - Where: `runtime/text.ts`; the cells in `text.cases.ts`.
  - Accept: F(`tr_33_fmt_lreal_tie`); twin test.
  - Depends: 1.9.4.
- [ ] 6.12 RC 37: CASE labels out of type or inverted are refused (CODESYS refuses all four).
  - Where: `lower/statements/case.ts`.
  - Accept: `tr_37_case_label_wraps_300`, `_wraps_minus_212`, `tr_37_case_range_inverted`, `_beyond_type` refused by the transpiler; the
    LSP half Filed (`MEASURED_SILENT` stays until then).
  - Depends: 1.9.4.
- [ ] 6.13 RC 38: implicit STRING↔WSTRING and non-string→STRING refused via `types/compat.classifyConversion`.
  - What: stores, chain links, stores through a REFERENCE (appendix), arguments and compares; LEN(WSTRING) (appendix).
  - Where: `lower/statements/assign.ts`, `expressions/operators.ts`, `calls/outputs.ts`, `calls/binding.ts`.
  - Accept: `string_wstring_mixing` and `uop_*` refused (rows lose tier and rust; the `uop_neg_real` edge disagreement gone);
    `standard_len_wstring_rejected` refused; any LSP half Filed; M.
  - Depends: 1.9.4.
- [ ] 6.14 RC 40: DATE/DT/TOD ± LTIME is refused.
  - Where: `types/arith/temporal.ts`, `lower/expressions/calendar.ts`.
  - Accept: `tr_40_date_plus_ltime`, `tr_40_dt_plus_ltime`, `tr_40_tod_minus_ltime`, `tr_40_ltime_plus_date` refused by the transpiler and the
    LSP (the lsp-gap closes); G+LSP.
  - Depends: 1.9.4.
- [ ] 6.15 RC 41: MUX/SEL evaluate only the selected input; LIMIT follows the recorded order.
  - Where: `ir/expr.ts` (evaluation contract per builtin), `semantics/builtins.ts`, `lower/builtins/value-functions.ts`, `emit/rust/builtins.ts`.
  - Accept: F(`tr_41_mux_side_effects`, `tr_41_sel_side_effects`, `tr_41_limit_evaluation_order`) (x = 4); both edge disagreements gone.
  - Depends: 1.9.4.
- [ ] 6.16 RC 42: `typeKey` keys arrays by element plus bounds, recursively.
  - Where: `lower/calls/variants.ts`.
  - Accept: F(`tr_42_any_array_variant_key`) (the Rust compiles).
  - Depends: 1.9.4.
- [ ] 6.17 RC 43: output bindings use `isAssignable`, on both paths.
  - Where: `lower/calls/outputs.ts`.
  - Accept: F(`tr_43_output_word_to_int` a = -1, `_word_to_udint` 65535, `_int_to_real` -3.0); `tr_43_output_dint_to_int` refused.
  - Depends: 4.11.
- [ ] 6.18 RC 46: EXPT.
  - What: a correctly rounded pow with C semantics for the edge cells, and a stop on 0 ** finite-negative in both backends. Measure first
    whether `1e19**8` needs an exact integer-exponent path.
  - Where: `semantics/math.ts` + `numeric.cases.ts`, `ir/faults.ts` (`exptDomain`), `runtime/numeric.ts` `iec_expt`, `emit/rust/builtins.ts`.
  - Accept: F(the seven diverging `tr_46_exptdom_*`); `_nan_pow_zero` and `_zero_pow_minus_inf` stay confirmed; `op_math_expt` and
    `expt_mixed_width` edge ULP agreement; twin test.
  - Depends: 1.9.4.
- [ ] 6.19 RC 47: int→REAL rounds once (the bigint rounded to 24 bits with a sticky bit).
  - Where: `semantics/convert.ts` `toReal`; the cell in `numeric.cases.ts`.
  - Accept: F(`tr_47_i2r_lint_to_real_double_round`); the edge disagreement gone.
  - Depends: 1.9.4.
- [ ] 6.20 RC 48: the vendor oracle only for discriminating recordings.
  - What: rate all-default recordings `compiles` (exempting `prim_default_*`), or give the `cc_` fixtures discriminating initializers and
    re-record — choose, and write the reason here. Also closes the appendix line "UDINT op DINT fixtures run only on zeros".
  - Where: `test/conformance/support/transpile/correctness.ts`, `fixtures/batches/check-coverage.ts`.
  - Accept: M (the 158 affected rows move as chosen).
  - Depends: 1.8.4.
- [ ] 6.21 The trig vendor-routine divergences stay named (design.md §7.2).
  - What: `op_math_trig`, `mathdom_sin_large`, `mathdom_cos_large` keep their expected-failure marks, each with the x87 argument-reduction
    reason in `support/divergences.ts` and a pointer to `semantics/math.ts`.
  - Where: `test/conformance/support/divergences.ts`, `semantics/math.ts`.
  - Accept: G; the three marks carry the reason; 8.2 counts them as accepted.
  - Depends: 1.9.4.

### 6.A Appendix A and B items (LOW, unverified: record first, then fix, refuse, or close with the recording as the reason)

- [ ] 6.A.1 LTIME_TO_TIME / LDT_TO_DT sub-unit truncation.
  - Where: `lower/builtins/conversions.ts`.
  - Accept: recording plus F or close.
  - Depends: 1.9.4.
- [ ] 6.A.2 REAL intermediates rounded per step (`real-overflow.ts`).
  - Where: `semantics/arith.ts`.
  - Accept: recording plus F or close.
  - Depends: 1.9.4.
- [ ] 6.A.3 MIN MOD -1 (live run; Appendix B mod-min-by-minus-one).
  - Where: `semantics/arith.ts`, `runtime/numeric.ts`.
  - Accept: recording plus F or close; the answer written here (7.3.13 reads it).
  - Depends: 1.9.4.
- [ ] 6.A.4 SHL/SHR/ROL counts through BigInt.
  - Where: `semantics/builtins.ts`.
  - Accept: a src test with a count above 2^53; S-out.
  - Depends: 1.9.4.
- [ ] 6.A.5 `x := F(o => x)`: which write wins.
  - Where: `lower/calls/outputs.ts`.
  - Accept: recording plus F.
  - Depends: 4.11.
- [ ] 6.A.6 Const-generic in-out names colliding (`<x>_<n>`).
  - Where: `emit/rust/names.ts`.
  - Accept: a src test plus a fix.
  - Depends: 1.9.4.
- [ ] 6.A.8 Exact refusal codes contradicting their prefix families.
  - Where: `lower/diagnostics/codes.ts`.
  - Accept: `codes.test.ts` asserts each code's kind agrees with its prefix or carries a written reason.
  - Depends: 1.2.2.
- [ ] 6.A.9 `constantValue` swallows non-LoweringBug throws.
  - Where: `semantics/fold.ts`.
  - Accept: a src test; S-out.
  - Depends: 1.3.3.
- [ ] 6.A.10 STRING_TO_<int> of '16#FF' / '2#101' / 'INT#5'.
  - Where: `semantics/parse.ts`, `runtime/parse.ts`.
  - Accept: recording plus F; twin cells.
  - Depends: 3.5.
- [ ] 6.A.11 `overridesCalled` resolves SUPER^.M() against the frame.
  - Where: `lower/core/ast-walk.ts`, `calls/super.ts`.
  - Accept: a src test plus F.
  - Depends: 1.9.4.
- [ ] 6.A.12 A bare METHOD call with an unconnected VAR_OUTPUT in an FB body.
  - Where: `lower/calls/invoke.ts`.
  - Accept: recording plus F.
  - Depends: 4.11.
- [ ] 6.A.13 The stale `calledLayout` doc about VAR_TEMP.
  - Where: `lower/calls/routines.ts`.
  - Accept: doc fixed.
  - Depends: 1.6.18.
- [ ] 6.A.14 SHL/SHR of an untyped literal into a 64-bit destination.
  - Where: `lower/builtins/value-functions.ts`.
  - Accept: recording plus F.
  - Depends: 1.9.4.
- [ ] 6.A.15 A huge repeat count builds every leaf before the size check.
  - Where: `lower/init/initial-values.ts`.
  - Accept: a src test (check first); S-out.
  - Depends: 1.9.4.
- [ ] 6.A.16 An X address bit index above 7.
  - Where: `lower/storage/addresses.ts`.
  - Accept: recording plus refusal.
  - Depends: 1.9.4.
- [ ] 6.A.17 GVL1.x / GVL2.x sharing one slot.
  - Where: `lower/places/globals.ts`.
  - Accept: a src test plus a fix.
  - Depends: 1.9.4.
- [ ] 6.A.18 Uniform write guards.
  - What: every store applies the full `guardWrite` set, removing the per-site lists of 1.7.5; the differences recorded first.
  - Where: `lower/places/access-guards.ts`.
  - Accept: a src test per store kind; M.
  - Depends: 1.7.5, 1.9.4.
- [ ] 6.A.19 An FB body call stores its inputs before binding its in-outs.
  - Where: `lower/calls/fb-call.ts`.
  - Accept: recording plus F.
  - Depends: 1.9.4.
- [ ] 6.A.20 The const fold accepts `**`, `&` and REAL MOD.
  - What: remove them; `const/fold.test.ts` drops the `**` case (its premise is contradicted by the input contract).
  - Where: `types/const/fold.ts`.
  - Accept: G+LSP (or verified closed by frontend-conformance).
  - Depends: 1.9.4.
- [ ] 6.A.21 REAL_MAX_MAGNITUDE below f32::MAX, and the second constant in infer.
  - Where: `types/elementary.ts`, `types/infer/*`.
  - Accept: G+LSP; one constant.
  - Depends: 1.9.4.
- [ ] 6.A.22 Inferred STRING(N)/ARRAY[1..N] folded in project scope.
  - Where: `types/infer/expr.ts`.
  - Accept: G+LSP.
  - Depends: 1.1.13.
- [ ] 6.A.23 A negated or parenthesised real literal in SIN/SQRT infers UNKNOWN.
  - Where: `types/infer/expr.ts`, `types/literal.ts`.
  - Accept: G+LSP.
  - Depends: 1.1.13.
- [ ] 6.A.24 Member access does not walk EXTENDS.
  - Where: `types/infer/member.ts` on `lookupMember` / `extendsChain`.
  - Accept: G+LSP.
  - Depends: 1.1.13.
- [ ] 6.A.25 Subrange bounds dropped.
  - Where: `types/resolve.ts`.
  - Accept: recording (`a : INT(3..9)`), then refuse the subrange by name or model it; G+LSP.
  - Depends: 1.9.4.
- [ ] 6.A.26 Qualified `Lib.T` resolved by its bare name.
  - Where: `types/resolve.ts` (qualifiers).
  - Accept: G+LSP.
  - Depends: 6.5.
- [ ] 6.A.27 Unsigned counter with a negative constant step.
  - Where: `lower/statements/loops.ts`.
  - Accept: absorbed by 2.4; closed with a reference to it.
  - Depends: 2.4.
- [ ] 6.A.28 An unbound FB VAR_IN_OUT from a METHOD panics with the "interface" message.
  - Where: `ir/faults.ts` (its own kind), `lower/calls/last-binding.ts`, both backends.
  - Accept: a src test; both backends print the new message.
  - Depends: 1.2.4, 1.9.4.
- [ ] 6.A.29 A named DINT/LINT constant folds unbounded in an initializer but wraps at run time (`const-eval.ts:172`, Appendix A grouped).
  - What: record the case (a CONSTANT whose initializer overflows its declared width, used in another initializer and read at run time);
    fold it at its declared width in the initializer too, or close with the recording.
  - Where: `types/const/fold.ts`, `lower/values/fold.ts`.
  - Accept: recording plus F or close; G+LSP.
  - Depends: 6.1.
- [ ] 6.A.30 Appendix B rotate-in-promoted-width (an ANY-argument ordering bug, no recording).
  - What: record a live case (ROL/ROR with an ANY argument whose evaluation order matters); fix or close with the recording.
  - Where: `lower/builtins/value-functions.ts`, `semantics/builtins.ts`.
  - Accept: recording plus F or close.
  - Depends: 1.9.4.

(6.A.7, runtime helpers colliding with a user FUNCTION, needs the registry of 7.1.2 and is task 7.1.5.)

### 6.B Leftovers of the neutral consolidations (every parameter phase 1 kept has a removal task)

- [ ] 6.B.1 BIT-is-BOOL: the sites 1.1.5 did not switch.
  - What: each listed site uses `isBoolValued`, or keeps its own test with a written reason; RC 31's emitter site is 6.9.
  - Where: the sites listed under 1.1.5.
  - Accept: S-out; a grep finds no hand-written BIT/BOOL test outside `types/predicates.ts` without a reason.
  - Depends: 6.9.
- [ ] 6.B.2 The integer wrap: remove the per-caller family guards 1.1.6 listed.
  - What: `wrapToWidth` callers go through one `storeInteger(value, type)` rule, or keep a guard with a written reason.
  - Where: `types/width.ts`, `types/const/fold.ts`, `lower/values/convert.ts`, `semantics/store.ts`.
  - Accept: S-out; G+LSP.
  - Depends: 1.9.4.
- [ ] 6.B.3 EXTENDS: remove the documented parameters 1.7.3 listed.
  - What: each site uses the default chain, or the parameter stays with the recorded fixture that needs it.
  - Where: `lower/core/chain.ts` and its callers.
  - Accept: S-out.
  - Depends: 1.9.4.
- [ ] 6.B.4 Lowering's parameter view delegates to `types/infer/callee`.
  - What: for every difference 1.7.18 wrote down, either the two agree (lowering delegates) or the difference is a recorded CODESYS fact
    and stays with its reason.
  - Where: `lower/calls/parameters.ts`, `types/infer/callee.ts`.
  - Accept: S-out; G+LSP; the differential test of 1.7.18 reports only reasoned differences.
  - Depends: 1.9.4.

## 7. Lean groups (same program output, less Rust: every step S-out + M)

Each sub-task names its notes, deleted from the authored table when resolved. The counts come from 0.6's tags; the keyword
pre-classification gave group 1 ≈ 11 notes / 576 rows, 2 ≈ 179/5178, 3 ≈ 129/751, 4 ≈ 135/1404, 5 ≈ 38/1201, 6 ≈ 62/391, 7 ≈ 86/575,
8 ≈ 29/186, 9 ≈ 72/549.

### 7.10 Transpiler source cleanup (leftovers after 1.7)

- [ ] 7.10.1 Verify lean 10.1 (EXTENDS, holdsFbInit/reaches), 10.3 (convertValue) and 10.4 (every orphan doc named in the maps,
  incl. infer.ts:258 deleted by 1.1.13) are dissolved.
  - Where: `src/transpile/**`, `src/types/**`.
  - Accept: a grep list is empty.
  - Depends: 1.9.4.
- [ ] 7.10.2 One typed const fold (lean 10.2).
  - What: `foldBigInt` and `foldNumber` merge into one width-carrying fold, sharing the identifier resolver between `constancyOf` and `fold`.
  - Where: `types/const/fold.ts`, `types/const/constancy.ts`.
  - Accept: G+LSP; S-out; `fold-agreement.test.ts` unchanged or better.
  - Depends: 6.1, 6.A.20, 6.A.29.
- [ ] 7.10.3 The `transpile/index.ts` doc carries the rule only (no numbers or taxonomy copy); `emit/rust/index.ts`'s temp list is
  generated from `names.ts` purposes.
  - Where: `transpile/index.ts`, `emit/rust/index.ts`, `names.ts`.
  - Accept: G.
  - Depends: 1.9.4.
- [ ] 7.10.4 `dead-exports.ts --scope src/transpile` (filtered, design.md §8) finds nothing.
  - Where: `src/transpile/**`.
  - Accept: G; empty list.
  - Depends: 7.10.1.

### 7.1 Prelude on demand (lean 1; dead_code 5658, uninlined_format_args 4192, format_push_string 1048, many_single_char_names 527)

- [ ] 7.1.1 The registry has real dependencies.
  - What: the IecStr core, each `iec_*_text`, `iec_parse_*` and `iec_max/min` become separate entries with `deps`.
  - Where: `emit/rust/runtime/index.ts`, `runtime/*.ts`.
  - Accept: G, S (still today's gating).
  - Depends: 1.5.11.
- [ ] 7.1.2 The printer records `use(id)`; `module.ts` appends the dependency closure; the `code.includes` sniffing (six sites) is deleted.
  - Where: `emit/rust/printer.ts`, `module.ts`, `runtime/index.ts`.
  - Accept: S-out; M (dead_code excused count falls; the target is 0 excused by runtime code).
  - Depends: 7.1.1.
- [ ] 7.1.3 ALLOWED `dead_code`: its reason narrowed to "fixture variables", its excused count recorded.
  - Where: `test/conformance/support/transpile/lint-policy.ts`.
  - Accept: M.
  - Depends: 7.1.2.
- [ ] 7.1.4 Redefine the map's `size`.
  - What: "emitted Rust lines per ST line, runtime-registry lines not counted" (design.md §8); re-baseline in this commit with the old and
    new median both written here; every later size delta uses the new definition.
  - Where: `test/conformance/support/transpile/row.ts` (size), `scripts/rate-fixtures.ts`, the map header text.
  - Accept: M (only `size` values and the header definition change; both medians recorded).
  - Depends: 7.1.2.
- [ ] 7.1.5 Runtime helpers colliding with a user FUNCTION (`iec_div`, …; Appendix A, was 6.A.7).
  - What: reserve the registry's ids in `names.ts` (a user FUNCTION named like a helper gets a suffixed fn) or namespace the helpers.
  - Where: `emit/rust/names.ts`, `runtime/index.ts`.
  - Accept: a src test with a user FUNCTION `iec_div` plus a fix; S-out.
  - Depends: 7.1.2.

### 7.9 Prelude helpers (lean 9)

- [ ] 7.9.1 `iec_r2i64/32`: `let c = v.round();`, the NaN and ≥2^63 returns merged, the redundant `is_nan()` in `contains` dropped.
  - Notes: 02a72c2e83, 693c14b0bd, b7286c7932, de283d0ef6, 0ab1e9c511, 5383e1c9ac, 6f8ef8f0bd, f44fb59407, fe6af35845, c5844eabe9.
  - Where: `emit/rust/runtime/numeric.ts`.
  - Accept: twin test on `numeric.cases.ts` (the 192 cells of 1.3.8); S-out; M.
  - Depends: 7.1.2, 1.5.15.
- [ ] 7.9.2 An `iec_trunc_i32` helper replaces the TRUNC inlined 38 times.
  - Where: `runtime/numeric.ts`, `emit/rust/builtins.ts`.
  - Accept: twin test, S-out, M.
  - Depends: 7.1.2.
- [ ] 7.9.3 `iec_deref` as `assert!`/`assert_ne!` (note dd94ff18a2); one guard per statement for a single-target pointer (notes
  01ef1b756d, e496034f7b, 1fa78ccf62).
  - Where: `runtime/pointer.ts`, `emit/rust/printer.ts` guards.
  - Accept: S-out, M.
  - Depends: 7.1.2, 4.16.
- [ ] 7.9.4 `iec_*_text` write into IecStr with no String allocation (clears `uninlined_format_args`, `format_push_string` in the runtime).
  - Where: `runtime/text.ts`, `emit/rust/convert.ts`.
  - Accept: twin test on `text.cases.ts`, S-out, M.
  - Depends: 6.3, 6.10, 6.11, 3.5.
- [ ] 7.9.5 Runtime lint hygiene: `many_single_char_names`, `return_self_not_must_use`, `bool_to_int_with_if`, `must_use` on the IecStr methods.
  - Where: `emit/rust/runtime/*.ts`.
  - Accept: M (pedantic count attributed to runtime reaches 0).
  - Depends: 7.9.4.

### 7.2 Constants folded in lowering, in one place (lean 2)

- [ ] 7.2.1 Negation of a constant folds to a typed literal (lean 2.1): done by RC 7; verify and delete the remaining notes.
  - Where: `lower/expressions/operators.ts`.
  - Accept: M (notes deleted).
  - Depends: 0.6.
- [ ] 7.2.2 An all-constant integer or real expression prints as its folded literal.
  - Notes: 63d29bd1a0, 57a8f5a4c8, 09eeda28bb, 24588decbd, 58988cbee9.
  - Where: `lower/values/fold.ts` via `semantics/fold`; `expressions/operators.ts`.
  - Accept: S-out, M.
  - Depends: 6.2.
- [ ] 7.2.3 A constant array index prints as a usize literal, the lower bound subtracted at lowering; the index offset printed one way.
  - Notes: 3d737b5821, 7886e7bd17, 03b3e8b80c, 2506fd8442, 4e213fd264, 6a2b5f2826, eb533b340b; 5dcbae07c6, 7918d10820, d8a5dd49a9.
  - Where: `lower/places/places.ts`, `emit/rust/place.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
- [ ] 7.2.4 Constant ADR tags and constant cursor or pointer offsets fold.
  - Notes: 41d2232599, 0c7c4434c4.
  - Where: `lower/pointers/address.ts`, `pointers/cursor.ts`.
  - Accept: S-out, M.
  - Depends: 4.16, 7.2.2.
- [ ] 7.2.5 A constant shift or rotate count prints bare; partial access skips `>> 0` (lean 2.4).
  - Notes: 346e81a0f2, 5228723708, de956f2a12, fdfbae2680.
  - Where: `lower/builtins/value-functions.ts`, `expressions/partial-access.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
- [ ] 7.2.6 MOD and real `/` by a nonzero constant other than -1 print plain `%` and `/` (lean 2.5), decided in lowering (an IR flag
  "divisor proven nonzero").
  - Notes: 015dcb3b7f, 054b93382f, c7f76e08cf, 61a75e7b4b, 32a9e6d2e3, 49387a9ebf, 7812f5a53d.
  - Where: `lower/expressions/operators.ts`, `ir/expr.ts`, `emit/rust/expr.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
- [ ] 7.2.7 Fold MAX, MIN, LIMIT, SEL and MUX of all-constant arguments, and TRUNC of a constant; literal arms typed at the result type (lean 2.6).
  - Notes: 7402369985, 779b38c9e9, 8cd84736a1, 96b55e688b, ef06033fe1.
  - Where: `lower/builtins/value-functions.ts`.
  - Accept: S-out, M (`unnecessary_min_or_max` falls).
  - Depends: 6.15, 6.7.
- [ ] 7.2.8 No literal suffix at typed positions (field initializers, `Self {}`).
  - Notes: 1707972c33, 06bb3a6005, e8954e2b0d, 90c445f7cb, 870b70e195, afa5d14dd9, a29db6178b.
  - Where: `emit/rust/values.ts`, `structs.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
- [ ] 7.2.9 Negative-literal parentheses only at receiver positions.
  - Notes: 65df8e0418, ec9a760059, b501abe431, 159ca60812, 12e93440b3, c35f240db9, 6f9ae8fd3a, 5c40a4e5a8, 682fffc71e.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
- [ ] 7.2.10 A constant cast prints as a typed literal (`castTo` of a const).
  - Notes: 14a38342eb, 9d8cd15435, 9fb47c3123.
  - Where: `emit/rust/convert.ts`, `values.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.2.
- [ ] 7.2.11 Digit separators for large literals (`unreadable_literal` 3681 minus the loop-cap share).
  - Notes: 4bf3f61062, 093ad5cc7a.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 2.3.
- [ ] 7.2.12 An f32 literal printed from its rounded value.
  - Notes: 74845f98c6.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 1.9.4.
- [ ] 7.2.13 Delete the `keep` notes attached to group-2 constructs (1307e33bbf, 6a98109119, a497507b30, 1d7709a031, 4a6baf16b3,
  687428cc81, 496b8acb56, as tagged in 0.6).
  - Where: `support/notes/notes.data.ts`.
  - Accept: M (the notes are gone; 7.11.1's count falls by the same number).
  - Depends: 0.6.
- [ ] 7.2.14 A runtime array index without the `(i as i64) as usize` hop.
  - What: the index is converted once from its own type to `usize` after the lower-bound subtraction in its own width, where the value
    range allows it (lowering decides; the interpreter unchanged).
  - Notes: the 7 runtime-index notes tagged here by 0.6.
  - Where: `lower/places/places.ts`, `emit/rust/place.ts`.
  - Accept: S-out, M.
  - Depends: 7.2.3.

### 7.3 One emission per construct: narrow arithmetic and precedence (lean 3; cast_possible_truncation 5666, cast_sign_loss 4361, cast_lossless 4359)

- [ ] 7.3.1 The narrow-arithmetic rule in lowering.
  - What: add, sub, mul, neg, and, or, xor, min and max on T-typed operands stored straight back into T are lowered as a narrow T node
    (value-identical: truncation is a ring homomorphism); the interpreter runs the same node. DIV/MOD, mixed-sign meets, shifts and wider
    stores stay promoted (lean 3.5).
  - Notes: 0153115496, 4979768984, 4c9f4e33f4, 964296462a, 7ef1346b85, c9cd63632c, e6ef5a4585, 7c881bc819, 41d2269c05, 8ccaa880cd,
    2ea589a8a1, 4fb4aff790, 6713eb5cc0, 6b14b17ba7, 8d8ff2c804.
  - Where: `lower/values/promote.ts`.
  - Accept: S-out; the edge differential identical over every arith fixture; M.
  - Depends: 7.2.2, 1.9.4.
- [ ] 7.3.2 The FOR step and the body statement print the same construct one way.
  - Notes: 4979768984, 46c17ef7d3.
  - Where: `lower/statements/loops.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.1, 2.4.
- [ ] 7.3.3 Same-typed comparisons (or a literal that fits) compare in the operands' own type.
  - Notes: beb0779c8f.
  - Where: `lower/values/promote.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.1.
- [ ] 7.3.4 ABS of an unsigned operand is the identity.
  - Notes: 6a41bda0a0.
  - Where: `lower/builtins/value-functions.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.1.
- [ ] 7.3.5 A lossless widening prints `T::from(x)`; `as` only for truncating or reinterpreting casts.
  - Notes: 181d22eae0, 3aa4ff5b30, 638ea949bb, 8b69355dc1, 76275cc107.
  - Where: `emit/rust/convert.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.1.
- [ ] 7.3.6 REAL SQRT in f32 (proven identical).
  - Notes: c2d750a62a, 428230e030.
  - Where: `emit/rust/builtins.ts`.
  - Accept: twin cells plus S-out.
  - Depends: 1.9.4.
- [ ] 7.3.7 REAL MAX/MIN with an untyped real literal needs no f64 round-trip.
  - Notes: 5c9bb13706.
  - Where: `lower/builtins/value-functions.ts`.
  - Accept: S-out, M.
  - Depends: 6.7.
- [ ] 7.3.8 A precedence-aware printer: delete `unparen`/`unparenHead` and the literal-paren special case.
  - Notes: b7bf67b59d, c8ac3c10c1, f474d0ca12.
  - Where: `emit/rust/expr.ts`, new `emit/rust/precedence.ts`.
  - Accept: S-out, M.
  - Depends: 1.9.4.
- [ ] 7.3.9 Cast-chain simplification (u16→i32→u16).
  - Notes: e9a5cabd36.
  - Where: `lower/values/convert.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.1.
- [ ] 7.3.10 TIME/DATE→LTIME widening multiplies without wrapping.
  - Notes: 6b4f1bb990, c2729b1a2a.
  - Where: `lower/builtins/conversions.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.1.
- [ ] 7.3.11 Keep promotion where it is needed: guard tests pin DIV (MIN/-1 measured), mixed sign, shifts and wider stores as promoted.
  - Where: `lower/values/promote.test.ts`.
  - Accept: G.
  - Depends: 7.3.1.
- [ ] 7.3.12 REAL math other than SQRT in f32, where proven.
  - What: for each of EXP, LN, LOG, SIN, COS, TAN, ASIN, ACOS, ATAN on REAL, measure over the recorded cells and the edge inputs whether
    the f32 function gives the value the f64 round-trip gives; switch only those proven identical, and tag the rest `keep:<measured
    difference>`.
  - Notes: the 5 "`(x as f64).exp() as f32`" notes tagged here by 0.6.
  - Where: `emit/rust/builtins.ts`, `numeric.cases.ts`.
  - Accept: twin cells per switched function; S-out; M.
  - Depends: 7.3.6.
- [ ] 7.3.13 MOD on narrow types.
  - What: from 6.A.3's recording: if CODESYS's MIN MOD -1 is 0 and nothing else overflows, MOD joins the narrow rule; otherwise the notes
    are tagged `keep:<6.A.3's answer>`.
  - Notes: the narrow-MOD notes tagged here by 0.6.
  - Where: `lower/values/promote.ts`.
  - Accept: S-out; M.
  - Depends: 7.3.1, 6.A.3.

### 7.5 Loop shape (lean 5, on model 1)

- [ ] 7.5.1 The counter lines are gone with the cap.
  - Notes: 02b031c773, 5ba97e5557, d9d57311e3, 6bf6856d37.
  - Where: `emit/rust/loops.ts`.
  - Accept: M (notes deleted, verified).
  - Depends: 2.3.
- [ ] 7.5.2 Labels and body blocks from `ir/walk.loopUses`: drop the body block without CONTINUE and the label without a labelled EXIT.
  - Notes: 521ba042ac, 1ad1ab3163, 93a17fab28, 204a887600.
  - Where: `emit/rust/loops.ts`.
  - Accept: S-out, M.
  - Depends: 2.8.
- [ ] 7.5.3 WHILE uses `continue 'loop`.
  - Notes: 95094bd48a.
  - Where: `emit/rust/loops.ts`.
  - Accept: S-out, M.
  - Depends: 7.5.2.
- [ ] 7.5.4 `while cond {}` and `for`-style forms where 2.1's type-max measurement allows them.
  - Notes: 1d1551a034, de2f16610e, 50226e2c19, e798927653.
  - Where: `emit/rust/loops.ts`.
  - Accept: S-out, M.
  - Depends: 7.5.2, 2.1.
- [ ] 7.5.5 ELSIF prints as `else if` (collapsible_else_if 19).
  - Where: `emit/rust/stmt.ts`.
  - Accept: S-out, M.
  - Depends: 1.9.4.
- [ ] 7.5.6 `&&`/`||` when neither operand holds a call (lowering marks it in the IR).
  - Notes: 5e5aa25221, b2d33739c5, a54ead1fbe, ec21aafede.
  - Where: `lower/expressions/operators.ts`, `emit/rust/expr.ts`.
  - Accept: S-out, M.
  - Depends: 1.9.4.
- [ ] 7.5.7 De Morgan negation of loop and IF tests.
  - Notes: 1d1551a034, 50226e2c19, b736e18f55, de2f16610e, e798927653, e8a1222ae6, ed880b92a8.
  - Where: `emit/rust/expr.ts` `negated`.
  - Accept: S-out, M.
  - Depends: 7.5.4.
- [ ] 7.5.8 Omit `if false { break; }` for WHILE TRUE / UNTIL FALSE.
  - Notes: 235daf8f29.
  - Where: `emit/rust/loops.ts`.
  - Accept: S-out, M (`never_loop` re-checked in 7.11.3).
  - Depends: 7.5.2.
- [ ] 7.5.9 A runtime FOR step evaluated once per pass (or hoisted), only as 2.1's `for_runtime_step_changed_in_body` allows.
  - Notes: 129bb34a7e, 547ea4e920.
  - Where: `lower/statements/loops.ts`.
  - Accept: S-out, M.
  - Depends: 2.1, 2.4.
- [ ] 7.5.10 A negative constant step prints as `wrapping_sub`.
  - Notes: 5351b3711d.
  - Where: `lower/statements/loops.ts`.
  - Accept: S-out, M.
  - Depends: 2.4.
- [ ] 7.5.11 Statements after an unconditional RETURN/EXIT are not printed; `ir/walk.exitsAfter` also sees EXIT/CONTINUE and all-return
  IFs (appendix); ALLOWED `unreachable_code`'s reason re-checked.
  - Notes: 0e0d715a81.
  - Where: `ir/walk.ts`, `emit/rust/routine.ts`.
  - Accept: S-out, M.
  - Depends: 1.7.4.
- [ ] 7.5.12 `clippy::collapsible_if` (4): nested IFs the printer produces are collapsed where the IR has no else and no statement between.
  - Where: `emit/rust/stmt.ts`.
  - Accept: S-out; M (surviving `collapsible_if` 0).
  - Depends: 7.5.5.

### 7.4 String copies (lean 4, on model 2)

- [ ] 7.4.1 `.to()` only when the capacity differs or the target is generic.
  - Notes: 5d9850550d, 8e30e6691c, ec1b55e90b, 4c088ca52b, 8883cf3a18, c90fc459e6, d3fdc1ed97, 0464b7d671, e8210b694c.
  - Where: `emit/rust/stmt.ts` (assign).
  - Accept: S-out, M.
  - Depends: 3.12.
- [ ] 7.4.2 Literals and conversion results built at the target capacity, no `.to::<N>().to()`.
  - Notes: 803ee89d4f, 4eeb332195, 7030300a1b, 90e7185468, 7587dbd531, 54e36b572f, c689147e80.
  - Where: `lower/values/literals.ts`, `builtins/conversions.ts`.
  - Accept: S-out, M.
  - Depends: 7.4.1.
- [ ] 7.4.3 An in-place `set_char` for `s[i] := c`.
  - Notes: 234c4da721, 7566f32b5e, f0973f1bcc, c05be29130, 318cfd770d, 0205cf3af0.
  - Where: `runtime/string.ts`, `emit/rust/stmt.ts`.
  - Accept: twin test, S-out, M.
  - Depends: 7.4.1.
- [ ] 7.4.4 A cursor read borrows, with one guard per statement.
  - Notes: 211808ca56, 5c499dbdc8, e6075a580f, 4fb82cd93a.
  - Where: `emit/rust/place.ts`, `lower/pointers/cursor.ts`.
  - Accept: S-out, M.
  - Depends: 7.4.1, 7.9.3.
- [ ] 7.4.5 Cursor and ANY variants keyed by width, not capacity (lean 4.5).
  - Where: `lower/calls/variants.ts`.
  - Accept: S-out; M (fewer duplicate fns).
  - Depends: 6.16.
- [ ] 7.4.6 Read-only Standard string inputs by `&IecStr<N>`, and a LEN_INTERNAL primitive (`units().len()`).
  - Notes: 185a887a57, 7a85af3c04, cbcde0e5de, dea089f2fd, 21ef64a1e0, 811c8ccd59, 3cacc7bfac, 9c8d21e237, 83ed1aab47, b592939dbf, c001fbb3b1.
  - Where: `lower/calls/binding.ts`, `libraries/Standard/*`.
  - Accept: S-out; `test/libraries` green; M.
  - Depends: 7.4.1.
- [ ] 7.4.7 An empty-string initializer prints `new()`.
  - Notes: e6646a0bd0.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 7.4.1.
- [ ] 7.4.8 A WSTRING literal built at its target capacity from a `&[u16]` const.
  - Notes: 23d12708e2.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 7.4.2.
- [ ] 7.4.9 A string compared with a literal compares against the literal's bytes, not a built IecStr.
  - What: the runtime gains `eq_bytes(&[u8])`/`cmp_bytes`, mirrored in `semantics/string.ts` and `string.cases.ts`.
  - Notes: the string-literal-compare notes tagged here by 0.6.
  - Where: `runtime/string.ts`, `emit/rust/expr.ts`, `semantics/string.ts`.
  - Accept: twin test, S-out, M.
  - Depends: 7.4.1.

### 7.6 Temporaries as locals (lean 6, on model 3; pub_underscore_fields 58)

- [ ] 7.6.1 `core/temps.ts` produces a statement-scoped local in body mode (chain, property, output, inout_guard and inout_index temps).
  - Notes: de132e5019, 73505351ad, 4edbb4135a, 707233d6d6, e7e871371f, 40fd7317bb, 42897347c4, 7a88c529f6, c7af448b33, 915417cef0.
  - Where: `lower/core/temps.ts`, `emit/rust/printer.ts`.
  - Accept: S-out, M.
  - Depends: 4.16.
- [ ] 7.6.2 A property-setter value passed directly when it holds no invoke on the same instance.
  - Notes: 48737e1389, 377c1dfc31, 4d8c0c87ee, 782a04d94c.
  - Where: `lower/calls/property.ts`, `interfaces/dispatch.ts`.
  - Accept: S-out, M.
  - Depends: 7.6.1.
- [ ] 7.6.3 An unbound VAR_OUTPUT goes to a local.
  - Notes: 53bd7d992e, 0878222ac3, 0b358286cb.
  - Where: `lower/calls/outputs.ts`.
  - Accept: S-out, M.
  - Depends: 7.6.1, 4.11.
- [ ] 7.6.4 VAR_TEMP as Rust locals; measure first which fixtures' recorded paths name a VAR_TEMP (those keep observable storage).
  - Where: `lower/storage/layout.ts` (`INSTANCE_STORAGE`), `init/temp-resets.ts`.
  - Accept: S-out, M.
  - Depends: 5.5, 7.6.1.
- [ ] 7.6.5 A scalar VAR_IN_OUT CONSTANT argument (or a literal bound to one) is passed by value, not copied into `let __copy_N`.
  - Notes: the `__copy_N` notes tagged here by 0.6.
  - Where: `lower/calls/binding.ts`, `emit/rust/calls.ts`.
  - Accept: S-out, M.
  - Depends: 7.6.1.
- [ ] 7.6.6 Argument hoisting only when needed.
  - What: no `let __arg_N` for a single input or for a pure argument; only the arguments that must be evaluated before a call-holding
    sibling are hoisted; SEL binds only what 6.15's contract needs.
  - Notes: the `__arg_N` / SEL-lets notes tagged here by 0.6.
  - Where: `lower/calls/invoke.ts`, `emit/rust/calls.ts`.
  - Accept: S-out (edge identical over every call-order fixture), M.
  - Depends: 7.6.1, 6.15.

### 7.7 Routine signatures (lean 7, on model 4)

- [ ] 7.7.1 `mut` only on parameters the body stores to.
  - Notes: 8a9bb48ddb, 1ca8b1b1fc, 0ab2575555, 7ab9128afd, a01f00db76, abc8bc67de, 49346d6299, 00fc50d055.
  - Where: `lower/calls/facts.ts` (a written set), `emit/rust/routine.ts`.
  - Accept: S-out, M.
  - Depends: 5.10.
- [ ] 7.7.2 Drop the blanket `#[allow(unused_mut, unused_variables, unused_assignments)]`; `init()` gets an allow only with parameters.
  - Notes: fa7d5f176f, dbcd1088a5, 3cf4e6fa21, f5ca982c14, c8ca44a755, 0ca9dad97d.
  - Where: `emit/rust/routine.ts`, `module.ts`.
  - Accept: M (no new surviving lint).
  - Depends: 7.7.1.
- [ ] 7.7.3 Return the result expression directly when assigned once at the end; skip the VAR_OUTPUT reset at entry when the body assigns it first.
  - Notes: 11f6ad8ec5, 96a5b25b66, 0969e59592, 5370b79269, 8088e0ab18, a573b540d2, 6dd22a92d0, a5c4faeebd, fda03fa84f, 14b2f39d44.
  - Where: `lower/calls/routines.ts`, `emit/rust/routine.ts`.
  - Accept: S-out, M.
  - Depends: 7.7.1.
- [ ] 7.7.4 `new()` as `const fn` where possible, marked `#[must_use]` (must_use_candidate, missing_const_for_fn).
  - Where: `emit/rust/structs.ts`.
  - Accept: M.
  - Depends: 5.10.
- [ ] 7.7.5 `g` and `prg` passed only to routines that reach them, with one params builder (the differing renderings 1.5.3 listed).
  - Notes: b9787e0d18, 1524fb865f, f62e4d99a5, ab696e2449, 37745ed7a0, 85168be6a7, 30d5674ec4.
  - Where: `lower/calls/reentrancy.ts` (the reach set), `emit/rust/names.ts`.
  - Accept: S-out, M.
  - Depends: 7.7.2.
- [ ] 7.7.6 No `std::mem::take` when the callee does not reach Programs.
  - Notes: abf2bb6e4e, 58a7e6289b.
  - Where: `emit/rust/calls.ts` `moveOutProgram`.
  - Accept: S-out, M.
  - Depends: 7.7.5.
- [ ] 7.7.7 Drop the dead form-2 value parameter (was calls.ts:1145-1146).
  - Where: `lower/pointers/borrowed.ts`.
  - Accept: S-out, M.
  - Depends: 4.16.
- [ ] 7.7.8 ARRAY[*] upper bounds derived from `len()`, not passed.
  - Where: `lower/storage/declare.ts`, `calls/fb-call.ts`.
  - Accept: S-out, M.
  - Depends: 7.7.1.
- [ ] 7.7.9 A constant ANY diSize folds into its variant; dead arms pruned.
  - Where: `lower/pointers/any.ts`.
  - Accept: S-out, M.
  - Depends: 4.9.
- [ ] 7.7.10 Delete the "call itself is correct" note fb7e9e6ff4 (tagged `keep`).
  - Where: `support/notes/notes.data.ts`.
  - Accept: M (7.11.1's count falls by one).
  - Depends: 0.6.
- [ ] 7.7.11 No unused generic routine beside its per-target specializations (`ptrparam_method`).
  - What: a generic routine every call site replaced by a specialization is not emitted.
  - Notes: the `ptrparam_method` note(s) tagged here by 0.6.
  - Where: `lower/calls/specialize.ts`, `emit/rust/module.ts`.
  - Accept: S-out; M (dead_code falls).
  - Depends: 7.1.2.
- [ ] 7.7.12 `clippy::too_many_arguments` (2; StringUtils' pointer+string parameter pairs).
  - What: after 7.4.6 and 7.7.8 re-count; if still present, either the pair collapses into one parameter (a cursor carrying its capacity)
    or the lint joins ALLOWED with that reason.
  - Where: `lower/pointers/cursor.ts`, `emit/rust/routine.ts`, or `support/transpile/lint-policy.ts`.
  - Accept: M (surviving `too_many_arguments` 0, or ALLOWED with a reason).
  - Depends: 7.4.6, 7.7.8.
- [ ] 7.7.13 `must_use_candidate` beyond `new()` and `missing_panics_doc`.
  - What: `#[must_use]` on every emitted fn that returns a value and writes nothing observable (from `calls/facts.ts`); for
    `missing_panics_doc`, a `/// # Panics` line on each fn that can reach a fault (from `ir/faults` kinds the body holds), or ALLOWED with
    a reason if the doc lines cost more than they tell — measured on the map and decided here.
  - Where: `emit/rust/routine.ts`, `lower/calls/facts.ts`, `support/transpile/lint-policy.ts`.
  - Accept: M (both counts fall to 0 or are ALLOWED with the recorded reason).
  - Depends: 7.7.4.

### 7.8 Derives and aggregate syntax (lean 8, on model 4)

- [ ] 7.8.1 `isCopy` drives the derives: derive `Eq`, and `Copy` for all-Copy structs; drop `.clone()` on Copy stores
  (derive_partial_eq_without_eq 1473).
  - Notes: ac452bc801.
  - Where: `emit/rust/types.ts`, `structs.ts`.
  - Accept: S-out, M.
  - Depends: 5.10.
- [ ] 7.8.2 A repeat expression for Copy arrays, nested included; `from_fn` only for non-Copy.
  - Notes: 00c356c11c, a65506e4d8, c9c77500c6, f9bdd4950a, 1f2f8205f9, 683d4b1944, 4026548939.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 7.8.1.
- [ ] 7.8.3 Struct-update syntax for aggregate initializers; `[d; N]` plus stores for a partial initializer.
  - Notes: 055df7e5f8, d5d625ee73, 8b9a7c5eea.
  - Where: `emit/rust/values.ts`.
  - Accept: S-out, M.
  - Depends: 7.8.2.
- [ ] 7.8.4 Unions via `to_le_bytes`/`from_le_bytes`, on the IR reinterpret node from 4.3, or adding it with its interpreter twin if 4.2
  chose no arena.
  - Where: `lower/storage/unions.ts`, `ir/expr.ts`, `semantics/`, `emit/rust/`.
  - Accept: S-out, M.
  - Depends: 4.16.
- [ ] 7.8.5 A constant bit store prints as `|=` / `&= !`.
  - Where: `emit/rust/stmt.ts`.
  - Accept: S-out, M.
  - Depends: 1.9.4.
- [ ] 7.8.6 Remove the `(*x)` and `&mut (*x)` deref noise.
  - Notes: 98ba0d2e70, 0d14fd327c, 3d7b4a7836, 0b51d542e8, 7e45a342fc, 8064ae1570, ca81b2092d, 28af8caf65, 29dc1a9c14, 01e84968c3, 52d85b7cdc, f0065dbd0b.
  - Where: `emit/rust/place.ts`, `printer.ts`.
  - Accept: S-out, M.
  - Depends: 4.16.
- [ ] 7.8.7 No parentheses around a statement-level `match` (unnecessary_semicolon 9).
  - Notes: 0cbdff077d, 59c341cb0f, 82e802ebc9, 26bfea40dc, 4b5007906a, 5ed54bb657.
  - Where: `emit/rust/calls.ts`.
  - Accept: S-out, M.
  - Depends: 7.3.8.
- [ ] 7.8.8 A pointer initializer `ADR(x)` is a constant in `new()`, not a separate init store.
  - Notes: ad25627749, fbde4d6e1e.
  - Where: `lower/init/initial-values.ts`.
  - Accept: S-out, M.
  - Depends: 5.10, 4.16.
- [ ] 7.8.9 `x := x` stays ALLOWED `self_assignment`: note ea53989ac8's text becomes that ALLOWED entry's reason; the note stays tagged
  `keep` and is deleted by 7.11.1.
  - Where: `support/transpile/lint-policy.ts`, `support/notes/notes.data.ts`.
  - Accept: M (the reason carries the text).
  - Depends: 0.6.
- [ ] 7.8.10 The reserved-prefix rule is structural: the unprefixed `t` (TRUNC), `program` and `v` use `tmp()`; the program move-out is
  one spelling.
  - Where: `emit/rust/names.ts`, `builtins.ts`, `calls.ts`, `values.ts`.
  - Accept: S-out; the collision test in `names.test.ts` asserts every generated binding is `__`-prefixed.
  - Depends: 1.9.4.

### 7.11 Notes and lint-policy hygiene

- [ ] 7.11.1 Delete the remaining `keep` notes (0.6's count minus those 7.2.13 and 7.7.10 deleted), after 7.8.9 moved ea53989ac8's text.
  - Where: `support/notes/notes.data.ts`.
  - Accept: M; no `keep` note left.
  - Depends: 0.6, 7.2.13, 7.7.10, 7.8.9.
- [ ] 7.11.2 Every note tagged to a finished task is deleted.
  - Where: `support/notes/notes.data.ts`, `scripts/rate-fixtures.ts`.
  - Accept: the generator reports 0 notes tagged to a ticked task.
  - Depends: all of 7.
- [ ] 7.11.3 Re-check every ALLOWED lint after the models.
  - What: eq_op (17), unnecessary_min_or_max (10), approx_constant (6), manual_clamp (2; RC 28/41), absurd_extreme_comparisons,
    manual_range_patterns, never_loop (model 1), unused_comparisons, dead_code, self_assignment, unreachable_code: each entry's excused
    count is re-measured; an entry at 0 is removed; the others get their reason re-written against today's cause.
  - Where: `test/conformance/support/transpile/lint-policy.ts`.
  - Accept: M; every ALLOWED entry has a current count and a reason written after 5.10.
  - Depends: 7.1.3, 7.2.7, 7.5.11.
- [ ] 7.11.4 Notes placed by 0.6 in tasks created for them are resolved or tagged `keep:<reason>`.
  - Where: `support/notes/notes.data.ts`.
  - Accept: the per-task note count lists no note under an open task at the end of phase 7.
  - Depends: all of 7.

## 8. Close

- [ ] 8.1 Docs.
  - What: architecture.md describes the four models as decided, the `semantics/` layer, the ownership rows and the refused lists;
    data-model.md describes the IR and the Type facts as they are; the package README and `scripts/README.md` updated.
  - Where: `docs/architecture.md`, `docs/data-model.md`, `README.md`, `scripts/README.md`.
  - Accept: `check-citations` reports 0.
  - Depends: 2.10, 3.12, 4.16, 5.10, 7.11.4.
- [ ] 8.2 Final map delta against 0.2.
  - What: edge, size median and top ten (under the 7.1.4 definition, with the 0.2 value re-computed under it), pedantic, lint totals,
    ALLOWED excused counts, notes remaining, open divergence marks. The target: only the refusals the model decisions name and the trig
    family of design.md §7.2.
  - Where: this file.
  - Accept: M; every open mark is in one of those two lists.
  - Depends: 8.1.
- [ ] 8.3 Final review.
  - What: spec, layering and a fresh-implementation review over the whole change; fix or file.
  - Where: all touched files.
  - Accept: lint (layering, size, citations) green; the size ceiling list for `src/transpile/**` empty.
  - Depends: 8.2.
- [ ] 8.4 Archive.
  - What: check each spec delta describes what was built; every hand-off of design.md §7.1 has a line in `lsp-transpile-review-gaps`;
    every transpile-st-to-rust task 0.8/4.2 marked superseded is ticked there with its reference. Archive this change and
    `transpile-lean-candidates` (unapplied, superseded), and `transpile-review-2026-09-29` if every RC is closed (else list the open
    ones here). Delete the re-created `openspec/specs/`.
  - Where: `openspec/changes/`.
  - Accept: `openspec list` shows neither this change nor transpile-lean-candidates; no `openspec/specs/`.
  - Depends: 8.3.

## Hand-off from transpile-st-to-rust (2026-10-03)

`transpile-st-to-rust` closed with 82 of 121 tasks done and is archived at
`openspec/changes/archive/2026-10-03-transpile-st-to-rust/` (its proposal's "Close-out" holds the full 39-row mapping;
its `pointer-model.md` and `memory-sketch.rs`, which design.md §3.3 and task 4.1 start from, moved there with it).
These are notes, not tasks: the task list and plan above are unchanged.

**Task 0.8 is done by this hand-off** — every open line there carries a verdict. Because that change is archived, the
"mark/tick it there" steps of 0.8, 4.2, 4.11, 4.14 and 8.4 are met by writing the closing commit against the id below
instead of editing the archived file.

**Superseded — owned here (6):**
- 4.11 ← "A routine's VAR_OUTPUT as a local copied back after the call, not a `&mut` reset on entry." (RC 20)
- 4.2 ← "A multi-target handle for stored POINTER/REFERENCE (`pointer-targets`)" (designed 2026-09-20 in `pointer-model.md`;
  two measurements before it: a `REFERENCE TO` field bound by a METHOD surviving to the next scan, and `__ISVALIDREF` of one
  never bound).
- 4.2 ← "**Form 2 first** (`pointer-model.md` §8)" — built (`pointers/borrowed.ts`); design.md §3.3 option (c) keeps it (the
  call-scoped half); 4.2 confirms.
- 4.2 ← "REFERENCE/POINTER inputs of a routine as borrows for the call — and interface inputs (`itf_function_input`)."
- 4.2 ← "`VAR_IN_OUT`, `POINTER TO`, `REFERENCE TO`, `expr-deref` — on the phase-3 model." (its phase 4 parent)
- 4.14 ← "**`instanceRelative` treats the root FB's own frame as multi-instance** — structurally real, NO REACHING CASE." (resolved
  or left with a reason, as 4.14 says)

**Backlog — handed off, not in this change's scope (33, verbatim; `l.` = line in the archived tasks.md).** Feature growth
this change's non-goals exclude. They wait for a follow-up change; a model here that makes one lower for free reports it in
its delta.

- (l.170) **C0582's wording** — unreachable on SP21 (design §7 of phase 1 above). Mirror the tree's creation error
    instead? A decision for the user, not researched further.
- (l.217) **Standard's functions and blocks are also hard-coded as always-present names** (gap 10, raised by the user
    2026-09-14) — `reference.ts` lists LEN…FIND and TON…RS, so they resolve even in a project that references no
    Standard. Analysis done. **PARKED by the user 2026-09-14** ("a lot still to cover before we get to that") —
    together with all other Standard-library work (Standard64, the runtime tier).
- (l.229) **Push round-trip** — push each case's ST through the bridge, fetch it back, require it byte-identical. Existing
    ops only; catches serialization bugs on bit access, chains, conversions, literals.
- (l.231) **Build parity** — the bridge's `build` diagnostics for each case agree with what the oracle compile reported.
- (l.232) **Execution through the bridge** — a `run` op on the Core online API (`IOnlineApplication.Login/Start/
    SingleCycle` exist on SP21); reading values there is still to probe. Only then can `record:exec` drop the
    runscript. TwinCAT would need its own answer.
- (l.373) **A PROGRAM called from an FB body** (60 corpus POUs) — recorded (`state_program_called_from_fb`: the one
    instance PLC_PRG calls), not built. Rust holds program instances in `Programs`, handed only to the POU's own
    `scan`; an FB body would need them too, and a program body calling on would borrow them twice. The likely shape:
    every body takes `prg`, and a program call moves its instance out and back (`mem::replace`), with a lowering guard
    against re-entering a body still being lowered.
- (l.555) **Then** what is left of the library half: a call into a library FUNCTION or FB, whose BODY really is absent
    (`L_MC1P_ModuloCycle`, `StrConcatA`, `SysTimeRtcGet`) — design §8's stub mechanism, so a POU that calls one is
    still testable. `plc-library-runtime` covers Standard/Standard64 only and names none of these vendor libraries.
    Parked as the user asked (2026-09-16), and it is the next proposal after this change, not a phase of it.
- (l.566) `place-not-local` +4 → 56 — the library-free half: a `var` of another scope with no frame slot (`Unit`, `AxisRef`).
- (l.567) `init-not-constant` +3 → 59 — the library-free half: an initializer that folds but is not reached.
- (l.568) `graphical-body` +6 → 65 — an FBD/LD body reaching the backend through **network text**, not through `lowerUnit`.
- (l.569) `place-shape` +4 → 69 — member access on a base with no layout, an index on a non-array, a literal as a place.
- (l.570) `pointer-order` +5 → 74.
- (l.571) `call-body` +5 → 79.
- (l.572) `aggregate-init` +3 → 82 — an initializer naming an INHERITED field (`instanceNo` of a base FB) is the top shape.
- (l.573) `enum-value` +17 → 99 — **the biggest single step**: the library-free half, an enum value that does not fold.
- (l.574) `call-param` +4 → 103.
- (l.575) `interface-type` +3 → 106.
- (l.576) `expr-member` +4 → 110.
- (l.577) `stmt-try` +3 → 113 — `__TRY`/`__CATCH`; Rust has no exceptions, so decide a strategy or refuse explicitly.
- (l.578) `layout-union` +4 → 117.
- (l.579) `conversion-type` +2 → 119 · `fb-init-argument` +2 → 121 · `expr-call` +2 → 123 (the built-ins `ADR`, `LTIME`,
    `TEST_AND_SET`, `DELETE` reaching the generic call path) · `call-inout-alias` +1 → 124 · `stmt-call_stmt` +1 → 125.
- (l.609) **`place-not-local` (+7 sole)** — still the head of the list, and the four the old order counted have been
    taken. The library-free half: a `var` of another scope with no frame slot (`Unit`, `AxisRef`).
- (l.611) **`graphical-body` (+6 sole)** — an FBD/LD body through **network text**. Note what this now sits beside:
    `network-text` is a first-class sublanguage the LSP analyzes, and the conformance suite records graphical
    fixtures on both vendors, so the input is measured — what is missing is the route into `lowerUnit`.
- (l.614) **`stmt-try` (+3 sole)** — nine `__TRY` fixtures are in `KNOWN_DIVERGENCES.twincat` because the x64 code
    generator refuses structured exception handling there, which is a DEVICE fact and does not change what this
    backend must decide.
- (l.617) Then re-measure. `bun run scripts/lower-completeness.ts` prints the table above; the greedy order is
    derived from the refusals and moves when they do, which is what this section is evidence of.
- (l.627) `__ISVALIDREF` and the pointer built-ins, which only mean something here.
- (l.631) Interfaces, `EXTENDS`, `__QUERYINTERFACE` — dynamic dispatch.
- (l.851) `__POUNAME` 304 and the other CODESYS compiler operators.
- (l.861) `expr-assign_expr` (1).
- (l.868) `stmt-try` (6, 2%) — `__TRY`/`__CATCH`. The interpreter can run it; Rust has no exceptions, so the
    emitter needs a strategy or an explicit refusal. Decide rather than default.
- (l.870) `type-unknown` (18, 6%) — triage; each is a type the frontend could not resolve.
- (l.886) Stub mechanism for third-party library FBs, so a POU that calls one is still testable (design §8).
- (l.916) **A TwinCAT build pass for the program cases**, so the replay stops tolerating unrecorded cases on that vendor.
    PARKED (user, 2026-09-14) — the CODESYS data is complete and this is the second vendor's half. Tried once:
    `ide.ps1 up -Vendor twincat` attaches workers to two XAE windows, both "no project selected"; `connect
    {project: "TwinCAT Project13"}` binds it (worker log: "select: bound", "DEGRADED cleared") and one `refs`
    answers, then the recorder's `refs` is refused PLC_DISCONNECTED with no deselect in the log. Not diagnosed.

## Hand-off from frontend-conformance (2026-10-03, its tasks 5.2 and 5.3)

These are notes, not tasks: the task list above is unchanged. Front-end paths are the real ones (`src/frontend/<layer>/…`);
every function named below is reachable through `src/frontend/<layer>/index.js` unless it says otherwise.

**Task 5.2 (input to 0.1 and 0.9).** design.md §6.1 gives each of the 15 needs of §6 a verdict and a path (met: 1, 2, 6 in
part, 7 in part, 8–13, 15 with two exceptions; not provided, with the reason: 3, 4, 5, `widthOf`, `contextLiteralType`, 14);
design.md §6.2 gives every front-end root cause a status (RC 1–4, 2.3, 6, 21, 45 closed UPSTREAM by the review's own fixes;
6.A.22, 6.A.24, 6.A.26 closed by frontend-conformance; 6.A.20, 6.A.25, 6.A.29 closed in the front-end half only; 6.A.21,
6.A.23 open). frontend-conformance changed no transpiler output: its F-back snapshot (emitted Rust and interpreter values,
1b03f0e55c → the 4e tree) is byte-identical for all 2181 fixtures that lowered at its start; 22 refused fixtures stopped
lowering because the parser now refuses them as CODESYS does (`cc_il_name_*` ×14, `cc_reserved_name_*` ×3,
`cc4_type_name_*_as_variable` ×2, `identifier_*underscore*` ×2, `var_non_retain`), one started (`operand_uchar_literal`,
`UCHAR#'A'`, which CODESYS REFUSES — "Cannot convert type 'UDINT' to type 'BYTE'", recorded; TwinCAT refuses it at
parse): lowering called the literal malformed and now lowers it, so it joins the 266 refused fixtures that lower — outside
the transpiler's input contract ("code CODESYS compiles", `fixtures.test.ts` `refused` row), neither an improvement nor a
regression; the LSP gives the recorded refusal, pinned by the fixture's `refused` field. A refusal at a compiler struct
(`VERSION`, an `ANY` input — `type_codesys_version`, `refuse_interface_any_input`) pointed at 0:0; `storageOf` now takes
the span of its use and refuses there (fixed in frontend-conformance's step-5 review, `lower.test.ts`).

**Task 5.3 — the T hand-off.** Every "T" row of frontend-conformance design.md P6 and §3.3, once, with the transpiler site as
read on 2026-10-03 (line numbers name the code, not a contract) and the front-end function that replaces it. The restructure
task that owns each is in brackets.

- **H1 — EXTENDS chains** (P6 "13 EXTENDS sites"; §3.3 "EXTENDS chains", "Interface EXTENDS"). Sites today: `lower/lower.ts`
  `extendsChain(lw, fb)` :212 (by NAME through `unit.extends?.text`) and its callers :398, :583; the `baseOf`/`.extends`/
  `baseScope` walks at `lower/lower.ts` :200, :272, :290, :301, :377, :438; `lower/calls.ts` :97–101, :113, :655, :735, :983,
  :1409; `lower/storage.ts` :90, :109; `lower/bytes.ts` :64, :72, :81; `lower/interfaces.ts` :53, :66 (interface EXTENDS by
  name); `lower/lowering.ts` :46 (`baseOf`, a copy of the front-end's). → `symbols/extends.ts` `extendsChain(scope)` (base
  first, cycle-safe), `baseOf`, `basesOf`/`ancestry` for interfaces (linked by the binder since frontend-conformance 3.2.1, so
  a base is the one precedence picked, not the first by name); `symbols/scope-nav.ts` `hasUnresolvedBase` for "incomplete".
  [1.1.2, 1.7.3]
- **H2 — GVL-qualified resolution** (P6 `places.ts:33,64,80`). `lower/places.ts` :34, :65, :81 search
  `lw.project.symbols.get(…)` for a `gvl_var`. → `symbols/scope-nav.ts` `resolveGvlMember`, `gvlBlockOf`, `externalGlobal`
  (per-unit `qualified_only` read since frontend-conformance 3.1.3). [1.6.12]
- **H3 — namespace lookups by map** (P6 `calls.ts:976,1627`, `constants.ts:103`). `lower/calls.ts` :993
  (`ns.symbols.get(…)` for a namespace FUNCTION); `lower/lower.ts` :302 (`s.symbols.get("fb_init")`). The `constants.ts`
  namespace lookup now reads `findChildScope` (:56–58) — that site is met. → `symbols/scope-nav.ts` `findChildScope` +
  `symbols/scope.ts` `lookupLocal` (both on the symbols index). [6.5]
- **H4 — typing rules re-decided in lowering** (P6 NOT, duration × integer, LIMIT/SEL/MUX, `UNARY_MATH`, platform rewrite;
  §3.3 "NOT result type", "Built-in result types").
  - NOT: `lower/expressions.ts` :180–184 (a signed integer → the bit string of its width) → `types/arith/operators.ts`
    `notResultType` (value-identical, frontend-conformance 4.3.2). [1.1.8]
  - duration × integer: `lower/expressions.ts` :246–251 → `types/arith/temporal.ts` `durationScaleResultType`,
    `durationScaleConversion` (4.3.5). [1.1.8, 6.14]
  - LIMIT/SEL/MUX: `lower/builtins.ts` :456–487 (its own meet over `commonType`/`integerFoldType`) → `types/builtins.ts`
    `selectionValueArguments` (the checked meet of the value arguments, after SEL's selector and MUX's index; 4.3.4).
    [6.7, 6.15]
  - `UNARY_MATH`: `lower/builtins.ts` :76, :229 → `types/builtins.ts` `MATH_ARG_TYPED`, `mathResultType`. [1.6.15]
  - platform conversion rewrite: `lower/builtins.ts` :152–156 (replaces `__XINT` & co. before parsing) and
    `lower/constants.ts` :132, :183 (`parseConversionName(…, undefined)`) → `types/conversion-name.ts`
    `parseConversionName(name, target)` with the project's target (`symbols` `targetOf`), which reads platform sides itself
    (4.1.2). [1.1.10]
- **H5 — literal typing** (P6 `contextLiteralType`; §3.3 "Literal typing"). `lower/constants.ts` `contextLiteralType` :251
  → `types/literal.ts` (`literalCheckType`, `literalContextConversion`, `integerLiteralType`). NOT value-identical: LT14
  (`test/frontend/literal-agreement.test.ts`, `baselines/literal-agreement.json`) pins 29 classes, corpus 78 / fixtures 79
  stores, where the two answer differently (a 0/1 into BOOL/BIT/TIME, an integer the target cannot hold, a real beyond REAL,
  a real into an integer); each class needs a recording before the switch, and the baseline may only fall. [1.1.7, 6.2]
- **H6 — width ladder and wrap** (P6 `stored`/`fit`/`integerFoldType`; §3.3 "Integer width ladder", "Wrap to width").
  `lower/convert.ts` `stored` :132, `integerFoldType` :67; `ir/values.ts` `fit` :416; `ir/evaluate.ts` `widthOf` →
  `types/width.ts` `wrapToWidth` (export it from the types index first) and `integerOfWidth`; the fold width is the
  front-end fold's (`types/const/fold.ts`). [1.1.6, 6.B.2]
- **H7 — the constant folder and enum facts** (P6 `constants.ts` row; §3.3 "Constant folding", "Enum base / numbering /
  default"). `lower/constants.ts` `foldConstant` :187, `foldsToConstant` :157, `convertedConstant` :123 →
  `types/const/fold.ts` `constEval`, `compileTimeConstant`, `declaredValue`, `constantSlotType`, `constancyIn`
  (frontend-conformance 4.6.1 made the LSP fold the set the transpiler folds: conversions, pure built-ins, SIZEOF, enum
  values, NOT, shifts); `lower/constants.ts` `enumStorage` :28 → `types/enums.ts` `enumStorage`/`enumValueStorage`
  (recorded DT5–DT6, 4.7.3). Already switched by frontend-conformance: `enumDefault`, `inlineEnumDefault` (1.37,
  `lower/storage.ts` imports them), `calendarNanoseconds` (1.22). [1.1.9, 1.7.14, 7.2]
- **H8 — the default STRING capacity** (P6 `withStringCapacity`). `lower/storage.ts` `withStringCapacity` :32 (and its
  callers in `builtins.ts`, `places.ts`, `constants.ts`) → `types/defaults.ts` `DEFAULT_STRING_LENGTH`, applied at
  `lowering.resolve` as design.md §3.2 decides. [3.3]
- **H9 — the platform target** (P6 `canonicalElem`'s target in `lowering.ts`). The `lowering.ts` `canonicalElem` call is gone
  (`resolve` goes through `resolveTypeExpr`, which takes the project's target). What is left: `lower/conditions.ts` :20
  `EXEC_ORACLE_TARGET` passed to `build.buildSymbolTable` (`lower/lower.ts` :719), and `lower/bytes.ts` :172
  `elementaryTypeOn(name, targetOf(project))` for SIZEOF of a type name → `types/platform.ts` `canonicalElem(name, target)`
  / `elementaryTypeOn` with the target the project states (4.1.1; `workspace-refs` `MEASURED_DEVICE_TARGETS` for real
  projects). [1.1.6 or 6.B]
- **H10 — identifier equality** (P6 interp `sameName`). `interp/interp.ts` `sameName` :467 → `syntax/identifier.ts`
  `sameName`; and the self-reference spellings `lower/calls.ts` `isSuper` :84 and `lower/places.ts` :156
  (`name.toUpperCase() === "SUPER"` / `"THIS"`, found by the frontend-conformance close review) → `syntax/identifier.ts`
  `selfRefKind`. [1.1.1]
- **H11 — attribute maps** (frontend-conformance 1.23 "T, 5.3"). `lower/lower.ts` `attributesOf` :733 and
  `lowering.ts` `attributes` :261 rebuild per-file maps from `unitAttributes`/`memberAttributes`/`declarationAttributes`;
  since frontend-conformance 2.7.2 every unit, member and declaration node carries `attributes` in the AST (the three
  functions no longer lex). → read the node's `attributes` (`syntax/pragmas/attributes.ts` `hasFrontendAttribute`,
  `readAttribute`). Output-neutral. [1.6.20]

**Fixtures the front-end now types and the transpiler does not lower** (each `not-lowered` in `map.generated.ts`; a model
task here that lowers one reports it): `ce_fold_untyped_in_context_values` ("init-not-constant": lowering folds an
initializer without its context — H5/H7); `dt_union_member_sizes` (union member sizes); `dt_this_into_pointer`,
`dt_this_deref_identity_values` (a bare THIS and `SUPER^.v` as places); `ty_dint_to_uxint` (a platform conversion name read
as a project FUNCTION — H4); the enum `to_string` member-name table (4.5.1, refused by name); `type_codesys_version` and
`refuse_interface_any_input` — the front-end now types `VERSION` and an `ANY` input as the compiler's own structs
(`types/system.ts`, rules TY14/TY15, recorded), so `lower/storage.ts` :125 refuses `layout-struct` "VERSION / ANY has no
declaration lowering can lay out" at a zero span (no project symbol declares them); before, `type_codesys_version` was refused
as `slot-unknown` at its declaration. Lay out the system structs from `types/system.ts` `systemStructType`, or refuse at the
declaration that names one. [5 (the instance model) or 6.B]
