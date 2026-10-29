import { landed } from "../harness"
/**
 * `???` — THE VENDOR'S MARKER, THROUGH A LIVE IDE, IN EVERY POSITION IT CAN OCCUPY.
 *
 * `???` is what CODESYS writes into a graphical slot nobody filled: a call box whose instance was never named,
 * a coil with no target, a pin wired to nothing it can name. It is CONTENT, not a placeholder Volt invented —
 * which is why network text has no `?` token of its own (a sigil for the unconnected pin was tried and
 * withdrawn precisely because `???` was already in a real project).
 *
 * Content that Volt cannot carry back is data loss, and the marker is the shape most likely to be lost: it is
 * exactly where the vendor's model is INCOMPLETE, so every layer is tempted to normalise it away. One already
 * did — the format named an FB call by its instance alone and read the type off the declaration, and `???` is
 * declared nowhere, so the type was dropped on pull and the push refused. Four POUs in `Lenze_MID-S100` could
 * be pulled and never pushed back.
 *
 * `NetworkTextRoundTripTests` pins these offline against the format alone. This asks the harder question that
 * one cannot: does the IDE ACCEPT the shape and hand it back UNCHANGED? A format that round-trips against
 * itself and loses a marker on the way through the vendor is still lossy.
 *
 * EVERY SHAPE HERE IS A REAL COMPILE ERROR, measured live on SP21 (scripts/audit-check.ts in volt-lsp-iec):
 * an unnamed instance answers with 4 parse errors, an unnamed operand or pin with 2 ("Expression expected
 * instead of '?'", "Unexpected token '?' found"), an unnamed coil target with "The assignment target is not
 * specified." That is the point rather than a caveat: Volt must carry a body the engineer has to SEE is broken,
 * unchanged, so the IDE can go on telling them so. Silently repairing it would hide their mistake; silently
 * dropping it would hide their drawing.
 */
import { describe, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, pushOps, fetchItem, requireHealthy, BASE, VENDOR, inFolder, projectRoot } from "../harness"

import { itGapped, PLATFORM_GAPS } from "../lib/platform"

/** On a CODESYS version that cannot take an LD/FBD write, every test here must end in that refusal (lib/platform.ts). */
const it = itGapped(PLATFORM_GAPS.graphicalWrite)

describe(`graphical / the ??? marker (${BASE})`, () => {
	setDefaultTimeout(180_000)
	beforeAll(async () => {
		await requireHealthy()
	})

	/** Delete with the item's REAL version, falling back to the UNREADABLE sentinel — a leftover from a failed
	 *  run otherwise blocks the next create with "already exists", a red that says nothing about the code. */
	const clean = async (name: string) => {
		const items = (await bridge.refs()).items ?? {}
		await pushOps([{ op: "deleteItem", name, ifVersion: items[name] }])
	}

	/**
	 * THE INVARIANT: create the body, pull it back, and get the same bytes. Not "the push was accepted" — an
	 * accepted push that reshapes the drawing is the failure this file exists to catch.
	 */
	async function roundTrips(slug: string, lang: "FBD" | "LD", body: string, vars: string, tcCannotCreate?: string): Promise<void> {
		const name = id(slug)
		const item = inFolder(await projectRoot(), fid(slug, "pou"))
		await clean(item)
		// THE MARKER GOES AFTER `END_VAR`, and it took this suite's two failures to notice it was not.
		//
		// The `%LANGUAGE` line says where the DECLARATION ends, so putting it above `VAR` made the whole
		// `VAR … END_VAR … NETWORK …` blob the implementation — stored VERBATIM as ST, because the marker
		// then stated no language and ST was its unstated default. It round-tripped byte-identically for exactly that
		// reason: nothing graphical ever ran. Seven of these assertions were proving that a text blob survives a
		// push, and the two that failed were the only honest signal in the file — they asked for a graphical
		// refusal from a body the graphical path never saw. Every other suite in this folder already writes it
		// the right way (`create-shapes`, `fanout`, `comments`, `graphical-kinds`).
		const src = `PROGRAM ${name}\nVAR\n${vars}END_VAR\n%LANGUAGE ${lang}\n${body}\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, sourceText: src, ifVersion: null }])

		// A SHAPE TWINCAT DOES NOT BUILD IS REFUSED, and the refusal is ASSERTED rather than skipped. Until the native
		// writer (openspec twincat-inproc-host) three shapes here were refused because TwinCAT's PLCopen importer could not
		// build them (an output pin, a result pin); one remains, for a measured reason of TwinCAT's own compiler (below).
		// Asserting the refusal is what stops a silent DROP passing here again.
		if (tcCannotCreate !== undefined && VENDOR === "twincat") {
			expect(landed(created), "TwinCAT accepted a shape it does not build").toBe(false)
			expect(JSON.stringify(created.conflicts)).toContain(tcCannotCreate)
			return
		}

		expect(landed(created), `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

		const back = (await fetchItem(item)).sourceText
		expect(back).toBe(src)
		await clean(item)
	}

	const BOOLS = "\ta : BOOL;\n\tout : BOOL;\n\tpt : TIME;\n\tt1 : TON;\n\tsrc : INT;\n"

	/**
	 * THE INSTANCE NOBODY NAMED — and the shape that actually cost a round trip. The engineer dropped a
	 * function-block box on the diagram and never named the instance, so the vendor holds `Instance='???'`
	 * beside a perfectly real `BoxType`. `Lenze_MID-S100`'s `MotionControl/POU` has four, every one of them a
	 * LIBRARY type. The type is spelled inline (`??? : TYPE(…)`) because there is no declaration to read it
	 * from — that is the whole reason the form exists.
	 */
	it("an UNDECLARED FB instance is the box called by its type: `TYPE(pins)`", async () => {
		await roundTrips("qmark_inst", "FBD", "%NETWORK\nTON(IN := a, PT := pt);\n", BOOLS)
	})

	/** AN INPUT PIN. The position no real project has shown us yet — which is the reason to pin it, not a
	 *  reason to skip it. */
	it("`???` on a named INPUT pin", async () => {
		await roundTrips("qmark_in", "FBD", "%NETWORK\nt1(IN := ???, PT := pt);\n", BOOLS)
	})

	/** AN OUTPUT PIN, spelled with ST's own output-parameter operator. */
	it("`???` on a named OUTPUT pin", async () => {
		await roundTrips(
			"qmark_out",
			"FBD",
			"%NETWORK\nt1(IN := a, PT := pt, ET => ???);\n",
			BOOLS,
		)
	})

	/** BOTH AT ONCE, on one box. The two pins are read and written by different arms of the reader/writer
	 *  (`Inputs` vs `Outputs`), so a box carrying the marker on both is the case where one arm dropping it
	 *  cannot hide behind the other. */
	it("`???` on an input AND an output pin of the SAME box", async () => {
		await roundTrips(
			"qmark_both",
			"FBD",
			"%NETWORK\nt1(IN := ???, PT := pt, ET => ???);\n",
			BOOLS,
		)
	})

	/** THE BOX'S RESULT PIN wired to nothing: a stored member, so the text is the call statement alone — distinct from
	 *  the Assign `??? := MOVE(src);` below, a different NWL item. */
	it("`???` on a box's RESULT pin", async () => {
		await roundTrips("qmark_res", "FBD", "%NETWORK\nMOVE(src);\n", BOOLS)

	})

	/** …and the Assign the v1 spelling also meant: a coil nobody named, driven by a box. */
	it("`???` as the target of an assign driven by a box", async () => {
		await roundTrips("qmark_asg", "FBD", "%NETWORK\n??? := MOVE(src);\n", BOOLS)
	})

	/** A COIL WITH NO TARGET. `??? := ioAxis.xVirtual;` is the shape a real project carried, and the reason the
	 *  format could not adopt `?` as its unconnected-pin token. */
	it("`???` as a coil target", async () => {
		await roundTrips("qmark_coil", "LD", "%NETWORK\n??? := a;\n", BOOLS)
	})

	/** …and behind an UNCONNECTED ENABLE, which is how the two LIVE Lenze POUs (`Mach1_MIDS`, `AHWF`) carry it.
	 *  The enable does not excuse the marker — the compiler still errors — so it must not excuse dropping it. */
	it("`???` as a coil target behind an unconnected enable", async () => {
		await roundTrips(
			"qmark_coilen",
			"LD",
			// The box shows EN (wired to nothing) and the coil reads it through its ENO. (An operator box read so needs its
			// value wired, `=> out` — without it the vendor stores and does not build it, X3.)
			"%NETWORK\n??? := MOVE(EN := ???, a, OUT => out).ENO;\n",
			BOOLS,
		)
	})

	/** AN OPERAND INSIDE A GROUP — the marker where a plain variable belongs. */
	it("`???` as an operand in a group", async () => {
		await roundTrips("qmark_operand", "FBD", "%NETWORK\nout := AND(???, a);\n", BOOLS)
	})
})
