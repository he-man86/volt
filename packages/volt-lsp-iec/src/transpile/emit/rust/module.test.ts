import { describe, expect, test } from "bun:test"
import { emitRust } from "./index.js"
import { lowerSource } from "../../lower/index.js"
import { lowerAndEmit } from "../../pipeline/index.js"

function rust(src: string): string {
  const { pou, diagnostics } = lowerSource(src)
  expect(diagnostics).toEqual([])
  return emitRust(pou!).code
}

const COUNTER = `
PROGRAM Counter
VAR_INPUT
  Enable : BOOL;
END_VAR
VAR
  iCount   : INT;
  MaxCount : INT := 3;
END_VAR
IF Enable AND iCount < MaxCount THEN
  iCount := iCount + 1;
END_IF
END_PROGRAM
`

describe("emit/rust", () => {
  test("globals are a `Globals` struct handed to every body as `g`; called PROGRAMs live apart in `Programs`", () => {
    const { pou, diagnostics } = lowerSource(
      "PROGRAM Main\nVAR reader : FB_Reader; seen : INT; END_VAR\nPRG_Writer();\nseen := gShared;\nreader();\nEND_PROGRAM\nVAR_GLOBAL\n  gShared : INT := 3;\nEND_VAR\nFUNCTION_BLOCK FB_Reader\nVAR_OUTPUT q : INT; END_VAR\nq := gShared;\nEND_FUNCTION_BLOCK\nPROGRAM PRG_Writer\nVAR runs : INT; END_VAR\nruns := runs + 1;\ngShared := runs;\nEND_PROGRAM\n",
      "Main",
    )
    expect(diagnostics).toEqual([])
    const emitted = emitRust(pou!)
    expect([emitted.usesGlobals, emitted.usesPrograms]).toEqual([true, true])
    expect(emitted.code).toContain("pub struct Globals {")
    expect(emitted.code).toContain("g_shared: 3i16,")
    expect(emitted.code).toContain("pub struct Programs {")
    expect(emitted.code).toContain("pub fn scan(&mut self, g: &mut Globals, prg: &mut Programs) {")
    // Every body is handed `g` and `prg`, as any body may call a PROGRAM (conformance `state_program_called_from_fb`); a
    // program runs moved out of `Programs` and back, so the call never borrows `prg` twice. This read
    // `prg.prg_writer.call(g)` while only the POU's own scan could call a program.
    expect(emitted.code).toContain("{ let mut program = std::mem::take(&mut prg.prg_writer); program.call(g, prg); prg.prg_writer = program; }")
    expect(emitted.code).toContain("self.seen = g.g_shared;")
    expect(emitted.code).toContain("pub fn call(&mut self, g: &mut Globals, prg: &mut Programs) {")
  })

  test("a POU emits as one flat struct with a scan method — no references anywhere", () => {
    const code = rust(COUNTER)
    expect(code).toContain("pub struct Counter {")
    expect(code).toContain("pub i_count: i16,")
    expect(code).toContain("pub fn scan(&mut self) {")
    expect(code).toContain("max_count: 3i16,") // the declared initial value, not Default's zero
    // The whole point of the flat-frame decision: `&mut self` is the ONLY borrow in the output.
    expect(code.match(/&mut/g)).toEqual(["&mut"])
    expect(code).not.toContain("&'")
  })

  test("IEC integers wrap at their width rather than panicking like Rust's defaults", () => {
    expect(rust(COUNTER)).toContain("wrapping_add")
  })

  test("every emitted statement line maps back to an ST span", () => {
    const { code, sourceMap } = lowerAndEmit(COUNTER).emitted
    expect(sourceMap.length).toBeGreaterThan(0)
    const lines = code.split("\n")
    for (const { line, span } of sourceMap) {
      expect(lines[line - 1]).toBeDefined()
      expect(span.startLine).toBeGreaterThan(0)
    }
    // the assignment inside the IF maps to the ST line that holds it
    const assignment = sourceMap.find(({ line }) => lines[line - 1]?.includes("i_count = "))
    expect(assignment?.span.startLine).toBe(11)
  })
})
