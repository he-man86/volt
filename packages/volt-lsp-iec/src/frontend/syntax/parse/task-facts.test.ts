import { expect, test } from "bun:test"
import { readTask } from "../format/task.js"
import { taskFacts } from "./task-facts.js"

const facts = (...lines: string[]) => taskFacts("T", readTask(lines.join("\n") + "\n"))

test("the corpus spellings read as facts: TIME literals, a number in its unit, every watchdog form", () => {
  expect(facts("Type:      Cyclic", "Interval:  t#20ms", "Priority:  1", "Watchdog:  off '' ms (sensitivity 1)", "Calls:     PLC_PRG")).toEqual({
    facts: { name: "T", type: "Cyclic", intervalNs: 20_000_000, priority: 1, watchdog: { enabled: false, sensitivity: 1 }, calls: ["PLC_PRG"] },
  })
  expect(facts("Type: Cyclic", "Interval: 1000 ms", "Priority: 14", "Watchdog: 3200 µs (sensitivity 2)", "Calls: A, B")).toEqual({
    facts: { name: "T", type: "Cyclic", intervalNs: 1_000_000_000, priority: 14, watchdog: { enabled: true, timeNs: 3_200_000, sensitivity: 2 }, calls: ["A", "B"] },
  })
  // a TIME literal carries its own unit — the watchdog's unit member applies to a bare number only
  expect(facts("Type: Cyclic", "Interval: T#15ms", "Priority: 2", "Watchdog: T#15ms ms (sensitivity 1)")).toMatchObject({
    facts: { intervalNs: 15_000_000, watchdog: { enabled: true, timeNs: 15_000_000, sensitivity: 1 } },
  })
  expect(facts("Type: Cyclic", "Interval: T#4ms", "Priority: 1", "Watchdog: T#4ms '' (sensitivity 1)")).toMatchObject({ facts: { watchdog: { timeNs: 4_000_000 } } })
  // a disabled watchdog keeps its stated values; TwinCAT's bare `off` is no watchdog member
  expect(facts("Type: Cyclic", "Interval: t#4ms", "Priority: 1", "Watchdog: off 3200 µs (sensitivity 1)")).toMatchObject({ facts: { watchdog: { enabled: false, timeNs: 3_200_000 } } })
  expect(facts("Type: Cyclic", "Interval: 10 ms", "Priority: 20", "Watchdog: off")).not.toHaveProperty("facts.watchdog")
  // a task that is not Cyclic may state no interval
  expect(facts("Type: Freewheeling", "Priority: 8", "Watchdog: off")).toEqual({ facts: { name: "T", type: "Freewheeling", priority: 8, calls: [] } })
  expect(facts("Type: Event", "Priority: 3", "Event: GVL.Trigger", "Watchdog: off")).toMatchObject({ facts: { event: "GVL.Trigger" } })
})

test("a value with no meaning as a fact is refused by its label, never defaulted", () => {
  const refused = (...lines: string[]) => {
    const r = facts(...lines)
    return "refused" in r ? r.refused : []
  }
  expect(refused("Type: Cyclic", "Interval: 20 parsecs", "Priority: 1")).toEqual([
    { label: "Interval", message: "the interval '20 parsecs' is not a TIME — a TIME literal (t#20ms) or a whole number of ns, µs, ms, s, m, h or d" },
  ])
  expect(refused("Type: Cyclic", "Interval: twenty", "Priority: 1")).toEqual([
    { label: "Interval", message: "the interval 'twenty' is not a TIME — a TIME literal (t#20ms) or a number with its unit" },
  ])
  // an LTIME is no TIME; a malformed literal is none; a bare number needs its unit
  for (const interval of ["LTIME#20ms", "T#5s1h", "T#20ms;", "20"]) expect(refused("Type: Cyclic", `Interval: ${interval}`, "Priority: 1").map((r) => r.label)).toEqual(["Interval"])
  expect(refused("Type: Cyclic", "Interval: 0 ms", "Priority: 1")).toEqual([{ label: "Interval", message: "the interval '0' is no duration a task runs on" }])
  expect(refused("Type: Cyclic", "Priority: 1")).toEqual([{ label: "Interval", message: "a Cyclic task states no interval" }])
  expect(refused("Type: Cyclic", "Interval: 1.5 µs", "Priority: high")).toEqual([{ label: "Priority", message: "the priority 'high' is not a whole number" }])
  expect(refused("Type: Cyclic", "Interval: 0.5 ns", "Priority: 1").map((r) => r.label)).toEqual(["Interval"])
  expect(refused("Type: Periodic", "Interval: 10 ms", "Priority: 1")).toEqual([
    { label: "Type", message: "'Periodic' is not a task type. Expected one of Cyclic, Freewheeling, Event, ExternalEvent, Status, ParentSynchron." },
  ])
  expect(refused("Type: Cyclic", "Interval: 10 ms", "Priority: 1", "Watchdog: '' ms (sensitivity 1)")).toEqual([{ label: "Watchdog", message: "an enabled watchdog states no time" }])
  expect(refused("Type: Cyclic", "Interval: 10 ms", "Priority: 1", "Watchdog: 5 ms (sensitivity '')")).toEqual([
    { label: "Watchdog", message: "the watchdog sensitivity '' is not a whole number of cycles" },
  ])
  expect(refused("Type: Cyclic", "Interval: 10 ms", "Priority: 1", "Watchdog: 5 '' (sensitivity 1)").map((r) => r.label)).toEqual(["Watchdog"])
})
