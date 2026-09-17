/**
 * THE FIVE CONSTRUCTS NOTHING HAD EVER PUSHED AT A LIVE IDE.
 *
 * The suite is thorough about what it covers — labels, jumps, returns, titles, comments, EN/ENO, fan-out and
 * Execute boxes, each on CREATE, on the FIXED POINT, and against a real BUILD. What it could not do was say
 * what it had never TRIED, and that is the shape of the bug it missed: `ladderLabel.prg`, pulled from a real
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
	removeItem, createItem, fetchItem, pushOps, versionOf,
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

	/** A program wrapper, so each case is only its networks. */
	const prg = (name: string, networks: string, vars = "\ta : BOOL;\n\tb : BOOL;\n\tout : BOOL;\n") =>
		`PROGRAM ${name}\n(* @volt-implementation *)\nVAR\n${vars}END_VAR\n\n${networks}\nEND_PROGRAM\n`

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

	// ── what ladderLabel.prg lost ────────────────────────────────────────────────────────────────────────

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
		await expectRoundTrip(fid("ucoil", "prg"), prg(name, `NETWORK 0 LD\n  out := ;\nEND_NETWORK\n`))
	})

	/**
	 * AN EMPTY NETWORK — a marker straight to `END_NETWORK`.
	 *
	 * Refusal is a legitimate outcome here and silence is not. PLCopen has no network element (D25), so the
	 * TwinCAT create route cannot state an empty one, and `LostNetworks` exists to catch exactly that. What
	 * must not happen is the third thing: accepted, and the network quietly gone — which is what
	 * `ladderLabel.prg` measured on TwinCAT (`twincat-graphical-create-loss`).
	 */
	it("an empty network round-trips, or is refused by name", async () => {
		const name = id("enet")
		const src = prg(name, `NETWORK 0 LD\n  out := (a AND b);\nEND_NETWORK\nNETWORK 1 LD\nEND_NETWORK\n`)

		const outcome = await expectRoundTripOrRefusal(fid("enet", "prg"), src, "network")
		console.log(`  [empty network] ${BASE}: ${outcome}`)
	})

	/**
	 * AND THE PAIR TOGETHER, which is `ladderLabel.prg` itself — an empty LABELLED network beside an undriven
	 * coil. Both halves separately above; this is the body that actually lost five things at once, reduced to
	 * the two constructs that make it.
	 */
	it("a labelled empty network beside an undriven coil round-trips, or is refused", async () => {
		const name = id("lbl0")
		const src = prg(
			name,
			`NETWORK 0 LD LABEL: First\n  out := ;\nEND_NETWORK\nNETWORK 1 LD LABEL: Second\nEND_NETWORK\n`,
			"\tout : BOOL;\n",
		)

		const outcome = await expectRoundTripOrRefusal(fid("lbl0", "prg"), src, "network")
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

		const back = await expectRoundTrip(fid("rcoil", "prg"), prg(name, `NETWORK 0 LD\n  out R= a;\nEND_NETWORK\n`))

		expect(back, "the reset coil came back as something else").toContain("R=")
		expect(back, "a reset coil must not degrade to a SET coil").not.toContain("S=")
		expect(await added(before), "the reset coil does not compile").toEqual([])
	})

	/**
	 * SET AND RESET IN ONE NETWORK, driven by the same wire — the shape that proves the two are distinct rather
	 * than a single flag being echoed back. A fan-out whose coils disagree could not be spelled at all until
	 * storage moved onto the target, so this is also the regression test for that move.
	 *
	 * THE WIRE NAME IS MATCHED LOOSELY, and that is not a weakened assertion. A minted wire is named `g<VarId>`
	 * from the id the VENDOR holds (`NetworkTextWriter.WireName`), so a body the IDE has just CREATED gets the
	 * ids that IDE assigned — TwinCAT answered `g1` where the push said `g0`. Volt cannot dictate them and does
	 * not try: the name exists so the same wire keeps the same name across a pull → push round trip, which is a
	 * statement about an EXISTING body. `fanout.test.ts` already encodes this with `/LET g\d+/`, and a strict
	 * `expectRoundTrip` here would have been asserting something the format never promised.
	 *
	 * What IS promised, and is asserted: each coil keeps its OWN storage, both read the same wire, and pushing
	 * back what came out changes nothing.
	 */
	it("a SET and a RESET coil on one wire keep their own storage", async () => {
		const name = id("srcoil")
		const item = fid("srcoil", "prg")
		const src = prg(
			name,
			`NETWORK 0 LD\n  LET g0 := (a AND b);\n  latched S= g0;\n  cleared R= g0;\nEND_NETWORK\n`,
			"\ta : BOOL;\n\tb : BOOL;\n\tlatched : BOOL;\n\tcleared : BOOL;\n",
		)

		await removeItem(item)
		await createItem(item, src)
		const back = (await fetchItem(item)).sourceText

		const wire = /LET (g\d+) := \(a AND b\);/.exec(back)
		expect(wire, `no fan-out wire in the created body:\n${back}`).not.toBeNull()
		const g = wire![1]!

		expect(back, "the SET coil lost its storage").toContain(`latched S= ${g};`)
		expect(back, "the RESET coil lost its storage - or took the SET's").toContain(`cleared R= ${g};`)

		// THE FIXED POINT is the half a create cannot give: push back exactly what came out, and nothing moves.
		const again = await pushOps([
			{ op: "set", name: item, toFolder: null, sourceText: back, ifVersion: await versionOf(item) },
		])
		expect(again.accepted, `re-push refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
		expect((await fetchItem(item)).sourceText, "the body drifted on a second push").toBe(back)
	})

	/**
	 * A RISING-EDGE MODIFIER on a consumed operand.
	 *
	 * `ApplyMods` spells `RISING`/`FALLING` on a VALUE and `AssignOp` spells nothing of the sort on a TARGET —
	 * an asymmetry found this session, where an edge-triggered COIL rendered as a plain one. That half is
	 * guarded by refusal now (`NetworkTextWriter.Unspellable`) because a census of five real projects found no
	 * edge coil to calibrate a spelling against. The VALUE side is expressible and had still never been pushed.
	 */
	it("a RISING-edge modifier survives a round trip", async () => {
		const name = id("rise")
		const back = await expectRoundTrip(
			fid("rise", "prg"),
			prg(name, `NETWORK 0 FBD\n  out := (a RISING AND b);\nEND_NETWORK\n`),
		)

		expect(back, "the rising-edge modifier was dropped").toContain("RISING")
	})

	/** The same for FALLING, which shares the model field and every code path. */
	it("a FALLING-edge modifier survives a round trip", async () => {
		const name = id("fall")
		const back = await expectRoundTrip(
			fid("fall", "prg"),
			prg(name, `NETWORK 0 FBD\n  out := (a FALLING AND b);\nEND_NETWORK\n`),
		)

		expect(back, "the falling-edge modifier was dropped").toContain("FALLING")
	})
})
