/**
 * parse-errors — syntax errors now SHIP as diagnostics (previously discarded by design D3), from BOTH parser
 * streams: statement bodies AND declaration structure (unit headers, VAR sections, type decls). A malformed
 * statement or declaration is flagged at the offending token; valid code stays silent (the zero-FP contract the
 * corpus + conformance gates enforce). Grammar gaps the gate found (partial access, typed char literals) are
 * closed, so these valid CODESYS forms produce no diagnostic.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { computeDiagnostics, resolveConfig } from "../../index.js"
import { uriFor } from "../../../../test/support/test-uri.js"

const syntaxErrors = (src: string): string[] => {
  const parseResult = parseSource(src, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source: src }], [], "codesys")
  return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor: "codesys" }) })
    .filter((d) => d.code === "syntax-error")
    .map((d) => d.message)
}

test("a missing THEN is surfaced precisely (not swallowed, not a cascade)", () => {
  expect(syntaxErrors(`PROGRAM P\nVAR bTest : BOOL; x : INT;\nEND_VAR\nIF bTest\n  x := 9;\nEND_IF\nEND_PROGRAM`)).toEqual([
    "'THEN' expected instead of 'x'",
  ])
})

test("a missing FOR initializer is surfaced", () => {
  expect(syntaxErrors(`PROGRAM P\nVAR i : INT;\nEND_VAR\nFOR i TO 10 DO\n  ;\nEND_FOR\nEND_PROGRAM`).length).toBeGreaterThan(0)
})

test("valid ST produces NO syntax-error diagnostics (zero-FP contract)", () => {
  expect(syntaxErrors(`PROGRAM P\nVAR bTest : BOOL; x : INT;\nEND_VAR\nIF bTest THEN\n  x := 9;\nELSE\n  x := 0;\nEND_IF\nEND_PROGRAM`)).toEqual([])
  expect(syntaxErrors(`PROGRAM P\nVAR i : INT;\nEND_VAR\nCASE i OF\n  1: i := 2;\n  2, 3: i := 4;\nELSE\n  i := 0;\nEND_CASE\nEND_PROGRAM`)).toEqual([])
})

test("declaration-structure errors surface precisely (the parser's decl stream, not just statements)", () => {
  // A VAR-section keyword inside a STRUCT (C0173) — the section's placement, then the section echoed as the compiler
  // reads it back (`decl_var_input_inside_struct`, CODESYS 2026-10-01).
  expect(syntaxErrors(`TYPE T :\nSTRUCT\n VAR_INPUT\n  m : INT;\n END_VAR\nEND_STRUCT\nEND_TYPE`)).toEqual([
    "'VarInput' not allowed in this place",
    "Variable declaration expected instead of VAR_INPUT\r\n\tm:INT;\r\nEND_VAR\r\n",
  ])
  // …the echo's shape, one recording each (`decl_var_inside_struct`, `_init`, `_names`, `decl_var_inst_inside_struct`),
  // and each keyword's placement, worded per vendor (`decl_<kw>_inside_struct`, both vendors 2026-10-01)
  const inStruct = (section: string) => `TYPE T :\nSTRUCT\n${section}\nEND_STRUCT\nEND_TYPE`
  expect(syntaxErrors(inStruct("VAR\n a : INT := 5;\nEND_VAR"))).toEqual(["Variable declaration expected instead of VAR\r\n\ta:INT := 5;\r\nEND_VAR\r\n"])
  expect(syntaxErrors(inStruct("VAR\n a, c : BOOL;\nEND_VAR"))).toEqual(["Variable declaration expected instead of VAR\r\n\ta, c:BOOL;\r\nEND_VAR\r\n"])
  expect(syntaxErrors(inStruct("VAR_INST\n a : INT;\nEND_VAR"))).toEqual([
    "VAR_INST declaration not allowed in this place",
    "Variable declaration expected instead of \r\n\ta:INT;\r\nEND_VAR\r\n",
  ])
  expect(syntaxErrors(inStruct("VAR_OUTPUT\n a : INT;\nEND_VAR"))[0]).toBe("'VarOutput' not allowed in this place")
  expect(syntaxErrors(inStruct("VAR_IN_OUT\n a : INT;\nEND_VAR"))[0]).toBe("'VarInOut' not allowed in this place")
  expect(syntaxErrors(inStruct("VAR_GLOBAL\n a : INT;\nEND_VAR"))[0]).toBe("VAR_GLOBAL declaration only allowed in global variable list")
  expect(syntaxErrors(inStruct("VAR_CONFIG\n a : INT;\nEND_VAR"))[0]).toBe("VAR_CONFIG declaration only allowed in VAR_CONFIG  list")
  expect(syntaxErrors(inStruct("VAR_EXTERNAL\n a : INT;\nEND_VAR"))).toEqual(["Variable declaration expected instead of VAR_EXTERNAL\r\n\ta:INT;\r\nEND_VAR\r\n"])
  // A type's name where a variable's belongs — a declaration-structure error surfaced from the decl stream: both vendors
  // refuse an elementary type name as a name (`cc4_type_name_*`, rule R6), which the parser says since frontend-conformance 2.8.3.
  expect(syntaxErrors(`PROGRAM P\nVAR\n INT\nEND_VAR\nEND_PROGRAM`)).toContain("Unexpected token 'INT' found")
})

test("valid declarations produce NO syntax-error diagnostics (decl zero-FP contract)", () => {
  expect(syntaxErrors(`TYPE T :\nSTRUCT\n  m : INT;\n  n : REAL;\nEND_STRUCT\nEND_TYPE`)).toEqual([])
  expect(syntaxErrors(`FUNCTION_BLOCK FB\nVAR_INPUT\n  a : INT;\nEND_VAR\nVAR\n  b : BOOL := TRUE;\nEND_VAR\nEND_FUNCTION_BLOCK`)).toEqual([])
})

test("grammar-completion forms surface no false positive (gate regression guard)", () => {
  // partial variable access + typed char literal — valid CODESYS ST the gate caught our parser rejecting.
  expect(syntaxErrors(`FUNCTION_BLOCK FB\nVAR dw : DWORD; w : WORD; b : BYTE;\nEND_VAR\nw := dw.%W1;\nb := dw.%B3;\nEND_FUNCTION_BLOCK`)).toEqual([])
  expect(syntaxErrors(`FUNCTION_BLOCK FB\nVAR b : BYTE;\nEND_VAR\nb := UCHAR#'A';\nEND_FUNCTION_BLOCK`)).toEqual([])
})

// `pwh_gvl_missing_semicolon` (both vendors, 2026-09-30): a GLOBAL missing its `;` after the type. TwinCAT reports it as
// it reports the slip in a STRUCT or a POU's VAR block — "';, :=, REF=, ( or [' expected instead of '<next>'"; CODESYS
// reports NOTHING for it in a GVL (only the swallowed global is undefined where it is used). Both swallow the next one.
test("a global missing its `;`: TwinCAT names it, CODESYS says nothing — and neither declares the next global", () => {
  const src = "VAR_GLOBAL\n\tg_a : INT\n\tg_b : INT;\n\tg_c : INT;\nEND_VAR\n"
  const errors = (vendor: "codesys" | "twincat"): string[] => {
    const parseResult = parseSource(src, { networkText: true }, vendor, "gvl")
    const project = build.buildSymbolTable([{ uri: "GVL.gvl", parseResult, source: src }], [], vendor)
    return computeDiagnostics({ uri: uriFor(parseResult), parseResult, source: src, project, config: resolveConfig({ vendor }) })
      .filter((d) => d.code === "syntax-error")
      .map((d) => d.message)
  }
  expect(errors("twincat")).toEqual(["';, :=, REF=, ( or [' expected instead of 'g_b'"])
  expect(errors("codesys")).toEqual([])
  const list = parseSource(src, { networkText: true }, "codesys", "gvl").units[0] as { varSections: { decls: { names: { text: string }[] }[] }[] }
  expect(list.varSections[0].decls.map((d) => d.names[0].text)).toEqual(["g_a", "g_c"])
  // …and in a STRUCT on CODESYS the same slip IS reported (`pwh_struct_missing_semicolon`) — the silence is the GVL's
  expect(syntaxErrors("TYPE T :\nSTRUCT\n\ta : INT\n\tb : INT;\nEND_STRUCT\nEND_TYPE\n")).toEqual([
    "';, :=, REF=, ( or [' expected instead of 'b'",
  ])
})

/**
 * A NAME IN ANY SCRIPT IS AN IDENTIFIER (openspec `codesys-existing-unicode-members` 3.1). PLC Assist chat be8c6faa: a
 * Chinese CODESYS project whose DUTs and FBs CODESYS builds clean got `Identifier expected instead of '点'` (2 errors in
 * one DUT, 10 in `电机控制.pou`). These are `test/fixtures/CodesysUnicodeMembers.3.5.21.40.project`'s objects, which
 * CODESYS 3.5.21.40 builds with 0 messages ("Unicode identifiers" on, DIALECT C28b), as `volt pull` writes them.
 */
test("a Chinese project's DUT, FB with CJK methods and their caller produce no diagnostics", () => {
  const files: Record<string, string> = {
    "点位绑定信息.dut": "TYPE 点位绑定信息 :\nSTRUCT\n\t点位地址 : INT;\n\t已绑定 : BOOL;\nEND_STRUCT\nEND_TYPE\n",
    "命令队列管理.pou":
      "FUNCTION_BLOCK 命令队列管理\nVAR\n\t计数 : INT;\n\tbinding : 点位绑定信息;\nEND_VAR\n\nIMPLEMENTATION ST\n计数 := 计数 + 1;\n\n\nEND_FUNCTION_BLOCK\n\n" +
      "METHOD 从Modbus读取命令 : BOOL\nVAR_INPUT\n\taddress : INT;\nEND_VAR\n\nIMPLEMENTATION ST\nbinding.点位地址 := address;\n从Modbus读取命令 := TRUE;\n\nEND_METHOD\n\n" +
      "METHOD 区域可占用 : BOOL\n\nIMPLEMENTATION ST\n区域可占用 := NOT binding.已绑定;\n\nEND_METHOD\n",
    "VltUni_Caller.pou":
      "PROGRAM VltUni_Caller\nVAR\n\tfb : 命令队列管理;\n\tfree : BOOL;\n\tread : BOOL;\nEND_VAR\n\nIMPLEMENTATION ST\n" +
      "fb();\nfree := fb.区域可占用();\nread := fb.从Modbus读取命令(address := 3);\n\nEND_PROGRAM\n",
  }
  const parsed = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }, "codesys") }))
  const project = build.buildSymbolTable(parsed, [], "codesys")
  const found = parsed.flatMap(({ source, parseResult }) =>
    computeDiagnostics({ uri: uriFor(parseResult), parseResult, source, project, config: resolveConfig({ vendor: "codesys" }) }).map(
      (d) => `${d.code}: ${d.message}`,
    ),
  )
  expect(found).toEqual([])
})
