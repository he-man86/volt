import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { emitRust } from "./index.js"
import { globalsArgs, globalsParams, snake, TEMP_PURPOSES, tmp } from "./names.js"
import { lowerSource } from "../../lower/index.js"
import { rust } from "../../../../test/support/transpile.js"

describe("emit/rust", () => {
  test("field names are Rust: a keyword gets `_`, and two names that snake_case alike are REFUSED", () => {
    // `pub loop: i16` and two `a_b` fields were emitted, and neither compiles (transpiler review 2026-09-14)
    const keywords = rust("PROGRAM P\nVAR\n  loop : INT;\n  match : BOOL;\nEND_VAR\nloop := 1;\nEND_PROGRAM\n")
    expect(keywords).toContain("pub loop_: i16,")
    expect(keywords).toContain("pub match_: bool,")
    expect(keywords).toContain("self.loop_ = 1i16;")

    // THE PREMISE IS UNCHANGED — two ST names that snake alike must never become one broken field. What changed is
    // the RESOLUTION. They used to become `a_b` and `a_b_2`, numbered by FRAME POSITION, which made the emitted
    // surface unstable: the first slot with a given snake name keeps it, so declaring a new VAR ahead of an existing
    // one would rename the EXISTING one's field and break a harness that reads `p.a_b` over an unrelated ST edit. A
    // field IS part of the emitted surface (`emit/rust/index.ts` states it), so it may not move under a user.
    //
    // Refused rather than renumbered because the collision does not happen: ZERO of the 784 POUs the fixtures build
    // take a suffix, so this costs nothing real, while the rename it prevents would hit ordinary code. A routine's
    // LOCALS are still renumbered — they are `let` bindings inside a generated fn that nothing outside reads.
    expect(() => rust("PROGRAM P\nVAR\n  aB : INT;\n  a_b : INT;\nEND_VAR\naB := 1;\na_b := 2;\nEND_PROGRAM\n")).toThrow(
      /both become the Rust field/,
    )
  })

  test("a hidden slot keeps its double underscore, so no variable a user declares can take its field", () => {
    // `__clock` snaked to `_clock`, and a GVL `_clock` beside TIME() threw "both become the Rust field" (review 2026-09-26)
    const gvl = { uri: "GVL.gvl", source: "VAR_GLOBAL\n\t_clock : INT;\nEND_VAR\n" }
    const { pou, diagnostics } = lowerSource("PROGRAM P\nVAR t : TIME; END_VAR\nt := TIME();\n_clock := 1;\nEND_PROGRAM\n", "P", [gvl])
    expect(diagnostics).toEqual([])
    const code = emitRust(pou!).code
    expect(code).toContain("pub __clock: u64,")
    expect(code).toContain("pub _clock: i16,")
    expect(snake("__str_P")).toBe("__str_p")
  })

  test("ST names become snake_case fields", () => {
    expect(["iCount", "MaxCount", "PLC_Ready", "x"].map(snake)).toEqual(["i_count", "max_count", "plc_ready", "x"])
  })
})

/**
 * A GENERATED BINDING MUST NOT BE NAMEABLE IN ST — a routine's parameters and VAR_TEMPs are Rust LOCALS, in the
 * same scope as whatever the emitter expands inline.
 *
 * The MOD expansion bound `a` and `d`. In `FUNCTION F : INT VAR_INPUT a : INT; b : INT; END_VAR F := b MOD a;`
 * the emitted `let a = b` SHADOWED the parameter, so the next line — `let d = a` — read the LEFT operand where
 * the right was meant, and `7 MOD 3` compiled to `7 % 7` = **0** while the interpreter answered 1. A silent
 * wrong answer, in the backend that is the actual deliverable.
 *
 * No recorded case caught it because no fixture happens to name a parameter `a`, and no *compile* check could:
 * the wrong program is perfectly valid Rust. So the test is on the emitted TEXT, and it is about the rule
 * rather than the instance — every binding the emitter invents carries `__`, which CODESYS reserves.
 */
describe("emit/rust — generated bindings cannot collide with an ST name", () => {
  const MOD_IN_FUNCTION =
    "FUNCTION F_mod : INT\nVAR_INPUT\n\ta : INT;\n\tb : INT;\nEND_VAR\nF_mod := b MOD a;\nEND_FUNCTION\n\n" +
    "PROGRAM PLC_PRG\nVAR\n\trv : INT;\nEND_VAR\nrv := F_mod(a := 3, b := 7);\nEND_PROGRAM\n"

  test("MOD does not shadow a parameter named like its own temporaries", () => {
    const line = rust(MOD_IN_FUNCTION)
      .split("\n")
      .find((l) => l.includes("__mod_l"))!
    expect(line).toBeDefined()
    // the right operand must still read the PARAMETER `a`, not a binding introduced one statement earlier
    expect(line).not.toMatch(/let a = /)
    expect(line).not.toMatch(/let d = /)
    expect(line).toContain("__mod_l")
    expect(line).toContain("__mod_r")
  })

  test("a bit assignment does not shadow locals named v or w", () => {
    const line = rust("PROGRAM P\nVAR\n\tv : BOOL := TRUE;\n\tw : WORD;\nEND_VAR\nw.2 := v;\nEND_PROGRAM\n")
      .split("\n")
      .find((l) => l.includes("__bit_"))!
    expect(line).toBeDefined()
    expect(line).not.toMatch(/let v = /)
    expect(line).not.toMatch(/let w = /)
  })

  test("no `let` in a routine shadows one of that routine's parameters", () => {
    // THE PRECISE RULE, and the first attempt at it was wrong in a way worth recording: "every `let` carries
    // `__`" is too strong, because the emitter legitimately binds a FUNCTION's return variable and its VAR_TEMPs
    // under their own ST names — those bindings ARE the ST variable, which is the point of them. What must never
    // happen is a binding that hides a PARAMETER, because a parameter is the one local the body did not declare
    // and cannot see being taken away.
    const src =
      "FUNCTION F_all : INT\nVAR_INPUT\n\ta : INT;\n\tb : INT;\n\tv : BOOL;\nEND_VAR\nVAR\n\tw : WORD;\nEND_VAR\n" +
      "w.1 := v;\nF_all := b MOD a;\nEND_FUNCTION\n\nPROGRAM PLC_PRG\nVAR\n\trv : INT;\nEND_VAR\n" +
      "rv := F_all(a := 3, b := 7, v := TRUE);\nEND_PROGRAM\n"

    const shadowed: string[] = []
    for (const fn of rust(src).split(/(?=pub fn )/)) {
      const signature = /pub fn [a-z_0-9]+\(([^)]*)\)/.exec(fn)
      if (signature === null) continue
      const params = signature[1]!
        .split(",")
        .map((p) => /(?:mut )?([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(p.trim())?.[1])
        .filter((n): n is string => n !== undefined)
      for (const m of fn.matchAll(/\blet (?:mut )?([A-Za-z_][A-Za-z0-9_]*)/g))
        if (params.includes(m[1]!)) shadowed.push(`${signature[0]} shadows ${m[1]!}`)
    }
    expect(shadowed).toEqual([])
  })
})

/**
 * TWO ROUTINES THAT SNAKE ALIKE GET DIFFERENT Rust NAMES.
 *
 * `snake` is not injective and ST member names need not differ by more than punctuation: a METHOD `DoIt` and a
 * METHOD `Do_It` in one FB are two distinct members that both snake to `do_it`, and the emitter printed TWO
 * `pub fn do_it` into one impl block — E0592 — with zero lowering diagnostics, on ST CODESYS compiles.
 *
 * It could not have been fixed where it lived: a per-routine name function sees one routine and cannot know what
 * else claimed the name. The names are computed once per POU, and the CALL SITES read the same map as the
 * definitions — a dedupe only one of the two knows about is a worse bug than the collision.
 */
describe("emit/rust — routine names are unique within an impl block", () => {
  test("DoIt and Do_It become do_it and do_it_2, and the calls follow", () => {
    const code = rust("FUNCTION_BLOCK FB_Names\nVAR\n\tn : INT;\nEND_VAR\nn := DoIt() + Do_It();\nEND_FUNCTION_BLOCK\n\nMETHOD DoIt : INT\nDoIt := 1;\nEND_METHOD\n\nMETHOD Do_It : INT\nDo_It := 2;\nEND_METHOD\n\nPROGRAM PLC_PRG\nVAR\n\tinst : FB_Names;\nEND_VAR\ninst();\nEND_PROGRAM\n")
    expect(code).toContain("pub fn do_it(&mut self)")
    expect(code).toContain("pub fn do_it_2(&mut self)")
    // the call site must agree with the definition, not re-derive the name
    expect(code).toContain("self.do_it()")
    expect(code).toContain("self.do_it_2()")
  })

  test("the same name in a DIFFERENT FB is not renamed — the scope is the impl block", () => {
    // PROGRAM FIRST: `rust()` lowers the first runnable unit, so with an FB first the second FB is never
    // reached and this would assert against a tree that has only one of them (the Composites case above notes
    // the same trap).
    const code = rust("PROGRAM PLC_PRG\nVAR\n\ta : FB_A;\n\tb : FB_B;\nEND_VAR\na();\nb();\nEND_PROGRAM\n\nFUNCTION_BLOCK FB_A\nVAR\n\tn : INT;\nEND_VAR\nn := DoIt();\nEND_FUNCTION_BLOCK\n\nMETHOD DoIt : INT\nDoIt := 1;\nEND_METHOD\n\nFUNCTION_BLOCK FB_B\nVAR\n\tm : INT;\nEND_VAR\nm := DoIt();\nEND_FUNCTION_BLOCK\n\nMETHOD DoIt : INT\nDoIt := 2;\nEND_METHOD\n")
    // one `do_it` per impl block, so neither gains a suffix
    expect([...code.matchAll(/pub fn do_it\b/g)]).toHaveLength(2)
    expect(code).not.toContain("do_it_2")
  })

  // transpile-review-2026-09-29 task 29 (fixtures tr_29_method_named_*): Rust's method lookup tries `T` then `&T`
  // before `&mut T`, so a trait method taking `self` or `&self` that is IN SCOPE on the struct — the derived Clone,
  // and the prelude's blanket ToOwned/Into/TryInto — wins over the user's `&mut self` METHOD of the
  // same name. `r := b.Clone()` was E0308; a result-less `b.Clone();` compiled and ran the derived clone instead.
  test("a METHOD named like a trait method the struct has is renamed, and the call follows", () => {
    for (const [method, fn] of [
      ["Clone", "clone_"],
      ["To_Owned", "to_owned_"],
      ["Into", "into_"],
      ["Try_Into", "try_into_"],
      ["Clone_Into", "clone_into_"],
    ] as const) {
      const code = rust(`PROGRAM PLC_PRG\nVAR\n\tb : FB_T;\n\trx : INT;\nEND_VAR\nrx := b.${method}();\nEND_PROGRAM\n\nFUNCTION_BLOCK FB_T\nVAR\n\tv : INT := 100;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD ${method} : INT\n${method} := v;\nEND_METHOD\n`)
      expect(code).toContain(`pub fn ${fn}(&mut self)`)
      expect(code).toContain(`self.b.${fn}()`)
    }
  })
})

test("a generated temporary is `__<purpose>`, numbered as `__<purpose>_<n>`", () => {
  expect([tmp("program"), tmp("mod_l"), tmp("arg", 0), tmp("guard", 3), tmp("lent", 1n)]).toEqual([
    "__program",
    "__mod_l",
    "__arg_0",
    "__guard_3",
    "__lent_1",
  ])
})

test("every printer temporary's purpose is a row of TEMP_PURPOSES, and every row is used (7.10.3)", () => {
  const dir = import.meta.dir
  const used = new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
      .flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/\btmp\("(\w+)"/g)].map((m) => m[1]!)),
  )
  expect([...used].sort()).toEqual(Object.keys(TEMP_PURPOSES).sort())
})

test("`g` and `prg` as arguments and as parameters — one list, in that order, as far as the program has them", () => {
  const cases = [
    { usesGlobals: false, usesPrograms: false },
    { usesGlobals: true, usesPrograms: false },
    { usesGlobals: false, usesPrograms: true },
    { usesGlobals: true, usesPrograms: true },
  ]
  expect(cases.map(globalsArgs)).toEqual([[], ["g"], ["prg"], ["g", "prg"]])
  expect(cases.map(globalsParams)).toEqual([[], ["g: &mut Globals"], ["prg: &mut Programs"], ["g: &mut Globals", "prg: &mut Programs"]])
})

test("a user FUNCTION named like a runtime helper gets a suffixed fn, and the helper keeps its name (7.1.5, was 6.A.7)", () => {
  const code = rust(
    "FUNCTION iec_fdivz : REAL\nVAR_INPUT a : REAL; b : REAL; END_VAR\niec_fdivz := a - b;\nEND_FUNCTION\n" +
      "PROGRAM P\nVAR x : REAL := 6.0; y : REAL := 2.0; q : REAL; r2 : REAL; END_VAR\nq := x / y;\nr2 := iec_fdivz(x, y);\nEND_PROGRAM\n",
  )
  // the runtime's zero-divisor check, once, and the user's FUNCTION beside it under its own name
  expect(code.match(/\bfn iec_fdivz\b/g)).toEqual(["fn iec_fdivz"])
  expect(code).toContain("fn iec_fdivz<T")
  expect(code).toContain("pub fn iec_fdivz_(")
  expect(code).toContain("iec_fdivz_(self.x, self.y)")
  expect(code).toContain("iec_fdivz(self.x, self.y)")
})

// 7.8.10: the reserved-prefix rule is STRUCTURAL — every binding the printer makes up is a `tmp()`, `__<purpose>`, and
// no generated binding takes an unprefixed name an ST variable could hold (the program move-out's `program`, an array
// initializer's `a` were). Every ST name below starts with `u`, so a binding that is neither one of them nor `__…` is
// the printer's own, unprefixed.
test("every binding the printer generates is `__`-prefixed", () => {
  const src =
    "TYPE uSt : STRUCT uA : INT; uB : INT; END_STRUCT END_TYPE\n" +
    "PROGRAM uPrgD\nVAR uN : INT; END_VAR\nuN := uN + 1;\nEND_PROGRAM\n" +
    "PROGRAM uPrgC\nVAR uRuns : INT; END_VAR\nuPrgD();\nuRuns := uRuns + 1;\nEND_PROGRAM\nMETHOD uBump : INT\nVAR_INPUT uAmount : INT; END_VAR\nuPrgD();\nuBump := uAmount;\nEND_METHOD\n" +
    "FUNCTION uF : INT\nVAR_INPUT uX : INT; uY : INT; uR : REAL; END_VAR\nVAR uArr : ARRAY[1..40] OF INT := [1, 2]; uS : uSt := (uA := 3); uW : WORD; END_VAR\n" +
    "uW.2 := uX > 0;\nuW := ROL(uW, uY);\nuF := uX MOD uY + uArr[1] + uS.uA + REAL_TO_INT(TRUNC(uR));\nEND_FUNCTION\n" +
    "PROGRAM P\nVAR uV : INT; uZ : INT; END_VAR\nuPrgC();\nuZ := uPrgC.uBump(uAmount := uV);\nuV := uF(uV, 3, 2.5);\nEND_PROGRAM\n"
  const { pou, diagnostics } = lowerSource(src, "P")
  expect(diagnostics).toEqual([])
  // the generated bodies only: a runtime helper (`iec_*`) is a fn of its own, whose locals no ST name reaches
  const code = emitRust(pou!).code.split(/(?=^\s*(?:pub )?fn )/m).filter((chunk) => !/^\s*(?:pub )?fn iec_/.test(chunk)).join("")
  const generated = [...code.matchAll(/\blet (?:mut )?([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]!).filter((n) => !/^_?u/.test(n))
  expect(generated.length).toBeGreaterThan(0)
  expect(generated.filter((n) => !n.startsWith("__"))).toEqual([])
})
