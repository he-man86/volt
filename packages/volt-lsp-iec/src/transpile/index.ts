/**
 * Backend — transpile. A sibling consumer of the frontend (`syntax ← symbols ← types`), not of the LSP.
 *
 *     AST ──lower/──> IR ──┬── interp/       runs it (the oracle)
 *                          └── emit/rust/    prints it (+ source map)
 *
 * `lower/` owns every ST semantic; the backends are printers. See `ir/ir.ts` for the two decisions that
 * shape all of it — places-not-references, and semantics-in-the-IR.
 */
export * from "./ir/index.js"
export * from "./lower/index.js"
export * from "./interp/index.js"
export * from "./emit/rust/index.js"
export { printType } from "./print.js"

import { lowerSource } from "./lower/index.js"
import { run, type Runner } from "./interp/index.js"

/** Parse, lower and prepare one source string for execution — the one-call path for a test. */
export function load(source: string, name?: string): Runner {
  const { pou, diagnostics } = lowerSource(source, name)
  if (pou === undefined) {
    const first = diagnostics[0]
    throw new Error(`cannot lower${first === undefined ? "" : `: ${first.message} [${first.code}]`}`)
  }
  return run(pou)
}
