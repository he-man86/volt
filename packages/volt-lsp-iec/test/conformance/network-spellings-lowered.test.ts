/**
 * THE SPELLINGS CODESYS RAN AS THEIR NETWORKS, LOWERED (openspec network-text-lowering 3.1). `volt-cli`
 * `test/e2e/graphical/st-spellings-run.test.ts` pushes these networks into CODESYS and runs each beside its twin on one
 * stimulus that changes every scan: CODESYS answers network ≡ twin on every scan. Here the same pair is lowered, run on the
 * same stimulus by the same driver, and must agree on every scan too — so the lowering runs what CODESYS runs.
 */
import { expect, test } from "bun:test"
import { lowerSource } from "../../src/transpile/lower/index.js"
import { run } from "../../src/transpile/interp/index.js"
import { PROJECT_BASE } from "./support/project-libraries.js"

const inputs = "VAR_INPUT\n\ta, b, c, d : BOOL;\n\ti, j : INT;\nEND_VAR\n"
const outputs = "VAR_OUTPUT\n\ty1, y2, y4, y5, y6, y7, y9, y10, y11, y12 : INT;\n\tx1, x2, x3, x5, x6, x7, lamp : BOOL;\nEND_VAR\nVAR\n\tc1, c2, c3, c4 : CTU;\nEND_VAR\n"
const OUT = ["y1", "y2", "y4", "y5", "y6", "y7", "y9", "y10", "y11", "y12", "x1", "x2", "x3", "x5", "x6", "x7", "lamp"]

const fn = "FUNCTION FN_Inc : INT\nVAR_INPUT\n\tIN : INT;\nEND_VAR\n%LANGUAGE ST\nFN_Inc := IN + 1;\nEND_FUNCTION\n"

const net = `PROGRAM P_Net
${inputs}${outputs}%LANGUAGE LD
%NETWORK
VAR w1 : ANY; END_VAR
ASSIGN(a AND w1, Q => x6);
w1 := b OR c;
ASSIGN(w1, Q => x7);
%NETWORK
ASSIGN(MOVE(EN := c, i).OUT, Q => y1);
%NETWORK
MOVE(EN := d, j, OUT => y2);
%NETWORK
ASSIGN(a AND GT(EN := c, i, 3).OUT, Q => x1);
%NETWORK
ASSIGN(c1(EN := c, CU := a, PV := 5).Q, Q => x3);
%NETWORK
ASSIGN(FN_Inc(EN := TRUE, IN := i, OUT => y9), Q => x5);
%NETWORK
ASSIGN(c2(CU := a, PV := 5).CV, Q => y10);
%NETWORK
MOVE(EN := c, c3(CU := b, PV := 3).CV, OUT => y11);
%NETWORK
c4(EN := c, CU := RISING(d), PV := 5, CV => y12);
%NETWORK
ASSIGN(b AND d, Q => lamp);
ASSIGN(b AND d, Q => JMP.skip1);
%NETWORK
ASSIGN(ADD(y4, 1), Q => y4);
%NETWORK
skip1:
ASSIGN(ASSIGN(c, Q => JMP.skip2) AND d, Q => x2);
%NETWORK
ASSIGN(ADD(y5, 1), Q => y5);
%NETWORK
skip2:
ASSIGN(ADD(y7, 1), Q => y7);
ASSIGN(d AND INVERT(a), Q => RETURN);
%NETWORK
ASSIGN(ADD(y6, 1), Q => y6);
END_PROGRAM
`

const twin = `PROGRAM P_Twin
${inputs}${outputs}VAR
	t, t1 : BOOL;
\ttr : R_TRIG;
\tw1 : BOOL;
END_VAR
%LANGUAGE ST
x6 := a AND w1;
w1 := b OR c;
x7 := w1;
IF c THEN y1 := i; END_IF;
IF d THEN y2 := j; END_IF;
IF c THEN t1 := i > 3; ELSE t1 := FALSE; END_IF;
x1 := a AND t1;
IF c THEN c1(CU := a, PV := 5); END_IF;
x3 := c1.Q;
y9 := FN_Inc(IN := i);
x5 := TRUE;
c2(CU := a, PV := 5);
y10 := c2.CV;
c3(CU := b, PV := 3);
IF c THEN y11 := c3.CV; END_IF;
tr(CLK := d);
IF c THEN c4(CU := tr.Q, PV := 5, CV => y12); END_IF;
lamp := b AND d;
IF b AND d THEN JMP skip1; END_IF;
y4 := y4 + 1;
skip1:
t := c;
IF t THEN JMP skip2; END_IF;
x2 := t AND d;
y5 := y5 + 1;
skip2:
y7 := y7 + 1;
IF d AND NOT a THEN RETURN; END_IF;
y6 := y6 + 1;
END_PROGRAM
`

/** The e2e's driver: the stimulus from the scan count, both programs called, every output that differs counted. */
const driver = `PROGRAM PLC_PRG
VAR
\tn, counted : INT;
\ta, b, c, d : BOOL;
\ti, j : INT;
\t${OUT.map((o) => `e_${o}`).join(", ")} : INT;
END_VAR
%LANGUAGE ST
n := n + 1;
a := (n MOD 2) = 1;
b := (n / 2 MOD 2) = 1;
c := (n / 4 MOD 2) = 1;
d := (n / 8 MOD 2) = 1;
i := n MOD 7;
j := n MOD 3;
P_Net(a := a, b := b, c := c, d := d, i := i, j := j);
P_Twin(a := a, b := b, c := c, d := d, i := i, j := j);
counted := P_Net.y10;
${OUT.map((o) => `IF P_Net.${o} <> P_Twin.${o} THEN e_${o} := e_${o} + 1; END_IF;`).join("\n")}
END_PROGRAM
`

test("every spelling CODESYS ran as its network lowers to what its twin lowers to, on every scan of the e2e's stimulus", () => {
  const files = [
    { uri: "P_Net.pou", source: net },
    { uri: "P_Twin.pou", source: twin },
    { uri: "FN_Inc.pou", source: fn },
  ]
  const { pou, diagnostics } = lowerSource(driver, "PLC_PRG", files, "PLC_PRG.pou", PROJECT_BASE)
  expect(diagnostics).toEqual([])
  const r = run(pou!)
  for (let scan = 0; scan < 48; scan++) r.scan()
  expect(r.get("n")).toBe(48n)
  expect(Object.fromEntries(OUT.map((o) => [o, r.get(`e_${o}`)]))).toEqual(Object.fromEntries(OUT.map((o) => [o, 0n])))
  // the run is not vacuous: the network's counters moved
  expect(r.get("counted")).not.toBe(0n)
})
