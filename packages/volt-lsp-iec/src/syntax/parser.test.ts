import { test, expect } from "bun:test"
import { lex } from "./lexer.js"
import { parseSource } from "./parser.js"
import { parseStatements } from "./statements.js"
import type { ArrayType, BodySpan, FunctionBlock, Literal, NamedType, StringType, TypeDecl, VarDecl } from "./ast.js"

/** First VAR decl of the first unit — the common path into type-expr assertions. */
function firstDecl(src: string): VarDecl {
  const unit = parseSource(src).units[0] as FunctionBlock
  return unit.varSections[0].decls[0]
}

/** Materialize a statement list from a body snippet. */
function stmts(body: string) {
  const toks = lex(body).filter((t) => t.kind !== "eof")
  const span = { start: 0, end: body.length, startLine: 1, startCol: 0, endLine: 1, endCol: 0 }
  return parseStatements({ kind: "body", tokens: toks, span } satisfies BodySpan)
}

test("parses an FB with modifiers, EXTENDS, IMPLEMENTS, a method", () => {
  const r = parseSource(`
FUNCTION_BLOCK PUBLIC FB_X EXTENDS Base IMPLEMENTS IA, IB
VAR
  n : INT := 3;
END_VAR
METHOD PUBLIC Step : BOOL
  Step := TRUE;
END_METHOD
END_FUNCTION_BLOCK`)
  expect(r.errors).toEqual([])
  const fb = r.units[0] as FunctionBlock
  expect(fb.kind).toBe("function_block")
  expect(fb.accessModifier).toBe("PUBLIC")
  expect(fb.extends?.text).toBe("Base")
  expect(fb.implements?.map((i) => i.text)).toEqual(["IA", "IB"])
})

test("subrange is structured with valued bounds", () => {
  const t = firstDecl("FUNCTION_BLOCK F\nVAR\n x : INT(0..100);\nEND_VAR\nEND_FUNCTION_BLOCK").type as NamedType
  expect(t.kind).toBe("named_type")
  expect(t.name.text).toBe("INT")
  expect(t.subrange).toBeDefined()
  expect((t.subrange!.lo as Literal).value).toBe(0n)
  expect((t.subrange!.hi as Literal).value).toBe(100n)
})

test("FB-instance init constraint `FB()` is not mistaken for a subrange", () => {
  const t = firstDecl("FUNCTION_BLOCK F\nVAR\n a : ARRAY[1..3] OF CassetteFB();\nEND_VAR\nEND_FUNCTION_BLOCK")
    .type as ArrayType
  expect(t.kind).toBe("array_type")
  expect((t.element as NamedType).name.text).toBe("CassetteFB")
  expect((t.element as NamedType).subrange).toBeUndefined()
})

test("array dims are structured; ARRAY[*] is dynamic", () => {
  const t = firstDecl("FUNCTION_BLOCK F\nVAR\n a : ARRAY[0..9, 1..N] OF INT;\nEND_VAR\nEND_FUNCTION_BLOCK")
    .type as ArrayType
  expect(t.dims).toHaveLength(2)
  expect(t.dims[0]).toMatchObject({ dynamic: false })
  expect((t.dims[0].lower as Literal).value).toBe(0n)
  expect((t.dims[0].upper as Literal).value).toBe(9n)
  expect(t.dims[1].upper!.kind).toBe("ident_expr")

  const vla = firstDecl("FUNCTION_BLOCK F\nVAR\n a : ARRAY[*] OF INT;\nEND_VAR\nEND_FUNCTION_BLOCK").type as ArrayType
  expect(vla.dims[0].dynamic).toBe(true)
  expect(vla.dims[0].lower).toBeUndefined()
})

test("string length is a structured expression", () => {
  const t = firstDecl("FUNCTION_BLOCK F\nVAR\n s : STRING(80);\nEND_VAR\nEND_FUNCTION_BLOCK").type as StringType
  expect(t.kind).toBe("string_type")
  expect(t.wide).toBe(false)
  expect((t.length as Literal).value).toBe(80n)
})

test("scalar init is an Expr; aggregate init is opaque", () => {
  const scalar = firstDecl("FUNCTION_BLOCK F\nVAR\n n : INT := 1 + 2;\nEND_VAR\nEND_FUNCTION_BLOCK")
  expect(scalar.init?.kind).toBe("binary")

  const agg = firstDecl("FUNCTION_BLOCK F\nVAR\n p : Point := (x := 1, y := 2);\nEND_VAR\nEND_FUNCTION_BLOCK")
  expect(agg.init?.kind).toBe("aggregate_init")

  const arr = firstDecl("FUNCTION_BLOCK F\nVAR\n a : ARRAY[0..2] OF INT := [1, 2, 3];\nEND_VAR\nEND_FUNCTION_BLOCK")
  expect(arr.init?.kind).toBe("aggregate_init")
})

test("enum DUT values carry parsed value expressions", () => {
  const td = parseSource("TYPE E : (Red := 0, Green := 16#0A, Blue) DINT; END_TYPE").units[0] as TypeDecl
  expect(td.body.kind).toBe("enum")
  const enumBody = td.body as Extract<TypeDecl["body"], { kind: "enum" }>
  expect((enumBody.values[1].value as Literal).value).toBe(10n)
  expect(enumBody.values[2].value).toBeUndefined()
})

test("statement tree: assignment with valued literal", () => {
  const r = stmts("x := 16#FF;")
  expect(r.ok).toBe(true)
  const assign = r.statements[0] as { kind: string; value: Literal }
  expect(assign.kind).toBe("assign")
  expect(assign.value.value).toBe(255n)
})

test("statement tree: IF / CASE / FOR parse fully", () => {
  expect(stmts("IF a THEN b := 1; ELSIF c THEN b := 2; ELSE b := 3; END_IF").ok).toBe(true)
  expect(stmts("CASE x OF 1: y := 1; 2..4: y := 2; ELSE y := 0; END_CASE").ok).toBe(true)
  expect(stmts("FOR i := 0 TO 10 BY 2 DO s := s + i; END_FOR").ok).toBe(true)
})

test("error-tolerant: a malformed unit records an error, never throws", () => {
  const r = parseSource("FUNCTION_BLOCK")
  expect(r.errors.length).toBeGreaterThan(0)
})
