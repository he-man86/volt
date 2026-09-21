/**
 * THE GRAPHICAL SHAPES ONE DRIVER REFUSES AND THE OTHER TAKES — a ratchet that may only shrink.
 *
 * <p>Five bodies push clean to CODESYS and come back refused from TwinCAT: an unconditional `JMP`, an
 * unconditional `RETURN`, an `EXECUTE` box, and a box output pin wired straight to a variable
 * (`F(… doubled => twice)`). Each refusal states a reason and each reason blames TwinCAT's PLCopen importer.
 * <b>None of that has been proved against the IDE.</b> The refusals are the DRIVER's rules, written from what it
 * could express at the time, and "TwinCAT cannot" and "Volt does not" read identically from the outside — which
 * is exactly why they need a test rather than a note.</p>
 *
 * <p>So this suite asserts the two things that are true whichever way each one turns out:</p>
 *
 * <ol>
 *   <li><b>A body is never silently reshaped.</b> Either the push is accepted and fetches back BYTE-IDENTICAL,
 *       or it is refused with a reason that names the shape. The refusal message for the output-pin case says
 *       the importer would lower the wire to a separate assignment — an accepted push that came back reshaped
 *       would be the data-loss bug the refusal exists to prevent, and only a live IDE can tell the two apart.</li>
 *   <li><b>A refused push SAYS what it wrote.</b> `PushService` validates everything decidable from the source
 *       text before touching the IDE, and says plainly that this does not cover a refusal only the vendor can
 *       raise mid-write. The output-pin case is one: it pushes two items, the first lands, the second is
 *       refused. That is survivable precisely because the refusal names it — "1 of 2 item(s) were already
 *       written to the IDE before this one failed" — and the unsurvivable version is the SILENT one, where a
 *       caller is told nothing happened and half of it did. This asserts the naming.</li>
 * </ol>
 *
 * <p>The stronger property — a refused push writes NOTHING — is the gap this suite is here to hold open, as the
 * `todo` below. Closing it means the driver can answer "would you take this body?" without writing it, which is
 * a new seam through the vendor boundary and a decision rather than a fix. Until then a partial write is stated
 * rather than prevented, and the difference between those two is the whole reason to test it.</p>
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
import { describe, it, expect, beforeAll, setDefaultTimeout } from "bun:test"
import { VENDOR, BASE, bridge, fetchItem, pushOps, requireHealthy } from "../harness"

setDefaultTimeout(180_000)

interface Shape {
	/** The wire items the body needs, in push order — the LAST one carries the shape under test. */
	readonly items: readonly { readonly name: string; readonly source: string }[]
	/** What the shape is, in the words the failure message should use. */
	readonly what: string
	/** The vendors whose driver refuses it today. Emptying an entry is how this ratchet shrinks. */
	readonly refusedBy: readonly string[]
}

const SHAPES: readonly Shape[] = [
	{
		what: "an unconditional JMP",
		refusedBy: ["twincat"],
		items: [
			{
				name: "VltRefJump.fb",
				source: `FUNCTION_BLOCK VltRefJump
VAR
\tout : BOOL;
\tafter : BOOL;
END_VAR
(* @volt-implementation *)
NETWORK 0 LD
  out := TRUE;
  JMP Onwards;
END_NETWORK
NETWORK 1 LD LABEL: Onwards
  after := TRUE;
END_NETWORK

END_FUNCTION_BLOCK
`,
			},
		],
	},
	{
		what: "an unconditional RETURN beside two conditional ones",
		refusedBy: ["twincat"],
		items: [
			{
				name: "VltRefReturn.fb",
				source: `FUNCTION_BLOCK VltRefReturn
VAR
\tcond : BOOL;
\tdone : BOOL;
\tlater : BOOL;
END_VAR
(* @volt-implementation *)
NETWORK 0 LD
  IF cond THEN JMP Tail; END_IF
END_NETWORK
NETWORK 1 LD
  IF cond THEN RETURN; END_IF
END_NETWORK
NETWORK 2 LD LABEL: Tail
  done := TRUE;
  RETURN;
END_NETWORK
NETWORK 3 LD
  later := TRUE;
END_NETWORK

END_FUNCTION_BLOCK
`,
			},
		],
	},
	{
		what: "an EXECUTE box",
		refusedBy: ["twincat"],
		items: [
			{
				name: "VltRefExecute.fb",
				source: `FUNCTION_BLOCK VltRefExecute
VAR
\tbRun : BOOL;
\tbStart : BOOL;
\ttarget : INT;
END_VAR
(* @volt-implementation *)
NETWORK 0 FBD
  LET en1 := bRun;
  IF en1 THEN
  EXECUTE
IF bStart THEN
\ttarget := 40 + 2;
END_IF
  END_EXECUTE
  END_IF
END_NETWORK

END_FUNCTION_BLOCK
`,
			},
		],
	},
	{
		what: "a box output pin wired straight to a variable",
		refusedBy: ["twincat"],
		items: [
			{
				name: "VltRefSplit.fun",
				source: `FUNCTION VltRefSplit : INT
VAR_INPUT
\tsource : INT;
END_VAR
VAR_OUTPUT
\tdoubled : INT;
END_VAR
(* @volt-implementation *)
doubled := source * 2;
VltRefSplit := source + 1;

END_FUNCTION
`,
			},
			{
				name: "VltRefArrow.fb",
				source: `FUNCTION_BLOCK VltRefArrow
VAR
\tsrc : INT := 5;
\tnext : INT;
\ttwice : INT;
END_VAR
(* @volt-implementation *)
NETWORK 0 FBD
  next := VltRefSplit(src, doubled => twice);
END_NETWORK

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
		const ops = names.filter((n) => have[n] !== undefined).map((n) => ({ op: "deleteItem", name: n, ifVersion: have[n]! }))
		if (ops.length > 0) await pushOps(ops)
	}

	for (const shape of SHAPES) {
		const names = shape.items.map((i) => i.name)
		const refused = shape.refusedBy.includes(VENDOR)

		it(`${shape.what}: ${refused ? "is refused, and changes nothing" : "round-trips byte-for-byte"}`, async () => {
			await remove(names)
			const before = await versions()

			const r = await pushOps(shape.items.map((i) => ({ op: "set", name: i.name, toFolder: "", sourceText: i.source, ifVersion: null })))

			if (!r.accepted) {
				expect(refused, `${shape.what} was REFUSED on ${VENDOR}, which the table does not expect:\n${JSON.stringify(r.conflicts)}`).toBe(true)
				// The reason is the whole value of a refusal: a bare rejection tells an engineer to try again.
				expect(JSON.stringify(r.conflicts ?? []).length, `${shape.what} was refused with no reason`).toBeGreaterThan(40)
				// …and whatever DID land is named. A silent partial write is the dangerous one: the caller is told
				// the push failed, acts on that, and half of it is in the project.
				const after = await versions()
				const added = Object.keys(after).filter((n) => before[n] === undefined)
				if (added.length > 0)
					expect(
						JSON.stringify(r.conflicts ?? []),
						`a refused push wrote ${added.join(", ")} and did not say so`,
					).toContain("already written")
				await remove(names)
				return
			}

			expect(refused, `${shape.what} was ACCEPTED on ${VENDOR} — the driver learned it, so take it off the list`).toBe(false)
			for (const item of shape.items)
				expect((await fetchItem(item.name)).sourceText, `${item.name} was accepted but came back reshaped`).toBe(item.source)
			await remove(names)
		})
	}

	// THE GAP, held open where it will be read. Today `VltRefSplit.fun` lands and `VltRefArrow.fb` is refused,
	// and the refusal says so; the property worth having is that neither lands. It needs the driver to answer
	// "would you take this body?" without writing it — a pre-flight through the vendor boundary, which
	// `PushService` documents as the one class its own pre-flight cannot cover.
	it.todo("a refused push writes nothing at all — needs a vendor pre-flight seam", () => {})
})
