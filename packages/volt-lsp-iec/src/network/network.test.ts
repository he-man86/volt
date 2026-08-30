import { test, expect } from "bun:test"
import { parseSource, unitBodies, isGraphicalBody, walkExpr, type BodySpan, type Expr } from "../syntax/index.js"
import { buildSymbolTable, type Scope } from "../symbols/index.js"
import { messagesFor, type DiagnosticItem, type WorkspaceRefs } from "../analysis/index.js"
import {
  parseNetworkText,
  computeNetworkTextDiagnostics,
  documentSymbolsWithVg,
  analyzeNetworkText,
  networkHover,
  networkDefinition,
  networkCompletion,
  networkResolveAt,
  networkMarkerHover,
  referencesAnywhere,
  renameAnywhere,
} from "./index.js"
import type { Document } from "../services/index.js"

/** Every identifier name referenced anywhere in an expression. */
function idents(e: Expr | undefined): string[] {
  const out: string[] = []
  if (e !== undefined) walkExpr(e, (x) => x.kind === "ident_expr" && out.push(x.name))
  return out
}

/** Parse a full POU source and return its (single) graphical body. */
function vgBody(src: string): BodySpan {
  const { units } = parseSource(src)
  const body = unitBodies(units[0]!).find(isGraphicalBody)
  if (body === undefined) throw new Error("no graphical body")
  return body
}

function doc(src: string): Document {
  return { uri: "file:///FB.fb", source: src, parseResult: parseSource(src) }
}

function project(d: Document): Scope {
  return buildSymbolTable([{ uri: d.uri, source: d.source, parseResult: d.parseResult }])
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
NETWORK 0 LD
out := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`

test("network text: an FBD/LD body is detected as graphical, not ST", () => {
  const { units, errors } = parseSource(LD)
  expect(errors).toEqual([]) // ST parser routes around the network-text body — no false parse errors
  expect(unitBodies(units[0]!).some(isGraphicalBody)).toBe(true)
})

test("network text: a single LD network with a sink parses clean", () => {
  const vg = parseNetworkText(vgBody(LD))
  expect(vg.diagnostics).toEqual([])
  expect(vg.networks).toHaveLength(1)
  const n = vg.networks[0]!
  expect(n.index).toBe(0)
  expect(n.language).toBe("LD")
  expect(n.statements).toHaveLength(1)
  const sink = n.statements[0]!
  expect(sink.kind).toBe("sink")
  if (sink.kind === "sink") {
    expect(idents(sink.target)).toEqual(["out"]) // lvalue parsed as an Expr
    expect(idents(sink.value)).toEqual(["a", "b"]) // value parsed as a real ST expression
    expect(sink.value?.kind).toBe("paren") // `(a AND b)` — a parenthesised binary
  }
})

test("network text: LET wire-def keeps its name + producer", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; out : BOOL; END_VAR
NETWORK 1 FBD
LET g := (a AND b);
out := g;
END_NETWORK
END_FUNCTION_BLOCK`
  const vg = parseNetworkText(vgBody(src))
  expect(vg.diagnostics).toEqual([])
  const [wire, sink] = vg.networks[0]!.statements
  expect(wire?.kind).toBe("wire_def")
  if (wire?.kind === "wire_def") {
    expect(wire.name.text).toBe("g")
    expect(idents(wire.producer)).toEqual(["a", "b"]) // producer parsed as an Expr
  }
  expect(sink?.kind).toBe("sink")
  if (sink?.kind === "sink") expect(idents(sink.value)).toEqual(["g"]) // wire reference
})

test("network text: header parses language, label and DISABLED", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 3 FBD 'my label' DISABLED
out := FALSE;
END_NETWORK
END_FUNCTION_BLOCK`
  const n = parseNetworkText(vgBody(src)).networks[0]!
  expect(n.index).toBe(3)
  expect(n.language).toBe("FBD")
  expect(n.label).toBe("my label")
  expect(n.disabled).toBe(true)
})

test("network text: an unclosed network reports NETWORK_NOT_CLOSED", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
out := TRUE;
END_FUNCTION_BLOCK`
  const codes = parseNetworkText(vgBody(src)).diagnostics.map((d) => d.code)
  expect(codes).toContain("NETWORK_NOT_CLOSED")
})

test("network text: a duplicate network index reports NETWORK_DUPLICATE_NETWORK", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
out := TRUE;
END_NETWORK
NETWORK 0 LD
out := FALSE;
END_NETWORK
END_FUNCTION_BLOCK`
  const codes = parseNetworkText(vgBody(src)).diagnostics.map((d) => d.code)
  expect(codes).toContain("NETWORK_DUPLICATE_NETWORK")
})

test("network text: a duplicated LET name reports NETWORK_DUPLICATE_NAME", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; out : BOOL; END_VAR
NETWORK 0 FBD
LET g := (a AND a);
LET g := (a OR a);
out := g;
END_NETWORK
END_FUNCTION_BLOCK`
  const codes = parseNetworkText(vgBody(src)).diagnostics.map((d) => d.code)
  expect(codes).toContain("NETWORK_DUPLICATE_NAME")
})

test("network text: a statement before any network reports NETWORK_PARSE", () => {
  // hand-built body tokens: `out := TRUE;` with no NETWORK — force via a raw graphical-looking body.
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
out := TRUE;
END_NETWORK
JUNK
END_FUNCTION_BLOCK`
  const codes = parseNetworkText(vgBody(src)).diagnostics.map((d) => d.code)
  expect(codes).toContain("NETWORK_PARSE")
})

test("network text: an IF en/eno box is parsed with its condition and inner body", () => {
  const src = `FUNCTION_BLOCK F
VAR en : BOOL; out : BOOL; a : BOOL; END_VAR
NETWORK 0 FBD
LET en := a;
IF en THEN out := TRUE; END_IF
END_NETWORK
END_FUNCTION_BLOCK`
  const vg = parseNetworkText(vgBody(src))
  expect(vg.diagnostics).toEqual([])
  const stmts = vg.networks[0]!.statements
  expect(stmts.map((s) => s.kind)).toEqual(["wire_def", "en_eno_if"])
  const box = stmts[1]!
  expect(box.kind).toBe("en_eno_if")
  if (box.kind === "en_eno_if") {
    expect(idents(box.en)).toEqual(["en"]) // the enable condition
    expect(box.body.map((s) => s.kind)).toEqual(["sink"]) // inner sink recursively parsed
  }
})

test("network text: an FB-instance call with no result binding is an fb_call", () => {
  const src = `FUNCTION_BLOCK F
VAR tmr : TON; t : TIME; on : BOOL; END_VAR
NETWORK 0 FBD
tmr(IN := on, PT := t);
END_NETWORK
END_FUNCTION_BLOCK`
  const vg = parseNetworkText(vgBody(src))
  expect(vg.diagnostics).toEqual([])
  const call = vg.networks[0]!.statements[0]!
  expect(call.kind).toBe("fb_call")
  if (call.kind === "fb_call") expect(call.call?.kind).toBe("call")
})

test("network text: label, JMP and RETURN are recognised", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
Loop:
out := TRUE;
JMP Loop;
RETURN;
END_NETWORK
END_FUNCTION_BLOCK`
  const kinds = parseNetworkText(vgBody(src)).networks[0]!.statements.map((s) => s.kind)
  expect(kinds).toContain("label")
  expect(kinds).toContain("jump")
  expect(kinds).toContain("return")
})

test("network text: computeNetworkTextDiagnostics lifts network text errors into DiagnosticItems for the server", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
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
NETWORK 0 LD
flag := count;
END_NETWORK
END_FUNCTION_BLOCK`
  const items = vgDiags(src)
  expect(items.some((d) => d.code === "assignment-type-mismatch")).toBe(true)
})

test("network text: a well-typed sink over real vars yields no code diagnostic", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; out : BOOL; END_VAR
NETWORK 0 LD
out := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src)).toEqual([])
})

// network-undeclared-identifier — the network-text analogue of ST's unresolved-identifier, sharing its resolution rules.
const vgUndeclared = (src: string, references?: WorkspaceRefs): string[] =>
  computeNetworkTextDiagnostics(doc(src), project(doc(src)), messagesFor("codesys"), references)
    .filter((d) => d.code === "network-undeclared-identifier")
    .map((d) => d.message)

test("network text: an operand declared nowhere IS flagged, byte-identical to the compiler", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
out := nope;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgUndeclared(src)).toEqual(["Identifier 'nope' not defined"])
})

test("network text: declared vars and LET wires resolve (no undeclared diagnostic)", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; out : BOOL; END_VAR
NETWORK 0 FBD
LET w := (a AND b);
out := w;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgUndeclared(src)).toEqual([])
})

// Gap found via corpus: SET/RESET (and RISING/FALLING) are LD coil/edge MODIFIER words, not identifiers.
test("network text: SET / RESET coil modifiers are not flagged as undeclared", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; a : BOOL; END_VAR
NETWORK 0 LD
out := a SET;
out := a RESET;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgUndeclared(src)).toEqual([])
})

test("network text: a referenced-library namespace is skipped when supplied", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 FBD
out := PACK_ML.gFlag;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgUndeclared(src)).toEqual(["Identifier 'PACK_ML' not defined"]) // unknown → flagged
  const refs: WorkspaceRefs = { libraryNamespaces: new Set(["pack_ml"]), deviceInstances: new Set(), obsoletePous: new Map() }
  expect(vgUndeclared(src, refs)).toEqual([]) // known → skipped
})

// network-unknown-member — the network-text analogue of ST's `a.b` member check (wired once the qualified_only binder
// bug that caused the lenze `Mach1` FPs was fixed). Shares `unresolvedMembers` + `notAMember` wording.
test("network text: an unknown struct member IS flagged; a real one stays quiet (network-unknown-member)", () => {
  const src = `TYPE Pt : STRUCT x : INT; END_STRUCT END_TYPE
FUNCTION_BLOCK F
VAR p : Pt; out : INT; END_VAR
NETWORK 0 FBD
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
    "file:///FB_User.fb": `FUNCTION_BLOCK FB_User\nVAR x : BOOL; END_VAR\nNETWORK 0 FBD\nx := Mach1.Genflags.bReady;\nEND_NETWORK\nEND_FUNCTION_BLOCK`,
  }
  const docs = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source) }))
  const proj = buildSymbolTable(docs)
  const fbDoc = docs.find((d) => d.uri === "file:///FB_User.fb")!
  const diags = computeNetworkTextDiagnostics(fbDoc, proj, messagesFor("codesys"))
  expect(diags.filter((d) => d.code === "network-unknown-member")).toEqual([])
  expect(diags.filter((d) => d.code === "network-undeclared-identifier")).toEqual([])
})

const vgByCode = (src: string, code: string): number => vgDiags(src).filter((d) => d.code === code).length

// network text sink pair checks mirror ST via the shared helpers (assignment already tested above).
test("network text: a narrowing sink (LREAL→REAL coil) warns like ST", () => {
  const src = `FUNCTION_BLOCK F
VAR r : REAL; l : LREAL; END_VAR
NETWORK 0 LD
r := l;
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
NETWORK 1 FBD
w := UINT_TO_WORD(i);
END_NETWORK
END_FUNCTION_BLOCK`
  const d = vgDiags(src).find((x) => x.code === "sign-change-conversion")
  expect(d?.severity).toBe("warning")
  expect(d?.message).toBe("Implicit conversion from signed Type 'INT' to unsigned Type 'UINT' : Possible change of sign")
})

// Gap found via a re-harvested corpus: a RESET/SET coil value collides with a same-named enum member.
test("network text: a reset-coil sink (`:= RESET`) is not typed as an enum→BOOL mismatch", () => {
  const src = `TYPE DEVICE_STATE : (START, STOP, RESET); END_TYPE
FUNCTION_BLOCK F
VAR flag : BOOL; END_VAR
NETWORK 0 LD
flag := RESET;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src).filter((d) => d.code === "assignment-type-mismatch")).toEqual([])
})

test("network text: a bad binary operand (MOD on REAL) is flagged like ST", () => {
  const src = `FUNCTION_BLOCK F
VAR a : REAL; b : REAL; out : REAL; END_VAR
NETWORK 0 FBD
out := (a MOD b);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(src, "binary-op-type-mismatch")).toBe(1)
})

// A JUMP GOES TO ANOTHER NETWORK. That is what a jump IS in FBD/LD: each network may carry one label, and
// `JMP name` transfers control to the network carrying it. `NetworkTextWriter` emits that label as `name:` at
// the top of the DESTINATION network's statements (from `Network.Label`, which both drivers read and write), so
// a legitimate forward jump names a label the jumping network does not contain.
//
// Checking labels per network therefore rejects the normal case and accepts only a jump to a label in its own
// network — which is either an infinite loop or a no-op. This is the shape real ladder uses.
test("network text: a JMP may target a label on ANOTHER network", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; out : BOOL; END_VAR
NETWORK 0 LD
IF a THEN JMP Done; END_IF
END_NETWORK
NETWORK 1 LD
Done:
out := TRUE;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(src, "network-undefined-label")).toBe(0)
})

// network-undefined-label — a JMP to a label that exists nowhere in the network.
test("network text: a JMP to an undefined label is flagged; a defined one is not", () => {
  const bad = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
out := TRUE;
JMP Nowhere;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(bad, "network-undefined-label")).toBe(1)
  const good = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
Loop:
out := TRUE;
JMP Loop;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(good, "network-undefined-label")).toBe(0)
})

// network-unknown-pin — an FB box passing a pin the FB doesn't declare (checked only for resolved project FBs).
const FB_M = `FUNCTION_BLOCK FB_M
VAR_INPUT a : BOOL; END_VAR
END_FUNCTION_BLOCK
`
test("network text: an unknown FB pin is flagged; a declared pin is not", () => {
  const bad = `${FB_M}FUNCTION_BLOCK F
VAR m : FB_M; x : BOOL; END_VAR
NETWORK 0 FBD
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
NETWORK 0 FBD
tmr(IN := on, PT := t, MADE_UP := on);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(src, "network-unknown-pin")).toBe(0) // TON is not a project FB → skipped, no guess
})

test("network text: wire types are inferred from producers and chain (LET en2 := en1)", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; out : INT; END_VAR
NETWORK 0 LD
LET en1 := a;
LET en2 := en1;
out := en2;
END_NETWORK
END_FUNCTION_BLOCK`
  // en2 chains off en1 (BOOL); assigning it to an INT coil is a mismatch — proves wires resolve + chain.
  const items = vgDiags(src)
  expect(items.some((d) => d.code === "assignment-type-mismatch")).toBe(true)
})

test("network text: analyzeNetworkText types a wire from its defining expression", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; END_VAR
NETWORK 0 LD
LET g := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`
  const d = doc(src)
  const analysis = analyzeNetworkText(parseSource(src).units[0]!, vgBody(src), project(d), d.uri)
  const scope = [...analysis.networkScopes.values()][0]!
  const wire = scope.symbols.get("g")?.[0]
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
NETWORK 0 LD
LET g := (a AND b);
out := g;
END_NETWORK
END_FUNCTION_BLOCK`

test("network text hover: a wire shows a type INFERRED from its producer (spec §E)", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("out := g") + "out := ".length // the `g` USE
  const h = networkHover(d, project(d), off)
  expect((h as { contents: { value: string } })?.contents.value).toContain("g : BOOL")
})

test("network text hover: a real variable shows its declared type", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("(a AND b)") + 1 // the `a` operand
  const h = networkHover(d, project(d), off)
  expect((h as { contents: { value: string } })?.contents.value).toContain("a : BOOL")
})

test("network text definition: a wire use jumps to its LET definition", () => {
  const d = doc(WIRED)
  const useOff = WIRED.indexOf("out := g") + "out := ".length
  const loc = networkDefinition(d, project(d), useOff)
  const defLine = WIRED.slice(0, WIRED.indexOf("LET g")).split("\n").length - 1 // 0-based line of `LET g`
  expect(loc?.range.start.line).toBe(defLine)
})

test("network text definition: a real-var operand jumps to its declaration", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("(a AND b)") + 1
  const loc = networkDefinition(d, project(d), off)
  expect(loc?.range.start.line).toBe(1) // the VAR line
})

test("network text completion: offers POU vars AND the network's wires", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("out := g") + "out := ".length
  const labels = networkCompletion(d, project(d), off).map((c) => c.label)
  expect(labels).toContain("out") // POU var
  expect(labels).toContain("g") // network wire
})

test("network text resolve: a member chain operand resolves to its field", () => {
  const src = `FUNCTION_BLOCK Inner
VAR Q : BOOL; END_VAR
END_FUNCTION_BLOCK
FUNCTION_BLOCK F
VAR t : Inner; done : BOOL; END_VAR
NETWORK 0 FBD
done := t.Q;
END_NETWORK
END_FUNCTION_BLOCK`
  const d = doc(src)
  const off = src.indexOf("t.Q") + 2 // the `Q` member
  const sym = networkResolveAt(d, project(d), off)
  expect(sym?.name).toBe("Q")
})

test("network text: a CFC/SFC marker hover explains the read-only graphical body (F.2e)", () => {
  const src = `FUNCTION_BLOCK F\nVAR END_VAR\n(* @volt-graphical: CFC *)\nEND_FUNCTION_BLOCK`
  const d = doc(src)
  const off = src.indexOf("@volt-graphical")
  const h = networkMarkerHover(d, off)
  const value = (h as { contents: { value: string } })?.contents.value
  expect(value).toContain("Continuous Function Chart")
  expect(value).toContain("IDE")
  // a CFC marker body is a comment — not analyzed as network text or ST (no diagnostics)
  expect(vgDiags(src)).toEqual([])
})

// ─── cross-body references / rename: a symbol used in BOTH ST and network text bodies ─────

/** A multi-file project: a GVL global read by one FB's ST body and another FB's network text (LD) body. */
function crossBodyProject() {
  const files: Record<string, string> = {
    "file:///G.gvl": `VAR_GLOBAL\n\tFlag : BOOL;\nEND_VAR`,
    "file:///FB_ST.fb": `FUNCTION_BLOCK FB_ST\nFlag := TRUE;\nEND_FUNCTION_BLOCK`,
    "file:///FB_VG.fb": `FUNCTION_BLOCK FB_VG\nVAR\n\tx : BOOL;\nEND_VAR\nNETWORK 0 LD\nx := Flag;\nEND_NETWORK\nEND_FUNCTION_BLOCK`,
  }
  const docs = Object.entries(files).map(([uri, source]) => ({ uri, source, parseResult: parseSource(source) }))
  return { docs, project: buildSymbolTable(docs), by: (uri: string) => docs.find((d) => d.uri === uri)! }
}

test("network text references: a global read in a network-text operand is found from an ST cursor", () => {
  const { docs, project, by } = crossBodyProject()
  const st = by("file:///FB_ST.fb")
  const locs = referencesAnywhere(docs, project, st, st.source.indexOf("Flag"))
  const uris = new Set(locs?.map((l) => l.uri))
  // declaration (GVL) + the ST use + the network-text operand use — the network-text body must not be missed
  expect(uris).toEqual(new Set(["file:///G.gvl", "file:///FB_ST.fb", "file:///FB_VG.fb"]))
})

test("network text rename: renaming from a network-text operand edits every ST and network text occurrence", () => {
  const { docs, project, by } = crossBodyProject()
  const vg = by("file:///FB_VG.fb")
  const edit = renameAnywhere(docs, project, vg, vg.source.indexOf("Flag"), "Enabled")
  const changed = Object.keys(edit?.changes ?? {}).sort()
  expect(changed).toEqual(["file:///FB_ST.fb", "file:///FB_VG.fb", "file:///G.gvl"])
  // the network-text operand edit lands on `Flag` within the LD network
  const vgEdits = edit!.changes!["file:///FB_VG.fb"]!
  expect(vgEdits.every((e) => e.newText === "Enabled")).toBe(true)
})

test("network text references: a cursor outside any symbol resolves to nothing", () => {
  const { docs, project, by } = crossBodyProject()
  const vg = by("file:///FB_VG.fb")
  expect(referencesAnywhere(docs, project, vg, vg.source.indexOf("NETWORK"))).toBeUndefined()
})
