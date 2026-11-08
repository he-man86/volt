/**
 * A task configuration, judged as CODESYS 3.5.21.40 builds it — every expectation below is what the vendor's build said of
 * that descriptor, pushed into the recording project's application and built (2026-11-08, `tasks.ts` lists the probes).
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { taskFindings } from "../../index.js"

const SOURCES: [string, string][] = [
  ["PLC_PRG.pou", "PROGRAM PLC_PRG\nVAR x : INT; END_VAR\nx := x + 1;\nEND_PROGRAM"],
  ["Logger.pou", "PROGRAM Logger\nEND_PROGRAM"],
  ["FB_Motor.pou", "FUNCTION_BLOCK FB_Motor\nEND_FUNCTION_BLOCK"],
  ["F_One.pou", "FUNCTION F_One : INT\nVAR_INPUT a : INT; END_VAR\nF_One := a;\nEND_FUNCTION"],
  ["F_Two.pou", "FUNCTION F_Two : INT\nVAR_INPUT a : INT; b : INT; END_VAR\nF_Two := a;\nEND_FUNCTION"],
  ["F_Default.pou", "FUNCTION F_Default : INT\nVAR_INPUT a : INT := 1; END_VAR\nF_Default := a;\nEND_FUNCTION"],
  ["F_None.pou", "FUNCTION F_None : INT\nF_None := 1;\nEND_FUNCTION"],
  ["S_Pair.dut", "TYPE S_Pair :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE"],
  ["E_Mode.dut", "TYPE E_Mode :\n(\n\tIDLE := 0,\n\tBUSY := 1\n);\nEND_TYPE"],
  ["I_Run.itf", "INTERFACE I_Run\nEND_INTERFACE"],
  ["GVL_App.gvl", "VAR_GLOBAL\n\tg_int : INT;\n\tg_motor : FB_Motor;\nEND_VAR\nVAR_GLOBAL CONSTANT\n\tgc_t : TIME := T#10MS;\n\tgc_dw : DWORD := 20000;\n\tgc_p : INT := 32;\n\tgc_b : BOOL := TRUE;\nEND_VAR"],
]
const project = build.buildSymbolTable(
  SOURCES.map(([file, source]) => ({ uri: `file:///app/${file}`, source, parseResult: parseSource(source, { networkText: true, unicodeIdentifiers: false }, "codesys") })),
  [],
  "codesys",
)

const TASK = (o: { calls?: string; interval?: string; priority?: string; watchdog?: string; type?: string } = {}, extra = "") =>
  `Type:      ${o.type ?? "Cyclic"}\nInterval:  ${o.interval ?? "t#20ms"}\nPriority:  ${o.priority ?? "1"}\nWatchdog:  ${o.watchdog ?? "off '' ms (sensitivity 1)"}\nCalls:     ${o.calls ?? "PLC_PRG"}\n${extra}`
const uri = (name: string) => `file:///app/Task%20Configuration/${name}.task`

/** Each finding as [uri's task, code, line, column, message], all errors. */
const findings = (files: [string, string][], vendor: "codesys" | "twincat" = "codesys") =>
  [...taskFindings(files.map(([name, text]) => ({ uri: uri(name), source: text })), project, vendor)].flatMap(([u, items]) =>
    items.map((d) => {
      expect(d.severity).toBe("error")
      return [u.slice(u.lastIndexOf("/") + 1), d.code, d.span.startLine, d.span.startCol, d.message]
    }),
  )
/** The messages of one MainTask descriptor. */
const said = (o: Parameters<typeof TASK>[0]) => findings([["MainTask", TASK(o)]]).map((f) => f[4])

test("a task configuration CODESYS builds has no finding — the corpus spellings, a PROGRAM in two tasks, one task calling it twice", () => {
  expect(findings([["MainTask", TASK()], ["Slow", TASK({ calls: "Logger, plc_prg", interval: "100 ms" })]])).toEqual([])
  expect(said({ calls: "PLC_PRG, PLC_PRG" })).toEqual([])
})

test("an unknown or a repeated field is an error on its line, in the bridge's words — on either vendor", () => {
  for (const vendor of ["codesys", "twincat"] as const) {
    expect(findings([["MainTask", TASK({}, "Intervall: t#10ms\n")]], vendor)).toEqual([
      ["MainTask.task", "task-descriptor", 6, 0, expect.stringContaining("line 6: 'Intervall' is not a task field. Expected one of Type, Interval,")],
    ])
    expect(findings([["MainTask", TASK({}, "Priority: 2\n")]], vendor)).toEqual([
      ["MainTask.task", "task-descriptor", 6, 0, "line 6: 'Priority' is written twice (first on line 3) — a task field holds one value"],
    ])
  }
})

test("a Calls: entry is the call statement `<name>();`: the ST call's words, on the name", () => {
  expect(findings([["MainTask", TASK({ calls: "Logger, Mian, FB_Motor" })]])).toEqual([
    ["MainTask.task", "unresolved-identifier", 5, 19, "Identifier 'Mian' not defined"],
    ["MainTask.task", "invalid-call-target", 5, 19, "Program name, function or function block instance expected instead of 'Mian'"],
    ["MainTask.task", "fb-not-instantiated", 5, 25, "Function block 'FB_Motor' must be instantiated to be accessed"],
  ])
  expect(said({ calls: "PLC_PRG, F_One" })).toEqual(["Function 'F_One' requires exactly '1' inputs"])
  expect(said({ calls: "PLC_PRG, F_Two" })).toEqual(["Function 'F_Two' requires exactly '2' inputs"])
  expect(said({ calls: "PLC_PRG, F_Default, F_None, g_motor" })).toEqual([])
  expect(said({ calls: "PLC_PRG, g_int" })).toEqual(["Program name, function or function block instance expected instead of 'g_int'"])
  expect(said({ calls: "PLC_PRG, S_Pair" })).toEqual(["Cannot call object of type 'TYPE'", "Type name 'S_Pair' not expected in this place"])
  expect(said({ calls: "PLC_PRG, E_Mode" })).toEqual(["Cannot call object of type 'VAR_GLOBAL'", "Type name 'E_Mode' not expected in this place"])
  expect(said({ calls: "PLC_PRG, GVL_App" })).toEqual(["Cannot call object of type 'VAR_GLOBAL'"])
  expect(said({ calls: "PLC_PRG, I_Run" })).toEqual(["Cannot call object of type 'INTERFACE'", "Interface 'I_Run' must be instantiated to be accessed"])
})

test("an interval not above zero, or no time, is invalid; one of 2^31 ms past the maximum; the device's range is not judged", () => {
  const invalid = ["MainTask: The task interval is invalid."]
  for (const interval of ["t#0ms", "t#-5ms", "0 ms", "20 parsecs", "1+2", "t#100us"]) expect(said({ interval })).toEqual(invalid)
  expect(findings([["MainTask", TASK().replace("Interval:  t#20ms\n", "")]])).toEqual([["MainTask.task", "task-value", 1, 0, invalid[0]]]) // on line 1: it states no Interval line
  expect(said({ interval: "t#24d20h31m23s648ms" })).toEqual(["MainTask: The task interval is invalid. The maximum is exceeded."])
  expect(said({ interval: "t#49d" })).toEqual(["MainTask: The task interval is invalid. The maximum is exceeded."])
  for (const interval of ["t#1ms", "t#10m", "20 ms", "t#24d20h31m23s647ms"]) expect(said({ interval })).toEqual([])
})

test("a name as the interval, priority or watchdog time is a value, converted to DWORD / INT / DWORD", () => {
  expect(said({ interval: "abc" })).toEqual(["Identifier 'abc' not defined", "Cannot convert type 'Unknown type: 'abc'' to type 'DWORD'"])
  expect(said({ interval: "gc_t" })).toEqual(["Cannot convert type 'TIME' to type 'DWORD'"])
  expect(said({ interval: "gc_dw" })).toEqual([])
  expect(said({ priority: "x" })).toEqual(["Identifier 'x' not defined", "Cannot convert type 'Unknown type: 'x'' to type 'INT'"])
  expect(said({ priority: "gc_b" })).toEqual(["Cannot convert type 'BOOL' to type 'INT'"])
  expect(said({ priority: "gc_p" })).toEqual([]) // a constant is taken as it is, 32 too
  expect(said({ watchdog: "abc ms (sensitivity 1)" })).toEqual(["Identifier 'abc' not defined", "Cannot convert type 'Unknown type: 'abc'' to type 'DWORD'"])
})

test("a priority literal past 31, or no literal, is invalid; an enabled watchdog with no time is invalid", () => {
  for (const priority of ["32", "255", "-1", "1+2"]) expect(said({ priority })).toEqual(["MainTask: The task priority is invalid."])
  for (const priority of ["0", "31"]) expect(said({ priority })).toEqual([])
  expect(findings([["MainTask", TASK({ watchdog: "'' ms (sensitivity 1)" })]])).toEqual([["MainTask.task", "task-value", 4, 0, "MainTask: The watchdog time is invalid."]])
  expect(said({ watchdog: "t#0ms ms (sensitivity 1)" })).toEqual([])
  expect(said({ watchdog: "t#100ms ms (sensitivity 0)" })).toEqual([])
})

test("an unknown task type is the push's refusal, in its words", () => {
  expect(said({ type: "Bogus" })).toEqual([
    "CODESYS: 'Bogus' is not a task type. A `.task` file's `Type:` line must name one of Cyclic, Freewheeling, Event, ExternalEvent, Status, ParentSynchron.",
  ])
})

test("TwinCAT's build of a task is unmeasured: only the format is judged there", () => {
  expect(findings([["MainTask", TASK({ calls: "Mian", interval: "t#0ms", priority: "99" })]], "twincat")).toEqual([])
})
