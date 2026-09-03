import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emitRust, rustType, snake } from "./emit.js"
import { lowerSource } from "../../lower/index.js"

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
  test("the IEC type mapping comes from the type's own facts", () => {
    const { pou } = lowerSource("PROGRAM P\nVAR a : SINT; b : INT; c : DINT; d : BYTE; e : WORD; f : REAL; g : LREAL; h : BOOL; END_VAR\na := a;\nEND_PROGRAM\n")
    expect(pou!.slots.map((s) => rustType(s.type))).toEqual(["i8", "i16", "i32", "u8", "u16", "f32", "f64", "bool"])
  })

  test("ST names become snake_case fields", () => {
    expect(["iCount", "MaxCount", "PLC_Ready", "x"].map(snake)).toEqual(["i_count", "max_count", "plc_ready", "x"])
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

  test("all three loop forms print as the same Rust shape", () => {
    const forLoop = rust("PROGRAM P\nVAR i : INT; n : INT; END_VAR\nFOR i := 1 TO 3 DO n := n + 1; END_FOR\nEND_PROGRAM\n")
    const whileLoop = rust("PROGRAM P\nVAR n : INT; END_VAR\nWHILE n < 3 DO n := n + 1; END_WHILE\nEND_PROGRAM\n")
    const repeat = rust("PROGRAM P\nVAR n : INT; END_VAR\nREPEAT n := n + 1; UNTIL n >= 3 END_REPEAT\nEND_PROGRAM\n")
    for (const code of [forLoop, whileLoop, repeat]) {
      expect(code).toContain("loop {")
      expect(code).toContain("break; }")
    }
  })

  test("CASE prints as a match with inclusive ranges", () => {
    const code = rust("PROGRAM P\nVAR m : INT; n : INT; END_VAR\nCASE m OF\n 1: n := 0;\n 2..4: n := 1;\nELSE\n n := 9;\nEND_CASE\nEND_PROGRAM\n")
    expect(code).toContain("1 => {")
    expect(code).toContain("2..=4 => {")
    expect(code).toContain("_ => {")
  })

  test("every emitted statement line maps back to an ST span", () => {
    const { pou } = lowerSource(COUNTER)
    const { code, sourceMap } = emitRust(pou!)
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

// ─── the check that matters: does it actually build? ─────────────────────────
// `rustc` alone, no cargo and no crate — a golden-text test proves the shape, this proves the Rust is real.
// Skipped where rustc is absent so `bun test` stays toolchain-free; CI on a Rust-equipped runner still runs it.

const rustc = Bun.which("rustc")

describe.skipIf(rustc === null)("emit/rust — compiles", () => {
  test("the emitted crate builds clean under rustc", async () => {
    const sources = [
      COUNTER,
      "PROGRAM Loops\nVAR i : INT; n : INT; w : INT; END_VAR\nFOR i := 1 TO 3 DO n := n + i; END_FOR\nWHILE w < 3 DO w := w + 1; END_WHILE\nREPEAT n := n - 1; UNTIL n <= 0 END_REPEAT\nEND_PROGRAM\n",
      "PROGRAM Branch\nVAR m : INT; n : INT; r : REAL; ok : BOOL; END_VAR\nCASE m OF\n 1: n := 0;\n 2..4: n := 1;\nELSE\n n := 9;\nEND_CASE\nok := (m > 0) AND_THEN (n < 10);\nr := m / 2;\nEND_PROGRAM\n",
    ]
    const crate = sources
      .map((src) => {
        const { pou, diagnostics } = lowerSource(src)
        expect(diagnostics).toEqual([])
        return emitRust(pou!).code
      })
      .join("\n")

    // `--emit=metadata` type-checks and BORROW-checks without codegen — the fast form of the only question
    // this test asks. The crate name comes from the file stem, so it has to be a legal Rust identifier.
    const dir = await mkdtemp(join(tmpdir(), "volt-emit-"))
    const file = join(dir, "volt_emit_check.rs")
    await Bun.write(file, crate)
    const proc = Bun.spawnSync([
      rustc!,
      "--crate-type",
      "lib",
      "--edition",
      "2021",
      "--emit=metadata",
      "-D",
      "warnings",
      "-A",
      "dead_code",
      // Generated code is not read for style: it is fully parenthesized on purpose, so precedence can never
      // be got wrong. Everything else — types, and above all the BORROW checker — is still denied.
      "-A",
      "unused_parens",
      "--out-dir",
      dir,
      file,
    ])
    const stderr = proc.stderr.toString()
    await rm(dir, { recursive: true, force: true })
    expect(stderr).toBe("")
    expect(proc.exitCode).toBe(0)
  }, 60_000)
})
