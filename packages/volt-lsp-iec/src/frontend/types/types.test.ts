import { test, expect } from "bun:test"
import { type Expr, type FunctionBlock, parseSource, bodyStatements, renderTypeExpr, type TypeExpr } from "../syntax/index.js"
import { build, findChildScope, type Scope } from "../symbols/index.js"
import {
  constEval,
  ELEMENTARY_TYPES,
  elementaryType,
  inferExprType,
  isAssignable,
  isIntegerType,
  classifyConversion,
  isNumericType,
  renderType,
  resolveNamedType,
  resolveTypeExpr,
  UNKNOWN,
  type Type,
} from "./index.js"
import { isIsolated, numericRank } from "./predicates.js"

// ─── C.1 elementary — golden test: derived views reproduce the known sets exactly ───

test("elementary facts: ranges, bits, signedness", () => {
  expect(elementaryType("INT")).toMatchObject({ family: "int", bits: 16, signed: true })
  expect(elementaryType("INT")?.range).toEqual({ min: -32768n, max: 32767n })
  expect(elementaryType("BYTE")?.range).toEqual({ min: 0n, max: 255n })
  expect(elementaryType("LWORD")?.range).toEqual({ min: 0n, max: 18446744073709551615n })
  expect(elementaryType("TIME_OF_DAY")?.name).toBe("TOD") // alias canonicalization
  expect(elementaryType("NotAType")).toBeUndefined()
})

test("derived views match the legacy explicit sets", () => {
  const names = [...ELEMENTARY_TYPES.keys()]
  // Integer types = int/bitstring with a rank (BIT excluded — no rank).
  expect(names.filter(isIntegerType).sort()).toEqual(
    ["BYTE", "DINT", "DWORD", "INT", "LINT", "LWORD", "SINT", "UDINT", "UINT", "ULINT", "USINT", "WORD"].sort(),
  )
  // Numeric = everything with a widening rank (integers + REAL/LREAL).
  expect(names.filter(isNumericType).sort()).toEqual(
    [
      "BYTE",
      "DINT",
      "DWORD",
      "INT",
      "LINT",
      "LREAL",
      "LWORD",
      "REAL",
      "SINT",
      "UDINT",
      "UINT",
      "ULINT",
      "USINT",
      "WORD",
    ].sort(),
  )
  // Widening rank lattice: SINT..LREAL = 1..6.
  expect([numericRank("SINT"), numericRank("INT"), numericRank("DINT"), numericRank("LINT")]).toEqual([1, 2, 3, 4])
  expect([numericRank("REAL"), numericRank("LREAL")]).toEqual([5, 6])
  // Isolated families (no cross-family implicit conversion).
  expect(isIsolated("BOOL")).toBe(true)
  expect(isIsolated("STRING")).toBe(true)
  expect(isIsolated("TIME")).toBe(true)
  expect(isIsolated("INT")).toBe(false)
})

// ─── C.2 resolve ───

function proj(src: string): Scope {
  return build.buildSymbolTable([{ uri: "F.fb", parseResult: parseSource(src, { networkText: true }), source: src }])
}

test("resolve: elementary carries facts; alias follows; FB/enum/struct carry scope", () => {
  const p = proj(`
TYPE MyAlias : INT; END_TYPE
TYPE Color : (Red, Green); END_TYPE
TYPE Pt : STRUCT x : INT; END_STRUCT END_TYPE
FUNCTION_BLOCK FB_A VAR n : INT; END_VAR END_FUNCTION_BLOCK`)
  const intT = resolveNamedType("INT", p)
  expect(intT.kind).toBe("elementary")
  expect(intT.kind === "elementary" && intT.elem.bits).toBe(16)
  expect(resolveNamedType("MyAlias", p)).toMatchObject({ kind: "elementary", name: "INT" })
  expect(resolveNamedType("Color", p).kind).toBe("enum")
  expect(resolveNamedType("Pt", p)).toMatchObject({ kind: "struct" })
  expect(resolveNamedType("FB_A", p).kind).toBe("function_block")
  expect(resolveNamedType("SomeLibType", p)).toEqual(UNKNOWN) // unresolvable → skip
})

// ─── C.3 const-eval ───

// The expression is carried as an assignment's VALUE: a bare expression is no statement on either vendor (a literal or `(`
// opening one is refused, a binary operation is "no valid statement" — frontend-conformance 2.6, ST5).
function evalConst(varDecls: string, exprSrc: string) {
  const src = `FUNCTION_BLOCK F\n${varDecls}\nprobe := ${exprSrc};\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.fb", parseResult: pr, source: src }])
  const scope = findChildScope(project, "F")!
  const e = lastExpr(pr.units[0] as FunctionBlock)
  return constEval(e, scope)
}

test("const-eval: literals, arithmetic, const-ref folding, non-const → undefined", () => {
  expect(evalConst("", "2 + 3 * 4")).toBe(14n)
  expect(evalConst("", "(10 - 4) / 2")).toBe(3n)
  expect(evalConst("", "1.5 * 2.0")).toBe(3)
  expect(evalConst("", "5 > 3")).toBe(true)
  expect(evalConst("VAR CONSTANT\n Cap : INT := 100;\nEND_VAR", "Cap + 1")).toBe(101n)
  expect(evalConst("VAR\n v : INT;\nEND_VAR", "v + 1")).toBeUndefined() // non-const var
  expect(evalConst("", "10 / 0")).toBeUndefined() // div by zero
})

test("const-eval: unary, MOD, comparisons, and real arithmetic", () => {
  // unary
  expect(evalConst("", "-(2 + 3)")).toBe(-5n)
  expect(evalConst("", "NOT (5 > 3)")).toBe(false)
  expect(evalConst("", "+(4)")).toBe(4n)
  // integer MOD (+ its undefined case). `**` is no operator on either vendor, so there is no tree to fold: the parse
  // refuses it (`cc_power_operator`; `parse/expression.test.ts`)
  expect(evalConst("", "10 MOD 3")).toBe(1n)
  expect(evalConst("", "10 MOD 0")).toBeUndefined()
  // comparisons across the operator set
  expect(evalConst("", "5 = 5")).toBe(true)
  expect(evalConst("", "4 <> 4")).toBe(false)
  expect(evalConst("", "3 <= 3")).toBe(true)
  expect(evalConst("", "5 >= 9")).toBe(false)
  expect(evalConst("", "2 < 1")).toBe(false)
  // real arithmetic
  expect(evalConst("", "7.5 - 2.5")).toBe(5)
  expect(evalConst("", "9.0 / 2.0")).toBe(4.5)
})

// ─── C.4 infer ───

function lastExpr(fb: FunctionBlock): Expr {
  const stmts = bodyStatements(fb.body).statements
  const last = stmts[stmts.length - 1] as { expr?: Expr; value?: Expr }
  return (last.expr ?? last.value) as Expr
}

function inferExpr(unitsBefore: string, varDecls: string, exprSrc: string): Type {
  const src = `${unitsBefore}\nFUNCTION_BLOCK F\n${varDecls}\nprobe := ${exprSrc};\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.fb", parseResult: pr, source: src }])
  const scope = findChildScope(project, "F")!
  return inferExprType(lastExpr(pr.units.at(-1) as FunctionBlock), scope, project)
}

test("infer: literals and variables", () => {
  expect(inferExpr("", "", "TRUE")).toMatchObject({ kind: "elementary", name: "BOOL" })
  expect(inferExpr("", "", "'hi'")).toMatchObject({ kind: "elementary", name: "STRING" })
  expect(inferExpr("", "", "T#10ms")).toMatchObject({ kind: "elementary", name: "TIME" })
  expect(inferExpr("", "VAR\n n : INT;\nEND_VAR", "n")).toMatchObject({ kind: "elementary", name: "INT" })
  expect(inferExpr("", "", "42")).toEqual(UNKNOWN) // bare int literal is context-dependent width
})

// A CALL OF WHAT IS NO CALL TARGET has no result: `out := .gCall(1)` is "Cannot convert type 'Unknown type: '.gCall(1)''
// to type 'INT'" on both vendors (`expr_global_namespace_call_non_callable`, 2026-10-02) — the call was typed as the
// variable it calls.
test("infer: a call of a variable that is no call target is untyped (expr_global_namespace_call_non_callable, E33)", () => {
  const globals = `VAR_GLOBAL
 gq : INT;
END_VAR`
  expect(inferExpr(globals, "VAR\n o : INT;\nEND_VAR", "o := .gq(1)")).toEqual(UNKNOWN)
  expect(inferExpr(globals, "VAR\n o : INT;\nEND_VAR", "o := gq(1)")).toEqual(UNKNOWN)
  expect(inferExpr("TYPE Pt : STRUCT x : INT; END_STRUCT END_TYPE", "VAR\n p : Pt; o : INT;\nEND_VAR", "o := p()")).toEqual(UNKNOWN)
})

test("infer: member chain, array index, comparison, temporal arithmetic", () => {
  const structSrc = `TYPE Pt : STRUCT x : INT; END_STRUCT END_TYPE`
  expect(inferExpr(structSrc, "VAR\n p : Pt;\nEND_VAR", "p.x")).toMatchObject({ kind: "elementary", name: "INT" })
  expect(inferExpr("", "VAR\n a : ARRAY[0..9] OF REAL;\nEND_VAR", "a[3]")).toMatchObject({
    kind: "elementary",
    name: "REAL",
  })
  expect(inferExpr("", "VAR\n n : INT;\nEND_VAR", "n > 0")).toMatchObject({ kind: "elementary", name: "BOOL" })
  // DT - DT = TIME (temporal arithmetic)
  expect(inferExpr("", "VAR\n a : DT; b : DT;\nEND_VAR", "a - b")).toMatchObject({ kind: "elementary", name: "TIME" })
})

test("infer: an implicit enum's value is of the implicit enum, as the variable declared with it is", () => {
  // `decl_implicit_enum_with_base`, `_with_init`, `_next_value`, `_in_array`, `_in_var_input` (both vendors build and run
  // them): the values were UNKNOWN, so nothing checked a store of one
  const implicit: Type = { kind: "enum", name: "(implicit)" }
  expect(inferExpr("", "VAR\n e : (ie_a, ie_b := 300, ie_c) INT;\nEND_VAR", "ie_c")).toEqual(implicit)
  expect(inferExpr("", "VAR\n a : ARRAY[0..1] OF (ia_a, ia_b);\nEND_VAR", "ia_b")).toEqual(implicit)
  expect(inferExpr("", "VAR\n e : (ie_a, ie_b);\nEND_VAR", "e")).toEqual(implicit)
})

test("infer: an index through a REFERENCE TO an array is the array's element", () => {
  // `decl_reference_to_array` (`rf : REFERENCE TO ARRAY[0..1] OF INT REF= arr; out := rf[1];`, both vendors run it as 4)
  expect(inferExpr("", "VAR\n arr : ARRAY[0..1] OF INT;\n rf : REFERENCE TO ARRAY[0..1] OF INT REF= arr;\nEND_VAR", "rf[1]")).toMatchObject({
    kind: "elementary",
    name: "INT",
  })
})

test("infer: THIS resolves to the enclosing FB member scope", () => {
  const t = inferExpr("", "VAR\n flag : BOOL;\nEND_VAR", "THIS")
  expect(t.kind).toBe("function_block")
})

test("infer: unary minus is typed as the signed type of the operand's width, at least 16 bits (measured)", () => {
  // This said "NOT/-/+ preserve the operand's type" from recollection; CODESYS rejects `sint := -sint` with "Cannot
  // convert type 'INT' to type 'SINT'" (conformance cc_neg_*). No fixture or FP-bait ever negated an 8-bit type.
  const neg = (type: string) => inferExpr("", `VAR\n a : ${type};\nEND_VAR`, "-a")
  expect(neg("SINT")).toMatchObject({ kind: "elementary", name: "INT" })
  expect(neg("USINT")).toMatchObject({ kind: "elementary", name: "INT" })
  expect(neg("BYTE")).toMatchObject({ kind: "elementary", name: "INT" })
  expect(neg("UINT")).toMatchObject({ kind: "elementary", name: "INT" })
  expect(neg("UDINT")).toMatchObject({ kind: "elementary", name: "DINT" })
  expect(neg("INT")).toMatchObject({ kind: "elementary", name: "INT" })
  expect(neg("LINT")).toMatchObject({ kind: "elementary", name: "LINT" })
  // BOTH OF THESE SAID "not measured". They are now — `fixtures/unary-operand.ts` asks every elementary type one at a
  // time, and `-ULINT` is LINT (the silence was itself a guess) while `NOT WORD` is UINT, not WORD.
  expect(neg("ULINT")).toMatchObject({ kind: "elementary", name: "LINT" })
  expect(neg("LWORD")).toMatchObject({ kind: "elementary", name: "LINT" })
  expect(neg("TIME")).toMatchObject({ kind: "elementary", name: "DINT" })
  expect(neg("LTIME")).toMatchObject({ kind: "elementary", name: "LINT" })
  expect(neg("BOOL")).toMatchObject({ kind: "elementary", name: "INT" })
  expect(neg("REAL")).toMatchObject({ kind: "elementary", name: "REAL" })
  const not = (type: string) => inferExpr("", `VAR\n a : ${type};\nEND_VAR`, "NOT a")
  expect(not("WORD")).toMatchObject({ kind: "elementary", name: "UINT" })
  expect(not("BYTE")).toMatchObject({ kind: "elementary", name: "USINT" })
  expect(not("LWORD")).toMatchObject({ kind: "elementary", name: "ULINT" })
  expect(not("TIME")).toMatchObject({ kind: "elementary", name: "UDINT" })
  expect(not("BOOL")).toMatchObject({ kind: "elementary", name: "BOOL" })
})

test("infer: EXPT is REAL only when BOTH arguments are REAL (measured) — never a fixed LREAL", () => {
  // The reference said "always LREAL", which made `real := EXPT(real, real)` warn falsely (conformance
  // cc_expt_real_into_real). No fixture ever stored a REAL-argument EXPT into a REAL.
  // as an assignment's value: `inferExpr` reads the last statement's value, and a bare call is a call statement
  const expt = (decls: string, call: string) => inferExpr("", `VAR\n ${decls}\nEND_VAR`, `tmp := ${call}`)
  expect(expt("a : REAL; b : REAL;", "EXPT(a, b)")).toMatchObject({ kind: "elementary", name: "REAL" })
  expect(expt("i : INT;", "EXPT(i, i)")).toMatchObject({ kind: "elementary", name: "LREAL" })
  expect(expt("a : REAL; i : INT;", "EXPT(a, i)")).toMatchObject({ kind: "elementary", name: "LREAL" })
  expect(expt("l : LREAL; a : REAL;", "EXPT(l, a)")).toMatchObject({ kind: "elementary", name: "LREAL" })
  expect(expt("a : REAL;", "EXPT(a, 2)")).toEqual(UNKNOWN) // a bare literal has no width: stay silent
})

// ─── C.5 compat ───

test("isAssignable: widening, narrowing, isolation, enums", () => {
  const p = proj(`TYPE Color : (Red, Green); END_TYPE\nTYPE Mode : (A, B); END_TYPE`)
  const T = (n: string) => resolveNamedType(n, p)
  expect(isAssignable(T("INT"), T("SINT"))).toBe(true) // widening up the rank
  expect(isAssignable(T("INT"), T("DINT"))).toBe(false) // narrowing — not implicit
  expect(isAssignable(T("BOOL"), T("INT"))).toBe(false) // BOOL isolated
  expect(isAssignable(T("REAL"), T("LREAL"))).toBe(true) // both ways (narrowing is a warning, not error)
  expect(isAssignable(T("Color"), T("Color"))).toBe(true)
  expect(isAssignable(T("Color"), T("Mode"))).toBe(false) // different enums
  expect(isAssignable(T("Color"), T("INT"))).toBe(true) // enum↔int allowed
  expect(isAssignable(T("Color"), T("STRING"))).toBe(false) // enum↔string rejected
  expect(isAssignable(T("INT"), UNKNOWN)).toBe(true) // unknown → skip
})

test("classifyConversion: identity / widen / narrow / sign-change / incompatible", () => {
  const p = proj("")
  const T = (n: string) => resolveNamedType(n, p)
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

// ─── C.5 render ───

function declType(src: string): TypeExpr {
  const fb = parseSource(`FUNCTION_BLOCK F\nVAR\n ${src}\nEND_VAR\nEND_FUNCTION_BLOCK`, { networkText: true }).units[0] as FunctionBlock
  return fb.varSections[0].decls[0].type
}

test("renderType / renderTypeExpr", () => {
  const p = proj("")
  expect(renderType(resolveNamedType("INT", p))).toBe("INT")
  expect(renderType(resolveTypeExpr(declType("a : ARRAY[0..9] OF INT;"), p))).toBe("ARRAY [0..9] OF INT") // the IDE's spelling (conformance `cc6_function_input_array_default`)
  expect(renderType(resolveTypeExpr(declType("q : POINTER TO REAL;"), p))).toBe("POINTER TO REAL")
  expect(renderTypeExpr(declType("sx : STRING(80);"))).toBe("STRING(80)")
  expect(renderTypeExpr(declType("x : INT(0..100);"))).toBe("INT(0..100)")
  expect(renderTypeExpr(declType("p : POINTER TO INT;"))).toBe("POINTER TO INT")
})

// An FB instance called types as its FB (`callReturnType`, the instance's declared type); an ELEMENT of an array of
// them, called, is the same instance reached through an index (`decl_var_generic_in_array`: `inst[0]();`) — it had no
// symbol of its own, so it was UNKNOWN where `inst()` was the FB.
test("infer: an FB instance called through an array index types as the plain instance call does", () => {
  const fb = "FUNCTION_BLOCK G\nVAR\n o : INT;\nEND_VAR\nEND_FUNCTION_BLOCK"
  const g = { kind: "function_block", name: "G" }
  expect(inferExpr(fb, "VAR\n inst : G;\n x : INT;\nEND_VAR", "x := inst()")).toMatchObject(g)
  expect(inferExpr(fb, "VAR\n inst : ARRAY[0..1] OF G;\n x : INT;\nEND_VAR", "x := inst[0]()")).toMatchObject(g)
})

test("infer: a CODESYS partial access is of the part it names (operand_partial_*, expr_partial_access_beside_undefined)", () => {
  const d = "VAR\n d : DWORD;\nEND_VAR"
  expect(inferExpr("", d, "d.%X3")).toMatchObject({ kind: "elementary", name: "BOOL" })
  expect(inferExpr("", d, "d.%B1")).toMatchObject({ kind: "elementary", name: "BYTE" })
  expect(inferExpr("", d, "d.%W0")).toMatchObject({ kind: "elementary", name: "WORD" })
  expect(inferExpr("", "VAR\n l : LWORD;\nEND_VAR", "l.%D1")).toMatchObject({ kind: "elementary", name: "DWORD" })
})

// NOT ON A BIT IS A LOGICAL NOT, as on a BOOL: pro2193 builds `done R= NOT busy;` with both BIT (`ModuleWithStateFB`),
// and `R=` takes a BOOL operand only (`stmt_s_eq_non_bool_value`, frontend-conformance 2.6) — a 1-bit "unsigned integer"
// would be USINT, which `R=` refuses.
test("infer: NOT of a BIT stays a BIT, as NOT of a BOOL stays a BOOL (pro2193 ModuleWithStateFB, ST2)", () => {
  expect(inferExpr("", "VAR\n b : BIT;\nEND_VAR", "NOT b")).toMatchObject({ kind: "elementary", name: "BIT" })
})

test("the parser's elementary type words are every name an elementary type answers to (frontend-conformance 2.8.3, R6)", async () => {
  // `syntax/lex/vocabulary.ts` `ELEMENTARY_TYPE_WORDS` is what the parser refuses where a name belongs; the syntax layer
  // may not import this one, so the two lists are held to each other here
  const { ELEMENTARY_TYPE_WORDS } = await import("../syntax/index.js")
  const { ELEMENTARY_TYPES, ELEM_ALIASES } = await import("./elementary.js")
  const { PLATFORM_ALIASES } = await import("./platform.js")
  const names = [...ELEMENTARY_TYPES.keys(), ...ELEM_ALIASES.keys(), ...PLATFORM_ALIASES.keys()].sort()
  expect([...ELEMENTARY_TYPE_WORDS].sort()).toEqual(names)
})

// rule H2: `inst.baseMember` types through the instance's FB AND its bases (`callshape_inout_base_method_from_outside_derived`
// was UNKNOWN): the member chain looked in the FB's own scope only
test("H2: a base FB's member read through a derived instance has the base member's type", () => {
  const before =
    "FUNCTION_BLOCK B\nVAR\n\tbx : DINT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Get : LREAL\nEND_METHOD\n\nFUNCTION_BLOCK D EXTENDS B\nEND_FUNCTION_BLOCK\n\n"
  expect(renderType(inferExpr(before, "VAR\n d : D;\nEND_VAR", "d.bx"))).toBe("DINT")
  expect(renderType(inferExpr(before, "VAR\n d : D;\nEND_VAR", "d.Get()"))).toBe("LREAL")
})

// a member read through a REFERENCE TO an FB is the FB's member (`inh_override_reference_only`: `r_….M(a := 1)` both vendors
// build; `xo_reference_to_fb_call`, `refdecl_to_struct`): the member scope looked at the reference, not its target
test("a member through a REFERENCE TO an FB or a STRUCT has the member's type", () => {
  const before =
    "FUNCTION_BLOCK B\nVAR\n\tbx : DINT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\nMETHOD Get : LREAL\nEND_METHOD\n\nTYPE S :\nSTRUCT\n\tw : WORD;\nEND_STRUCT\nEND_TYPE\n\n"
  expect(renderType(inferExpr(before, "VAR\n rf : REFERENCE TO B;\nEND_VAR", "rf.bx"))).toBe("DINT")
  expect(renderType(inferExpr(before, "VAR\n rf : REFERENCE TO B;\nEND_VAR", "rf.Get()"))).toBe("LREAL")
  expect(renderType(inferExpr(before, "VAR\n rs : REFERENCE TO S;\nEND_VAR", "rs.w"))).toBe("WORD")
})
