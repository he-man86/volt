/**
 * THE `.task` FILE FORMAT — a task descriptor under `Task Configuration/`, read and written byte for byte as the bridge
 * does (`packages/volt-cli/src/Volt.Engine/Format/Task/TaskDescriptorFormat.cs`, with `Format/St/Descriptor.cs`'s fixed-pad
 * rendering): the same labels in the same order, values from column 11 (a label that reaches it gets one space), the
 * watchdog as `[off ]<time> <unit> (sensitivity <n>)` with `''` for an empty member, a call's comment after ` // `, and the
 * same refusals, worded as the C# reader words them. `test-corpus`'s `.task` files are the oracle
 * (`task.test.ts`): each reads and writes back to its own bytes.
 *
 * Text only: what a value MEANS (an interval in nanoseconds, a priority as a number) is `parse/task-facts.ts`'s.
 */

/** A task's watchdog: its three vendor members, each as the vendor holds it (`""` for an empty one), and whether it is
 *  enabled. A disabled watchdog keeps its values behind `off`. */
interface TaskWatchdog {
  readonly time: string
  readonly unit: string
  readonly sensitivity: string
  readonly enabled: boolean
}

/** A task member off its measured value, under its own label (`Core: 1`). */
interface TaskMember {
  readonly label: string
  readonly value: string
}

/** Everything a `.task` file says, as data. `interval` and `intervalUnit` stay apart as the vendor keeps them: a unit is
 *  joined only to a bare number (`20 ms`), never to a TIME literal (`t#4ms`, unit `""`). */
export interface TaskSettings {
  readonly type: string
  readonly interval: string
  readonly intervalUnit: string
  readonly priority: string
  readonly event?: string
  /** Absent: the bare `off` of a task that has no watchdog member (TwinCAT's). */
  readonly watchdog?: TaskWatchdog
  /** The PROGRAMs the task calls, in call order. */
  readonly calls: readonly string[]
  readonly externalEvent?: string
  /** One per call, `""` for none, index-aligned with `calls`; absent when no call has one. */
  readonly callComments?: readonly string[]
  /** The members off their measured value, in `TASK_MEMBER_LABELS` order. */
  readonly members?: readonly TaskMember[]
}

/** A `.task` body that does not read: the C# reader's message, and the line it names (absent where it names none). */
export class TaskFormatError extends Error {
  constructor(
    message: string,
    readonly line?: number,
  ) {
    super(message)
    this.name = "TaskFormatError"
  }
}

/** The column values start at — 11, inherited by the C# format and hashed into every item's version. */
const PAD = 11
const OFF = "off"
const EMPTY = "''"
const COMMENT_MARK = " // "

/** Every off-default member label, CODESYS's then TwinCAT's, in the order the file states them. */
const TASK_MEMBER_LABELS: readonly string[] = [
  "Core",
  "Core2",
  "Task group",
  "Allow empty",
  "Implicit",
  "Within SPS time slicing",
  "Synch task",
  "Auto start",
  "IO at begin",
  "Exceed warning",
  "Create symbols",
  "Ext sync",
  "Tick modulo",
  "Input update pre ticks",
  "Disable FP exceptions",
  "Watchdog stack capacity",
  "CPU affinity",
]

/** The labels a task field may carry, in the file's order — the members' after the seven of its own. */
const FIELD_LABELS = ["Type", "Interval", "Priority", "Event", "External event", "Watchdog", "Calls"] as const

/** A digit as C#'s `char.IsDigit` reads one: any Unicode decimal digit. */
const isNumberChar = (c: string): boolean => /^[\p{Nd}.+-]$/u.test(c)

/** A vendor string on one line: CR dropped, LF to a space, trimmed (`Descriptor.Flatten`). */
const flatten = (value: string | undefined): string => (value ?? "").replace(/\r/g, "").replace(/\n/g, " ").trim()

/** A unit joined to a BARE number only (`Descriptor.Unitize`): `t#20ms` keeps its letters and takes no unit. */
function unitize(value: string, unit: string): string {
  const v = value.trim()
  const u = unit.trim()
  if (v.length === 0) return ""
  return [...v].every(isNumberChar) && u.length > 0 ? `${v} ${u}` : v
}

/** A member as its token: trimmed, `''` when empty. */
const token = (value: string): string => (value.trim().length === 0 ? EMPTY : value.trim())

const watchdogText = (w: TaskWatchdog | undefined): string =>
  w === undefined ? OFF : `${w.enabled ? "" : `${OFF} `}${token(w.time)} ${token(w.unit)} (sensitivity ${token(w.sensitivity)})`

/** The comment of call `index` — `""` for none. Calls and comments are one list in two halves: a count that does not
 *  match is refused, never read against the wrong call. */
function commentOf(t: TaskSettings, index: number): string {
  const comments = t.callComments
  if (comments === undefined || comments.length === 0) return ""
  if (comments.length !== t.calls.length)
    throw new Error(`a task's ${t.calls.length} call(s) carry ${comments.length} comment(s) — the two lists are index-aligned`)
  return comments[index]!
}

/** Render settings to the file body — the bytes the bridge writes for the same settings. */
export function writeTask(t: TaskSettings): string {
  const lines: [string, string | undefined][] = [
    ["Type", t.type],
    ["Interval", unitize(t.interval, t.intervalUnit)],
    ["Priority", t.priority],
    ["Event", t.event],
    ["External event", t.externalEvent],
    ["Watchdog", watchdogText(t.watchdog)],
  ]
  // no `Calls:` line on a task that drives nothing — an empty one would read as a call of something unnamed
  if (t.calls.length > 0)
    lines.push(["Calls", t.calls.map((c, i) => (commentOf(t, i).length > 0 ? c + COMMENT_MARK + commentOf(t, i) : c)).join(", ")])
  for (const label of TASK_MEMBER_LABELS) {
    const value = t.members?.find((m) => m.label === label)?.value
    if (value !== undefined) lines.push([label, value.length === 0 ? EMPTY : value])
  }
  let out = ""
  for (const [label, raw] of lines) {
    const value = flatten(raw)
    if (value.length === 0) continue
    let head = `${label}:`.padEnd(PAD)
    if (head.length === label.length + 1) head += " "
    out += `${head}${value}\n`
  }
  return out
}

/** One field's value and the line it stands on. */
interface FieldLine {
  readonly value: string
  readonly line: number
}

/** The lines of a body as label → value and line, every refusal of a line the C# reader's. */
function fieldLines(text: string): { fields: Map<string, FieldLine>; members: TaskMember[] } {
  const fields = new Map<string, FieldLine>()
  const members: TaskMember[] = []
  const seen = new Map<string, number>()
  const raws = text.replace(/\r/g, "").split("\n")
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i]!
    const lineNo = i + 1
    if (raw.trim().length === 0) continue
    const colon = raw.indexOf(":")
    if (colon < 0) throw new TaskFormatError(`line ${lineNo}: expected \`Label: value\`, found '${raw.trim()}'`, lineNo)
    const label = raw.slice(0, colon).trim()
    const value = raw.slice(colon + 1).trim()
    // one value per field: a second line of a label would silently replace the first (a second `Calls:` stops the task
    // calling a program), so it is refused by name and line, not last-wins
    const first = seen.get(label)
    if (first !== undefined)
      throw new TaskFormatError(`line ${lineNo}: '${label}' is written twice (first on line ${first}) — a task field holds one value`, lineNo)
    if ((FIELD_LABELS as readonly string[]).includes(label)) fields.set(label, { value, line: lineNo })
    else if (TASK_MEMBER_LABELS.includes(label)) members.push({ label, value: value === EMPTY ? "" : value })
    else
      throw new TaskFormatError(
        `line ${lineNo}: '${label}' is not a task field. Expected one of ${[...FIELD_LABELS, ...TASK_MEMBER_LABELS].join(", ")}.`,
        lineNo,
      )
    seen.set(label, lineNo)
  }
  return { fields, members }
}

/** `3200 µs` → [3200, µs]; `t#4ms` → [t#4ms, ""] — a value carrying letters keeps them and has no unit. */
function splitUnit(s: string): [string, string] {
  const v = s.trim()
  if (v.length === 0) return ["", ""]
  const sp = v.indexOf(" ")
  if (sp < 0) return [v, ""]
  const head = v.slice(0, sp)
  return [...head].every(isNumberChar) ? [head, v.slice(sp + 1).trim()] : [v, ""]
}

/** `[off ]<time> <unit> (sensitivity <n>)`, or `off` / nothing for no watchdog member. */
function readWatchdog(s: string, line: number | undefined): TaskWatchdog | undefined {
  const v = s.trim()
  if (v.length === 0 || v === OFF) return undefined
  const open = v.lastIndexOf("(")
  if (open < 0 || !v.endsWith(")"))
    throw new TaskFormatError(`watchdog '${v}': expected \`[off ]<time> <unit> (sensitivity <n>)\` or \`off\``, line)
  const inner = v.slice(open + 1, v.length - 1).trim()
  const prefix = "sensitivity"
  if (inner.slice(0, prefix.length).toLowerCase() !== prefix)
    throw new TaskFormatError(`watchdog '${v}': expected \`(sensitivity <n>)\`, found '(${inner})'`, line)
  const words = v.slice(0, open).split(" ").filter((w) => w.length > 0)
  const enabled = !(words.length > 0 && words[0] === OFF)
  if (!enabled) words.shift()
  // the time and its unit, two words: which unit the time is in is three orders of magnitude, and nothing may imply it
  if (words.length !== 2)
    throw new TaskFormatError(
      `watchdog '${v}': expected its time and its unit as two words — \`<time> <unit>\`, \`''\` for an empty one ` +
        "(`Watchdog: 3200 µs (sensitivity 1)`, `Watchdog: off '' ms (sensitivity 1)`)",
      line,
    )
  const member = (t: string): string => (t === EMPTY ? "" : t)
  return { time: member(words[0]!), unit: member(words[1]!), sensitivity: member(inner.slice(prefix.length).trim()), enabled }
}

/** The calls in order, and each one's comment (`A // comment`; `""` for none). */
function readCalls(s: string): { names: string[]; comments: string[] } {
  const names: string[] = []
  const comments: string[] = []
  for (const part of s.split(",")) {
    const p = part.trim()
    if (p.length === 0) continue
    const mark = p.indexOf("//")
    names.push(mark < 0 ? p : p.slice(0, mark).trim())
    comments.push(mark < 0 ? "" : p.slice(mark + 2).trim())
  }
  return { names, comments }
}

/** A task's name: its `.task` file's base name (`…/Task%20Configuration/MainTask.task` → `MainTask`), from a path or a
 *  file URI. */
export function taskName(uri: string): string {
  const base = uri.slice(Math.max(uri.lastIndexOf("/"), uri.lastIndexOf("\\")) + 1).replace(/\.task$/i, "")
  return uri.includes("://") ? decodeURIComponent(base) : base
}

/** Read a `.task` body. Throws `TaskFormatError` on anything it cannot account for — a field it does not know would be
 *  dropped on the way back, which is the one outcome worth failing for. A body in another order or spacing reads into the
 *  same settings; `writeTask` gives its canonical bytes. */
export function readTask(text: string): TaskSettings {
  const { fields, members } = fieldLines(text)
  const value = (label: (typeof FIELD_LABELS)[number]): string | undefined => fields.get(label)?.value
  const type = value("Type")
  if (type === undefined) throw new TaskFormatError("no 'Type:' line — a task must say what kind it is")
  const priority = value("Priority")
  if (priority === undefined) throw new TaskFormatError("no 'Priority:' line")
  const [interval, intervalUnit] = splitUnit(value("Interval") ?? "")
  const { names, comments } = readCalls(value("Calls") ?? "")
  const event = value("Event")
  const externalEvent = value("External event")
  const watchdog = readWatchdog(value("Watchdog") ?? "", fields.get("Watchdog")?.line)
  const rank = (m: TaskMember): number => TASK_MEMBER_LABELS.indexOf(m.label)
  return {
    type,
    interval,
    intervalUnit,
    priority,
    ...(event ? { event } : {}),
    ...(watchdog === undefined ? {} : { watchdog }),
    calls: names,
    ...(externalEvent ? { externalEvent } : {}),
    // no comment at all is the measured absence: stated as none, not as a list of empties
    ...(comments.some((c) => c.length > 0) ? { callComments: comments } : {}),
    members: [...members].sort((a, b) => rank(a) - rank(b)),
  }
}
