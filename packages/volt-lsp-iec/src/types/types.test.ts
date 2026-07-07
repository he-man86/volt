import { test, expect } from "bun:test"
import { parseSource, parseStatements, type Expr, type FunctionBlock, type TypeExpr } from "../syntax/index.js"
import { buildSymbolTable, findChildScope, type Scope } from "../symbols/index.js"
import {
  constEval,
  ELEMENTARY_TYPES,
  elementaryType,
  inferExprType,
  isAssignable,
  isIntegerType,
  isIsolated,
  isKnown,
  isNarrowing,
  classifyConversion,
  isNumericType,
  numericRank,
  renderType,
  renderTypeExpr,
  resolveNamedType,
  resolveTypeExpr,
  UNKNOWN,
  type Type,
} from "./index.js"

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
  return buildSymbolTable([{ uri: "F.fb", parseResult: parseSource(src), source: src }])
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

function evalConst(varDecls: string, exprSrc: string) {
  const src = `FUNCTION_BLOCK F\n${varDecls}\n${exprSrc};\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult: pr, source: src }])
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

test("const-eval: unary, MOD/**, comparisons, and real arithmetic", () => {
  // unary
  expect(evalConst("", "-(2 + 3)")).toBe(-5n)
  expect(evalConst("", "NOT (5 > 3)")).toBe(false)
  expect(evalConst("", "+(4)")).toBe(4n)
  // integer MOD / power (+ their undefined cases)
  expect(evalConst("", "10 MOD 3")).toBe(1n)
  expect(evalConst("", "2 ** 8")).toBe(256n)
  expect(evalConst("", "10 MOD 0")).toBeUndefined()
  expect(evalConst("", "2 ** -1")).toBeUndefined()
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
  const stmts = parseStatements(fb.body).statements
  const last = stmts[stmts.length - 1] as { expr?: Expr; value?: Expr }
  return (last.expr ?? last.value) as Expr
}

function inferExpr(unitsBefore: string, varDecls: string, exprSrc: string): Type {
  const src = `${unitsBefore}\nFUNCTION_BLOCK F\n${varDecls}\n${exprSrc};\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult: pr, source: src }])
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

test("infer: THIS resolves to the enclosing FB member scope", () => {
  const t = inferExpr("", "VAR\n flag : BOOL;\nEND_VAR", "THIS")
  expect(t.kind).toBe("function_block")
})

// ─── C.6 conservative-skip: an unresolved sub-part makes the whole type not-known ───

test("isKnown: an unknown sub-part collapses the whole type", () => {
  expect(isKnown({ kind: "array", element: UNKNOWN, dims: [] })).toBe(false)
  expect(isKnown({ kind: "pointer", target: UNKNOWN })).toBe(false)
  const intT = resolveNamedType("INT", proj(""))
  expect(isKnown(intT)).toBe(true)
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

test("isNarrowing: an implicit LOSSY narrowing (a warning, not an error)", () => {
  const p = proj("")
  const T = (n: string) => resolveNamedType(n, p)
  // isNarrowing = classifyConversion === "narrow" — only the implicit lossy narrowings the compiler WARNS on.
  expect(isNarrowing(T("REAL"), T("LREAL"))).toBe(true) // LREAL→REAL: possible loss (implicit, warns)
  expect(isNarrowing(T("INT"), T("DINT"))).toBe(false) // DINT→INT is NOT implicit — it's an ERROR (needs X_TO_Y)
  expect(isNarrowing(T("DINT"), T("INT"))).toBe(false) // INT→DINT widens
  expect(isNarrowing(T("INT"), UNKNOWN)).toBe(false) // conservative skip
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
  expect(classifyConversion(T("INT"), T("DINT"))).toBe("incompatible") // integer narrowing → error
  expect(classifyConversion(T("INT"), T("REAL"))).toBe("incompatible") // real → int needs explicit
  expect(classifyConversion(T("BOOL"), T("INT"))).toBe("incompatible") // BOOL isolated
  expect(classifyConversion(T("INT"), UNKNOWN)).toBe("identity") // conservative skip
})

// ─── C.5 render ───

function declType(src: string): TypeExpr {
  const fb = parseSource(`FUNCTION_BLOCK F\nVAR\n ${src}\nEND_VAR\nEND_FUNCTION_BLOCK`).units[0] as FunctionBlock
  return fb.varSections[0].decls[0].type
}

test("renderType / renderTypeExpr", () => {
  const p = proj("")
  expect(renderType(resolveNamedType("INT", p))).toBe("INT")
  expect(renderType(resolveTypeExpr(declType("a : ARRAY[0..9] OF INT;"), p))).toBe("ARRAY[0..9] OF INT")
  expect(renderType(resolveTypeExpr(declType("q : POINTER TO REAL;"), p))).toBe("POINTER TO REAL")
  expect(renderTypeExpr(declType("s : STRING(80);"))).toBe("STRING(80)")
  expect(renderTypeExpr(declType("x : INT(0..100);"))).toBe("INT(0..100)")
  expect(renderTypeExpr(declType("p : POINTER TO INT;"))).toBe("POINTER TO INT")
})
