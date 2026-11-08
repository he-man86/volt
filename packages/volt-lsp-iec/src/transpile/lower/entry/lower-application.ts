/**
 * AN APPLICATION BY ITS TASK CONFIGURATION — the `.task` descriptors read (`readTask`), their values read as facts
 * (`taskFacts`), and every Cyclic task's PROGRAM calls lowered into ONE POU, so all tasks run on the same globals and the
 * same instance of each PROGRAM. The scheduler is the host's: it runs a task by `runApplication(…).runTask(name)` on its
 * own clock, and reads the interval, priority and watchdog from the facts — never from the descriptor text.
 *
 * The calls are lowered as a PROGRAM's call statements are: the tasks' entry is a PROGRAM (`TASK_ENTRY`) whose body calls
 * each task's PROGRAMs in turn, one call per line, so each lowered statement is the task's whose call stands on its line.
 * A refusal in the entry is reported on the `.task` call it comes from. Only a Cyclic task runs (its calls lowered); a task
 * of another type is read, its facts reported, and runs nothing.
 *
 * With no `.task`, the application is its main program lowered exactly as `lowerSource` lowers it, and runs as one
 * implicit task named after it — no facts, since nothing states them.
 */
import {
  readTask,
  taskCallSpans,
  taskFacts,
  type TaskFacts,
  TaskFormatError,
  taskLabelSpan,
  taskLineSpan,
  taskName,
  type Span,
} from "../../../frontend/syntax/index.js"
import type { IrApplication, IrStmt, IrTask } from "../../ir/index.js"
import { LoweringBug } from "../../semantics/faults.js"
import { type LibraryFile, type ParsedFile, readFiles } from "../project/prepare.js"
import type { LibraryBase } from "../project/library-base.js"
import { lowerDiagnostic, type LowerDiagnostic } from "../diagnostics/diagnostic.js"
import { ZERO_SPAN } from "../core/build.js"
import { lowerSource } from "./lower-source.js"

/** A `.task` file as the host holds it. */
export interface TaskFile {
  readonly uri: string
  readonly source: string
}

/** What lowering an application answers with: its IR and its tasks' facts, or the refusals that say why it could not. */
export interface LoweredApplication {
  /** Present only when the application lowered with no diagnostics. */
  readonly application?: IrApplication
  /** Each stated task's facts, in the order the `.task` files were handed in — present with `application`; empty when no
   *  `.task` states any. */
  readonly tasks?: readonly TaskFacts[]
  readonly diagnostics: readonly LowerDiagnostic[]
}

/** The PROGRAM the tasks' calls are lowered in. A project that declares a unit of this name is refused (`task-entry`). */
const TASK_ENTRY = "__VOLT_TASKS"
const ENTRY_URI = "transpile://tasks"

/** One call of the entry: the task it is in and where its `.task` names it. */
interface CallSite {
  readonly task: string
  readonly uri: string
  readonly span: Span
}

/**
 * Lower the application `files` hold (its POUs and GVLs, its libraries' files, or — with `base` — the program's own
 * files only, as `lowerSource` takes them) by the task configuration `tasks` states; with no task, lower `main` as its one
 * implicit task.
 *
 * THE PROJECT'S SETTINGS ARE ONE OF `files`: its `.projectsettings` (the bridge's descriptor, as pulled) states the Compile
 * option "UTF-8 Encoding for STRING", which decides the bytes a STRING literal past ASCII holds and how WSTRING_TO_STRING /
 * STRING_TO_WSTRING cross — on: UTF-8; off: Latin-1 with '?' past it for a literal, a unit's low byte and a byte-for-byte
 * widen for a conversion. Handed none, or one with no such row (TwinCAT's), the setting is unstated and each of those is
 * refused (`string-encoding-unstated`) — never run on a default. Two `.projectsettings`, or a row neither on nor off, are
 * refused (`project-settings`).
 */
export function lowerApplication(files: readonly LibraryFile[], tasks: readonly TaskFile[], main?: string, base?: LibraryBase): LoweredApplication {
  const read = readFiles(files)
  if ("unparsed" in read) {
    const first = read.unparsed.parseResult.errors[0]!
    return { diagnostics: [lowerDiagnostic("parse", `${read.unparsed.uri} did not parse: ${first.message}`, first.span, read.unparsed.uri)] }
  }
  // the files `lowerSource` reads again: the parsed ones, the manifests and the project's settings
  const handed = [...read.files, ...files.filter((f) => f.uri.toLowerCase().endsWith(".library")), ...read.settings]
  if (tasks.length === 0) {
    if (main === undefined) throw new Error("an application with no .task names its main program — the implicit task's one call")
    return implicitTask(read.files, handed, main, base)
  }
  const stated = statedTasks(read.files, tasks)
  if ("diagnostics" in stated) return stated
  const sites = stated.cyclic.flatMap((t) => t.calls)
  const entry = `PROGRAM ${TASK_ENTRY}\n${sites.map((s) => `${s.name}();\n`).join("")}END_PROGRAM\n`
  const lowered = lowerSource(entry, TASK_ENTRY, handed, ENTRY_URI, base)
  if (lowered.pou === undefined) return { diagnostics: lowered.diagnostics.map((d) => (d.uri === ENTRY_URI ? atCall(d, sites, stated.first) : d)) }
  // the entry's statement on line k + 2 is call k's
  const bodies = new Map<string, IrStmt[]>(stated.cyclic.map((t) => [t.task, []]))
  for (const stmt of lowered.pou.body) {
    const site = sites[stmt.span.startLine - 2]
    if (site === undefined) throw new LoweringBug(`the task entry's statement on line ${stmt.span.startLine} is no task's call`)
    bodies.get(site.task)!.push(stmt)
  }
  const application: IrApplication = { pou: lowered.pou, tasks: [...bodies].map(([name, body]): IrTask => ({ name, body })) }
  return { application, tasks: stated.facts, diagnostics: [] }
}

/** No `.task`: the main program lowered as `lowerSource` lowers it, its body the implicit task's. */
function implicitTask(parsed: readonly ParsedFile[], handed: readonly LibraryFile[], main: string, base: LibraryBase | undefined): LoweredApplication {
  const own = parsed.find((f) => f.parseResult.units.some((u) => (u.kind === "program" || u.kind === "function_block") && u.name.text.toUpperCase() === main.toUpperCase()))
  if (own === undefined) {
    const first = handed[0]
    if (first === undefined) throw new Error(`no file is handed in, so none declares ${main}`)
    return { diagnostics: [lowerDiagnostic("no-unit", `no PROGRAM or FUNCTION_BLOCK named ${main}`, ZERO_SPAN, first.uri)] }
  }
  const lowered = lowerSource(own.source, main, handed.filter((f) => f !== own), own.uri, base)
  if (lowered.pou === undefined) return { diagnostics: lowered.diagnostics }
  return { application: { pou: lowered.pou, tasks: [{ name: main, body: lowered.pou.body }] }, tasks: [], diagnostics: [] }
}

/** A refusal in the tasks' entry, reported where the `.task` names the call it stands on — or, on the entry itself, on the
 *  first `.task`. */
function atCall(d: LowerDiagnostic, sites: readonly (CallSite & { name: string })[], first: CallSite): LowerDiagnostic {
  const site = sites[d.span.startLine - 2] ?? first
  return { ...d, uri: site.uri, span: site.span }
}

/** The stated tasks read: each one's facts, each Cyclic one's calls with where they stand — or every refusal. */
function statedTasks(
  parsed: readonly ParsedFile[],
  tasks: readonly TaskFile[],
): { facts: TaskFacts[]; cyclic: { task: string; calls: (CallSite & { name: string })[] }[]; first: CallSite } | { diagnostics: LowerDiagnostic[] } {
  const programs = new Set(parsed.flatMap((f) => f.parseResult.units.flatMap((u) => (u.kind === "program" ? [u.name.text.toUpperCase()] : []))))
  const units = new Set(parsed.flatMap((f) => f.parseResult.units.flatMap((u) => ("name" in u ? [u.name.text.toUpperCase()] : []))))
  const diagnostics: LowerDiagnostic[] = []
  const facts: TaskFacts[] = []
  const cyclic: { task: string; calls: (CallSite & { name: string })[] }[] = []
  const names = new Set<string>()
  for (const t of tasks) {
    const name = taskName(t.uri)
    if (names.has(name.toUpperCase())) diagnostics.push(lowerDiagnostic("task-entry", `two .task files name the task ${name}`, ZERO_SPAN, t.uri))
    names.add(name.toUpperCase())
    let settings
    try {
      settings = readTask(t.source)
    } catch (e) {
      if (!(e instanceof TaskFormatError)) throw e
      diagnostics.push(lowerDiagnostic("task-descriptor", e.message, taskLineSpan(t.source, e.line ?? 1), t.uri))
      continue
    }
    const read = taskFacts(name, settings)
    if ("refused" in read) for (const r of read.refused) diagnostics.push(lowerDiagnostic("task-value", r.message, taskLabelSpan(t.source, r.label), t.uri))
    const spans = taskCallSpans(t.source, settings.calls)
    settings.calls.forEach((call, i) => {
      if (!programs.has(call.toUpperCase()))
        diagnostics.push(lowerDiagnostic("task-call", `'${call}' is no PROGRAM of the application — task '${name}' can call only a PROGRAM`, spans[i]!, t.uri))
    })
    if ("facts" in read) facts.push(read.facts)
    if (settings.type === "Cyclic") cyclic.push({ task: name, calls: settings.calls.map((call, i) => ({ task: name, uri: t.uri, span: spans[i]!, name: call })) })
  }
  if (units.has(TASK_ENTRY)) diagnostics.push(lowerDiagnostic("task-entry", `the project declares ${TASK_ENTRY}, the name the tasks' calls are lowered in`, ZERO_SPAN, tasks[0]!.uri))
  if (diagnostics.length > 0) return { diagnostics }
  return { facts, cyclic, first: { task: taskName(tasks[0]!.uri), uri: tasks[0]!.uri, span: taskLabelSpan(tasks[0]!.source, "Calls") } }
}
