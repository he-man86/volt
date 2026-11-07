/**
 * WHAT A TASK'S DESCRIPTOR MEANS — its settings (`format/task.ts`) read as the facts a host schedules by: the type, the
 * interval and the watchdog time in nanoseconds, the priority and the sensitivity as numbers, the calls in order. A value
 * that has no such meaning is refused by its label, never defaulted (the analysis reports each refusal on its line).
 *
 * A time is a TIME literal (`t#20ms`, its own duration) or a bare number in the unit beside it (`20 ms`). A TIME literal
 * carries its unit, so the watchdog's unit member does not apply to one (`T#15ms ms` is 15 ms) — the rule `Interval:`
 * already follows, where the format joins a unit only to a bare number.
 */
import { lex } from "../lex/lexer.js"
import { isTrivia } from "../lex/tokens.js"
import { DURATION_UNITS_NS, parseLiteralValue } from "../literal/value.js"
import type { DurationValue } from "../ast/nodes/index.js"
import type { TaskSettings } from "../format/task.js"

/** The task types CODESYS's `KindOfTask` names — every one the bridge writes. */
export const TASK_TYPES: readonly string[] = ["Cyclic", "Freewheeling", "Event", "ExternalEvent", "Status", "ParentSynchron"]

/** A task's watchdog as facts. A disabled one keeps its stated values; a time it does not state is absent. */
export interface TaskWatchdogFacts {
  readonly enabled: boolean
  readonly timeNs?: number
  readonly sensitivity?: number
}

/** A task as the host schedules it. Numbers, never bigint: a fact crosses a worker boundary as plain data. */
export interface TaskFacts {
  /** The task's name — its `.task` file's. */
  readonly name: string
  readonly type: string
  /** Absent where the descriptor states no interval (a task that is not Cyclic may state none). */
  readonly intervalNs?: number
  readonly priority: number
  /** Absent: the task has no watchdog member (TwinCAT's bare `off`). */
  readonly watchdog?: TaskWatchdogFacts
  readonly event?: string
  readonly externalEvent?: string
  /** The PROGRAMs it calls, in call order. */
  readonly calls: readonly string[]
}

/** A value a descriptor states that has no meaning as a fact: the label it stands under, and why. */
export interface TaskRefusal {
  readonly label: string
  readonly message: string
}

/** The unit names a bare number may stand in, to nanoseconds. */
const UNIT_NS: ReadonlyMap<string, bigint> = new Map([...DURATION_UNITS_NS, ["µs", 1_000n]])

/** A TIME literal standing alone (`T#20ms`, `TIME#1s500ms`) in nanoseconds, or undefined. An LTIME is not a TIME. */
function timeLiteral(text: string): bigint | undefined {
  const tokens = lex(text, "codesys", false).filter((t) => !isTrivia(t.kind) && t.kind !== "eof")
  const [only] = tokens
  if (tokens.length !== 1 || only!.kind !== "time_lit" || only!.malformed) return undefined
  const prefix = only!.text.slice(0, only!.text.indexOf("#")).toUpperCase()
  if (prefix !== "T" && prefix !== "TIME") return undefined
  return (parseLiteralValue("time", only!.text).value as DurationValue | undefined)?.ns
}

/** A bare decimal number in `unit`, in whole nanoseconds, or undefined. */
function bareTime(value: string, unit: string): bigint | undefined {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value)
  const per = UNIT_NS.get(unit)
  if (m === null || per === undefined) return undefined
  const frac = m[2] ?? ""
  const scaled = (BigInt(m[1]!) * 10n ** BigInt(frac.length) + BigInt(frac || "0")) * per
  const denominator = 10n ** BigInt(frac.length)
  return scaled % denominator === 0n ? scaled / denominator : undefined
}

/** A time member in nanoseconds as a safe number, or the reason it is none. */
function nanoseconds(value: string, unit: string, what: string): number | string {
  const ns = timeLiteral(value) ?? bareTime(value, unit)
  if (ns === undefined)
    return unit.length === 0
      ? `${what} '${value}' is not a TIME — a TIME literal (t#20ms) or a number with its unit`
      : `${what} '${value} ${unit}' is not a TIME — a TIME literal (t#20ms) or a whole number of ns, µs, ms, s, m, h or d`
  if (ns <= 0n || !Number.isSafeInteger(Number(ns))) return `${what} '${value}' is no duration a task runs on`
  return Number(ns)
}

/** A whole number, or undefined. */
const whole = (s: string): number | undefined => (/^\d+$/.test(s) && Number.isSafeInteger(Number(s)) ? Number(s) : undefined)

function watchdogFacts(settings: TaskSettings, refuse: (message: string) => void): TaskWatchdogFacts | undefined {
  const w = settings.watchdog
  if (w === undefined) return undefined
  let timeNs: number | undefined
  if (w.time.length > 0) {
    const ns = nanoseconds(w.time, w.unit, "the watchdog time")
    if (typeof ns === "string") refuse(ns)
    else timeNs = ns
  } else if (w.enabled) refuse("an enabled watchdog states no time")
  const sensitivity = w.sensitivity.length === 0 ? undefined : whole(w.sensitivity)
  if (sensitivity === undefined && (w.enabled || w.sensitivity.length > 0))
    refuse(`the watchdog sensitivity '${w.sensitivity}' is not a whole number of cycles`)
  return { enabled: w.enabled, ...(timeNs === undefined ? {} : { timeNs }), ...(sensitivity === undefined ? {} : { sensitivity }) }
}

/** The facts of the task `name`, or every value it states that has none. */
export function taskFacts(name: string, settings: TaskSettings): { facts: TaskFacts } | { refused: TaskRefusal[] } {
  const refused: TaskRefusal[] = []
  if (!TASK_TYPES.includes(settings.type))
    refused.push({ label: "Type", message: `'${settings.type}' is not a task type. Expected one of ${TASK_TYPES.join(", ")}.` })
  let intervalNs: number | undefined
  if (settings.interval.length > 0) {
    const ns = nanoseconds(settings.interval, settings.intervalUnit, "the interval")
    if (typeof ns === "string") refused.push({ label: "Interval", message: ns })
    else intervalNs = ns
  } else if (settings.type === "Cyclic") refused.push({ label: "Interval", message: "a Cyclic task states no interval" })
  const priority = whole(settings.priority)
  if (priority === undefined) refused.push({ label: "Priority", message: `the priority '${settings.priority}' is not a whole number` })
  const watchdog = watchdogFacts(settings, (message) => refused.push({ label: "Watchdog", message }))
  if (refused.length > 0) return { refused }
  return {
    facts: {
      name,
      type: settings.type,
      ...(intervalNs === undefined ? {} : { intervalNs }),
      priority: priority!,
      ...(watchdog === undefined ? {} : { watchdog }),
      ...(settings.event === undefined ? {} : { event: settings.event }),
      ...(settings.externalEvent === undefined ? {} : { externalEvent: settings.externalEvent }),
      calls: settings.calls,
    },
  }
}
