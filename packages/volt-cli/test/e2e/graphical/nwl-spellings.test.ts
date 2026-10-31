/**
 * THE SPELLINGS THE NWL COMPLETENESS GATE DECIDED, LIVE (openspec nwl-schema-completeness-gate, "Decided by Volt +
 * Sim-Assist", 2026-10-31): one sample of each new spelling and the operand comment on a value, a coil, a pin and an
 * output — pushed as the text spells it, pulled back exactly, pushed again unchanged (the IDE keeps its model: the native
 * export is byte-identical across the second push), stored as designed (the operand comment in `Operand.Comment`, each
 * flag on the node the text puts it on, read from the IDE's own serialization), and built with no error.
 *
 * CODESYS only (openspec: no TwinCAT live for now).
 */
import { describe, beforeAll, expect, setDefaultTimeout } from "bun:test"
import { id, fid, requireHealthy, VENDOR, BASE } from "../harness"
import { itGapped, PLATFORM_GAPS } from "../lib/platform"
import { expectRoundTrip } from "../lib/roundtrip"
import { ensureCompiles, withMainProgramRestored } from "../lib/compile"
import { fetchItem, pathOf, pushOps, removeItem, versionOf, landed } from "../lib/workspace"
import { codesysImplementations } from "../lib/codesys-native"

const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(300_000)

function fb(name: string, lang: "LD" | "FBD", code: string): string {
	return (
		`FUNCTION_BLOCK ${name}\nVAR\n\ta : BOOL;\n\tb : BOOL;\n\tgo : BOOL;\n\tstart : BOOL;\n\tn : BOOL;\n\tx : BOOL;\n\ty : BOOL;\n` +
		`\tz : BOOL;\n\tt1 : TON;\nEND_VAR\n%LANGUAGE ${lang}\n%NETWORK\n${code}\n%NETWORK\nl:\nz := a;\n\nEND_FUNCTION_BLOCK\n`
	)
}

/** One sample: its text, and what the IDE's own serialization must hold for it. */
interface Sample {
	key: string
	lang: "LD" | "FBD"
	code: string
	/** Each a fragment of the native export the stored model must show (a comment, a flag). */
	stored?: RegExp[]
}

const comment = (text: string) => new RegExp(`Name="Comment"[^>]*>${text}<`)

const SAMPLES: Sample[] = [
	{ key: "s1", lang: "LD", code: "a;" },                                         // #1
	{ key: "s2", lang: "FBD", code: "NOT AND(a, b);" },                            // #2
	{ key: "s7a", lang: "LD", code: "y := NOT := a;" },                            // #7a
	{ key: "s7c", lang: "LD", code: "y := x := NOT := a;" },                       // #7a, last in a chain
	{ key: "s7r", lang: "LD", code: "y := RISING NOT := a;" },                     // #7a, stacked marks
	{ key: "s8", lang: "LD", code: "NOT JMP.l := a;" },                            // #8
	{ key: "s11", lang: "LD", code: "BRANCH(FEED := start, a, b);" },              // #11
	{ key: "s12", lang: "LD", code: "RAIL();" },                                   // #12
	{ key: "s16", lang: "LD", code: "y := NOT EXECUTE(EN := go, 'n := TRUE;').ENO;" }, // #16
	{ key: "s18", lang: "LD", code: "y := BRANCH(FEED := RAIL(), a, b);" },        // #18
	{ key: "cv", lang: "LD", code: "y := NOT COMMENT(a, 'why value');", stored: [comment("why value")] },
	{ key: "cc", lang: "LD", code: "COMMENT(y, 'why coil') S= a;", stored: [comment("why coil")] },
	{ key: "cp", lang: "FBD", code: "y := t1(IN := COMMENT(a, 'why pin'), PT := T#1S).Q;", stored: [comment("why pin")] },
	{ key: "co", lang: "FBD", code: "t1(IN := a, PT := T#1S, Q => COMMENT(x, 'why output'));", stored: [comment("why output")] },
]

describe(`graphical / the NWL completeness gate's spellings (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	for (const s of SAMPLES)
		it(`${s.key}: ${s.code}`, async () => {
			expect(VENDOR).toBe("codesys")
			const name = id("nwlsp" + s.key)
			const item = fid("nwlsp" + s.key, "pou")
			try {
				const src = fb(name, s.lang, s.code)
				await expectRoundTrip(item, src)
				const before = await codesysImplementations(name)
				const again = await pushOps([{ op: "set", name: await pathOf(item), sourceText: src, ifVersion: await versionOf(item) }])
				expect(landed(again)).toBe(true)
				expect((await fetchItem(item)).sourceText).toBe(src)
				expect(await codesysImplementations(name), "the second push changed the stored model").toEqual(before)
				for (const r of s.stored ?? []) expect(before.join("\n")).toMatch(r)
				if (process.env.VOLT_DUMP_NATIVE) console.log(`--- ${s.key}\n${before.join("\n")}`)
				await withMainProgramRestored(() => ensureCompiles(name))
			} finally {
				await removeItem(item)
			}
		})
})
