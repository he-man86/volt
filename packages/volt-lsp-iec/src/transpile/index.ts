/**
 * Backend — transpile. A sibling consumer of the frontend (`syntax ← symbols ← types`), not of the LSP.
 *
 *     AST ──lower/──> IR ──┬── interp/       runs it (the oracle)
 *                          └── emit/rust/    prints it (+ source map)
 *
 * `lower/` owns every ST semantic; the backends are printers. See `ir/index.ts` for the two decisions that
 * shape all of it — places-not-names, and semantics-in-the-IR.
 *
 * **The input contract: code CODESYS compiles.** The transpiler is defined only for a program the vendor's compiler
 * accepts, and the gate is that BUILD — not the LSP, whose diagnostics have false negatives. So:
 *   - Code that does not compile gets no semantics here. No operator, conversion or edge case exists in `lower/` only
 *     because some invalid program would need it (`**` and `&` were mapped to IR ops, yet neither parses in CODESYS —
 *     removed). "Does not compile" is itself MEASURED: a conformance execution case marked `refused` pins each such fact.
 *   - Lowering stays total: invalid input still ends in a `LowerDiagnostic` under a generic code (`binary-op`,
 *     `call-arity`, `bad-literal`), never a throw and never an invented meaning.
 *   - Every other refusal is about VALID code, and is one of two kinds:
 *       not modelled yet — understood, not built: `stmt-call_stmt`, `aggregate-init`, `call-library` (a library
 *                          element whose body the library repo, `libraries/`, has not written for that version);
 *       not measured yet — compiles, but its behaviour is unrecorded, so it is not guessed: REAL_TO_STRING's digits,
 *                          a WSTRING's named escapes (`string-escape`, `conversion-type`), where a variable of an
 *                          enum whose first enumerator is not 0 starts (`enum-default`).
 *     This list said `REF=` and a runtime FOR step were unbuilt; BOTH lower — `r REF= n` since references record a
 *     target like pointers, and a runtime step since the test takes the limit from below or above on two arms
 *     (`callshape_for_runtime_step`). A stale refusal list is worse than none: it is read as a map of the work left.
 *     `scripts/lower-completeness.ts` counts both; each shrinks only by building the construct or recording a case.
 *
 * **The reach contract: a STATED SUBSET, and it is small.** The input contract above says which programs are
 * *defined*; this says which are *reached*. Measured 2026-09-19 over the 6-project corpus (29,359 files) and
 * enforced by `test/corpus/corpus.test.ts`, which fails if these numbers rot (last moved 2026-09-28, DOWN, when a CFC
 * chart and an FBD body network text cannot spell stopped reading as empty ST bodies — they state
 * `IMPLEMENTATION <LANG> UNSUPPORTED` now; before that 2026-09-26, up one, when Util's BLINK joined the library repo):
 *
 *   - top-level PROGRAM / FUNCTION_BLOCK bodies: **54 of 304 lower (17.8%)**
 *   - METHOD / ACTION bodies: **56,629, of which 14 are REACHED**, every one from a POU that RUNS — a routine
 *     lowers when a POU that lowers calls it, and they are not in the 304 denominator. This read 582 until
 *     2026-09-25: 566 were library FBs' `FB_INIT`s, bodyless declarations lowered as if they did nothing.
 *   - so of every executable body in the corpus, about **0.12%**
 *
 * Real PLC logic lives in methods and actions, and almost none of THAT is reached: 14 routine bodies out of
 * 56,629. This backend therefore executes a SUBSET — enough for the conformance
 * oracle and for a POU written to be tested, not enough to run a real project — and that is a statement of fact
 * rather than a roadmap. Growing it belongs to `openspec/changes/transpile-st-to-rust`;
 * making the subset trustworthy belongs to `production-grade-transpiler`.
 *
 * The number is written down because the alternative was demonstrated: a plan for this component justified its
 * centrepiece with "26,175 corpus files" and the measurement was 55 POUs — the same order of error as claiming a
 * test suite covers a codebase when it covers one directory.
 */
// THE SURFACE, named one by one (design.md §2.1.1; `index.test.ts` pins the runtime names). Beyond the design's list, each
// with its consumer: `LoopGuardError` (a harness's loop guard giving up — `test/conformance/backends.test.ts`, the
// confidence rating; task 27 came after the design) and the type `LoweringProject` (`test/corpus/support/project.ts`).
export type * from "./ir/index.js"
export {
  CLOCK,
  libraryBase,
  LOWER_CODE_PREFIXES,
  LOWER_CODES,
  lowerCodeKind,
  lowerPrepared,
  lowerSource,
  lowerUnit,
  prepareProject,
  type LibraryBase,
  type LibraryFile,
  type LoweredPou,
  type LowerDiagnostic,
  type LoweringProject,
  type ParsedFile,
} from "./lower/index.js"
export { LoopGuardError, run, type Runner } from "./interp/index.js"
export { emitRust, type Emitted, rustType } from "./emit/rust/index.js"
export { load, lowerAndEmit } from "./pipeline/index.js"
