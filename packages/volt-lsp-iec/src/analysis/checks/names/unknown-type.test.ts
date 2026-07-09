/**
 * unknown-type check — a declared type name that resolves nowhere (`x : BOL`). Sibling of
 * unresolved-identifier: same resolution oracle, type position instead of body position. These pin the
 * flag surface (typos in every declaration slot) AND the zero-FP skip surface (primitives, project types,
 * catalog built-ins, library namespaces, qualified names, VAR_GENERIC params).
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig, type WorkspaceRefs } from "../../index.js"

/** unknown-type messages for one source (optionally with a second unit + workspace refs). */
function unknownTypes(src: string, references?: WorkspaceRefs, extra?: { uri: string; source: string }): string[] {
  const parseResult = parseSource(src)
  const units = [{ uri: "F.fb", parseResult, source: src }]
  if (extra !== undefined) units.push({ uri: extra.uri, parseResult: parseSource(extra.source), source: extra.source })
  const project = buildSymbolTable(units)
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor: "codesys", lints: { unknownType: true } }), references })
    .filter((d) => d.code === "unknown-type")
    .map((d) => d.message)
}

const fb = (varsAndBody: string) => `FUNCTION_BLOCK F\n${varsAndBody}\nEND_FUNCTION_BLOCK`

test("a misspelled elementary type IS flagged", () => {
  expect(unknownTypes(fb(`VAR a : BOL; END_VAR`))).toEqual(["Unknown type: 'BOL'"])
})

// Opt-in: OFF by default, because below the "library floor" it false-positives on unloaded library types.
test("the check is off by default (no lint flag → no diagnostic)", () => {
  const src = fb(`VAR a : BOL; END_VAR`)
  const diags = computeSemanticDiagnostics({
    parseResult: parseSource(src),
    source: src,
    project: buildSymbolTable([{ uri: "F.fb", parseResult: parseSource(src), source: src }]),
    config: resolveConfig({ vendor: "codesys" }),
  })
  expect(diags.filter((d) => d.code === "unknown-type")).toEqual([])
})

test("a correct elementary type is not flagged", () => {
  expect(unknownTypes(fb(`VAR a : BOOL; b : DINT; s : STRING; END_VAR`))).toEqual([])
})

test("an ANY_* generic type-group name is not flagged", () => {
  expect(unknownTypes(fb(`VAR_GENERIC t : ANY; END_VAR\nVAR_INPUT x : ANY_INT; END_VAR`))).toEqual([])
})

test("a project-declared type/FB/enum/struct is not flagged", () => {
  const src = `TYPE E : (Idle, Run); END_TYPE
TYPE Pt : STRUCT x : INT; END_STRUCT END_TYPE
FUNCTION_BLOCK Other END_FUNCTION_BLOCK
FUNCTION_BLOCK F
VAR e : E; p : Pt; o : Other; END_VAR
END_FUNCTION_BLOCK`
  expect(unknownTypes(src)).toEqual([])
})

test("a catalog built-in (TON) is not flagged", () => {
  expect(unknownTypes(fb(`VAR t : TON; END_VAR`))).toEqual([])
})

test("the element type of an ARRAY / target of a POINTER is checked", () => {
  expect(unknownTypes(fb(`VAR a : ARRAY[0..3] OF BOL; p : POINTER TO NOPE; END_VAR`))).toEqual([
    "Unknown type: 'BOL'",
    "Unknown type: 'NOPE'",
  ])
})

test("a return type and a struct-field type are checked", () => {
  expect(unknownTypes(`FUNCTION Fn : BOL\nEND_FUNCTION`)).toEqual(["Unknown type: 'BOL'"])
  expect(unknownTypes(`TYPE Pt : STRUCT x : NOPE; END_STRUCT END_TYPE`)).toEqual(["Unknown type: 'NOPE'"])
})

test("an alias target is checked", () => {
  expect(unknownTypes(`TYPE Handle : NOPE; END_TYPE`)).toEqual(["Unknown type: 'NOPE'"])
  expect(unknownTypes(`TYPE Handle : DINT; END_TYPE`)).toEqual([])
})

// Zero-FP: a VAR_GENERIC type param used as a type in the same POU resolves via the local scope.
test("a VAR_GENERIC type parameter used as a type is not flagged", () => {
  expect(unknownTypes(fb(`VAR_GENERIC T : ANY; END_VAR\nVAR_INPUT x : T; END_VAR`))).toEqual([])
})

// Zero-FP: a qualified name (`NS.Type`) is skipped whole — the root may be a library namespace.
test("a namespace-qualified type is not flagged", () => {
  expect(unknownTypes(fb(`VAR t : Tc2_Standard.TON; c : CAA.HANDLE; END_VAR`))).toEqual([])
})

// Zero-FP: a library-defined type (loaded under a Library Manager uri) resolves via the project scope.
test("a referenced-library type is not flagged when its signature is loaded", () => {
  const useSrc = fb(`VAR p : ST_LibThing; END_VAR`)
  const libSrc = "TYPE ST_LibThing : STRUCT x : INT; END_STRUCT END_TYPE"
  const project = buildSymbolTable([
    { uri: "F.fb", parseResult: parseSource(useSrc), source: useSrc },
    { uri: "Device/Application/Library Manager/MyLib/ST_LibThing.struct", parseResult: parseSource(libSrc), source: libSrc },
  ])
  const diags = computeSemanticDiagnostics({
    parseResult: parseSource(useSrc),
    source: useSrc,
    project,
    config: resolveConfig({ vendor: "codesys", lints: { unknownType: true } }),
  })
  expect(diags.filter((d) => d.code === "unknown-type")).toEqual([])
})

test("TwinCAT emits the same provisional wording", () => {
  const src = fb(`VAR a : BOL; END_VAR`)
  const tc = computeSemanticDiagnostics({
    parseResult: parseSource(src),
    source: src,
    project: buildSymbolTable([{ uri: "F.fb", parseResult: parseSource(src), source: src }]),
    config: resolveConfig({ vendor: "twincat", lints: { unknownType: true } }),
  })
    .filter((d) => d.code === "unknown-type")
    .map((d) => d.message)
  expect(tc).toEqual(["Unknown type: 'BOL'"])
})
