/**
 * A REFUSED PUSH WRITES NOTHING — on both vendors, for a refusal decided from the SOURCE TEXT.
 *
 * <p>`PushService` applies a push item by item, so a refusal raised from INSIDE the write leaves everything
 * before it in the engineer's live project and still reports failure. `ICodeStore.ValidateSource` exists to run
 * every text-decidable refusal in front of the first write, and TwinCAT has overridden it since it landed.</p>
 *
 * <p><b>CODESYS never did</b>, so `DriverBase` refused nothing and every refusal inside `CodesysNetworkWriter`
 * fired mid-write — including the v1 form of the one below, an FB call whose instance has no resolvable type. Found by the
 * vendor differential map on 2026-09-22; the TwinCAT half has been green since the same hole was closed there.</p>
 *
 * <p>The shape is chosen so BOTH drivers refuse it for the same reason and in near-identical words, which is
 * what makes one test the parity gate rather than two vendor tests that happen to agree.</p>
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { id, fid, bridge, requireHealthy, pushOps, cleanup, BASE } from "../harness"

describe(`graphical / the push pre-flight (${BASE})`, () => {
	setDefaultTimeout(180_000)
	beforeAll(async () => {
		await requireHealthy()
		await cleanup()
	})
	afterAll(async () => {
		try {
			await cleanup()
		} catch {}
	})

	const NL = String.fromCharCode(10)

	/** A perfectly ordinary graphical POU — this one must never be the reason a push fails. */
	const fine = (name: string) =>
		["PROGRAM " + name, "VAR", "\ta : BOOL;", "\tb : BOOL;", "\tout : BOOL;", "END_VAR",
		 "(* @volt-implementation FBD *)", "NETWORK", "  out := (a AND b);", "END_NETWORK", "", "END_PROGRAM", ""].join(NL)

	/**
	 * …and one calling an FB INSTANCE whose text is an expression, `` `fbs[1]`(IN := a) ``. A call head is read
	 * against the declarations, which name a NAME, so no declaration can say which instance that is or what type it
	 * has; the spec refuses it with `NETWORK_UNSUPPORTED` rather than read it as a function of that name
	 * ("an opaque operand is backticked in place") — on both vendors, from the text alone.
	 *
	 * (Network text v1 used `t1(IN := a, PT := pt)` with `t1` undeclared. In v2 a bare name that no declaration makes
	 * an instance IS a function call, as in ST — the text cannot tell it from a library function the project does not
	 * declare — so that shape is no longer a refusal the text decides; the build reports the missing POU.)
	 */
	const broken = (name: string) =>
		["PROGRAM " + name, "VAR", "\ta : BOOL;", "\tfbs : ARRAY[1..2] OF TON;", "END_VAR",
		 "(* @volt-implementation FBD *)", "NETWORK", "  `fbs[1]`(IN := a);", "END_NETWORK", "", "END_PROGRAM", ""].join(NL)

	it("a create refused for an unresolvable FB instance leaves the item before it unwritten", async () => {
		const firstName = id("pf_ok")
		const first = fid("pf_ok", "prg")
		const second = fid("pf_bad", "prg")

		const before = (await bridge.refs()).items ?? {}
		expect(before[first], "the fixture project already holds this item").toBeUndefined()

		// ORDER MATTERS: the good item FIRST, so a mid-write refusal has something to have already written.
		const r = await pushOps([
			{ op: "set", name: first, toFolder: "", sourceText: fine(firstName), ifVersion: null },
			{ op: "set", name: second, toFolder: "", sourceText: broken(id("pf_bad")), ifVersion: null },
		])

		expect(r.accepted, "the unresolvable FB instance was ACCEPTED — the driver learned it, update this test").toBe(false)
		expect(JSON.stringify(r.conflicts ?? []), "the refusal names neither the call nor its type").toMatch(/FB instance/i)

		// THE ASSERTION. Not "the push failed" — that was already true while half of it landed.
		const after = (await bridge.refs()).items ?? {}
		const added = Object.keys(after).filter((n) => before[n] === undefined)
		expect(added, `a REFUSED push wrote ${added.join(", ")} into the project anyway`).toEqual([])
	})
})
