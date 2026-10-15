/**
 * A wire's type is the type its `VAR_TEMP` declaration names, exactly (consolidate-lsp-structure A11, carried to network
 * text v2). The wire's type used to be rebuilt from a bare type NAME, which dropped a string's declared length; a v2 wire
 * is declared with its full type, and the message a mismatch prints must keep it.
 */
import { expect, test } from "bun:test"
import { parseSource } from "../../../frontend/syntax/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { messagesFor } from "../../index.js"
import { computeNetworkTextDiagnostics } from "./network-analysis.js"

const messages = (source: string): string[] => {
  const parseResult = parseSource(source, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source }], [], "codesys")
  return computeNetworkTextDiagnostics({ uri: "F.pou", parseResult }, project, messagesFor("codesys")).map((d) => d.message)
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

// ─── openspec ld-fbd-coverage 1b.4: `fb(…).name` (S4) and the network shown as its `UNSUPPORTED "<shape>";` line ─────
// The bridge's `NetworkTextReader` reads both; the LSP parses them the same way (`frontend/syntax/network/shown.ts`),
// types `fb(…).name` as the instance's output (`fb.name`), and reports nothing inside an UNSUPPORTED network.

const parseNt = (source: string) => parseSource(source, { networkText: true }, "codesys")

/** A program whose FBD body is the given networks, each its lines. */
const nets = (vars: string, ...networks: string[]): string => `PROGRAM P
VAR ${vars} END_VAR
IMPLEMENTATION FBD
${networks.map((n) => `NETWORK\n${n}\nEND_NETWORK`).join("\n")}
END_PROGRAM`

/** The structural codes (`NETWORK_*`) the network text raised. */
const codes = (source: string): string[] => {
  const parseResult = parseNt(source)
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source }], [], "codesys")
  return computeNetworkTextDiagnostics({ uri: "F.pou", parseResult }, project, messagesFor("codesys"))
    .map((d) => d.code)
    .filter((c) => c.startsWith("NETWORK_"))
}

/** A user FB whose second output is the one read — the S4 shape (a main output that is not the first slot). */
const CAPTURE = `FUNCTION_BLOCK Capture
VAR_INPUT xEnable : BOOL; END_VAR
VAR_OUTPUT xBusy : BOOL; tElapsed : TIME; END_VAR
IMPLEMENTATION ST
xBusy := xEnable;
END_FUNCTION_BLOCK
`

const projectMessages = (source: string): string[] => {
  const parseResult = parseNt(source)
  const fb = parseNt(CAPTURE)
  const project = build.buildSymbolTable(
    [{ uri: "F.pou", parseResult, source }, { uri: "Capture.pou", parseResult: fb, source: CAPTURE }],
    [],
    "codesys",
  )
  return computeNetworkTextDiagnostics({ uri: "F.pou", parseResult }, project, messagesFor("codesys")).map((d) => d.message)
}

/** The value of `cap(…).name` is the instance's output `cap.name`: what consumes it is read as that member — an output the
 *  FB does not declare is reported as `cap.nope` is — while the box's own wire to a coil stays the IDE's, as
 *  `x := f(…).ENO` does (`assignmentPairs`). */
test("a box read through a named output is read as the instance's output where it is consumed", () => {
  const vars = "cap : Capture; go : BOOL; elapsed : TIME; i : INT;"
  const named = projectMessages(nets(vars, "i := (cap(xEnable := go).nope + i);"))
  expect(named).toContain("'nope' is no component of 'Capture'")
  expect(named).toEqual(projectMessages(nets(vars, "i := (cap.nope + i);")))
  expect(projectMessages(nets(vars, "i := (cap(xEnable := go).tElapsed + i);"))).toEqual(projectMessages(nets(vars, "i := (cap.tElapsed + i);")))
  expect(projectMessages(nets(vars, "elapsed := cap(xEnable := go).tElapsed;"))).toEqual([])
})

test("an UNSUPPORTED network is opaque: nothing reported inside it, its neighbours still checked", () => {
  const vars = "i : INT; flag : BOOL;"
  expect(messages(nets(vars, '  UNSUPPORTED "a flag on a box input pin";'))).toEqual([])
  expect(messages(nets(vars, '  UNSUPPORTED "a flag on a box input pin";', "  flag := i;"))).toContain(
    "Cannot convert type 'INT' to type 'BOOL'",
  )
})

test("the text's own refusals around the two spellings are the bridge reader's", () => {
  const vars = "t1 : TON; go : BOOL; elapsed : TIME; a : BOOL; b : BOOL; x : BOOL;"
  expect(codes(nets(vars, "elapsed := t1(IN := go).EN;"))).toEqual(["NETWORK_PARSE"])
  expect(codes(nets(vars, "t1(IN := go).ET;"))).toEqual(["NETWORK_BAD_EXPRESSION"])
  expect(codes(nets(vars, "x := AND(a, b).Q;"))).toEqual(["NETWORK_BAD_EXPRESSION"])
  expect(codes(nets(vars, "elapsed := t1(IN := go, => x).ET;"))).toEqual(["NETWORK_UNSUPPORTED"])
  expect(codes(nets(vars, 'x := a;\nUNSUPPORTED "a flag on a box input pin";'))).toEqual(["NETWORK_UNSUPPORTED"])
  expect(codes(nets(vars, 'UNSUPPORTED "a flag on a box input pin";\nx := a;'))).toEqual(["NETWORK_UNSUPPORTED"])
  expect(codes(nets(vars, "UNSUPPORTED a flag;"))).toEqual(["NETWORK_PARSE"])
  expect(codes(nets(vars, 'UNSUPPORTED "a flag on a box input pin";'))).toEqual([])
  expect(codes(nets(vars, "elapsed := t1(IN := go, PT := T#1S).ET;"))).toEqual([])
})
