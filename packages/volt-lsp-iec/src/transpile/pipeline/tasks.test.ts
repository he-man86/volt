/**
 * AN APPLICATION RUNS BY ITS TASK CONFIGURATION (openspec runtime-task-configuration): `lowerApplication` lowers every
 * Cyclic task's PROGRAM calls into one POU, `runApplication(…).runTask(name)` runs one task's calls in order on the shared
 * globals, the build result carries each task's facts, and a project with no `.task` runs its main program as one implicit
 * task, exactly as `lowerSource` + `run` do.
 */
import { expect, test } from "bun:test"
import { lowerApplication, lowerSource, run, runApplication, type ApplicationRunner, type LoweredApplication, type TaskFile } from "../index.js"

const FILES = [
  { uri: "GVL.gvl", source: "VAR_GLOBAL\n\torder : DINT;\n\tfast : INT;\n\tshared : INT;\nEND_VAR\n" },
  { uri: "A.pou", source: "PROGRAM A\nVAR count : INT; END_VAR\ncount := count + 1;\nGVL.fast := GVL.fast + 1;\nGVL.shared := 7;\nEND_PROGRAM\n" },
  { uri: "B.pou", source: "PROGRAM B\nGVL.order := GVL.order * 10 + 2;\nEND_PROGRAM\n" },
  { uri: "C.pou", source: "PROGRAM C\nVAR seen : INT; END_VAR\nGVL.order := GVL.order * 10 + 3;\nseen := GVL.shared;\nEND_PROGRAM\n" },
  { uri: "FB_X.pou", source: "FUNCTION_BLOCK FB_X\nEND_FUNCTION_BLOCK\n" },
]
const task = (name: string, calls: string, type = "Cyclic", interval = "t#10ms"): TaskFile => ({
  uri: `file:///app/Task%20Configuration/${name}.task`,
  source: `Type:      ${type}\nInterval:  ${interval}\nPriority:  1\nWatchdog:  3200 µs (sensitivity 2)\nCalls:     ${calls}\n`,
})

function app(tasks: readonly TaskFile[], main?: string): { runner: ApplicationRunner; lowered: LoweredApplication } {
  const lowered = lowerApplication(FILES, tasks, main)
  if (lowered.application === undefined) throw new Error(lowered.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"))
  return { runner: runApplication(lowered.application), lowered }
}

test("a task runs only its own calls, in their order; the other task's program does not run", () => {
  const { runner } = app([task("Fast", "A"), task("Slow", "B, C")])
  runner.runTask("Slow")
  expect([runner.get("GVL.order"), runner.get("GVL.fast"), runner.get("A.count")]).toEqual([23n, 0n, 0n]) // B, then C
  runner.runTask("Fast")
  runner.runTask("fast") // a task name is an IEC name: case does not matter
  expect([runner.get("GVL.order"), runner.get("GVL.fast"), runner.get("A.count")]).toEqual([23n, 2n, 2n])
})

test("every task runs on the one set of globals and the one instance of each PROGRAM", () => {
  const { runner } = app([task("Fast", "A"), task("Slow", "C"), task("Both", "A, C")])
  runner.runTask("Slow")
  expect(runner.get("C.seen")).toBe(0n)
  runner.runTask("Fast") // A writes the global C reads
  runner.runTask("Slow")
  expect(runner.get("C.seen")).toBe(7n)
  runner.runTask("Both")
  expect([runner.get("A.count"), runner.get("GVL.order")]).toEqual([2n, 333n]) // the instance Fast ran, run once more
})

test("the build result carries each task's facts, and only a Cyclic task runs", () => {
  const { runner, lowered } = app([task("Fast", "A"), task("Background", "C", "Freewheeling", "t#4ms")])
  expect(lowered.tasks).toEqual([
    { name: "Fast", type: "Cyclic", intervalNs: 10_000_000, priority: 1, watchdog: { enabled: true, timeNs: 3_200_000, sensitivity: 2 }, calls: ["A"] },
    { name: "Background", type: "Freewheeling", intervalNs: 4_000_000, priority: 1, watchdog: { enabled: true, timeNs: 3_200_000, sensitivity: 2 }, calls: ["C"] },
  ])
  expect(() => runner.runTask("Background")).toThrow("no Cyclic task Background runs in this application — only a Cyclic task runs; its tasks: Fast")
  expect(() => runner.get("C.seen")).toThrow("no variable C.seen") // a program only a task that does not run calls is not lowered
})

test("with no .task, the implicit task runs the main program exactly as lowerSource + run does", () => {
  const { runner, lowered } = app([], "C")
  const today = lowerSource(FILES[3]!.source, "C", FILES.filter((f) => f.uri !== "C.pou"), "C.pou")
  expect(lowered.application!.pou).toEqual(today.pou!)
  expect([lowered.tasks, lowered.application!.tasks.map((t) => t.name)]).toEqual([[], ["C"]])
  const scan = run(today.pou!)
  for (let i = 0; i < 3; i++) {
    runner.runTask("C")
    scan.scan()
  }
  expect([runner.get("GVL.order"), runner.get("seen")]).toEqual([scan.get("GVL.order"), scan.get("seen")])
  expect(runner.get("GVL.order")).toBe(333n)
})

/** Each refusal as [code, uri's file, line, column, message]. */
const refusals = (tasks: readonly TaskFile[]) =>
  lowerApplication(FILES, tasks).diagnostics.map((d) => [d.code, d.uri.slice(d.uri.lastIndexOf("/") + 1), d.span.startLine, d.span.startCol, d.message])

test("what a descriptor states that cannot be honoured is refused by name, on the .task, never defaulted", () => {
  expect(refusals([task("Fast", "A, Mian, FB_X")])).toEqual([
    ["task-call", "Fast.task", 5, 14, "'Mian' is no PROGRAM of the application — task 'Fast' can call only a PROGRAM"],
    ["task-call", "Fast.task", 5, 20, "'FB_X' is no PROGRAM of the application — task 'Fast' can call only a PROGRAM"],
  ])
  expect(refusals([task("Fast", "A", "Cyclic", "20 parsecs")])).toEqual([
    ["task-value", "Fast.task", 2, 0, "the interval '20 parsecs' is not a TIME — a TIME literal (t#20ms) or a whole number of ns, µs, ms, s, m, h or d"],
  ])
  expect(refusals([{ uri: "file:///app/Fast.task", source: "Type: Cyclic\nIntervall: t#10ms\nPriority: 1\n" }])).toEqual([
    ["task-descriptor", "Fast.task", 2, 0, expect.stringContaining("line 2: 'Intervall' is not a task field.")],
  ])
})

test("a refusal lowering meets in a task's call is reported on the .task's call", () => {
  const files = [...FILES, { uri: "D.pou", source: "PROGRAM D\nVAR_IN_OUT io : INT; END_VAR\nio := io + 1;\nEND_PROGRAM\n" }]
  const lowered = lowerApplication(files, [task("Fast", "A, D")])
  expect(lowered.diagnostics.map((d) => [d.code, d.uri.slice(d.uri.lastIndexOf("/") + 1), d.span.startLine, d.span.startCol])).toEqual([["call-inout-missing", "Fast.task", 5, 14]])
})
