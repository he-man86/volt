import { test, expect } from "bun:test"
import { parseSource, unitBodies, isGraphicalBody, walkExpr, type BodySpan, type Expr } from "../syntax/index.js"
import { buildSymbolTable, type Scope } from "../symbols/index.js"
import { messagesFor, type DiagnosticItem, type WorkspaceRefs } from "../analysis/index.js"
import {
  parseVgBody,
  computeVgDiagnostics,
  documentSymbolsWithVg,
  analyzeVgBody,
  vgHover,
  vgDefinition,
  vgCompletion,
  vgResolveAt,
  vgMarkerHover,
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

/** VG diagnostics for a single-doc project (codesys wording). */
function vgDiags(src: string): DiagnosticItem[] {
  const d = doc(src)
  return computeVgDiagnostics(d, project(d), messagesFor("codesys"))
}

const LD = `FUNCTION_BLOCK FB_LD
VAR
	a : BOOL; b : BOOL; out : BOOL;
END_VAR
NETWORK 0 LD
out := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`

test("VG: an FBD/LD body is detected as graphical, not ST", () => {
  const { units, errors } = parseSource(LD)
  expect(errors).toEqual([]) // ST parser routes around the VG body — no false parse errors
  expect(unitBodies(units[0]!).some(isGraphicalBody)).toBe(true)
})

test("VG: a single LD network with a sink parses clean", () => {
  const vg = parseVgBody(vgBody(LD))
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

test("VG: LET wire-def keeps its name + producer", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; out : BOOL; END_VAR
NETWORK 1 FBD
LET g := (a AND b);
out := g;
END_NETWORK
END_FUNCTION_BLOCK`
  const vg = parseVgBody(vgBody(src))
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

test("VG: header parses language, label and DISABLED", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 3 FBD 'my label' DISABLED
out := FALSE;
END_NETWORK
END_FUNCTION_BLOCK`
  const n = parseVgBody(vgBody(src)).networks[0]!
  expect(n.index).toBe(3)
  expect(n.language).toBe("FBD")
  expect(n.label).toBe("my label")
  expect(n.disabled).toBe(true)
})

test("VG: an unclosed network reports VG_NETWORK_NOT_CLOSED", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
out := TRUE;
END_FUNCTION_BLOCK`
  const codes = parseVgBody(vgBody(src)).diagnostics.map((d) => d.code)
  expect(codes).toContain("VG_NETWORK_NOT_CLOSED")
})

test("VG: a duplicate network index reports VG_DUPLICATE_NETWORK", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
out := TRUE;
END_NETWORK
NETWORK 0 LD
out := FALSE;
END_NETWORK
END_FUNCTION_BLOCK`
  const codes = parseVgBody(vgBody(src)).diagnostics.map((d) => d.code)
  expect(codes).toContain("VG_DUPLICATE_NETWORK")
})

test("VG: a duplicated LET name reports VG_DUPLICATE_NAME", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; out : BOOL; END_VAR
NETWORK 0 FBD
LET g := (a AND a);
LET g := (a OR a);
out := g;
END_NETWORK
END_FUNCTION_BLOCK`
  const codes = parseVgBody(vgBody(src)).diagnostics.map((d) => d.code)
  expect(codes).toContain("VG_DUPLICATE_NAME")
})

test("VG: a statement before any network reports VG_PARSE", () => {
  // hand-built body tokens: `out := TRUE;` with no NETWORK — force via a raw graphical-looking body.
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
out := TRUE;
END_NETWORK
JUNK
END_FUNCTION_BLOCK`
  const codes = parseVgBody(vgBody(src)).diagnostics.map((d) => d.code)
  expect(codes).toContain("VG_PARSE")
})

test("VG: an IF en/eno box is parsed with its condition and inner body", () => {
  const src = `FUNCTION_BLOCK F
VAR en : BOOL; out : BOOL; a : BOOL; END_VAR
NETWORK 0 FBD
LET en := a;
IF en THEN out := TRUE; END_IF
END_NETWORK
END_FUNCTION_BLOCK`
  const vg = parseVgBody(vgBody(src))
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

test("VG: an FB-instance call with no result binding is an fb_call", () => {
  const src = `FUNCTION_BLOCK F
VAR tmr : TON; t : TIME; on : BOOL; END_VAR
NETWORK 0 FBD
tmr(IN := on, PT := t);
END_NETWORK
END_FUNCTION_BLOCK`
  const vg = parseVgBody(vgBody(src))
  expect(vg.diagnostics).toEqual([])
  const call = vg.networks[0]!.statements[0]!
  expect(call.kind).toBe("fb_call")
  if (call.kind === "fb_call") expect(call.call?.kind).toBe("call")
})

test("VG: label, JMP and RETURN are recognised", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
Loop:
out := TRUE;
JMP Loop;
RETURN;
END_NETWORK
END_FUNCTION_BLOCK`
  const kinds = parseVgBody(vgBody(src)).networks[0]!.statements.map((s) => s.kind)
  expect(kinds).toContain("label")
  expect(kinds).toContain("jump")
  expect(kinds).toContain("return")
})

test("VG: computeVgDiagnostics lifts VG errors into DiagnosticItems for the server", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
out := TRUE;
END_FUNCTION_BLOCK`
  const items = vgDiags(src)
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({ severity: "error", source: "volt-lsp-iec", code: "VG_NETWORK_NOT_CLOSED" })
})

test("VG: a clean ST body yields zero VG diagnostics", () => {
  const st = `FUNCTION_BLOCK F
VAR i : INT; END_VAR
i := i + 1;
END_FUNCTION_BLOCK`
  expect(vgDiags(st)).toEqual([])
})

test("VG: a sink type mismatch is flagged with the SAME check/message as ST", () => {
  const src = `FUNCTION_BLOCK F
VAR flag : BOOL; count : INT; END_VAR
NETWORK 0 LD
flag := count;
END_NETWORK
END_FUNCTION_BLOCK`
  const items = vgDiags(src)
  expect(items.some((d) => d.code === "assignment-type-mismatch")).toBe(true)
})

test("VG: a well-typed sink over real vars yields no code diagnostic", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; out : BOOL; END_VAR
NETWORK 0 LD
out := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src)).toEqual([])
})

// vg-undeclared-identifier — the VG analogue of ST's unresolved-identifier, sharing its resolution rules.
const vgUndeclared = (src: string, references?: WorkspaceRefs): string[] =>
  computeVgDiagnostics(doc(src), project(doc(src)), messagesFor("codesys"), references)
    .filter((d) => d.code === "vg-undeclared-identifier")
    .map((d) => d.message)

test("VG: an operand declared nowhere IS flagged, byte-identical to the compiler", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
out := nope;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgUndeclared(src)).toEqual(["Identifier 'nope' not defined"])
})

test("VG: declared vars and LET wires resolve (no undeclared diagnostic)", () => {
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
test("VG: SET / RESET coil modifiers are not flagged as undeclared", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; a : BOOL; END_VAR
NETWORK 0 LD
out := a SET;
out := a RESET;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgUndeclared(src)).toEqual([])
})

test("VG: a referenced-library namespace is skipped when supplied", () => {
  const src = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 FBD
out := PACK_ML.gFlag;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgUndeclared(src)).toEqual(["Identifier 'PACK_ML' not defined"]) // unknown → flagged
  const refs: WorkspaceRefs = { libraryNamespaces: new Set(["pack_ml"]), deviceInstances: new Set() }
  expect(vgUndeclared(src, refs)).toEqual([]) // known → skipped
})

const vgByCode = (src: string, code: string): number => vgDiags(src).filter((d) => d.code === code).length

// VG sink pair checks mirror ST via the shared helpers (assignment already tested above).
test("VG: a narrowing sink (LREAL→REAL coil) warns like ST", () => {
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

// Gap found via a re-harvested corpus: a RESET/SET coil value collides with a same-named enum member.
test("VG: a reset-coil sink (`:= RESET`) is not typed as an enum→BOOL mismatch", () => {
  const src = `TYPE DEVICE_STATE : (START, STOP, RESET); END_TYPE
FUNCTION_BLOCK F
VAR flag : BOOL; END_VAR
NETWORK 0 LD
flag := RESET;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src).filter((d) => d.code === "assignment-type-mismatch")).toEqual([])
})

test("VG: a bad binary operand (MOD on REAL) is flagged like ST", () => {
  const src = `FUNCTION_BLOCK F
VAR a : REAL; b : REAL; out : REAL; END_VAR
NETWORK 0 FBD
out := (a MOD b);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(src, "binary-op-type-mismatch")).toBe(1)
})

// vg-undefined-label — a JMP to a label that exists nowhere in the network.
test("VG: a JMP to an undefined label is flagged; a defined one is not", () => {
  const bad = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
out := TRUE;
JMP Nowhere;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(bad, "vg-undefined-label")).toBe(1)
  const good = `FUNCTION_BLOCK F
VAR out : BOOL; END_VAR
NETWORK 0 LD
Loop:
out := TRUE;
JMP Loop;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(good, "vg-undefined-label")).toBe(0)
})

// vg-unknown-pin — an FB box passing a pin the FB doesn't declare (checked only for resolved project FBs).
const FB_M = `FUNCTION_BLOCK FB_M
VAR_INPUT a : BOOL; END_VAR
END_FUNCTION_BLOCK
`
test("VG: an unknown FB pin is flagged; a declared pin is not", () => {
  const bad = `${FB_M}FUNCTION_BLOCK F
VAR m : FB_M; x : BOOL; END_VAR
NETWORK 0 FBD
m(b := x);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(bad, "vg-unknown-pin")).toBe(1)
  const good = bad.replace("m(b := x)", "m(a := x)")
  expect(vgByCode(good, "vg-unknown-pin")).toBe(0)
})

test("VG: a box on an unresolvable (library/standard) FB is not pin-checked", () => {
  const src = `FUNCTION_BLOCK F
VAR tmr : TON; on : BOOL; t : TIME; END_VAR
NETWORK 0 FBD
tmr(IN := on, PT := t, MADE_UP := on);
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgByCode(src, "vg-unknown-pin")).toBe(0) // TON is not a project FB → skipped, no guess
})

test("VG: wire types are inferred from producers and chain (LET en2 := en1)", () => {
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

test("VG: analyzeVgBody types a wire from its defining expression", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; b : BOOL; END_VAR
NETWORK 0 LD
LET g := (a AND b);
END_NETWORK
END_FUNCTION_BLOCK`
  const d = doc(src)
  const analysis = analyzeVgBody(parseSource(src).units[0]!, vgBody(src), project(d), d.uri)
  const scope = [...analysis.networkScopes.values()][0]!
  const wire = scope.symbols.get("g")?.[0]
  expect(wire?.typeExpr?.kind).toBe("named_type")
  if (wire?.typeExpr?.kind === "named_type") expect(wire.typeExpr.name.text).toBe("BOOL")
})

test("VG: document outline attaches networks under their POU", () => {
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

test("VG hover: a wire shows a type INFERRED from its producer (spec §E)", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("out := g") + "out := ".length // the `g` USE
  const h = vgHover(d, project(d), off)
  expect((h as { contents: { value: string } })?.contents.value).toContain("g : BOOL")
})

test("VG hover: a real variable shows its declared type", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("(a AND b)") + 1 // the `a` operand
  const h = vgHover(d, project(d), off)
  expect((h as { contents: { value: string } })?.contents.value).toContain("a : BOOL")
})

test("VG definition: a wire use jumps to its LET definition", () => {
  const d = doc(WIRED)
  const useOff = WIRED.indexOf("out := g") + "out := ".length
  const loc = vgDefinition(d, project(d), useOff)
  const defLine = WIRED.slice(0, WIRED.indexOf("LET g")).split("\n").length - 1 // 0-based line of `LET g`
  expect(loc?.range.start.line).toBe(defLine)
})

test("VG definition: a real-var operand jumps to its declaration", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("(a AND b)") + 1
  const loc = vgDefinition(d, project(d), off)
  expect(loc?.range.start.line).toBe(1) // the VAR line
})

test("VG completion: offers POU vars AND the network's wires", () => {
  const d = doc(WIRED)
  const off = WIRED.indexOf("out := g") + "out := ".length
  const labels = vgCompletion(d, project(d), off).map((c) => c.label)
  expect(labels).toContain("out") // POU var
  expect(labels).toContain("g") // network wire
})

test("VG resolve: a member chain operand resolves to its field", () => {
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
  const sym = vgResolveAt(d, project(d), off)
  expect(sym?.name).toBe("Q")
})

test("VG: a CFC/SFC marker hover explains the read-only graphical body (F.2e)", () => {
  const src = `FUNCTION_BLOCK F\nVAR END_VAR\n(* @volt-graphical: CFC *)\nEND_FUNCTION_BLOCK`
  const d = doc(src)
  const off = src.indexOf("@volt-graphical")
  const h = vgMarkerHover(d, off)
  const value = (h as { contents: { value: string } })?.contents.value
  expect(value).toContain("Continuous Function Chart")
  expect(value).toContain("IDE")
  // a CFC marker body is a comment — not analyzed as VG or ST (no diagnostics)
  expect(vgDiags(src)).toEqual([])
})
