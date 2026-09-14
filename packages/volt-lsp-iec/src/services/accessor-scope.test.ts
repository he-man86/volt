/**
 * Cursor features inside a property ACCESSOR body resolve against the accessor's own scope (consolidate-lsp-structure A5),
 * and inlay hints read a callee's parameters the way every other feature does (A6).
 *
 * Why these were broken: `symbols/bodies` pairs a GET/SET body with its own child scope, but go-to-definition,
 * signature help and inlay hints each re-walked the bodies with the UNIT scope — so a local declared inside the accessor
 * resolved nowhere. Inlay hints also rebuilt the parameter list from the callee's AST instead of `resolveCallee`, which
 * a function-block INSTANCE (and its inherited inputs) does not have.
 */
import { expect, test } from "bun:test"
import { type Document, parseSource } from "../syntax/index.js"
import { buildSymbolTable } from "../symbols/index.js"
import { resolveAt } from "./shared/resolve-at.js"
import { signatureHelp } from "./assist/signature-help.js"
import { inlayHints } from "./assist/inlay-hints.js"

function setup(src: string) {
  const parseResult = parseSource(src)
  const doc: Document = { uri: "file:///F.fb", source: src, parseResult }
  const project = buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
  return { doc, project }
}

const ACCESSOR = `FUNCTION_BLOCK Helper
END_FUNCTION_BLOCK
METHOD Run : INT
VAR_INPUT
	x : INT;
END_VAR
END_METHOD
FUNCTION_BLOCK F
VAR
	backing : INT;
END_VAR
END_FUNCTION_BLOCK
PROPERTY Prop : INT
GET
VAR
	localGet : INT;
	helperGet : Helper;
END_VAR
localGet := helperGet.Run(5);
Prop := localGet;
END_GET
END_PROPERTY`

test("go-to-definition finds a local declared inside a property getter", () => {
  const { doc, project } = setup(ACCESSOR)
  const sym = resolveAt(doc, project, ACCESSOR.indexOf("localGet := helperGet") + 2)
  expect(sym?.name).toBe("localGet")
})

test("signature help works on a getter-local instance's method", () => {
  const { doc, project } = setup(ACCESSOR)
  const help = signatureHelp(doc, project, ACCESSOR.indexOf("Run(5") + "Run(".length)
  expect(help?.signatures[0]?.label).toBe("Run(x : INT)")
})

test("inlay hints name the parameter of a getter-local instance's method", () => {
  const { doc, project } = setup(ACCESSOR)
  expect(inlayHints(doc, project, 0, ACCESSOR.length).map((h) => h.label)).toEqual(["x:"])
})

test("inlay hints on a function-block instance call, inherited inputs first", () => {
  const src = `FUNCTION_BLOCK Base
VAR_INPUT
	first : INT;
END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK Derived EXTENDS Base
VAR_INPUT
	second : INT;
END_VAR
END_FUNCTION_BLOCK
PROGRAM P
VAR
	inst : Derived;
END_VAR
inst(1, 2);
END_PROGRAM`
  const { doc, project } = setup(src)
  expect(inlayHints(doc, project, 0, src.length).map((h) => h.label)).toEqual(["first:", "second:"])
})
