/**
 * The missing-language finding (`missing-language.ts`): which bodies state no language, what each is called (as the push
 * names it), where the one finding stands, and its hint — a lookalike line, else an older Volt's comment. Its composition
 * (not dead-gated, appended after the quiet) is `pipeline/document.test.ts`'s.
 */
import { expect, test } from "bun:test"
import { parseDocument } from "../../../frontend/syntax/index.js"
import { missingLanguage, unstatedBodies } from "./missing-language.js"

const parse = (source: string) => parseDocument("file:///F.pou", source, { networkText: true }, "codesys").units

test("a body with no IMPLEMENTATION line is unstated; one with it is not", () => {
  const units = parse(
    "FUNCTION_BLOCK F\nVAR\n\ti : INT;\nEND_VAR\ni := 1;\nEND_FUNCTION_BLOCK\n" +
      "METHOD M\nIMPLEMENTATION ST\ni := 2;\nEND_METHOD\n",
  )
  expect(unstatedBodies(units).map((u) => u.what)).toEqual(["F"])
})

test("a property's accessors are named by their role", () => {
  const units = parse(
    "FUNCTION_BLOCK F\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK\nPROPERTY P : INT\nGET\nVAR\nEND_VAR\nP := 1;\nEND_GET\nEND_PROPERTY\n",
  )
  expect(unstatedBodies(units).map((u) => u.what)).toEqual(["P's getter"])
})

test("the finding stands on the body's first line of code, an error with the slug and no hint but the re-pull", () => {
  const [body] = unstatedBodies(parse("FUNCTION_BLOCK F\nVAR\n\ti : INT;\nEND_VAR\ni := 1;\nEND_FUNCTION_BLOCK\n"))
  const finding = missingLanguage(body!)
  expect({ code: finding.code, severity: finding.severity, line: finding.span.startLine }).toEqual({
    code: "missing-language",
    severity: "error",
    line: 5,
  })
  expect(finding.message).toStartWith("'F' states no language: its body opens with no 'IMPLEMENTATION <ST|LD|FBD>' line")
  expect(finding.message).toEndWith("Run `volt pull` once to rewrite the workspace in the current format.")
})

test("an older Volt's comment in the body is named as the hint", () => {
  const source = "FUNCTION_BLOCK F\nVAR a : BOOL;\nEND_VAR\n(* @volt-implementation LD *)\nNETWORK\n  a := TRUE;\nEND_NETWORK\nEND_FUNCTION_BLOCK\n"
  const [body] = unstatedBodies(parse(source))
  expect(missingLanguage(body!).message).toContain("It holds '(* @volt-implementation LD *)'")
})
