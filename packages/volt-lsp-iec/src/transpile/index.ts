/**
 * Backend — transpile. A sibling consumer of the frontend (`syntax ← symbols ← types`), not of the LSP.
 *
 *     AST ──lower/──> IR ──┬── interp/       runs it (the oracle)
 *                          └── emit/rust/    prints it (+ source map)
 *
 * `lower/` owns every ST semantic; the backends are printers. See `ir/ir.ts` for the two decisions that
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
 *       not modelled yet — understood, not built: `stmt-call_stmt`, `aggregate-init`, `call-library` (a referenced
 *                          library's body is the vendor's, and a declaration file holds none);
 *       not measured yet — compiles, but its behaviour is unrecorded, so it is not guessed: REAL_TO_STRING's digits,
 *                          a WSTRING's named escapes (`string-escape`, `conversion-type`), where a variable of an
 *                          enum whose first enumerator is not 0 starts (`enum-default`).
 *     This list said `REF=` and a runtime FOR step were unbuilt; BOTH lower — `r REF= n` since references record a
 *     target like pointers, and a runtime step since the test takes the limit from below or above on two arms
 *     (`callshape_for_runtime_step`). A stale refusal list is worse than none: it is read as a map of the work left.
 *     `scripts/lower-completeness.ts` counts both; each shrinks only by building the construct or recording a case.
 *
 * **The reach contract: a STATED SUBSET, and it is small.** The input contract above says which programs are
 * *defined*; this says which are *reached*. Measured 2026-09-17 over the 6-project corpus (29,359 files) and
 * enforced by `test/conformance/lowering-totality.test.ts`, which fails if these numbers rot:
 *
 *   - top-level PROGRAM / FUNCTION_BLOCK bodies: **55 of 304 lower (18.1%)**
 *   - METHOD / ACTION bodies: **56,629, none reachable** — they share their FB's frame, which lowering does not
 *     model yet, and they are not even in the 304 denominator
 *   - so of every executable body in the corpus, about **0.10%**
 *
 * Real PLC logic lives in methods and actions. This backend therefore executes a SUBSET — enough for the
 * conformance oracle and for a POU written to be tested, not enough to run a real project — and that is a
 * statement of fact rather than a roadmap. Growing it belongs to `openspec/changes/transpile-st-to-rust`;
 * making the subset trustworthy belongs to `production-grade-transpiler`.
 *
 * The number is written down because the alternative was demonstrated: a plan for this component justified its
 * centrepiece with "26,175 corpus files" and the measurement was 55 POUs — the same order of error as claiming a
 * test suite covers a codebase when it covers one directory.
 */
export * from "./ir/index.js"
export * from "./lower/index.js"
export * from "./interp/index.js"
export * from "./emit/rust/index.js"

import { lowerSource, type LibraryFile } from "./lower/index.js"
import { run, type Runner } from "./interp/index.js"

/** Parse, lower and prepare one source string for execution — the one-call path for a test. */
export function load(source: string, name?: string, libraries: readonly LibraryFile[] = []): Runner {
  const { pou, diagnostics } = lowerSource(source, name, libraries)
  if (pou === undefined) {
    const first = diagnostics[0]
    throw new Error(`cannot lower${first === undefined ? "" : `: ${first.message} [${first.code}]`}`)
  }
  return run(pou)
}
