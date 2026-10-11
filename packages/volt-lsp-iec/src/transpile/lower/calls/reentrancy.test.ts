/**
 * The one program-reentrancy test (task 1.7.12) and each site's rule.
 */
import { expect, test } from "bun:test"
import type { Scope } from "../../../frontend/symbols/index.js"
import { run } from "../../interp/index.js"
import type { IrStmt } from "../../ir/index.js"
import { Lowering } from "../core/lowering.js"
import { lowerSource } from "../index.js"
import { programReentrant, programTarget } from "./reentrancy.js"

const span = undefined as never
const lw = new Lowering({} as Scope, {} as Scope)
const dispatching: IrStmt[] = [{ kind: "eval", value: { kind: "dispatch", tag: { kind: "const", value: 0n, type: undefined as never, span }, arms: [], fault: "no-instance", type: undefined as never, span }, span }]
const touching = { touched: new Set([4]), body: [] as IrStmt[] }
const quiet = { touched: new Set<number>(), body: dispatching }

test("off the globals nothing is reentrant; on a program's slot the touched set and an interface call are", () => {
  expect(programTarget({ slot: 4, path: [], type: undefined as never, span, root: "global" })).toEqual({ slot: 4, inside: false })
  expect(programTarget({ slot: 4, path: [], type: undefined as never, span })).toBeUndefined()
  expect(programReentrant(lw, touching, undefined)).toBeUndefined()
  expect(programReentrant(lw, touching, { slot: 4, inside: false })).toBe("touches")
  expect(programReentrant(lw, touching, { slot: 5, inside: false })).toBeUndefined()
  expect(programReentrant(lw, quiet, { slot: 4, inside: false })).toBe("dispatch")
})

test("a rule checks a reason only inside a program, or never", () => {
  expect(programReentrant(lw, touching, { slot: 4, inside: false }, { touched: "inside", dispatch: "inside" })).toBeUndefined()
  expect(programReentrant(lw, touching, { slot: 4, inside: true }, { touched: "inside", dispatch: "inside" })).toBe("touches")
  expect(programReentrant(lw, quiet, { slot: 4, inside: false }, { touched: "always", dispatch: "inside" })).toBeUndefined()
  expect(programReentrant(lw, quiet, { slot: 4, inside: true }, { touched: "always", dispatch: "never" })).toBeUndefined()
})

/** Lower and require success — most tests are about the SHAPE, not the failure path. */
function ir(src: string, name?: string) {
  const { pou, diagnostics } = lowerSource(src, name)
  expect(diagnostics).toEqual([])
  return pou!
}

// Review of the qualified-constant / program-instance batch (adversarial verify), each reproduced before its fix. Why
// missed: the tests called the recorded shapes only — no PROPERTY on the instance, no runtime index, no body reaching the
// program, no call through an interface inside the called body; the two body-call refusals were never exercised.
test("an instance inside a PROGRAM: a PROPERTY, a runtime index, a body reaching the program and an interface call are refused", () => {
  const codes = (source: string) => lowerSource(source, "P").diagnostics.map((d) => d.code)
  const station = (extra: string) =>
    "PROGRAM PRG_S\nVAR relay : FB_R; relays : ARRAY[1..2] OF FB_R; runs : INT; END_VAR\nruns := runs + 1;\nEND_PROGRAM\n" +
    "INTERFACE I_Sq\nMETHOD Area : INT\nEND_METHOD\nEND_INTERFACE\nFUNCTION_BLOCK FB_Sq IMPLEMENTS I_Sq\nEND_FUNCTION_BLOCK\nMETHOD Area : INT\nArea := 4;\nEND_METHOD\n" +
    `FUNCTION_BLOCK FB_R\nVAR_INPUT amount : INT; END_VAR\nVAR seen : INT; square : FB_Sq; held : I_Sq; END_VAR\nheld := square;\n${extra}\nEND_FUNCTION_BLOCK\n` +
    "PROPERTY Level : INT\nGET\nLevel := amount;\nEND_GET\nEND_PROPERTY\nMETHOD Plain : INT\nPlain := amount;\nEND_METHOD\nMETHOD Reach : INT\nReach := PRG_S.runs;\nEND_METHOD\nMETHOD Through : INT\nIF held <> 0 THEN\n  Through := held.Area();\nEND_IF\nEND_METHOD\n"
  const program = (body: string, extra = "") => `PROGRAM P\nVAR n : INT; i : INT := 1; END_VAR\nPRG_S();\n${body}\nEND_PROGRAM\n${station(extra)}`
  expect(codes(program("n := PRG_S.relay.Plain();"))).toEqual([])
  // A PROPERTY there was refused here; the recording since (`callshape_program_instance_property`: 33, 34) shows the getter
  // runs on the program's instance — and that a WRITE from outside does not compile. A runtime index stays refused.
  const getter = run(ir(program("n := PRG_S.relay.Level;"), "P"))
  getter.scan()
  expect(getter.get("n")).toEqual(0n)
  expect(codes(program("PRG_S.relay.Level := 1;"))).toContain("program-property-written")
  expect(codes(program("n := PRG_S.relays[i].Level;"))).toContain("call-program-property")
  expect(codes(program("PRG_S.relays[i](amount := 1);"))).toContain("call-program-member")
  expect(codes(program("n := PRG_S.relay.Reach();"))).toContain("call-program-reentrant")
  expect(codes(program("PRG_S.relay(amount := 1);", "seen := PRG_S.runs;"))).toContain("call-program-reentrant")
  expect(codes(program("n := PRG_S.relay.Through();"))).toContain("call-program-reentrant")
})
