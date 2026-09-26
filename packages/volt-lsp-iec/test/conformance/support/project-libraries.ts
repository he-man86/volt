/**
 * THE FIXTURE PROJECT'S REFERENCED LIBRARIES, as the bridge materialized them — the same project the execution
 * recorder runs (CodesysTestProject), so every library element a fixture calls binds to the declaration CODESYS
 * compiled, and runs the body the library repo holds for the version CODESYS resolved.
 *
 * ALL of them, not a chosen few: the recording was made against the whole project, and a replay that left a library
 * out would resolve a name the vendor resolved to nothing (or, for the LSP, call one undefined that the build found).
 * It carried Standard alone until Util and StringUtils were referenced so the repo's bodies could be recorded.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { withImplementations } from "../../../libraries/index.js"
import { parseSource } from "../../../src/syntax/index.js"
import { parseLibraryManifest, type LibraryManifest } from "../../../src/symbols/index.js"
import { libraryBase, type LibraryBase, type LibraryFile } from "../../../src/transpile/index.js"
import { walkSources } from "../../corpus/support/project.js"

/** The fixture project's Library Manager — where the bridge materializes every library it references. */
const MANAGER = join(import.meta.dir, "..", "..", "..", "test-corpus", "CodesysTestProject", "Device", "Plc Logic", "Application", "Library Manager")

/** Where the fixture project materialized its Standard. */
export const STANDARD = join(MANAGER, "Standard")

const read = (uri: string): { uri: string; source: string } => ({ uri, source: readFileSync(uri, "utf8") })
const DECLARATIONS = walkSources(MANAGER).map(read)
const MANIFEST_FILES = walkSources(MANAGER, new Set([".library"])).map(read)

/** Every library's declarations, PARSED ONCE — what the LSP replay binds a library name against, as the LSP binds a
 *  project that references them. A caller re-parses only for another dialect. */
export const PROJECT_LIBRARY: readonly LibraryFile[] = DECLARATIONS.map((f) => ({ ...f, parseResult: parseSource(f.source) }))

/** Every library's manifest — its NAMESPACE, DEPENDENCIES and the RESOLUTION the repo is looked up by. */
export const PROJECT_MANIFESTS: readonly LibraryManifest[] = MANIFEST_FILES.flatMap((l) => parseLibraryManifest(l.uri, l.source) ?? [])

/** What the transpiler lowers against: every library, with the bodies the library repo holds for the versions the
 *  project resolved — parsed ONCE, since every fixture lowers against them. */
export const PROJECT_LOWERING: readonly LibraryFile[] = withImplementations([...DECLARATIONS, ...MANIFEST_FILES]).map((f) =>
  f.uri.endsWith(".library") ? f : { ...f, parseResult: parseSource(f.source) },
)

/** Those libraries bound ONCE (`libraryBase`): every fixture lowers on top of them, rather than binding 857 files anew. */
export const PROJECT_BASE: LibraryBase = libraryBase(PROJECT_LOWERING)
