/**
 * THE SAME TYPE NAME, WRITTEN IN TWO FILES, MEANS TWO DIFFERENT TYPES.
 *
 * `EXTENDS` is not the only lookup that can face several candidates for one name — every `v : ETRIG;` does
 * too. Both `CAA Behaviour Model` (namespace CBM) and `CBML` export an `ETRIG`, real projects reference both,
 * and the declarations differ. Which one a declaration means depends on the library the declaration is IN, by
 * way of that library's own `DEPENDENCIES` line.
 *
 * Before this, `resolveNamedType` took `lookupLocal(project, name)[0]` with no idea who was asking, so every
 * file in the project got the same answer — whichever candidate happened to be bound first.
 */
import { describe, expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { resolveNamedType, resolveTypeExpr } from "./resolve.js"
import { enumDefault } from "./enums.js"
import type { LibraryManifest } from "../library/index.js"
import { build } from "../symbols/index.js"

const LIB = (folder: string) => `file:///w/Library Manager/${folder}`

const manifest = (
  folder: string,
  library: string,
  namespace: string,
  dependencies: string[] = [],
): LibraryManifest => ({
  uri: `${LIB(folder)}/${folder}.library`,
  folder: folder.toLowerCase(),
  namespace,
  library,
  dependencies,
  materialization: 2,
})

const file = (uri: string, source: string) => ({ uri, source, parseResult: parseSource(source, { networkText: true }) })

// The two ETRIGs are not the same function block: only one has `fromCbm`.
const FILES = [
  file(`${LIB("CAA Behaviour Model")}/ETRIG.pou`, "FUNCTION_BLOCK ETRIG\nVAR\n  fromCbm : BOOL;\nEND_VAR\n"),
  file(`${LIB("CBML")}/ETRIG.pou`, "FUNCTION_BLOCK ETRIG\nVAR\n  fromCbml : BOOL;\nEND_VAR\n"),
]

const MANIFESTS = [
  manifest("CAA Behaviour Model", "CAA Behaviour Model", "CBM"),
  manifest("CBML", "CBML", "CBML"),
  manifest("CAA File", "CAA File", "FILE", ["CAA Behaviour Model"]),
  manifest("VisuUtils", "VisuUtils", "VU", ["CBML"]),
]

/** The member set the name resolves to, from the point of view of `askerUri`. */
const membersSeenFrom = (project: ReturnType<typeof build.buildSymbolTable>, askerUri: string): string[] => {
  const t = resolveNamedType("ETRIG", project, 0, askerUri)
  const scope = t.kind === "function_block" ? t.scope : undefined
  return [...(scope?.symbols.keys() ?? [])].sort()
}

describe("a type name with two candidates", () => {
  test("resolves through the asking file's own library dependencies", () => {
    const project = build.buildSymbolTable(FILES, MANIFESTS)
    expect(membersSeenFrom(project, `${LIB("CAA File")}/Reader.pou`)).toEqual(["fromcbm"])
    expect(membersSeenFrom(project, `${LIB("VisuUtils")}/Widget.pou`)).toEqual(["fromcbml"])
  })

  test("a file resolves its OWN library's export before a dependency's", () => {
    const project = build.buildSymbolTable(FILES, [
      ...MANIFESTS.slice(0, 2),
      manifest("CBML", "CBML", "CBML", ["CAA Behaviour Model"]),
    ])
    expect(membersSeenFrom(project, `${LIB("CBML")}/Widget.pou`)).toEqual(["fromcbml"])
  })

  test("project source prefers a project type over any library's", () => {
    const own = file("file:///w/POUs/ETRIG.pou", "FUNCTION_BLOCK ETRIG\nVAR\n  fromProject : BOOL;\nEND_VAR\n")
    const project = build.buildSymbolTable([...FILES, own], MANIFESTS)
    expect(membersSeenFrom(project, "file:///w/POUs/App.pou")).toEqual(["fromproject"])
  })

  test("the answer does not depend on the order the files were bound", () => {
    const forward = build.buildSymbolTable(FILES, MANIFESTS)
    const reverse = build.buildSymbolTable([...FILES].reverse(), MANIFESTS)
    for (const asker of [`${LIB("CAA File")}/Reader.pou`, `${LIB("VisuUtils")}/Widget.pou`])
      expect(membersSeenFrom(reverse, asker)).toEqual(membersSeenFrom(forward, asker))
    expect(membersSeenFrom(reverse, `${LIB("VisuUtils")}/Widget.pou`)).toEqual(["fromcbml"])
  })

  test("with no asker it is still stable — the same answer every time, just uninformed", () => {
    const forward = build.buildSymbolTable(FILES, MANIFESTS)
    const reverse = build.buildSymbolTable([...FILES].reverse(), MANIFESTS)
    const anon = (p: ReturnType<typeof build.buildSymbolTable>) => {
      const t = resolveNamedType("ETRIG", p)
      return [...((t.kind === "function_block" ? t.scope : undefined)?.symbols.keys() ?? [])]
    }
    expect(anon(reverse)).toEqual(anon(forward))
  })
})

// ─── A QUALIFIED TYPE NAME (rules LB1, LB5, LB8; frontend-conformance 3.4.2) ────────────────────────────────────────
// `Ns.T` named the type `T` resolved BARE — the qualifier was dropped — so `Util.ERROR` was whichever ERROR the bare name
// meant: CAA Device Diagnosis' (its folder sorts first). Measured (CODESYS 2026-10-02): `e : Util.ERROR` holds Util's
// WRONG_CONFIGURATION (`lib_ns_type_qualified`, out 2), `e : DED.ERROR` DED's TIME_OUT (`lib_ns_type_qualified_other_library`,
// out 3), and `DED.CommFB.IO_SYSTEM_TYPE` — through DED's namespace to the namespace of CommFB, a library DED depends on —
// is CommFB's enum (`lib_ns_transitive_qualification`, out 2).
describe("a qualified type name", () => {
  const ERRORS = [
    file(`${LIB("CAA Device Diagnosis")}/ERROR.dut`, "TYPE ERROR :\n(\n\tNO_ERROR := 0,\n\tTIME_OUT := 1301\n);\nEND_TYPE\n"),
    file(`${LIB("CAA Types")}/ERROR.dut`, "TYPE ERROR :\n(\n\tNO_ERROR\n);\nEND_TYPE\n"),
    file(`${LIB("Util")}/ERROR.dut`, "TYPE ERROR :\n(\n\tNO_ERROR := 0,\n\tWRONG_CONFIGURATION := 2\n);\nEND_TYPE\n"),
    file(`${LIB("CommFB")}/IO_SYSTEM_TYPE.dut`, "TYPE IO_SYSTEM_TYPE :\n(\n\tPROFIBUS_DP := 1,\n\tPROFINET_IO := 2\n);\nEND_TYPE\n"),
  ]
  const LIBS = [
    manifest("CAA Device Diagnosis", "CAA Device Diagnosis", "DED", ["CAA Types", "CommFB"]),
    manifest("CAA Types", "CAA Types", "CAA"),
    manifest("Util", "Util", "Util"),
    manifest("CommFB", "CommFB", "CommFB"),
  ]
  const declared = (decl: string) => {
    const source = `FUNCTION_BLOCK FB_App\nVAR\n\tv : ${decl};\nEND_VAR\nEND_FUNCTION_BLOCK\n`
    const app = file("file:///w/POUs/FB_App.pou", source)
    const project = build.buildSymbolTable([...ERRORS, app], LIBS)
    const unit = app.parseResult.units[0] as { varSections: { decls: { type: Parameters<typeof resolveTypeExpr>[0] }[] }[] }
    const t = resolveTypeExpr(unit.varSections[0]!.decls[0]!.type, project, 0, project, app.uri)
    return t.kind === "enum" ? [...(t.scope?.symbols.keys() ?? [])].sort() : t.kind
  }

  test("LB1/LB5: `Ns.T` is the namespace's type — Util's ERROR, DED's ERROR, whichever sorts first", () => {
    expect(declared("Util.ERROR")).toEqual(["no_error", "wrong_configuration"])
    expect(declared("DED.ERROR")).toEqual(["no_error", "time_out"])
    expect(declared("CAA.ERROR")).toEqual(["no_error"])
  })

  test("LB8: `Ns.Dep.T` reaches the type through the namespace of a library `Ns` depends on", () => {
    expect(declared("DED.CommFB.IO_SYSTEM_TYPE")).toEqual(["profibus_dp", "profinet_io"])
  })

  test("a qualifier that names nothing resolves to nothing; a dependency chain the namespace does not hold, likewise", () => {
    expect(declared("NoSuchLib.ERROR")).toBe("unknown")
    expect(declared("Util.CommFB.IO_SYSTEM_TYPE")).toBe("unknown")
  })

  // The corpora's builds decide this one: 130 library references in pro2193 name a type their namespace's folder does not
  // hold as materialized — an interface library under `(unresolved)/`, a published dependency's element — and build
  test("a namespace that does not hold the type as materialized: the type as the project holds it", () => {
    expect(declared("Util.IO_SYSTEM_TYPE")).toEqual(["profibus_dp", "profinet_io"])
  })

  // …but only a LIBRARY's element: every one of those 130 is a library's. A library namespace never holds an APPLICATION
  // type, so `Util.AppEnum` is no answer the fallback may give (unrecorded either way: UNKNOWN, which no check reports)
  test("a library namespace does not reach an APPLICATION type of the name", () => {
    const appEnum = file("file:///w/DUTs/AppEnum.dut", "TYPE AppEnum :\n(\n\tA_ONE := 1\n);\nEND_TYPE\n")
    const app = file("file:///w/POUs/FB_App.pou", "FUNCTION_BLOCK FB_App\nVAR\n\tv : Util.AppEnum;\nEND_VAR\nEND_FUNCTION_BLOCK\n")
    const project = build.buildSymbolTable([...ERRORS, appEnum, app], LIBS)
    const unit = app.parseResult.units[0] as { varSections: { decls: { type: Parameters<typeof resolveTypeExpr>[0] }[] }[] }
    expect(resolveTypeExpr(unit.varSections[0]!.decls[0]!.type, project, 0, project, app.uri).kind).toBe("unknown")
  })
})

// THE DEFAULT OF THE ENUM THE NAME RESOLVED TO — not of the first enum by URI that carries its bare name. `enumDefault`
// looked the declaration up again by bare name, so `v : B.E` started at A's first enumerator (1) where B's holds 0
// (rule: zero if zero is a value, `type_enum_default_first_nonzero`).
test("enumDefault answers the enum the qualified name resolved to, not the first of its bare name", () => {
  const files = [
    file(`${LIB("A")}/E.dut`, "TYPE E :\n(\n\tX := 1,\n\tY := 2\n);\nEND_TYPE\n"),
    file(`${LIB("B")}/E.dut`, "TYPE E :\n(\n\tP := 0,\n\tQ := 1\n);\nEND_TYPE\n"),
  ]
  const app = file("file:///w/POUs/FB_App.pou", "FUNCTION_BLOCK FB_App\nVAR\n\ta : A.E;\n\tb : B.E;\nEND_VAR\nEND_FUNCTION_BLOCK\n")
  const project = build.buildSymbolTable([...files, app], [manifest("A", "A", "A"), manifest("B", "B", "B")])
  const unit = app.parseResult.units[0] as { varSections: { decls: { type: Parameters<typeof resolveTypeExpr>[0] }[] }[] }
  const literal = (e: { kind: string; value?: unknown }) => (e.kind === "literal" || e.kind === "int_literal" ? BigInt(String((e as { raw?: string }).raw ?? e.value)) : undefined)
  const start = (i: number) => enumDefault(project, resolveTypeExpr(unit.varSections[0]!.decls[i]!.type, project, 0, project, app.uri), literal as never)
  expect(start(0)).toBe(1n)
  expect(start(1)).toBe(0n)
})
