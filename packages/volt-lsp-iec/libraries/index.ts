/**
 * THE LIBRARY REPO — the code behind a compiled library, written in ST.
 *
 * A project references a library, and `volt pull` materializes it under `Library Manager/<folder>/` as DECLARATIONS:
 * one `.fb`/`.fun` per element, no bodies, plus a `<folder>.library` manifest whose RESOLUTION line names the library
 * and the version the project resolved (`RESOLUTION Standard, 3.5.18.0 (System)`). A declaration is enough to type a
 * call and not enough to run one, so the transpiler refuses a bodyless library element (`call-library`).
 *
 * This folder holds the bodies: `<library>/<version>/<element>.fb|.fun`, each file the materialized declaration with
 * its body written in, so the transpiler lowers it exactly as it lowers the project's own POUs — a library element is
 * not anything else. `withImplementations` is the whole lookup:
 *
 *     project  Library Manager/Standard/Standard.library   RESOLUTION Standard, 3.5.18.0
 *              Library Manager/Standard/TON.fb             the declaration
 *        │  (library, version) → libraries/Standard/3.5.18.0/
 *        ▼
 *              Library Manager/Standard/TON.fb             the SAME uri, now with its body
 *
 * Keyed by the RESOLVED version, never the folder alone: a project on a version this repo has not written keeps its
 * bodyless declarations and stays refused, rather than running another version's code as if it were its own.
 *
 * The one thing a library needs that ST cannot say is what the language provides and the library only uses — `TIME()`
 * for the timers, `s[i]` for the string functions — and the transpiler owns those, as CODESYS does.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { LibraryFile } from "../src/transpile/index.js"

const REPO = import.meta.dirname

/** `RESOLUTION Standard, 3.5.18.0 (System)` → the library and the version the project resolved. */
const resolution = (manifest: string): { library: string; version: string } | undefined => {
  const m = /^RESOLUTION[ \t]+(.+?),[ \t]*(\S+)/m.exec(manifest)
  return m === null ? undefined : { library: m[1]!.trim(), version: m[2]! }
}

/** Where this repo keeps a library version's bodies, or undefined when it has not written that version. */
export function implementationDir(library: string, version: string): string | undefined {
  const dir = join(REPO, library, version)
  return existsSync(dir) ? dir : undefined
}

/**
 * A project's library files with every body this repo holds for the versions its manifests resolve: each element's
 * file replaced under its own uri, and an element the project did not materialize added beside them. Everything else —
 * another library, another version, a GVL passed along — comes back as it was.
 */
export function withImplementations(files: readonly LibraryFile[]): LibraryFile[] {
  const out = [...files]
  const key = (uri: string): string => uri.replaceAll("\\", "/").toLowerCase()
  for (const manifest of files.filter((f) => key(f.uri).endsWith(".library"))) {
    const resolved = resolution(manifest.source)
    const dir = resolved && implementationDir(resolved.library, resolved.version)
    if (dir === undefined) continue
    const folder = manifest.uri.slice(0, manifest.uri.length - manifest.uri.split(/[\\/]/).at(-1)!.length)
    for (const name of readdirSync(dir).filter((n) => /\.(fb|fun)$/.test(n))) {
      const file = { uri: folder + name, source: readFileSync(join(dir, name), "utf8") }
      const at = out.findIndex((f) => key(f.uri) === key(file.uri))
      if (at >= 0) out[at] = file
      else out.push(file)
    }
  }
  return out
}
