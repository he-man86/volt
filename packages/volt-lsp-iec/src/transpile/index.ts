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
 *     because some invalid program would need it. "Does not compile" is itself MEASURED: a conformance execution case
 *     marked `refused` pins each such fact.
 *   - Lowering stays total: invalid input still ends in a `LowerDiagnostic` under a generic code, never a throw and
 *     never an invented meaning.
 *   - Every other refusal is about VALID code, and is either NOT MODELLED YET (understood, not built) or NOT MEASURED
 *     YET (compiles, but its behaviour is unrecorded, so it is not guessed). The codes and their kinds are
 *     `lower/diagnostics/codes.ts`, and `scripts/lower-completeness.ts` counts them; nothing here copies that list — a
 *     stale copy is read as a map of the work left.
 *
 * **The reach contract: a STATED SUBSET, and it is small.** The input contract says which programs are *defined*; this
 * says which are *reached*: a top-level PROGRAM or FUNCTION_BLOCK body lowers or is refused, and a METHOD or ACTION
 * lowers only when a POU that lowers calls it. The measured share of the corpus's bodies that lower is a small fraction,
 * written down and kept exact by `test/corpus/corpus-lowering.test.ts` (`REACH`, `ROUTINES`) — the one place the figures live.
 * This backend executes a SUBSET: enough for the conformance oracle and for a POU written to be tested, not enough to
 * run a real project. That is a statement of fact rather than a roadmap; the number is measured because a plan for
 * this component once justified itself with a figure 470x the real one.
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
export { LoopGuardError, run, type Runner, RunnerValueError } from "./interp/index.js"
export { emitRust, type Emitted, rustType } from "./emit/rust/index.js"
export { load, lowerAndEmit } from "./pipeline/index.js"
