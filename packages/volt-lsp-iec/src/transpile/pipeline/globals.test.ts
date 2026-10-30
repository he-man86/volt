/**
 * EVERY DECLARED GLOBAL IS A RUNNER VARIABLE (openspec `gvl-qualified-runner-paths`, `gvl-fb-instance-call`,
 * `runner-unused-globals` — one root). A VAR_GLOBAL of every GVL handed in has a global slot of its full layout, whether the
 * program references it or not, and the runner names it `<GVL>.<name>` — the bare name only when one list declares it and
 * that list is not `qualified_only`, else the bare name is refused by name. An FB instance declared in a GVL is called and
 * read like a local one. Each draft's repro is a test here; the sweep covers every kind of global, read AND written.
 */
import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emitRust, lowerSource, run, type Runner } from "../index.js"
import { CLOCK } from "../lower/builtins/clock.js"
import { PROJECT_LOWERING } from "../../../test/conformance/support/project-libraries.js"
import { buildRust } from "../../../test/conformance/support/rustc-cache-build.js"
import { rustAccess } from "../../../test/conformance/support/rust-access.js"
import { RUSTC, skipRustSuite } from "../../../test/conformance/support/rustc.js"

type File = { uri: string; source: string }
const gvl = (name: string, body: string, qualified = false): File => ({
  uri: `${name}.gvl`,
  source: `${qualified ? "{attribute 'qualified_only'}\n" : ""}VAR_GLOBAL\n${body}END_VAR\n`,
})

/** The program lowered against `files` — every diagnostic a failure, said by code and message. */
function runner(main: string, files: readonly File[], name = "Main"): Runner {
  const { pou, diagnostics } = lowerSource(main, name, files, "Main.pou")
  if (pou === undefined) throw new Error(diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"))
  return run(pou)
}
const idle = "PROGRAM Main\nVAR\n\tx : INT;\nEND_VAR\nx := x + 1;\nEND_PROGRAM\n"

const ELEMENTARY: readonly [string, string, unknown, unknown][] = [
  ["BOOL", "TRUE", true, false],
  ["SINT", "-5", -5n, 7n],
  ["USINT", "5", 5n, 255n],
  ["INT", "-300", -300n, 32767n],
  ["UINT", "300", 300n, 65535n],
  ["DINT", "-70000", -70000n, 2147483647n],
  ["UDINT", "70000", 70000n, 4294967295n],
  ["LINT", "-5", -5n, 9223372036854775807n],
  ["ULINT", "5", 5n, 18446744073709551615n],
  ["BYTE", "16#FF", 255n, 1n],
  ["WORD", "16#FFFF", 65535n, 2n],
  ["DWORD", "16#FFFFFFFF", 4294967295n, 3n],
  ["LWORD", "16#FFFFFFFFFFFFFFFF", 18446744073709551615n, 4n],
  ["REAL", "1.5", 1.5, -2.25],
  ["LREAL", "0.1", 0.1, -1e300],
  ["TIME", "T#1S", 1000n, 5n],
  ["LTIME", "LTIME#1MS", 1_000_000n, 5n],
  ["DATE", "D#1970-01-02", 86400n, 0n],
  ["TOD", "TOD#00:00:01", 1000n, 2n],
  ["DT", "DT#1970-01-01-00:00:10", 10n, 3n],
  ["STRING(5)", "'abc'", "abc", "xy"],
  ["WSTRING(5)", '"abc"', "abc", "xy"],
]
const ELEMENTARY_DECLS = ELEMENTARY.map(([type, init], i) => `\tv${i} : ${type} := ${init};\n`).join("")

const STRUCT = { uri: "ST_Pair.dut", source: "TYPE ST_Pair :\nSTRUCT\n\ta : INT := 4;\n\tb : BOOL;\nEND_STRUCT\nEND_TYPE\n" }

const FB = { uri: "FB_Count.pou", source: "FUNCTION_BLOCK FB_Count\nVAR_INPUT\n\tstep : INT := 1;\nEND_VAR\nVAR_OUTPUT\n\tn : INT;\nEND_VAR\nn := n + step;\nEND_FUNCTION_BLOCK\n" }

const PROP = {
  uri: "FB_P.pou",
  source:
    "FUNCTION_BLOCK FB_P\nVAR\n\tstore : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nPROPERTY Level : INT\nGET\nLevel := store;\nEND_GET\nSET\nstore := Level * 2;\nEND_SET\nEND_PROPERTY\n",
}

// the repro as the draft measured it: Standard's TON, the repo's body, the harness's clock
const tonMain = (call: string, read: string) => `PROGRAM Main\nVAR\n\tq : BOOL;\nEND_VAR\n${call}(IN := TRUE, PT := T#1S);\nq := ${read}.Q;\nEND_PROGRAM\n`

describe("the drafts' repros", () => {
  test("gvl-qualified-runner-paths: two qualified_only lists, one name — each reached by its path, the bare name refused", () => {
    const lists = [gvl("GVL_A", "\tcount : INT;\n", true), gvl("GVL_B", "\tcount : INT;\n", true)]
    const p = runner("PROGRAM Main\nVAR\nEND_VAR\nGVL_A.count := 1;\nGVL_B.count := 2;\nEND_PROGRAM\n", lists)
    p.scan()
    expect([p.get("GVL_A.count"), p.get("GVL_B.count")]).toEqual([1n, 2n])
    expect(() => p.get("count")).toThrow("count is ambiguous: GVL_A.count, GVL_B.count")
    p.set("GVL_B.count", 5n)
    expect([p.get("GVL_A.count"), p.get("GVL_B.count")]).toEqual([1n, 5n])
  })

  test("runner-unused-globals: a global the program never names is listed, read and written", () => {
    const list = gvl("GVL_V1", "gTotal : INT;\ngSpeed : REAL := 1.5;\n", true)
    const { pou } = lowerSource("PROGRAM Main\nVAR\nx : INT;\nEND_VAR\nGVL_V1.gTotal := GVL_V1.gTotal + 1;\nEND_PROGRAM\n", "Main", [list], "Main.pou")
    expect(pou!.globals.map((g) => `${g.list}.${g.name}`)).toEqual(["GVL_V1.gTotal", "GVL_V1.gSpeed"])
    const p = run(pou!)
    expect([p.get("GVL_V1.gTotal"), p.get("GVL_V1.gSpeed")]).toEqual([0n, 1.5])
    p.set("GVL_V1.gSpeed", 2.0)
    p.scan()
    expect([p.get("GVL_V1.gTotal"), p.get("GVL_V1.gSpeed")]).toEqual([1n, 2.0])
  })

  const clocked = (p: Runner, ms: number) => {
    p.set(CLOCK, BigInt(ms) * 1_000_000n)
    p.scan()
    return [p.get("q"), p.get("GVL_A.t.Q")]
  }
  test("gvl-fb-instance-call: a TON in a qualified_only GVL is called and read through its list", () => {
    const p = runner(tonMain("GVL_A.t", "GVL_A.t"), [...PROJECT_LOWERING, gvl("GVL_A", "\tt : TON;\n", true)])
    expect([clocked(p, 0), clocked(p, 999), clocked(p, 1000)]).toEqual([[false, false], [false, false], [true, true]])
  })

  test("gvl-fb-instance-call: the same through a plain GVL, by its bare name", () => {
    const p = runner(tonMain("t", "t"), [...PROJECT_LOWERING, gvl("GVL_A", "\tt : TON;\n")])
    expect([clocked(p, 0), clocked(p, 1000)]).toEqual([[false, false], [true, true]])
    expect(p.get("t.ET")).toBe(1000n)
  })
})

describe("the sweep — every kind of global, referenced or not, read and written by its path", () => {

  test.each([false, true])("every elementary type, unreferenced, at its initial value and set (qualified_only %p)", (qualified) => {
    const p = runner(idle, [gvl("GVL_E", ELEMENTARY_DECLS, qualified)])
    for (const [i, [, , start, next]] of ELEMENTARY.entries()) {
      expect(p.get(`GVL_E.v${i}`)).toEqual(start as never)
      p.set(`GVL_E.v${i}`, next as never)
      expect(p.get(`GVL_E.v${i}`)).toEqual(next as never)
      if (qualified) expect(() => p.get(`v${i}`)).toThrow(`v${i} is declared by the qualified_only list GVL_E — name it GVL_E.v${i}`)
      else expect(p.get(`v${i}`)).toEqual(next as never)
    }
  })

  test("a struct, an array and an array of structs — by field and element, initial values included", () => {
    const list = gvl("GVL_C", "\tpair : ST_Pair := (b := TRUE);\n\tarr : ARRAY[1..3] OF INT := [7, 8];\n\tpairs : ARRAY[0..1] OF ST_Pair;\n", true)
    const p = runner(idle, [STRUCT, list])
    expect([p.get("GVL_C.pair.a"), p.get("GVL_C.pair.b"), p.get("GVL_C.arr[2]"), p.get("GVL_C.arr[3]"), p.get("GVL_C.pairs[1].a")]).toEqual([4n, true, 8n, 0n, 4n])
    expect(p.get("GVL_C.pair")).toEqual({ A: 4n, B: true })
    p.set("GVL_C.pair.a", 9n)
    p.set("GVL_C.arr[1]", -1n)
    p.set("GVL_C.pairs[0].b", true)
    expect([p.get("GVL_C.pair.a"), p.get("GVL_C.arr"), p.get("GVL_C.pairs[0].b")]).toEqual([9n, [-1n, 8n, 0n], true])
  })

  test("an FB instance: called and read qualified, bare for a plain list, and reached unreferenced", () => {
    const main = "PROGRAM Main\nVAR\n\tviaQ : INT;\n\tviaBare : INT;\nEND_VAR\nGVL_Q.c(step := 2);\nviaQ := GVL_Q.c.n;\nplain();\nviaBare := plain.n;\nEND_PROGRAM\n"
    const p = runner(main, [FB, gvl("GVL_Q", "\tc : FB_Count;\n\tspare : FB_Count;\n", true), gvl("GVL_P", "\tplain : FB_Count;\n")])
    p.scan()
    p.scan()
    expect([p.get("viaQ"), p.get("viaBare"), p.get("GVL_Q.c.n"), p.get("GVL_P.plain.n"), p.get("plain.n")]).toEqual([4n, 2n, 4n, 2n, 2n])
    expect([p.get("GVL_Q.spare.step"), p.get("GVL_Q.spare.n")]).toEqual([1n, 0n])
    p.set("GVL_P.plain.step", 10n)
    p.scan()
    expect([p.get("GVL_Q.c.n"), p.get("plain.n")]).toEqual([6n, 12n])
  })

  test("an FB instance in a GVL is called from another FB's body, and through a method", () => {
    const fb = { uri: "FB_M.pou", source: "FUNCTION_BLOCK FB_M\nVAR\n\tk : INT;\nEND_VAR\nk := k + 1;\nEND_FUNCTION_BLOCK\nMETHOD Bump : INT\nVAR_INPUT\n\tamount : INT;\nEND_VAR\nk := k + amount;\nBump := k;\nEND_METHOD\n" }
    const user = { uri: "FB_User.pou", source: "FUNCTION_BLOCK FB_User\nGVL_M.m();\nEND_FUNCTION_BLOCK\n" }
    const main = "PROGRAM Main\nVAR\n\tu : FB_User;\n\tgot : INT;\nEND_VAR\nu();\ngot := GVL_M.m.Bump(amount := 10);\nEND_PROGRAM\n"
    const p = runner(main, [fb, user, gvl("GVL_M", "\tm : FB_M;\n", true)])
    p.scan()
    expect([p.get("got"), p.get("GVL_M.m.k")]).toEqual([11n, 11n])
  })

  test("VAR_GLOBAL CONSTANT, RETAIN and PERSISTENT globals are runner variables like any other", () => {
    const list = {
      uri: "GVL_K.gvl",
      source: "VAR_GLOBAL CONSTANT\n\tcap : INT := 40;\nEND_VAR\nVAR_GLOBAL RETAIN\n\tkept : INT := 3;\nEND_VAR\nVAR_GLOBAL PERSISTENT\n\tstored : DINT := 4;\nEND_VAR\n",
    }
    const p = runner("PROGRAM Main\nVAR\n\tx : INT;\nEND_VAR\nx := cap + kept;\nkept := kept + 1;\nEND_PROGRAM\n", [list])
    p.scan()
    expect([p.get("x"), p.get("GVL_K.cap"), p.get("kept"), p.get("GVL_K.stored")]).toEqual([43n, 40n, 4n, 4n])
    p.set("GVL_K.stored", 9n)
    expect(p.get("stored")).toBe(9n)
  })

  test("two plain lists with one name: two globals, each by its list; the bare name is refused as ambiguous", () => {
    const p = runner("PROGRAM Main\nVAR\nEND_VAR\nGVL_One.g := GVL_Two.g + 1;\nEND_PROGRAM\n", [gvl("GVL_One", "\tg : INT := 3;\n"), gvl("GVL_Two", "\tg : INT := 5;\n")])
    p.scan()
    expect([p.get("GVL_One.g"), p.get("GVL_Two.g")]).toEqual([6n, 5n])
    expect(() => p.set("g", 1n)).toThrow("g is ambiguous: GVL_One.g, GVL_Two.g")
    p.set("GVL_Two.g", 1n)
    expect([p.get("GVL_One.g"), p.get("GVL_Two.g")]).toEqual([6n, 1n])
  })

  test("a qualified_only list and a plain one sharing a name: the bare name is refused, not taken for the plain one", () => {
    const p = runner("PROGRAM Main\nVAR\nEND_VAR\ncount := 2;\nGVL_Q.count := 1;\nEND_PROGRAM\n", [gvl("GVL_Q", "\tcount : INT;\n", true), gvl("GVL_P", "\tcount : INT;\n")])
    p.scan()
    expect([p.get("GVL_Q.count"), p.get("GVL_P.count")]).toEqual([1n, 2n])
    expect(() => p.get("count")).toThrow("count is ambiguous: GVL_Q.count, GVL_P.count")
  })

  test("the POU's own variable shadows a global of its name; a list's variable named like its list is reached both ways", () => {
    const shadow = runner("PROGRAM Main\nVAR\n\tg : INT := 9;\nEND_VAR\nEND_PROGRAM\n", [gvl("GVL_S", "\tg : INT := 1;\n")])
    expect([shadow.get("g"), shadow.get("GVL_S.g")]).toEqual([9n, 1n])
    const named = runner(idle, [STRUCT, gvl("Pair", "\tPair : ST_Pair;\n")])
    named.set("Pair.a", 6n)
    expect([named.get("Pair.Pair.a"), named.get("Pair.a")]).toEqual([6n, 6n])
  })

  test("a path naming nothing is refused by name — an unknown list member, an unknown global", () => {
    const p = runner(idle, [gvl("GVL_N", "\tg : INT;\n", true)])
    expect(() => p.get("GVL_N.nope")).toThrow("no variable GVL_N.nope in Main")
    expect(() => p.get("nope")).toThrow("no variable nope in Main")
  })

  test("a global whose declaration does not lower is named with its refusal; the runner refuses it, and a body reaching it is refused", () => {
    const list = gvl("GVL_X", "\tok : INT;\n\tbad : STRING := 'é';\n")
    const { pou, diagnostics } = lowerSource(idle, "Main", [list], "Main.pou")
    expect(diagnostics).toEqual([])
    // named with its refusal, in the list's file at the initializer (openspec lowering-diagnostic-uri)
    const [bad] = pou!.unlowered!
    expect([bad!.list, bad!.name, bad!.code, bad!.message, bad!.uri, bad!.span.startLine]).toEqual(["GVL_X", "bad", "string-non-ascii", "'é' holds a character not measured yet", "GVL_X.gvl", 3])
    const p = run(pou!)
    expect(p.get("GVL_X.ok")).toBe(0n)
    const refused = "GVL_X.bad has no value — its declaration did not lower (string-non-ascii: 'é' holds a character not measured yet)"
    expect(() => p.get("GVL_X.bad")).toThrow(refused)
    expect(() => p.set("bad", "x")).toThrow(refused)
    const reached = lowerSource("PROGRAM Main\nVAR\n\tx : INT;\nEND_VAR\nbad := 'a';\nEND_PROGRAM\n", "Main", [list], "Main.pou")
    expect([reached.pou, reached.diagnostics.map((d) => [d.code, d.span.startLine])]).toEqual([undefined, [["string-non-ascii", 3]]])
    // storage no backend holds is the same: a type that does not resolve
    const missing = lowerSource(idle, "Main", [gvl("GVL_U", "\tmissing : T_Missing;\n")], "Main.pou").pou!
    expect(missing.unlowered!.map((u) => [u.list, u.name, u.code, u.uri, u.span.startLine])).toEqual([["GVL_U", "missing", "slot-unknown", "GVL_U.gvl", 2]])
  })

  test("an unreferenced FB instance whose init the init step does not walk refuses the POU — CODESYS runs that init first", () => {
    const fb = {
      uri: "FB_I.pou",
      source: "FUNCTION_BLOCK FB_I\nVAR\n\tk : INT;\nEND_VAR\nk := k + 1;\nEND_FUNCTION_BLOCK\nMETHOD FB_Init : BOOL\nVAR_INPUT\n\tbInitRetains : BOOL;\n\tbInCopyCode : BOOL;\nEND_VAR\nk := 5;\nEND_METHOD\n",
    }
    const { pou, diagnostics } = lowerSource(idle, "Main", [fb, gvl("GVL_I", "\tinst : FB_I;\n")], "Main.pou")
    expect([pou, diagnostics.map((d) => d.code)]).toEqual([undefined, ["attr-init-unreached"]])
  })

  test("a PROPERTY of a GVL instance is written and read through its list", () => {
    const p = runner("PROGRAM Main\nVAR\n\tseen : INT;\nEND_VAR\nGVL_R.fp.Level := 21;\nseen := GVL_R.fp.Level;\nEND_PROGRAM\n", [PROP, gvl("GVL_R", "\tfp : FB_P;\n", true)])
    p.scan()
    expect([p.get("seen"), p.get("GVL_R.fp.store")]).toEqual([42n, 42n])
  })

  // the one limit, the Rust backend's: a call on a GVL instance runs with that variable moved out of `Globals`
  test("a run that could reach the GVL instance it runs on is refused by name: its own body, a runtime index, an interface", () => {
    const codes = (files: File[], body: string, vars = "\ti : INT := 1;\n") =>
      lowerSource(`PROGRAM Main\nVAR\n${vars}END_VAR\n${body}\nEND_PROGRAM\n`, "Main", files, "Main.pou").diagnostics.map((d) => [d.code, d.message])
    const self = { uri: "FB_S.pou", source: "FUNCTION_BLOCK FB_S\nVAR\n\tk : INT;\nEND_VAR\nGVL_R.own.k := GVL_R.own.k + 1;\nEND_FUNCTION_BLOCK\n" }
    expect(codes([self, gvl("GVL_R", "\town : FB_S;\n", true)], "GVL_R.own();")).toEqual([
      ["call-global-reentrant", "FB_S's body runs on GVL_R.own, moved out of the globals while it runs, and reaches it while it runs"],
    ])
    expect(codes([FB, gvl("GVL_R", "\tarr : ARRAY[1..2] OF FB_Count;\n", true)], "GVL_R.arr[i]();")).toEqual([
      ["call-global-reentrant", "FB_Count's body runs on GVL_R.arr, moved out of the globals while it runs, and is reached through a runtime index"],
    ])
    const itf = { uri: "I_Do.pou", source: "INTERFACE I_Do\nMETHOD Go : INT\nEND_METHOD\nEND_INTERFACE\n" }
    const doer = { uri: "FB_Do.pou", source: "FUNCTION_BLOCK FB_Do IMPLEMENTS I_Do\nEND_FUNCTION_BLOCK\nMETHOD Go : INT\nGo := 1;\nEND_METHOD\n" }
    const caller = { uri: "FB_Call.pou", source: "FUNCTION_BLOCK FB_Call\nVAR\n\td : FB_Do;\n\tx : I_Do;\n\tn : INT;\nEND_VAR\nx := d;\nn := x.Go();\nEND_FUNCTION_BLOCK\n" }
    expect(codes([itf, doer, caller, gvl("GVL_R", "\tc : FB_Call;\n", true)], "GVL_R.c();")).toEqual([
      ["call-global-reentrant", "FB_Call's body runs on GVL_R.c, moved out of the globals while it runs, and calls through an interface, which may reach it while it runs"],
    ])
  })
})

/** A program and what to do with it: per step, writes (a path, the interpreter's value, its Rust literal), a clock in
 *  milliseconds, one scan, and the paths read after it. */
type Step = { writes?: [string, Val, string][]; ms?: number; reads: string[] }
type Val = Parameters<Runner["set"]>[1]

/** The program's emitted Rust run step by step, each read printed — and the same steps on the interpreter. */
async function bothBackends(main: string, files: readonly File[], steps: readonly Step[]): Promise<[string[], string[]]> {
  const { pou } = lowerSource(main, "Main", files, "Main.pou")
  const emitted = emitRust(pou!)
  const args = [...(emitted.usesGlobals ? ["&mut g"] : []), ...(emitted.usesPrograms ? ["&mut prg"] : []), ...(emitted.usesImage ? ["&mut mem"] : [])].join(", ")
  const at = (path: string) => rustAccess(pou!, path)
  const lines = steps.flatMap((s) => [
    ...(s.writes ?? []).map(([path, , literal]) => `    ${at(path).write(literal)}`),
    ...(s.ms === undefined ? [] : [`    ${at(CLOCK).write(`${BigInt(s.ms) * 1_000_000n}`)}`]),
    `    p.scan(${args});`,
    ...s.reads.map((r) => `    println!("{}", ${at(r).read});`),
  ])
  const setup = [
    ...(emitted.usesGlobals ? ["    let mut g = Globals::new();"] : []),
    ...(emitted.usesPrograms ? ["    let mut prg = Programs::new();"] : []),
    ...(emitted.usesImage ? ["    let mut mem = Mem::new();"] : []),
  ]
  const program = `${emitted.code}\nfn main() {\n    let mut p = Main::new();\n${[...setup, ...lines].join("\n")}\n}\n`
  const dir = await mkdtemp(join(tmpdir(), "volt-gvl-"))
  try {
    const file = join(dir, "gvl.rs")
    const exe = join(dir, `gvl${process.platform === "win32" ? ".exe" : ""}`)
    const build = await buildRust([RUSTC!, "--edition", "2021", "-A", "warnings", "-o", exe, file], file, exe, program)
    if (build.stderr !== "") throw new Error(build.stderr)
    const rust = Bun.spawnSync([exe], { stdout: "pipe" }).stdout.toString().trim().split(/\r?\n/)
    const p = run(pou!)
    const interp = steps.flatMap((s) => {
      for (const [path, value] of s.writes ?? []) p.set(path, value)
      if (s.ms !== undefined) p.set(CLOCK, BigInt(s.ms) * 1_000_000n)
      p.scan()
      return s.reads.map((r) => String(p.get(r)))
    })
    return [rust, interp]
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe.skipIf(skipRustSuite())("the emitted Rust holds and calls every global as the interpreter does", () => {
  test("the TON in a qualified_only GVL, called moved out of Globals", async () => {
    const [rust, interp] = await bothBackends(tonMain("GVL_A.t", "GVL_A.t"), [...PROJECT_LOWERING, gvl("GVL_A", "\tt : TON;\n", true)], [
      { ms: 0, reads: ["q", "GVL_A.t.ET"] },
      { ms: 999, reads: ["q", "GVL_A.t.ET"] },
      { ms: 1000, reads: ["q", "GVL_A.t.ET"] },
    ])
    expect(rust).toEqual(interp)
    expect(interp).toEqual(["false", "0", "false", "999", "true", "1000"])
  })

  test("FB instances bare and qualified, from another FB's body, a METHOD, a PROPERTY; unreferenced globals of every kind", async () => {
    const user = { uri: "FB_User.pou", source: "FUNCTION_BLOCK FB_User\nGVL_Q.c(step := 3);\nEND_FUNCTION_BLOCK\n" }
    const main =
      "PROGRAM Main\nVAR\n\tu : FB_User;\n\tseen : INT;\n\tlevel : INT;\nEND_VAR\nu();\nplain(step := 2);\nGVL_R.fp.Level := plain.n;\nlevel := GVL_R.fp.Level;\nseen := two + GVL_One.g;\nEND_PROGRAM\n"
    const files = [FB, PROP, STRUCT, user, gvl("GVL_Q", "\tc : FB_Count;\n", true), gvl("GVL_P", "\tplain : FB_Count;\n\ttwo : INT := 2;\n"), gvl("GVL_R", "\tfp : FB_P;\n", true)]
    const lists = [gvl("GVL_E", ELEMENTARY_DECLS, true), gvl("GVL_One", "\tg : INT := 3;\n\tpair : ST_Pair;\n"), gvl("GVL_Two", "\tg : INT := 5;\n\tarr : ARRAY[1..3] OF INT := [7, 8];\n")]
    const [rust, interp] = await bothBackends(main, [...files, ...lists], [
      { reads: ["GVL_Q.c.n", "plain.n", "level", "GVL_R.fp.store", "seen", "GVL_Two.g", "GVL_Two.arr[2]", "GVL_One.pair.a", "GVL_E.v1", "GVL_E.v8"] },
      { writes: [["GVL_Q.c.n", 100n, "100"], ["GVL_Two.g", -4n, "-4"], ["GVL_E.v1", 9n, "9"]], reads: ["GVL_Q.c.n", "plain.n", "GVL_Two.g", "GVL_E.v1"] },
    ])
    expect(rust).toEqual(interp)
    expect(interp).toEqual(["3", "2", "4", "4", "5", "5", "8", "4", "-5", "5", "103", "4", "-4", "9"])
  })
})
