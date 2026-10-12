/**
 * DIAGNOSTIC WORDING — the workspace's own findings: a materialization another Volt wrote, said on its manifests
 * (`checks/workspace/materialization.ts`). No compiler gives these: they are Volt's, one text for both vendors, so they
 * are plain builders beside the `Messages` slices, not in `messagesFor` (whose builders the analysis census holds to
 * the vendors' recordings).
 */

/** A manifest an OLDER Volt wrote (format `format`, below `current`): what the workspace lacks, and the repair — a
 *  re-pull, naming the CLI as the possible stale side (the volt-vscode bundle can be ahead of the CLI on PATH). */
export const libraryStaleMessage = (library: string, format: number, current: number, lacks: readonly string[]): string =>
  `${library} was materialized by an older Volt (format ${format}, now ${current}): ` +
  `${lacks.join("; and ")}. Run \`volt pull\` to re-materialize the workspace. If the pull leaves it at ` +
  `format ${format}, the volt CLI on PATH is the stale side (it writes format ${format}, ` +
  `this language server reads format ${current}): update the volt CLI, then pull.`

/** A manifest a NEWER Volt wrote: this server is the stale side. */
export const materializationNewerMessage = (library: string, format: number, current: number): string =>
  `${library} was materialized by a newer Volt (format ${format}) than this language server reads ` +
  `(format ${current}), so its graphical bodies are not checked. Update the language server (volt-vscode) ` +
  "to the version of the volt CLI that pulled the workspace."
