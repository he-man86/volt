/**
 * A `LET` wire's type is the type its producer has, exactly (consolidate-lsp-structure A11). The wire's type used to be
 * rebuilt from a bare type NAME, which dropped a string's declared length and gave array/pointer wires no type.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable } from "../symbols/index.js"
import { messagesFor } from "../analysis/index.js"
import { computeNetworkTextDiagnostics } from "./index.js"

const messages = (source: string): string[] => {
  const parseResult = parseSource(source)
  const project = buildSymbolTable([{ uri: "F.fb", parseResult, source }])
  return computeNetworkTextDiagnostics({ uri: "F.fb", source, parseResult }, project, messagesFor("codesys")).map((d) => d.message)
}

test("a wire from a STRING(10) keeps the length a message prints", () => {
  const src = `FUNCTION_BLOCK F
VAR s10 : STRING(10); i : INT; END_VAR
NETWORK 1 FBD
LET w := s10;
i := w;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(messages(src)).toContain("Cannot convert type 'STRING(10)' to type 'INT'")
})
