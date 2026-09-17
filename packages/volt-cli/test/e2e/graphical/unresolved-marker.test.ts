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
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, pushOps, fetchItem, requireHealthy, BASE, VENDOR } from "../harness"

describe(`graphical / the ??? marker (${BASE})`, () => {
	setDefaultTimeout(180_000)
	beforeAll(async () => {
		await requireHealthy()
	})

	/** Delete with the item's REAL version, falling back to the UNREADABLE sentinel — a leftover from a failed
	 *  run otherwise blocks the next create with "already exists", a red that says nothing about the code. */
	const clean = async (name: string) => {
		const items = (await bridge.refs()).items ?? {}
		await pushOps([{ op: "deleteItem", name, ifVersion: items[name] ?? "UNREADABLE000000" }])
	}

	/**
	 * THE INVARIANT: create the body, pull it back, and get the same bytes. Not "the push was accepted" — an
	 * accepted push that reshapes the drawing is the failure this file exists to catch.
	 */
	async function roundTrips(slug: string, body: string, vars: string, tcCannotCreate?: string): Promise<void> {
		const name = id(slug)
		const item = fid(slug, "prg")
		await clean(item)
		const src = `PROGRAM ${name}\n(* @volt-implementation *)\nVAR\n${vars}END_VAR\n\n${body}\nEND_PROGRAM\n`

		const created = await pushOps([{ op: "set", name: item, toFolder: "", sourceText: src, ifVersion: null }])

		// A SHAPE TWINCAT'S IMPORTER CANNOT BUILD **YET** IS REFUSED, and the refusal is ASSERTED rather than
		// skipped. These are TRACKED GAPS, not vendor differences to respect — `openspec/changes/
		// twincat-graphical-create-parity`, whose definition of done is that no branch like this one is left in
		// `test/e2e/graphical/`. This suite is one suite run against either vendor, and its own README says a
		// pass on one and a fail on the other is a real parity bug.
		//
		// They are limits of the CREATE path alone — PLCopen is the one form TwinCAT accepts a body it does not
		// already have — and never limits of the marker: `???` round-trips on both vendors in every position that
		// can be created at all, and a body that already carries one of these shapes edits fine on both.
		//
		// Asserting the refusal is what stops a silent DROP passing here again. An embedded output pin did
		// exactly that until 2026-09-05: the importer left the slot empty, the repair for its own empty-operand
		// artifact took the pin with it, and the refusal that followed was swallowed as "nothing to lose".
		if (tcCannotCreate !== undefined && VENDOR === "twincat") {
			expect(created.accepted, "TwinCAT accepted a shape its importer cannot build").toBe(false)
			expect(JSON.stringify(created.conflicts)).toContain(tcCannotCreate)
			return
		}

		expect(created.accepted, `create refused: ${JSON.stringify(created.conflicts)}`).toBe(true)

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
	it("an UNDECLARED FB instance keeps its type: `??? : TYPE(pins)`", async () => {
		await roundTrips("qmark_inst", "NETWORK 0 FBD\n  ??? : TON(IN := a, PT := pt);\nEND_NETWORK\n", BOOLS)
	})

	/** The same, with a type this project does NOT have — exactly the Lenze case, where the box names a library
	 *  FB the target project never references. The type must survive as text even though nothing can resolve it. */
	it("an undeclared instance of an UNRESOLVABLE type survives too", async () => {
		await roundTrips(
			"qmark_lib",
			"NETWORK 0 FBD\n  ??? : L_TT1P_FlexCamBase(xEnable := , Axis := );\nEND_NETWORK\n",
			BOOLS,
			// NO VENDOR BRANCH. This carried one — TwinCAT refused the unconnected pins (`xEnable := ,`) as "a
			// ladder rung terminator" — and the refusal was wrong: emitted as an `<inVariable>` with an EMPTY
			// expression, the importer builds exactly the right shape and this round-trips on both vendors.
		)
	})

	/** AN INPUT PIN. The position no real project has shown us yet — which is the reason to pin it, not a
	 *  reason to skip it. */
	it("`???` on a named INPUT pin", async () => {
		await roundTrips("qmark_in", "NETWORK 0 FBD\n  t1(IN := ???, PT := pt);\nEND_NETWORK\n", BOOLS)
	})

	/** AN OUTPUT PIN, spelled with ST's own output-parameter operator. */
	it("`???` on a named OUTPUT pin", async () => {
		await roundTrips(
			"qmark_out",
			"NETWORK 0 FBD\n  t1(IN := a, PT := pt, ET => ???);\nEND_NETWORK\n",
			BOOLS,
			// TwinCAT: the importer honours the wire and lowers it to a SEPARATE assignment rather than a pin on
			// the box, so what came back would not be what was pushed (DIALECT C20). Editing one that already
			// exists works on both vendors — it is the CREATE that has no route.
			"output pin straight to a variable",
		)
	})

	/** BOTH AT ONCE, on one box. The two pins are read and written by different arms of the reader/writer
	 *  (`Inputs` vs `Outputs`), so a box carrying the marker on both is the case where one arm dropping it
	 *  cannot hide behind the other. */
	it("`???` on an input AND an output pin of the SAME box", async () => {
		await roundTrips(
			"qmark_both",
			"NETWORK 0 FBD\n  t1(IN := ???, PT := pt, ET => ???);\nEND_NETWORK\n",
			BOOLS,
			"output pin straight to a variable", // TwinCAT: the same C20 limit, reached through the output arm
		)
	})

	/** THE BOX'S RESULT PIN — the unnamed output, which network text spells by assigning the call. */
	it("`???` as the target of a box's RESULT", async () => {
		await roundTrips("qmark_res", "NETWORK 0 FBD\n  ??? := MOVE(src);\nEND_NETWORK\n", BOOLS)
	})

	/** A COIL WITH NO TARGET. `??? := ioAxis.xVirtual;` is the shape a real project carried, and the reason the
	 *  format could not adopt `?` as its unconnected-pin token. */
	it("`???` as a coil target", async () => {
		await roundTrips("qmark_coil", "NETWORK 0 LD\n  ??? := a;\nEND_NETWORK\n", BOOLS)
	})

	/** …and behind an UNCONNECTED ENABLE, which is how the two LIVE Lenze POUs (`Mach1_MIDS`, `AHWF`) carry it.
	 *  The enable does not excuse the marker — the compiler still errors — so it must not excuse dropping it. */
	it("`???` as a coil target behind an unconnected enable", async () => {
		await roundTrips(
			"qmark_coilen",
			"NETWORK 0 LD\n  LET en1 := ;\n  IF en1 THEN ??? := NOT(a); END_IF\nEND_NETWORK\n",
			BOOLS,
			// NO VENDOR BRANCH. TwinCAT refused this for a year — the importer folds a wired enable in as an
			// ordinary data input — until the fold turned out to be repairable: the input item and its name slot
			// already exist, so renaming slot 0 to `EN` and setting the display flag makes it a real enable.
		)
	})

	/** AN OPERAND INSIDE A GROUP — the marker where a plain variable belongs. */
	it("`???` as an operand in a group", async () => {
		await roundTrips("qmark_operand", "NETWORK 0 FBD\n  out := (??? AND a);\nEND_NETWORK\n", BOOLS)
	})
})
