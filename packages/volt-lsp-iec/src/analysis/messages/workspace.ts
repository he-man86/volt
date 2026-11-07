/**
 * DIAGNOSTIC WORDING — the workspace's own findings: a materialization another Volt wrote, said on its manifests
 * (`checks/workspace/materialization.ts`). No compiler gives these: they are Volt's, one text for both vendors, so they
 * are plain builders beside the `Messages` slices, not in `messagesFor` (whose builders the analysis census holds to
 * the vendors' recordings).
 */

/** A manifest an OLDER Volt wrote (format `format`, below `current`): the repair — a re-pull, naming the CLI as the
 *  possible stale side (the volt-vscode bundle can be ahead of the CLI on PATH). */
export const libraryStaleMessage = (library: string, format: number, current: number): string =>
  `${library} was materialized by an older Volt (format ${format}, now ${current}). ` +
  `Run \`volt pull\` to re-materialize the workspace. If the pull leaves it at ` +
  `format ${format}, the volt CLI on PATH is the stale side (it writes format ${format}, ` +
  `this language server reads format ${current}): update the volt CLI, then pull.`

/** A manifest a NEWER Volt wrote: this server is the stale side. */
export const materializationNewerMessage = (library: string, format: number, current: number): string =>
  `${library} was materialized by a newer Volt (format ${format}) than this language server reads ` +
  `(format ${current}), so its graphical bodies are not checked. Update the language server (volt-vscode) ` +
  "to the version of the volt CLI that pulled the workspace."

/** A `Calls:` name that names no PROGRAM: what it is instead, or nothing. */
export const taskCallNotProgramMessage = (call: string, task: string, kind: string | undefined): string =>
  kind === undefined
    ? `'${call}' is no PROGRAM of the application — task '${task}' can call only a PROGRAM`
    : `'${call}' is a ${kind.toUpperCase()}, not a PROGRAM — task '${task}' can call only a PROGRAM`

/** A PROGRAM two or more tasks call: each runs it on the one instance. */
export const programInSeveralTasksMessage = (program: string, tasks: readonly string[]): string =>
  `PROGRAM '${program}' is called by ${tasks.length} tasks (${tasks.join(", ")}): each runs the same instance`
