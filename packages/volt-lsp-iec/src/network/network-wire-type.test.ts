/**
 * A wire's type is the type its `VAR_TEMP` declaration names, exactly (consolidate-lsp-structure A11, carried to network
 * text v2). The wire's type used to be rebuilt from a bare type NAME, which dropped a string's declared length; a v2 wire
 * is declared with its full type, and the message a mismatch prints must keep it.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../frontend/syntax/index.js"
import { build } from "../frontend/symbols/index.js"
import { messagesFor } from "../analysis/index.js"
import { computeNetworkTextDiagnostics } from "./index.js"

const messages = (source: string): string[] => {
  const parseResult = parseSource(source, { networkText: true })
  const project = build.buildSymbolTable([{ uri: "F.fb", parseResult, source }])
  return computeNetworkTextDiagnostics({ uri: "F.fb", source, parseResult }, project, messagesFor("codesys")).map((d) => d.message)
}

test("a wire declared STRING(10) keeps the length a message prints", () => {
  const src = `FUNCTION_BLOCK F
VAR s10 : STRING(10); i : INT; END_VAR
IMPLEMENTATION FBD
NETWORK
VAR_TEMP g1 : STRING(10); END_VAR
g1 := s10;
i := g1;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(messages(src)).toContain("Cannot convert type 'STRING(10)' to type 'INT'")
})

/** A POU whose FBD body is one network of `lines`. */
const fbd = (vars: string, lines: string): string => `PROGRAM P
VAR ${vars} END_VAR
IMPLEMENTATION FBD
NETWORK
${lines}
END_NETWORK
END_PROGRAM`

test("a declaration the producer rule does not confirm is not the uses' type: the build types the consumer by the producer", () => {
  // The vendor's Demux holds no type, and on push the declaration is taken as written — so where the producer rule says
  // nothing (an FBD leaf feeding a data pin or a coil), a declaration that differs from what the producer yields is
  // accepted, and the IDE compiles `out := a`, clean. Typing the consumer by the declaration gave a compiler message no
  // build gives. The consumer is typed by the producer instead, as the compiler types it.
  expect(messages(fbd("a : BOOL; out : BOOL;", "VAR_TEMP g1 : INT; END_VAR\ng1 := a;\nout := g1;"))).toEqual([])
  expect(messages(fbd("i : INT; j : INT;", "VAR_TEMP g1 : STRING; END_VAR\ng1 := i;\nj := g1;"))).toEqual([])
  // …through a wire that forwards another, too.
  expect(messages(fbd("i : INT; j : INT;", "VAR_TEMP g1 : STRING; g2 : STRING; END_VAR\ng1 := i;\ng2 := g1;\nj := g2;"))).toEqual([])
  // A producer the build DOES type the consumer by is still checked: `j := s` is the build's own error.
  expect(messages(fbd("sx : STRING; j : INT;", "VAR_TEMP g1 : INT; END_VAR\ng1 := sx;\nj := g1;"))).toContain(
    "Cannot convert type 'STRING' to type 'INT'",
  )
})
