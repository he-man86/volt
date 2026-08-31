/**
 * WHAT AN EDIT COSTS — the destroy-and-rebuild question, asked of the IDE instead of argued about.
 *
 * `CodesysNetworkWriter` writes a changed network by removing every item and re-appending it from the pushed
 * text. That makes the write LOSSY BY CONSTRUCTION for anything the text cannot carry, and an operand carries
 * three such things the reader can see and the format cannot spell: `Type` (the resolved declared type),
 * `IsLValue` (whether it is an assignment target) and `SymbolComment` (the symbol's comment, cached into the
 * drawing).
 *
 * The writer looks like it restores the first two — `if (!string.IsNullOrEmpty(o.Type)) Set(op, "Type", …)` —
 * but it cannot: `PushService` always sends the item's BODY AS TEXT, so every model reaching the writer is
 * text-derived and carries `Type = null`, `Comment = null`, `IsLValue = false` for every operand. Both
 * production call sites pass exactly such a model. So on every rebuild all three are dropped and the IDE has to
 * re-derive them.
 *
 * Whether it does is not a matter of opinion, and a BUILD is the one instrument that can answer it: a body whose
 * operands lost their resolved types and l-value markers, and that the IDE did not re-resolve, does not compile.
 * `SymbolComment` has no build consequence and no interface Volt can observe it through — it is display
 * metadata — so this file deliberately does not claim anything about it.
 *
 * The change gate is what keeps this bounded: a network whose text is unchanged is never rebuilt, so the cost
 * is paid only by the network actually edited. This test pays it on purpose.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, setDefaultTimeout } from "bun:test"
import {
	bridge, id, fid, cleanup, createItem, fetchItem, ensureCompiles, pushOps, requireHealthy,
	savePlcPrg, restorePlcPrg, fixPlcPrg, BASE,
} from "../harness"

setDefaultTimeout(180_000)

describe(`graphical / rebuild after an edit (${BASE})`, () => {
	beforeAll(async () => { await requireHealthy() })
	// Each case CREATES its POU, so a leftover from a previous run makes the create refuse rather than the
	// rebuild fail — and `ensureCompiles` instantiates into PLC_PRG, which has to be put back.
	beforeEach(async () => { await fixPlcPrg(); await cleanup(); await savePlcPrg() })
	afterEach(async () => { await restorePlcPrg() })

	/**
	 * A GRAPHICAL BODY STILL COMPILES AFTER AN EDIT REBUILDS IT.
	 *
	 * An FB rather than a program, referenced from PLC_PRG, because TwinCAT skips unreferenced POUs and would
	 * report a clean build over a broken body — the same reason the FB-type parity test is built this way.
	 *
	 * The edit is deliberately to an OPERAND, which is what carries the metadata a rebuild drops. Editing a
	 * title or a comment would leave the trees untouched and the change gate would skip the rebuild entirely,
	 * which is the opposite of what this asks.
	 */
	it("an edited network still compiles after being rebuilt", async () => {
		const name = id("rb_edit")
		const full = fid("rb_edit", "fb")

		const src =
			`FUNCTION_BLOCK ${name}
VAR
	a : BOOL;   // the comment on a
	b : BOOL;   // the comment on b
	c : BOOL;
	out : BOOL;
END_VAR

` +
			`NETWORK 0 LD
  out := (a AND b);
END_NETWORK
` +
			`
END_FUNCTION_BLOCK
`

		await createItem(fid("rb_edit"), src, "")
		await ensureCompiles(name)

		// Edit the PULLED text — the IDE owns its own network boundaries — and change an OPERAND, so the
		// change gate cannot skip the rebuild.
		const pulled = await fetchItem(full)
		const edited = pulled.sourceText.replace("(a AND b)", "(a AND c)")
		expect(edited, "the edit did not apply").not.toBe(pulled.sourceText)

		const refs = await bridge.refs()
		const r = await pushOps([{ op: "set", name: full, sourceText: edited, ifVersion: refs.items[full] }])
		expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)

		// The edit landed, and the body still resolves. If the rebuild had dropped the operands' types and
		// l-value markers without the IDE re-deriving them, this build would not be clean.
		expect((await fetchItem(full)).sourceText).toBe(edited)
		await ensureCompiles(name)
	})

	/**
	 * AND THE REBUILD IS CONFINED TO THE NETWORK THAT CHANGED.
	 *
	 * This is the property the change gate exists for, and the reason the loss above is bounded rather than
	 * project-wide: `PushService` sends the whole body on every push, so without the gate an edit to ONE rung
	 * would re-mint every rung in the POU, each re-mint dropping whatever the round trip cannot carry.
	 *
	 * Asserted through wire NAMES, which is the one rebuild-visible thing the text does show: a rebuilt network
	 * used to be renumbered from the vendor's allocator (DIALECT C9), so an untouched neighbour keeping its
	 * `g` name is evidence its items were never removed and re-appended.
	 */
	it("editing one network leaves its neighbour untouched", async () => {
		const name = id("rb_scope")
		const full = fid("rb_scope", "fb")

		const src =
			`FUNCTION_BLOCK ${name}
VAR
	a : BOOL;
	b : BOOL;
	c : BOOL;
	p : BOOL;
	q : BOOL;
	r : BOOL;
	s : BOOL;
END_VAR

` +
			`NETWORK 0 LD
  LET g0 := (a AND b);
  p := g0;
  q := g0;
END_NETWORK
` +
			`NETWORK 1 LD
  LET g1 := (a OR b);
  r := g1;
  s := g1;
END_NETWORK
` +
			`
END_FUNCTION_BLOCK
`

		await createItem(fid("rb_scope"), src, "")
		const before = (await fetchItem(full)).sourceText
		const wires = (t: string) => t.match(/LET \w+/g) ?? []
		expect(wires(before).length).toBe(2)

		const edited = before.replace("(a AND b)", "(a AND c)")
		expect(edited).not.toBe(before)

		const refs = await bridge.refs()
		const r = await pushOps([{ op: "set", name: full, sourceText: edited, ifVersion: refs.items[full] }])
		expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)

		const after = (await fetchItem(full)).sourceText
		expect(after).toBe(edited)
		expect(wires(after), "an untouched network was rebuilt too").toEqual(wires(before))
	})

	/**
	 * THE TITLE, LABEL AND COMMENT SURVIVE THE REBUILD OF THE NETWORK THEY SIT ON.
	 *
	 * These three are the text an engineer writes ABOUT the logic — the comment being the block just below the
	 * label, one per network — and they are the metadata most obviously at risk from a destroy-and-rebuild,
	 * because the rebuild removes every item in the network.
	 *
	 * They survive by construction: all three live on the NETWORK object, not on its items, and are written by
	 * `SetIfChanged` before the change gate is even consulted — so removing and re-appending items cannot reach
	 * them. `comments.test.ts` already pins the round trip and the fixed point; what it cannot show is this,
	 * because a body that never changes is never rebuilt. Asserted rather than reasoned, since "it lives
	 * somewhere else" is exactly the kind of claim that is true right up until someone moves it.
	 *
	 * (This is a different field from an operand's `SymbolComment`, which is per-variable, frequently holds a
	 * serialization sentinel rather than engineer text, and is NOT restored by a rebuild — see the note in
	 * `CodesysNetworkWriter.Operand`.)
	 */
	it("a network's title, label and comment survive an edit to its logic", async () => {
		const name = id("rb_meta")
		const full = fid("rb_meta", "fb")

		const src =
			`FUNCTION_BLOCK ${name}
VAR
	a : BOOL;
	b : BOOL;
	c : BOOL;
	out : BOOL;
END_VAR

` +
			// Canonical order is header, then COMMENT, then LABEL — the reverse of how the IDE lays the two out
			// in a network's header, where the comment box sits below the label. The reader takes them in
			// either order; the canonical-form gate does not, so an engineer typing them the way the IDE shows
			// them gets a refusal with the corrected body. Noted in the network-text-placement-rules proposal.
			`NETWORK 0 LD "interlock"
  // holds the drive off while the guard is open
  // second line of the same comment
  Guard:
  out := (a AND b);
END_NETWORK
` +
			`
END_FUNCTION_BLOCK
`

		await createItem(fid("rb_meta"), src, "")
		const before = (await fetchItem(full)).sourceText
		expect(before, "the title was dropped on create").toContain(`"interlock"`)
		expect(before, "the label was dropped on create").toContain("Guard:")
		expect(before, "the comment was dropped on create").toContain("// holds the drive off")

		// Change the LOGIC, which is what forces the rebuild. A title-only edit would leave the trees
		// untouched and the change gate would skip it — the opposite of what this asks.
		const edited = before.replace("(a AND b)", "(a AND c)")
		expect(edited, "the edit did not apply").not.toBe(before)

		const refs = await bridge.refs()
		const r = await pushOps([{ op: "set", name: full, sourceText: edited, ifVersion: refs.items[full] }])
		expect(r.accepted, `push refused: ${JSON.stringify(r.conflicts)}`).toBe(true)

		const after = (await fetchItem(full)).sourceText
		expect(after, "the network metadata did not survive the rebuild").toBe(edited)
		expect(after).toContain(`"interlock"`)
		expect(after).toContain("Guard:")
		expect(after).toContain("// holds the drive off while the guard is open")
		expect(after).toContain("// second line of the same comment")
	})
})
