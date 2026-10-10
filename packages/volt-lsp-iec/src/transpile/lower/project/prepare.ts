/**
 * The transpiler's input assembly: files parsed once, bound into the one symbol table lowering reads, with every unit's
 * attributes and which units are a library's.
 */

import {
  declarationAttributes,
  memberAttributes,
  type ParseOptions,
  parseSource,
  unitAttributes,
} from "../../../frontend/syntax/index.js"
import { build, isLibrarySymbol, type Scope } from "../../../frontend/symbols/index.js"
import { type LibraryManifest, parseLibraryManifest } from "../../../frontend/library/index.js"
import { EXEC_ORACLE_DIALECT, EXEC_ORACLE_TARGET } from "../conditions.js"

/** How the transpiler reads the text it is handed: the language as Volt defines it, LD/FBD bodies as network text — which
 *  reaches the backend through network text, never through `lowerUnit`, which refuses a body that is not ST (`isStBody`).
 *  Stated, not defaulted (frontend-conformance P5): the transpiler has no environment of its own to take it from, and it
 *  ran with network text on in every run that measured it (the test preload). */
export const TRANSPILE_PARSE: ParseOptions = { networkText: true }

/** A file handed to lowering beside the source — a GVL, a sibling POU, or a referenced library's file, which keeps its
 *  `Library Manager/<library>/` path (how `isLibrarySymbol` tells it apart). */
export interface LibraryFile {
  uri: string
  source: string
  /** `source` already parsed — a caller lowering many programs against the same library parses it once. */
  parseResult?: ReturnType<typeof parseSource>
}

/**
 * A PROJECT AS LOWERING READS IT — one symbol table, every unit's attributes, and which units are a library's.
 *
 * The three travel together because each caller used to assemble them, and one did not: `lowerUnit` took the library
 * units as an optional parameter defaulting to none, the corpus gate and three scripts never passed it, and there
 * every bodyless library element "lowered" as an empty body — `t.Q` FALSE forever, an invented meaning counted as
 * reach. `prepareProject` is the one place they are built, so the set cannot be forgotten.
 */
export interface LoweringProject {
  project: Scope
  /** Each POU's `{attribute '…'}` names (`syntax/unitAttributes`), for the ones lowering must refuse — by AST node, as
   *  the shared state reads them (`core/shared.ts` `AttributeLookup`). */
  attributes: { get(node: object): ReadonlySet<string> | undefined }
  /** The units that came from LIBRARY files — a bodyless one of these is refused (`isBodylessLibrary`). */
  libraryUnits: ReadonlySet<object>
}

/** Bind parsed files into the project lowering reads. A library's bodies are whatever its files hold — hand in the library
 *  repo's (`libraries/` `withImplementations`) to run one, or its materialized declarations to have it refused. */
export function prepareProject(files: readonly ParsedFile[], manifests: readonly LibraryManifest[]): LoweringProject {
  return {
    // on the exec oracle's target, which the platform integers' width is (frontend-conformance 4.1.1)
    project: build.buildSymbolTable(files, manifests, EXEC_ORACLE_DIALECT, { target: EXEC_ORACLE_TARGET }),
    // every file's: a GVL's or a library's unit carries its own. Only the main source's were read once, so the
    // call_after_global_init_slot method of an FB in `fb_init_before_slot_method_sibling`'s GVL file never ran
    attributes: new Map<object, ReadonlySet<string>>(files.flatMap(attributesOf)),
    libraryUnits: new Set(files.filter((f) => isLibrarySymbol(f)).flatMap((f) => f.parseResult.units)),
  }
}

/**
 * A file's `{attribute …}`s, by unit, member and declaration — read from its RAW TEXT, so they are the slow part of
 * binding (2 ms for the Standard library, against 0.1 ms for its symbol table). Remembered per parse: a library handed
 * to every program of a sweep is scanned once, not once per program.
 */
const attributeCache = new WeakMap<object, readonly (readonly [object, Set<string>])[]>()

export function attributesOf(f: ParsedFile): readonly (readonly [object, Set<string>])[] {
  let found = attributeCache.get(f.parseResult)
  if (found === undefined) {
    found = [...unitAttributes(f.parseResult), ...memberAttributes(f.parseResult), ...declarationAttributes(f.parseResult)]
    attributeCache.set(f.parseResult, found)
  }
  return found
}

/** A file parsed for `prepareProject`. */
export interface ParsedFile {
  uri: string
  source: string
  parseResult: ReturnType<typeof parseSource>
}

/**
 * A project's files as binding takes them, split and parsed ONCE: a `.library` manifest recognised by its name and
 * read by `parseLibraryManifest`, everything else parsed (or its `parseResult` reused). A file that does not parse is
 * named, not built on — a GVL whose `gN : INT := 7` is missing its semicolon was put into the symbol table half-parsed,
 * and the failure resurfaced downstream wearing someone else's name (`aggregate-init`, `place-not-local`).
 */
export function readFiles(files: readonly LibraryFile[]): { files: ParsedFile[]; manifests: LibraryManifest[] } | { unparsed: ParsedFile } {
  const manifests = files.flatMap((l) => parseLibraryManifest(l.uri, l.source) ?? [])
  const parsed = files
    .filter((l) => !l.uri.toLowerCase().endsWith(".library"))
    .map((l) => ({ uri: l.uri, parseResult: l.parseResult ?? parseSource(l.source, TRANSPILE_PARSE), source: l.source }))
  const unparsed = parsed.find((f) => f.parseResult.errors.length > 0)
  return unparsed === undefined ? { files: parsed, manifests } : { unparsed }
}

