/**
 * The network-text reader WHOLE, read from POU sources as the editor meets them: its files in `syntax/network` (the
 * cursor, values, calls, statements, the body and its networks), composed by `parseNetworkText`. Rule by rule the
 * reader is `network-parse.test.ts`'s; these read whole bodies — a header's fields, a wire block, one statement per
 * item — and were the services' one network test (`git show 1bb889bdfc:packages/volt-lsp-iec/src/services/network/network.test.ts`)
 * until openspec ld-fbd-coverage 2.1 split it per subject.
 */
import { test, expect } from "bun:test"
import {
  type BodySpan,
  type Expr,
  isGraphicalBody,
  networkValueExpr,
  parseSource,
  STRUCTURE_ONLY,
  unitBodies,
  walkExpr,
} from "../../syntax/index.js"
import { parseNetworkText } from "./network-parse.js"

/** Every identifier name referenced anywhere in an expression. */
function idents(e: Expr | undefined): string[] {
  const out: string[] = []
  if (e !== undefined) walkExpr(e, (x) => x.kind === "ident_expr" && out.push(x.name))
  return out
}

/** Parse a full POU source and return its (single) graphical body. */
function vgBody(src: string): BodySpan {
  const { units } = parseSource(src, { networkText: true }, "codesys")
  const body = unitBodies(units[0]!).find(isGraphicalBody)
  if (body === undefined) throw new Error("no graphical body")
  return body
}

const LD = `FUNCTION_BLOCK FB_LD
VAR
	a : BOOL; b : BOOL; out : BOOL;
END_VAR
IMPLEMENTATION LD
NETWORK
out := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`

test("network text: a single LD network with a coil parses clean", () => {
  const vg = parseNetworkText(vgBody(LD), STRUCTURE_ONLY, "codesys")
  expect(vg.diagnostics).toEqual([])
  expect(vg.language).toBe("LD") // the body's marker says it, once
  expect(vg.networks).toHaveLength(1)
  const n = vg.networks[0]!
  expect(n.index).toBe(0) // its position: the text carries no order number
  expect(n.statements).toHaveLength(1)
  const assign = n.statements[0]!
  expect(assign.kind).toBe("assign")
  if (assign.kind === "assign") {
    expect(idents(assign.targets[0]!.expr)).toEqual(["out"]) // the target parsed as an Expr
    const value = networkValueExpr(assign.value)
    expect(idents(value)).toEqual(["a", "b"]) // the value read as a real ST expression
    expect(value?.kind).toBe("paren") // `(a AND b)` — a parenthesised binary
  }
})

test("network text: a VAR_TEMP wire keeps its name, type and value", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; out : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
VAR_TEMP g1 : BOOL; END_VAR
g1 := (a AND b);
out := g1;
END_NETWORK
END_FUNCTION_BLOCK`
  const vg = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys")
  expect(vg.diagnostics).toEqual([])
  const n = vg.networks[0]!
  expect(n.wires.map((w) => `${w.name.text} : ${w.typeText}`)).toEqual(["g1 : BOOL"])
  const [wire, coil] = n.statements
  expect(wire?.kind).toBe("wire_def")
  if (wire?.kind === "wire_def") {
    expect(wire.wire.text).toBe("g1")
    expect(idents(networkValueExpr(wire.value))).toEqual(["a", "b"]) // its producer, an Expr
  }
  expect(coil?.kind).toBe("assign")
  if (coil?.kind === "assign") expect(coil.value.kind).toBe("wire_ref") // a wire reference
})

test("network text: the header parses the named LABEL/TITLE fields and DISABLED", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK LABEL: skipRest TITLE: "my title" DISABLED
out := FALSE;
END_NETWORK
END_FUNCTION_BLOCK`
  const vg = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys")
  const n = vg.networks[0]!
  expect(vg.language).toBe("FBD")
  expect(n.label?.text).toBe("skipRest") // the jump target
  expect(n.title).toBe("my title") // free text — a different thing, and impossible to confuse
  expect(n.disabled).toBe(true)
})

test("network text: LABEL and TITLE parse in either order", () => {
  // Header fields out of order are written by the push and come back canonical (bridge-refusal-review 2.12); the
  // parser reads both
  // orders, so a hand-written header is still understood while it is being typed.
  const swapped = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK TITLE: "t" LABEL: skipRest
out := FALSE;
END_NETWORK
END_FUNCTION_BLOCK`
  const n = parseNetworkText(vgBody(swapped), STRUCTURE_ONLY, "codesys").networks[0]!
  expect(n.label?.text).toBe("skipRest")
  expect(n.title).toBe("t")
})

// A network titled `"DISABLED during commissioning"` stays ENABLED — the flag is a header keyword, and text
// the engineer wrote is not the header.
test("network text: DISABLED inside the title does not disable the network", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK TITLE: "DISABLED during commissioning"
out := FALSE;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys").networks[0]!.disabled).toBe(false)
})

test("network text: a bare `name:` line is not a label — the label lives on the header", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
Loop:
out := TRUE;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys").diagnostics.map((x) => x.code)).toEqual(["NETWORK_PARSE"])
})

test("network text: an unclosed network reports NETWORK_NOT_CLOSED", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
out := TRUE;
END_FUNCTION_BLOCK`
  const codes = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys").diagnostics.map((d) => d.code)
  expect(codes).toContain("NETWORK_NOT_CLOSED")
})

test("network text: a wire defined twice reports NETWORK_DUPLICATE_NAME", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; out : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
VAR_TEMP g1 : BOOL; END_VAR
g1 := (a AND a);
g1 := (a OR a);
out := g1;
END_NETWORK
END_FUNCTION_BLOCK`
  const codes = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys").diagnostics.map((d) => d.code)
  expect(codes).toContain("NETWORK_DUPLICATE_NAME")
})

test("network text: a statement before any network reports NETWORK_PARSE", () => {
  // hand-built body tokens: `out := TRUE;` with no NETWORK — force via a raw graphical-looking body.
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
out := TRUE;
END_NETWORK
JUNK
END_FUNCTION_BLOCK`
  const codes = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys").diagnostics.map((d) => d.code)
  expect(codes).toContain("NETWORK_PARSE")
})

test("network text: an FB-instance call whose output goes nowhere is a value statement", () => {
  const src = `FUNCTION_BLOCK F
VAR tmr : TON; t : TIME; on : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
tmr(IN := on, PT := t);
END_NETWORK
END_FUNCTION_BLOCK`
  const vg = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys")
  expect(vg.diagnostics).toEqual([])
  const s = vg.networks[0]!.statements[0]!
  expect(s.kind).toBe("value")
  if (s.kind === "value") expect(networkValueExpr(s.value)?.kind).toBe("call")
})

test("network text: label, JMP and RETURN are recognised, one item each", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK LABEL: Loop
out := TRUE;
JMP Loop;
RETURN;
END_NETWORK
END_FUNCTION_BLOCK`
  const net = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys").networks[0]!
  expect(net.label?.text).toBe("Loop") // a network property, not a statement
  expect(net.statements.map((s) => s.kind)).toEqual(["assign", "jump", "return"])
})

test("network text: a colon in a title is not a label, and a single-quoted title is no title", () => {
  const src = (title: string) => `FUNCTION_BLOCK F
VAR a : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK TITLE: ${title}
  a := a;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(parseNetworkText(vgBody(src('"Network 3 : STATE: Prehoming"')), STRUCTURE_ONLY, "codesys").networks[0]!.title).toBe("Network 3 : STATE: Prehoming")
  // A TITLE is a double-quoted string with ST's escapes — the one spelling the writer writes.
  expect(parseNetworkText(vgBody(src("'Network 3'")), STRUCTURE_ONLY, "codesys").diagnostics.map((d) => d.code)).toEqual(["NETWORK_PARSE"])
})

test("network text: DISABLED still parses after a title", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK TITLE: "T" DISABLED
  a := a;
END_NETWORK
END_FUNCTION_BLOCK`
  const net = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys").networks[0]!
  expect(net.title).toBe("T")
  expect(net.disabled).toBe(true)
})
