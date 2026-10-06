/**
 * pointer-conversion — a pointer implicitly stored into an elementary target that cannot hold it: an ERROR, "Cannot convert
 * type 'POINTER TO INT' to type '<T>'", at the default settings of both recording projects (analysis-conformance 3.1: it
 * was modelled as the configurable warning C0033, whose own wording "is possibly not convertible" no recording shows, and
 * both projects' settings raise nothing — `ptrsc_*`). Whether one can is the TARGET's pointer width, one rule on both
 * vendors (frontend-conformance 4.1.1, `ty_pointer_size_twincat`):
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
import { uriFor } from "../../test-uri.js"

const pc = (body: string, target: Target | undefined, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const src = `PROGRAM P\nVAR\n ptr:POINTER TO INT; w:WORD; dw:DWORD; ud:UDINT; lw:LWORD; ul:ULINT; xw:__XWORD; i:INT; di:DINT; li:LINT; p2:POINTER TO INT; rr:REAL; lrr:LREAL; o:BOOL; t:TIME; ss:STRING;\nEND_VAR\n${body}\nEND_PROGRAM`
  const pr = parseSource(src, { networkText: true }, vendor)
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], vendor, target === undefined ? undefined : { target })
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "assignment-type-mismatch" && d.message.includes("POINTER"))
    .map((d) => `${d.severity}: ${d.message}`)
}

const ALL = "w := ptr; dw := ptr; ud := ptr; lw := ptr; ul := ptr; xw := ptr;"
const refused = (...types: string[]) => types.map((t) => `error: Cannot convert type 'POINTER TO INT' to type '${t}'`)

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

test("a signed integer below the pointer's width is refused; at it, a change of sign (ptrsc_into_sint, ptrsc_into_dint, ptrsc_into_lint)", () => {
  expect(pc("i := ptr; li := ptr;", { pointerBits: 64 })).toEqual(refused("INT"))
  expect(all64("li := ptr;")).toEqual(["warning: Implicit conversion from unsigned Type 'POINTER TO INT' to signed Type 'LINT' : Possible change of sign"])
  // on a 32-bit target a signed integer at the pointer's width is unmeasured, and silent
  expect(pc("i := ptr; di := ptr;", { pointerBits: 32 })).toEqual(refused("INT"))
})

test("a REAL or an LREAL is silent on CODESYS and refused on TwinCAT; a BOOL, a TIME and a STRING refused on both (ptrsc_into_real, ptrsc_into_real32, ptrsc_into_bool, ptrsc_into_time)", () => {
  expect(pc("rr := ptr; lrr := ptr;", { pointerBits: 64 }, "codesys")).toEqual([])
  expect(pc("rr := ptr; lrr := ptr;", { pointerBits: 64 }, "twincat")).toEqual(refused("REAL", "LREAL"))
  for (const vendor of ["codesys", "twincat"] as const)
    expect(pc("o := ptr; t := ptr; ss := ptr;", { pointerBits: 64 }, vendor)).toEqual(refused("BOOL", "TIME", "STRING"))
})

test("every other elementary type is refused — DATE, DT, TOD, LTIME, WSTRING — and __XINT changes sign as LINT (ptrsc_into_date/_dt/_tod/_ltime/_wstring/_xint, both vendors)", () => {
  const src = (vendor: "codesys" | "twincat") => {
    const text = `PROGRAM P\nVAR\n ptr : POINTER TO INT; d : DATE; dtv : DT; todv : TOD; ltv : LTIME; ws : WSTRING; xi : __XINT;\nEND_VAR\nd := ptr; dtv := ptr; todv := ptr; ltv := ptr; ws := ptr; xi := ptr;\nEND_PROGRAM`
    const pr = parseSource(text, { networkText: true }, vendor)
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: text }], [], vendor, { target: { pointerBits: 64 } })
    return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: text, project, config: resolveConfig({ vendor }) })
      .filter((d) => d.message.includes("POINTER"))
      .map((d) => `${d.severity}: ${d.message}`)
  }
  for (const vendor of ["codesys", "twincat"] as const)
    expect(src(vendor)).toEqual([
      ...refused("DATE", "DATE_AND_TIME", "TIME_OF_DAY", "LTIME", "WSTRING"),
      `warning: Implicit conversion from unsigned Type 'POINTER TO INT' to signed Type 'LINT' : ${vendor === "codesys" ? "Possible" : "possible"} change of sign`,
    ])
})

test("a REFERENCE declared with a pointer as its initial value is refused, named as the reference (ptrsc_reference_initializer, both vendors)", () => {
  const src = `PROGRAM P\nVAR\n held : INT; p : POINTER TO INT; rf : REFERENCE TO INT := p;\nEND_VAR\nEND_PROGRAM`
  for (const vendor of ["codesys", "twincat"] as const) {
    const pr = parseSource(src, { networkText: true }, vendor)
    const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], vendor, { target: { pointerBits: 64 } })
    expect(
      computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor }) })
        .filter((d) => d.message.includes("POINTER"))
        .map((d) => `${d.severity}: ${d.message}`),
    ).toEqual(refused("REFERENCE TO INT"))
  }
})

test("a declaration's initial value is a store too: `dw : DWORD := ADR(x)` is refused (ptrsc_initializer_into_dword)", () => {
  const src = `PROGRAM P
VAR
 x : INT; dw : DWORD := ADR(x); lw : LWORD := ADR(x);
END_VAR
END_PROGRAM`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], "codesys", { target: { pointerBits: 64 } })
  expect(
    computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "assignment-type-mismatch" && d.message.includes("POINTER"))
      .map((d) => `${d.severity}: ${d.message}`),
  ).toEqual(refused("DWORD"))
})

test("pointer → pointer stays quiet", () => {
  expect(pc(`p2 := ptr;`, { pointerBits: 64 })).toEqual([])
})

/** Every error and warning for `body` on a 64-bit target. */
const all64 = (body: string): string[] => {
  const src = `PROGRAM P\nVAR\n ptr:POINTER TO INT; q:POINTER TO INT; w:WORD; dw:DWORD; ud:UDINT; lw:LWORD; ul:ULINT; i:INT; di:DINT; li:LINT; b:BYTE; rf : REFERENCE TO INT; o : BOOL; x : REAL;\nEND_VAR\n${body}\nEND_PROGRAM`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F", parseResult: pr, source: src }], [], "codesys", { target: { pointerBits: 64 } as Target })
  return computeSemanticDiagnostics({ uri: uriFor(pr), parseResult: pr, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => (d.severity === "error" || d.severity === "warning") && d.code !== "signature-name-mismatch")
    .map((d) => `${d.severity}: ${d.message}`)
}

test("an integer INTO a pointer on a 64-bit target: 32 bits refused, a signed one a change of sign, the rest silent (cv_integers_into_pointer, CV6)", () => {
  expect(all64("ptr := dw;\nptr := ud;\nptr := di;")).toEqual([
    "error: Cannot convert type 'DWORD' to type 'POINTER TO INT'",
    "error: Cannot convert type 'UDINT' to type 'POINTER TO INT'",
    "error: Cannot convert type 'DINT' to type 'POINTER TO INT'",
  ])
  expect(all64("ptr := i;\nptr := li;")).toEqual([
    "warning: Implicit conversion from signed Type 'INT' to unsigned Type 'POINTER TO INT' : Possible change of sign",
    "warning: Implicit conversion from signed Type 'LINT' to unsigned Type 'POINTER TO INT' : Possible change of sign",
  ])
  expect(all64("ptr := w;\nptr := lw;\nptr := ul;\nptr := b;")).toEqual([])
})

test("a reference into a pointer converts as its target, named as the reference; a pointer written through a reference is refused (cv_reference_to_pointer, cv_pointer_assigned_to_reference)", () => {
  expect(all64("ptr := rf;")).toEqual(["warning: Implicit conversion from signed Type 'REFERENCE TO INT' to unsigned Type 'POINTER TO INT' : Possible change of sign"])
  expect(all64("rf := ptr;")).toEqual(["error: Cannot convert type 'POINTER TO INT' to type 'REFERENCE TO INT'"])
})

test("a pointer compared with a DWORD it does not fit is refused, with an LWORD silent; a pointer minus a REAL is refused (cb_compare_pointers, dt_pointer_arithmetic_refused)", () => {
  expect(all64("o := ptr = dw;\no := ptr = lw;\no := ul = ptr;")).toEqual(["error: Cannot compare type 'POINTER TO INT' with type 'DWORD'"])
  expect(all64("q := ptr - x;")).toEqual(["error: Cannot convert type 'REAL' to type 'POINTER TO INT'"])
})

test("an untyped LITERAL into a pointer is unjudged: only variables were recorded (cv_integers_into_pointer, cv_xword_into_pointer)", () => {
  expect(all64("ptr := 16#FFFF_FFFF;\nptr := 16#1_0000_0000;\nptr := 5;\nptr := -1;\nptr := 0;")).toEqual([])
})
