/**
 * WHICH MATERIALIZATION WROTE THE WORKSPACE — the format number every library manifest states. A parity contract with
 * the CLI (`LibraryManifest.Materialization` in C#), held by `bun run check`.
 */
import type { LibraryManifest } from "./manifest.js"

/**
 * The materialization this server reads — `LibraryManifest.Materialization` in C#, stated on every library manifest a
 * pull writes. The manifest is the one file a pull always writes that can carry a format number, so it names the whole
 * workspace, not only the library beside it. The two runtimes cannot share the constant; `bun run check`
 * (`scripts/check-wiring.ts`) fails when they disagree, since a mismatch silences every network-text diagnostic.
 */
export const MATERIALIZATION: number = 4

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
