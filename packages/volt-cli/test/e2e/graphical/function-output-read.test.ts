/**
 * A FUNCTION READ THROUGH A VAR_OUTPUT, AS THE EDITOR'S SET OUTPUT DRAWS IT (openspec nwl-box-storage-map, "Text against the
 * run"): the null on the output read, the value's variable in the result slot. Live CODESYS 3.5.21.40 ran the drawn box,
 * `k=6 y=TRUE`, and pulled it as these texts; this pushes the texts, builds them and runs them. CODESYS only.
 */
import { describe, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { id, fid, requireHealthy, VENDOR } from "../harness"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { createItem, fetchItem, removeItem } from "../lib/workspace"
import { runCalled } from "../lib/codesys-run"

const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(300_000)

const FN = id("fovfn")
const NET = id("fovnet")

const fn = `FUNCTION ${FN} : INT
VAR_INPUT
	n : INT;
END_VAR
VAR_OUTPUT
	q : BOOL;
	q3 : INT;
END_VAR
%LANGUAGE ST
${FN} := n + 1;
q := TRUE;
q3 := n + 2;

END_FUNCTION
`

const net = `PROGRAM ${NET}
VAR_OUTPUT
	k1, k2, k3, m3 : INT;
	y1, x2 : BOOL;
END_VAR
VAR
	i : INT := 5;
END_VAR
%LANGUAGE FBD
%NETWORK
y1 := ${FN}(n := i, OUT => k1).q;
%NETWORK
${FN}(n := i, OUT => k2).q;
%NETWORK
${FN}(n := i, OUT => k3, q3 => m3).q;
%NETWORK
${FN}(n := i, q => x2).q3;
END_PROGRAM
`

describe.if(VENDOR === "codesys")("a function read through a VAR_OUTPUT", () => {
	beforeAll(requireHealthy)

	it("builds, runs as it reads and pulls back as itself", async () => {
		await createItem(fid("fovfn"), fn)
		await createItem(fid("fovnet"), net)
		try {
			const body = (s: string) => s.slice(s.indexOf("%LANGUAGE")).replace(/\s+/g, " ")
			expect(body((await fetchItem(fid("fovnet"))).sourceText)).toBe(body(net))
			const values = await runCalled([NET], ["k1", "y1", "k2", "k3", "m3", "x2"].map((v) => `${NET}.${v}`))
			expect(values[`${NET}.k1`]).toBe("INT#6")
			expect(values[`${NET}.y1`]).toBe("TRUE")
			expect(values[`${NET}.k2`]).toBe("INT#6")
			expect(values[`${NET}.k3`]).toBe("INT#6")
			expect(values[`${NET}.m3`]).toBe("INT#7")
			expect(values[`${NET}.x2`]).toBe("TRUE")
		} finally {
			await removeItem(fid("fovnet"))
			await removeItem(fid("fovfn"))
		}
	})
})
