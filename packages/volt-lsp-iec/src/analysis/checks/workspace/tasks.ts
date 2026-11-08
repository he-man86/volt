/**
 * AN APPLICATION'S TASK CONFIGURATION, CHECKED AS CODESYS BUILDS IT — its `.task` descriptors (`frontend/syntax/format/task.ts`),
 * each finding on the line it is about, keyed by the descriptor's URI. CODESYS 3.5.21.40 compiles a task as code, so its
 * build says what it says of that code (measured 2026-11-08, a task of the recording project's application pushed and built):
 *
 *   - a `Calls:` entry is the call statement `<name>();` in the application's global scope: a PROGRAM, a FUNCTION every
 *     input of which has a default, or a global FB instance builds; anything else gets the ST call's own words — "Identifier
 *     'X' not defined" and "Program name, function or function block instance expected instead of 'X'", "Function block 'X'
 *     must be instantiated to be accessed", "Function 'X' requires exactly '1' inputs", "Cannot call object of type 'TYPE'"
 *     (a struct) / 'VAR_GLOBAL' (an enum, a global list) / 'INTERFACE', "Type name 'X' not expected in this place";
 *   - the interval and the watchdog time are converted to DWORD and the priority to INT, as values: a name is resolved and
 *     converted ("Cannot convert type 'TIME' to type 'DWORD'", a DWORD constant builds); a time that is not above zero, or
 *     a text that is no time, is "<task>: The task interval is invalid.", one of 2^31 ms or more "… invalid. The maximum is
 *     exceeded."; a priority literal past 31, or no literal, "<task>: The task priority is invalid." (a constant is taken as
 *     it is: 32 builds); an enabled watchdog with no time "<task>: The watchdog time is invalid." (0 ms builds).
 *
 * What the device decides is not judged: on the recording project's device t#1ms … t#10m build and t#100us, t#71m and
 * t#24d do not ("The task interval is invalid."), and the bounds are the device's, which no descriptor states. A PROGRAM
 * two tasks call, or one task twice, builds silently. A body the format refuses is `task-descriptor`, in the bridge's
 * words, and an unknown `Type:` is refused by the push, in its words. TwinCAT's build of a task is unmeasured: there only
 * the format is judged.
 */
import { readTask, TASK_TYPES, taskCallSpans, TaskFormatError, taskLabelSpan, taskLineSpan, taskName, taskTimeNs, type CallExpr, type Span, type TaskSettings } from "../../../frontend/syntax/index.js"
import { lookup, type Scope } from "../../../frontend/symbols/index.js"
import { inferExprType, isAssignable, renderType, resolveCallee, resolveNamedType } from "../../../frontend/types/index.js"
import type { Vendor } from "../../config.js"
import { messagesFor, type Messages } from "../../messages/index.js"
import { emit, type DiagnosticItem } from "../../shared/diagnostic-item.js"

/** A `.task` file as the workspace holds it. */
export interface TaskFile {
  readonly uri: string
  readonly source: string
}

/** Every finding of the application's `.task` files, by URI. `project` is the application's symbol table. */
export function taskFindings(files: readonly TaskFile[], project: Scope, vendor: Vendor): Map<string, DiagnosticItem[]> {
  const out = new Map<string, DiagnosticItem[]>(files.map((f) => [f.uri, []]))
  const m = messagesFor("codesys")
  for (const f of files) {
    const found = out.get(f.uri)!
    let settings
    try {
      settings = readTask(f.source)
    } catch (e) {
      if (!(e instanceof TaskFormatError)) throw e
      emit(found, taskLineSpan(f.source, e.line ?? 1), "task-descriptor", e.message)
      continue
    }
    if (vendor !== "codesys") continue
    const at = (label: string): Span => taskLabelSpan(f.source, label)
    const task = taskName(f.uri)
    if (!TASK_TYPES.includes(settings.type))
      emit(found, at("Type"), "task-value", `CODESYS: '${settings.type}' is not a task type. A \`.task\` file's \`Type:\` line must name one of ${TASK_TYPES.join(", ")}.`)
    for (const [code, message] of valueFindings(task, settings, project, m)) emit(found, at(message.label), code, message.text)
    const spans = taskCallSpans(f.source, settings.calls)
    settings.calls.forEach((call, i) => {
      for (const [code, message] of callFindings(call, spans[i]!, project, m)) emit(found, spans[i]!, code, message)
    })
  }
  return out
}

type Finding = readonly [code: string, message: string]

/** 2^31 ms in ns — the interval CODESYS calls past its maximum (`t#24d20h31m23s648ms`; one ms less is the device's). */
const INTERVAL_MAX_NS = 2n ** 31n * 1_000_000n
const NAME = /^[A-Za-z_]\w*$/
const WHOLE = /^\d+$/

/** The interval's, the priority's and the watchdog time's findings, each under the label it stands on. */
function valueFindings(task: string, s: TaskSettings, project: Scope, m: Messages): [string, { label: string; text: string }][] {
  const out: [string, { label: string; text: string }][] = []
  const on = (label: string) => (f: Finding) => out.push([f[0], { label, text: f[1] }])
  const invalid = (what: string, more = "") => [`task-value`, `${task}: The ${what} is invalid.${more}`] as const
  if (s.interval.length > 0) timeFindings(s.interval, s.intervalUnit, project, m, invalid("task interval")).forEach(on("Interval"))
  else if (s.type === "Cyclic") on("Interval")(invalid("task interval"))
  if (NAME.test(s.priority)) valueOfType(s.priority, "INT", project, m).forEach(on("Priority"))
  else if (!WHOLE.test(s.priority) || Number(s.priority) > 31) on("Priority")(invalid("task priority"))
  const w = s.watchdog
  if (w?.enabled === true && w.time.length === 0) on("Watchdog")(invalid("watchdog time"))
  else if (w?.enabled === true && NAME.test(w.time) && taskTimeNs(w.time, w.unit) === undefined) valueOfType(w.time, "DWORD", project, m).forEach(on("Watchdog"))
  return out
}

/** An interval as written: a name is a value converted to DWORD; a time not above zero, or no time at all, is `invalid`;
 *  one of 2^31 ms or more is past the maximum. A time between is the device's to judge, and is not. */
function timeFindings(value: string, unit: string, project: Scope, m: Messages, invalid: Finding): Finding[] {
  const ns = taskTimeNs(value, unit)
  if (ns === undefined) return NAME.test(value) ? valueOfType(value, "DWORD", project, m) : [invalid]
  if (ns <= 0n) return [invalid]
  return ns >= INTERVAL_MAX_NS ? [[invalid[0], `${invalid[1]} The maximum is exceeded.`]] : []
}

/** A name written as a task value, converted to `into`: what CODESYS says of `<into> := name`. */
function valueOfType(name: string, into: string, project: Scope, m: Messages): Finding[] {
  if (lookup(project, name) === undefined)
    return [["unresolved-identifier", m.undefinedIdentifier(name)], ["assignment-type-mismatch", m.cannotConvert(m.unknownType(name), into)]]
  const t = inferExprType(ident(name), project, project)
  const target = resolveNamedType(into, project, undefined)
  if (t.kind === "unknown" || isAssignable(target, t)) return []
  return [["assignment-type-mismatch", m.cannotConvert(renderType(t, { form: "compiler" }), into)]]
}

const ZERO: Span = { start: 0, end: 0, startLine: 0, startCol: 0, endLine: 0, endCol: 0 }
const ident = (name: string) => ({ kind: "ident_expr" as const, name, span: ZERO })

/** What CODESYS says of the call statement `<call>();` a task makes, by what the name denotes. A kind no recording asks
 *  (an alias, a union, a namespace) is not judged. */
function callFindings(call: string, span: Span, project: Scope, m: Messages): Finding[] {
  const sym = lookup(project, call)?.symbol
  if (sym === undefined) return [["unresolved-identifier", m.undefinedIdentifier(call)], ["invalid-call-target", m.callTargetExpected(call)]]
  switch (sym.kind) {
    case "program":
      return []
    case "function_block":
      return [["fb-not-instantiated", m.fbMustBeInstantiated(call)]]
    case "interface":
      return [["invalid-call-target", m.cannotCallObjectOfType("INTERFACE")], ["interface-not-instantiated", m.interfaceMustBeInstantiated(call)]]
    case "gvl_block":
      return [["invalid-call-target", m.cannotCallObjectOfType("VAR_GLOBAL")]]
    case "gvl_var":
      return inferExprType(ident(call), project, project).kind === "function_block" ? [] : [["invalid-call-target", m.callTargetExpected(call)]]
    case "function":
      return functionInputs(call, span, project, m)
    case "type": {
      const t = resolveNamedType(call, project, sym.uri).kind
      const object = t === "struct" ? "TYPE" : t === "enum" ? "VAR_GLOBAL" : undefined
      return object === undefined ? [] : [["invalid-call-target", m.cannotCallObjectOfType(object)], ["type-name-as-value", m.typeNameNotExpected(call)]]
    }
    default:
      return []
  }
}

/** A FUNCTION called with no argument: its inputs without a default and its in-outs are required, said as an ST call says
 *  them (`call-arguments` `checkRequiredInputs`) — "exactly" where every input is required, a range where some have one. */
function functionInputs(call: string, span: Span, project: Scope, m: Messages): Finding[] {
  const callee = resolveCallee({ kind: "call", callee: { ...ident(call), span }, args: [], span } as unknown as CallExpr, project, project)
  if (callee === undefined) return []
  const inOuts = callee.positional.filter((p) => p.inOut).length
  const min = callee.params.filter((p) => !p.hasDefault).length + inOuts
  const max = callee.params.length + inOuts
  if (min === 0) return []
  return [["function-argument-count", min === max ? m.functionRequiresInputs(call, max) : m.functionRequiresInputRange(call, min, max)]]
}
