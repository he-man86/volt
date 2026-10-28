import { landed } from "../harness"
/**
 * THE GRAPHICAL SHAPES ONE DRIVER REFUSES AND THE OTHER TAKES — a ratchet that may only shrink.
 *
 * <p>Five bodies push clean to CODESYS and come back refused from TwinCAT: an unconditional `JMP`, an
 * unconditional `RETURN`, an `EXECUTE` box, and a box output pin wired straight to a variable
 * (`F(… doubled => twice)`). Each refusal stated a reason and each reason blamed TwinCAT's PLCopen importer — and
 * the refusals were the DRIVER's rules, written from what it could express at the time: "TwinCAT cannot" and "Volt
 * does not" read identically from the outside, which is exactly why they need a test rather than a note. With the
 * native writer (openspec twincat-inproc-host) TwinCAT builds all five; the list is empty on both vendors.</p>
 *
 * <p>So this suite asserts the two things that are true whichever way each one turns out:</p>
 *
 * <ol>
 *   <li><b>A body is never silently reshaped.</b> Either the push is accepted and fetches back BYTE-IDENTICAL,
 *       or it is refused with a reason that names the shape. The refusal message for the output-pin case says
 *       the importer would lower the wire to a separate assignment — an accepted push that came back reshaped
 *       would be the data-loss bug the refusal exists to prevent, and only a live IDE can tell the two apart.</li>
 *   <li><b>A refused push writes NOTHING.</b> This was FALSE when the suite was written: the output-pin case
 *       pushes two items, and it wrote the first, refused the second, and told the caller the push had failed.
 *       `PushService` validated everything decidable from the source text before touching the IDE and said
 *       plainly that this could not cover a refusal only the vendor raises — but every refusal here comes from
 *       a PURE function of the parsed body, so it was reachable all along. `IVendorStore.ValidateSource` runs the
 *       driver's own writer in the pre-flight now, and this is what proves it against a live IDE.</li>
 * </ol>
 *
 * <p>On a CREATE, which is what these push. An UPDATE rewrites only the networks that CHANGED, so a body may
 * legitimately carry a shape the whole-body writer refuses — an Execute box the engineer drew, in a network the
 * edit does not touch — and validating the whole body there would refuse an edit that works.</p>
 *
 * <p>The table below records which shapes are refused TODAY, per vendor. When a driver learns one, this suite
 * FAILS — "took it, take it off the list" — which is the prompt to delete the entry, not a regression. It is the
 * same ratchet the LSP's conformance backlog uses, and for the same reason: a list of known gaps is only honest
 * while something makes it shrink.</p>
 *
 * <p>Every body here is also an LSP conformance fixture (`ng_label_jmp_resolved`, `ng_conditional_jump_and_return`,
 * `ng_execute_box`, `ng_box_output_arrow`, `cc_vg_undefined_label`), which is how the asymmetry was found: those
 * five are the only fixtures in 2561 with no TwinCAT recording, because the recorder cannot push them.</p>
 */
import { describe, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { VENDOR, BASE, bridge, id, fid, fetchItem, pushOps, landedInFull, removeItem, requireHealthy, inFolder, pathIn, projectRoot } from "../harness"

import { itGapped, PLATFORM_GAPS } from "../lib/platform"

/** On a CODESYS version that cannot take an LD/FBD write, every test here must end in that refusal (lib/platform.ts). */
const it = itGapped(PLATFORM_GAPS.graphicalWrite)

setDefaultTimeout(180_000)

interface Shape {
	/** The wire items the body needs, in push order — the LAST one carries the shape under test. */
	readonly items: readonly { readonly name: string; readonly source: string; readonly pulls?: string }[]
	/** What the shape is, in the words the failure message should use. */
	readonly what: string
	/** The vendors whose driver refuses it today. Emptying an entry is how this ratchet shrinks. */
	readonly refusedBy: readonly string[]
}

const SHAPES: readonly Shape[] = [
	{
		what: "an unconditional JMP",
		// TOOK IT, TAKEN OFF THE LIST — 2026-09-22. TwinCAT creates this now, and the route is the one the
		// create path was already built on: `TcPlcOpenWriter` wires the jump to an EMPTY `<inVariable>` so the
		// importer will build it, then `Stamp` swaps that operand for a `BoxTreeTerminator`, reusing its id.
		// What made it safe to try was a body DRAWN BY HAND in XAE (`drawn-refused-shapes.TcPOU`): it showed
		// the shape is one the IDE holds happily, so the refusal was Volt's one door, not the vendor.
		refusedBy: [],
		items: [
			{
				name: "VltRefJump.pou",
				source: `FUNCTION_BLOCK VltRefJump
VAR
\tout : BOOL;
\tafter : BOOL;
END_VAR
%LANGUAGE LD
%NETWORK
out := TRUE;
JMP Onwards;
%NETWORK
Onwards:
after := TRUE;

END_FUNCTION_BLOCK
`,
			},
		],
	},
	{
		what: "an unconditional RETURN beside two conditional ones",
		refusedBy: [],   // same swap as the JMP above, same day
		items: [
			{
				name: "VltRefReturn.pou",
				source: `FUNCTION_BLOCK VltRefReturn
VAR
\tcond : BOOL;
\tdone : BOOL;
\tlater : BOOL;
END_VAR
%LANGUAGE LD
%NETWORK
JMP(Tail, cond);
%NETWORK
RETURN(cond);
%NETWORK
Tail:
done := TRUE;
RETURN;
%NETWORK
later := TRUE;

END_FUNCTION_BLOCK
`,
			},
		],
	},
	{
		what: "an EXECUTE box",
		// TOOK IT, TAKEN OFF THE LIST — 2026-10-16. TwinCAT's PLCopen importer returned a plain box named EXECUTE with
		// the ST gone, so it was refused; the native writer builds the box from the drawn one (openspec twincat-inproc-host).
		refusedBy: [],
		items: [
			{
				name: "VltRefExecute.pou",
				source: `FUNCTION_BLOCK VltRefExecute
VAR
\tbRun : BOOL;
\tbStart : BOOL;
\ttarget : INT;
END_VAR
%LANGUAGE FBD
%NETWORK
%EXECUTE(EN := bRun)
IF bStart THEN
\ttarget := 40 + 2;
END_IF
%END_EXECUTE

END_FUNCTION_BLOCK
`,
			},
		],
	},
	{
		what: "a box output pin wired straight to a variable",
		// TOOK IT, TAKEN OFF THE LIST — 2026-10-17. TwinCAT's PLCopen importer lowered the pin to a separate assignment
		// (C20), so it was refused; the native writer builds the FUNCTION's box with its drawn output list (its result
		// slot, which the consumer reads, and every VAR_OUTPUT — 2R.4, as CODESYS builds it), so the pin has its slot.
		refusedBy: [],
		items: [
			{
				name: "VltRefSplit.pou",
				source: `FUNCTION VltRefSplit : INT
VAR_INPUT
\tsource : INT;
END_VAR
VAR_OUTPUT
\tdoubled : INT;
END_VAR
%LANGUAGE ST
doubled := source * 2;
VltRefSplit := source + 1;

END_FUNCTION
`,
			},
			{
				name: "VltRefArrow.pou",
				source: `FUNCTION_BLOCK VltRefArrow
VAR
\tsrc : INT := 5;
\tnext : INT;
\ttwice : INT;
END_VAR
%LANGUAGE FBD
%NETWORK
next := VltRefSplit(src, doubled => twice);

END_FUNCTION_BLOCK
`,
				// the positional pin is pushed named (ld-fbd-coverage 2R.4: a FUNCTION box's input names are derived)
				pulls: `FUNCTION_BLOCK VltRefArrow
VAR
\tsrc : INT := 5;
\tnext : INT;
\ttwice : INT;
END_VAR
%LANGUAGE FBD
%NETWORK
next := VltRefSplit(source := src, doubled => twice);

END_FUNCTION_BLOCK
`,
			},
		],
	},
]

describe(`graphical / shapes a driver refuses (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	const versions = async (): Promise<Record<string, string>> => (await bridge.refs()).items ?? {}

	const remove = async (names: readonly string[]): Promise<void> => {
		const have = await versions()
		const ops = names
			.map((n) => pathIn(have, n))
			.filter((p): p is string => p !== undefined)
			.map((p) => ({ op: "deleteItem", name: p, ifVersion: have[p]! }))
		if (ops.length > 0) await pushOps(ops)
	}

	for (const shape of SHAPES) {
		const names = shape.items.map((i) => i.name)
		const refused = shape.refusedBy.includes(VENDOR)

		it(`${shape.what}: ${refused ? "is refused, and changes nothing" : "round-trips byte-for-byte"}`, async () => {
			await remove(names)
			const before = await versions()

			const root = await projectRoot()
			const r = await pushOps(shape.items.map((i) => ({ op: "set", name: inFolder(root, i.name), sourceText: i.source, ifVersion: null })))

			// `landedInFull`, not `accepted`: a shape refused at APPLY after an earlier item landed answers accepted
			// with a conflict (push-keeps-what-landed) — it must reach this branch, where "nothing landed" then fails.
			if (!landedInFull(r)) {
				expect(refused, `${shape.what} was REFUSED on ${VENDOR}, which the table does not expect:\n${JSON.stringify(r.conflicts)}`).toBe(true)
				// The reason is the whole value of a refusal: a bare rejection tells an engineer to try again.
				expect(JSON.stringify(r.conflicts ?? []).length, `${shape.what} was refused with no reason`).toBeGreaterThan(40)
				// …AND NOTHING LANDED. The refusals here are decided by the driver's native builder, which is a pure
				// function of the parsed body — so `IVendorStore.ValidateSource` runs it in the push PRE-FLIGHT and the
				// whole family is refused before the first write. Until that existed, this shape wrote
				// `VltRefSplit.pou` and then refused `VltRefArrow.pou`: a push the caller was told had failed, with
				// half of it in the project.
				const after = await versions()
				const added = Object.keys(after).filter((n) => before[n] === undefined)
				expect(added, `a REFUSED push wrote ${added.join(", ")} to the project anyway`).toEqual([])
				return
			}

			expect(refused, `${shape.what} was ACCEPTED on ${VENDOR} — the driver learned it, so take it off the list`).toBe(false)
			for (const item of shape.items)
				expect((await fetchItem(item.name)).sourceText, `${item.name} was accepted but came back reshaped`).toBe(item.pulls ?? item.source)
			await remove(names)
		})
	}

})

/**
 * AND THE OTHER DOOR — EDITING a body INTO one of these shapes, which is refused for the SAME reason.
 *
 * <p>The header above says an UPDATE rewrites only the networks that CHANGED, so a body may legitimately carry
 * a shape the whole-body writer refuses. That is true, and it invites a reading that is not: that an engineer
 * could therefore build one of these shapes in two steps — push the legal near-miss, then edit the condition
 * off. If that worked it would be a create route, and these five conformance fixtures would have a TwinCAT
 * recording after all (`twincat-conformance-parity`, "what the recorder could not push").</p>
 *
 * <p>It did not while a SHAPE change made `ResolveBody` hand that one network to TwinCAT's PLCopen import, the same
 * door a create used (measured live 2026-09-22, all four shapes refused with the create's message). With the native
 * writer (openspec twincat-inproc-host) a changed network is built as TwinCAT's own archive, so an edit into any of
 * these shapes is accepted and must round-trip.</p>
 */
describe(`graphical / editing a body INTO a refused shape (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	const NL = String.fromCharCode(10)
	const prg = (name: string, vars: readonly string[], nets: readonly string[]) =>
		["PROGRAM " + name, "VAR", ...vars, "END_VAR", "%LANGUAGE FBD", ...nets, "END_PROGRAM", ""].join(NL)

	const BOOLS = ["\ta : BOOL;", "\tout : BOOL;"]

	/** Each case: a body that pushes CLEAN, and the one-substring edit that puts the refused shape into it. */
	// `key` names the item, and is SPELLED OUT rather than derived from `what`: two of these read "an
	// unconditional ..." and any prefix of that collides, so both cases would push over each other under
	// one name — passing only because they happen to run in sequence and each deletes first.
	const EDITS: readonly { key: string; what: string; vars: readonly string[]; nets: readonly string[]; from: string; to: string }[] = [
		{
			key: "ejmp",
			what: "an unconditional JMP",
			// Editing a conditional jump into an unconditional one is the swap DIRECTLY — no import at all,
			// because only the RValue element changes. This is what was measured first.
			vars: BOOLS,
			nets: ["%NETWORK", "JMP(Done, a);", "%NETWORK", "Done:", "out := a;"],
			from: "JMP(Done, a);",
			to: "JMP Done;",
		},
		{
			key: "eret",
			what: "an unconditional RETURN",
			vars: BOOLS,
			nets: ["%NETWORK", "RETURN(a);", "%NETWORK", "out := a;"],
			from: "RETURN(a);",
			to: "RETURN;",
		},
		{
			key: "earrow",
			what: "a box output pin wired straight to a variable",
			vars: ["\tt1 : TON;", "\ta : BOOL;", "\tpt : TIME;", "\tel : TIME;"],
			nets: ["%NETWORK", "t1(IN := a, PT := pt);"],
			from: "t1(IN := a, PT := pt)",
			to: "t1(IN := a, PT := pt, ET => el)",
		},
		{
			key: "eexec",
			what: "an EXECUTE box",
			vars: BOOLS,
			nets: ["%NETWORK", "out := a;"],
			from: "out := a;",
			to: ["%EXECUTE", "out := a;", "%END_EXECUTE"].join(NL),
		},
	]

	for (const c of EDITS) {
		const item = fid(c.key, "pou")

		it(`${c.what}: an UPDATE is refused too, or the body round-trips`, async () => {
			await removeItem(item).catch(() => {})

			// The NEAR-MISS must be legal on every vendor — if this fails the case is testing the wrong thing.
			const created = await pushOps([{ op: "set", name: inFolder(await projectRoot(), item), sourceText: prg(id(c.key), c.vars, c.nets), ifVersion: null }])
			expect(landed(created), `the near-miss body was refused, so the edit proves nothing: ${JSON.stringify(created.conflicts)}`).toBe(true)

			const v1 = await fetchItem(item)
			const edited = v1.sourceText.replace(c.from, c.to)
			expect(edited, `the edit matched nothing in the pulled body — the near-miss came back reshaped:\n${v1.sourceText}`).not.toBe(v1.sourceText)

			const r = await pushOps([{ op: "set", name: inFolder(await projectRoot(), item), sourceText: edited, ifVersion: v1.version }])

			if (!landed(r)) {
				// Same ratchet as above: a refusal is only acceptable from a vendor the table already lists, and
				// only with a reason. The day TwinCAT's edit path learns one of these, this fails.
				expect(VENDOR, `${c.what} was REFUSED on ${VENDOR}, which the table does not expect`).toBe("twincat")
				expect(JSON.stringify(r.conflicts ?? []).length, `${c.what} was refused with no reason`).toBeGreaterThan(40)
				return
			}

			// Accepted — then it must be the body that was pushed, not one the importer reshaped.
			expect((await fetchItem(item)).sourceText, `${c.what} was accepted but came back reshaped`).toBe(edited)
			await removeItem(item).catch(() => {})
		})
	}
})

/**
 * AND A NEW GRAPHICAL MEMBER OF AN EXISTING POU — a CREATE inside an UPDATE (openspec `bridge-refusal-review` 2.28, D21).
 *
 * <p>The write decides create-or-edit per BODY: a method the POU does not hold yet is created whole, as a new item is.
 * The pre-flight asked the driver only for a new ITEM, so a push adding such a method — holding a shape the create
 * refused — passed it, wrote every earlier op of the batch, and was refused mid-batch. A refusal is raised in the
 * pre-flight now, naming the member, and nothing lands; the Execute box this used is built on both vendors today.</p>
 */
describe(`graphical / a new graphical member in an existing POU (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	it("a new METHOD holding an EXECUTE box: refused before any op lands, or written", async () => {
		const first = inFolder(await projectRoot(), fid("nm_first", "pou"))
		const owner = inFolder(await projectRoot(), fid("nm_owner", "pou"))
		await removeItem(first).catch(() => {})
		await removeItem(owner).catch(() => {})

		const ownerSrc = `FUNCTION_BLOCK ${id("nm_owner")}
VAR
\tbRun : BOOL;
\ttarget : INT;
END_VAR
%LANGUAGE ST
target := 0;

END_FUNCTION_BLOCK
`
		const created = await pushOps([{ op: "set", name: owner, sourceText: ownerSrc, ifVersion: null }])
		expect(landed(created), `the owner was refused: ${JSON.stringify(created.conflicts)}`).toBe(true)
		const v1 = await fetchItem(owner)

		const withMethod = `${v1.sourceText.trimEnd()}

METHOD Step : BOOL
%LANGUAGE FBD
%NETWORK
%EXECUTE(EN := bRun)
target := 40 + 2;
%END_EXECUTE


END_METHOD
`
		const before = await bridge.refs()
		const r = await pushOps([
			{ op: "set", name: first, sourceText: `PROGRAM ${id("nm_first")}\nVAR\nEND_VAR\n%LANGUAGE ST\n;\n\nEND_PROGRAM\n`, ifVersion: null },
			{ op: "set", name: owner, sourceText: withMethod, ifVersion: v1.version },
		])

		try {
			if (!landedInFull(r)) {
				expect(VENDOR, `the new member was REFUSED on ${VENDOR}: ${JSON.stringify(r.conflicts)}`).toBe("twincat")
				expect(JSON.stringify(r.conflicts ?? [])).toContain("'Step'")
				const after = await bridge.refs()
				expect(after.items[first], "a REFUSED push wrote the batch's first item anyway").toBeUndefined()
				expect(after.items[owner], "a REFUSED push changed the owner anyway").toBe(before.items[owner])
				return
			}
			// Accepted on both vendors (TwinCAT refused it while its PLCopen import was the create door): the member
			// is written with its box and its ST.
			expect((await fetchItem(owner)).sourceText, "the new member was accepted but its Execute box is not there").toContain("END_EXECUTE")
		} finally {
			await removeItem(first).catch(() => {})
			await removeItem(owner).catch(() => {})
		}
	})
})
