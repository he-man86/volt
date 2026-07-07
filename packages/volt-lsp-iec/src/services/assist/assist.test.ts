import { test, expect } from "bun:test"
import { parseSource } from "../../syntax/index.js"
import { buildSymbolTable } from "../../symbols/index.js"
import type { Document } from "../shared/index.js"
import { hover } from "./hover.js"
import { signatureHelp } from "./signature-help.js"
import { inlayHints } from "./inlay-hints.js"
import { codeLenses } from "./code-lens.js"
import { codeActions } from "./code-actions.js"
import { computeSemanticDiagnostics, resolveConfig } from "../../analysis/index.js"
import { rangeFromSpan } from "../shared/index.js"

function setup(src: string) {
  const parseResult = parseSource(src)
  const doc: Document = { uri: "file:///F.fb", source: src, parseResult }
  const project = buildSymbolTable([{ uri: doc.uri, parseResult, source: src }])
  return { doc, project }
}

// `Compute` (not `Add` — ADD is a reserved IEC operator keyword).
const SRC = `FUNCTION_BLOCK Lib
END_FUNCTION_BLOCK
METHOD Compute : INT
VAR_INPUT
	a : INT;
	b : INT;
END_VAR
END_METHOD
FUNCTION_BLOCK F
VAR
	lib : Lib;
	r : INT;
END_VAR
r := lib.Compute(1, 2);
END_FUNCTION_BLOCK`

test("hover: a variable shows its reconstructed declaration + kind label", () => {
  const { doc, project } = setup(SRC)
  const h = hover(doc, project, SRC.indexOf("r : INT") )
  const value = (h?.contents as { value: string }).value
  expect(value).toContain("r : INT")
  expect(value).toContain("_variable_")
})

test("hover: a named unit shows its declaring keyword", () => {
  const { doc, project } = setup(SRC)
  const h = hover(doc, project, SRC.indexOf("FUNCTION_BLOCK Lib") + "FUNCTION_BLOCK ".length)
  expect((h?.contents as { value: string }).value).toContain("FUNCTION_BLOCK Lib")
})

test("hover: a built-in type falls back to the reference catalog", () => {
  const { doc, project } = setup(SRC)
  const h = hover(doc, project, SRC.indexOf("r : INT") + "r : ".length)
  expect(h).toBeDefined()
  expect((h?.contents as { value: string }).value).toMatch(/INT/)
})

test("hover: whitespace / unknown token yields nothing", () => {
  const { doc, project } = setup(SRC)
  expect(hover(doc, project, SRC.indexOf("VAR\n") - 1)).toBeUndefined()
})

test("signature-help: shows the callee signature + active parameter", () => {
  const { doc, project } = setup(SRC)
  const atFirst = SRC.indexOf("Compute(1") + "Compute(".length // on the `1`
  const help = signatureHelp(doc, project, atFirst)
  expect(help?.signatures[0]?.label).toBe("Compute(a : INT, b : INT)")
  expect(help?.signatures[0]?.parameters).toHaveLength(2)
  expect(help?.activeParameter).toBe(0)
  const atSecond = SRC.indexOf(", 2") + 2 // on the `2`
  expect(signatureHelp(doc, project, atSecond)?.activeParameter).toBe(1)
})

test("inlay-hints: parameter-name hints before positional call args", () => {
  const { doc, project } = setup(SRC)
  const hints = inlayHints(doc, project, 0, SRC.length)
  expect(hints.map((h) => h.label)).toEqual(["a:", "b:"])
})

test("code-lens: a reference count above each named declaration", () => {
  const { doc, project } = setup(SRC)
  const lenses = codeLenses([doc], project, doc)
  // Compute is called once (`lib.Compute(...)`) → 1 body reference.
  const compute = lenses.find((l) => l.range.start.line === 2)
  expect(compute?.command?.title).toBe("1 reference")
  // A type-only symbol (Lib, used solely as a declaration type) has 0 body references.
  expect(lenses.find((l) => l.range.start.line === 0)?.command?.title).toBe("0 references")
  expect(lenses.every((l) => /^\d+ references?$/.test(l.command?.title ?? ""))).toBe(true)
})

test("code-actions: 'wrap in TO_<type>' quick fix for an assignment type mismatch", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n\tb : BOOL;\n\ti : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`
  const { doc, project } = setup(src)
  const diags = computeSemanticDiagnostics({
    parseResult: doc.parseResult,
    source: src,
    project,
    config: resolveConfig({ vendor: "codesys" }),
  })
  const mismatch = diags.find((d) => d.code === "assignment-type-mismatch")
  expect(mismatch).toBeDefined()
  const lspDiag = {
    range: rangeFromSpan(mismatch!.span),
    code: mismatch!.code,
    message: mismatch!.message,
    severity: 1,
  }
  const actions = codeActions(doc, project, [lspDiag])
  expect(actions).toHaveLength(1)
  expect(actions[0]?.title).toBe("Wrap in TO_INT(…)")
  expect(actions[0]?.edit?.changes?.[doc.uri]?.[0]?.newText).toBe("TO_INT(b)")
})
