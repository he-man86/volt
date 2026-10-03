/**
 * pointer-conversion (C0033) — a pointer implicitly assigned to an elementary target that cannot hold it. Whether one can
 * is the TARGET's pointer width, one rule on both vendors (frontend-conformance 4.1.1, `ty_pointer_size_twincat`):
 *
 *   64-bit (CODESYS Control Win V3 x64, recorded 2026-10-03)   WORD, DWORD, UDINT refused; LWORD, ULINT, __XWORD silent
 *   32-bit (TwinCAT Project14 on TwinCAT CE7 (ARMV7), 2026-10-03, and the 2026-07-21 live check)   WORD refused; DWORD,
 *          UDINT, LWORD, ULINT silent
 *
 * On an UNKNOWN target a 32-bit unsigned integer is undecidable, and the check is silent there.
 */
import { test, expect } from "bun:test"
import { parseSource, type Target } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"

const pc = (body: string, target: Target | undefined, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM P\nVAR\n ptr:POINTER TO INT; w:WORD; dw:DWORD; ud:UDINT; lw:LWORD; ul:ULINT; xw:__XWORD; i:INT; li:LINT; p2:POINTER TO INT;\nEND_VAR\n${body}\nEND_PROGRAM`
  const pr = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], vendor, target === undefined ? undefined : { target })
  return computeSemanticDiagnostics({ parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "pointer-not-convertible")
    .map((d) => `${d.severity}: ${d.message}`)
}

const ALL = "w := ptr; dw := ptr; ud := ptr; lw := ptr; ul := ptr; xw := ptr;"
const refused = (...types: string[]) => types.map((t) => `warning: Cannot convert type 'POINTER TO INT' to type '${t}'`)

test("a 64-bit target: a pointer fits LWORD, ULINT and __XWORD; WORD, DWORD and UDINT are refused — both vendors", () => {
  for (const vendor of ["codesys", "twincat"] as const) expect(pc(ALL, { pointerBits: 64 }, vendor)).toEqual(refused("WORD", "DWORD", "UDINT"))
})

test("a 32-bit target: a pointer fits every unsigned integer of 32 bits or more; WORD is refused — both vendors", () => {
  for (const vendor of ["codesys", "twincat"] as const) expect(pc(ALL, { pointerBits: 32 }, vendor)).toEqual(refused("WORD"))
})

test("an unknown target: a 32-bit integer is undecidable and silent; narrower is refused, 64-bit fits", () => {
  // `xw` is a platform integer, which has no width on an unknown target — its type is unknown, so nothing is said
  expect(pc(ALL, undefined)).toEqual(refused("WORD"))
})

test("a signed integer is refused, whatever its width (as before 4.1.1 — only the unsigned widths are recorded)", () => {
  expect(pc("i := ptr; li := ptr;", { pointerBits: 64 })).toEqual(refused("INT", "LINT"))
})

test("pointer → pointer stays quiet", () => {
  expect(pc(`p2 := ptr;`, { pointerBits: 64 })).toEqual([])
})
