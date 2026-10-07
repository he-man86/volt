/**
 * A project's libraries, bound once, for a sweep that lowers many programs against the same references.
 */

import { type LibraryFile, type LoweringProject, prepareProject, readFiles } from "./prepare.js"
import type { LibraryManifest } from "../../../frontend/library/index.js"

/**
 * A PROJECT'S LIBRARIES, BOUND ONCE — for a sweep that lowers many programs against the same references.
 *
 * The conformance replay lowers some 2600 programs against the fixture project's 31 libraries (857 files), and bound
 * them from scratch for every one: 13 ms a program, several times per program across the gates, which is what pushed a
 * gate past its hang guard. The libraries do not change between programs, so they are bound here once, and
 * `lowerSource` binds a program's own files ON TOP of them and takes them off again — the same shape the LSP replay
 * already uses for the fixtures' declarations.
 *
 * Exactly the table `prepareProject` would build from all the files together, with one difference: a program unit
 * named like a library's NAMESPACE no longer hides that namespace, since the namespaces are bound before it.
 */
export interface LibraryBase {
  readonly prepared: LoweringProject
  readonly manifests: readonly LibraryManifest[]
  /** Every file the base holds, by uri — a program's file of the same uri would be taken off WITH it (`lowerSource`). */
  readonly uris: ReadonlySet<string>
  /** Every name a base unit EXTENDS, lower-cased — a program unit named so can change which base that unit links to. */
  readonly extended: ReadonlySet<string>
}

/** Bind a project's library files — declarations, bodies and `.library` manifests — once. */
export function libraryBase(libraries: readonly LibraryFile[]): LibraryBase {
  const read = readFiles(libraries)
  if ("unparsed" in read) throw new Error(`${read.unparsed.uri} did not parse: ${read.unparsed.parseResult.errors[0]!.message}`)
  const prepared = prepareProject(read.files, read.manifests)
  const extended = new Set(prepared.project.children.flatMap((c) => (c.extendsName === undefined ? [] : [c.extendsName.toLowerCase()])))
  return { prepared, manifests: read.manifests, uris: new Set(read.files.map((f) => f.uri)), extended }
}
