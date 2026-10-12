/** Assignability and conversion classification (from `types.test.ts`, transpile-restructure 1.1.11). */
import { expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { build, type Scope } from "../symbols/index.js"
import { classifyConversion, elementaryType, isAssignable, resolveNamedType, type Type, UNKNOWN } from "./index.js"

function proj(src: string): Scope {
  return build.buildSymbolTable([{ uri: "F.pou", parseResult: parseSource(src, { networkText: true }, "codesys"), source: src }], [], "codesys")
}

const E_PLAIN = "TYPE E :\n(\n\tOff := 0,\n\tOn := 1\n);\nEND_TYPE"

const E_BYTE = "TYPE EB :\n(\n\tOff := 0,\n\tOn := 1\n) BYTE;\nEND_TYPE"

test("isAssignable: widening, narrowing, isolation, enums", () => {
  const p = proj(`TYPE Color : (Red, Green); END_TYPE\nTYPE Mode : (A, B); END_TYPE`)
  const T = (n: string) => resolveNamedType(n, p, undefined)
  expect(isAssignable(T("INT"), T("SINT"))).toBe(true) // widening up the rank
  expect(isAssignable(T("INT"), T("DINT"))).toBe(false) // narrowing — not implicit
  expect(isAssignable(T("BOOL"), T("INT"))).toBe(false) // BOOL isolated
  expect(isAssignable(T("REAL"), T("LREAL"))).toBe(true) // both ways (narrowing is a warning, not error)
  expect(isAssignable(T("Color"), T("Color"))).toBe(true)
  // different enums: a WARNING, not a refusal — "Implicit conversion from one enumeration type (MODE) to another (COLOR)"
  // (`cv_enum_into_other_enum`, `unit_enum_extends_enum`, both vendors; this said "not assignable" from no recording)
  expect(classifyConversion(T("Color"), T("Mode"))).toBe("enum-change")
  expect(isAssignable(T("Color"), T("INT"))).toBe(true) // enum↔int allowed
  expect(isAssignable(T("Color"), T("STRING"))).toBe(false) // enum↔string rejected
  expect(isAssignable(T("INT"), UNKNOWN)).toBe(true) // unknown → skip
})

test("classifyConversion: identity / widen / narrow / sign-change / incompatible", () => {
  const p = proj("")
  const T = (n: string) => resolveNamedType(n, p, undefined)
  expect(classifyConversion(T("INT"), T("INT"))).toBe("identity")
  expect(classifyConversion(T("INT"), T("SINT"))).toBe("widen") // narrower rank → wider
  expect(classifyConversion(T("REAL"), T("INT"))).toBe("widen") // int → real is implicit
  expect(classifyConversion(T("REAL"), T("LREAL"))).toBe("narrow") // real narrowing warns
  expect(classifyConversion(T("INT"), T("WORD"))).toBe("sign-change") // 16-bit unsigned → signed
  expect(classifyConversion(T("UINT"), T("INT"))).toBe("sign-change") // 16-bit signed → unsigned
  // Oracle-calibrated (scripts/conversion-matrix.ts, live CODESYS): signed → WIDER unsigned still changes sign
  // (negatives don't fit), but a wider SIGNED target holds every unsigned value, so that one stays a safe widen.
  expect(classifyConversion(T("UINT"), T("SINT"))).toBe("sign-change") // signed → wider unsigned
  expect(classifyConversion(T("DINT"), T("USINT"))).toBe("widen") // unsigned → wider signed: fits
  // integer → real is safe until the integer needs more bits than the mantissa holds (REAL 24, LREAL 53).
  expect(classifyConversion(T("REAL"), T("DINT"))).toBe("narrow") // 32-bit int > 24-bit mantissa → loss
  expect(classifyConversion(T("LREAL"), T("DINT"))).toBe("widen") // 32-bit int fits the 53-bit mantissa
  expect(classifyConversion(T("LREAL"), T("LINT"))).toBe("narrow") // 64-bit int > 53-bit mantissa → loss
  expect(classifyConversion(T("INT"), T("DINT"))).toBe("incompatible") // integer narrowing → error
  expect(classifyConversion(T("INT"), T("REAL"))).toBe("incompatible") // real → int needs explicit
  expect(classifyConversion(T("BOOL"), T("INT"))).toBe("incompatible") // BOOL isolated
  expect(classifyConversion(T("INT"), UNKNOWN)).toBe("identity") // conservative skip
})

test("compat: an enum with a written base converts as that base, both ways (cv_enum_base_*_into_scalars, cv_scalars_into_enum_with_base)", () => {
  const enumOf = (src: string, name: string): Type => resolveNamedType(name, proj(src), undefined)
  const eb = enumOf(E_BYTE, "EB")
  expect(eb).toMatchObject({ kind: "enum", base: { name: "BYTE" } })
  const el = (n: string): Type => ({ kind: "elementary", name: n, elem: elementaryType(n)! }) as Type
  expect(classifyConversion(el("SINT"), eb)).toBe("sign-change")
  expect(classifyConversion(el("INT"), eb)).toBe("widen")
  expect(classifyConversion(eb, el("INT"))).toBe("incompatible")
  expect(classifyConversion(eb, el("USINT"))).toBe("widen")
  // …and a project enum WITHOUT one converts as INT INTO it too (cv_scalars_into_enum: DINT, REAL, BOOL refused; UINT taken)
  const e = enumOf(E_PLAIN, "E")
  expect(classifyConversion(e, el("DINT"))).toBe("incompatible")
  expect(classifyConversion(e, el("REAL"))).toBe("incompatible")
  expect(classifyConversion(e, el("BOOL"))).toBe("incompatible")
  expect(classifyConversion(e, el("SINT"))).toBe("widen")
})

test("compat: a value of another enum converts with a warning, not an error (cv_enum_into_other_enum, unit_enum_extends_enum)", () => {
  const src = `${E_PLAIN}\n${E_BYTE}`
  const p = proj(src)
  expect(classifyConversion(resolveNamedType("E", p, undefined), resolveNamedType("EB", p, undefined))).toBe("enum-change")
  expect(isAssignable(resolveNamedType("E", p, undefined), resolveNamedType("EB", p, undefined))).toBe(true)
})

test("compat: an integer into a pointer on a 64-bit target — 32 bits refused, signed a change of sign, the rest silent (cv_integers_into_pointer)", () => {
  const el = (n: string): Type => ({ kind: "elementary", name: n, elem: elementaryType(n)! }) as Type
  const ptr: Type = { kind: "pointer", target: el("INT") }
  const x64 = { pointerBits: 64 } as Parameters<typeof classifyConversion>[2]
  for (const t of ["DWORD", "UDINT", "DINT"]) expect(classifyConversion(ptr, el(t), x64)).toBe("incompatible")
  for (const t of ["INT", "LINT"]) expect(classifyConversion(ptr, el(t), x64)).toBe("sign-change")
  for (const t of ["BYTE", "WORD", "UINT", "LWORD", "ULINT"]) expect(["widen", "identity"]).toContain(classifyConversion(ptr, el(t), x64))
  expect(classifyConversion(ptr, el("REAL"), x64)).toBe("incompatible")
  expect(classifyConversion(ptr, el("DWORD"))).toBe("identity") // no target: unjudged
})

// …and on a 32-bit target the mirror: a 64-bit integer is refused, the rest converts as into a UDINT — TwinCAT CE7
// (`recordings/twincat-32.build.json` `cv_integers_into_pointer`, 2026-10-03, re-recorded on an XAE of its own; the first
// batch, made beside another session's XAE on the same project, recorded it clean)
test("compat: an integer into a pointer on a 32-bit target — 64 bits refused, signed a change of sign, the rest silent (cv_integers_into_pointer)", () => {
  const el = (n: string): Type => ({ kind: "elementary", name: n, elem: elementaryType(n)! }) as Type
  const ptr: Type = { kind: "pointer", target: el("INT") }
  const x32 = { pointerBits: 32 } as Parameters<typeof classifyConversion>[2]
  for (const t of ["LWORD", "ULINT", "LINT"]) expect(classifyConversion(ptr, el(t), x32)).toBe("incompatible")
  for (const t of ["INT", "DINT"]) expect(classifyConversion(ptr, el(t), x32)).toBe("sign-change")
  for (const t of ["BYTE", "WORD", "UINT", "DWORD", "UDINT"]) expect(["widen", "identity"]).toContain(classifyConversion(ptr, el(t), x32))
})

test("compat: a reference converts as its target on either side (dt_reference_into_narrower, cv_reference_to_other_reference)", () => {
  const el = (n: string): Type => ({ kind: "elementary", name: n, elem: elementaryType(n)! }) as Type
  const ri: Type = { kind: "reference", target: el("INT") }
  const rr: Type = { kind: "reference", target: el("REAL") }
  expect(classifyConversion(el("SINT"), ri)).toBe("incompatible")
  expect(classifyConversion(el("UINT"), ri)).toBe("sign-change")
  expect(classifyConversion(ri, rr)).toBe("incompatible")
  expect(classifyConversion(el("DINT"), ri)).toBe("widen")
})
