/**
 * THE STANDARD LIBRARY, WRITTEN IN ST — the evidence behind `plc-library-runtime` design §5.
 *
 * That section had to choose between a native Rust crate mirrored by a TypeScript one (two sources per element,
 * drift caught only by the oracle) and library shims written in ST and compiled by this transpiler (one source,
 * drift impossible by construction). It chose ST, on the measurement this file keeps honest: seven of the ten
 * Standard function blocks need NOTHING built — the IEC definitions lower, run and emit as ordinary user code.
 *
 * These bodies are the standard's own definitions, so what this asserts is that the PIPELINE handles them. It is
 * not a conformance claim: what CODESYS's `Standard` library actually computes is the conformance suite's job,
 * and tier 2 owns recording it. The claim here is the narrower one the decision rests on — nothing is missing.
 *
 * The three NOT here are `TON`/`TOF`/`TP`, absent for one reason: they must ask what time it is, and the
 * standard's signature (`IN`, `PT`, `Q`, `ET`) gives them no input to ask through. That is the single intrinsic
 * §5 commits to, not a second runtime. The last test pins the half of it that already works.
 */
import { test, expect } from "bun:test"
import { lowerSource } from "./index.js"
import { run } from "../interp/index.js"
import { emitRust } from "../emit/rust/index.js"

const R_TRIG =
  "FUNCTION_BLOCK R_TRIG\nVAR_INPUT\n\tCLK : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\nEND_VAR\nVAR\n\tM : BOOL;\nEND_VAR\n" +
  "Q := CLK AND NOT M;\nM := CLK;\nEND_FUNCTION_BLOCK\n\n"
// `M : BOOL := TRUE` is the standard's own initializer and it is load-bearing: M holds NOT CLK, so leaving it
// FALSE makes the block report a falling edge on the first scan, before any edge has happened. Written without
// it, the test below counted three falling edges instead of two — which is also why an ST library needs the
// declaration half of the language, not just the body half.
const F_TRIG =
  "FUNCTION_BLOCK F_TRIG\nVAR_INPUT\n\tCLK : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ : BOOL;\nEND_VAR\nVAR\n\tM : BOOL := TRUE;\nEND_VAR\n" +
  "Q := NOT CLK AND NOT M;\nM := NOT CLK;\nEND_FUNCTION_BLOCK\n\n"
const SR =
  "FUNCTION_BLOCK SR\nVAR_INPUT\n\tSET1 : BOOL;\n\tRESET : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ1 : BOOL;\nEND_VAR\n" +
  "Q1 := SET1 OR (NOT RESET AND Q1);\nEND_FUNCTION_BLOCK\n\n"
const RS =
  "FUNCTION_BLOCK RS\nVAR_INPUT\n\tSET : BOOL;\n\tRESET1 : BOOL;\nEND_VAR\nVAR_OUTPUT\n\tQ1 : BOOL;\nEND_VAR\n" +
  "Q1 := NOT RESET1 AND (SET OR Q1);\nEND_FUNCTION_BLOCK\n\n"
const CTU =
  "FUNCTION_BLOCK CTU\nVAR_INPUT\n\tCU : BOOL;\n\tRESET : BOOL;\n\tPV : INT;\nEND_VAR\n" +
  "VAR_OUTPUT\n\tQ : BOOL;\n\tCV : INT;\nEND_VAR\nVAR\n\tMCU : BOOL;\nEND_VAR\n" +
  "IF RESET THEN\n\tCV := 0;\nELSIF CU AND NOT MCU AND CV < 32767 THEN\n\tCV := CV + 1;\nEND_IF\n" +
  "MCU := CU;\nQ := CV >= PV;\nEND_FUNCTION_BLOCK\n\n"
const CTD =
  "FUNCTION_BLOCK CTD\nVAR_INPUT\n\tCD : BOOL;\n\tLOAD : BOOL;\n\tPV : INT;\nEND_VAR\n" +
  "VAR_OUTPUT\n\tQ : BOOL;\n\tCV : INT;\nEND_VAR\nVAR\n\tMCD : BOOL;\nEND_VAR\n" +
  "IF LOAD THEN\n\tCV := PV;\nELSIF CD AND NOT MCD AND CV > -32768 THEN\n\tCV := CV - 1;\nEND_IF\n" +
  "MCD := CD;\nQ := CV <= 0;\nEND_FUNCTION_BLOCK\n\n"
const CTUD =
  "FUNCTION_BLOCK CTUD\nVAR_INPUT\n\tCU : BOOL;\n\tCD : BOOL;\n\tRESET : BOOL;\n\tLOAD : BOOL;\n\tPV : INT;\nEND_VAR\n" +
  "VAR_OUTPUT\n\tQU : BOOL;\n\tQD : BOOL;\n\tCV : INT;\nEND_VAR\nVAR\n\tMCU : BOOL;\n\tMCD : BOOL;\nEND_VAR\n" +
  "IF RESET THEN\n\tCV := 0;\nELSIF LOAD THEN\n\tCV := PV;\nELSE\n" +
  "\tIF CU AND NOT MCU AND CV < 32767 THEN\n\t\tCV := CV + 1;\n\tEND_IF\n" +
  "\tIF CD AND NOT MCD AND CV > -32768 THEN\n\t\tCV := CV - 1;\n\tEND_IF\nEND_IF\n" +
  "MCU := CU;\nMCD := CD;\nQU := CV >= PV;\nQD := CV <= 0;\nEND_FUNCTION_BLOCK\n\n"

const STANDARD = R_TRIG + F_TRIG + SR + RS + CTU + CTD + CTUD

/** Lower a caller against the ST library and scan it `scans` times, or fail with what the lowering refused. */
const scan = (decls: string, body: string, scans: number) => {
  const source = `PROGRAM PLC_PRG\nVAR\n${decls}END_VAR\n${body}END_PROGRAM\n\n${STANDARD}`
  const { pou, diagnostics } = lowerSource(source, "PLC_PRG")
  if (!pou) throw new Error(diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"))
  const p = run(pou)
  for (let i = 0; i < scans; i++) p.scan()
  return p
}

test("the edge detectors lower, and fire on exactly one scan", () => {
  // The whole of R_TRIG is `Q := CLK AND NOT M; M := CLK;` — a read of the previous scan's input. It needs FB
  // instances and nothing else, and those landed. `sig` is high on scans 2, 4 and 5, so six scans hold two
  // RISING edges (at 2 and 4) and two FALLING ones (at 3 and 6).
  const decls = "\trise : R_TRIG;\n\tfall : F_TRIG;\n\tn : INT;\n\tsig : BOOL;\n\trises : INT;\n\tfalls : INT;\n"
  const body =
    "n := n + 1;\nsig := n = 2 OR n = 4 OR n = 5;\n" +
    "rise(CLK := sig);\nIF rise.Q THEN rises := rises + 1; END_IF\n" +
    "fall(CLK := sig);\nIF fall.Q THEN falls := falls + 1; END_IF\n"
  const p = scan(decls, body, 6)
  expect(p.get("rises")).toBe(2n)
  expect(p.get("falls")).toBe(2n)
})

test("the counters lower, and count edges rather than scans", () => {
  // CV must advance ONCE per rising edge of CU, not once per scan the input is high — the `MCU` memory is what
  // makes that true, and it is the same one-scan-of-state the edge detectors keep. `sig` is high on scans 2, 4
  // and 5: two rising edges. So a CTU reaches 2, and a CTD/CTUD loaded to 5 comes back down to 3.
  const decls =
    "\tup : CTU;\n\tdown : CTD;\n\tboth : CTUD;\n\tn : INT;\n\tsig : BOOL;\n" +
    "\tupCV : INT;\n\tupQ : BOOL;\n\tdownCV : INT;\n\tbothCV : INT;\n"
  const body =
    "n := n + 1;\nsig := n = 2 OR n = 4 OR n = 5;\n" +
    "up(CU := sig, RESET := FALSE, PV := 2);\nupCV := up.CV;\nupQ := up.Q;\n" +
    "down(CD := sig, LOAD := n = 1, PV := 5);\ndownCV := down.CV;\n" +
    "both(CU := FALSE, CD := sig, RESET := FALSE, LOAD := n = 1, PV := 5);\nbothCV := both.CV;\n"
  const p = scan(decls, body, 6)
  expect(p.get("upCV")).toBe(2n)
  expect(p.get("upQ")).toBe(true) // PV is 2, and CV reached it
  expect(p.get("downCV")).toBe(3n)
  expect(p.get("bothCV")).toBe(3n)
})

test("the bistables lower, and each resolves a simultaneous SET and RESET its own way", () => {
  // This is the ONLY thing that distinguishes SR from RS, so it is the only thing worth asserting about them:
  // SR is set-dominant, RS is reset-dominant. Drive both inputs high on one scan and they disagree.
  const decls = "\tsetDom : SR;\n\tresetDom : RS;\n\tsq : BOOL;\n\trq : BOOL;\n"
  const body =
    "setDom(SET1 := TRUE, RESET := TRUE);\nsq := setDom.Q1;\n" +
    "resetDom(SET := TRUE, RESET1 := TRUE);\nrq := resetDom.Q1;\n"
  const p = scan(decls, body, 1)
  expect(p.get("sq")).toBe(true)
  expect(p.get("rq")).toBe(false)
})

test("an ST library block emits as ordinary transpiled code, not as a call into a runtime", () => {
  // The readable-output row of the §5 table. Were R_TRIG a crate item this would be a `use` and a method call;
  // because it is transpiled, its state is a struct field and its body is the statement the ST author wrote.
  const source = `PROGRAM PLC_PRG\nVAR\n\trise : R_TRIG;\nEND_VAR\nrise(CLK := TRUE);\nEND_PROGRAM\n\n${R_TRIG}`
  const { pou } = lowerSource(source, "PLC_PRG")
  const code = emitRust(pou!).code
  expect(code).toContain("pub struct R_TRIG")
  expect(code).toContain("self.q = self.clk & (!self.m);")
  expect(code).not.toContain("use ") // no runtime crate is referenced
})

test("TIME arithmetic already works, so the timers wait on the CLOCK and nothing else", () => {
  // The reason §5 commits to ONE intrinsic rather than a second runtime: a timer's arithmetic — subtract two
  // instants, compare the result against PT — lowers and evaluates today. What TON cannot do is NAME the current
  // instant, because `IN`/`PT`/`Q`/`ET` is the whole signature the standard gives it. That gap is `__NOW()`.
  const { pou, diagnostics } = lowerSource(
    "PROGRAM PLC_PRG\nVAR\n\tstart : TIME;\n\tnow : TIME;\n\tet : TIME;\n\tq : BOOL;\nEND_VAR\n" +
      "now := T#5S;\nstart := T#1S;\net := now - start;\nq := et >= T#3S;\nEND_PROGRAM\n",
    "PLC_PRG",
  )
  expect(diagnostics.map((d) => d.code)).toEqual([])
  const p = run(pou!)
  p.scan()
  expect(p.get("et")).toBe(4000n) // TIME is milliseconds
  expect(p.get("q")).toBe(true)
})
