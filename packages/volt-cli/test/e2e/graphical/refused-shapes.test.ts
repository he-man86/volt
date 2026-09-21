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
 *   <li><b>A refused push writes NOTHING.</b> This was FALSE when the suite was written: the output-pin case
 *       pushes two items, and it wrote the first, refused the second, and told the caller the push had failed.
 *       `PushService` validated everything decidable from the source text before touching the IDE and said
 *       plainly that this could not cover a refusal only the vendor raises — but every refusal here comes from
 *       a PURE function of the parsed body, so it was reachable all along. `ICodeStore.ValidateSource` runs the
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
				// …AND NOTHING LANDED. The refusals here are decided by the driver's PLCopen writer, which is a pure
				// function of the parsed body — so `ICodeStore.ValidateSource` runs it in the push PRE-FLIGHT and the
				// whole family is refused before the first write. Until that existed, this shape wrote
				// `VltRefSplit.fun` and then refused `VltRefArrow.fb`: a push the caller was told had failed, with
				// half of it in the project.
				const after = await versions()
				const added = Object.keys(after).filter((n) => before[n] === undefined)
				expect(added, `a REFUSED push wrote ${added.join(", ")} to the project anyway`).toEqual([])
				return
			}

			expect(refused, `${shape.what} was ACCEPTED on ${VENDOR} — the driver learned it, so take it off the list`).toBe(false)
			for (const item of shape.items)
				expect((await fetchItem(item.name)).sourceText, `${item.name} was accepted but came back reshaped`).toBe(item.source)
			await remove(names)
		})
	}

})
