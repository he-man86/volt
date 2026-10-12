/** Code actions (`code-actions.ts`): the 'wrap in TO_<type>' quick fix for an assignment type mismatch. */
import { expect, test } from "bun:test"
import { DiagnosticSeverity } from "vscode-languageserver-protocol"
import { parseSource } from "../../frontend/syntax/index.js"
import { codeActions } from "./code-actions.js"
import { computeDiagnostics, resolveConfig } from "../../analysis/index.js"
import { type Document, rangeFromSpan } from "../shared/index.js"
import { build } from "../../frontend/symbols/index.js"

function setup(src: string) {
  const parseResult = parseSource(src, { networkText: true }, "codesys")
  const doc: Document = { uri: "file:///F.pou", source: src, parseResult }
  const project = build.buildSymbolTable([{ uri: doc.uri, parseResult, source: src }], [], "codesys")
  return { doc, project }
}

test("code-actions: 'wrap in TO_<type>' quick fix for an assignment type mismatch", () => {
  const src = `FUNCTION_BLOCK F\nVAR\n\tb : BOOL;\n\ti : INT;\nEND_VAR\ni := b;\nEND_FUNCTION_BLOCK`
  const { doc, project } = setup(src)
  const diags = computeDiagnostics({
    uri: doc.uri,
    parseResult: doc.parseResult,
    source: src,
    project,
    config: resolveConfig({ vendor: "codesys" }),
  })
  const mismatch = diags.find((d) => d.code === "assignment-type-mismatch")
  expect(mismatch).toBeDefined()
  const lspDiag = {
    range: rangeFromSpan(mismatch!.span),
    code: "C0032", // the server surfaces the CODESYS Cnnnn; the client sends it back here
    message: mismatch!.message,
    severity: DiagnosticSeverity.Error,
  }
  const actions = codeActions(doc, project, [lspDiag])
  expect(actions).toHaveLength(1)
  expect(actions[0]?.title).toBe("Wrap in TO_INT(…)")
  expect(actions[0]?.edit?.changes?.[doc.uri]?.[0]?.newText).toBe("TO_INT(b)")
})
