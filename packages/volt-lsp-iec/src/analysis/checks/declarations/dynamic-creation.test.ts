/**
 * dynamic-creation — `__NEW` of an FB/struct needs `{attribute 'enable_dynamic_creation'}`. Measured on CODESYS
 * SP21 with the pragma as the only variable (conformance `newdel_without_pragma` / `newdel_with_pragma`, plus
 * `newdel_with_pragma_has_method`, `newdel_in_method_with_pragma`, `newdel_elementary`); TwinCAT unmeasured.
 */
import { test, expect } from "bun:test"
import { parseSource } from "../../../syntax/index.js"
import { buildSymbolTable } from "../../../symbols/index.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../index.js"
import type { Vendor } from "../../config.js"

const PRAGMA = "A function block or structure needs the pragma '{attribute 'enable_dynamic_creation'}' to be created with __NEW"

function diagnose(src: string, vendor: Vendor = "codesys") {
  const parseResult = parseSource(src)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source: src }])
  return computeSemanticDiagnostics({ parseResult, source: src, project, config: resolveConfig({ vendor }) })
    .filter((d) => d.code === "dynamic-creation-pragma")
    .map((d) => d.message)
}
const fb = (pragma: string, body: string, tail = "") =>
  `${pragma}FUNCTION_BLOCK FB_A\nVAR\n\tp : POINTER TO FB_A;\n\tq : POINTER TO INT;\nEND_VAR\n${body}\nEND_FUNCTION_BLOCK\n${tail}`

test("the pragma is the only thing that decides it", () => {
  expect(diagnose(fb("", "p := __NEW(FB_A);"))).toEqual([PRAGMA])
  expect(diagnose(fb("{attribute 'enable_dynamic_creation'}\n", "p := __NEW(FB_A);"))).toEqual([])
})

test("the things that looked like variables and are not", () => {
  // an FB that also has a METHOD, and a `__NEW` written INSIDE one, are both clean when the pragma is there
  const withMethod = (pragma: string) => fb(pragma, "p := __NEW(FB_A);", "\nMETHOD Touch\np := p;\nEND_METHOD\n")
  expect(diagnose(withMethod("{attribute 'enable_dynamic_creation'}\n"))).toEqual([])
  expect(diagnose(fb("{attribute 'enable_dynamic_creation'}\n", "", "\nMETHOD Alloc\np := __NEW(FB_A);\nEND_METHOD\n"))).toEqual([])
  // an ELEMENTARY type carries no pragma and needs none
  expect(diagnose(fb("", "q := __NEW(INT);"))).toEqual([])
})

test("a type declared in ANOTHER file is unchecked, and TwinCAT is unmeasured", () => {
  expect(diagnose("PROGRAM PLC_PRG\nVAR\n\tp : POINTER TO FB_Elsewhere;\nEND_VAR\np := __NEW(FB_Elsewhere);\nEND_PROGRAM\n")).toEqual([])
  expect(diagnose(fb("", "p := __NEW(FB_A);"), "twincat")).toEqual([])
})
