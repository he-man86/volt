/**
 * THE FIVE CONSTRUCTS NOTHING HAD EVER PUSHED AT A LIVE IDE.
 *
 * The suite is thorough about what it covers — labels, jumps, returns, titles, comments, EN/ENO, fan-out and
 * Execute boxes, each on CREATE, on the FIXED POINT, and against a real BUILD. What it could not do was say
 * what it had never TRIED, and that is the shape of the bug it missed: `ladderLabel.pou`, pulled from a real
 * TwinCAT project, is a coil with nothing driving it plus a network holding nothing but a label. Pushed into
 * an empty project it came back gutted, with the push reporting success.
 *
 * `scripts/e2e-graphical-coverage.ts` counted the rest: 20 of 25 constructs pushed somewhere, five never.
 * These are those five. Two are what `ladderLabel` lost; three had simply never been asked.
 *
 * The RESET coil is the one to read twice. `S=` is pushed in three places and `R=` in none — and the reset
 * coil is the construct whose misread INVERTED 128 COILS in one real project (`Flags.CoilFromVendor`). That
 * fix was verified against a pulled corpus, which can only prove Volt agrees with itself; it was never once
 * created at a live IDE and pulled back.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import {
	id, fid, bridge, requireHealthy, BASE, expectRoundTrip, expectRoundTripOrRefusal, diagnostics,
	removeItem, createItem, fetchItem, pushOps, versionOf, plcFolder, FOLDER, VENDOR,
} from "../harness"

describe(`graphical / shapes nothing had pushed (${BASE})`, () => {
	setDefaultTimeout(180_000)
	beforeAll(async () => {
		await requireHealthy()
	})

	// The suite sweeps leftover `VltE2E_*` items at process start, so this is tidiness rather than
	// correctness — but a fixture project left holding seven POUs is the state the NEXT run starts from,
	// and that cascade is measured (`workspace.ts` sweepOnce).
	afterAll(async () => {
		const refs = await bridge.refs()
		const mine = Object.keys(refs.items ?? {}).filter((n) => n.startsWith(id("")))
		if (mine.length === 0) return
		await bridge.push({
			expectedProjectVersion: refs.projectVersion,
			ops: mine.map((n) => ({ op: "deleteItem", name: n, ifVersion: refs.items[n] })),
		})
	})

	/** A program wrapper, so each case is only its networks.
	 *
	 *  THE `IMPLEMENTATION` LINE GOES AFTER `END_VAR` and names the language. This wrapper put a bare marker ABOVE `VAR` until
	 *  network text v2, which made the whole `VAR … END_VAR … NETWORK …` blob the implementation — stored verbatim as
	 *  ST, so every case here round-tripped a text blob and no graphical path ever ran (`unresolved-marker.test.ts`
	 *  found the same mistake in its own wrapper). */
	const prg = (name: string, lang: "FBD" | "LD", networks: string, vars = "\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\n") =>
		`PROGRAM ${name}\nVAR\n${vars}END_VAR\nIMPLEMENTATION ${lang}\n${networks}\nEND_PROGRAM\n`

	/** The diagnostics a body ADDS. Counted as a delta, because the fixture project reports its own. */
	const added = async (before: any[]): Promise<string[]> => {
		const now = await diagnostics()
		const key = (d: any) => `${d.severity}: ${d.message ?? ""}`
		const was = before.map(key)
		return now
			.filter((d: any) => d.severity === "error")
			.map(key)
			.filter((k) => !was.includes(k))
	}

	// ── what ladderLabel.pou lost ────────────────────────────────────────────────────────────────────────

	/**
	 * AN UNDRIVEN COIL — `out := ;`, a coil with nothing wired into it.
	 *
	 * The reader already models it: an empty right-hand side becomes the TERMINATOR the archive actually holds,
	 * not a null, because a null makes the in-place writer refuse ("the 'RValue' input of an item is removed")
	 * and lose the rung. What was never tested is CREATING one — an engineer drops a coil before wiring it, so
	 * this is an ordinary half-finished body rather than an exotic shape.
	 */
	it("a coil with nothing driving it round-trips", async () => {
		const name = id("ucoil")
		await expectRoundTrip(fid("ucoil", "pou"), prg(name, "LD", `NETWORK\n  out := ;\nEND_NETWORK\n`))
	})

	/**
	 * AN EMPTY NETWORK — a marker straight to `END_NETWORK`.
	 *
	 * Refusal is a legitimate outcome here and silence is not. PLCopen has no network element (D25), so the
	 * TwinCAT create route cannot state an empty one, and `LostNetworks` exists to catch exactly that. What
	 * must not happen is the third thing: accepted, and the network quietly gone — which is what
	 * `ladderLabel.pou` measured on TwinCAT (`twincat-graphical-create-loss`).
	 */
	it("an empty network round-trips, or is refused by name", async () => {
		const name = id("enet")
		const src = prg(name, "LD", `NETWORK\n  out := (a AND b);\nEND_NETWORK\nNETWORK\nEND_NETWORK\n`)

		const outcome = await expectRoundTripOrRefusal(fid("enet", "pou"), src, "network")
		console.log(`  [empty network] ${BASE}: ${outcome}`)
	})

	/**
	 * AND THE PAIR TOGETHER, which is `ladderLabel.pou` itself — an empty LABELLED network beside an undriven
	 * coil. Both halves separately above; this is the body that actually lost five things at once, reduced to
	 * the two constructs that make it.
	 */
	it("a labelled empty network beside an undriven coil round-trips, or is refused", async () => {
		const name = id("lbl0")
		const src = prg(
			name,
			"LD",
			`NETWORK LABEL: First\n  out := ;\nEND_NETWORK\nNETWORK LABEL: Second\nEND_NETWORK\n`,
			"\tout : BOOL;\n",
		)

		const outcome = await expectRoundTripOrRefusal(fid("lbl0", "pou"), src, "network")
		console.log(`  [labelled empty network + undriven coil] ${BASE}: ${outcome}`)
	})

	// ── the three nothing had ever asked ─────────────────────────────────────────────────────────────────

	/**
	 * A RESET COIL. The vendors spell one as `Negation + Set` on the target — two bits holding ONE enum with
	 * four values, not two independent modifiers — and reading them as two is what turned every reset coil in
	 * a project into a negated SET coil. `GeneralProgramFlags` network 0, comment "Always Off", pulled as
	 * `AlwaysOff := AlwaysOff SET;`: pushed back, the flag that must stay false latches true.
	 *
	 * The BUILD is asserted as well as the round trip, because a coil that round-trips and does not compile is
	 * the failure a text comparison cannot see.
	 */
	it("a RESET coil stays a RESET coil, and compiles", async () => {
		const name = id("rcoil")
		const before = await diagnostics()

		const back = await expectRoundTrip(fid("rcoil", "pou"), prg(name, "LD", `NETWORK\n  out R= a;\nEND_NETWORK\n`))

		expect(back, "the reset coil came back as something else").toContain("R=")
		expect(back, "a reset coil must not degrade to a SET coil").not.toContain("S=")
		expect(await added(before), "the reset coil does not compile").toEqual([])
	})

	/**
	 * SET AND RESET IN ONE NETWORK, driven by the same wire — the shape that proves the two are distinct rather
	 * than a single flag being echoed back. A fan-out whose coils disagree could not be spelled at all until
	 * storage moved onto the target, so this is also the regression test for that move.
	 *
	 * CODESYS builds the Demux the text declares, under the VarId the text gave it, and each coil must come back with
	 * its OWN storage. TwinCAT's only create door, the PLCopen import, folds a fan-out wire into ONE assign driving
	 * both coils (DIALECT D22 / C25); a plain fan-out is kept in that folded shape (`fanout.test.ts`), but here the
	 * coils carry storage the fold leaves `Stamp` no item to write onto, and it refuses by name rather than report a
	 * body whose storage it did not write (`BeckhoffDriver.Stamp`, `CarriesDetail`). Measured 2026-09-27 — the first
	 * run of this case through a graphical path: until v2 its wrapper put the marker above `VAR`, so it round-tripped
	 * as ST text on both vendors.
	 */
	it("a SET and a RESET coil on one wire keep their own storage", async () => {
		const name = id("srcoil")
		const item = fid("srcoil", "pou")
		const src = prg(
			name,
			"LD",
			`NETWORK\n  VAR_TEMP g0 : BOOL; END_VAR\n  g0 := (a AND b);\n  latched S= g0;\n  cleared R= g0;\nEND_NETWORK\n`,
			"\ta : BOOL;\n\tb : BOOL;\n\tlatched : BOOL;\n\tcleared : BOOL;\n",
		)

		await removeItem(item)
		if (VENDOR === "twincat") {
			const before = await versionOf(item)
			const r = await pushOps([{ op: "set", name: item, toFolder: await plcFolder(FOLDER), sourceText: src, ifVersion: null }])
			expect(r.accepted, "TwinCAT created a fan-out with storing coils it has no item to stamp").toBe(false)
			expect(JSON.stringify(r.conflicts), "the refusal does not name the shape change").toContain("item(s)")
			expect(await versionOf(item), "a refused create wrote the item anyway").toBe(before)
			return
		}
		await createItem(item, src)
		const back = (await fetchItem(item)).sourceText

		// Each coil keeps its own storage — a SET that came back as the RESET's (or plain) is the bug this pins.
		expect(back, "the SET or the RESET coil lost its storage")
			.toContain("  VAR_TEMP g0 : BOOL; END_VAR\n  g0 := (a AND b);\n  latched S= g0;\n  cleared R= g0;\n")

		// THE FIXED POINT is the half a create cannot give: push back exactly what came out, and nothing moves.
		const again = await pushOps([
			{ op: "set", name: item, toFolder: null, sourceText: back, ifVersion: await versionOf(item) },
		])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		expect((await fetchItem(item)).sourceText, "the body drifted on a second push").toBe(back)
	})

	/**
	 * A RISING-EDGE FLAG on a consumed operand, spelled `R_EDGE(a)` — IEC's edge word for the vendor's IFlags bit,
	 * never an `R_TRIG` box (which would add an instance the IDE never had).
	 *
	 * The VALUE side is the one the text spells; an edge-triggered COIL has no spelling (a census of five real
	 * projects found none to calibrate one against), so a body holding one materializes as `IMPLEMENTATION LD|FBD UNSUPPORTED`.
	 */
	it("a rising edge (R_EDGE) survives a round trip", async () => {
		const name = id("rise")
		const back = await expectRoundTrip(
			fid("rise", "pou"),
			prg(name, "FBD", `NETWORK\n  out := (R_EDGE(a) AND b);\nEND_NETWORK\n`),
		)

		expect(back, "the rising edge was dropped").toContain("R_EDGE(a)")
	})

	/** The same for F_EDGE, which shares the model field and every code path. */
	it("a falling edge (F_EDGE) survives a round trip", async () => {
		const name = id("fall")
		const back = await expectRoundTrip(
			fid("fall", "pou"),
			prg(name, "FBD", `NETWORK\n  out := (F_EDGE(a) AND b);\nEND_NETWORK\n`),
		)

		expect(back, "the falling edge was dropped").toContain("F_EDGE(a)")
	})
})
