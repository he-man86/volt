/**
 * The fixture project's referenced Standard library, as the bridge materialized it — the same project the execution
 * recorder runs (CodesysTestProject, Standard 3.5.18.0), so a Standard function binds to the declaration CODESYS compiled.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { withImplementations } from "../../../libraries/index.js"
import { parseSource } from "../../../src/syntax/index.js"
import { parseLibraryManifest, type LibraryManifest } from "../../../src/symbols/index.js"
import type { LibraryFile } from "../../../src/transpile/index.js"

/** Where the fixture project materialized its Standard. */
export const STANDARD = join(import.meta.dir, "..", "..", "..", "test-corpus", "CodesysTestProject", "Device", "Plc Logic", "Application", "Library Manager", "Standard")

const MATERIALIZED: readonly { uri: string; source: string }[] = readdirSync(STANDARD).map((f) => ({ uri: join(STANDARD, f), source: readFileSync(join(STANDARD, f), "utf8") }))

/**
 * The declarations — every `.fb` and `.fun` — and the manifest: what the LSP replay binds a Standard name against, as
 * the LSP binds a real project that references Standard. It carried the `.fun` files alone, so TON, CTU and R_TRIG
 * resolved only through a hardcoded list of library names in `src/reference/` — which is gone: the LSP knows a
 * library through its materialization and nothing else.
 */
export const STANDARD_LIBRARY: readonly { uri: string; source: string }[] = MATERIALIZED.filter((l) => /.(fb|fun)$/.test(l.uri))
export const STANDARD_MANIFESTS: readonly LibraryManifest[] = MATERIALIZED.flatMap((l) => parseLibraryManifest(l.uri, l.source) ?? [])

/** What the transpiler lowers against: the whole materialization, with the bodies the library repo holds for its version —
 *  parsed ONCE, since every fixture lowers against it (re-parsing it per fixture was most of a gate's run). */
export const STANDARD_LOWERING: readonly LibraryFile[] = withImplementations(MATERIALIZED).map((f) =>
  f.uri.endsWith(".library") ? f : { ...f, parseResult: parseSource(f.source) },
)
