/**
 * THE COMPOSITION ROOT — lowering, then running or printing, in one call, for tests and scripts. Nothing in `src/`
 * imports it but the transpile barrel (layering rule 4).
 */
import type { IrPou } from "../ir/index.js"
import { lowerSource, type LibraryFile } from "../lower/index.js"
import { run, type Runner } from "../interp/index.js"
import { emitRust, type Emitted } from "../emit/rust/index.js"

/** One source string lowered, or a throw naming the first refusal. */
function lowered(source: string, name: string | undefined, libraries: readonly LibraryFile[]): IrPou {
  const { pou, diagnostics } = lowerSource(source, name, libraries)
  if (pou === undefined) {
    const first = diagnostics[0]
    throw new Error(`cannot lower${first === undefined ? "" : `: ${first.message} [${first.code}]`}`)
  }
  return pou
}

/** Parse, lower and prepare one source string for execution — the one-call path for a test. */
export function load(source: string, name?: string, libraries: readonly LibraryFile[] = []): Runner {
  return run(lowered(source, name, libraries))
}

/** Parse, lower and print one source string as Rust — the lowered POU and its emission, for a test that reads both. */
export function lowerAndEmit(source: string, name?: string, libraries: readonly LibraryFile[] = []): { pou: IrPou; emitted: Emitted } {
  const pou = lowered(source, name, libraries)
  return { pou, emitted: emitRust(pou) }
}
