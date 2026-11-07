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
import { splitLines, readTask, taskFacts, TaskFormatError, taskName, type Span } from "../../../frontend/syntax/index.js"
import { lookupUnit, type Scope } from "../../../frontend/symbols/index.js"
import { programInSeveralTasksMessage, taskCallNotProgramMessage } from "../../messages/workspace.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

/** A `.task` file as the workspace holds it. */
export interface TaskFile {
  readonly uri: string
  readonly text: string
}

/** Lines of a text with the offset each starts at; line numbers are 1-based, columns 0-based. */
function lineStarts(text: string): { lines: string[]; starts: number[] } {
  const lines = splitLines(text)
  const starts: number[] = []
  let at = 0
  for (const line of lines) {
    starts.push(at)
    at += line.length + (text[at + line.length] === "\r" && text[at + line.length + 1] === "\n" ? 2 : 1)
  }
  return { lines, starts }
}

/** The span of `length` characters at `col` of line `line` (1-based), or of the whole line. */
function spanAt(text: string, line: number, col = 0, length?: number): Span {
  const { lines, starts } = lineStarts(text)
  const n = Math.min(Math.max(line, 1), lines.length)
  const width = length ?? (lines[n - 1]?.length ?? 0) - col
  const start = (starts[n - 1] ?? 0) + col
  return { start, end: start + width, startLine: n, startCol: col, endLine: n, endCol: col + width }
}

/** The line a label stands on, or 1 when the file states none. */
function labelLine(text: string, label: string): number {
  const i = lineStarts(text).lines.findIndex((l) => l.includes(":") && l.slice(0, l.indexOf(":")).trim() === label)
  return i < 0 ? 1 : i + 1
}

/** Each call of the `Calls:` line with the span of its name. */
function callSpans(text: string, calls: readonly string[]): Span[] {
  const line = labelLine(text, "Calls")
  const raw = lineStarts(text).lines[line - 1] ?? ""
  let from = raw.indexOf(":") + 1
  return calls.map((call) => {
    const col = raw.indexOf(call, from)
    from = col + call.length
    return spanAt(text, line, col, call.length)
  })
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
      settings = readTask(f.text)
    } catch (e) {
      if (!(e instanceof TaskFormatError)) throw e
      emit(found, spanAt(f.text, e.line ?? 1), "task-descriptor", e.message)
      continue
    }
    const read = taskFacts(task, settings)
    if ("refused" in read) for (const r of read.refused) emit(found, spanAt(f.text, labelLine(f.text, r.label)), "task-value", r.message)
    const spans = callSpans(f.text, settings.calls)
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
