/**
 * AN EXECUTE BOX WITHOUT EN RUNS IN A FUNCTION BLOCK (openspec network-text-one-to-one 4.2, F13): measured live, an
 * `EXECUTE(…)` pushed with no EN stored `En` null, and in an FB its code never ran (0 of 99 scans), where the editor
 * stores `false` and runs it every scan. Each of the four EN/ENO models is pushed into one FB, run in the simulation
 * (`lib/codesys-run.ts`) from a PROGRAM calling it, and each box's counter is read back: every box without EN counts
 * every scan, the enabled ones count under their EN. CODESYS only (TwinCAT's driver refuses a new Execute box).
 */
import { describe, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, requireHealthy, VENDOR, BASE } from "../harness"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { expectRoundTrip } from "../lib/roundtrip"
import { removeItem } from "../lib/workspace"
import { runCalled } from "../lib/codesys-run"

const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(300_000)

const FB = id("execfb")
const FB_ITEM = fid("execfb", "pou")
const PRG = id("execfbp")
const PRG_ITEM = fid("execfbp", "pou")

const fb = `FUNCTION_BLOCK ${FB}
VAR
\ta : INT;
\tb : INT;
\tc : INT;
\td : INT;
\tgo : BOOL := TRUE;
END_VAR
%LANGUAGE LD
%NETWORK
EXECUTE('a := a + 1;');
%NETWORK
EXECUTE('b := b + 1;').ENO;
%NETWORK
EXECUTE(EN := go, 'c := c + 1;');
%NETWORK
EXECUTE(EN := go, 'd := d + 1;').ENO;

END_FUNCTION_BLOCK
`

const prg = `PROGRAM ${PRG}
VAR
\tf : ${FB};
END_VAR
%LANGUAGE ST
f();

END_PROGRAM
`

function int(value: string): number {
	const m = /^(?:[A-Z_]+#)?(-?\d+)$/.exec(value)
	if (!m) throw new Error(`'${value}' is no integer value`)
	return Number(m[1])
}

describe.skipIf(VENDOR !== "codesys")(`graphical / an Execute box without EN runs in an FB, network-text-one-to-one 4.2 (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	it("each EN/ENO model of a pushed Execute box runs its ST: without EN every scan, with EN under it", async () => {
		try {
			await expectRoundTrip(FB_ITEM, fb)
			await expectRoundTrip(PRG_ITEM, prg)
			const names = ["a", "b", "c", "d"].map((v) => `${PRG}.f.${v}`)
			const values = await runCalled([PRG], names)
			const seen = JSON.stringify(values)
			for (const v of names) expect(int(values[v]!), `${v} counted: ${seen}`).toBeGreaterThan(0)
		} finally {
			await removeItem(PRG_ITEM)
			await removeItem(FB_ITEM)
		}
	})
})
