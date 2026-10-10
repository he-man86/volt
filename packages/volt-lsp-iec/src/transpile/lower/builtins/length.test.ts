/**
 * `Standard.LEN_INTERNAL` as the IR builtin `length` (task 7.4.6) — only the library repo's, its argument a variable.
 */
import { expect, test } from "bun:test"
import { run } from "../../interp/index.js"
import { type IrNode, someNode } from "../../ir/walk.js"
import { lowerSource } from "../index.js"

const DECLARATION = "FUNCTION LEN_INTERNAL : UINT\nVAR_IN_OUT\n\tSTR : STRING(255);\nEND_VAR\n"
/** Standard's LEN_INTERNAL as the repo writes it, and as a project materializes it (no body). */
const WRITTEN = { uri: "file:///p/Library Manager/Standard/LEN_INTERNAL.pou", source: `${DECLARATION}WHILE STR[LEN_INTERNAL] <> 0 DO\n\tLEN_INTERNAL := LEN_INTERNAL + 1;\nEND_WHILE\nEND_FUNCTION\n` }
const BODYLESS = { uri: WRITTEN.uri, source: `${DECLARATION}END_FUNCTION\n` }

const program = (decls: string, body: string): string => `PROGRAM PLC_PRG\nVAR\n${decls}END_VAR\n${body}END_PROGRAM\n`
const builds = (nodes: readonly IrNode[], kind: "length" | "invoke"): boolean =>
  someNode(nodes, (n) => "kind" in n && (kind === "invoke" ? n.kind === "invoke" : n.kind === "builtin" && n.name === "length"))

test("the repo's LEN_INTERNAL is one `length` node — no routine, no walk — and counts the units before the first 0", () => {
  const { pou, diagnostics } = lowerSource(program("\ttxt : STRING(10) := 'hello';\n\tn : UINT;\n\tm : UINT;\n", "n := LEN_INTERNAL(txt);\ntxt[2] := 0;\nm := LEN_INTERNAL(STR := txt);\n"), "PLC_PRG", [WRITTEN])
  expect(diagnostics).toEqual([])
  expect(builds(pou!.body, "length")).toBe(true)
  expect(builds(pou!.body, "invoke")).toBe(false)
  const p = run(pou!)
  p.scan()
  expect([p.get("n"), p.get("m")]).toEqual([5n, 2n])
})

test("a Standard version the repo has not written stays refused, and a project FUNCTION of that name is its own", () => {
  expect(lowerSource(program("\ttxt : STRING;\n\tn : UINT;\n", "n := LEN_INTERNAL(txt);\n"), "PLC_PRG", [BODYLESS]).diagnostics.map((d) => d.code)).toEqual(["call-library"])
  const own = `FUNCTION LEN_INTERNAL : UINT\nVAR_IN_OUT\n\tSTR : STRING;\nEND_VAR\nLEN_INTERNAL := 7;\nEND_FUNCTION\n\n${program("\ttxt : STRING;\n\tn : UINT;\n", "n := LEN_INTERNAL(txt);\n")}`
  const { pou, diagnostics } = lowerSource(own, "PLC_PRG")
  expect(diagnostics).toEqual([])
  expect(builds(pou!.body, "invoke")).toBe(true)
})

test("given no variable it is refused as any in-out is; a STRING a UINT cannot count is `string-length-width`", () => {
  const codes = (decls: string, body: string) => lowerSource(program(decls, body), "PLC_PRG", [WRITTEN]).diagnostics.map((d) => d.code)
  expect(codes("\tn : UINT;\n", "n := LEN_INTERNAL('abc');\n")).toEqual(["place-shape"])
  expect(codes("\tlong : STRING(65535);\n\tn : UINT;\n", "n := LEN_INTERNAL(long);\n")).toEqual([])
  expect(codes("\ttoolong : STRING(65536);\n\tn : UINT;\n", "n := LEN_INTERNAL(toolong);\n")).toEqual(["string-length-width"])
  expect(codes("\tw : WSTRING;\n\tn : UINT;\n", "n := LEN_INTERNAL(w);\n")).toEqual(["call-inout-type"])
})
