import { test, expect } from "bun:test"
import { parseSource } from "../frontend/syntax/index.js"
import { build, type Scope } from "../frontend/symbols/index.js"
import { messagesFor, type DiagnosticItem } from "../analysis/index.js"
import { computeNetworkTextDiagnostics } from "./index.js"
import type { Document } from "../services/shared/index.js"

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
  return { uri: "file:///FB.pou", source: src, parseResult: parseSource(src, { networkText: true }) }
}
function project(d: Document): Scope {
  return build.buildSymbolTable([{ uri: d.uri, source: d.source, parseResult: d.parseResult }])
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
  ["a missing left operand", "IMPLEMENTATION FBD\nNETWORK\n  out := ( * iRPM * 6);\nEND_NETWORK"],
  ["missing named-argument values", "IMPLEMENTATION FBD\nNETWORK\n  ctu(CU := a, RESET := , PV := );\nEND_NETWORK"],
  ["a missing leading positional", "IMPLEMENTATION FBD\nNETWORK\n  MOVE(, iDec);\nEND_NETWORK"],
  ["a missing trailing positional", "IMPLEMENTATION FBD\nNETWORK\n  MOVE(iRPM, );\nEND_NETWORK"],
  ["an unwired coil", "IMPLEMENTATION LD\nNETWORK\n  coil := ;\nEND_NETWORK"],
  ["a bare statement terminator", "IMPLEMENTATION LD\nNETWORK\n  ;\nEND_NETWORK"],
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
  const errors = diags(wrap("IMPLEMENTATION FBD\nNETWORK\n  MOVE(iRPM, iDec);\nEND_NETWORK")).filter((d) => d.severity === "error")
  expect(errors.map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

test("a standalone call mixing a wire and a variable is accepted", () => {
  const src = wrap("IMPLEMENTATION FBD\nNETWORK\n  VAR_TEMP g0 : BOOL; END_VAR\n  g0 := (a AND b);\n  MOVE(g0, iDec);\nEND_NETWORK")
  const errors = diags(src).filter((d) => d.severity === "error")
  expect(errors.map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

// ── the modifier / box distinction, which turns on a single space ─────────────────────────────
// `NOT x` is the negation MODIFIER (a dot on the pin); `NOT(x)` is a BOX named NOT. Both are real and the
// difference is whether the parenthesis is adjacent — so the LSP must accept both without complaint.

test("both spellings of NOT are accepted", () => {
  for (const form of ["out := NOT a;", "out := NOT(a);"]) {
    const errors = diags(wrap(`IMPLEMENTATION FBD
NETWORK\n  ${form}\nEND_NETWORK`)).filter((d) => d.severity === "error")
    expect(errors.map((d) => `${form} -> ${d.code}: ${d.message}`)).toEqual([])
  }
})

// ── an opaque leaf is ONE variable, not the expression its text spells ────────────────────────
// A single `inVariable` whose text is not a safe token. Parsing it as a call box turned one variable into a whole box
// the next push would have BUILT in the IDE; v2 keeps it between backticks.

test("a backticked operand is ONE operand, checked as the ST its text is", () => {
  // An operand whose text is not one token (`DINT_TO_REAL(iRPM)`) is ONE vendor operand; v1 hoisted it into a
  // `LET i<n>`, v2 backticks it in place. Its text is still ST, so an undeclared name inside it is still reported.
  const src = wrap("IMPLEMENTATION FBD\nNETWORK\n  t1(IN := a, PT := `DINT_TO_TIME(iRPM)`);\nEND_NETWORK")
  const errors = diags(src).filter((d) => d.severity === "error")
  expect(errors.map((d) => `${d.code}: ${d.message}`)).toEqual([])
  expect(diags(src.replace("DINT_TO_TIME(iRPM)", "DINT_TO_TIME(nope)")).map((d) => d.message)).toContain("Identifier 'nope' not defined")
})

// ── §2.1 `???` is a compile error, and the LSP can say so before the build ────────────────────

const unresolved = (src: string) => diags(src).filter((d) => d.code === "NETWORK_UNRESOLVED_BOX")

// THE MESSAGE IS THE COMPILER'S, AND IT DEPENDS ON THE SLOT. Both strings below are CODESYS's own, recorded
// live and held byte-for-byte by `test/conformance/fixtures/network-unresolved.ts`. Until 2026-09-05 the LSP
// answered every position with one invented sentence - "a box whose INSTANCE the IDE could not resolve" -
// which is simply false on an input pin or a coil, where no instance exists.
const OPERAND_MSG = "Expression expected instead of '?'"
const OPERAND_TOKEN_MSG = "Unexpected token '?' found"
const TARGET_MSG = "The assignment target is not specified."

// AN OPERAND MARKER CARRIES BOTH OF THE COMPILER'S MESSAGES. CODESYS answers one `???` in an operand slot
// with two errors - the position and the token - and both are reproducible, so the LSP emits both and the
// conformance replay matches those fixtures EXACTLY rather than as a subset. Their spans differ (the whole
// marker vs the `?` it choked on), which is also what keeps the corpus no-duplicate-(range,code) rule happy.
const messagesOf = (src: string): string[] => unresolved(src).map((d) => d.message).sort()

test("an unresolved box operand gets BOTH of the compiler's messages", () => {
  const src = wrap("IMPLEMENTATION FBD\nNETWORK\n  out := (??? AND a);\nEND_NETWORK")
  expect(unresolved(src).every((d) => d.severity === "error")).toBe(true)
  expect(messagesOf(src)).toEqual([OPERAND_MSG, OPERAND_TOKEN_MSG].sort())
})

test("an unresolved box on an INPUT PIN reads as an operand too", () => {
  expect(messagesOf(wrap("IMPLEMENTATION FBD\nNETWORK\n  ctu(CU := ???, RESET := , PV := );\nEND_NETWORK"))).toEqual(
    [OPERAND_MSG, OPERAND_TOKEN_MSG].sort(),
  )
})
test("an unresolved box as an ASSIGNMENT TARGET gets the TARGET message", () => {
  // The shape a real project actually carried: `??? := ioAxis.xVirtual;`
  const got = unresolved(wrap("IMPLEMENTATION FBD\nNETWORK\n  ??? := a;\nEND_NETWORK"))
  expect(got.length).toBe(1)
  expect(got[0]!.message).toBe(TARGET_MSG)
})

// BOTH VENDORS REPORT THESE, and they disagree on nothing but capitalisation and a full stop (recorded on
// both, `network_unnamed_*`, 2026-09-20). The wording is data in `messagesFor`, so the check itself does not
// branch — this is the test that the branch is in the table and not in the code.
test("the vendors word the unresolved-box messages differently", () => {
  const tc = (src: string): string[] =>
    computeNetworkTextDiagnostics(doc(src), project(doc(src)), messagesFor("twincat"))
      .filter((d) => d.code === "NETWORK_UNRESOLVED_BOX")
      .map((d) => d.message)
      .sort()
  expect(tc(wrap("IMPLEMENTATION FBD\nNETWORK\n  ??? := a;\nEND_NETWORK"))).toEqual(["Assignment target not specified"])
  expect(tc(wrap("IMPLEMENTATION FBD\nNETWORK\n  out := (??? AND a);\nEND_NETWORK"))).toEqual(
    [OPERAND_MSG, "Unexpected Token '?' found"].sort(),
  )
})
test("a coil's STORAGE operator marks a target as surely as `:=`", () => {
  // `S=`/`R=` are the coil-kind spelling, so they end a target just like `:=` - reading only `:=` would send
  // a SET coil down the operand arm and print the wrong compiler message.
  for (const op of ["S=", "R="]) {
    const got = unresolved(wrap(`IMPLEMENTATION LD
NETWORK\n  ??? ${op} a;\nEND_NETWORK`))
    expect(got.length, op).toBe(1)
    expect(got[0]!.message, op).toBe(TARGET_MSG)
  }
})

test("the span covers all three marks, so the squiggle sits on the marker", () => {
  const src = wrap("IMPLEMENTATION FBD\nNETWORK\n  out := (??? AND a);\nEND_NETWORK")
  const d = unresolved(src)[0]!
  expect(src.slice(d.span.start, d.span.end)).toBe("???")
})

test("two markers are two markers, not six tokens", () => {
  // The marker is THREE `?` tokens and the walk must not report each one. Two operand markers = two
  // markers x the compiler's two messages = 4, never 6 (or 12).
  expect(unresolved(wrap("IMPLEMENTATION FBD\nNETWORK\n  out := (??? AND ???);\nEND_NETWORK")).length).toBe(4)
})

test("a `???` inside a network TITLE is not reported", () => {
  // The lexer keeps a title as one string token, so the token walk skips it — this pins that it stays true.
  const src = wrap('IMPLEMENTATION FBD\nNETWORK TITLE: "why ??? here"\n  out := a;\nEND_NETWORK')
  expect(diags(src)).toEqual([])
})

test("a `???` inside a COMMENT is not reported", () => {
  expect(unresolved(wrap("IMPLEMENTATION FBD\nNETWORK\n  // what ??? means\n  out := a;\nEND_NETWORK")).length).toBe(0)
})

test("spaced question marks are not the vendor's marker", () => {
  // `? ? ?` is not `???`. Adjacency is checked on spans precisely so this does not false-positive.
  expect(unresolved(wrap("IMPLEMENTATION FBD\nNETWORK\n  // ? ? ?\n  out := a;\nEND_NETWORK")).length).toBe(0)
})

test("an ordinary body reports no unresolved boxes", () => {
  expect(unresolved(wrap("IMPLEMENTATION LD\nNETWORK\n  out := (a AND b);\nEND_NETWORK")).length).toBe(0)
})

// ── §3 metadata PLACEMENT — the header and its comment ─────────────────────────────────────────
// The LABEL is a header field, so the placement and duplicate rules it once needed are things the grammar no longer
// lets you express; a comment below a statement is refused outright, as the push refuses it.

const byCode = (src: string, code: string) => diags(src).filter((d) => d.code === code)

test("a second label in one network is an error, in the reader's own words", () => {
  // Naming the field makes a second label a REPEATED FIELD rather than a stray statement, but it is still refused:
  // taking the last one silently would drop a target a `JMP` may already name. The bridge reader's code and words.
  const got = byCode(wrap("IMPLEMENTATION LD\nNETWORK LABEL: First LABEL: Second\n  out := a;\nEND_NETWORK"), "NETWORK_PARSE")
  expect(got.length).toBe(1)
  expect(got[0]!.severity).toBe("error")
  expect(got[0]!.message).toBe("a NETWORK header carries LABEL twice.")
})

test("a label has no placement rule left to break — it lives on the header", () => {
  // The one thing the build says about a label nothing jumps to is that (census 1.15), and so does the LSP.
  const src = wrap("IMPLEMENTATION LD\nNETWORK LABEL: Guard\n  out := a;\n  b := a;\nEND_NETWORK")
  expect(diags(src).map((d) => `${d.code}: ${d.message}`)).toEqual(["jump-label-unreferenced: The label 'GUARD' has not been referenced"])
})

test("the old body-label form is no statement", () => {
  const got = byCode(wrap("IMPLEMENTATION LD\nNETWORK\n  out := a;\n  Later:\n  b := a;\nEND_NETWORK"), "NETWORK_PARSE")
  expect(got.length).toBe(1)
})

test("a comment after a statement is refused, never moved", () => {
  // NWL holds one comment per network and none per item, so a `//` below a statement has nowhere to go. v1 moved it to
  // the head on the next pull and the LSP warned about the move; v2 refuses it, as the push does
  // (`NetworkTextGateTests.A_comment_after_a_statement_is_refused_never_moved`).
  const got = byCode(wrap("IMPLEMENTATION LD\nNETWORK\n  out := a;\n  // trailing\nEND_NETWORK"), "NETWORK_PARSE")
  expect(got.length).toBe(1)
  expect(got[0]!.severity).toBe("error")
})

test("the canonical shape — header, then comment — says only what the build says", () => {
  const src = wrap(
    'IMPLEMENTATION LD\nNETWORK LABEL: Guard TITLE: "interlock"\n  // holds the drive off\n  out := (a AND b);\nEND_NETWORK\nNETWORK\n  JMP Guard;\nEND_NETWORK',
  )
  expect(diags(src).map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

test("several comment LINES before the first statement are NOT reported", () => {
  // `Network.Comment` is multi-line: the lines are joined and round-trip exactly. The proposal called this data
  // loss and asked for a warning; measuring showed there is no loss, so a warning would fire on correct text.
  const src = wrap("IMPLEMENTATION LD\nNETWORK\n  // first line\n  // second line\n  out := a;\nEND_NETWORK")
  expect(diags(src).map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

test("the label/comment ordering question no longer exists", () => {
  // The label is a header field and the comment the lines after the header, so neither can precede the other. The
  // FIELD order is the gate's (NETWORK_NOT_CANONICAL, which needs the writer); the parser reads both.
  const jumps = "\nNETWORK\n  JMP Guard;\nEND_NETWORK"
  const labelFirst = wrap('IMPLEMENTATION LD\nNETWORK LABEL: Guard TITLE: "t"\n  // why\n  out := a;\nEND_NETWORK' + jumps)
  const titleFirst = wrap('IMPLEMENTATION LD\nNETWORK TITLE: "t" LABEL: Guard\n  // why\n  out := a;\nEND_NETWORK' + jumps)
  expect(diags(labelFirst).map((d) => d.code)).toEqual([])
  expect(diags(titleFirst).map((d) => d.code)).toEqual([])
})

// ── §2.2 an unnamed instance carries its TYPE ────────────────────────────────────────────────

test("`??? : TYPE(PIN := v)` parses as a call, so the box's pins are still resolved", () => {
  // The format spells the type inline for exactly this instance: `???` is declared nowhere, so the push has
  // no declaration to read the type off (Lenze_MID-S100 `POU.pou`, four such boxes). Parsing it as a call is
  // what keeps the PINS analyzed — read as an unknown statement, an undeclared operand inside one would go
  // unreported.
  const got = diags(wrap("IMPLEMENTATION FBD\nNETWORK\n  ??? : TON(IN := notDeclaredAnywhere, PT := );\nEND_NETWORK"))
  // two: the instance marker sits in an operand slot, so it carries both compiler messages (above).
  expect(got.filter((d) => d.code === "NETWORK_UNRESOLVED_BOX").length).toBe(2)
  expect(got.some((d) => d.message.includes("notDeclaredAnywhere"))).toBe(true)
})

// ── 5.2 the output pin and `.ENO` — `=> v` is a box's own pin, never an assignment ────────────────
// v1 spelled a box's unconnected result pin as a COIL over the call (`??? := f(x)`), so the `???` check could not tell
// the vendor's legal drawing from a coil nobody named and needed an exemption for calls. v2 spells the pin as the pin
// it is, and the recorded clean build of lenze-mid (four such pins, `AHWF`, `Mach1_MIDS`) is what it must match.

const PRG = `PROGRAM PRG_callee
VAR x : BOOL; END_VAR
x := TRUE;
END_PROGRAM
`

test("an output pin wired to ??? is the vendor's unconnected result pin, and no error", () => {
  for (const pin of ["=> ???", "Q => ???"]) {
    const src = wrap(`IMPLEMENTATION FBD
NETWORK
  t1(IN := a, PT := T#1s, ${pin});
END_NETWORK`)
    expect(diags(src).map((d) => `${d.code}: ${d.message}`), pin).toEqual([])
  }
})

test("a ??? coil over a CALL is not a target complaint, through .ENO too", () => {
  for (const value of ["PRG_callee()", "PRG_callee(EN := a).ENO"]) {
    const src = PRG + wrap(`IMPLEMENTATION LD
NETWORK
  ??? := ${value};
END_NETWORK`)
    expect(unresolved(src).map((d) => d.message), value).toEqual([])
  }
  // …and over anything that is not a real call it still is.
  expect(unresolved(wrap("IMPLEMENTATION LD\nNETWORK\n  ??? := NOT(a);\nEND_NETWORK")).map((d) => d.message)).toEqual([TARGET_MSG])
})

test("a box's output, by its data pin or its ENO, is not an ST assignment the LSP types", () => {
  // `x := MOVE(src)` / `x := f(…).ENO` / `f(src, => x)` are wires from a box pin, whose type the IDE owns.
  for (const statement of ["iRPM := MOVE(EN := a, coil).ENO;", "MOVE(coil, => iRPM);", "iRPM := MOVE(coil);"]) {
    const src = wrap(`IMPLEMENTATION FBD
NETWORK
  ${statement}
END_NETWORK`)
    expect(diags(src).map((d) => `${d.code}: ${d.message}`), statement).toEqual([])
  }
})

// ── found by re-measuring the v2 corpus (task 5.5): shapes v2 spells that v1 never reached the checks with ──────────

test("an FB instance reached through a path heads a call, and is no undeclared identifier", () => {
  // lenze-mid calls its timers as `Mach1_AuxData.IEC_TIMERS.TON_MainDriveBlocked(IN := …)` — an instance inside a
  // struct inside a GVL. The head was read as ONE identifier named by the whole path, which nothing declares.
  const src = `TYPE Timers : STRUCT t1 : TON; END_STRUCT END_TYPE
` + wrap("IMPLEMENTATION FBD\nNETWORK\n  timers.t1(IN := a, PT := T#1s);\n  coil := timers.t1(IN := a, PT := T#1s).ENO;\nEND_NETWORK").replace("\tt1 : TON;", "\tt1 : TON;\n\ttimers : Timers;")
  expect(diags(src).map((d) => `${d.code}: ${d.message}`)).toEqual([])
})

test("a call of a POU by its TYPE name is not pin-checked as an FB instance", () => {
  // bakon-nano: `DELETE(STR := s, LEN := 4, POS := 0)` names the Standard FUNCTION, and a library FB of the same name
  // made the pin check read the call as that FB's. v1 wrote the call positionally and only ever pin-checked a
  // top-level box; v2 names the pins and reaches every call. The check is about an INSTANCE's pins.
  const src = `FUNCTION_BLOCK DELETE
VAR_INPUT other : BOOL; END_VAR
END_FUNCTION_BLOCK
` + wrap("IMPLEMENTATION FBD\nNETWORK\n  DELETE(STR := a, LEN := 4, POS := 0);\nEND_NETWORK")
  expect(diags(src).filter((d) => d.code === "network-unknown-pin")).toEqual([])
})

test("a chained assignment reports a hole in its value once", () => {
  // One value, several targets: a message per target lands on the SAME range with the same code, which the corpus
  // gate forbids and no build was measured to give.
  const got = diags(wrap("IMPLEMENTATION LD\nNETWORK\n  coil :=\n  out := nope;\nEND_NETWORK")).filter(
    (d) => d.code === "network-unknown-source",
  )
  expect(got).toHaveLength(1)
})

test("a chained assignment type-checks its value against EVERY target", () => {
  // One value written to several targets is several assignments: pairing it with the last target only hid a
  // mismatch against any earlier one. Only the hole — a fact about the VALUE — is reported once.
  const got = diags(wrap("IMPLEMENTATION LD\nNETWORK\n  iRPM :=\n  coil := a;\nEND_NETWORK"))
  expect(got.map((d) => d.message)).toContain("Cannot convert type 'BOOL' to type 'INT'")
})
