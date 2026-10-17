/**
 * A LIBRARY FUNCTION'S POSITIONAL PINS GET THEIR FORMALS IN DECLARATION ORDER (openspec ld-fbd-coverage 2R.4b, gate
 * finding 1). A push names a positional pin of a library function's box from the IDE's signature list
 * (`LibraryFunctions.Of`); for MID(STR, LEN, POS), REPLACE(STR1, STR2, L, P) and DELETE(STR, LEN, POS) a wrong order
 * still builds — LEN/POS and L/P share a type — and runs with swapped arguments. A build cannot tell; the runtime can.
 *
 * The oracle is the compiler's own reading of the same call in ST: one PROGRAM holds the boxes in FBD, another the same
 * calls in ST and the swapped ones; both run in the simulation and the box's result must equal the ST call's and differ
 * from the swapped call's. CODESYS only (no TwinCAT runtime licence on the dev machine).
 */
import { describe, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, requireHealthy, VENDOR, BASE } from "../harness"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { expectRoundTrip } from "../lib/roundtrip"
import { createItem, fetchItem, removeItem } from "../lib/workspace"
import { runCalled } from "../lib/codesys-run"

const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(300_000)

const BOXES = id("libruns")
const ST = id("librunst")

const vars = (names: string[]): string =>
	`VAR\n\ttxt : STRING := 'hello';\n${names.map((n) => `\t${n} : STRING;\n`).join("")}END_VAR\n`

/** The boxes as pushed (positional, `named` false) and as the IDE holds them after the push: named, the formals in the
 *  signature's order (a FUNCTION box's positional pins are pushed named, 2R.4 — `callee-seed-lag.test.ts`). */
const boxes = (named: boolean): string => `PROGRAM ${BOXES}
${vars(["outMid", "outRep", "outDel"])}IMPLEMENTATION FBD
NETWORK
  outMid := MID(${named ? "STR := txt, LEN := 2, POS := 3" : "txt, 2, 3"});
END_NETWORK
NETWORK
  outRep := REPLACE(${named ? "STR1 := txt, STR2 := 'ab', L := 2, P := 1" : "txt, 'ab', 2, 1"});
END_NETWORK
NETWORK
  outDel := DELETE(${named ? "STR := txt, LEN := 2, POS := 3" : "txt, 2, 3"});
END_NETWORK

END_PROGRAM
`

const st = `PROGRAM ${ST}
${vars(["outMid", "outRep", "outDel", "swMid", "swRep", "swDel"])}IMPLEMENTATION ST
outMid := MID(txt, 2, 3);
outRep := REPLACE(txt, 'ab', 2, 1);
outDel := DELETE(txt, 2, 3);
swMid := MID(txt, 3, 2);
swRep := REPLACE(txt, 'ab', 1, 2);
swDel := DELETE(txt, 3, 2);

END_PROGRAM
`

describe.skipIf(VENDOR !== "codesys")(`graphical / a library function's positional pins, ld-fbd-coverage 2R.4b (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	it("MID, REPLACE and DELETE boxes called positionally compute what the same ST call computes", async () => {
		try {
			await removeItem(fid("libruns", "pou"))
			await createItem(fid("libruns", "pou"), boxes(false))
			expect((await fetchItem(fid("libruns", "pou"))).sourceText, "the positional pins came back named in declaration order").toBe(boxes(true))
			await expectRoundTrip(fid("librunst", "pou"), st)
			const v = await runCalled(
				[BOXES, ST],
				[...["outMid", "outRep", "outDel"].map((n) => `${BOXES}.${n}`), ...["outMid", "outRep", "outDel", "swMid", "swRep", "swDel"].map((n) => `${ST}.${n}`)],
			)
			const seen = JSON.stringify(v)
			for (const n of ["outMid", "outRep", "outDel"]) {
				expect(v[`${ST}.${n}`], `the swapped ST call differs, so the run can tell an order: ${seen}`).not.toBe(v[`${ST}.sw${n.slice(3)}`])
				expect(v[`${BOXES}.${n}`], `the box '${n}' computes what the ST call computes: ${seen}`).toBe(v[`${ST}.${n}`])
			}
		} finally {
			await removeItem(fid("libruns", "pou"))
			await removeItem(fid("librunst", "pou"))
		}
	})
})
