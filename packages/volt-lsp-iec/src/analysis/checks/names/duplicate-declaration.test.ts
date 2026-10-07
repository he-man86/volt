/**
 * duplicate-declaration — a name declared twice in one scope. Two same-name METHODS get the C0582 method
 * wording (an unmarked overload — which Volt can't push either way; the bridge silently collapses it), while a
 * duplicate variable keeps the generic "local variable" wording.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../test-uri.js"

const diag = (src: string) => {
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }])
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
}

test("C0582 — two methods with the same name in one FB", () => {
  const src = `FUNCTION_BLOCK FB_Math\nEND_FUNCTION_BLOCK\nMETHOD Calc : INT\nVAR_INPUT\n a : INT;\nEND_VAR\nEND_METHOD\nMETHOD Calc : INT\nVAR_INPUT\n a : INT;\n b : INT;\nEND_VAR\nEND_METHOD`
  const ds = diag(src).filter((d) => d.code === "duplicate-method")
  expect(ds.length).toBe(1)
  expect(ds[0].message).toBe(`There is another method with the name 'Calc'. Use the Attribute {attribute 'overloaded'} if you want to define overloaded methods.`)
})

test("a duplicate variable keeps the generic wording (not the method one)", () => {
  const src = `PROGRAM PLC_PRG\nVAR\n x : INT;\n x : BOOL;\nEND_VAR\nEND_PROGRAM`
  const ds = diag(src).filter((d) => d.code.startsWith("duplicate-"))
  expect(ds.map((d) => d.code)).toEqual(["duplicate-declaration"])
  expect(ds[0].message).toBe(`A local variable named 'x' is already defined in 'PLC_PRG'`)
})

test("two differently-named methods are fine — no FP", () => {
  const src = `FUNCTION_BLOCK FB_Math\nEND_FUNCTION_BLOCK\nMETHOD Add2 : INT\nEND_METHOD\nMETHOD Sub2 : INT\nEND_METHOD`
  expect(diag(src).filter((d) => d.code.startsWith("duplicate-"))).toEqual([])
})

// frontend-conformance 3.1.1 (rule Y16): a METHOD's scope is its own unit's — the FB's walk reached it too, so a duplicate in
// a method was reported twice where both vendors say it once (`sym_duplicate_method_param_and_local`,
// `sym_inout_and_stat_same_method`, 2026-10-02)
test("a duplicate in a METHOD is reported once, and in a property accessor once", () => {
  const src = `FUNCTION_BLOCK FB_D\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nVAR_INPUT\n p : INT;\nEND_VAR\nVAR\n p : INT;\nEND_VAR\nEND_METHOD\nPROPERTY P : INT\nGET\nVAR\n t : INT;\n t : INT;\nEND_VAR\nEND_GET\nEND_PROPERTY`
  const ds = diag(src).filter((d) => d.code === "duplicate-declaration")
  expect(ds.map((d) => d.message)).toEqual([
    "A local variable named 'p' is already defined in 'M'",
    "A local variable named 't' is already defined in 'P'",
  ])
})

// rule Y20: a FUNCTION's name IS its result variable, so a local of that name is a second declaration of it — "A local
// variable named 'F' is already defined in 'F'" on both vendors (`sym_function_local_named_as_function`, 2026-10-02)
test("a FUNCTION's local of the function's own name is a duplicate of its result variable", () => {
  const src = `FUNCTION F_Dup : INT\nVAR\n f_dup : INT;\nEND_VAR\nF_Dup := 3;\nEND_FUNCTION`
  const ds = diag(src).filter((d) => d.code === "duplicate-declaration")
  expect(ds.map((d) => d.message)).toEqual(["A local variable named 'f_dup' is already defined in 'F_Dup'"])
})

// rule Y20, its other three shapes: a METHOD's name is its result variable as a FUNCTION's is, and a VAR_INPUT of the
// name declares it a second time as a local does — "A local variable named 'M' is already defined in 'M'", both vendors
// (`sym_method_local_named_as_method`, `sym_method_input_named_as_method`, `sym_function_input_named_as_function`,
// 2026-10-02)
test("a METHOD's local or VAR_INPUT, and a FUNCTION's VAR_INPUT, of the unit's own name duplicate its result variable", () => {
  const dup = (src: string) => diag(src).filter((d) => d.code === "duplicate-declaration").map((d) => d.message)
  const fb = (section: string) => `FUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK\nMETHOD M_Same : INT\n${section}\n M_Same : INT;\nEND_VAR\nM_Same := 3;\nEND_METHOD`
  expect(dup(fb("VAR"))).toEqual(["A local variable named 'M_Same' is already defined in 'M_Same'"])
  expect(dup(fb("VAR_INPUT"))).toEqual(["A local variable named 'M_Same' is already defined in 'M_Same'"])
  expect(dup(`FUNCTION F_Dup : INT\nVAR_INPUT\n F_Dup : INT;\nEND_VAR\nF_Dup := 3;\nEND_FUNCTION`)).toEqual([
    "A local variable named 'F_Dup' is already defined in 'F_Dup'",
  ])
})

// …but a METHOD with no `: <type>` has no result variable: an input of its name is an input and nothing duplicates it —
// pro2193's `METHOD PUBLIC Rollover` declares `rollover : INT` in its VAR_INPUT and builds
test("a METHOD with no result type may declare an input of its own name", () => {
  const src = `FUNCTION_BLOCK FB\nEND_FUNCTION_BLOCK\nMETHOD PUBLIC Rollover\nVAR_INPUT\n rollover : INT;\nEND_VAR\nEND_METHOD`
  expect(diag(src).filter((d) => d.code === "duplicate-declaration")).toEqual([])
})

// analysis-conformance 3.5 (both vendors, recorded 2026-10-06): a METHOD named as the FB's variable is NO duplicate — both
// build it and warn "Ambiguous use" at a bare use (`dupn_method_named_as_variable`, ambiguous-global's) — and a name twice
// in one GLOBAL LIST is one, named after the list's object (`dupn_gvl_variable_twice`)
test("a METHOD named as the FB's variable is not a duplicate declaration", () => {
  const src = `FUNCTION_BLOCK FB\nVAR\n M : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nMETHOD M : INT\nM := 1;\nEND_METHOD`
  expect(diag(src).filter((d) => d.code.startsWith("duplicate-"))).toEqual([])
})

test("a name declared twice in one global list is a duplicate, in the list's object", () => {
  const src = `VAR_GLOBAL\n g : INT;\n g : BOOL;\nEND_VAR`
  const parseResult = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "GVL_Main.gvl", parseResult, source: src }])
  const ds = computeDiagnostics({ uri: "GVL_Main.gvl", parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
  expect(ds.map((d) => `${d.code}: ${d.message}`)).toEqual(["duplicate-declaration: A local variable named 'g' is already defined in 'GVL_Main'"])
})

// gate review (3.4+3.6): only a METHOD beside a VARIABLE is exempt — a METHOD beside an ACTION or a PROPERTY of its name is
// still a duplicate, as before 3.5 (`dupn_method_named_as_action` is push-refused, so no recording answers it)
test("a METHOD named as an ACTION or a PROPERTY of its FB is still a duplicate declaration", () => {
  const dup = (src: string) => diag(src).filter((d) => d.code.startsWith("duplicate-")).map((d) => d.message)
  expect(dup(`FUNCTION_BLOCK FB_A\nEND_FUNCTION_BLOCK\nMETHOD Act : INT\nAct := 1;\nEND_METHOD\nACTION Act\nEND_ACTION`)).toEqual([
    "A local variable named 'Act' is already defined in 'FB_A'",
  ])
  expect(dup(`FUNCTION_BLOCK FB_A\nEND_FUNCTION_BLOCK\nMETHOD Pr : INT\nPr := 1;\nEND_METHOD\nPROPERTY Pr : INT\nGET\nPr := 1;\nEND_GET\nEND_PROPERTY`)).toEqual([
    "A local variable named 'Pr' is already defined in 'FB_A'",
  ])
})

// gate review (3.4+3.6): a GLOBAL LIST's duplicates are the names it BINDS — a VAR_ACCESS section binds nothing, and a
// declaration whose AT operand is refused is dropped by the vendor (binder `ingestGlobalVarList`)
test("a global list's VAR_ACCESS name or refused-AT declaration does not duplicate its variable", () => {
  const gvl = (src: string) => {
    const parseResult = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "GVL_A.gvl", parseResult, source: src }])
    return computeDiagnostics({ uri: "GVL_A.gvl", parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
      .filter((d) => d.code === "duplicate-declaration")
  }
  expect(gvl(`VAR_GLOBAL\n a : INT;\nEND_VAR\nVAR_ACCESS\n a : P.d : INT READ_WRITE;\nEND_VAR`)).toEqual([])
  expect(gvl(`VAR_GLOBAL\n a : INT;\n a AT ABC : INT;\nEND_VAR`)).toEqual([])
})
