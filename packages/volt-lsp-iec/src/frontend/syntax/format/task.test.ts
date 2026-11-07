/**
 * The `.task` format, both directions, against the bridge's. The oracle is what the C# writer
 * (`TaskDescriptorFormat.Write`) produced: every `.task` a `volt pull` committed under `test-corpus/`, and the bodies
 * `packages/volt-cli/test/Volt.Engine.Tests/format/task/TaskDescriptorFormatTests.cs` and
 * `one-to-one/TaskDescriptorMembersTests.cs` pin as the writer's output.
 */
import { expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { readTask, TaskFormatError, writeTask, type TaskSettings } from "./task.js"

const CORPUS = join(import.meta.dir, "..", "..", "..", "..", "test-corpus")

/** Every `.task` file under `dir`. */
function taskFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? taskFiles(p) : name.endsWith(".task") ? [p] : []
  })
}

test("every corpus .task the bridge wrote reads and writes back to its own bytes", () => {
  const files = taskFiles(CORPUS)
  expect(files.length).toBe(14)
  for (const f of files) {
    const bytes = readFileSync(f, "utf8")
    expect({ f, out: writeTask(readTask(bytes)) }).toEqual({ f, out: bytes })
  }
})

const desc = (...lines: string[]): string => lines.join("\n") + "\n"

test("the C# writer's own bodies are fixed points — no watchdog, no calls, an event, the members, a call comment", () => {
  for (const body of [
    desc("Type:      Cyclic", "Interval:  20 ms", "Priority:  5", "Watchdog:  off"),
    desc("Type:      Freewheeling", "Priority:  8", "Watchdog:  off"),
    desc("Type:      Event", "Priority:  3", "Event:     GVL.Trigger", "Watchdog:  off"),
    desc("Type:      ExternalEvent", "Interval:  10 ms", "Priority:  1", "External event: CanRx", "Watchdog:  off '' ms (sensitivity 1)"),
    desc("Type:      Cyclic", "Interval:  10 ms", "Priority:  1", "Watchdog:  off 123 µs (sensitivity 3)"),
    desc("Type:      Cyclic", "Interval:  10 ms", "Priority:  1", "Watchdog:  off '' ms (sensitivity 1)", "Calls:     PLC_PRG // runs first, Logger"),
    desc("Type:      Cyclic", "Interval:  10 ms", "Priority:  1", "Watchdog:  off", "Core:      1", "Task group: Motion", "Within SPS time slicing: false"),
  ])
    expect(writeTask(readTask(body))).toBe(body)
})

test("the parts are read apart: a TIME-literal interval keeps its letters and gains no unit; a bare number keeps its unit", () => {
  const t = readTask(desc("Type:      Cyclic", "Interval:  t#4ms", "Priority:  1", "Watchdog:  3200 µs (sensitivity 2)", "Calls:     A,  B ,C"))
  expect([t.interval, t.intervalUnit, t.priority, t.calls]).toEqual(["t#4ms", "", "1", ["A", "B", "C"]])
  expect(t.watchdog).toEqual({ time: "3200", unit: "µs", sensitivity: "2", enabled: true })
  expect(readTask(desc("Type: Cyclic", "Interval: 20 ms", "Priority: 5"))).toMatchObject({ interval: "20", intervalUnit: "ms", calls: [] })
  // an empty member is `''`, the bare `off` is no watchdog member at all
  expect(readTask(desc("Type: Cyclic", "Priority: 1", "Watchdog: off '' ms (sensitivity 1)")).watchdog).toEqual({ time: "", unit: "ms", sensitivity: "1", enabled: false })
  expect(readTask(desc("Type: Cyclic", "Priority: 1", "Watchdog: off")).watchdog).toBeUndefined()
})

test("a non-canonical body reads, and writes back canonical: labels re-padded, members in their order", () => {
  expect(writeTask(readTask("Priority: 5\r\nType: Cyclic\r\nCore2: 0\r\nCore: 1\r\n"))).toBe(
    desc("Type:      Cyclic", "Priority:  5", "Watchdog:  off", "Core:      1", "Core2:     0"),
  )
})

test("edited settings render as the C# writer renders them", () => {
  const t = readTask(desc("Type:      Cyclic", "Interval:  20 ms", "Priority:  5", "Watchdog:  16 ms (sensitivity 2)", "Calls:     ProductionDataInputs"))
  const edited: TaskSettings = { ...t, interval: "50", calls: [...t.calls, "NewPou"] }
  expect(writeTask(edited)).toBe(desc("Type:      Cyclic", "Interval:  50 ms", "Priority:  5", "Watchdog:  16 ms (sensitivity 2)", "Calls:     ProductionDataInputs, NewPou"))
  // a watchdog unit is spelled after a TIME literal too, and an empty member as ''
  expect(writeTask({ ...t, watchdog: { time: "t#4ms", unit: "µs", sensitivity: "1", enabled: true } })).toContain("Watchdog:  t#4ms µs (sensitivity 1)\n")
  expect(writeTask({ ...t, members: [{ label: "Synch task", value: "" }] })).toContain("Synch task: ''\n")
  expect(() => writeTask({ ...t, callComments: ["a", "b"] })).toThrow("index-aligned")
})

/** The C# reader's refusals, each its message and the line it names. */
test.each([
  ["Type: Cyclic\nPriority 5\n", "line 2: expected `Label: value`, found 'Priority 5'", 2],
  ["Type: Cyclic\nPriority: 5\nPriority: 6\n", "line 3: 'Priority' is written twice (first on line 2) — a task field holds one value", 3],
  ["Type: Cyclic\nPriority: 5\nCalls: A\nCalls: B\n", "line 4: 'Calls' is written twice (first on line 3) — a task field holds one value", 4],
  ["Type: Cyclic\nPriority: 5\nCore: 1\nCore: 2\n", "line 4: 'Core' is written twice (first on line 3) — a task field holds one value", 4],
  [
    "Type: Cyclic\nIntervall: t#10ms\nPriority: 5\n",
    "line 2: 'Intervall' is not a task field. Expected one of Type, Interval, Priority, Event, External event, Watchdog, Calls, Core, Core2, Task group, Allow empty, Implicit, Within SPS time slicing, Synch task, Auto start, IO at begin, Exceed warning, Create symbols, Ext sync, Tick modulo, Input update pre ticks, Disable FP exceptions, Watchdog stack capacity, CPU affinity.",
    2,
  ],
  ["Priority: 5\n", "no 'Type:' line — a task must say what kind it is", undefined],
  ["Type: Cyclic\n", "no 'Priority:' line", undefined],
  ["Type: Cyclic\nPriority: 5\nWatchdog: 3200 µs\n", "watchdog '3200 µs': expected `[off ]<time> <unit> (sensitivity <n>)` or `off`", 3],
  ["Type: Cyclic\nPriority: 5\nWatchdog: 3200 µs (sens 2)\n", "watchdog '3200 µs (sens 2)': expected `(sensitivity <n>)`, found '(sens 2)'", 3],
  [
    "Type: Cyclic\nPriority: 5\nWatchdog: 3200 (sensitivity 2)\n",
    "watchdog '3200 (sensitivity 2)': expected its time and its unit as two words — `<time> <unit>`, `''` for an empty one (`Watchdog: 3200 µs (sensitivity 1)`, `Watchdog: off '' ms (sensitivity 1)`)",
    3,
  ],
])("refused: %p", (body, message, line) => {
  let thrown: unknown
  try {
    readTask(body)
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(TaskFormatError)
  expect([(thrown as TaskFormatError).message, (thrown as TaskFormatError).line]).toEqual([message, line])
})
