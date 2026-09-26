/**
 * STRINGUTILS AS THE LIBRARY REPO WRITES IT — `libraries/StringUtils/<version>`: the STR* functions over a
 * `CHARBUFFERPTR` (`POINTER TO BYTE`), a `POINTER TO WORD` or a `POINTER TO STRING`, and the helpers they call.
 *
 * Every one of them walks a string through a pointer — `StrLenA(ADR(s))` — which is the STRING CURSOR the transpiler
 * binds for it (`Lowering.cursors`): the caller's string, by its own type, and the pointer's byte offset.
 *
 * Lowered against pro2193's own materialization (StringUtils 3.5.18.0), as a project that references the library
 * lowers it. The library ships compiled, with no source to follow, so every answer the contract leaves open was ASKED
 * of CODESYS (`fixtures/libraries/library-bodies.ts`) — a compare answers its sign, StrCpyA counts the terminator, a pad
 * fills to the size it is given — and this pins the same answers offline.
 */
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { emitRust, lowerSource, run, rustAccess, type IrPou } from "../../src/transpile/index.js"
import { withImplementations } from "../../libraries/index.js"
import { RUSTC as rustc, skipRustSuite } from "../conformance/support/rustc.js"

const MANAGER = join(import.meta.dir, "..", "..", "test-corpus", "pro2193", "Device", "Plc Logic", "Application", "09 Misc", "Library Manager")
const materialized = ["StringUtils"].flatMap((lib) =>
  readdirSync(join(MANAGER, lib)).map((f) => ({ uri: join(MANAGER, lib, f), source: readFileSync(join(MANAGER, lib, f), "utf8") })),
)

/** Each case: a result variable, its type, and the statements that compute it. The strings are declared once. */
const CASES: readonly [name: string, type: string, body: string, expected: unknown][] = [
  ["lenFive", "DINT", "lenFive := StrLenA(ADR(hello));", 5n],
  ["lenEmpty", "DINT", "lenEmpty := StrLenA(ADR(empty));", 0n],
  ["isEmpty", "BOOL", "isEmpty := StrIsNullOrEmptyA(ADR(empty));", true],
  ["isNotEmpty", "BOOL", "isNotEmpty := StrIsNullOrEmptyA(ADR(hello));", false],
  ["concatOk", "BOOL", "concatOk := StrConcatA(ADR(tail), ADR(joined), 80);", true],
  ["joined", "STRING(80)", "", "foobar"],
  ["concatTooSmall", "BOOL", "concatTooSmall := StrConcatA(ADR(tail), ADR(tight), 6);", false],
  ["tight", "STRING(80)", "", "foo"],
  ["copied", "DINT", "copied := StrCpyA(ADR(buffer), 4, ADR(hello));", 4n],
  ["buffer", "STRING(10)", "", "hel"],
  ["cmpEqual", "INT", "cmpEqual := StrCmpA(ADR(hello), ADR(hello2));", 0n],
  ["cmpLess", "INT", "cmpLess := StrCmpA(ADR(abc), ADR(abd));", -1n],
  ["cmpPrefix", "INT", "cmpPrefix := StrCmpA(ADR(abc), ADR(ab));", 1n],
  ["caseEqual", "INT", "caseEqual := StrCaseCmpA(ADR(abc), ADR(upperAbc));", 0n],
  ["starts", "INT", "starts := StrCmpStartA(ADR(hello), ADR(hel));", 0n],
  ["notStarts", "INT", "notStarts := StrCmpStartA(ADR(hello), ADR(abc));", -1n],
  ["ends", "INT", "ends := StrCmpEndA(ADR(hello), ADR(llo));", 0n],
  ["caseEnds", "INT", "caseEnds := StrCaseCmpEndA(ADR(hello), ADR(upperLlo));", 0n],
  ["padOk", "BOOL", "padOk := StrPadLeftA(16#2A, ADR(abc), ADR(padded), 6);", true],
  ["padded", "STRING(10)", "", "***abc"],
  ["padRightOk", "BOOL", "padRightOk := StrPadRightA(16#2E, ADR(abc), ADR(paddedRight), 6);", true],
  ["paddedRight", "STRING(10)", "", "abc..."],
  ["found", "INT", "found := StrFindA(ADR(hello), ADR(llo), 1);", 3n],
  ["foundLater", "INT", "foundLater := StrFindA(ADR(twice), ADR(ab), 2);", 3n],
  ["notFound", "INT", "notFound := StrFindA(ADR(hello), ADR(abc), 1);", 0n],
  ["caseFound", "INT", "caseFound := StrCaseFindA(ADR(hello), ADR(upperLlo), 1);", 3n],
  ["wideFound", "INT", "wideFound := StrFindW(ADR(wide), ADR(wideLo), 1);", 4n],
  ["wideCmp", "INT", "wideCmp := StrCmpW(ADR(wide), ADR(wide2));", 0n],
  // through the library's NAMESPACE (`Stu`, from its manifest) — as a value, and as a call statement
  ["nsLen", "DINT", "nsLen := Stu.StrLenA(ADR(hello));", 5n],
  ["nsCopy", "STRING(10)", "Stu.StrCpyA(ADR(nsCopy), 4, ADR(abc));", "abc"],
  ["upper", "BYTE", "upper := CharToUpper(16#61);", 0x41n],
  ["space", "BOOL", "space := IsSpaceCharacter(16#09);", true],
]

const STRINGS =
  "hello : STRING := 'hello'; hello2 : STRING(20) := 'hello'; empty : STRING; tail : STRING := 'bar'; " +
  "joined : STRING(80) := 'foo'; tight : STRING(80) := 'foo'; buffer : STRING(10) := 'xxxxxxx'; abc : STRING := 'abc'; " +
  "abd : STRING := 'abd'; ab : STRING := 'ab'; upperAbc : STRING := 'ABC'; hel : STRING := 'hel'; llo : STRING := 'llo'; " +
  "upperLlo : STRING := 'LLO'; padded : STRING(10); paddedRight : STRING(10); twice : STRING := 'ababab'; " +
  "wide : WSTRING := \"hello\"; wide2 : WSTRING(30) := \"hello\"; wideLo : WSTRING := \"lo\";"

const results = CASES.filter(([, , body]) => body !== "").map(([name, type]) => `${name} : ${type};`).join(" ")
const PROGRAM = `PROGRAM P\nVAR ${STRINGS} ${results} END_VAR\n${CASES.map(([, , body]) => body).join("\n")}\nEND_PROGRAM\n`

function lowered(): IrPou {
  const { pou, diagnostics } = lowerSource(PROGRAM, "P", withImplementations(materialized))
  if (pou === undefined) throw new Error(diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"))
  return pou
}

describe("StringUtils", () => {
  test("every STR* function walks the caller's own strings, and answers as its contract reads", () => {
    const p = run(lowered())
    p.scan()
    expect(Object.fromEntries(CASES.map(([name]) => [name, p.get(name) as unknown]))).toEqual(Object.fromEntries(CASES.map(([name, , , v]) => [name, v])))
  })

  test("the materialization alone is refused, not run as an empty body", () => {
    const { diagnostics } = lowerSource("PROGRAM P\nVAR s : STRING; n : DINT; END_VAR\nn := StrLenA(ADR(s));\nEND_PROGRAM\n", "P", materialized)
    expect(diagnostics.map((d) => d.code)).toEqual(["call-library"])
  })

  test.skipIf(skipRustSuite())("the emitted Rust answers every case as the interpreter does", async () => {
    const pou = lowered()
    const prints = CASES.map(([name]) => {
      const { expr, type } = rustAccess(pou, name)
      const text = type.kind === "elementary" && type.elem.family === "string"
      return `    println!("{}", ${text ? `String::from_utf8_lossy(p.${expr}.units())` : `p.${expr}`});`
    })
    const program = [emitRust(pou).code, "fn main() {", "    let mut p = P::new();", "    p.scan();", ...prints, "}", ""].join("\n")
    const dir = await mkdtemp(join(tmpdir(), "volt-stu-"))
    try {
      const file = join(dir, "stu.rs")
      const exe = join(dir, `stu${process.platform === "win32" ? ".exe" : ""}`)
      await Bun.write(file, program)
      const build = Bun.spawnSync([rustc!, "--edition", "2021", "-A", "warnings", "-o", exe, file], { stderr: "pipe" })
      expect(build.stderr.toString()).toBe("")
      const got = Bun.spawnSync([exe], { stdout: "pipe" }).stdout.toString().trim().split(/\r?\n/)
      const p = run(pou)
      p.scan()
      expect(got).toEqual(CASES.map(([name]) => String(p.get(name))))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
