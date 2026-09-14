/**
 * Backend — transpile. A sibling consumer of the frontend (`syntax ← symbols ← types`), not of the LSP.
 *
 *     AST ──lower/──> IR ──┬── interp/       runs it (the oracle)
 *                          └── emit/rust/    prints it (+ source map)
 *
 * `lower/` owns every ST semantic; the backends are printers. See `ir/ir.ts` for the two decisions that
 * shape all of it — places-not-references, and semantics-in-the-IR.
 *
 * **The input contract: code CODESYS compiles.** The transpiler is defined only for a program the vendor's compiler
 * accepts, and the gate is that BUILD — not the LSP, whose diagnostics have false negatives. So:
 *   - Code that does not compile gets no semantics here. No operator, conversion or edge case exists in `lower/` only
 *     because some invalid program would need it (`**` and `&` were mapped to IR ops, yet neither parses in CODESYS —
 *     removed). "Does not compile" is itself MEASURED: a `test/exec` case with `rejects` pins each such fact.
 *   - Lowering stays total: invalid input still ends in a `LowerDiagnostic` under a generic code (`binary-op`,
 *     `call-arity`, `bad-literal`), never a throw and never an invented meaning.
 *   - Every other refusal is about VALID code, and is one of two kinds:
 *       not modelled yet — understood, not built: `stmt-call_stmt`, `aggregate-init`, `REF=`, a runtime FOR step;
 *       not measured yet — compiles, but its behaviour is unrecorded, so it is not guessed: REAL_TO_STRING's digits,
 *                          a WSTRING's named escapes (`string-escape`, `conversion-type`).
 *     `scripts/lower-completeness.ts` counts both; each shrinks only by building the construct or recording a case.
 */
export * from "./ir/index.js"
export * from "./lower/index.js"
export * from "./interp/index.js"
export * from "./emit/rust/index.js"
export { printType } from "./print.js"

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
