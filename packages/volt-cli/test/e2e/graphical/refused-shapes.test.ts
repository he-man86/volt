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
import { VENDOR, BASE, bridge, id, fid, fetchItem, pushOps, removeItem, requireHealthy } from "../harness"

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

/**
 * AND THE OTHER DOOR — EDITING a body INTO one of these shapes, which is refused for the SAME reason.
 *
 * <p>The header above says an UPDATE rewrites only the networks that CHANGED, so a body may legitimately carry
 * a shape the whole-body writer refuses. That is true, and it invites a reading that is not: that an engineer
 * could therefore build one of these shapes in two steps — push the legal near-miss, then edit the condition
 * off. If that worked it would be a create route, and these five conformance fixtures would have a TwinCAT
 * recording after all (`twincat-conformance-parity`, "what the recorder could not push").</p>
 *
 * <p><b>It does not, and this is the measurement.</b> An in-place edit carries VALUES — flags, comments, titles,
 * operand text — while a SHAPE change makes `ResolveBody` hand that one network back to the IDE to rebuild, and
 * the IDE rebuilds it through the same PLCopen import a create uses. So the importer's limits are not a
 * property of CREATE; they are a property of every route Volt has. Measured live 2026-09-22 against TcXaeShell
 * 15.0, all four shapes, each refused with the identical message its create gets.</p>
 *
 * <p>Which leaves the GUI, or an in-proc NWL host (DIALECT N12), as the only ways these bodies come into
 * existence — and that is why the fixtures are marked `vendorRefuses` rather than left looking unrecorded.</p>
 */
describe(`graphical / editing a body INTO a refused shape (${BASE})`, () => {
	beforeAll(async () => {
		await requireHealthy()
	})

	const NL = String.fromCharCode(10)
	const prg = (name: string, vars: readonly string[], nets: readonly string[]) =>
		["PROGRAM " + name, "VAR", ...vars, "END_VAR", "(* @volt-implementation *)", ...nets, "END_PROGRAM", ""].join(NL)

	const BOOLS = ["\ta : BOOL;", "\tout : BOOL;"]

	/** Each case: a body that pushes CLEAN, and the one-substring edit that puts the refused shape into it. */
	// `key` names the item, and is SPELLED OUT rather than derived from `what`: two of these read "an
	// unconditional ..." and any prefix of that collides, so both cases would push over each other under
	// one name — passing only because they happen to run in sequence and each deletes first.
	const EDITS: readonly { key: string; what: string; vars: readonly string[]; nets: readonly string[]; from: string; to: string }[] = [
		{
			key: "ejmp",
			what: "an unconditional JMP",
			vars: BOOLS,
			nets: ["NETWORK 0 FBD", "  IF a THEN JMP Done; END_IF", "END_NETWORK", "NETWORK 1 FBD LABEL: Done", "  out := a;", "END_NETWORK"],
			from: "IF a THEN JMP Done; END_IF",
			to: "JMP Done;",
		},
		{
			key: "eret",
			what: "an unconditional RETURN",
			vars: BOOLS,
			nets: ["NETWORK 0 FBD", "  IF a THEN RETURN; END_IF", "END_NETWORK", "NETWORK 1 FBD", "  out := a;", "END_NETWORK"],
			from: "IF a THEN RETURN; END_IF",
			to: "RETURN;",
		},
		{
			key: "earrow",
			what: "a box output pin wired straight to a variable",
			vars: ["\tt1 : TON;", "\ta : BOOL;", "\tpt : TIME;", "\tel : TIME;"],
			nets: ["NETWORK 0 FBD", "  t1(IN := a, PT := pt);", "END_NETWORK"],
			from: "t1(IN := a, PT := pt)",
			to: "t1(IN := a, PT := pt, ET => el)",
		},
		{
			key: "eexec",
			what: "an EXECUTE box",
			vars: BOOLS,
			nets: ["NETWORK 0 FBD", "  out := a;", "END_NETWORK"],
			from: "  out := a;",
			to: ["  EXECUTE", "    out := a;", "  END_EXECUTE"].join(NL),
		},
	]

	for (const c of EDITS) {
		const item = fid(c.key, "prg")

		it(`${c.what}: an UPDATE is refused too, or the body round-trips`, async () => {
			await removeItem(item).catch(() => {})

			// The NEAR-MISS must be legal on every vendor — if this fails the case is testing the wrong thing.
			const created = await pushOps([{ op: "set", name: item, toFolder: "", sourceText: prg(id(c.key), c.vars, c.nets), ifVersion: null }])
			expect(created.accepted, `the near-miss body was refused, so the edit proves nothing: ${JSON.stringify(created.conflicts)}`).toBe(true)

			const v1 = await fetchItem(item)
			const edited = v1.sourceText.replace(c.from, c.to)
			expect(edited, `the edit matched nothing in the pulled body — the near-miss came back reshaped:\n${v1.sourceText}`).not.toBe(v1.sourceText)

			const r = await pushOps([{ op: "set", name: item, sourceText: edited, ifVersion: v1.version }])

			if (!r.accepted) {
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
