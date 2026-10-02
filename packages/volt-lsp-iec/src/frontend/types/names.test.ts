/**
 * THE BARE-NAME SEARCH ORDER — `resolveBareName`, the one answer to "what does this bare identifier name?" (rule Y23,
 * `docs/codesys-reference/09-shadowing.md`), with the device-tree instances (Y24) and the global-namespace dot (E33).
 * Each case is a recorded fixture of `test/conformance/fixtures/names/scopes.ts`, named beside it.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { build, findScopeByName, type Scope } from "../symbols/index.js"
import type { LibraryManifest } from "../library/index.js"
import { resolveBareName, resolveGlobalName, type BareName } from "./names.js"

const file = (uri: string, source: string) => ({ uri, source, parseResult: parseSource(source, { networkText: true }) })
const tag = (b: BareName): string =>
  b.kind === "declared" ? `declared ${b.symbol.kind} in ${b.foundIn.kind}` : b.kind === "builtin" ? `builtin ${b.builtin}` : b.kind

const FB = `FUNCTION_BLOCK FB_U
VAR loc : INT; END_VAR
END_FUNCTION_BLOCK
METHOD M_mbg : INT
VAR mloc : INT; END_VAR
M_mbg := 7;
END_METHOD`

function project(...extra: { uri: string; source: string }[]): Scope {
  return build.buildSymbolTable([file("FB_U.fb", FB), ...extra.map((f) => file(f.uri, f.source))], [], "codesys", undefined, [
    { kind: "device", name: "Device", uri: "Device/Device.device" },
  ])
}
const method = (p: Scope): Scope => findScopeByName(p, "M_mbg")!

test("steps 1–4: a method's local, its FB's variable, its FB's method — before any global (sym_method_before_global)", () => {
  const p = project({ uri: "GVL.gvl", source: "VAR_GLOBAL\n mloc : INT;\n loc : INT;\n M_mbg : INT;\nEND_VAR" })
  expect(tag(resolveBareName(method(p), "mloc"))).toBe("declared var in method")
  expect(tag(resolveBareName(method(p), "LOC"))).toBe("declared var in pou")
  expect(tag(resolveBareName(method(p), "m_mbg"))).toBe("declared method in pou")
})

test("step 5 before step 8: a global before a POU of its name (sym_global_before_pou_name)", () => {
  const p = project({ uri: "a.fun", source: "FUNCTION F_Same : INT\nEND_FUNCTION" }, { uri: "z.gvl", source: "VAR_GLOBAL\n F_Same : INT;\nEND_VAR" })
  expect(tag(resolveBareName(method(p), "F_Same"))).toBe("declared gvl_var in project")
})

test("Y24: a device-tree instance resolves bare, as a device (sym_device_instance_bare)", () => {
  expect(tag(resolveBareName(method(project()), "device"))).toBe("device")
})

test("the compiler's own names: system operators, conversions, implicits, operators, elementary types", () => {
  const m = method(project())
  expect(["__NEW", "INT_TO_REAL", "THIS", "MAX", "ADR", "LREAL"].map((n) => tag(resolveBareName(m, n)))).toEqual([
    "builtin system-operator",
    "builtin conversion",
    "builtin implicit",
    "builtin operator",
    "builtin operator",
    "builtin type",
  ])
  expect(tag(resolveBareName(m, "nope"))).toBe("none")
})

test("a dialect's own vocabulary: TwinCAT has no __POSITION and no conversion to LDATE", () => {
  const p = build.buildSymbolTable([file("FB_U.fb", FB)], [], "twincat")
  const m = findScopeByName(p, "M_mbg")!
  expect(tag(resolveBareName(m, "__POSITION"))).toBe("none")
  expect(tag(resolveBareName(m, "DATE_TO_LDATE"))).toBe("none")
  expect(tag(resolveBareName(m, "__NEW"))).toBe("builtin system-operator")
})

test("a referenced library's namespace resolves bare, as a library namespace — one whose library materialized nothing too", () => {
  const manifest: LibraryManifest = {
    uri: "Application/Library Manager/Empty/Empty.library",
    folder: "Empty",
    namespace: "EmptyNs",
    library: "Empty",
    dependencies: [],
    materialization: 4,
  }
  const p = build.buildSymbolTable([file("FB_U.fb", FB)], [manifest], "codesys")
  expect(tag(resolveBareName(findScopeByName(p, "M_mbg")!, "emptyns"))).toBe("library-namespace")
})

test("E33: `.name` names the global past every local and member (sym_global_namespace_dot_skips_local)", () => {
  const p = project({ uri: "GVL.gvl", source: "VAR_GLOBAL\n mloc : INT;\nEND_VAR" })
  expect(tag(resolveGlobalName(p, "mloc"))).toBe("declared gvl_var in project")
  expect(tag(resolveGlobalName(p, "loc"))).toBe("none")
})

// ─── the enum members (rules EN1–EN6, frontend-conformance 3.3, `fixtures/names/enums.ts`, both vendors 2026-10-02) ───
const enums = (source: string, uri = "E.dut") => ({ uri, source })
const UTIL: LibraryManifest = { uri: "App/Library Manager/Util/Util.library", folder: "Util", namespace: "Util", library: "Util", dependencies: [], materialization: 4 }
const TWO = "TYPE E_A : (en_x := 3, en_y := 4);\nEND_TYPE\nTYPE E_B : (en_x := 5, en_z := 6);\nEND_TYPE"

test("EN2/EN3: a member one enum declares names that member; one two enums declare is ambiguous (enum_same_member_two_enums)", () => {
  const m = method(project(enums(TWO)))
  expect(tag(resolveBareName(m, "en_y"))).toBe("enum-member")
  const x = resolveBareName(m, "EN_X")
  expect(x.kind === "ambiguous" ? x.candidates.map((c) => c.owner.name).sort() : x.kind).toEqual(["E_A", "E_B"])
})

test("EN1/EN3: a qualified_only enum's member is no candidate — beside an open enum's it is that one's (enum_same_member_one_qualified_only)", () => {
  const m = method(project(enums("{attribute 'qualified_only'}\nTYPE E_Q : (en_x := 3);\nEND_TYPE\nTYPE E_B : (en_x := 5);\nEND_TYPE")))
  const x = resolveBareName(m, "en_x")
  expect(x.kind === "enum-member" ? x.symbol.owner.name : x.kind).toBe("E_B")
})

test("EN5: a variable of the member's name is the declaration the name means (enum_member_vs_variable, enum_member_vs_method_local)", () => {
  const m = method(project(enums("TYPE E_A : (loc := 3, mloc := 4);\nEND_TYPE")))
  expect(tag(resolveBareName(m, "loc"))).toBe("declared var in pou")
  expect(tag(resolveBareName(m, "mloc"))).toBe("declared var in method")
})

test("EN6: a referenced library's member resolves bare where one enum declares it (enum_library_bare); a project enum's of its name first (enum_library_member_vs_project_enum)", () => {
  const p = build.buildSymbolTable([
    file("FB_U.fb", FB),
    file("App/Library Manager/Util/GEN_MODE.dut", "TYPE GEN_MODE : (SAWTOOTH_RISE := 2, COSINUS := 6);\nEND_TYPE"),
    file("E.dut", "TYPE E_P : (COSINUS := 9);\nEND_TYPE"),
  ], [UTIL], "codesys")
  const m = findScopeByName(p, "M_mbg")!
  const rise = resolveBareName(m, "sawtooth_rise")
  expect(rise.kind === "enum-member" ? rise.symbol.owner.name : rise.kind).toBe("GEN_MODE")
  const cos = resolveBareName(m, "COSINUS")
  expect(cos.kind === "enum-member" ? cos.symbol.owner.name : cos.kind).toBe("E_P")
})

test("EN3/EN6: a member two of a library's enums declare names nothing, and unsaid — only \"not defined\" (enum_library_same_member_one_library)", () => {
  const p = build.buildSymbolTable([
    file("FB_U.fb", FB),
    file("App/Library Manager/Util/WEEKDAY.dut", "TYPE WEEKDAY : (UNKNOWN := 0, MONDAY := 1);\nEND_TYPE"),
    file("App/Library Manager/Util/PERIOD.dut", "TYPE PERIOD : (UNKNOWN := 0, DAILY := 1);\nEND_TYPE"),
  ], [UTIL], "codesys")
  const u = resolveBareName(findScopeByName(p, "M_mbg")!, "UNKNOWN")
  expect(u.kind === "ambiguous" ? u.said : u.kind).toBe(false)
  const own = resolveBareName(method(project(enums(TWO))), "en_x")
  expect(own.kind === "ambiguous" ? own.said : own.kind).toBe(true)
})

// NOT A MEASURED RULE — `precedence` rank 0 applied inside a library: no fixture can author a library body, so no recording
// says how a library reaches its OWN enum's members. A library ships compiled by the vendor and the LSP must not refuse a
// name in it that resolves at all; this pins that design choice, not EN6 (which asks only the application's side)
test("precedence rank 0 (unmeasured): inside the library that declares it, the member is reached bare", () => {
  const p = build.buildSymbolTable([
    file("App/Library Manager/Util/WEEKDAY.dut", "TYPE WEEKDAY : (MONDAY := 1);\nEND_TYPE"),
    file("App/Library Manager/Util/F_Day.fun", "FUNCTION F_Day : INT\nVAR d : WEEKDAY; END_VAR\nd := MONDAY;\nEND_FUNCTION"),
  ], [UTIL], "codesys")
  expect(tag(resolveBareName(findScopeByName(p, "F_Day")!, "monday"))).toBe("enum-member")
})
