/**
 * A ROOT BOX'S MAIN OUTPUT, LIVE (openspec network-text-one-to-one F3): the index of the first null in its output list.
 * Pushed as `.NAME` it stores the null at that slot, a root closed by nothing at slot 0, each with the output names a drawn
 * box holds; both build and pull back as pushed. The stored list is read from the IDE's own serialization.
 *
 * On TwinCAT no archive of a root's null past slot 0 was ever seen: the push refuses it by name, and the default round-trips.
 */
import { describe, beforeAll, expect, setDefaultTimeout } from "bun:test"
import { id, fid, requireHealthy, VENDOR, BASE } from "../harness"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { expectRoundTrip, expectRoundTripOrRefusal } from "../lib/roundtrip"
import { ensureCompiles, withMainProgramRestored } from "../lib/compile"
import { removeItem } from "../lib/workspace"
import { codesysNativeExport } from "../lib/codesys-native"

const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(120_000)

const fb = (name: string, statement: string): string =>
	`FUNCTION_BLOCK ${name}\nVAR\n\ta : BOOL;\n\tx : BOOL;\n\te : BOOL;\n\tn : INT;\n\tc2 : CTU;\nEND_VAR\n` +
	`%LANGUAGE FBD\n%NETWORK\n${statement}\n\nEND_FUNCTION_BLOCK\n`

async function shape(key: string, statement: (n: string) => string, stored: (xml: string) => void, tcRefusal?: string): Promise<void> {
	const name = id(key)
	const item = fid(key, "pou")
	try {
		const text = fb(name, statement(name))
		if (VENDOR === "twincat" && tcRefusal !== undefined) {
			if ((await expectRoundTripOrRefusal(item, text, tcRefusal)) === "refused") return
		} else await expectRoundTrip(item, text)
		await withMainProgramRestored(() => ensureCompiles(name))
		if (VENDOR === "codesys") stored(await codesysNativeExport(name))
	} finally {
		await removeItem(item)
	}
}

/** The root box's stored output list as the IDE serializes it: its names, and per slot null (the vendor's null) or the
 *  operand's text. The main output is the first null. */
function outputList(xml: string): { names: string[]; slots: (string | null)[] } {
	const list = (open: string): string => {
		const at = xml.indexOf(open)
		if (at < 0) throw new Error(`the native export holds no ${open}`)
		return xml.slice(at, xml.indexOf("</List2>", at))
	}
	const items = list('<List2 Name="OutputItems">')
	const slots = [...items.matchAll(/<Null \/>|<Single Name="Operand" Type="string">([^<]*)<\/Single>/g)].map((m) => (m[0].startsWith("<Null") ? null : (m[1] ?? "")))
	const names = [...list('<Single Name="OutputParam"').matchAll(/<Single Type="string">([^<]*)<\/Single>/g)].map((m) => m[1] ?? "")
	return { names, slots }
}

describe(`graphical / a root box's main output, network-text-one-to-one F3 (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	it(".NAME stores the null at that slot", async () => {
		await shape("f3cv", () => "c2(CU := a, PV := 5).CV;", (xml) => {
			expect(outputList(xml)).toEqual({ names: ["Q", "CV"], slots: ["", null] })
		}, "main output past its first")
	})

	it("no closer stores the null at slot 0, with the output names", async () => {
		await shape("f3q", () => "c2(CU := a, PV := 5);", (xml) => {
			expect(outputList(xml)).toEqual({ names: ["Q", "CV"], slots: [null, ""] })
		})
	})

	it("a wired first output beside .NAME", async () => {
		await shape("f3wq", () => "c2(CU := a, PV := 5, Q => x).CV;", (xml) => {
			expect(outputList(xml)).toEqual({ names: ["Q", "CV"], slots: ["x", null] })
		}, "main output past its first")
	})

	it("a wired first output and no closer", async () => {
		await shape("f3w", () => "c2(CU := a, PV := 5, Q => x);", (xml) => {
			expect(outputList(xml)).toEqual({ names: ["Q", "CV"], slots: ["x", ""] })
		})
	})

	it("a wired later output and no closer", async () => {
		await shape("f3wn", () => "c2(CU := a, PV := 5, CV => n);", (xml) => {
			expect(outputList(xml)).toEqual({ names: ["Q", "CV"], slots: [null, "n"] })
		})
	})

	it("a root showing ENO holds the ENO and every declared output", async () => {
		await shape("f3e", () => "c2(EN := e, CU := a, PV := 5);", (xml) => {
			expect(outputList(xml)).toEqual({ names: ["ENO", "Q", "CV"], slots: [null, "", ""] })
		})
	})
})
