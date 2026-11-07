/**
 * AN APPLICATION'S TASK CONFIGURATION, CHECKED — its `.task` descriptors (`frontend/syntax/format/task.ts`), each finding
 * on the line it is about, keyed by the descriptor's URI:
 *   - `task-descriptor` (error): a body the format refuses — an unknown or a repeated field, a line with no label, a
 *     malformed watchdog, no `Type:` or `Priority:` — with the bridge's own words;
 *   - `task-value` (error): a value with no meaning as a fact (`taskFacts`) — an interval or a watchdog time that is not a
 *     TIME, a priority that is no number, a type CODESYS does not name;
 *   - `task-call-not-program` (error): a `Calls:` name that names no PROGRAM of the application;
 *   - `program-in-several-tasks` (warning): a PROGRAM two tasks call, on each call.
 * Volt's own wording: no CODESYS recording holds these messages, so they carry no vendor code.
 */
import {
  readTask,
  taskCallSpans,
  taskFacts,
  TaskFormatError,
  taskLabelSpan,
  taskLineSpan,
  taskName,
  type Span,
} from "../../../frontend/syntax/index.js"
import { lookupUnit, type Scope } from "../../../frontend/symbols/index.js"
import { programInSeveralTasksMessage, taskCallNotProgramMessage } from "../../messages/workspace.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

/** A `.task` file as the workspace holds it. */
export interface TaskFile {
  readonly uri: string
  readonly source: string
}

/** Every finding of the application's `.task` files, by URI. `project` is the application's symbol table. */
export function taskFindings(files: readonly TaskFile[], project: Scope): Map<string, DiagnosticItem[]> {
  const out = new Map<string, DiagnosticItem[]>(files.map((f) => [f.uri, []]))
  const callers = new Map<string, { task: string; uri: string; span: Span; name: string }[]>()
  for (const f of files) {
    const found = out.get(f.uri)!
    const task = taskName(f.uri)
    let settings
    try {
      settings = readTask(f.source)
    } catch (e) {
      if (!(e instanceof TaskFormatError)) throw e
      emit(found, taskLineSpan(f.source, e.line ?? 1), "task-descriptor", e.message)
      continue
    }
    const read = taskFacts(task, settings)
    if ("refused" in read) for (const r of read.refused) emit(found, taskLabelSpan(f.source, r.label), "task-value", r.message)
    const spans = taskCallSpans(f.source, settings.calls)
    settings.calls.forEach((call, i) => {
      const kind = lookupUnit(project, call)?.symbol.kind
      if (kind !== "program") return emit(found, spans[i]!, "task-call-not-program", taskCallNotProgramMessage(call, task, kind))
      const key = call.toUpperCase()
      callers.set(key, [...(callers.get(key) ?? []), { task, uri: f.uri, span: spans[i]!, name: call }])
    })
  }
  for (const calls of callers.values()) {
    const tasks = [...new Set(calls.map((c) => c.task))]
    if (tasks.length < 2) continue
    for (const c of calls) emit(out.get(c.uri)!, c.span, "program-in-several-tasks", programInSeveralTasksMessage(c.name, tasks), "warning")
  }
  return out
}
