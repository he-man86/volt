import { test, expect } from "bun:test"
import { parseSource } from "../syntax/index.js"
import { buildSymbolTable, type Scope } from "../symbols/index.js"
import { messagesFor, type DiagnosticItem } from "../analysis/index.js"
import { computeNetworkTextDiagnostics } from "./index.js"
import type { Document } from "../services/index.js"

/**
 * SHAPES A REAL PROJECT WRITES, which the LSP must not report as mistakes.
 *
 * Pulling `Lenze_MID-S100_V5_00_602_T51` — 373 engineer-drawn networks — forced changes to the network-text
 * FORMAT itself, not just to the reader. The LSP does not know about those yet, and the risk is not that it
 * misses a diagnostic: it is that it INVENTS one. A false error on ordinary ladder content is worse than a
 * missing check, because it trains an engineer to stop reading the squiggles.
 *
 * `network-text-placement-rules` §2.3/§2.4 are the confirmations. These are the counts that must stay zero.
 */

function doc(src: string): Document {
  return { uri: "file:///FB.fb", source: src, parseResult: parseSource(src) }
}
function project(d: Document): Scope {
  return buildSymbolTable([{ uri: d.uri, source: d.source, parseResult: d.parseResult }])
}
function diags(src: string): DiagnosticItem[] {
  const d = doc(src)
  return computeNetworkTextDiagnostics(d, project(d), messagesFor("codesys"))
}

/** A POU whose VAR block declares everything the networks below reference. */
const wrap = (networks: string) => `FUNCTION_BLOCK FB_Real
VAR
\ta : BOOL;
\tb : BOOL;
\tout : BOOL;
\tcoil : BOOL;
\tiRPM : INT;
\tiDec : INT;
\tctu : CTU;
\tt1 : TON;
END_VAR

${networks}
END_FUNCTION_BLOCK
`

// ── §2.3 the empty slot is grammar, not a typo ────────────────────────────────────────────────
// A pin connected to nothing is written as NOTHING, in whichever operand position it occupies. 110 networks in
// one project; half the ladders there have one. Every form below is real content.

const EMPTY_SLOT_FORMS: ReadonlyArray<[string, string]> = [
  ["a missing left operand", "NETWORK 0 FBD\n  out := ( * iRPM * 6);\nEND_NETWORK"],
  ["missing named-argument values", "NETWORK 0 FBD\n  ctu(CU := a, RESET := , PV := );\nEND_NETWORK"],
  ["a missing leading positional", "NETWORK 0 FBD\n  MOVE(, iDec);\nEND_NETWORK"],
  ["a missing trailing positional", "NETWORK 0 FBD\n  MOVE(iRPM, );\nEND_NETWORK"],
  ["an unwired coil", "NETWORK 0 LD\n  coil := ;\nEND_NETWORK"],
  ["a bare statement terminator", "NETWORK 0 LD\n  ;\nEND_NETWORK"],
]

for (const [what, network] of EMPTY_SLOT_FORMS) {
  test(`an unwired pin parses and is not an error: ${what}`, () => {
    const errors = diags(wrap(network)).filter((d) => d.severity === "error")
    expect(errors.map((d) => `${d.code}: ${d.message}`)).toEqual([])
  })
}

// ── §2.4 a positional call may stand alone as a statement ─────────────────────────────────────
// A box whose output goes nowhere IS a statement — `MOVE(g0, iDec);`, 34 networks in one project. Any rule that
// assumed a bare call is an FB-instance invocation, and that a missing `PIN :=` is a mistake, is wrong.

test("a standalone positional call is a statement, not a malformed FB call", () => {
  const errors = diags(wrap("NETWORK 0 FBD\n  MOVE(iRPM, iDec);\nEND_NETWORK")).filter((d) => d.severity === "error")
  expect(errors.map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

test("a standalone call mixing a wire and a variable is accepted", () => {
  const src = wrap("NETWORK 0 FBD\n  LET g0 := (a AND b);\n  MOVE(g0, iDec);\nEND_NETWORK")
  const errors = diags(src).filter((d) => d.severity === "error")
  expect(errors.map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

// ── the modifier / box distinction, which turns on a single space ─────────────────────────────
// `NOT x` is the negation MODIFIER (a dot on the pin); `NOT(x)` is a BOX named NOT. Both are real and the
// difference is whether the parenthesis is adjacent — so the LSP must accept both without complaint.

test("both spellings of NOT are accepted", () => {
  for (const form of ["out := NOT a;", "out := NOT(a);"]) {
    const errors = diags(wrap(`NETWORK 0 FBD\n  ${form}\nEND_NETWORK`)).filter((d) => d.severity === "error")
    expect(errors.map((d) => `${form} -> ${d.code}: ${d.message}`)).toEqual([])
  }
})

// ── an opaque leaf is ONE variable, not the expression its text spells ────────────────────────
// `LET i<n> := <text>` is a single `inVariable` whose text is not a safe token. Parsing it as a call box turned
// one variable into a whole box the next push would have BUILT in the IDE.

test("an opaque leaf binding is not reported as an undeclared call", () => {
  const src = wrap("NETWORK 0 FBD\n  LET i1 := DINT_TO_REAL(iRPM);\n  t1(IN := a, PT := T#1s);\nEND_NETWORK")
  const errors = diags(src).filter((d) => d.severity === "error")
  expect(errors.map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

// ── §2.1 `???` is a compile error, and the LSP can say so before the build ────────────────────

const unresolved = (src: string) => diags(src).filter((d) => d.code === "NETWORK_UNRESOLVED_BOX")

test("an unresolved box operand is an error", () => {
  const got = unresolved(wrap("NETWORK 0 FBD\n  out := (??? AND a);\nEND_NETWORK"))
  expect(got.length).toBe(1)
  expect(got[0]!.severity).toBe("error")
  expect(got[0]!.message).toContain("will not compile")
})

test("an unresolved box as an ASSIGNMENT TARGET is an error too", () => {
  // The shape a real project actually carried: `??? := ioAxis.xVirtual;`
  expect(unresolved(wrap("NETWORK 0 FBD\n  ??? := a;\nEND_NETWORK")).length).toBe(1)
})

test("the span covers all three marks, so the squiggle sits on the marker", () => {
  const src = wrap("NETWORK 0 FBD\n  out := (??? AND a);\nEND_NETWORK")
  const d = unresolved(src)[0]!
  expect(src.slice(d.span.start, d.span.end)).toBe("???")
})

test("two unresolved boxes are two diagnostics, not six", () => {
  expect(unresolved(wrap("NETWORK 0 FBD\n  out := (??? AND ???);\nEND_NETWORK")).length).toBe(2)
})

test("a `???` inside a network TITLE is not reported", () => {
  // The lexer keeps a title as one string token, so the token walk skips it — this pins that it stays true.
  expect(unresolved(wrap('NETWORK 0 FBD "why ??? here"\n  out := a;\nEND_NETWORK')).length).toBe(0)
})

test("a `???` inside a COMMENT is not reported", () => {
  expect(unresolved(wrap("NETWORK 0 FBD\n  // what ??? means\n  out := a;\nEND_NETWORK")).length).toBe(0)
})

test("spaced question marks are not the vendor's marker", () => {
  // `? ? ?` is not `???`. Adjacency is checked on spans precisely so this does not false-positive.
  expect(unresolved(wrap("NETWORK 0 FBD\n  // ? ? ?\n  out := a;\nEND_NETWORK")).length).toBe(0)
})

test("an ordinary body reports no unresolved boxes", () => {
  expect(unresolved(wrap("NETWORK 0 LD\n  out := (a AND b);\nEND_NETWORK")).length).toBe(0)
})

// ── §3 metadata PLACEMENT — relocating a refusal the push already makes ──────────────────────
// Measured 2026-09-03 (engine `MetadataPlacementTests`): the push refuses these. These pin that the editor
// says so first, in the engineer's terms. The LABEL half is now structural — it is a header field, so the
// placement and duplicate rules it needed are things the grammar no longer lets you express.

const byCode = (src: string, code: string) => diags(src).filter((d) => d.code === code)

test("a second label in one network is an error, in the reader's own words", () => {
  // Naming the field makes a second label a REPEATED FIELD rather than a stray statement, but it is still
  // refused: taking the last one silently would drop a target a `JMP` may already name.
  const got = byCode(wrap("NETWORK 0 LD LABEL: First LABEL: Second\n  out := a;\nEND_NETWORK"), "NETWORK_DUPLICATE_NAME")
  expect(got.length).toBe(1)
  expect(got[0]!.severity).toBe("error")
  // Byte-identical to the engine reader's refusal, so one fact has one phrasing.
  expect(got[0]!.message).toBe(
    "label 'Second' - the network already declares the label 'First'; a network is a single jump target",
  )
})

// The label CANNOT be misplaced any more — it is a header field, so there is no position for it to be in.
// The rule was not relaxed; the model stopped admitting the mistake, which is what the move bought.
test("a label has no placement rule left to break — it lives on the header", () => {
  const src = wrap("NETWORK 0 LD LABEL: Guard\n  out := a;\n  b := a;\nEND_NETWORK")
  expect(diags(src).map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

// A bare `name:` line is what the label USED to be. It is refused, and the message says where it went.
test("the old body-label form is refused and points at the header", () => {
  const got = byCode(wrap("NETWORK 0 LD\n  out := a;\n  Later:\n  b := a;\nEND_NETWORK"), "NETWORK_PARSE")
  expect(got.length).toBe(1)
  expect(got[0]!.message).toContain("LABEL: Later")
})

test("a comment after a statement warns that it will move", () => {
  const got = byCode(wrap("NETWORK 0 LD\n  out := a;\n  // trailing\nEND_NETWORK"), "NETWORK_COMMENT_NOT_FIRST")
  expect(got.length).toBe(1)
  expect(got[0]!.severity).toBe("warning")
})

test("the canonical shape — label then comment, both at the head — is silent", () => {
  const src = wrap(
    'NETWORK 0 LD LABEL: Guard TITLE: "interlock"\n  // holds the drive off\n  out := (a AND b);\nEND_NETWORK',
  )
  expect(diags(src).map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

test("several comment LINES before the first statement are NOT reported", () => {
  // `Network.Comment` is multi-line: the lines are joined and round-trip exactly. The proposal called this data
  // loss and asked for a warning; measuring showed there is no loss, so a warning would fire on correct text.
  const src = wrap("NETWORK 0 LD\n  // first line\n  // second line\n  out := a;\nEND_NETWORK")
  expect(diags(src).map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

// Ordering between the label and the comment used to be a live question — the writer emitted one order, the
// reader took either, and getting it wrong failed the canonical-form gate. On the header the question cannot
// be asked: the label is a field, the comment is still the first statement, and neither can precede the other.
test("the label/comment ordering question no longer exists", () => {
  const labelFirst = wrap('NETWORK 0 LD LABEL: Guard TITLE: "t"\n  // why\n  out := a;\nEND_NETWORK')
  const titleFirst = wrap('NETWORK 0 LD TITLE: "t" LABEL: Guard\n  // why\n  out := a;\nEND_NETWORK')
  expect(diags(labelFirst).map((d) => d.code)).toEqual([])
  expect(diags(titleFirst).map((d) => d.code)).toEqual([])
})
