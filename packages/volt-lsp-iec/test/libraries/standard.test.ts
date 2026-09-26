/**
 * THE STANDARD LIBRARY AS THE LIBRARY REPO WRITES IT — `libraries/Standard/3.5.18.0`, transpiled like user code.
 *
 * What the nine string functions compute is proved elsewhere, and by the vendor: the recorded `str_*` / `string_*`
 * fixtures lower against this repo (`PROJECT_LOWERING`), so CODESYS is their oracle. This file holds what no
 * recording reaches yet:
 *   - the repo writes every element of the library (their interfaces are `repo.test.ts`'s, for every library);
 *   - the repo answers for the version a project RESOLVED, and a version it has not written stays refused;
 *   - the function blocks, which run over many scans and, the timers, over a clock the harness sets.
 *
 * CODESYS is the oracle for these bodies — `fixtures/libraries/library-bodies.ts`, recorded against the real
 * library, replayed on the recorded clock. This file is the fast offline half: the same behaviour, pinned where it is
 * cheap to run and to read.
 */
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CLOCK, emitRust, lowerSource, run, rustAccess, type Runner } from "../../src/transpile/index.js"
import { implementationDir, withImplementations } from "../../libraries/index.js"
import { STANDARD, PROJECT_LOWERING } from "../conformance/support/project-libraries.js"
import { RUSTC as rustc, skipRustSuite } from "../conformance/support/rustc.js"

const REPO = implementationDir("Standard", "3.5.18.0")!

/** A program over the library, lowered against the fixture project's Standard — or the reason it did not lower. */
function lower(decls: string, body: string, libraries = PROJECT_LOWERING) {
  return lowerSource(`PROGRAM PLC_PRG\nVAR\n${decls}END_VAR\n${body}END_PROGRAM\n`, "PLC_PRG", libraries)
}

function load(decls: string, body: string): Runner {
  const { pou, diagnostics } = lower(decls, body)
  if (pou === undefined) throw new Error(diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"))
  return run(pou)
}

/** Scan once per clock reading (milliseconds), and read `reads` after each scan. */
function scans(p: Runner, clockMs: readonly number[], reads: readonly string[]): unknown[][] {
  return clockMs.map((ms) => {
    p.set(CLOCK, BigInt(ms) * 1_000_000n)
    p.scan()
    return reads.map((r) => p.get(r))
  })
}

describe("the repo", () => {
  test("writes every element of Standard 3.5.18.0 (its interface is `repo.test.ts`'s to hold)", () => {
    expect(readdirSync(REPO).sort()).toEqual(readdirSync(STANDARD).filter((f) => /.(fb|fun)$/.test(f)).sort())
  })

  test("it answers for the version the project resolved, and a version it has not written stays refused", () => {
    const manifest = PROJECT_LOWERING.find((f) => f.uri.startsWith(STANDARD) && f.uri.endsWith(".library"))!
    const declarations = readdirSync(STANDARD).map((f) => ({ uri: join(STANDARD, f), source: readFileSync(join(STANDARD, f), "utf8") }))
    const other = declarations.map((f) =>
      f.uri === manifest.uri ? { ...f, source: f.source.replace("Standard, 3.5.18.0", "Standard, 3.5.19.0") } : f,
    )
    const src = ["\tt : TON;\n", "t(IN := TRUE, PT := T#1S);\n"] as const
    // 3.5.19.0 is not in the repo: the declarations come back as they were, and the block has no body to run
    expect(withImplementations(other)).toEqual(other)
    expect(lower(...src, withImplementations(other)).diagnostics.map((d) => d.code)).toEqual(["call-library"])
    expect(lower(...src, withImplementations(declarations)).diagnostics).toEqual([])
  })
})

describe("the clock-free blocks", () => {
  // `sig` is high on scans 2, 4 and 5: two rising edges (2, 4) and two falling ones (3, 6)
  const signal = "n := n + 1;\nsig := n = 2 OR n = 4 OR n = 5;\n"

  test("R_TRIG and F_TRIG fire on exactly one scan per edge", () => {
    const p = load(
      "\trise : R_TRIG;\n\tfall : F_TRIG;\n\tn : INT;\n\tsig : BOOL;\n\trises : INT;\n\tfalls : INT;\n",
      signal + "rise(CLK := sig);\nIF rise.Q THEN rises := rises + 1; END_IF\nfall(CLK := sig);\nIF fall.Q THEN falls := falls + 1; END_IF\n",
    )
    for (let i = 0; i < 6; i++) p.scan()
    expect([p.get("rises"), p.get("falls")]).toEqual([2n, 2n])
  })

  test("the counters count edges, not scans, in their WORD", () => {
    const p = load(
      "\tup : CTU;\n\tdown : CTD;\n\tboth : CTUD;\n\tn : INT;\n\tsig : BOOL;\n",
      signal +
        "up(CU := sig, RESET := FALSE, PV := 2);\n" +
        "down(CD := sig, LOAD := n = 1, PV := 5);\n" +
        "both(CU := FALSE, CD := sig, RESET := FALSE, LOAD := n = 1, PV := 5);\n",
    )
    for (let i = 0; i < 6; i++) p.scan()
    expect([p.get("up.CV"), p.get("up.Q"), p.get("down.CV"), p.get("both.CV"), p.get("both.QD")]).toEqual([2n, true, 3n, 3n, false])
  })

  test("a counter stops at the ends of its WORD rather than wrapping", () => {
    const p = load("\tup : CTU;\n\tdown : CTD;\n\tn : INT;\n", "n := n + 1;\nup(CU := n = 2, PV := 1);\ndown(CD := n = 2, PV := 1);\n")
    p.set("up.CV", 0xffffn)
    p.scan()
    p.scan()
    expect([p.get("up.CV"), p.get("down.CV"), p.get("down.Q")]).toEqual([0xffffn, 0n, true])
  })

  test("SR is set-dominant and RS reset-dominant", () => {
    const p = load("\ts : SR;\n\tr : RS;\n", "s(SET1 := TRUE, RESET := TRUE);\nr(SET := TRUE, RESET1 := TRUE);\n")
    p.scan()
    expect([p.get("s.Q1"), p.get("r.Q1")]).toEqual([true, false])
  })
})

describe("the timers, over the clock the harness sets", () => {
  // `in` is TRUE on every scan but the fifth
  const decls = "\tt : TON;\n\tf : TOF;\n\tp : TP;\n\tn : INT;\n"
  const drive = (block: string) => `n := n + 1;\n${block}(IN := n <> 5, PT := T#100MS);\n`

  test("TON: Q once IN has held for PT, and ET holds there until IN falls", () => {
    const p = load(decls, drive("t"))
    expect(scans(p, [0, 50, 100, 150, 200, 250], ["t.Q", "t.ET"])).toEqual([
      [false, 0n],
      [false, 50n],
      [true, 100n],
      [true, 100n],
      [false, 0n], // IN fell
      [false, 0n], // and rose again: a new start
    ])
  })

  test("TOF: Q follows IN up at once, and falls PT after IN does", () => {
    const p = load(decls, "n := n + 1;\nf(IN := n = 1, PT := T#100MS);\n")
    expect(scans(p, [0, 10, 60, 110, 160], ["f.Q", "f.ET"])).toEqual([
      [true, 0n],
      [true, 0n], // IN fell at 10
      [true, 50n],
      [false, 100n],
      [false, 100n],
    ])
  })

  test("TP: one pulse of PT per rising edge, which IN falling does not cut short", () => {
    const p = load(decls, "n := n + 1;\np(IN := n = 1 OR n = 5, PT := T#100MS);\n")
    expect(scans(p, [0, 50, 100, 150, 200, 250], ["p.Q", "p.ET"])).toEqual([
      [true, 0n],
      [true, 50n], // IN is already FALSE
      [false, 0n], // the pulse ran out with IN low: ET clears in THAT scan (recorded: lib_std_tp)
      [false, 0n],
      [true, 0n], // the next edge
      [true, 50n],
    ])
  })

  test("RTC runs from PDT with the clock, carrying what a second-counting DT cannot hold yet", () => {
    const p = load("\tclock : RTC;\n", "clock(EN := TRUE, PDT := DT#2026-01-01-00:00:00);\n")
    const start = BigInt(Date.UTC(2026, 0, 1) / 1000)
    expect(scans(p, [0, 1500, 2600], ["clock.Q", "clock.CDT"])).toEqual([
      [true, start],
      [true, start + 1n],
      [true, start + 2n], // 1100ms more, plus the 500 carried
    ])
  })
})

describe.skipIf(skipRustSuite())("the emitted Rust", () => {
  test("a TON transpiled from the repo runs in Rust exactly as the interpreter runs it", async () => {
    const source = ["\tt : TON;\n\tn : INT;\n", "n := n + 1;\nt(IN := n <> 5, PT := T#100MS);\n"] as const
    const clock = [0, 50, 100, 150, 200, 250]
    const { pou } = lower(...source)
    const emitted = emitRust(pou!)
    // no runtime: TON is a struct of its own variables and a body of the statements the ST wrote
    expect(emitted.code).toContain("pub struct TON")
    expect(emitted.code).not.toContain("use ")
    const at = (path: string) => rustAccess(pou!, path)
    const lines = clock.map((ms) =>
      [
        `    g.${at(CLOCK).expr} = ${BigInt(ms) * 1_000_000n};`,
        "    p.scan(&mut g);",
        `    println!("{} {}", p.${at("t.Q").expr}, p.${at("t.ET").expr});`,
      ].join("\n"),
    )
    const program = `${emitted.code}\nfn main() {\n    let mut g = Globals::new();\n    let mut p = PLC_PRG::new();\n${lines.join("\n")}\n}\n`
    const dir = await mkdtemp(join(tmpdir(), "volt-std-"))
    try {
      const file = join(dir, "ton.rs")
      const exe = join(dir, `ton${process.platform === "win32" ? ".exe" : ""}`)
      await Bun.write(file, program)
      const build = Bun.spawnSync([rustc!, "--edition", "2021", "-A", "warnings", "-o", exe, file], { stderr: "pipe" })
      expect(build.stderr.toString()).toBe("")
      const out = Bun.spawnSync([exe], { stdout: "pipe" }).stdout.toString().trim().split(/\r?\n/)
      const expected = scans(run(pou!), clock, ["t.Q", "t.ET"]).map(([q, et]) => `${String(q)} ${String(et)}`)
      expect(out).toEqual(expected)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
