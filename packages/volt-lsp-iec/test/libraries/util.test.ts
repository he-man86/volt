/**
 * UTIL AS THE LIBRARY REPO WRITES IT — `libraries/Util/<version>`. Only BLINK so far: the Util element real code
 * calls most (44 sites across the corpus); the rest of Util stays bodyless and refused until something needs it.
 *
 * Lowered against a REAL project's materialization — pro2193, which resolves Util 3.5.19.0 and Standard 3.5.18.0 —
 * because BLINK is a library element built from another library's: its phase timer is Standard's TP, so this is
 * also the case where one repo library runs on another.
 *
 * What it does is CODESYS's answer, recorded (`lib_util_blink`, `lib_util_blink_slow`): the HIGH phase first, each
 * phase flipping in the scan it runs out, and OUT kept as it was once ENABLE falls.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CLOCK, emitRust, lowerSource, run, rustAccess, type IrPou } from "../../src/transpile/index.js"
import { withImplementations } from "../../libraries/index.js"
import { RUSTC as rustc, skipRustSuite } from "../conformance/support/rustc.js"

const MANAGER = join(import.meta.dir, "..", "..", "test-corpus", "pro2193", "Device", "Plc Logic", "Application", "09 Misc", "Library Manager")
const materialized = ["Standard", "Util"].flatMap((lib) =>
  readdirSync(join(MANAGER, lib)).map((f) => ({ uri: join(MANAGER, lib, f), source: readFileSync(join(MANAGER, lib, f), "utf8") })),
)

// ENABLE holds for eight scans and falls on the ninth
const PROGRAM = "PROGRAM P\nVAR b : BLINK; n : INT; END_VAR\nn := n + 1;\nb(ENABLE := n < 9, TIMELOW := T#100MS, TIMEHIGH := T#50MS);\nEND_PROGRAM\n"
const CLOCK_MS = [0, 40, 100, 130, 150, 200, 240, 250, 300]

function lowered(): IrPou {
  const { pou, diagnostics } = lowerSource(PROGRAM, "P", withImplementations(materialized))
  if (pou === undefined) throw new Error(diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"))
  return pou
}

/** OUT after each scan, the clock set to each reading first. */
function interpreted(pou: IrPou): string[] {
  const p = run(pou)
  return CLOCK_MS.map((ms) => {
    p.set(CLOCK, BigInt(ms) * 1_000_000n)
    p.scan()
    return String(p.get("b.OUT"))
  })
}

describe("BLINK", () => {
  test("OUT spends TIMEHIGH high first, then TIMELOW low, and keeps its value once ENABLE falls", () => {
    //                         0       40      100      130      150      200     240     250      300 (ENABLE fell)
    expect(interpreted(lowered())).toEqual(["true", "true", "false", "false", "false", "true", "true", "false", "false"])
  })

  test("the materialization alone is refused, not run as an empty body", () => {
    const { diagnostics } = lowerSource("PROGRAM P\nVAR b : BLINK; END_VAR\nb(ENABLE := TRUE);\nEND_PROGRAM\n", "P", materialized)
    expect(diagnostics.map((d) => d.code)).toEqual(["call-library"])
  })

  test.skipIf(skipRustSuite())("runs in the emitted Rust exactly as in the interpreter — a library block inside a library block", async () => {
    const pou = lowered()
    const at = (path: string) => rustAccess(pou, path).expr
    const scans = CLOCK_MS.map((ms) =>
      [`    g.${at(CLOCK)} = ${BigInt(ms) * 1_000_000n};`, "    p.scan(&mut g);", `    println!("{}", p.${at("b.OUT")});`].join("\n"),
    )
    const program = [emitRust(pou).code, "fn main() {", "    let mut g = Globals::new();", "    let mut p = P::new();", ...scans, "}", ""].join("\n")
    const dir = await mkdtemp(join(tmpdir(), "volt-util-"))
    try {
      const file = join(dir, "blink.rs")
      const exe = join(dir, `blink${process.platform === "win32" ? ".exe" : ""}`)
      await Bun.write(file, program)
      const build = Bun.spawnSync([rustc!, "--edition", "2021", "-A", "warnings", "-o", exe, file], { stderr: "pipe" })
      expect(build.stderr.toString()).toBe("")
      const got = Bun.spawnSync([exe], { stdout: "pipe" }).stdout.toString().trim().split(/\r?\n/)
      expect(got).toEqual(interpreted(pou))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
