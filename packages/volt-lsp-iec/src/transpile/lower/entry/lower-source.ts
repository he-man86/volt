/**
 * AST → IR for one source string: parse, bind (on a library base when one is given), find the program, lower it.
 */

import {
  attributesOf,
  type LibraryFile,
  type LoweringProject,
  type ParsedFile,
  prepareProject,
  readFiles,
  TRANSPILE_PARSE,
} from "../project/prepare.js"
import type { LibraryBase } from "../project/library-base.js"
import { lowerDiagnostic, type LoweredPou } from "../diagnostics/diagnostic.js"
import { parseSource, type TopLevel } from "../../../frontend/syntax/index.js"
import { build, isLibrarySymbol, scopeForUnit } from "../../../frontend/symbols/index.js"
import { ZERO_SPAN } from "../core/build.js"
import { lowerUnit } from "./lower-unit.js"

/** Parse, bind and lower one source string, against the files a project would hand in beside it. The test/CLI path.
 *  `uri` places the source in a project tree — where an `instance-path` takes its device and application from.
 *  `base`, when given, holds the project's libraries already bound (`libraryBase`); `libraries` is then only the
 *  program's other files — its GVLs and sibling POUs, none of them in the base and no `.library` among them. */
export function lowerSource(source: string, name?: string, libraries: readonly LibraryFile[] = [], uri = "transpile://source", base?: LibraryBase): LoweredPou {
  const parseResult = parseSource(source, TRANSPILE_PARSE)
  if (parseResult.errors.length > 0) {
    const first = parseResult.errors[0]!
    return { diagnostics: [lowerDiagnostic("parse", first.message, first.span)] }
  }
  const read = readFiles(libraries)
  if ("unparsed" in read) {
    const first = read.unparsed.parseResult.errors[0]!
    return { diagnostics: [lowerDiagnostic("parse", `${read.unparsed.uri} did not parse: ${first.message}`, first.span)] }
  }
  const own = [{ uri, parseResult, source }, ...read.files]
  if (base === undefined) return lowerPrepared(parseResult, name, prepareProject(own, read.manifests))
  // A CALLER'S MISTAKE, SAID AS ONE — both were silent. A file already in the base is taken off by uri afterwards, and
  // its copy in the base with it, so every later program lowered against a base missing that file; a manifest beside a
  // base was dropped, since the base's are the ones linked against.
  const twice = own.find((f) => base.uris.has(f.uri))
  if (twice !== undefined) throw new Error(`${twice.uri} is already bound in the library base — hand in only the program's own files`)
  if (read.manifests.length > 0) throw new Error("a .library manifest handed beside a library base — bind it into the base (`libraryBase`)")
  return lowerOnBase(parseResult, name, own, base)
}

/** The program's files bound on the base for this lowering only — and taken off again whatever happens, so the next
 *  program starts from the libraries alone. */
function lowerOnBase(parseResult: ReturnType<typeof parseSource>, name: string | undefined, own: readonly ParsedFile[], base: LibraryBase): LoweredPou {
  const project = base.prepared.project
  for (const f of own) build.bindFile(project, f)
  build.relink(project, base.manifests)
  try {
    const libraryUnits = own.filter((f) => isLibrarySymbol(f)).flatMap((f) => f.parseResult.units)
    const attributes = new Map<object, ReadonlySet<string>>(own.flatMap(attributesOf))
    return lowerPrepared(parseResult, name, {
      project,
      // the program's own over the base's — layered, not copied: the base can hold thousands
      attributes: { get: (key) => attributes.get(key) ?? base.prepared.attributes.get(key) },
      libraryUnits: libraryUnits.length === 0 ? base.prepared.libraryUnits : new Set([...base.prepared.libraryUnits, ...libraryUnits]),
    })
  } finally {
    for (const f of own) build.unbindFile(project, f.uri)
    // Taking the files off leaves the base's order canonical and its links as they were — unless a program unit shared
    // a name something in the base EXTENDS, when that link may now point into a removed scope. Only then is it
    // relinked: the whole relink was 0.3 ms of a 1.5 ms lowering (`lowerSource` is run some 10 000 times a suite).
    const named = own.some((f) => f.parseResult.units.some((u) => "name" in u && base.extended.has(u.name.text.toLowerCase())))
    if (named) build.relink(project, base.manifests)
  }
}

/** A unit lowering can run: a PROGRAM or a FUNCTION_BLOCK. */
function isRunnable(u: TopLevel): u is Extract<TopLevel, { kind: "program" | "function_block" }> {
  return u.kind === "program" || u.kind === "function_block"
}

/** Find the program to lower in `parseResult` and lower it against a bound project. */
function lowerPrepared(parseResult: ReturnType<typeof parseSource>, name: string | undefined, prepared: LoweringProject): LoweredPou {
  const unit = parseResult.units
    .filter(isRunnable)
    .find((u) => name === undefined || u.name.text.toUpperCase() === name.toUpperCase())
  if (unit === undefined) {
    const span = parseResult.units[0]?.span ?? ZERO_SPAN
    return {
      diagnostics: [
        lowerDiagnostic("no-unit", `no PROGRAM or FUNCTION_BLOCK${name === undefined ? "" : ` named ${name}`}`, span),
      ],
    }
  }
  const scope = scopeForUnit(prepared.project, unit)
  if (scope === undefined)
    return { diagnostics: [lowerDiagnostic("no-scope", `${unit.name.text} did not bind`, unit.span)] }
  return lowerUnit(unit, scope, prepared)
}
