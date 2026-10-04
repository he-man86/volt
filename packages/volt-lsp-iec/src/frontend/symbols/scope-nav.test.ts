/**
 * `findScopeByName` answers from a name index built once per project generation (it was a full tree walk per call —
 * 3.2 s of pro2193's diagnostic pass, ~130 ms of every keystroke). The index must give EXACTLY the walk's answer — the
 * first match in depth-first pre-order — and must not survive a change to the tree.
 */
import { expect, test } from "bun:test"
import { bodyStatements, parseSource } from "../syntax/index.js"
import type { Scope } from "./model.js"
import { externalGlobal, findChildScope, findScopeByName, lookup, lookupMember, lookupUnit, resolveGvlMember, scopeForUnit } from "./index.js"
import { bindFile, buildSymbolTable, relink, unbindFile } from "./incremental.js"

const file = (uri: string, source: string) => ({ uri, source, parseResult: parseSource(source, { networkText: true }) })

/** The pre-index implementation, kept here as the oracle. */
function walk(scope: Scope, name: string): Scope | undefined {
  for (const child of scope.children) {
    if (child.name.toLowerCase() === name.toLowerCase()) return child
    const inner = walk(child, name)
    if (inner !== undefined) return inner
  }
  return undefined
}

const FB_A = "FUNCTION_BLOCK FB_A\nVAR x : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Run\nx := 1;\nEND_METHOD"
const FB_B = "FUNCTION_BLOCK FB_B\nVAR y : INT; END_VAR\nEND_FUNCTION_BLOCK\nMETHOD Run\ny := 1;\nEND_METHOD"
const RUN = "FUNCTION_BLOCK Run\nEND_FUNCTION_BLOCK"
const ITF = "INTERFACE I_Thing\nMETHOD Go : BOOL\nEND_METHOD\nEND_INTERFACE"

test("the index answers exactly what a depth-first walk answers, including a nested name that shadows a later top-level one", () => {
  const project = buildSymbolTable([file("a.pou", FB_A), file("b.pou", FB_B), file("run.pou", RUN), file("i.itf", ITF)])
  for (const name of ["FB_A", "fb_b", "RUN", "Run", "I_Thing", "Go", "nothing"]) expect(findScopeByName(project, name)).toBe(walk(project, name))
  // `Run` is FB_A's method before it is the top-level FB in pre-order — the index must not prefer the top level
  expect(findScopeByName(project, "Run")?.parent?.name).toBe("FB_A")
})

test("a bound file is found, and an unbound one is gone — the index never outlives the tree it was built from", () => {
  const project = buildSymbolTable([file("a.pou", FB_A)])
  expect(findScopeByName(project, "FB_B")).toBeUndefined()

  bindFile(project, file("b.pou", FB_B))
  relink(project)
  expect(findScopeByName(project, "FB_B")?.name).toBe("FB_B")

  unbindFile(project, "a.pou")
  relink(project)
  expect(findScopeByName(project, "FB_A")).toBeUndefined()
  expect(findScopeByName(project, "Run")?.parent?.name).toBe("FB_B")
})

test("a scope that is not a project root is still searched within its own subtree", () => {
  const project = buildSymbolTable([file("a.pou", FB_A), file("b.pou", FB_B)])
  const fbB = findScopeByName(project, "FB_B")!
  expect(findScopeByName(fbB, "Run")?.parent).toBe(fbB)
  expect(findScopeByName(fbB, "FB_A")).toBeUndefined()
})

// A GVL and an alias DUT own no scope (the binder defines their symbols on the project), so no span entry exists for
// them. `scopeForUnit` fell back to a NAME search for the alias and answered with whatever scope shared its name — here a
// method; a GVL carries no name, and must stay without a scope too.
test("a unit that owns no scope has none — a GVL or an alias is never answered with a same-named scope", () => {
  const gvl = file("Run.gvl", "VAR_GLOBAL\ng : INT;\nEND_VAR")
  const alias = file("Run.dut", "TYPE Run : INT; END_TYPE")
  const project = buildSymbolTable([file("a.pou", FB_A), gvl, alias])
  expect(findScopeByName(project, "Run")?.kind).toBe("method")
  const units = [...gvl.parseResult.units, ...alias.parseResult.units]
  expect(units.map((u) => u.kind)).toEqual(["global_var_list", "type_decl"])
  for (const unit of units) expect(scopeForUnit(project, unit)).toBeUndefined()
})

// Rule Y13 (frontend-conformance 3.1.3): the global a VAR_EXTERNAL of a name binds — a list's variable reachable bare,
// never a `qualified_only` list's (`sym_var_external_qualified_only_global`, both vendors 2026-10-02)
test("externalGlobal: a VAR_EXTERNAL binds the bare-reachable global of its name, never a qualified_only one", () => {
  const project = buildSymbolTable([
    file("GVL_A.gvl", "VAR_GLOBAL\n g_plain : INT;\nEND_VAR"),
    file("GVL_Q.gvl", "{attribute 'qualified_only'}\nVAR_GLOBAL\n g_q : INT;\nEND_VAR"),
  ])
  expect(externalGlobal(project, "G_PLAIN")?.uri).toBe("GVL_A.gvl")
  expect(externalGlobal(project, "g_q")).toBeUndefined()
  expect(externalGlobal(project, "nothing")).toBeUndefined()
})

// Rule Y23 (frontend-conformance 3.1.5): the bare-name search order at the project's level — the application's global
// variables (step 5) before its POU and type names (step 8), whichever file comes first: a global and a FUNCTION of one
// name read bare is the global (`sym_global_before_pou_name` runs 3, not 9) and CALLED is a call of an INT ("Program name,
// function or function block instance expected", `sym_global_before_pou_name_called`, both vendors 2026-10-02)
test("lookup: a global variable before a POU of the same name, in either file order (Y23 step 5 before 8)", () => {
  const fn = "FUNCTION F_Same : INT\nF_Same := 9;\nEND_FUNCTION"
  const gvl = "VAR_GLOBAL\n F_Same : INT := 3;\nEND_VAR"
  for (const [a, b] of [["a.pou", "b.gvl"], ["b.pou", "a.gvl"]] as const) {
    const project = buildSymbolTable([file(a, fn), file(b, gvl)])
    expect(lookup(project, "f_same")?.symbol.kind).toBe("gvl_var")
  }
})

// Rule Y23 step 7 (frontend-conformance 3.1.5): a library's global through its namespace and its list,
// `Stu.GVL_UTF8.HALFSHIFT`, is that list's variable — it builds and runs 10 (`sym_library_gvl_qualified_fully`, CODESYS
// 2026-10-02); the qualifier `Stu.GVL_UTF8` names the list inside the namespace
test("resolveGvlMember: a library's list named through the library's namespace (`Ns.GVL.v`)", () => {
  const lib = "App/Library Manager/StringUtils/GVL_UTF8.gvl"
  const project = buildSymbolTable([file(lib, "VAR_GLOBAL\n HALFSHIFT : INT := 10;\nEND_VAR")], [
    { uri: "App/Library Manager/StringUtils/StringUtils.library", folder: "StringUtils", namespace: "Stu", library: "StringUtils", dependencies: [], materialization: 4 },
  ])
  const expr = parseSource("PROGRAM P\nx := Stu.GVL_UTF8.HALFSHIFT;\nEND_PROGRAM", { networkText: true })
  const statement = bodyStatements((expr.units[0] as { body: Parameters<typeof bodyStatements>[0] }).body).statements[0] as { value: Parameters<typeof resolveGvlMember>[0] }
  expect(resolveGvlMember(statement.value, project, project)?.uri).toBe(lib)
})

// Rule Y13 (frontend-conformance 3.1.3): a VAR_EXTERNAL is bound to its global — one with none (or only a
// `qualified_only` list's) binds NOTHING, and both vendors then answer "Identifier 'g' not defined" at every use, the
// conversion of the use a hole (`cc2_constant_and_external`, `sym_var_external_qualified_only_global`): the name is
// looked up past it, as if the declaration were not there
test("lookup: a VAR_EXTERNAL binds where its global exists, and is passed over where none does (Y13)", () => {
  const prg = "PROGRAM P\nVAR_EXTERNAL\n g_there : INT;\n g_q : INT;\n g_none : INT;\nEND_VAR\nEND_PROGRAM"
  const project = buildSymbolTable([
    file("P.pou", prg),
    file("GVL_A.gvl", "VAR_GLOBAL\n g_there : INT;\nEND_VAR"),
    file("GVL_Q.gvl", "{attribute 'qualified_only'}\nVAR_GLOBAL\n g_q : INT;\nEND_VAR"),
  ])
  const p = findScopeByName(project, "P")!
  expect(lookup(p, "g_there")?.foundIn).toBe(p)
  expect(lookup(p, "g_q")).toBeUndefined()
  expect(lookup(p, "g_none")).toBeUndefined()
})

// Y23 is the order of a bare name READ in an expression. A TYPE position (`inst : POU`, `EXTENDS B`, an enum type's
// name) names a POU or type, never a variable or a device: a same-named global must not take a type position's name
// from the POU, whichever file sorts first (frontend-conformance 3.1 review)
test("lookupUnit: a type position finds the POU or type, past a same-named global or device, in either file order", () => {
  const fn = "FUNCTION POU : INT\nEND_FUNCTION\nTYPE E : (A, B);\nEND_TYPE"
  const gvl = "VAR_GLOBAL\n pou : INT;\n e : INT;\nEND_VAR"
  for (const [a, b] of [["a.pou", "b.gvl"], ["b.pou", "a.gvl"]] as const) {
    const project = buildSymbolTable([file(a, fn), file(b, gvl)], [], "codesys", undefined, [{ kind: "device", name: "E", uri: "0.device" }])
    expect(lookupUnit(project, "pou")?.symbol.kind).toBe("function")
    expect(lookupUnit(project, "e")?.symbol.kind).toBe("type")
    expect(lookup(project, "pou")?.symbol.kind).toBe("gvl_var")
  }
  const p = buildSymbolTable([file("p.pou", "PROGRAM P\nVAR pou : INT; END_VAR\nEND_PROGRAM"), file("f.pou", fn)])
  expect(lookupUnit(findScopeByName(p, "P")!, "POU")?.symbol.kind).toBe("function")
})

// A device-tree instance has no type; an application global of its name is typed. No vendor measurement orders the two,
// so the typed global is not hidden by the untyped device that a `<proj>/Device/...` uri sorts before (3.1 review): the
// device comes after the application's globals and before a library's
test("lookup: an application global before a same-named device instance, whatever the uris' order", () => {
  const project = buildSymbolTable([file("z/Device/Plc Logic/Application/GVL.gvl", "VAR_GLOBAL\n L_i750 : INT;\nEND_VAR")], [], "codesys", undefined, [
    { kind: "device", name: "L_i750", uri: "z/Device/L_i750.device" },
  ])
  expect(lookup(project, "l_i750")?.symbol.kind).toBe("gvl_var")
})

// ─── LIBRARY PRECEDENCE EVERYWHERE (rules LB3, LB6; frontend-conformance 3.4.1) ─────────────────────────────────────
// Two libraries export one name. Which one a name means depends on WHO asks (`precedence.ts`): a library's own element,
// then one of its DEPENDENCIES, before anything else. `resolve` and `linkExtends` applied that; `lookup`, `lookupMember`
// and `findScopeByName` took the first candidate in canonical (URI) order, so a library whose folder sorts later lost its
// own name to another library's. Measured on the application's side: Util's FUNCTION DATETIMEFROMWEEK declares its
// output `EERRORID : ERROR` in Util's file, and that ERROR is Util's — DED's (CAA Device Diagnosis) sorts first and
// exports an ERROR too ("Implicit conversion from one enumeration type (ERROR (util …)) to another (ERROR (caa device
// diagnosis …))", `lib_ns_library_member_own_type_other_enum`, CODESYS 2026-10-02).
const LM = "App/Library Manager"
const manifest = (folder: string, namespace: string, dependencies: string[] = []) => ({
  uri: `${LM}/${folder}/${folder}.library`, folder, namespace, library: folder, dependencies, materialization: 4,
})
const TWO_ERRORS = () =>
  buildSymbolTable(
    [
      file(`${LM}/CAA Device Diagnosis/ERROR.dut`, "TYPE ERROR :\n(\n\tNO_ERROR := 0,\n\tTIME_OUT := 1301\n);\nEND_TYPE"),
      file(`${LM}/CAA Device Diagnosis/F_Lib.pou`, "FUNCTION F_Lib : INT\nF_Lib := 1;\nEND_FUNCTION"),
      file(`${LM}/Util/ERROR.dut`, "TYPE ERROR :\n(\n\tNO_ERROR := 0,\n\tWRONG_CONFIGURATION := 2\n);\nEND_TYPE"),
      file(`${LM}/Util/F_Lib.pou`, "FUNCTION F_Lib : INT\nF_Lib := 2;\nEND_FUNCTION"),
      file(`${LM}/Util/DATETIMEFROMWEEK.pou`, "FUNCTION DATETIMEFROMWEEK : ULINT\nVAR_OUTPUT\n\tEERRORID : ERROR;\nEND_VAR\nEND_FUNCTION"),
      file(`${LM}/Tools/USER.pou`, "FUNCTION USER : INT\nUSER := F_Lib();\nEND_FUNCTION"),
      file("App/PLC_PRG.pou", "PROGRAM PLC_PRG\nEND_PROGRAM"),
    ],
    [manifest("CAA Device Diagnosis", "DED"), manifest("Util", "Util"), manifest("Tools", "Tools", ["Util"])],
  )

test("LB6: a bare name two libraries export is the asker's OWN library's, then its dependency's — never the first by URI", () => {
  const project = TWO_ERRORS()
  const own = (folder: string, name: string) => lookup(findScopeByName(project, name)!, "ERROR")?.symbol.uri
  // written in Util's file: Util's ERROR, though DED's sorts first
  expect(own("Util", "DATETIMEFROMWEEK")).toBe(`${LM}/Util/ERROR.dut`)
  // written in a library that DEPENDS on Util: Util's F_Lib
  expect(lookup(findScopeByName(project, "USER")!, "F_Lib")?.symbol.uri).toBe(`${LM}/Util/F_Lib.pou`)
  // the application: every library is rank 2 — the URI tiebreak, as canonical order always gave
  expect(lookup(findScopeByName(project, "PLC_PRG")!, "F_Lib")?.symbol.uri).toBe(`${LM}/CAA Device Diagnosis/F_Lib.pou`)
})

test("LB6: the answer does not depend on the order the files were bound", () => {
  const a = TWO_ERRORS()
  const files = ["Util/ERROR.dut", "CAA Device Diagnosis/ERROR.dut", "Util/DATETIMEFROMWEEK.pou"].map((f) => `${LM}/${f}`)
  const sources = {
    [files[0]!]: "TYPE ERROR :\n(\n\tNO_ERROR := 0\n);\nEND_TYPE",
    [files[1]!]: "TYPE ERROR :\n(\n\tNO_ERROR := 0\n);\nEND_TYPE",
    [files[2]!]: "FUNCTION DATETIMEFROMWEEK : ULINT\nEND_FUNCTION",
  }
  const b = buildSymbolTable(files.map((f) => file(f, sources[f]!)), [manifest("CAA Device Diagnosis", "DED"), manifest("Util", "Util")])
  expect(lookup(findScopeByName(b, "DATETIMEFROMWEEK")!, "ERROR")?.symbol.uri).toBe(`${LM}/Util/ERROR.dut`)
  expect(lookup(findScopeByName(a, "DATETIMEFROMWEEK")!, "ERROR")?.symbol.uri).toBe(`${LM}/Util/ERROR.dut`)
})

test("LB3: a name looked up in a library's NAMESPACE is that library's own element before a dependency's", () => {
  // DED depends on CAA Types, and both export ERROR: `DED.ERROR` is DED's (`lib_ns_type_qualified_other_library` runs
  // DED's TIME_OUT, 1301), though the namespace sees CAA Types' too
  const project = buildSymbolTable(
    [
      file(`${LM}/CAA Types/ERROR.dut`, "TYPE ERROR :\n(\n\tNO_ERROR\n);\nEND_TYPE"),
      file(`${LM}/Device Diagnosis/ERROR.dut`, "TYPE ERROR :\n(\n\tNO_ERROR := 0,\n\tTIME_OUT := 1301\n);\nEND_TYPE"),
    ],
    [manifest("CAA Types", "CAA"), manifest("Device Diagnosis", "DED", ["CAA Types"])],
  )
  const ded = findChildScope(project, "DED")!
  expect(ded.kind).toBe("namespace")
  expect(lookupMember(ded, "ERROR")?.uri).toBe(`${LM}/Device Diagnosis/ERROR.dut`)
  expect(lookupMember(findChildScope(project, "CAA")!, "ERROR")?.uri).toBe(`${LM}/CAA Types/ERROR.dut`)
})

test("LB3: a library asker's own library before the PROJECT's element of the name — every search step, lookup and lookupUnit alike", () => {
  // own library > dependency > project > other: the application's F_Help (step 8) and its STRUCT T must not take the name from
  // the library's own (step 10) when the library asks — `resolveTypeExpr` already answered so, `lookup`/`lookupUnit` did not
  const project = buildSymbolTable(
    [
      file(`${LM}/Util/F_Help.pou`, "FUNCTION F_Help : INT\nF_Help := 2;\nEND_FUNCTION"),
      file(`${LM}/Util/F_User.pou`, "FUNCTION F_User : INT\nF_User := F_Help();\nEND_FUNCTION"),
      file(`${LM}/Util/T.dut`, "TYPE T :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE"),
      file(`${LM}/Util/G.gvl`, "VAR_GLOBAL\n\tgShared : INT;\nEND_VAR"),
      file("App/F_Help.pou", "FUNCTION F_Help : INT\nF_Help := 1;\nEND_FUNCTION"),
      file("App/T.dut", "TYPE T :\nSTRUCT\n\tb : INT;\nEND_STRUCT\nEND_TYPE"),
      file("App/GVL.gvl", "VAR_GLOBAL\n\tgShared : INT;\nEND_VAR"),
      file("App/PLC_PRG.pou", "PROGRAM PLC_PRG\nEND_PROGRAM"),
    ],
    [manifest("Util", "Util")],
  )
  const user = findScopeByName(project, "F_User", `${LM}/Util/F_User.pou`)!
  expect(lookup(user, "F_Help")?.symbol.uri).toBe(`${LM}/Util/F_Help.pou`)
  expect(lookupUnit(user, "T")?.symbol.uri).toBe(`${LM}/Util/T.dut`)
  expect(lookup(user, "gShared")?.symbol.uri).toBe(`${LM}/Util/G.gvl`)
  // the application keeps the search order (rule Y23): its own POU and type, its own global
  const prg = findScopeByName(project, "PLC_PRG")!
  expect(lookup(prg, "F_Help")?.symbol.uri).toBe("App/F_Help.pou")
  expect(lookupUnit(prg, "T")?.symbol.uri).toBe("App/T.dut")
  expect(lookup(prg, "gShared")?.symbol.uri).toBe("App/GVL.gvl")
})

test("LB3: findScopeByName, given the asker, answers the asker's own library's scope of a name two libraries declare", () => {
  const itf = "INTERFACE I_Thing\nMETHOD Go : BOOL\nEND_METHOD\nEND_INTERFACE"
  const project = buildSymbolTable(
    [file(`${LM}/A/I_Thing.itf`, itf), file(`${LM}/B/I_Thing.itf`, itf), file(`${LM}/B/FB_X.pou`, "FUNCTION_BLOCK FB_X IMPLEMENTS I_Thing\nEND_FUNCTION_BLOCK")],
    [manifest("A", "A"), manifest("B", "B")],
  )
  expect(findScopeByName(project, "I_Thing", `${LM}/B/FB_X.pou`)?.defUri).toBe(`${LM}/B/I_Thing.itf`)
  expect(findScopeByName(project, "I_Thing", `${LM}/A/Other.pou`)?.defUri).toBe(`${LM}/A/I_Thing.itf`)
  // no asker: the first by URI, as before
  expect(findScopeByName(project, "I_Thing")?.defUri).toBe(`${LM}/A/I_Thing.itf`)
})

test("a namespace two libraries declare is both libraries' — `CB` is CAA Callback's AND CAA Callback Extern's, whatever the manifests' order", () => {
  // a real pair (every CODESYS corpus project but one): the CAA Callback placeholder materializes nothing and its resolution,
  // CAA Callback Extern, the elements — both manifests say NAMESPACE CB. The first manifest bound took the namespace and the
  // second's elements were not in it, so which `CB.x` resolved was the directory's enumeration order: NTFS sorts, ext4 does
  // not, and CI (Linux) resolved 30 fewer library members than Windows (2026-10-04).
  const files = [
    file(`${LM}/CAA Callback Extern/EVENT.dut`, "TYPE EVENT :\n(\n\tEVT_NONE := 0\n);\nEND_TYPE"),
    file(`${LM}/CAA Callback Ext2/CALLBACK.dut`, "TYPE CALLBACK :\nSTRUCT\n\ta : INT;\nEND_STRUCT\nEND_TYPE"),
  ]
  const placeholder = manifest("CAA Callback", "CB")
  const extern = manifest("CAA Callback Extern", "CB")
  const ext2 = manifest("CAA Callback Ext2", "CB")
  for (const order of [[placeholder, extern, ext2], [ext2, extern, placeholder], [extern, placeholder, ext2]]) {
    const cb = findChildScope(buildSymbolTable(files, order), "CB")!
    expect(cb.kind).toBe("namespace")
    expect(lookupMember(cb, "EVENT")?.uri).toBe(`${LM}/CAA Callback Extern/EVENT.dut`)
    expect(lookupMember(cb, "CALLBACK")?.uri).toBe(`${LM}/CAA Callback Ext2/CALLBACK.dut`)
    // ONE namespace scope and ONE namespace symbol, standing for the same manifest in every order: the first by URI
    const first = [placeholder, extern, ext2].map((m) => m.uri).sort()[0]
    const project = buildSymbolTable(files, order)
    expect(project.children.filter((c) => c.kind === "namespace").map((c) => c.libraryUri)).toEqual([first])
    expect((project.symbols.get("cb") ?? []).map((s) => s.uri)).toEqual([first])
  }
})
