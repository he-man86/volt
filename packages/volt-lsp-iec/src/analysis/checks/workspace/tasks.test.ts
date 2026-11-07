import { expect, test } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { taskFindings } from "../../index.js"

const SOURCES = [
  "PROGRAM PLC_PRG\nVAR x : INT; END_VAR\nx := x + 1;\nEND_PROGRAM",
  "PROGRAM Logger\nEND_PROGRAM",
  "FUNCTION_BLOCK FB_Motor\nEND_FUNCTION_BLOCK",
]
const project = build.buildSymbolTable(
  SOURCES.map((source, i) => ({ uri: `file:///app/P${i}.pou`, source, parseResult: parseSource(source, { networkText: true, unicodeIdentifiers: false }, "codesys") })),
  [],
  "codesys",
)

const TASK = (calls: string, extra = "") =>
  `Type:      Cyclic\nInterval:  t#20ms\nPriority:  1\nWatchdog:  off '' ms (sensitivity 1)\nCalls:     ${calls}\n${extra}`
const uri = (name: string) => `file:///app/Task%20Configuration/${name}.task`

/** Each finding as [uri's task, code, severity, line, column, message]. */
const findings = (...files: [string, string][]) =>
  [...taskFindings(files.map(([name, text]) => ({ uri: uri(name), text })), project)].flatMap(([u, items]) =>
    items.map((d) => [u.slice(u.lastIndexOf("/") + 1), d.code, d.severity, d.span.startLine, d.span.startCol, d.message]),
  )

test("a task configuration CODESYS builds has no finding — the corpus spellings, one call per task", () => {
  expect(findings(["MainTask", TASK("PLC_PRG")], ["Slow", TASK("Logger").replace("t#20ms", "100 ms")])).toEqual([])
})

test("an unknown or a repeated field is an error on its line, in the bridge's words", () => {
  expect(findings(["MainTask", TASK("PLC_PRG", "Intervall: t#10ms\n")])).toEqual([
    ["MainTask.task", "task-descriptor", "error", 6, 0, expect.stringContaining("line 6: 'Intervall' is not a task field. Expected one of Type, Interval,")],
  ])
  expect(findings(["MainTask", TASK("PLC_PRG", "Priority: 2\n")])).toEqual([
    ["MainTask.task", "task-descriptor", "error", 6, 0, "line 6: 'Priority' is written twice (first on line 3) — a task field holds one value"],
  ])
})

test("a Calls: name that is no PROGRAM is an error on the name, saying what it is instead", () => {
  expect(findings(["MainTask", TASK("Logger, Mian, FB_Motor")])).toEqual([
    ["MainTask.task", "task-call-not-program", "error", 5, 19, "'Mian' is no PROGRAM of the application — task 'MainTask' can call only a PROGRAM"],
    ["MainTask.task", "task-call-not-program", "error", 5, 25, "'FB_Motor' is a FUNCTION_BLOCK, not a PROGRAM — task 'MainTask' can call only a PROGRAM"],
  ])
})

test("an interval that is not a TIME is an error on the Interval line", () => {
  expect(findings(["MainTask", TASK("PLC_PRG").replace("t#20ms", "20 parsecs")])).toEqual([
    ["MainTask.task", "task-value", "error", 2, 0, "the interval '20 parsecs' is not a TIME — a TIME literal (t#20ms) or a whole number of ns, µs, ms, s, m, h or d"],
  ])
})

test("a PROGRAM two tasks call is a warning on each call", () => {
  expect(findings(["Fast", TASK("PLC_PRG")], ["Slow", TASK("Logger, plc_prg")])).toEqual([
    ["Fast.task", "program-in-several-tasks", "warning", 5, 11, "PROGRAM 'PLC_PRG' is called by 2 tasks (Fast, Slow): each runs the same instance"],
    ["Slow.task", "program-in-several-tasks", "warning", 5, 19, "PROGRAM 'plc_prg' is called by 2 tasks (Fast, Slow): each runs the same instance"],
  ])
  // one task calling it twice is one task
  expect(findings(["Fast", TASK("PLC_PRG, PLC_PRG")])).toEqual([])
})
