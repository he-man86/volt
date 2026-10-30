import { test, expect } from "bun:test"
import { pragmaHelp } from "./builtin-hover.js"
import { BUILTIN_OPERATOR_NAMES, BUILTIN_RESULT, builtinName, COMPILER_IMPLICITS, ELEMENTARY_TYPES, PLATFORM_ALIASES } from "../../frontend/types/index.js"
import { ELEMENTARY_TYPE_WORDS, KEYWORDS, parseSource, type CompileEnvironment, type Dialect } from "../../frontend/syntax/index.js"
import { hover } from "../index.js"
import type { Document } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"

/**
 * THE BUILT-IN HOVER, ASKED THROUGH THE SERVICE (openspec lsp-same-standard 2.2/2.3, design.md §6): every name below is
 * written in the body of its own function block (which EXTENDS a base, so `SUPER` means something there) of ONE parsed and
 * bound document, and `hover()` is asked at it — the path an editor takes, both vendors, one entry.
 */
function hoversOf(names: readonly string[], dialect: Dialect, environment?: CompileEnvironment): Map<string, string | undefined> {
  const at: Array<[string, number]> = []
  let src = "FUNCTION_BLOCK FB_Base\nEND_FUNCTION_BLOCK\n"
  names.forEach((name, i) => {
    const head = `FUNCTION_BLOCK FB_${i} EXTENDS FB_Base\nVAR p : INT; END_VAR\np := `
    at.push([name, src.length + head.length + 1])
    src += `${head}${name};\nEND_FUNCTION_BLOCK\n`
  })
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, dialect)
  const doc: Document = { uri: "file:///B.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], dialect, environment)
  return new Map(at.map(([name, offset]) => [name, (hover(doc, project, offset)?.contents as { value: string } | undefined)?.value]))
}

const text = (name: string, dialect: Dialect = "codesys", environment?: CompileEnvironment): string | undefined =>
  hoversOf([name], dialect, environment).get(name)

test("an elementary type's hover carries its range, DERIVED from types/elementary", () => {
  expect(text("INT")).toBe("```iecst\nINT\n```\n\nIEC 61131-3 elementary type.\n\n_data type · 16-bit signed int · range -32768..32767_")
  expect(text("time_of_day")).toContain("```iecst\nTOD\n```") // alias-aware
  expect(text("BYTE")).toContain("range 0..255")
  expect(text("MOD")).toBe("```iecst\nMOD\n```\n\nInteger remainder (not defined for REAL).\n\n_operator_")
  expect(text("SQRT")).toBe("```iecst\nSQRT\n```\n\nSquare root (REAL/LREAL).\n\n_standard function_")
  expect(text("NotARealThing")).toBeUndefined()
})

test("hover falls back to the built-in entry for a built-in type", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n n : INT;\nEND_VAR\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, "codesys")
  const doc: Document = { uri: "u", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
  // cursor on the `INT` type name (a built-in, not a user symbol)
  const h = hover(doc, project, src.indexOf(": INT") + 2)
  expect((h?.contents as { value: string }).value).toContain("elementary type")
})

// ─── conversion built-ins (found via the transpiler's corpus call census: 504 sites) ──────────────────────

test("the conversion operators hover with their result type, derived from the elementary types rather than listed", () => {
  expect(text("INT_TO_REAL")).toBe("```iecst\nINT_TO_REAL\n```\n\nConvert INT to REAL.\n\n_operator · returns REAL_")
  // the short form names only its target
  expect(text("TO_DINT")).toContain("\n\nConvert the operand to DINT.\n\n_operator · returns DINT")
  // case-insensitive, like every other lookup
  expect(text("to_real")).toBe("```iecst\nTO_REAL\n```\n\nConvert the operand to REAL.\n\n_operator · returns REAL_")
  // an integer target carries its range, from `types/elementary` — the same numbers the checks use
  expect(text("TO_SINT")).toBe("```iecst\nTO_SINT\n```\n\nConvert the operand to SINT.\n\n_operator · returns SINT · result range -128..127_")
  // TRUNC stays hand-written: the wording names its real target (DINT), which the name does not
  expect(text("TRUNC")).toBe("```iecst\nTRUNC\n```\n\nTruncate a REAL/LREAL toward zero to DINT.\n\n_standard function · returns DINT_")
})

test("a built-in with a FIXED result shows it, read from BUILTIN_RESULT", () => {
  const shown = hoversOf([...BUILTIN_RESULT.keys()], "codesys")
  for (const [name, result] of BUILTIN_RESULT) expect(shown.get(name)).toContain(`· returns ${result}_`)
})

test("a conversion-shaped name with an unknown type is NOT described", () => {
  const shown = hoversOf(["TO_MYSTRUCT", "FOO_TO_BAR", "INT_TO_NOPE"], "codesys")
  expect([...shown.values()]).toEqual([undefined, undefined, undefined])
})

// frontend-conformance 3.1.5: the compiler's own names are ONE set, `types/builtins.ts` `BUILTIN_OPERATOR_NAMES` — the
// search order asks it (`types/names` `resolveBareName`) and the catalog holds the hover text of exactly those names, each
// an operator or standard-function entry (not a type or conversion answer that happens to match the name). The other
// direction — no catalog operator outside the set — is refused when `builtin-hover.ts` loads.
test("the front-end's built-in names each hover as an operator or a standard function", () => {
  const shown = hoversOf([...BUILTIN_OPERATOR_NAMES], "codesys")
  expect([...BUILTIN_OPERATOR_NAMES].filter((n) => !/\n\n_(operator|standard function)( · [^\n]*)?_$/.test(shown.get(n) ?? ""))).toEqual([])
})

/**
 * EVERY BUILT-IN HAS HOVER, AND ONLY WHERE ITS DIALECT HAS IT (openspec lsp-same-standard 2.3, design.md §1.6): over every
 * set the front-end calls built-in — the elementary types with their long forms and the platform integers, the operators
 * and standard functions, the fixed-result built-ins, the implicits, every conversion over those type names, and the
 * CLOSED list of `__` names the compiler has (the vocabulary's `__` keywords, the platform integers, `__SYSTEM`; never
 * `builtinName`'s `__` prefix test, which is open) — per dialect, both directions, through the service: a name
 * `builtinName` accepts has hover, a name it refuses has none. Red before 2.3 on the nine names nothing described: `THIS`
 * `SUPER` `IOCONFIG_GLOBALS` `TYPE_CLASS` `__UXINT` `__XINT` `__XWORD` `__VECTOR` `__SYSTEM`.
 */
const TYPE_WORDS = [...ELEMENTARY_TYPE_WORDS]
/** The conversions are spelled over the elementary names and their long forms. Not over the platform integers: a
 *  `__XINT_TO_…` name is "accepted" only by `builtinName`'s open `__` test (design.md §3, "known going in" — 3.1's). */
const CONVERTIBLE = TYPE_WORDS.filter((n) => !PLATFORM_ALIASES.has(n))
const DUNDER_NAMES = [...KEYWORDS.filter((k) => k.startsWith("__")), ...PLATFORM_ALIASES.keys(), "__SYSTEM"]
const BUILTINS: readonly string[] = [
  ...new Set([
    ...TYPE_WORDS,
    ...ELEMENTARY_TYPES.keys(),
    ...BUILTIN_OPERATOR_NAMES,
    ...BUILTIN_RESULT.keys(),
    ...COMPILER_IMPLICITS,
    ...DUNDER_NAMES,
    ...CONVERTIBLE.flatMap((to) => [`TO_${to}`, `TRUNC_${to}`, ...CONVERTIBLE.map((from) => `${from}_TO_${to}`)]),
  ]),
]

test("the closed __ list is the 21 names the compiler has", () => {
  expect(DUNDER_NAMES.length).toBe(21)
})

for (const dialect of ["codesys", "twincat"] as const)
  test(`${dialect}: every built-in the dialect has hovers through the service, and none it refuses does`, () => {
    const shown = hoversOf(BUILTINS, dialect)
    const accepted = BUILTINS.filter((n) => builtinName(n, dialect) !== undefined)
    expect(accepted.filter((n) => shown.get(n) === undefined)).toEqual([])
    expect(BUILTINS.filter((n) => builtinName(n, dialect) === undefined && shown.get(n) !== undefined)).toEqual([])
    expect(accepted.length).toBeGreaterThan(500) // the conversions alone are hundreds: the sets were read, not empty
  })

test("the nine names nothing described hover through the service on CODESYS", () => {
  const nine = ["THIS", "SUPER", "IoConfig_Globals", "TYPE_CLASS", "__UXINT", "__XINT", "__XWORD", "__VECTOR", "__SYSTEM"]
  const shown = hoversOf(nine, "codesys")
  expect(nine.filter((n) => !(shown.get(n) ?? "").includes("\n\n"))).toEqual([])
  expect(shown.get("THIS")).toContain("instance itself")
})

/** `src` parsed and bound in `dialect`; the hover at the first `word` after `after`. */
function hoverIn(src: string, word: string, after: string, dialect: Dialect = "codesys"): string | undefined {
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, dialect)
  const doc: Document = { uri: "file:///S.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], dialect)
  return (hover(doc, project, src.indexOf(word, src.indexOf(after)) + 1)?.contents as { value: string } | undefined)?.value
}

// the compiler's rule, `this-super-context` (C0045, C0122): THIS and SUPER mean nothing in a PROGRAM or a FUNCTION, and
// SUPER nothing in a function block that extends nothing — the analysis reports them there, so the hover describes none
test("THIS and SUPER hover only where they mean something", () => {
  const fn = `FUNCTION F : INT\nVAR x : POINTER TO INT; END_VAR\nx := THIS;\nEND_FUNCTION`
  expect(hoverIn(fn, "THIS", ":= ")).toBeUndefined()
  const prg = `PROGRAM P\nVAR x : POINTER TO INT; END_VAR\nx := SUPER;\nEND_PROGRAM`
  expect(hoverIn(prg, "SUPER", ":= ")).toBeUndefined()
  const baseless = `FUNCTION_BLOCK B\nVAR x : POINTER TO B; END_VAR\nx := THIS;\nx := SUPER;\nEND_FUNCTION_BLOCK`
  expect(hoverIn(baseless, "THIS", ":= ")).toContain("instance itself")
  expect(hoverIn(baseless, "SUPER", ":= ")).toBeUndefined()
  const derived = `FUNCTION_BLOCK A\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK D EXTENDS A\nVAR x : POINTER TO A; END_VAR\nx := SUPER;\nEND_FUNCTION_BLOCK`
  expect(hoverIn(derived, "SUPER", ":= ")).toContain("base function block")
})

// platform.ts: the platform integers' width is the TARGET's — 64-bit LINT, 32-bit DINT (both measured) — and an unmeasured
// target has no width, which the hover says rather than guessing one
test("a platform integer's hover names the width the project's target gives it", () => {
  expect(text("__XINT", "twincat", { target: { pointerBits: 32 } })).toContain("_data type · DINT on this target (32-bit pointers)_")
  expect(text("__XINT", "codesys", { target: { pointerBits: 64 } })).toContain("_data type · LINT on this target (64-bit pointers)_")
  expect(text("__XWORD", "twincat", { target: { pointerBits: 32 } })).toContain("DWORD on this target")
  expect(text("__UXINT", "codesys")).toContain("_data type · width unknown: the project's target is not measured_")
})

/** A function block with an LD body that names `name` in a network, parsed and bound in `dialect`. */
function networkDoc(name: string, dialect: Dialect): { doc: Document; project: ReturnType<typeof build.buildSymbolTable>; at: number } {
  const src = `FUNCTION_BLOCK F\nVAR a : BOOL; nm : STRING; out : BOOL; END_VAR\n%LANGUAGE LD\n%NETWORK\nnm := ${name}();\nout := a;\nEND_FUNCTION_BLOCK`
  const parseResult = parseSource(src, { networkText: true, unicodeIdentifiers: false }, dialect)
  const doc: Document = { uri: "file:///F.pou", source: src, parseResult }
  return { doc, project: build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], dialect), at: src.indexOf(name) + 2 }
}

test("network text hover: a built-in the dialect does not have answers nothing; one it has is described", () => {
  const tc = networkDoc("__POUNAME", "twincat")
  expect(hover(tc.doc, tc.project, tc.at)).toBeUndefined()
  const cds = networkDoc("__POUNAME", "codesys")
  expect((hover(cds.doc, cds.project, cds.at)?.contents as { value: string }).value).toContain("Enclosing POU name")
})

test("pragma help: a directive on both dialects; an attribute only where the dialect knows it", () => {
  for (const d of ["codesys", "twincat"] as const) {
    expect(pragmaHelp("region", d)).toContain("region")
    expect(pragmaHelp("qualified_only", d)).toContain("attribute")
  }
  // CODESYS warns `TcRetain` unknown — it gets no description there
  expect(pragmaHelp("TcRetain", "twincat")).toContain("attribute")
  expect(pragmaHelp("TcRetain", "codesys")).toBeUndefined()
  expect(pragmaHelp("no_such_thing", "twincat")).toBeUndefined()
})

// `DIRECTIVES` is a plain object: `w in DIRECTIVES` took Object.prototype's keys for directives, and `{constructor}`
// hovered "function Object() { [native code] }"
test("pragma help: an inherited object key is no directive", () => {
  for (const d of ["codesys", "twincat"] as const)
    for (const w of ["constructor", "__proto__", "toString", "hasOwnProperty"]) expect(pragmaHelp(w, d)).toBeUndefined()
})
