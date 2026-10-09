/** An expression's type (from `types.test.ts`, transpile-restructure 1.1.11). */
import { expect, test } from "bun:test"
import { bodyStatements, type Expr, type FunctionBlock, parseSource } from "../../syntax/index.js"
import { build, findChildScope } from "../../symbols/index.js"
import { inferExprType, renderType, type Type, UNKNOWN } from "../index.js"

function lastExpr(fb: FunctionBlock): Expr {
  const stmts = bodyStatements(fb.body).statements
  const last = stmts[stmts.length - 1] as { expr?: Expr; value?: Expr }
  return (last.expr ?? last.value) as Expr
}

function inferExpr(unitsBefore: string, varDecls: string, exprSrc: string): Type {
  const src = `${unitsBefore}\nFUNCTION_BLOCK F\n${varDecls}\nprobe := ${exprSrc};\nEND_FUNCTION_BLOCK`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }])
  const scope = findChildScope(project, "F")!
  return inferExprType(lastExpr(pr.units.at(-1) as FunctionBlock), scope, project)
}

const E_PLAIN = "TYPE E :\n(\n\tOff := 0,\n\tOn := 1\n);\nEND_TYPE"

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

// THIS is a POINTER TO the enclosing FB and SUPER one to its base; `^` reads the FB — each named by the POU's name
// upper-cased: "Cannot convert type 'POINTER TO FB_LANG_DT_THIS_TYPE' to type 'STRING'", "…'FB_LANG_DT_SUPER_TYPE_BASE'…"
// (rule DT7, `dt_this_type`, `dt_super_type`, CODESYS 2026-10-03). This said THIS was the FB itself.
test("infer: THIS and SUPER are pointers to the FB and its base, named upper-cased (dt_this_type, dt_super_type, DT7)", () => {
  const t = inferExpr("", "VAR\n flag : BOOL;\nEND_VAR", "THIS")
  expect(t).toMatchObject({ kind: "pointer", target: { kind: "function_block", name: "F" } })
  expect(renderType(t, { form: "compiler" })).toBe("POINTER TO F")
  const lower = (body: string): string => {
    const src = `FUNCTION_BLOCK Fb_base\nVAR\n v : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK Fb_derived EXTENDS Fb_base\nVAR\nEND_VAR\nprobe := ${body};\nEND_FUNCTION_BLOCK`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([{ uri: "F.pou", parseResult: pr, source: src }])
    return renderType(inferExprType(lastExpr(pr.units.at(-1) as FunctionBlock), findChildScope(project, "Fb_derived")!, project), { form: "compiler" })
  }
  expect(lower("THIS")).toBe("POINTER TO FB_DERIVED")
  expect(lower("THIS^")).toBe("FB_DERIVED")
  expect(lower("SUPER")).toBe("POINTER TO FB_BASE")
  expect(lower("SUPER^")).toBe("FB_BASE")
  // `THIS^.v` still reaches the inherited member
  expect(lower("THIS^.v")).toBe("INT")
})

// A NAME THAT DENOTES A DECLARATION, read as a value (rule DT8): a GVL's, a STRUCT type's, an INTERFACE's and an uncalled
// FUNCTION's name are static, a PROGRAM's and an FB type's the POU — each named upper-cased; inside its own body a
// FUNCTION's name is its result (`dt_static_base_*`, `dt_interface_static_base`, `dt_function_name_in_own_body`, CODESYS
// 2026-10-03). They were a "struct", UNKNOWN (the GVL) and the function's return type.
test("infer: a static base's name is the declaration, named upper-cased (dt_static_base_*, DT8)", () => {
  const units = `VAR_GLOBAL\n g : INT;\nEND_VAR\nTYPE Dut_s : STRUCT x : INT; END_STRUCT END_TYPE
INTERFACE I_x\nMETHOD M : INT\nEND_METHOD\nEND_INTERFACE
FUNCTION F_x : INT\nF_x := 1;\nEND_FUNCTION
PROGRAM Prg_x\nVAR\n x : INT;\nEND_VAR\nEND_PROGRAM
FUNCTION_BLOCK Fb_other\nEND_FUNCTION_BLOCK`
  const named = (what: string): string => renderType(inferExpr(units, "", what), { form: "compiler" })
  const src = `${units}\nFUNCTION_BLOCK F\nVAR\nEND_VAR\nprobe := 1;\nEND_FUNCTION_BLOCK`
  const project = build.buildSymbolTable([{ uri: "GVL_x.gvl", parseResult: parseSource("VAR_GLOBAL\n gg : INT;\nEND_VAR", { networkText: true }), source: "" }, { uri: "F.pou", parseResult: parseSource(src, { networkText: true }), source: src }])
  expect(renderType(inferExprType({ kind: "ident_expr", name: "GVL_x", span: { start: 0, end: 0 } } as Expr, findChildScope(project, "F")!, project), { form: "compiler" })).toBe("GVL_X")
  expect(inferExpr(units, "", "Dut_s")).toMatchObject({ kind: "static", denotes: "struct" })
  expect(named("Dut_s")).toBe("DUT_S")
  expect(inferExpr(units, "", "I_x")).toMatchObject({ kind: "static", denotes: "interface" })
  expect(named("I_x")).toBe("I_X")
  expect(inferExpr(units, "", "F_x")).toMatchObject({ kind: "static", denotes: "function" })
  expect(named("F_x")).toBe("F_X")
  expect(named("Prg_x")).toBe("PRG_X")
  expect(named("Fb_other")).toBe("FB_OTHER")
  // …a program's member is still reached through it
  expect(named("Prg_x.x")).toBe("INT")
})

test("infer: a FUNCTION's name inside its own body is its result (dt_function_name_in_own_body)", () => {
  const src = `FUNCTION F_x : INT\nVAR\n probe : STRING;\nEND_VAR\nprobe := F_x;\nEND_FUNCTION`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F_x.pou", parseResult: pr, source: src }])
  const stmts = bodyStatements((pr.units[0] as unknown as FunctionBlock).body).statements
  const value = (stmts.at(-1) as { value: Expr }).value
  expect(inferExprType(value, findChildScope(project, "F_x")!, project)).toMatchObject({ kind: "elementary", name: "INT" })
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
  // BOTH OF THESE SAID "not measured". They are now — `fixtures/operators/unary-operand.ts` asks every elementary type one at a
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

test("infer: an operation with an untyped literal operand (rules AR1/AR7; ar_int_literal_operand_types, ar_real_literal_operand_types)", () => {
  const decls = "si : SINT; i : INT; d : DINT; li : LINT; us : USINT; ui : UINT; bt : BYTE; w : WORD; rv : REAL; lr : LREAL;"
  const named = (expr: string): string => renderType(inferExpr("", `VAR\n ${decls}\nEND_VAR`, `tmp := ${expr}`), { form: "compiler" })
  // in range the literal takes its neighbour's integer (a bit string's is the unsigned one of its width)
  expect(named("i + 1")).toBe("INT")
  expect(named("1 + i")).toBe("INT")
  expect(named("si + 1")).toBe("SINT")
  expect(named("us - 1")).toBe("USINT")
  expect(named("bt + 1")).toBe("USINT")
  expect(named("w + 1")).toBe("UINT")
  expect(named("i + -1")).toBe("INT")
  expect(named("i MOD 2")).toBe("INT")
  // beyond it, the smallest integer of the neighbour's signedness that holds it
  expect(named("si + 200")).toBe("INT")
  expect(named("i + 70000")).toBe("DINT")
  expect(named("us + 300")).toBe("UINT")
  expect(named("ui + 70000")).toBe("UDINT")
  // bitwise: the unsigned integer of the width
  expect(named("bt AND 1")).toBe("USINT")
  expect(named("si AND 1")).toBe("USINT")
  // …and a literal only the unsigned integer of the width holds stays at the width, never widened to the next signed
  // integer (`cc_bitwise_sint_and_literal`: `sn AND 255` converts SINT → USINT; `ar_bitwise_literal_beyond_width`)
  expect(named("si AND 255")).toBe("USINT")
  expect(named("255 AND si")).toBe("USINT")
  expect(named("i AND 16#FF00")).toBe("UINT")
  expect(named("d OR 16#80000000")).toBe("UDINT")
  expect(named("si AND 300")).toBe("UINT") // beyond the width, the wider unsigned integer it computes at
  // …beside an unsigned or bit-string operand too, and a negative literal keeps the signed operand's type
  // (`ar_bitwise_literal_unsigned_or_negative`, both vendors)
  expect(named("us AND 300")).toBe("UINT")
  expect(named("300 OR us")).toBe("UINT")
  expect(named("bt AND 300")).toBe("UINT")
  expect(named("w AND 16#1FFFF")).toBe("UDINT")
  expect(named("si AND -1")).toBe("USINT")
  expect(named("-1 AND si")).toBe("USINT")
  expect(named("i XOR -1")).toBe("UINT")
  // beside a real, the real; a real literal is REAL beside a REAL, else LREAL
  expect(named("rv + 1")).toBe("REAL")
  expect(named("lr + 1")).toBe("LREAL")
  expect(named("rv + 1.5")).toBe("REAL")
  expect(named("1.5 + rv")).toBe("REAL")
  expect(named("lr + 1.5")).toBe("LREAL")
  expect(named("i + 1.5")).toBe("?") // named by its store: LREAL into a STRING, silent into a REAL
})

test("infer: the built-ins' result types (rules AR10, AR13/14, AR18, AR22–AR31; types/arithmetic-results.ts)", () => {
  const decls = "b : BYTE; w : WORD; si : SINT; i : INT; ui : UINT; li : LINT; rv : REAL; lr : LREAL; g : BOOL; k : INT; t : TIME; ltm : LTIME; d : DINT; arr : ARRAY[0..3] OF BYTE; a256 : ARRAY[1..256] OF BYTE; big : ARRAY[0..99999] OF BYTE; str : STRING;"
  const infer = (expr: string): Type => inferExpr("", `VAR\n ${decls}\nEND_VAR`, `tmp := ${expr}`)
  const named = (expr: string): string => renderType(infer(expr), { form: "compiler" })
  // AR10 — a shift or rotate is its operand's type, never promoted
  expect(named("SHL(si, k)")).toBe("SINT")
  expect(named("ROR(w, k)")).toBe("WORD")
  expect(named("SHR(li, k)")).toBe("LINT")
  expect(infer("SHL(1, k)")).toEqual(UNKNOWN) // an untyped literal operand has no type of its own
  // AR13/AR14 — the selection functions meet their VALUE arguments (not SEL's selector, not MUX's index)
  expect(named("LIMIT(i, ui, i)")).toBe("INT")
  expect(named("LIMIT(ui, i, ui)")).toBe("INT")
  expect(named("SEL(g, li, rv)")).toBe("REAL")
  expect(named("MUX(k, b, si)")).toBe("SINT")
  expect(named("MIN(b, b)")).toBe("USINT")
  expect(named("MAX(w, w)")).toBe("UINT")
  expect(infer("LIMIT(0, i, 100)")).toEqual(UNKNOWN)
  // AR22–AR31 — the fixed and argument-typed built-ins
  expect(named("ADR(i)")).toBe("POINTER TO INT")
  expect(named("ADR(arr)")).toBe("POINTER TO ARRAY [0..3] OF BYTE")
  expect(infer("ADR(5)")).toEqual(UNKNOWN)
  expect(named("SIZEOF(i)")).toBe("USINT")
  expect(named("SIZEOF(LINT)")).toBe("USINT")
  expect(named("SIZEOF(str)")).toBe("USINT")
  expect(named("SIZEOF(a256)")).toBe("UINT")
  expect(named("SIZEOF(big)")).toBe("UDINT")
  expect(named("BITADR(g)")).toBe("DWORD")
  expect(named("TRUNC(lr)")).toBe("DINT")
  expect(named("TRUNC_INT(rv)")).toBe("INT")
  expect(named("ABS(b)")).toBe("BYTE")
  expect(named("MOVE(t)")).toBe("TIME")
  expect(named("UPPER_BOUND(arr, 1)")).toBe("DINT")
  expect(named("TIME()")).toBe("TIME")
  expect(named("LTIME()")).toBe("LTIME")
  // AR18 — a duration scaled by an integer is the duration
  expect(named("t * i")).toBe("TIME")
  expect(named("i * t")).toBe("TIME")
  expect(named("t / d")).toBe("TIME")
  expect(named("ltm / i")).toBe("LTIME")
  // …an integer no wider than the duration, signed or not; a 64-bit one beside a TIME is the INTEGER, the TIME refused
  // into it (`ar_time_scaled_by_wide_or_unsigned_int_type`)
  expect(named("t * ui")).toBe("TIME")
  expect(named("t * si")).toBe("TIME")
  expect(named("t * li")).toBe("LINT")
  expect(named("li * t")).toBe("LINT")
  // …and a same-width UNSIGNED one keeps the duration (`ar_duration_scaled_by_same_width_unsigned_type`, both vendors)
  expect(inferExpr("", "VAR\n t : TIME; ud : UDINT;\nEND_VAR", "tmp := t * ud")).toMatchObject({ kind: "elementary", name: "TIME" })
  expect(inferExpr("", "VAR\n ltm : LTIME; ul : ULINT;\nEND_VAR", "tmp := ul * ltm")).toMatchObject({ kind: "elementary", name: "LTIME" })
  // a STRING whose declared length does not fold has no size — never the default capacity's (finding 4b)
  const sized = (decl: string): Type => inferExpr("", `VAR
 ${decl}
END_VAR`, "tmp := SIZEOF(s1)")
  expect(sized("s1 : STRING(Unknown_C);")).toEqual(UNKNOWN)
  expect(sized("s1 : STRING(GVL_missing.cLen);")).toEqual(UNKNOWN)
  expect(renderType(sized("s1 : STRING(300);"), { form: "compiler" })).toBe("UINT")
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

// a POINTER indexed is its target (rule M3): `p[2].x` over `p : POINTER TO S` reads the struct two elements on —
// `mem_pointer_index_struct_array` builds and runs `viaIndex` 30 on both vendors; the index read the pointer as no array
test("M3: an index of a POINTER is its target — `p[2].x` has the field's type", () => {
  const before = "TYPE S :\nSTRUCT\n\tx : INT;\nEND_STRUCT\nEND_TYPE\n\n"
  expect(renderType(inferExpr(before, "VAR\n p : POINTER TO S;\nEND_VAR", "p[2]"))).toBe("S")
  expect(renderType(inferExpr(before, "VAR\n p : POINTER TO S;\nEND_VAR", "p[2].x"))).toBe("INT")
})

// a dereferenced FB instance CALLED is the instance, as an array element called is (`SUPER^(…)`, `p^(…)`; rule M3)
test("M3: a dereferenced FB instance called has the FB's type", () => {
  const before = "FUNCTION_BLOCK B\nVAR_INPUT\n\tn : INT;\nEND_VAR\nEND_FUNCTION_BLOCK\n\n"
  expect(renderType(inferExpr(before, "VAR\n p : POINTER TO B;\nEND_VAR", "p^(n := 1)"))).toBe("B")
})

// `Ns.Enum.Member` — a referenced library's enum named through its namespace (rule EN6, `enum_library_namespace_qualified`:
// `Util.WEEKDAY.THURSDAY` builds and runs 4, CODESYS 2026-10-02): the type a namespace holds is a static base, as the bare
// `WEEKDAY` is, so the member is that enum's value
test("infer: a library enum's member through namespace and type is that enum's value", () => {
  const lib = "App/Library Manager/Util/WEEKDAY.dut"
  const libSrc = "TYPE WEEKDAY :\n(\n\tMONDAY := 1,\n\tTHURSDAY := 4\n);\nEND_TYPE"
  const src = "FUNCTION_BLOCK F\nVAR\n probe : INT;\nEND_VAR\nprobe := Util.WEEKDAY.THURSDAY;\nEND_FUNCTION_BLOCK"
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([
    { uri: lib, source: libSrc, parseResult: parseSource(libSrc, { networkText: true }) },
    { uri: "F.pou", parseResult: pr, source: src },
  ], [{ uri: "App/Library Manager/Util/Util.library", folder: "Util", dir: "App/Library Manager/Util/", namespace: "Util", library: "Util", dependencies: [], materialization: 4 }])
  const t = inferExprType(lastExpr(pr.units.at(-1) as FunctionBlock), findChildScope(project, "F")!, project)
  expect(renderType(t)).toBe("WEEKDAY")
})

// …and only an ENUM: the namespace step is EN6's, and no recording asks `Ns.Func` (no call) or `Ns.FB.x`. A FUNCTION a
// namespace holds is not an FB instance (a VOID one has no value at all), so neither gets a type from it
// (step 3.3 review: pro2193's `EdgePcLogging.GenerateProductionCountersPlcDataTypesConfig` was typed as an FB)
test("infer: a POU a namespace holds is no static base — `Ns.Func`, `Ns.FB.x` stay untyped", () => {
  const libFun = "FUNCTION F_Day : INT\nF_Day := 1;\nEND_FUNCTION"
  const libFb = "FUNCTION_BLOCK FB_T\nVAR\n x : INT;\nEND_VAR\nEND_FUNCTION_BLOCK"
  const typed = (rhs: string): string => {
    const src = `FUNCTION_BLOCK F\nVAR\n probe : INT;\nEND_VAR\nprobe := ${rhs};\nEND_FUNCTION_BLOCK`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([
      { uri: "App/Library Manager/Util/F_Void.pou", source: libFun, parseResult: parseSource(libFun, { networkText: true }) },
      { uri: "App/Library Manager/Util/FB_T.pou", source: libFb, parseResult: parseSource(libFb, { networkText: true }) },
      { uri: "F.pou", parseResult: pr, source: src },
    ], [{ uri: "App/Library Manager/Util/Util.library", folder: "Util", dir: "App/Library Manager/Util/", namespace: "Util", library: "Util", dependencies: [], materialization: 4 }])
    return inferExprType(lastExpr(pr.units.at(-1) as FunctionBlock), findChildScope(project, "F")!, project).kind
  }
  expect(typed("Util.F_Void")).toBe(UNKNOWN.kind)
  expect(typed("Util.FB_T.x")).toBe(UNKNOWN.kind)
})

// `Ns.Dep.X` — through a library's namespace to the namespace of a library it depends on (rule LB8, frontend-conformance
// 3.4.2: `DED.CommFB.IO_SYSTEM_TYPE.PROFINET_IO` builds and runs 2, `Util.Standard.LEN('abcd')` runs 4, CODESYS
// 2026-10-02): the dependency's namespace is a static base, as the bare one is — its enum's member is that enum's value,
// its FUNCTION's call that function's result
test("infer: a dependency's namespace through a library's namespace is a static base (`DED.CommFB.E.m`, `Util.Standard.F()`)", () => {
  const enumSrc = "TYPE IO_SYSTEM_TYPE :\n(\n\tPROFIBUS_DP := 1,\n\tPROFINET_IO := 2\n);\nEND_TYPE"
  const lenSrc = "FUNCTION LEN : INT\nVAR_INPUT\n\tSTR : STRING(255);\nEND_VAR\nEND_FUNCTION"
  const typed = (rhs: string): string => {
    const src = `FUNCTION_BLOCK F\nVAR\n probe : INT;\nEND_VAR\nprobe := ${rhs};\nEND_FUNCTION_BLOCK`
    const pr = parseSource(src, { networkText: true })
    const project = build.buildSymbolTable([
      { uri: "App/Library Manager/CommFB/IO_SYSTEM_TYPE.dut", source: enumSrc, parseResult: parseSource(enumSrc, { networkText: true }) },
      { uri: "App/Library Manager/Standard/LEN.pou", source: lenSrc, parseResult: parseSource(lenSrc, { networkText: true }) },
      { uri: "F.pou", parseResult: pr, source: src },
    ], [
      { uri: "App/Library Manager/CAA Device Diagnosis/CAA Device Diagnosis.library", folder: "CAA Device Diagnosis", dir: "App/Library Manager/CAA Device Diagnosis/", namespace: "DED", library: "CAA Device Diagnosis", dependencies: ["CommFB"], materialization: 4 },
      { uri: "App/Library Manager/CommFB/CommFB.library", folder: "CommFB", dir: "App/Library Manager/CommFB/", namespace: "CommFB", library: "CommFB", dependencies: [], materialization: 4 },
      { uri: "App/Library Manager/Util/Util.library", folder: "Util", dir: "App/Library Manager/Util/", namespace: "Util", library: "Util", dependencies: ["Standard"], materialization: 4 },
      { uri: "App/Library Manager/Standard/Standard.library", folder: "Standard", dir: "App/Library Manager/Standard/", namespace: "Standard", library: "Standard", dependencies: [], materialization: 4 },
    ])
    return renderType(inferExprType(lastExpr(pr.units.at(-1) as FunctionBlock), findChildScope(project, "F")!, project))
  }
  expect(typed("DED.CommFB.IO_SYSTEM_TYPE.PROFINET_IO")).toBe("IO_SYSTEM_TYPE")
  expect(typed("Util.Standard.LEN('abcd')")).toBe("INT")
})

test("infer: an enum operand of arithmetic computes in its base — INT without one (cv_enum_arithmetic_type, CODESYS 2026-10-03)", () => {
  const vars = "VAR\n e : E;\n d : DINT;\nEND_VAR"
  expect(inferExpr(E_PLAIN, vars, "e + INT#1")).toMatchObject({ kind: "elementary", name: "INT" })
  expect(inferExpr(E_PLAIN, vars, "e + 1")).toMatchObject({ kind: "elementary", name: "INT" })
  expect(inferExpr(E_PLAIN, vars, "e + e")).toMatchObject({ kind: "elementary", name: "INT" })
  expect(inferExpr(E_PLAIN, vars, "e * d")).toMatchObject({ kind: "elementary", name: "DINT" })
})

test("infer: POINTER ± integer is the pointer, pointer − pointer a DWORD; a reference reads as its target (dt_pointer_*, dt_reference_auto_deref_type)", () => {
  const vars = "VAR\n p : POINTER TO INT;\n q : POINTER TO INT;\n n : DINT;\n ri : REFERENCE TO INT;\n rr : REFERENCE TO REAL;\nEND_VAR"
  for (const e of ["p + 2", "p + n", "n + p", "q - 2"]) expect(renderType(inferExpr("", vars, e))).toBe("POINTER TO INT")
  expect(inferExpr("", vars, "q - p")).toMatchObject({ kind: "elementary", name: "DWORD" })
  // an untyped INTEGER literal counts as an integer; a REAL literal does not (only `p - <REAL variable>` was recorded)
  for (const e of ["p + 1.5", "1.5 + p", "q - 2.0"]) expect(renderType(inferExpr("", vars, e))).not.toBe("POINTER TO INT")
  expect(inferExpr("", vars, "ri")).toMatchObject({ kind: "reference" })
  expect(inferExpr("", vars, "ri + 1")).toMatchObject({ kind: "elementary", name: "INT" })
  expect(inferExpr("", vars, "ri * rr")).toMatchObject({ kind: "elementary", name: "REAL" })
})

test("infer: a FUNCTION called inside its own body has no result (cc2_call_recursion, Y20)", () => {
  const src = `FUNCTION F_x : INT\nVAR_INPUT\n d : INT;\nEND_VAR\nF_x := F_x(d := d - 1);\nEND_FUNCTION`
  const pr = parseSource(src, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F_x.pou", parseResult: pr, source: src }])
  const stmts = bodyStatements((pr.units[0] as unknown as FunctionBlock).body).statements
  expect(inferExprType((stmts.at(-1) as { value: Expr }).value, findChildScope(project, "F_x")!, project)).toEqual(UNKNOWN)
})
