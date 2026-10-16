/**
 * The network-text pass (`computeNetworkTextDiagnostics`): the reader's structural findings lifted into the server's
 * items beside the checks' (each check family's own cases are its `_<family>.test.ts`), what the push refuses and what
 * it writes for the build to answer, and the types a split's feeder gives its uses (B6: the split itself has none).
 */
import { expect, test } from "bun:test"
import { isGraphicalBody, parseSource, STRUCTURE_ONLY, unitBodies } from "../../../frontend/syntax/index.js"
import { parseNetworkText } from "../../../frontend/types/index.js"
import { build } from "../../../frontend/symbols/index.js"
import { messagesFor } from "../../index.js"
import { computeNetworkTextDiagnostics } from "./network-analysis.js"
import { projectDiags, vgBody, vgDiags } from "../../../../test/support/network-docs.js"

const messages = (source: string): string[] => {
  const parseResult = parseSource(source, { networkText: true }, "codesys")
  const project = build.buildSymbolTable([{ uri: "F.pou", parseResult, source }], [], "codesys")
  return computeNetworkTextDiagnostics({ uri: "F.pou", parseResult }, project, messagesFor("codesys")).map((d) => d.message)
}

test("a split carries its feeder's type, a string's declared length included", () => {
  const src = `FUNCTION_BLOCK F
VAR s10 : STRING(10); i : INT; END_VAR
IMPLEMENTATION FBD
NETWORK
split1 := s10;
i := split1;
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

test("a split's uses are typed by its feeder, as the build types the consumer by the producer", () => {
  // The vendor's Demux holds no type (B6), so the IDE compiles each consumer against the feeder.
  expect(messages(fbd("a : BOOL; out : BOOL;", "split1 := a;\nout := split1;"))).toEqual([])
  expect(messages(fbd("i : INT; j : INT;", "split1 := i;\nsplit2 := split1;\nj := split2;"))).toEqual([])
  expect(messages(fbd("sx : STRING; j : INT;", "split1 := sx;\nj := split1;"))).toContain("Cannot convert type 'STRING' to type 'INT'")
})

// ─── openspec ld-fbd-coverage 1b.4: `fb(…).name` (S4) and the network shown as its `UNSUPPORTED "<shape>";` line ─────
// The bridge's `NetworkTextReader` reads both; the LSP parses them the same way (`frontend/syntax/network/parser.ts`),
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
 *  FB does not declare is reported as `cap.nope` is — while the box's own wire to a coil stays the IDE's, as a call's
 *  value is (`assignmentPairs`). */
test("a box read through a named output is read as the instance's output where it is consumed", () => {
  const vars = "cap : Capture; go : BOOL; elapsed : TIME; i : INT;"
  const named = projectMessages(nets(vars, "i := cap(xEnable := go).nope ADD i;"))
  expect(named).toContain("'nope' is no component of 'Capture'")
  expect(named).toEqual(projectMessages(nets(vars, "i := cap.nope ADD i;")))
  expect(projectMessages(nets(vars, "i := cap(xEnable := go).tElapsed ADD i;"))).toEqual(projectMessages(nets(vars, "i := cap.tElapsed ADD i;")))
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

test("network text: EN follows the box, and the coil below reads the box's ENO (B3, B4)", () => {
  const src = `FUNCTION_BLOCK F
VAR c : BOOL; lamp : BOOL; status : INT; END_VAR
IMPLEMENTATION LD
NETWORK
MOVE 0 => status EN c
lamp := ENO;
END_NETWORK
END_FUNCTION_BLOCK`
  const vg = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys")
  expect(vg.diagnostics).toEqual([])
  const s = vg.networks[0]!.statements[0]!
  expect(s.kind).toBe("assign")
  if (s.kind === "assign" && s.value.kind === "eno") expect(s.value.box.kind === "word" && s.value.box.en?.kind).toBe("operand")
  else throw new Error("the coil reads no ENO")
  expect(vgDiags(src)).toEqual([]) // a box output is the IDE's to type, not an ST assignment
})

test("network text: computeNetworkTextDiagnostics lifts network text errors into DiagnosticItems for the server", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
out := TRUE;
END_FUNCTION_BLOCK`
  const items = vgDiags(src)
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ severity: "error", source: "volt-lsp-iec", code: "NETWORK_NOT_CLOSED" })
})

test("network text: a clean ST body yields zero network-text diagnostics", () => {
  const st = `FUNCTION_BLOCK F
VAR i : INT; END_VAR
i := i + 1;
END_FUNCTION_BLOCK`
  expect(vgDiags(st)).toEqual([])
})

test("network text: a POU named EXECUTE is called backticked, and a bare EXECUTE opens an inline-ST box", () => {
  // Found by a fresh corpus pull: bakon-nano and lenze-mid call a POU named EXECUTE. In v2 a call head spelled like a
  // word of the text is backticked, so the call and the inline-ST box cannot be confused.
  const src = `PROGRAM P
VAR x : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
  \`EXECUTE\`(TRUE);
END_NETWORK
END_PROGRAM`
  expect(vgDiags(src).map((d) => d.code)).not.toContain("NETWORK_NOT_CLOSED")
  expect(parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys").diagnostics).toEqual([])
})

test("network text: a double-quoted title is consumed, not parsed as a statement", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK TITLE: "Some title"
  split1 := a;
  b := split1;
END_NETWORK
END_FUNCTION_BLOCK`
  const net = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys").networks[0]!
  expect(net.title).toBe("Some title")
  expect(net.statements.map((s) => s.kind)).toEqual(["split_def", "assign"])
  expect(vgDiags(src)).toEqual([])
})

test("network text: a quote inside a title is ST's $\" escape", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK TITLE: "Muting of alarm $"No bunch$""
  b := a;
END_NETWORK
END_FUNCTION_BLOCK`
  const net = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys").networks[0]!
  expect(net.title).toBe('Muting of alarm "No bunch"')
  expect(vgDiags(src)).toEqual([])
})

// A v1 body is refused, and refused ONLY: its text has no reading, so no compiler message can be derived from it. The
// token-based `???` check ran over v1 bodies anyway and reported lenze-mid's four void-call coils as targets — messages
// the build never gives, on text the LSP had just said it does not read. (v1 under a stated LD line is what a clean git
// merge makes of an un-pushed v1 edit.)
test("network text: a v1 body gets the re-pull finding and nothing else", () => {
  const src = `PROGRAM P
VAR a : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK 0 LD
  ??? := a;
END_NETWORK
END_PROGRAM`
  expect(vgDiags(src).map((d) => d.code)).toEqual(["NETWORK_PARSE"])
})

test("network text: a POU or instance named like a construct is refused at the call, whatever its pins", () => {
  const src = `FUNCTION F_EDGE : BOOL
VAR_INPUT x : BOOL; y : BOOL; END_VAR
F_EDGE := x;
END_FUNCTION
FUNCTION_BLOCK FB_T
VAR_INPUT IN : BOOL; PT : TIME; END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK FB
VAR a : BOOL; o : BOOL; R_EDGE : FB_T; END_VAR
IMPLEMENTATION LD
NETWORK
  R_EDGE(IN := a, PT := T#1S);
END_NETWORK
NETWORK
  o := F_EDGE(a, a);
END_NETWORK
END_FUNCTION_BLOCK`
  const got = vgDiags(src).map((d) => `${d.code} ${src.slice(d.span.start, d.span.end)}`)
  expect(got).toEqual(["NETWORK_UNSUPPORTED R_EDGE", "NETWORK_UNSUPPORTED F_EDGE"])
})

test("network text: a call of an instance whose FB TYPE is a construct word is refused, as the bridge refuses it", () => {
  // The bridge asks the instance's type (`NetworkScope.InstanceType`) — the writer could spell none of these back.
  const edgeFb = `FUNCTION_BLOCK R_EDGE\nVAR_INPUT CLK : BOOL; END_VAR\nEND_FUNCTION_BLOCK`
  const call = (decl: string, statement: string) =>
    `PROGRAM P\nVAR a : BOOL; ${decl} END_VAR\nIMPLEMENTATION FBD\nNETWORK\n${statement}\nEND_NETWORK\nEND_PROGRAM`
  const refusal = "a POU named R_EDGE: the text reads R_EDGE(…) as its own construct, so a call of it has no spelling."
  expect(projectDiags({ "file:///R.pou": edgeFb, "file:///P.pou": call("e1 : R_EDGE;", "e1(CLK := a);") }, "file:///P.pou")).toEqual([
    `NETWORK_UNSUPPORTED [e1] ${refusal}`,
  ])
  // …through a path too: the instance a GVL declares (`GVL.e1`), which the bridge resolves by the same question.
  expect(
    projectDiags(
      {
        "file:///R.pou": edgeFb,
        "file:///GVL.gvl": `VAR_GLOBAL\n\te1 : R_EDGE;\nEND_VAR`,
        "file:///P.pou": call("", "GVL.e1(CLK := a);"),
      },
      "file:///P.pou",
    ),
  ).toEqual([`NETWORK_UNSUPPORTED [GVL.e1] ${refusal}`])
  // An INSTANCE named like a construct, backticked, is named as the instance it is.
  const tmr = `FUNCTION_BLOCK TMR\nVAR_INPUT IN : BOOL; END_VAR\nEND_FUNCTION_BLOCK`
  expect(projectDiags({ "file:///T.pou": tmr, "file:///P.pou": call("R_EDGE : TMR;", "`R_EDGE`(IN := a);") }, "file:///P.pou")).toEqual([
    "NETWORK_UNSUPPORTED [`R_EDGE`] an instance named R_EDGE: the text reads it as its own construct.",
  ])
})

test("network text: an ST body whose first statement starts with a variable named `network` is ST", () => {
  // The stated language decides, and `network := 1;` opens no network (the bridge's `NetworkText.OpensNetwork`), so
  // it draws no "network text under ST" finding either.
  const prg = `PROGRAM P\nVAR network : INT; END_VAR\nIMPLEMENTATION ST\nnetwork := 1;\nEND_PROGRAM`
  expect(unitBodies(parseSource(prg, { networkText: true }, "codesys").units[0]!).some(isGraphicalBody)).toBe(false)
  expect(vgDiags(prg)).toEqual([])
  const fn = `FUNCTION Network : BOOL\nVAR_INPUT x : BOOL; END_VAR\nIMPLEMENTATION ST\nNetwork := x;\nEND_FUNCTION`
  expect(unitBodies(parseSource(fn, { networkText: true }, "codesys").units[0]!).some(isGraphicalBody)).toBe(false)
  expect(vgDiags(fn)).toEqual([])
  // v1 text is still met by name, asking for a re-pull.
  const v1 = `PROGRAM P\nVAR a : BOOL; END_VAR\nIMPLEMENTATION LD\nNETWORK 0 LD\na := TRUE;\nEND_NETWORK\nEND_PROGRAM`
  expect(vgDiags(v1).map((d) => d.code)).toEqual(["NETWORK_PARSE"])
})

test("network text: a split beside a POU variable of its name is no finding (B6, P1)", () => {
  // The name IS the VarId, and P1 reserves the pattern: the bare word is the split, the variable `split1`. Both IDEs
  // build the shape clean (`rcc_network_wire_named_like_variable`: []), so nothing is said while it is typed.
  const src = `FUNCTION_BLOCK FB\nVAR split1 : INT; a : BOOL; out : BOOL; END_VAR\nIMPLEMENTATION LD\nNETWORK\n  split1 := a;\n  out := split1;\nEND_NETWORK\nEND_FUNCTION_BLOCK`
  expect(vgDiags(src).map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

test("S5 (ld-fbd-coverage 2.3): `SUPER^` heads a call of the base FB, its pins the base's", () => {
  const src = (pin: string) => `FUNCTION_BLOCK B
VAR_INPUT x : INT; END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK D EXTENDS B
VAR a : INT; END_VAR
IMPLEMENTATION FBD
NETWORK
  \`SUPER^\`(${pin} := a);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(messages(src("x"))).toEqual([])
  expect(messages(src("nope")).length).toBeGreaterThan(0)
})
