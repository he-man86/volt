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
