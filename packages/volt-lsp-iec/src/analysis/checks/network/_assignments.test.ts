/**
 * The network-text assignment checks (`_assignments.ts`): the `target := value` pairs the ST assignment rules apply to
 * — coils, splits read by a coil, EXECUTE boxes' own lines — and what is no pair (a box's output, its ENO).
 */
import { test, expect } from "bun:test"
import { vgDiags } from "../../../../test/support/network-docs.js"

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
out := a AND b;
END_NETWORK
END_FUNCTION_BLOCK`
  expect(vgDiags(src)).toEqual([])
})

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

test("network text: a split's type is its feeder's, and it types what reads it", () => {
  const src = `FUNCTION_BLOCK F
VAR a : BOOL; out : INT; END_VAR
IMPLEMENTATION LD
NETWORK
split1 := a;
out := split1;
END_NETWORK
END_FUNCTION_BLOCK`
  // split1 is fed by the BOOL a; assigning it to an INT coil is a mismatch — the split resolves with its feeder's type.
  expect(vgDiags(src).some((d) => d.code === "assignment-type-mismatch")).toBe(true)
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

test("network text: ENO is BOOL wherever it stands, not the box's result", () => {
  expect(enoDiags("F_Int(iRPM) EN a\n  out := ENO AND b;")).toEqual([])
  expect(enoDiags("F_Int(iRPM) EN a\n  out := NOT ENO;")).toEqual([])
  expect(enoDiags("F_Int(iRPM) EN a\n  iRPM := ENO OR b;")).toEqual(["Cannot convert type 'BOOL' to type 'INT'"])
})

test("network text: an edge used directly is typed as the same value through a wire is", () => {
  // An edge is no box: `x := R_EDGE(a)` reads as an opaque BOOL, as the BOOL split it could have gone through does. (A
  // box's own output — `x := ENO` under its open line — stays the IDE's, network-real-shapes.)
  const viaWire = enoDiags("split1 := R_EDGE(a);\n  iRPM := split1;")
  expect(viaWire).toEqual(["Cannot convert type 'BOOL' to type 'INT'"])
  expect(enoDiags("iRPM := R_EDGE(a);")).toEqual(viaWire)
  expect(enoDiags("out := R_EDGE(a);")).toEqual([])
})

test("network text: the operands inside an open line's box and an edge are still resolved", () => {
  expect(enoDiags("F_Int(nope) EN a\n  out := ENO AND b;")).toContain("Identifier 'nope' not defined")
  expect(enoDiags("out := R_EDGE(nope);")).toContain("Identifier 'nope' not defined")
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
