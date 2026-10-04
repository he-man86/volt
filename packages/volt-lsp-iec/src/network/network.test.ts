import { test, expect } from "bun:test"
import { type BodySpan, type Expr, graphicalMarkerLanguage, isGraphicalBody, parseSource, unitBodies, walkExpr } from "../frontend/syntax/index.js"
import { build, type Scope } from "../frontend/symbols/index.js"
import { messagesFor, type DiagnosticItem } from "../analysis/index.js"
import type { LibraryManifest } from "../frontend/library/index.js"
import {
  STRUCTURE_ONLY,
  parseNetworkText,
  computeNetworkTextDiagnostics,
  documentSymbolsWithVg,
  analyzeNetworkText,
  networkValueExpr,
  networkHover,
  networkDefinition,
  networkCompletion,
  networkResolveAt,
  readOnlyBodyHover,
  referencesAnywhere,
  renameAnywhere,
} from "./index.js"
import type { Document } from "../services/shared/index.js"

/** Every identifier name referenced anywhere in an expression. */
function idents(e: Expr | undefined): string[] {
  const out: string[] = []
  if (e !== undefined) walkExpr(e, (x) => x.kind === "ident_expr" && out.push(x.name))
  return out
}

/** Parse a full POU source and return its (single) graphical body. */
function vgBody(src: string): BodySpan {
  const { units } = parseSource(src, { networkText: true })
  const body = unitBodies(units[0]!).find(isGraphicalBody)
  if (body === undefined) throw new Error("no graphical body")
  return body
}

function doc(src: string): Document {
  return { uri: "file:///FB.pou", source: src, parseResult: parseSource(src, { networkText: true }) }
}

function project(d: Document, manifests: readonly LibraryManifest[] = []): Scope {
  return build.buildSymbolTable([{ uri: d.uri, source: d.source, parseResult: d.parseResult }], manifests)
}

/** network-text diagnostics for a single-doc project (codesys wording). */
function vgDiags(src: string): DiagnosticItem[] {
  const d = doc(src)
  return computeNetworkTextDiagnostics(d, project(d), messagesFor("codesys"))
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

test("network text: an FBD/LD body is detected as graphical, not ST", () => {
  const { units, errors } = parseSource(LD, { networkText: true })
  expect(errors).toEqual([]) // ST parser routes around the network-text body — no false parse errors
  expect(unitBodies(units[0]!).some(isGraphicalBody)).toBe(true)
})

test("network text: a graphical body is detected by its IMPLEMENTATION line, even with no network", () => {
  // A body states its language once, on its IMPLEMENTATION line (openspec implementation-keyword). A body with no
  // network is still graphical; IMPLEMENTATION ST is an ST body's.
  const empty = parseSource(`FUNCTION_BLOCK FB_LD
VAR
\ta : BOOL;
END_VAR
IMPLEMENTATION LD
END_FUNCTION_BLOCK`, { networkText: true })
  expect(unitBodies(empty.units[0]!).map(graphicalMarkerLanguage)).toEqual(["LD"])
  expect(unitBodies(empty.units[0]!).some(isGraphicalBody)).toBe(true)

  const st = parseSource(`FUNCTION_BLOCK FB_ST
VAR
\ta : BOOL;
END_VAR
IMPLEMENTATION ST
a := TRUE;
END_FUNCTION_BLOCK`, { networkText: true })
  expect(unitBodies(st.units[0]!).map(graphicalMarkerLanguage)).toEqual([undefined])
  expect(unitBodies(st.units[0]!).some(isGraphicalBody)).toBe(false)
})

test("network text: a body is graphical by its stated LINE alone, as the bridge classifies it", () => {
  // The bridge matches the body's whole IMPLEMENTATION line (`ImplementationMarker.LanguageOf`), and nothing else
  // decides the reader: a line sharing its line with code states no language, and text that LOOKS like a network —
  // v1's `NETWORK 0 LD` header included — under IMPLEMENTATION ST is ST (which the ST parser refuses), never re-read.
  const body = (impl: string) => `PROGRAM P
VAR x : INT; a : INT; END_VAR
${impl}
END_PROGRAM`
  const graphical = (impl: string) => unitBodies(parseSource(body(impl), { networkText: true }).units[0]!).some(isGraphicalBody)

  expect(graphical("IMPLEMENTATION FBD x := 1;")).toBe(false)
  expect(graphical("IMPLEMENTATION ST\n// note\nNETWORK 0 LD\nx := a;")).toBe(false)
  expect(graphical("IMPLEMENTATION ST\n\nNETWORK 0 LD\nx := a;")).toBe(false)
  expect(graphical("IMPLEMENTATION ST\nNETWORK\nx := a;\nEND_NETWORK")).toBe(false)
  expect(graphical("// IMPLEMENTATION FBD\nNETWORK\nx := a;\nEND_NETWORK")).toBe(false)

  // …and what the line states as graphical is, whatever follows it.
  expect(graphical("IMPLEMENTATION FBD  \nNETWORK\nx := a;\nEND_NETWORK")).toBe(true)
  expect(graphical("implementation ld\n\nNETWORK 0 LD\nx := a;")).toBe(true)
})

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

test("network text: EN is a pin and .ENO the rung continuing from the box", () => {
  const src = `FUNCTION_BLOCK F
VAR c : BOOL; lamp : BOOL; status : INT; END_VAR
IMPLEMENTATION LD
NETWORK
lamp := MOVE(EN := c, 0, => status).ENO;
END_NETWORK
END_FUNCTION_BLOCK`
  const vg = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys")
  expect(vg.diagnostics).toEqual([])
  const s = vg.networks[0]!.statements[0]!
  expect(s.kind).toBe("assign")
  if (s.kind === "assign" && s.value.kind === "call") {
    expect(s.value.eno).toBe(true)
    const en = s.value.pins[0]!
    expect(en.kind === "input" && en.name?.text).toBe("EN")
  }
  expect(vgDiags(src)).toEqual([]) // a box output is the IDE's to type, not an ST assignment
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

test("network text: a sink type mismatch is flagged with the SAME check/message as ST", () => {
  const src = `FUNCTION_BLOCK F
VAR flag : BOOL; count : INT; END_VAR
IMPLEMENTATION LD
NETWORK
flag := count;
END_NETWORK
END_FUNCTION_BLOCK`
  const items = vgDiags(src)
  expect(items.some((d) => d.code === "assignment-type-mismatch")).toBe(true)
})

test("network text: a well-typed sink over real vars yields no code diagnostic", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
out := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src)).toEqual([])
})

// network-undeclared-identifier — the network-text analogue of ST's unresolved-identifier, sharing its resolution rules.
const vgUndeclared = (src: string, manifests: readonly LibraryManifest[] = []): string[] =>
  computeNetworkTextDiagnostics(doc(src), project(doc(src), manifests), messagesFor("codesys"))
    .filter((d) => d.code === "network-undeclared-identifier")
    .map((d) => d.message)

test("network text: an operand declared nowhere IS flagged, byte-identical to the compiler", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
out := nope;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgUndeclared(src)).toEqual(["Identifier 'nope' not defined"])
})

test("network text: declared vars and VAR_TEMP wires resolve (no undeclared diagnostic)", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; out : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
VAR_TEMP g1 : BOOL; END_VAR
g1 := (a AND b);
out := g1;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src)).toEqual([])
})

test("network text: R_EDGE / F_EDGE are flags on their operand, not calls of something undeclared", () => {
  // v1 left an edge as a trailing RISING/FALLING word in the operand, which this check had to skip by name. v2 spells
  // it `R_EDGE(x)`, a flag with no ST reading, so no word of the text ever reaches the undeclared check.
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; a : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
out := R_EDGE(a);
out := F_EDGE(NOT a);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src)).toEqual([])
  expect(vgUndeclared(src.replace("R_EDGE(a)", "R_EDGE(nope)"))).toEqual(["Identifier 'nope' not defined"]) // the operand still is checked
})

test("network text: a referenced library's namespace resolves when its manifest is bound", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
out := PACK_ML.gFlag;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgUndeclared(src)).toEqual(["Identifier 'PACK_ML' not defined"]) // unknown → flagged
  // the library materialized nothing; its manifest still binds the namespace (`bindLibraryNamespaces`)
  expect(vgUndeclared(src, [{ uri: "App/Library Manager/PackML/PackML.library", folder: "PackML", namespace: "PACK_ML", library: "PackML", dependencies: [], materialization: 4 }])).toEqual([]) // known → resolves
})

// network-unknown-member — the network-text analogue of ST's `a.b` member check (wired once the qualified_only binder
// bug that caused the lenze `Mach1` FPs was fixed). Shares `unresolvedMembers` + `notAMember` wording.
test("network text: an unknown struct member IS flagged; a real one stays quiet (network-unknown-member)", () => {
  const src = `TYPE Pt : STRUCT x : INT; END_STRUCT END_TYPE
FUNCTION_BLOCK F
VAR p : Pt; out : INT; END_VAR
IMPLEMENTATION FBD
NETWORK
out := p.x;
out := p.nope;
END_NETWORK
END_FUNCTION_BLOCK`
  const msgs = vgDiags(src).filter((d) => d.code === "network-unknown-member").map((d) => d.message)
  expect(msgs).toEqual(["'nope' is no component of 'Pt'"]) // p.x quiet, p.nope flagged
})

test("network text: a qualified_only GVL chain does NOT false-positive (lenze Mach1 regression)", () => {
  // bare `Mach1` binds to the GVL block (not HMI's qualified-only member), so `Mach1.Genflags.bReady`
  // resolves cleanly through the GVL global's struct type — zero unknown-member FPs.
  const files: Record<string, string> = {
    "file:///Mach1.gvl": `{attribute 'qualified_only'}\nVAR_GLOBAL\n\tGenflags : UDT_GeneralFlags;\nEND_VAR`,
    "file:///HMI.gvl": `{attribute 'qualified_only'}\nVAR_GLOBAL\n\tMach1 : sUDT_HMIVar_Mach1;\nEND_VAR`,
    "file:///Types.dut": `TYPE UDT_GeneralFlags : STRUCT bReady : BOOL; END_STRUCT END_TYPE\nTYPE sUDT_HMIVar_Mach1 : STRUCT other : BOOL; END_STRUCT END_TYPE`,
    "file:///FB_User.pou": `FUNCTION_BLOCK FB_User\nVAR x : BOOL; END_VAR\nIMPLEMENTATION FBD
NETWORK\nx := Mach1.Genflags.bReady;\nEND_NETWORK\nEND_FUNCTION_BLOCK`,
  }
  const docs = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }) }))
  const proj = build.buildSymbolTable(docs)
  const fbDoc = docs.find((d) => d.uri === "file:///FB_User.pou")!
  const diags = computeNetworkTextDiagnostics(fbDoc, proj, messagesFor("codesys"))
  expect(diags.filter((d) => d.code === "network-unknown-member")).toEqual([])
  expect(diags.filter((d) => d.code === "network-undeclared-identifier")).toEqual([])
})

const vgByCode = (src: string, code: string): number => vgDiags(src).filter((d) => d.code === code).length

// network text sink pair checks mirror ST via the shared helpers (assignment already tested above).
test("network text: a narrowing sink (LREAL→REAL coil) warns like ST", () => {
  const src = `FUNCTION_BLOCK F
VAR rv : REAL; l : LREAL; END_VAR
IMPLEMENTATION LD
NETWORK
rv := l;
END_NETWORK
END_FUNCTION_BLOCK`
  const d = vgDiags(src).find((x) => x.code === "narrowing-conversion")
  expect(d?.severity).toBe("warning")
  expect(d?.message).toBe("Implicit conversion from 'LREAL' to 'REAL': Possible loss of information")
})

// Corpus-found (lenze FB_Lenze_i550, Network 1): a conversion-call OPERAND whose argument sign-changes into the
// conversion's source type. network text never ran the conversion-arg check before — the whole type-check class was blind
// to graphical bodies. Byte-identical to the CODESYS build.
test("network text: a conversion-arg operand that sign-changes (UINT_TO_WORD of an INT) warns like ST", () => {
  const src = `FUNCTION_BLOCK F
VAR w : WORD; i : INT; END_VAR
IMPLEMENTATION FBD
NETWORK
w := UINT_TO_WORD(i);
END_NETWORK
END_FUNCTION_BLOCK`
  const d = vgDiags(src).find((x) => x.code === "sign-change-conversion")
  expect(d?.severity).toBe("warning")
  expect(d?.message).toBe("Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign")
})

// A reset coil is now the `R=` OPERATOR, so it cannot collide with a name.
//
// This test used to assert the opposite: that `flag := RESET;` was a reset coil and must NOT be typed. That
// was the old spelling — storage as a trailing word on the value — and it forced the analysis to exempt the
// bare words `SET`/`RESET` everywhere a sink value could stand. The exemption was not free, and this test was
// the evidence: `RESET` is a perfectly ordinary enum member, so the rule that kept a coil quiet also silenced
// every genuine mistake involving one. Both halves are now checkable, and they are the two cases below.
test("network text: a reset coil is the R= operator, and it is not a type mismatch", () => {
  const src = `TYPE DEVICE_STATE : (START, STOP, RESET); END_TYPE
FUNCTION_BLOCK F
VAR flag : BOOL; drive : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
flag R= drive;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src).filter((d) => d.code === "assignment-type-mismatch")).toEqual([])
})

test("network text: a set coil is the S= operator, and it is not a type mismatch", () => {
  const src = `FUNCTION_BLOCK F
VAR flag : BOOL; drive : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
flag S= drive;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src).filter((d) => d.code === "assignment-type-mismatch")).toEqual([])
})

// The half the old exemption had to give up. Assigning an enum member to a BOOL is a real mistake, and with
// storage spelled as an operator there is nothing left to confuse it with.
test("network text: assigning a same-named enum member to a BOOL is still a mismatch", () => {
  const src = `TYPE DEVICE_STATE : (START, STOP, RESET); END_TYPE
FUNCTION_BLOCK F
VAR flag : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
flag := RESET;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src).filter((d) => d.code === "assignment-type-mismatch")).not.toEqual([])
})

test("network text: a bad binary operand (MOD on REAL) is flagged like ST", () => {
  const src = `FUNCTION_BLOCK F
VAR a : REAL; b : REAL; out : REAL; END_VAR
IMPLEMENTATION FBD
NETWORK
out := (a MOD b);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(src, "binary-op-type-mismatch")).toBe(1)
})

// A JUMP GOES TO ANOTHER NETWORK. That is what a jump IS in FBD/LD: each network may carry one label, and
// `JMP name` transfers control to the network carrying it. `NetworkTextWriter` emits that label on the
// DESTINATION network's header (`LABEL:`, from `Network.Label`, which both drivers read and write), so a
// legitimate forward jump names a label the jumping network does not carry.
//
// Checking labels per network therefore rejects the normal case and accepts only a jump to a label in its own
// network — which is either an infinite loop or a no-op. This is the shape real ladder uses.
test("network text: a JMP may target a label on ANOTHER network", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
IF a THEN JMP Done; END_IF;
END_NETWORK
NETWORK LABEL: Done
out := TRUE;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(src, "network-undefined-label")).toBe(0)
})

test("network text: a JMP to an undefined label is flagged; a defined one is not", () => {
  const bad = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
out := TRUE;
JMP Nowhere;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(bad).filter((d) => d.code === "jump-label-undefined").map((d) => d.message)).toEqual([
    "No such label 'NOWHERE' within the scope of the JMP statement",
  ])
  const good = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK LABEL: Loop
out := TRUE;
JMP Loop;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(good)).toEqual([])
})

// network-unknown-pin — an FB box passing a pin the FB doesn't declare (checked only for resolved project FBs).
const FB_M = `FUNCTION_BLOCK FB_M
VAR_INPUT a : BOOL; END_VAR
END_FUNCTION_BLOCK
`
test("network text: an unknown FB pin is flagged; a declared pin is not", () => {
  const bad = `${FB_M}FUNCTION_BLOCK F
VAR m : FB_M; x : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
m(b := x);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(bad, "network-unknown-pin")).toBe(1)
  const good = bad.replace("m(b := x)", "m(a := x)")
  expect(vgByCode(good, "network-unknown-pin")).toBe(0)
})

test("network text: a box on an unresolvable (library/standard) FB is not pin-checked", () => {
  const src = `FUNCTION_BLOCK F
VAR tmr : TON; on : BOOL; t : TIME; END_VAR
IMPLEMENTATION FBD
NETWORK
tmr(IN := on, PT := t, MADE_UP := on);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(src, "network-unknown-pin")).toBe(0) // TON is not a project FB → skipped, no guess
})

test("network text: a wire's type is its declaration, and it types what reads it", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; out : INT; END_VAR
IMPLEMENTATION LD
NETWORK
VAR_TEMP g1 : BOOL; END_VAR
g1 := a;
out := g1;
END_NETWORK
END_FUNCTION_BLOCK`
  // g1 is declared BOOL; assigning it to an INT coil is a mismatch — proves the wire resolves with its declared type.
  expect(vgDiags(src).some((d) => d.code === "assignment-type-mismatch")).toBe(true)
})

test("network text: analyzeNetworkText types a wire from its VAR_TEMP declaration", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
VAR_TEMP g1 : BOOL; END_VAR
g1 := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`
  const d = doc(src)
  const analysis = analyzeNetworkText(parseSource(src, { networkText: true }).units[0]!, vgBody(src), project(d), d.uri)
  const scope = [...analysis.networkScopes.values()][0]!
  const wire = scope.symbols.get("g1")?.[0]
  expect(wire?.typeExpr?.kind).toBe("named_type")
  if (wire?.typeExpr?.kind === "named_type") expect(wire.typeExpr.name.text).toBe("BOOL")
})

test("network text: document outline attaches networks under their POU", () => {
  const syms = documentSymbolsWithVg(doc(LD))
  const fb = syms.find((s) => s.name === "FB_LD")
  expect(fb).toBeDefined()
  expect(fb?.children?.some((c) => c.name.startsWith("NETWORK 0"))).toBe(true)
})

// ─── F.2d services ────────────────────────────────────────────────────────────

const WIRED = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
VAR_TEMP g1 : BOOL; END_VAR
g1 := (a AND b);
out := g1;
END_NETWORK
END_FUNCTION_BLOCK`

test("network text hover: a wire shows its declaration and its producer", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("out := g1") + "out := ".length // the `g1` USE
  const value = (networkHover(d, project(d), off) as { contents: { value: string } })?.contents.value
  expect(value).toContain("g1 : BOOL")
  expect(value).toContain("g1 := (a AND b);")
})

test("network text hover: a real variable shows its declared type", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("(a AND b)") + 1 // the `a` operand
  const h = networkHover(d, project(d), off)
  expect((h as { contents: { value: string } })?.contents.value).toContain("a : BOOL")
})

test("network text definition: a wire use jumps to its VAR_TEMP declaration", () => {
  const d = doc(WIRED)
  const useOff = WIRED.indexOf("out := g1") + "out := ".length
  const loc = networkDefinition(d, project(d), useOff)
  const declLine = WIRED.slice(0, WIRED.indexOf("VAR_TEMP")).split("\n").length - 1 // 0-based line of the block
  expect(loc?.range.start.line).toBe(declLine)
})

test("network text definition: a real-var operand jumps to its declaration", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("(a AND b)") + 1
  const loc = networkDefinition(d, project(d), off)
  expect(loc?.range.start.line).toBe(1) // the VAR line
})

test("network text completion: offers POU vars AND the network's wires", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("out := g1") + "out := ".length
  const labels = networkCompletion(d, project(d), off).map((c) => c.label)
  expect(labels).toContain("out") // POU var
  expect(labels).toContain("g1") // network wire
})

test("network text resolve: a member chain operand resolves to its field", () => {
  const src = `FUNCTION_BLOCK Inner
VAR Q : BOOL; END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK F
VAR t : Inner; done : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
done := t.Q;
END_NETWORK
END_FUNCTION_BLOCK`
  const d = doc(src)
  const off = src.indexOf("t.Q") + 2 // the `Q` member
  const sym = networkResolveAt(d, project(d), off)
  expect(sym?.name).toBe("Q")
})

test("network text: a hidden body's line hover explains the body (F.2e)", () => {
  const src = `FUNCTION_BLOCK F\nVAR END_VAR\nIMPLEMENTATION CFC UNSUPPORTED\nEND_FUNCTION_BLOCK`
  const d = doc(src)
  const value = (readOnlyBodyHover(d, src.indexOf("CFC")) as { contents: { value: string } })?.contents.value
  expect(value).toContain("Continuous Function Chart")
  expect(value).toContain("IDE")
  expect(value).toContain("declaration")   // 3b: the declaration above the line stays editable
  // a hidden body is read by neither parser (no diagnostics)
  expect(vgDiags(src)).toEqual([])

  const ld = `FUNCTION_BLOCK F\nVAR END_VAR\nIMPLEMENTATION LD UNSUPPORTED\nEND_FUNCTION_BLOCK`
  const unsupported = (readOnlyBodyHover(doc(ld), ld.indexOf("UNSUPPORTED")) as { contents: { value: string } })?.contents.value
  expect(unsupported).toContain("Ladder Diagram")
  expect(unsupported).toContain("cannot represent")

  // A language Volt has never seen, under the vendor's name (D27): Volt does not read it — no network-text excuse.
  const uml = `FUNCTION_BLOCK F\nVAR END_VAR\nIMPLEMENTATION UML UNSUPPORTED\nEND_FUNCTION_BLOCK`
  const unknown = (readOnlyBodyHover(doc(uml), uml.indexOf("UML")) as { contents: { value: string } })?.contents.value
  expect(unknown).toContain("Volt does not read UML")
  expect(vgDiags(uml)).toEqual([])

  // Only the line a body opens with answers — not an ST body, and not the line quoted in a comment.
  const st = `FUNCTION_BLOCK F\nVAR END_VAR\n(* IMPLEMENTATION CFC UNSUPPORTED *)\nIMPLEMENTATION ST\nEND_FUNCTION_BLOCK`
  expect(readOnlyBodyHover(doc(st), st.indexOf("CFC"))).toBeUndefined()
  expect(readOnlyBodyHover(doc(st), st.indexOf("ST\n"))).toBeUndefined()
})

// ─── cross-body references / rename: a symbol used in BOTH ST and network text bodies ─────

/** A multi-file project: a GVL global read by one FB's ST body and another FB's network text (LD) body. */
function crossBodyProject() {
  const files: Record<string, string> = {
    "file:///G.gvl": `VAR_GLOBAL\n\tFlag : BOOL;\nEND_VAR`,
    "file:///FB_ST.pou": `FUNCTION_BLOCK FB_ST\nFlag := TRUE;\nEND_FUNCTION_BLOCK`,
    "file:///FB_VG.pou": `FUNCTION_BLOCK FB_VG\nVAR\n\tx : BOOL;\nEND_VAR\nIMPLEMENTATION LD
NETWORK\nx := Flag;\nEND_NETWORK\nEND_FUNCTION_BLOCK`,
  }
  const docs = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }) }))
  return { docs, project: build.buildSymbolTable(docs), by: (uri: string) => docs.find((d) => d.uri === uri)! }
}

test("network text references: a global read in a network-text operand is found from an ST cursor", () => {
  const { docs, project, by } = crossBodyProject()
  const st = by("file:///FB_ST.pou")
  const locs = referencesAnywhere(docs, project, st, st.source.indexOf("Flag"))
  const uris = new Set(locs?.map((l) => l.uri))
  // declaration (GVL) + the ST use + the network-text operand use — the network-text body must not be missed
  expect(uris).toEqual(new Set(["file:///G.gvl", "file:///FB_ST.pou", "file:///FB_VG.pou"]))
})

test("network text rename: renaming from a network-text operand edits every ST and network text occurrence", () => {
  const { docs, project, by } = crossBodyProject()
  const vg = by("file:///FB_VG.pou")
  const edit = renameAnywhere(docs, project, vg, vg.source.indexOf("Flag"), "Enabled")
  const changed = Object.keys(edit?.changes ?? {}).sort()
  expect(changed).toEqual(["file:///FB_ST.pou", "file:///FB_VG.pou", "file:///G.gvl"])
  // the network-text operand edit lands on `Flag` within the LD network
  const vgEdits = edit!.changes!["file:///FB_VG.pou"]!
  expect(vgEdits.every((e) => e.newText === "Enabled")).toBe(true)
})

test("network text references: a cursor outside any symbol resolves to nothing", () => {
  const { docs, project, by } = crossBodyProject()
  const vg = by("file:///FB_VG.pou")
  expect(referencesAnywhere(docs, project, vg, vg.source.indexOf("NETWORK"))).toBeUndefined()
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

test("network text: EXECUTE without ( opens an inline-ST box, closed by END_EXECUTE;", () => {
  const src = `PROGRAM P
VAR x : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
  EXECUTE
  x := TRUE;
  END_EXECUTE;
END_NETWORK
END_PROGRAM`
  expect(vgDiags(src).map((d) => d.code)).toEqual([])
})

// ─── found by a fresh corpus pull (lenze-mid, 250 diagnostics) ────────────────

test("network text: a double-quoted title is consumed, not parsed as a statement", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK TITLE: "Some title"
  VAR_TEMP g1 : BOOL; END_VAR
  g1 := a;
  b := g1;
END_NETWORK
END_FUNCTION_BLOCK`
  const net = parseNetworkText(vgBody(src), STRUCTURE_ONLY, "codesys").networks[0]!
  expect(net.title).toBe("Some title")
  expect(net.statements.map((s) => s.kind)).toEqual(["wire_def", "assign"])
  expect(vgDiags(src)).toEqual([])
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

test("network text: EN is a pin of every box and ENO its suffix, not unknown pins", () => {
  // EN/ENO are IMPLICIT on every FBD/LD box — not declared in the FB. lenze-mid drives EN on four project FBs and its
  // recorded build accepts every one.
  const src = `FUNCTION_BLOCK Outer
VAR inner : Inner; go : BOOL; done : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
  done := inner(EN := go).ENO;
END_NETWORK
END_FUNCTION_BLOCK
FUNCTION_BLOCK Inner
VAR_INPUT x : BOOL; END_VAR
END_FUNCTION_BLOCK`
  expect(vgDiags(src).filter((d) => d.code === "network-unknown-pin")).toEqual([])
})

test("network text: a pin the FB really lacks is still reported", () => {
  const src = `FUNCTION_BLOCK Outer
VAR inner : Inner; go : BOOL; END_VAR
IMPLEMENTATION FBD
NETWORK
  inner(nosuchpin := go);
END_NETWORK
END_FUNCTION_BLOCK
FUNCTION_BLOCK Inner
VAR_INPUT x : BOOL; END_VAR
END_FUNCTION_BLOCK`
  expect(vgDiags(src).map((d) => d.code)).toContain("network-unknown-pin")
})

test("network text: both vendors report a JMP to a missing label, TwinCAT with a full stop", () => {
  // Census 1.15 (DIALECT N19), measured on network text v2: TwinCAT DOES report it — `No such label 'NOWHERE' within
  // the scope of the JMP statement.` (tc-labels-edge-names.log (deleted; git show b2496efb4b:packages/volt-cli/scripts/tc-labels-edge-names.log)). The 2026-07-07 measurement that it said nothing was of
  // v1 text, and the exception it bought went with it.
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
NETWORK
out := TRUE;
JMP Nowhere;
END_NETWORK
END_FUNCTION_BLOCK`
  const d = doc(src)
  const of = (vendor: "codesys" | "twincat") =>
    computeNetworkTextDiagnostics(d, project(d), messagesFor(vendor)).filter((x) => x.code === "jump-label-undefined").map((x) => x.message)
  expect(of("codesys")).toEqual(["No such label 'NOWHERE' within the scope of the JMP statement"])
  expect(of("twincat")).toEqual(["No such label 'NOWHERE' within the scope of the JMP statement."])
})

// ─── labels at parity with the recorded builds (census 1.15, DIALECT N19; openspec network-text-literal-nwl 5.6) ───
// Both IDEs HOLD every shape below, so none is a gate refusal: the build reports them, and the LSP says what the build
// says — `nwl-labels.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/nwl-labels.log`) (CODESYS) and `tc-labels-edge-names.log` (deleted; `git show b2496efb4b:packages/volt-cli/scripts/tc-labels-edge-names.log`) (TwinCAT) — and nothing more.

const labelsBody = (networks: string) => `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
IMPLEMENTATION LD
${networks}
END_FUNCTION_BLOCK`
const labelMessages = (networks: string, vendor: "codesys" | "twincat" = "codesys"): string[] => {
  const d = doc(labelsBody(networks))
  return computeNetworkTextDiagnostics(d, project(d), messagesFor(vendor)).map((x) => `[${x.severity}] ${x.message}`)
}

test("network labels: one label on two networks, in any case, is the build's duplicate — and nothing else", () => {
  const networks = "NETWORK\n  JMP Done;\nEND_NETWORK\nNETWORK LABEL: Done\n  out := TRUE;\nEND_NETWORK\nNETWORK LABEL: DONE\n  out := FALSE;\nEND_NETWORK"
  expect(labelMessages(networks)).toEqual(["[error] The label 'DONE' is a duplicate"])
  expect(labelMessages(networks, "twincat")).toEqual(["[error] The label 'DONE' is a duplicate"])
  // No jump at all: the duplicate, and ONE unreferenced warning for the name (nwl-labels.log (deleted; git show b2496efb4b:packages/volt-cli/scripts/nwl-labels.log), "duplicate label, no jump").
  expect(labelMessages("NETWORK LABEL: Done\n  out := TRUE;\nEND_NETWORK\nNETWORK LABEL: DONE\n  out := FALSE;\nEND_NETWORK")).toEqual([
    "[error] The label 'DONE' is a duplicate",
    "[warning] The label 'DONE' has not been referenced",
  ])
})

test("network labels: a DISABLED network's label is no jump target", () => {
  const networks = "NETWORK\n  JMP Done;\nEND_NETWORK\nNETWORK LABEL: Done DISABLED\n  out := TRUE;\nEND_NETWORK"
  expect(labelMessages(networks)).toEqual(["[error] No such label 'DONE' within the scope of the JMP statement"])
  expect(labelMessages(networks, "twincat")).toEqual(["[error] No such label 'DONE' within the scope of the JMP statement."])
})

test("network labels: a JMP inside a DISABLED network references nothing", () => {
  const networks = "NETWORK DISABLED\n  JMP Done;\nEND_NETWORK\nNETWORK LABEL: Done\n  out := TRUE;\nEND_NETWORK"
  expect(labelMessages(networks)).toEqual(["[warning] The label 'DONE' has not been referenced"])
  expect(labelMessages(networks, "twincat")).toEqual(["[warning] The label 'DONE' has not been referenced"])
})

test("network labels: a label nothing jumps to is the build's warning; a jump in another case references it", () => {
  expect(labelMessages("NETWORK LABEL: Done\n  out := TRUE;\nEND_NETWORK")).toEqual(["[warning] The label 'DONE' has not been referenced"])
  expect(labelMessages("NETWORK\n  JMP DONE;\nEND_NETWORK\nNETWORK LABEL: Done\n  out := TRUE;\nEND_NETWORK")).toEqual([])
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

// ─── section-5 review: the LSP reads what the push reads, and types what the spec types ─────────

const ENO_TYPES = `FUNCTION F_Int : INT
VAR_INPUT i : INT; END_VAR
F_Int := i;
END_FUNCTION
FUNCTION_BLOCK FB
VAR a : BOOL; b : BOOL; c : BOOL; out : BOOL; iRPM : INT; s : INT; END_VAR
IMPLEMENTATION LD
NETWORK
  %s
END_NETWORK
END_FUNCTION_BLOCK`
const enoDiags = (statement: string): string[] => vgDiags(ENO_TYPES.replace("%s", statement)).map((d) => d.message)

test("network text: .ENO is BOOL wherever it stands, not the box's result", () => {
  expect(enoDiags("out := (F_Int(EN := a, iRPM).ENO AND b);")).toEqual([])
  expect(enoDiags("out := NOT(F_Int(EN := a, iRPM).ENO);")).toEqual([])
  expect(enoDiags("iRPM := (F_Int(EN := a, iRPM).ENO OR b);")).toEqual(["Cannot convert type 'BOOL' to type 'INT'"])
})

test("network text: an edge used directly is typed as the same value through a wire is", () => {
  // An edge is no box: `x := R_EDGE(a)` reads as an opaque BOOL, as the BOOL wire it could have gone through does. (A
  // box's own output — `x := f(…).ENO` — stays the IDE's, network-real-shapes "a box's output, by its data pin or its ENO".)
  const viaWire = enoDiags("VAR_TEMP g1 : BOOL; END_VAR\n  g1 := R_EDGE(a);\n  iRPM := g1;")
  expect(viaWire).toEqual(["Cannot convert type 'BOOL' to type 'INT'"])
  expect(enoDiags("iRPM := R_EDGE(a);")).toEqual(viaWire)
  expect(enoDiags("out := R_EDGE(a);")).toEqual([])
})

test("network text: the operands inside an .ENO box and an edge are still resolved", () => {
  expect(enoDiags("out := (F_Int(EN := a, nope).ENO AND b);")).toContain("Identifier 'nope' not defined")
  expect(enoDiags("out := R_EDGE(nope);")).toContain("Identifier 'nope' not defined")
})

test("network text: an undeclared wire-shaped name is a compiler message, not a push refusal", () => {
  // openspec bridge-refusal-review 1.3: the push writes it as a variable and the build reports it — both vendors,
  // `rcc_network_undeclared_wire_shape` (2026-10-04): "Identifier 'g7' not defined" and the hole it leaves.
  const fb = (statement: string) =>
    `FUNCTION_BLOCK FB\nVAR out : BOOL; x : BOOL; END_VAR\nIMPLEMENTATION LD\nNETWORK\n  ${statement}\nEND_NETWORK\nEND_FUNCTION_BLOCK`
  expect(vgDiags(fb("out := g5;")).map((d) => d.message).sort()).toEqual([
    "Cannot convert type 'Unknown type: 'g5'' to type 'BOOL'",
    "Identifier 'g5' not defined",
  ])
  expect(vgDiags(fb("out := `g5`;")).map((d) => d.message)).toContain("Identifier 'g5' not defined")
  expect(vgDiags(fb("out := g5;")).map((d) => d.code)).not.toContain("NETWORK_BAD_EXPRESSION")
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

test("network text rename: a new name that is a word of the text is backticked where the text reads it bare", () => {
  const files: Record<string, string> = {
    "file:///G.gvl": `VAR_GLOBAL\n\tFlag : BOOL;\nEND_VAR`,
    "file:///FB_ST.pou": `FUNCTION_BLOCK FB_ST\nFlag := TRUE;\nEND_FUNCTION_BLOCK`,
    "file:///FB_VG.pou": `FUNCTION_BLOCK FB_VG\nVAR\n\tx : BOOL;\nEND_VAR\nIMPLEMENTATION LD
NETWORK\nx := Flag;\nFlag := x;\nx := \`Flag OR x\`;\nEND_NETWORK\nEND_FUNCTION_BLOCK`,
  }
  const docs = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }) }))
  const proj = build.buildSymbolTable(docs)
  const vg = docs.find((d) => d.uri === "file:///FB_VG.pou")!
  const edit = renameAnywhere(docs, proj, vg, vg.source.indexOf("Flag"), "Execute")!
  // ST and a declaration take the name as it is; inside backticked text it is verbatim ST, so it is not backticked again.
  expect(edit.changes!["file:///G.gvl"]!.map((e) => e.newText)).toEqual(["Execute"])
  expect(edit.changes!["file:///FB_ST.pou"]!.map((e) => e.newText)).toEqual(["Execute"])
  expect(edit.changes!["file:///FB_VG.pou"]!.map((e) => e.newText)).toEqual(["`Execute`", "`Execute`", "Execute"])
  // …and the renamed network reads clean.
  const lines = vg.source.split("\n")
  for (const e of [...edit.changes!["file:///FB_VG.pou"]!].reverse()) {
    const l = lines[e.range.start.line]!
    lines[e.range.start.line] = l.slice(0, e.range.start.character) + e.newText + l.slice(e.range.end.character)
  }
  const renamed = lines.join("\n").replace("\tx : BOOL;", "\tx : BOOL;\n\tExecute : BOOL;")
  expect(parseNetworkText(vgBody(renamed), STRUCTURE_ONLY, "codesys").diagnostics).toEqual([])
})

// ─── section-5 second review: what the bridge reads, the LSP reads — marker, instance type, v1 shape, wire type ────

/** Network-text diagnostics of `uri` in a project of several files. */
function projectDiags(files: Record<string, string>, uri: string): string[] {
  const docs = Object.entries(files).map(([u, source]) => ({ uri: u, source, parseResult: parseSource(source, { networkText: true }) }))
  const d = docs.find((x) => x.uri === uri)!
  return computeNetworkTextDiagnostics(d, build.buildSymbolTable(docs), messagesFor("codesys")).map(
    (x) => `${x.code} [${d.source.slice(x.span.start, x.span.end)}] ${x.message}`,
  )
}

test("network text: a marker line with trailing blanks is the marker — the bridge's line allows them", () => {
  // `ImplementationMarker.Line` is `^\s*(*…*)\s*$`: a trailing space or tab after the marker is layout. Refused here, the
  // body read no networks at all, so rename and references skipped it and a rename left the old name behind.
  const files: Record<string, string> = {
    "file:///G.gvl": `VAR_GLOBAL\n\tFlag : BOOL;\nEND_VAR`,
    "file:///S.pou": `PROGRAM S\nFlag := TRUE;\nEND_PROGRAM`,
    "file:///P.pou": `PROGRAM P\nVAR x : BOOL; END_VAR\nIMPLEMENTATION FBD \t\nNETWORK\nx := Flag;\nEND_NETWORK\nEND_PROGRAM`,
  }
  expect(projectDiags(files, "file:///P.pou")).toEqual([])
  const docs = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source, { networkText: true }) }))
  const proj = build.buildSymbolTable(docs)
  const s = docs.find((d) => d.uri === "file:///S.pou")!
  const edit = renameAnywhere(docs, proj, s, s.source.indexOf("Flag"), "Enabled")
  expect(Object.keys(edit?.changes ?? {}).sort()).toEqual(["file:///G.gvl", "file:///P.pou", "file:///S.pou"])
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
  expect(unitBodies(parseSource(prg, { networkText: true }).units[0]!).some(isGraphicalBody)).toBe(false)
  expect(vgDiags(prg)).toEqual([])
  const fn = `FUNCTION Network : BOOL\nVAR_INPUT x : BOOL; END_VAR\nIMPLEMENTATION ST\nNetwork := x;\nEND_FUNCTION`
  expect(unitBodies(parseSource(fn, { networkText: true }).units[0]!).some(isGraphicalBody)).toBe(false)
  expect(vgDiags(fn)).toEqual([])
  // v1 text is still met by name, asking for a re-pull.
  const v1 = `PROGRAM P\nVAR a : BOOL; END_VAR\nIMPLEMENTATION LD\nNETWORK 0 LD\na := TRUE;\nEND_NETWORK\nEND_PROGRAM`
  expect(vgDiags(v1).map((d) => d.code)).toEqual(["NETWORK_PARSE"])
})

test("network text: a wire declared unlike its producer is the push's refusal, at the wire, and no message at its consumer", () => {
  // Spec, "a hand-edited type": the bridge reader's `CheckWireTypes`, by `NetworkSpelling.ProducerType`.
  const fb = (wires: string, def: string) =>
    `FUNCTION_BLOCK FB\nVAR a : BOOL; b : BOOL; out : BOOL; w1 : WORD; w2 : WORD; i : INT; j : INT; END_VAR\nIMPLEMENTATION LD\nNETWORK\nVAR_TEMP ${wires} END_VAR\n${def}\nEND_NETWORK\nEND_FUNCTION_BLOCK`
  expect(vgDiags(fb("g1 : INT;", "g1 := (a AND b);\nout := g1;")).map((d) => `${d.code}: ${d.message}`)).toEqual([
    "NETWORK_BAD_EXPRESSION: the wire g1 is declared INT and its producer is a bit operator, whose result is BOOL or another bit string (BYTE, WORD, DWORD, LWORD).",
  ])
  expect(vgDiags(fb("g1 : WORD;", "g1 := (i > j);\nw1 := g1;")).map((d) => d.message)).toEqual([
    "the wire g1 is declared WORD and its producer is BOOL.",
  ])
  // What the producer allows is no finding: a bitwise AND on WORDs, an ADD (the text carries no stored type).
  expect(vgDiags(fb("g1 : WORD;", "g1 := (w1 AND w2);\nw1 := g1;"))).toEqual([])
  expect(vgDiags(fb("g1 : INT;", "g1 := (i + j);\ni := g1;"))).toEqual([])
  // BIT is in ANY_BIT but not among the bridge's bit strings (`NetworkSpelling.BitStrings`): the push refuses it, so the LSP does.
  expect(vgDiags(fb("g1 : BIT;", "g1 := (a AND b);\nout := g1;")).map((d) => d.message)).toEqual([
    "the wire g1 is declared BIT and its producer is a bit operator, whose result is BOOL or another bit string (BYTE, WORD, DWORD, LWORD).",
  ])
})

test("network text: an EXECUTE box's assignments are ST, type-checked as ST — a call on the right included", () => {
  const src = (line: string) => `FUNCTION F_Int : INT
VAR_INPUT i : INT; END_VAR
F_Int := i;
END_FUNCTION
FUNCTION_BLOCK FB
VAR o : BOOL; k : INT; END_VAR
IMPLEMENTATION FBD
NETWORK
EXECUTE
${line}
END_EXECUTE;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src("o := k;")).map((d) => d.message)).toEqual(["Cannot convert type 'INT' to type 'BOOL'"])
  expect(vgDiags(src("o := F_Int(k);")).map((d) => d.message)).toEqual(["Cannot convert type 'INT' to type 'BOOL'"])
})

test("network text: a wire named like a POU variable is the wire for every use after its block — no finding", () => {
  // openspec bridge-refusal-review 2.10: the push writes it (wires resolve first, the writer renames on the next pull),
  // so the analysis types `g1` as the wire, never as the INT the POU declares under that name.
  const src = `FUNCTION_BLOCK FB\nVAR g1 : INT; a : BOOL; out : BOOL; END_VAR\nIMPLEMENTATION LD\nNETWORK\n  VAR_TEMP g1 : BOOL; END_VAR\n  g1 := a;\n  out := g1;\nEND_NETWORK\nEND_FUNCTION_BLOCK`
  expect(vgDiags(src).map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

test("network text: `.ENO` on an operator box with no EN is CODESYS's 'Missing EN pin'; on an FB it is the FB's own", () => {
  // openspec bridge-refusal-review 1.5: the push builds the box the text describes and CODESYS's build answers it
  // (`rcc_network_eno_without_en`, SP21 2026-10-04; DIALECT N21). An FB may declare ENO without EN (Lenze `Dryer`, N16).
  const fb = (vars: string, statement: string) =>
    `FUNCTION_BLOCK FB_T\nVAR_INPUT IN : BOOL; END_VAR\nVAR_OUTPUT ENO : BOOL; END_VAR\nEND_FUNCTION_BLOCK\nFUNCTION_BLOCK FB\nVAR a : INT; b : INT; x : BOOL; go : BOOL; ${vars} END_VAR\nIMPLEMENTATION FBD\nNETWORK\n  ${statement}\nEND_NETWORK\nEND_FUNCTION_BLOCK`
  const missing = "An inconsistent element has been detected (Missing EN pin). Consider making a correction."
  expect(vgDiags(fb("", "x := ADD(a, b).ENO;")).map((d) => d.message)).toContain(missing)
  expect(vgDiags(fb("", "x := ADD(EN := go, a, b).ENO;")).map((d) => d.message)).not.toContain(missing)
  expect(vgDiags(fb("t : FB_T;", "x := t(IN := go).ENO;")).map((d) => d.message)).not.toContain(missing)
})

test("network text: `.ENO` with no EN on a FUNCTION's box is CODESYS's 'The assignment source is incorrect.', a qualified one too", () => {
  // review 5+6, measured (`rcc_network_eno_function_without_en`, SP21 2026-10-04): a FUNCTION's box answers about the
  // source, not the pin — the check had borrowed the operator box's "Missing EN pin" for every head that is no variable.
  // And a member head used to count as a path to a variable whatever it named, so `Lib.F(a, b).ENO` passed for an FB
  // call: a namespace qualifying a POU names a function.
  const lib = "file:///w/Library Manager/Util"
  const manifest = { uri: `${lib}/Util.library`, folder: "Util", namespace: "Util", library: "Util", dependencies: [], materialization: 2 }
  const libSrc = "FUNCTION Twice : INT\nVAR_INPUT\n  a : INT;\n  b : INT;\nEND_VAR\nTwice := a + b;\nEND_FUNCTION\n"
  const source = "The assignment source is incorrect."
  const missing = "An inconsistent element has been detected (Missing EN pin). Consider making a correction."
  const run = (statement: string) => {
    const src = `FUNCTION FUN : INT\nVAR_INPUT a : INT; b : INT; END_VAR\nFUN := a + b;\nEND_FUNCTION\nFUNCTION_BLOCK FB\nVAR a : INT; b : INT; x : BOOL; go : BOOL; END_VAR\nIMPLEMENTATION FBD\nNETWORK\n  ${statement}\nEND_NETWORK\nEND_FUNCTION_BLOCK`
    const d = doc(src)
    const p = build.buildSymbolTable(
      [{ uri: d.uri, source: d.source, parseResult: d.parseResult }, { uri: `${lib}/Twice.pou`, source: libSrc, parseResult: parseSource(libSrc, { networkText: true }) }],
      [manifest],
    )
    return computeNetworkTextDiagnostics(d, p, messagesFor("codesys")).map((m) => m.message)
  }
  expect(run("x := FUN(a, b).ENO;")).toEqual([source])
  expect(run("x := Util.Twice(a, b).ENO;")).toEqual([source])
  expect(run("x := FUN(EN := go, a, b).ENO;")).not.toContain(source)
  expect(run("x := Util.Twice(EN := go, a, b).ENO;")).not.toContain(source)
  expect(run("x := ADD(a, b).ENO;")).toContain(missing)
  // a member the namespace does not show is unknown — it could be a library global instance — so nothing rests on it
  const unknown = run("x := Util.gInst(IN := go).ENO;")
  expect([unknown.includes(source), unknown.includes(missing)]).toEqual([false, false])
  // nor on an unmeasured box kind: MOVE is no operator of the table and resolves to no declared callable
  expect(run("x := MOVE(a).ENO;")).not.toContain(missing)
})
