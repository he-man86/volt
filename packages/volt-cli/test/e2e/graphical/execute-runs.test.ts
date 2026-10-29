/**
 * AN EXECUTE BOX VOLT WRITES RUNS (openspec ld-fbd-coverage 2R.6a, v2-measurements.md #9): measured in a lab, a box
 * built through the NWL model in ONE commit stored its ST — the export held `i := i + 1;` — and the code did not run
 * until the object was committed again or the project reloaded. A round trip compares text and a build compiles what
 * it is given, so neither could see it: the runtime is the oracle here. Pushed through the bridge, built, run in the
 * simulation (the harness's run probe, `lib/codesys-run.ts`), and the ST's own variables read back — on the push that
 * CREATES the POU and on the push that EDITS only the box's ST (the new code runs, not the old).
 *
 * Both forms the grammar has: a top-level Execute box, and one read through its ENO (the box's code and the coil both
 * run). CODESYS only: TwinCAT's driver refuses a NEW Execute box by name before the import (`refused-shapes.test.ts`,
 * "an EXECUTE box"), and no TwinCAT runtime licence is on the dev machine — a run verdict is CODESYS's.
 */
import { describe, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, requireHealthy, VENDOR, BASE } from "../harness"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { expectRoundTrip } from "../lib/roundtrip"
import { removeItem } from "../lib/workspace"
import { runCalled } from "../lib/codesys-run"

const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(300_000)

const NAME = id("execrun")
const ITEM = fid("execrun", "pou")

/** A PROGRAM holding both Execute forms: the top-level box sets `k` and counts its scans in `i`, the ENO-read one
 *  counts in `j` and hands its ENO to `done`. */
const source = (k: number): string => `PROGRAM ${NAME}
VAR
\ti : INT;
\tj : INT;
\tk : INT;
\tgo : BOOL := TRUE;
\tdone : BOOL;
END_VAR
%LANGUAGE FBD
%NETWORK
EXECUTE(CODE := 'k := ${k};
i := i + 1;');
%NETWORK
done := EXECUTE(EN := go, CODE := 'j := j + 1;');

END_PROGRAM
`

/** An online value as a number: `INT#97` → 97. */
function int(value: string): number {
	const m = /^(?:[A-Z_]+#)?(-?\d+)$/.exec(value)
	if (!m) throw new Error(`'${value}' is no integer value`)
	return Number(m[1])
}

/** Run the application with `program` called from the main program, and read its variables. */
async function run(program: string): Promise<{ i: number; j: number; k: number; done: string; seen: string }> {
	const values = await runCalled([program], ["i", "j", "k", "done"].map((v) => `${program}.${v}`))
	const at = (v: string): string => values[`${program}.${v}`]!
	return { i: int(at("i")), j: int(at("j")), k: int(at("k")), done: at("done"), seen: JSON.stringify(values) }
}

describe.skipIf(VENDOR !== "codesys")(`graphical / an Execute box Volt writes runs, ld-fbd-coverage 2R.6a (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	it("a top-level Execute box and one read through its ENO run their ST — created, and after an edit", async () => {
		try {
			await expectRoundTrip(ITEM, source(7))
			const created = await run(NAME)
			expect(created.i, `the top-level Execute box's ST ran: ${created.seen}`).toBeGreaterThan(0)
			expect(created.k, `the top-level Execute box's ST ran: ${created.seen}`).toBe(7)
			expect(created.j, `the ENO-read Execute box's ST ran: ${created.seen}`).toBeGreaterThan(0)
			expect(created.done, `its ENO reached the coil: ${created.seen}`).toBe("TRUE")

			await expectRoundTrip(ITEM, source(9))
			const edited = await run(NAME)
			expect(edited.k, `the EDITED ST runs, not the old: ${edited.seen}`).toBe(9)
		} finally {
			await removeItem(ITEM)
		}
	})
})
