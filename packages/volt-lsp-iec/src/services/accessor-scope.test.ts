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
import { completion } from "./assist/completion.js"
import { scopeAtOffset } from "./shared/resolve-at.js"
import { lookup } from "../symbols/index.js"

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

// …AND SO DO THE TWO THAT READ IT THROUGH `scopeAtOffset`. The A5 fix landed for the three above and left that
// function a one-line delegate to `unitScopeAtOffset`, which resolves a unit and stops — so completion and
// semantic tokens kept answering with the UNIT scope. Found by a review of the change, not by these tests:
// completing inside the GET offered 31 items and `localGet` was not one of them.
test("completion inside a property getter offers the accessor's own locals", () => {
	const { doc, project } = setup(ACCESSOR)
	const at = ACCESSOR.indexOf("Prop := localGet;") + "Prop := local".length
	const labels = completion(doc, project, at).map((c) => c.label)
	expect(labels).toContain("localGet")
	expect(labels).toContain("helperGet")
	// the FB's own field is still visible — the accessor scope layers over the unit's, it does not replace it
	expect(labels).toContain("backing")
})

test("semantic tokens resolve an accessor local rather than falling to the unit scope", () => {
	const { doc, project } = setup(ACCESSOR)
	// `scopeAtOffset` is what semantic tokens ask; assert the scope directly, since the token TYPE for a local
	// and for a field can coincide and would not show the difference.
	const inside = scopeAtOffset(doc, project, ACCESSOR.indexOf("localGet := helperGet") + 2)
	expect(lookup(inside, "localGet")?.symbol.name).toBe("localGet")
	// outside any body, the unit scope is still the answer
	const outside = scopeAtOffset(doc, project, ACCESSOR.indexOf("backing : INT"))
	expect(lookup(outside, "localGet")).toBeUndefined()
})
