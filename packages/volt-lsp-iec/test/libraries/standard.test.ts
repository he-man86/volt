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
import { buildRust } from "../conformance/support/rustc-cache-build.js"
import { mkdtemp, rm } from "node:fs/promises"
import { readdirSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { CLOCK, emitRust, lowerSource, run, type Runner } from "../../src/transpile/index.js"
import { rustAccess } from "../conformance/support/rust-access.js"
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
    expect(readdirSync(REPO).sort()).toEqual(readdirSync(STANDARD).filter((f) => /\.pou$/.test(f)).sort())
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
    const p = load("\tsetDom : SR;\n\tresetDom : RS;\n", "setDom(SET1 := TRUE, RESET := TRUE);\nresetDom(SET := TRUE, RESET1 := TRUE);\n")
    p.scan()
    expect([p.get("setDom.Q1"), p.get("resetDom.Q1")]).toEqual([true, false])
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
        `    ${at(CLOCK).write(String(BigInt(ms) * 1_000_000n))}`,
        "    p.scan(&mut g);",
        `    println!("{} {}", ${at("t.Q").read}, ${at("t.ET").read});`,
      ].join("\n"),
    )
    const program = `${emitted.code}\nfn main() {\n    let mut g = Globals::new();\n    let mut p = PLC_PRG::new();\n${lines.join("\n")}\n}\n`
    const dir = await mkdtemp(join(tmpdir(), "volt-std-"))
    try {
      const file = join(dir, "ton.rs")
      const exe = join(dir, `ton${process.platform === "win32" ? ".exe" : ""}`)
      const build = await buildRust([rustc!, "--edition", "2021", "-A", "warnings", "-o", exe, file], file, exe, program)
      expect(build.stderr).toBe("")
      const out = Bun.spawnSync([exe], { stdout: "pipe" }).stdout.toString().trim().split(/\r?\n/)
      const expected = scans(run(pou!), clock, ["t.Q", "t.ET"]).map(([q, et]) => `${String(q)} ${String(et)}`)
      expect(out).toEqual(expected)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // Gate 7.4c (review): no test compiled a lent string taken where it is written (`calls/string-inputs.ts`
  // `inputWhereWritten`), nor the inputs hoisted before it (`emit/rust/calls.ts` `hoistedInputs`) — 0 fixtures print
  // one — so `let __input_copy_1: IecString<10> = *io;` (E0308: `io` is generic over its capacity) went through. Each
  // program here takes one; it must build and print what the interpreter computes, a fault included.
  test("a lent string taken where it is written builds and computes what the interpreter does", async () => {
    const cut = (write: string, result: string) => `FUNCTION Cut : INT\nVAR_IN_OUT\n\tt : STRING(10);\nEND_VAR\n${write}Cut := ${result};\nEND_FUNCTION\n\n`
    const fb = (body: string, method: string) =>
      `FUNCTION_BLOCK FB\nVAR_IN_OUT\n\tio : STRING(10);\nEND_VAR\nVAR\n\tres : STRING(255);\nEND_VAR\nres := ${body};\nEND_FUNCTION_BLOCK\n${method}\n`
    const prg = (decls: string, body: string) => `PROGRAM PLC_PRG\nVAR\n${decls}END_VAR\n${body}END_PROGRAM\n`
    const viaFb = prg("\tv : STRING(10) := 'abc';\n\tfb : FB;\n\tres : STRING(255);\n", "fb(io := v);\nres := fb.res;\n")
    const cases: [string, string][] = [
      // a later argument's call changes the lent variable: the copy reads it before
      ["later_call", `${cut("t[1] := 0;\n", "3")}${prg("\ttxt : STRING(10) := 'hello';\n\tres : STRING(255);\n", "res := LEFT(txt, Cut(t := txt));\n")}`],
      // the lent string is a STRING VAR_IN_OUT: a FUNCTION's, an FB's (a METHOD writes it), and one bound to a wider string,
      // read at its declared capacity as CODESYS reads it (`string_input_lent_inout_wider`: 'abcdefghij1')
      ["inout_function", `${cut("t := 'x';\n", "1")}FUNCTION F : STRING(255)\nVAR_IN_OUT\n\tio : STRING(10);\nEND_VAR\nF := MID(io, Cut(t := io), 1);\nEND_FUNCTION\n\n${prg("\tv : STRING(10) := 'abc';\n\tres : STRING(255);\n", "res := F(io := v);\n")}`],
      ["inout_fb_concat", `${fb("CONCAT(io, Get())", "METHOD Get : STRING(10)\nio := 'x';\nGet := 'Y';\nEND_METHOD\n")}${viaFb}`],
      ["inout_fb_mid", `${fb("MID(io, Shrink(), 1)", "METHOD Shrink : INT\nio := 'x';\nShrink := 1;\nEND_METHOD\n")}${viaFb}`],
      ["inout_wider", `${cut("", "1")}FUNCTION F : STRING(255)\nVAR_IN_OUT\n\tio : STRING(10);\nEND_VAR\nF := CONCAT(io, INT_TO_STRING(Cut(t := io)));\nEND_FUNCTION\n\n${prg("\tv : STRING(12) := 'abcdefghijkl';\n\tres : STRING(255);\n", "res := F(io := v);\n")}`],
      // the lent string faults on its index, and so would a later argument: the index's fault is the one reported
      ["fault_order", prg("\tarr : ARRAY[0..2] OF STRING(10);\n\ti : INT := 5;\n\tj : INT;\n\tres : STRING(255);\n", "res := MID(arr[i], 10 / j, 1);\n")],
      // an input written before the lent string runs before it: the division's fault is the one reported
      ["fault_hoisted", prg("\tarr : ARRAY[0..2] OF STRING(10);\n\ti : INT := 5;\n\tj : INT;\n\tres : STRING(255);\n", "res := MID(LEN := 10 / j, STR := arr[i], POS := 10 / j);\n")],
    ]
    const dir = await mkdtemp(join(tmpdir(), "volt-std-frozen-"))
    try {
      const seen: string[][] = []
      for (const [name, source] of cases) {
        const { pou, diagnostics } = lowerSource(source, "PLC_PRG", PROJECT_LOWERING)
        expect([name, diagnostics]).toEqual([name, []])
        const code = emitRust(pou!).code
        expect([name, code.includes("__input_copy")]).toEqual([name, true])
        let interp: string
        try {
          const p = run(pou!)
          p.scan()
          interp = String(p.get("res"))
        } catch (e) {
          interp = `FAULT ${e instanceof Error ? e.message : String(e)}`
        }
        const globals = code.includes("pub struct Globals")
        const main = `fn main() {\n${globals ? "    let mut g = Globals::new();\n" : ""}    let mut p = PLC_PRG::new();\n    p.scan(${globals ? "&mut g" : ""});\n    println!("{:?}", ${rustAccess(pou!, "res").read});\n}\n`
        const file = join(dir, `${name}.rs`)
        const exe = join(dir, `${name}${process.platform === "win32" ? ".exe" : ""}`)
        const build = await buildRust([rustc!, "--edition", "2021", "-A", "warnings", "-o", exe, file], file, exe, `${code}\n${main}`)
        expect([name, build.stderr]).toEqual([name, ""])
        const ran = Bun.spawnSync([exe], { stdout: "pipe", stderr: "pipe", timeout: 30_000 })
        // a fault: the Rust panics on the same index (`index is 5`) or the same division the interpreter reports
        const rust = ran.exitCode === 0 ? (JSON.parse(ran.stdout.toString().trim()) as string) : /index is 5/.test(ran.stderr.toString()) ? "FAULT array index 5 is outside its bounds" : /divide by zero|division by zero/.test(ran.stderr.toString()) ? "FAULT division by zero" : `PANIC ${ran.stderr.toString()}`
        seen.push([name, interp, rust])
      }
      expect(seen).toEqual([
        ["later_call", "hel", "hel"],
        ["inout_function", "a", "a"],
        ["inout_fb_concat", "abcY", "abcY"],
        ["inout_fb_mid", "a", "a"],
        ["inout_wider", "abcdefghij1", "abcdefghij1"],
        ["fault_order", "FAULT array index 5 is outside its bounds", "FAULT array index 5 is outside its bounds"],
        ["fault_hoisted", "FAULT division by zero", "FAULT division by zero"],
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 120_000)
})

/** Every buffer of `capacity` units over {0, 'a', 'b'} — the units behind a terminator among them. */
function buffers(capacity: number): string[] {
  let out = [""]
  for (let i = 0; i < capacity; i++) out = out.flatMap((b) => ["\0", "a", "b"].map((u) => b + u))
  return out
}
const CAPACITIES = [0, 1, 2, 3, 4] as const
/** Every INT argument the proof runs a function with. */
const INTS = [-2, -1, 0, 1, 2, 3, 4, 5, 6] as const
/** A full STRING(255): 255 units and no terminator before the capacity's. */
const FULL = "ab".repeat(128).slice(0, 255)

describe("LEN_INTERNAL, the primitive (task 7.4.6)", () => {
  test("`length` counts what the repo's ST body counts, over every buffer of capacity 0-4 and a full STRING(255)", () => {
    // the ST walk over the caller's very buffer: its in-out read-only (`VAR_IN_OUT CONSTANT`, which its body only reads), as
    // CODESYS binds a STRING(N < 255) only to a CONSTANT one — a plain VAR_IN_OUT STRING(255) given it is "too short"
    // (`string_inout_narrower`, transpile-restructure 8.2 step 8e: `call-inout-short`)
    const st = readFileSync(join(REPO, "LEN_INTERNAL.pou"), "utf8").replaceAll("LEN_INTERNAL", "LEN_INTERNAL_ST").replace(/^VAR_IN_OUT$/m, "VAR_IN_OUT CONSTANT")
    const mismatches: string[] = []
    for (const capacity of [...CAPACITIES, 255]) {
      const program = `${st}\n\nPROGRAM PLC_PRG\nVAR\n\tx1 : STRING(${capacity});\n\tprimitive : UINT;\n\twalked : UINT;\nEND_VAR\nprimitive := LEN_INTERNAL(x1);\nwalked := LEN_INTERNAL_ST(x1);\nEND_PROGRAM\n`
      const { pou, diagnostics } = lowerSource(program, "PLC_PRG", PROJECT_LOWERING)
      expect(diagnostics).toEqual([])
      const p = run(pou!)
      for (const buffer of capacity === 255 ? [FULL, `${FULL.slice(0, 7)}\0${FULL.slice(8)}`] : buffers(capacity)) {
        p.set("x1", buffer)
        p.scan()
        if (p.get("primitive") !== p.get("walked")) mismatches.push(`STRING(${capacity}) ${JSON.stringify(buffer)}: ${String(p.get("primitive"))} vs ${String(p.get("walked"))}`)
      }
    }
    expect(mismatches).toEqual([])
  })
})

/**
 * THE PROOF A READ-ONLY STRING INPUT RESTS ON (design.md §3.2 7.4c). A Standard string FUNCTION reads a caller's
 * STRING(N <= 255) where it lies instead of a STRING(255) copy of it (`calls/string-inputs.ts`). The two differ only where
 * a body reads STR[k] with N < k <= 255 — the copy reads 0, the borrow faults — or reads STR whole into a destination
 * whose units past N are not 0. Every body here reads STR only at k <= LEN_INTERNAL(STR) <= N, and whole only into its
 * own fresh result; this holds it: each function over every buffer of capacity 0-4 over {0, 'a', 'b'} (the units behind
 * the terminator included), every INT argument in -2..6, and a full STRING(255) — passed as a STRING(N), and as the same
 * buffer in a STRING(255) (a borrow at 255 is the copy) — must answer alike, and neither may fault. A body change that
 * breaks it fails here.
 */
describe("the Standard string functions read a STRING(N) input as they read its STRING(255) copy (7.4.6)", () => {
  // each function: its STRING inputs, its INT inputs, its result
  const FUNCTIONS = {
    LEN: { strings: ["STR"], ints: [], result: "INT" },
    LEFT: { strings: ["STR"], ints: ["SIZE"], result: "STRING(255)" },
    RIGHT: { strings: ["STR"], ints: ["SIZE"], result: "STRING(255)" },
    MID: { strings: ["STR"], ints: ["LEN", "POS"], result: "STRING(255)" },
    DELETE: { strings: ["STR"], ints: ["LEN", "POS"], result: "STRING(255)" },
    CONCAT: { strings: ["STR1", "STR2"], ints: [], result: "STRING(255)" },
    FIND: { strings: ["STR1", "STR2"], ints: [], result: "INT" },
    INSERT: { strings: ["STR1", "STR2"], ints: ["POS"], result: "STRING(255)" },
    REPLACE: { strings: ["STR1", "STR2"], ints: ["L", "P"], result: "STRING(255)" },
  } as const

  /** Every combination of one value per list. */
  const product = <T>(lists: readonly (readonly T[])[]): T[][] => lists.reduce<T[][]>((acc, list) => acc.flatMap((a) => list.map((v) => [...a, v])), [[]])

  test("names every FUNCTION of the repo the borrow reaches — each with a STRING(255) VAR_INPUT", () => {
    const reached = readdirSync(REPO).filter((f) => {
      const source = readFileSync(join(REPO, f), "utf8")
      return source.startsWith("FUNCTION ") && (/VAR_INPUT\r?\n([^]*?)END_VAR/.exec(source)?.[1] ?? "").includes("STRING(255)")
    })
    expect(reached.map((f) => f.replace(/\.pou$/, "")).sort()).toEqual(Object.keys(FUNCTIONS).sort())
  })

  for (const [name, { strings, ints, result }] of Object.entries(FUNCTIONS))
    test(name, () => {
      const faults: string[] = []
      const differ: string[] = []
      // the capacities each STRING input is lent at: every one of 0-4 — 0-3 for REPLACE, whose two strings and two INTs
      // over 0-4 are 1.2M runs (38 s); its STR1 is DELETE's and its STR2 INSERT's, each held over 0-4 above — and 255
      // with the full buffer
      const capacities = strings.length * ints.length > 2 ? CAPACITIES.slice(0, 4) : CAPACITIES
      const shapes: (readonly number[])[] = [...product(strings.map(() => capacities)), strings.map(() => 255)]
      for (const caps of shapes) {
        const decls = strings.flatMap((_, k) => [`\tx${k} : STRING(${caps[k]});\n`, `\tw${k} : STRING(255);\n`])
        const args = (prefix: string): string => [...strings.map((s, k) => `${s} := ${prefix}${k}`), ...ints.map((n, k) => `${n} := k${k}`)].join(", ")
        const program = `PROGRAM PLC_PRG\nVAR\n${decls.join("")}${ints.map((_, k) => `\tk${k} : INT;\n`).join("")}\tlent : ${result};\n\tcopied : ${result};\nEND_VAR\nlent := ${name}(${args("x")});\ncopied := ${name}(${args("w")});\nEND_PROGRAM\n`
        const { pou, diagnostics } = lowerSource(program, "PLC_PRG", PROJECT_LOWERING)
        expect(diagnostics).toEqual([])
        // the first call IS the borrow this holds: the variant takes each string as an in-out of the argument's capacity
        expect(pou!.routines.map((r) => r.name)).toContain(`Standard.${name}#${strings.map((s, k) => `${s}&=STRING${caps[k]}`).join(",")}`)
        const p = run(pou!)
        const full = caps.every((c) => c === 255)
        // the full shape: each input full in turn, the others ''
        const contents = full ? strings.map((_, k) => strings.map((__, j) => (j === k ? FULL : ""))) : product(caps.map((c) => buffers(c)))
        for (const texts of contents)
          for (const values of product(ints.map(() => INTS))) {
            for (const [k, t] of texts.entries()) {
              p.set(`x${k}`, t)
              p.set(`w${k}`, t)
            }
            for (const [k, v] of values.entries()) p.set(`k${k}`, BigInt(v))
            const at = `${name}(${caps.map((c, k) => `STRING(${c}) ${JSON.stringify(texts[k])}`).join(", ")}${values.length > 0 ? `, ${values.join(", ")}` : ""})`
            try {
              p.scan()
            } catch (e) {
              faults.push(`${at}: ${e instanceof Error ? e.message : String(e)}`)
              continue
            }
            if (p.get("lent") !== p.get("copied")) differ.push(`${at}: ${JSON.stringify(p.get("lent"))} vs ${JSON.stringify(p.get("copied"))}`)
          }
      }
      expect(faults.slice(0, 5)).toEqual([])
      expect(differ.slice(0, 5)).toEqual([])
    }, 120_000)
})
