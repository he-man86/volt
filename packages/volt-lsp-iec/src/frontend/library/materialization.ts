/**
 * WHICH MATERIALIZATION WROTE THE WORKSPACE — the format number every library manifest states, and what a workspace an
 * older format pulled lacks. A parity contract with the CLI (`LibraryManifest.Materialization` in C#), held by
 * `bun run check`.
 */
import type { LibraryManifest } from "./manifest.js"

/**
 * Every materialization format since the first, each with what a workspace an OLDER format pulled lacks against it, in
 * the words the stale manifest's warning uses (`libraryManifestDiagnostics`). Nothing in the LSP fills either gap —
 * the manifest is told to re-pull instead.
 *  - 2: FUNCTIONs without a return type are rendered; format 1 skipped them, so a call to one read as undefined here,
 *    where a library is known only through its materialization.
 *  - 3: graphical bodies are network text v2; format 2 wrote v1, which this server refuses body by body.
 *  - 4: every body states its language on an `IMPLEMENTATION <LANG>` line; format 3 marked the boundary with a comment,
 *    so no body in it states a language and a graphical one reads as ST (openspec implementation-keyword).
 *
 * The LAST row IS the format this server reads (`MATERIALIZATION`), so bumping it is adding a row: a separate number
 * beside this list could move without it, and the stale warning then printed an empty clause instead of failing.
 */
export const MATERIALIZATION_FORMATS: readonly (readonly [format: number, lacks: string])[] = [
  [2, "it skipped FUNCTIONs without a return type, so a call to one reads as undefined"],
  [3, "its graphical bodies are network text v1, which this language server does not read"],
  [4, "its bodies mark where they start with a comment instead of an IMPLEMENTATION line, so none states its language"],
]

/**
 * The materialization this server reads — `LibraryManifest.Materialization` in C#, stated on every library manifest a
 * pull writes. The manifest is the one file a pull always writes that can carry a format number, so it names the whole
 * workspace, not only the library beside it. The two runtimes cannot share the constant; `bun run check`
 * (`scripts/check-wiring.ts`) fails when they disagree, since a mismatch silences every network-text diagnostic.
 */
export const MATERIALIZATION: number = MATERIALIZATION_FORMATS[MATERIALIZATION_FORMATS.length - 1]![0]

/** The manifests a pull by an OLDER Volt wrote — the workspace holds files the current format writes otherwise. */
export function staleLibraryManifests(manifests: readonly LibraryManifest[]): LibraryManifest[] {
  return manifests.filter((m) => m.materialization < MATERIALIZATION)
}

/** The manifests a pull by a NEWER Volt wrote — this server is the stale side (a volt-vscode bundle lagging the CLI). */
export function newerLibraryManifests(manifests: readonly LibraryManifest[]): LibraryManifest[] {
  return manifests.filter((m) => m.materialization > MATERIALIZATION)
}

/** Did any pull other than this server's format write the workspace? Then its graphical bodies are in a form this
 *  server does not read, and the manifests say so once instead of every body being flagged. */
export function materializationMismatch(manifests: readonly LibraryManifest[]): boolean {
  return manifests.some((m) => m.materialization !== MATERIALIZATION)
}
