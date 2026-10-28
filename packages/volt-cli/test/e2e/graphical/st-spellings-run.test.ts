/**
 * THE SPELLINGS RUN AS THEIR NETWORKS (openspec network-text-st 3.0, network-output-member 2.3): each spelling pushed as
 * a network, built by the IDE, run in the simulation beside the ST twin the LSP writes for it (`volt-lsp-iec`
 * `test/support/network-twin.ts`), on one stimulus that changes every scan; a driver PROGRAM counts the scans on which an
 * output of the network differs from the twin's. The measurement each spelling rests on:
 *
 *   `X(EN := e, …)`             a box with EN and no ENO, read by its value: held under a coil when disabled, at the root
 *                               the IF that runs it, an enabled comparison FALSE when disabled, an FB not called;
 *   `f(…).ENO`                  a box with ENO and no EN: called on every scan, its ENO TRUE;
 *   `JMP(l, v)`, `RETURN(v)`    the jump and the return on a value; a coil and a jump on one value written as one item per
 *                               target (the coil first);
 *   `y := JMP(l, c) AND d`      a jump inside a tree.
 *
 * CODESYS only (no TwinCAT runtime licence on the dev machine).
 */
import { describe, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, requireHealthy, VENDOR, BASE } from "../harness"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { createItem, removeItem } from "../lib/workspace"
import { runCalled } from "../lib/codesys-run"

const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(300_000)

const NET1 = id("stnet1")
const TWIN1 = id("sttwin1")
const NET2 = id("stnet2")
const TWIN2 = id("sttwin2")
const DRV = id("stdrv")
const FN = id("stfn")

const inputs = "VAR_INPUT\n\ta, b, c, d : BOOL;\n\ti, j : INT;\nEND_VAR\n"
const outputs1 = "VAR_OUTPUT\n\ty1, y2, y4, y6, y8, y9 : INT;\n\tx1, x3, x5, lamp : BOOL;\nEND_VAR\nVAR\n\tc1 : CTU;\nEND_VAR\n"

/** A function the networks call showing ENO and no EN. */
const fn = `FUNCTION ${FN} : INT\nVAR_INPUT\n\tIN : INT;\nEND_VAR\n%LANGUAGE ST\n${FN} := IN + 1;\n\nEND_FUNCTION\n`
const outputs2 = "VAR_OUTPUT\n\tx2 : BOOL;\n\ty5, y7 : INT;\nEND_VAR\n"

const net1 = `PROGRAM ${NET1}
${inputs}${outputs1}%LANGUAGE LD
%NETWORK
y1 := MOVE(EN := c, i);
%NETWORK
MOVE(EN := d, j, OUT => y2);
%NETWORK
x1 := a AND GT(EN := c, i, 3);
%NETWORK
x3 := CTU(FB := c1, EN := c, CU := a, PV := 5).Q;
%NETWORK
x5 := ${FN}(IN := i, OUT => y9).ENO;
%NETWORK
${FN}(IN := j, OUT => y8).ENO;
%NETWORK
lamp := b AND d;
JMP(skip1, b AND d);
%NETWORK
y4 := ADD(y4, 1);
%NETWORK
skip1:
RETURN(d AND NOT a);
%NETWORK
y6 := ADD(y6, 1);

END_PROGRAM
`

const twin1 = `PROGRAM ${TWIN1}
${inputs}${outputs1}VAR
\tt1 : BOOL;
END_VAR
%LANGUAGE ST
IF c THEN y1 := i; END_IF;
IF d THEN y2 := j; END_IF;
IF c THEN t1 := i > 3; ELSE t1 := FALSE; END_IF;
x1 := a AND t1;
IF c THEN c1(CU := a, PV := 5); END_IF;
x3 := c1.Q;
y9 := ${FN}(IN := i);
x5 := TRUE;
y8 := ${FN}(IN := j);
lamp := b AND d;
IF b AND d THEN JMP skip1; END_IF;
y4 := y4 + 1;
skip1:
IF d AND NOT a THEN RETURN; END_IF;
y6 := y6 + 1;

END_PROGRAM
`

const net2 = `PROGRAM ${NET2}
${inputs}${outputs2}%LANGUAGE LD
%NETWORK
x2 := JMP(skip2, c) AND d;
%NETWORK
y5 := ADD(y5, 1);
%NETWORK
skip2:
y7 := ADD(y7, 1);

END_PROGRAM
`

/** The LSP's twin of a jump in a tree: the value held, the jump taken on it where the tree is evaluated. */
const twin2 = `PROGRAM ${TWIN2}
${inputs}${outputs2}VAR
\tt : BOOL;
END_VAR
%LANGUAGE ST
t := c;
IF t THEN JMP skip2; END_IF;
x2 := t AND d;
y5 := y5 + 1;
skip2:
y7 := y7 + 1;

END_PROGRAM
`

const OUT1 = ["y1", "y2", "y4", "y6", "y8", "y9", "x1", "x3", "x5", "lamp"]
const OUT2 = ["x2", "y5", "y7"]

const drv = `PROGRAM ${DRV}
VAR
\tn : INT;
\ta, b, c, d : BOOL;
\ti, j : INT;
${[...OUT1, ...OUT2].map((o) => `\te_${o} : INT;`).join("\n")}
END_VAR
%LANGUAGE ST
n := n + 1;
a := (n MOD 2) = 1;
b := (n / 2 MOD 2) = 1;
c := (n / 4 MOD 2) = 1;
d := (n / 8 MOD 2) = 1;
i := n MOD 7;
j := n MOD 3;
${NET1}(a := a, b := b, c := c, d := d, i := i, j := j);
${TWIN1}(a := a, b := b, c := c, d := d, i := i, j := j);
${NET2}(a := a, b := b, c := c, d := d, i := i, j := j);
${TWIN2}(a := a, b := b, c := c, d := d, i := i, j := j);
${OUT1.map((o) => `IF ${NET1}.${o} <> ${TWIN1}.${o} THEN e_${o} := e_${o} + 1; END_IF;`).join("\n")}
${OUT2.map((o) => `IF ${NET2}.${o} <> ${TWIN2}.${o} THEN e_${o} := e_${o} + 1; END_IF;`).join("\n")}

END_PROGRAM
`

const ITEMS = [fid("stnet1"), fid("sttwin1"), fid("stnet2"), fid("sttwin2"), fid("stdrv"), fid("stfn")]

describe.skipIf(VENDOR !== "codesys")(`graphical / the spellings run as their twins, network-text-st 3.0, network-output-member (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	it("EN without ENO, ENO without EN, JMP(label, value), RETURN(value), a coil and a jump on one value and a jump in a tree", async () => {
		try {
			for (const item of ITEMS) await removeItem(item)
			for (const [item, src] of [[fid("stfn"), fn], [fid("stnet1"), net1], [fid("sttwin1"), twin1], [fid("stnet2"), net2], [fid("sttwin2"), twin2], [fid("stdrv"), drv]] as const) {
				const r = await createItem(item, src)
				expect(r.conflicts ?? [], `${item} was created`).toEqual([])
			}
			const paths = [`${DRV}.n`, ...[...OUT1, ...OUT2].map((o) => `${DRV}.e_${o}`)]
			const v = await runCalled([DRV], paths)
			const seen = JSON.stringify(v)
			expect(Number(/(\d+)$/.exec(v[`${DRV}.n`]!)![1]), `the driver ran every stimulus (16 scans) more than twice: ${seen}`).toBeGreaterThan(32)
			for (const o of [...OUT1, ...OUT2]) expect(v[`${DRV}.e_${o}`], `'${o}' of the network equals its twin's on every scan: ${seen}`).toMatch(/^(INT#)?0$/)
		} finally {
			for (const item of ITEMS) await removeItem(item)
		}
	})
})
