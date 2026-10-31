import { landed } from "./workspace"
/**
 * ROUND-TRIP — the one shape almost every test in this suite is really making, in one place.
 *
 * <p>It was hand-rolled SIX times before this file existed (three of them copy-pasted inside a single test file),
 * and the copies did not agree: some compared what was pushed against what came back, and some compared a fetch
 * against a later fetch. That difference is the whole ballgame.</p>
 *
 * <p><b>A fetch-versus-fetch comparison is a FIXED-POINT check, and a fixed point is exactly what every graphical
 * data-loss bug in this repo turned out to be:</b> the write dropped something, the read handed back the reduced
 * body, and pushing THAT back changed nothing. Two tests in the old suite had a fetch-versus-fetch comparison as
 * their ONLY assertion. Only the first comparison — authored source against what came back — can see the loss, so
 * every helper here takes the authored source and keeps it as the reference.</p>
 */
import { expect } from "bun:test"
import { at, createItem, fetchItem, pathOf, projectRoot, pushOps, removeItem, versionOf } from "./workspace"

/**
 * Create `src`, read it back, and assert it came back EXACTLY as authored — then that re-pushing what came back
 * changes nothing.
 *
 * <p>The second half is the fixed point, and it is only meaningful because the first half established that what
 * came back was right. Reported separately so a failure says which of the two broke.</p>
 */
export async function expectRoundTrip(name: string, src: string, folder?: string): Promise<string> {
	await removeItem(name)
	await createItem(name, src, folder)

	const back = (await fetchItem(name)).sourceText
	expect(back, `'${name}' did not come back as authored`).toBe(src)

	const again = await pushOps([{ op: "set", name: await pathOf(name), sourceText: back, ifVersion: await versionOf(name) }])
	expect(landed(again), `re-pushing '${name}' its own bytes was refused: ${JSON.stringify(again.conflicts)}`).toBe(true)
	expect((await fetchItem(name)).sourceText, `'${name}' drifted on a second push`).toBe(back)
	return back
}

/**
 * The same, for a shape one vendor's importer cannot build: either it round-trips exactly, or it is REFUSED with
 * a reason — never silently accepted and reshaped.
 *
 * <p>Silent reshaping is the outcome worth failing for, and the one this suite has actually shipped: a body that
 * came back subtly different from what was pushed, with the push reporting success. `expectedRefusal` is a
 * fragment the refusal message must contain, so "refused" cannot quietly become "refused for an unrelated
 * reason". Passing it does not make the refusal acceptable — it records a gap that some tracked change is
 * expected to close.</p>
 */
export async function expectRoundTripOrRefusal(
	name: string,
	src: string,
	expectedRefusal: string,
	folder?: string,
): Promise<"round-tripped" | "refused"> {
	await removeItem(name)
	const created = await pushOps([{ op: "set", name: await at(name, folder ?? (await projectRoot())), sourceText: src, ifVersion: null }])

	if (!landed(created)) {
		expect(
			JSON.stringify(created.conflicts),
			`'${name}' was refused, but not for the expected reason`,
		).toContain(expectedRefusal)
		return "refused"
	}

	expect((await fetchItem(name)).sourceText, `'${name}' was ACCEPTED but came back reshaped`).toBe(src)
	return "round-tripped"
}

/** Push an item's own current bytes back and assert nothing moves. For an item the test did not author — the
 *  only case where a fetch is the best reference available, and then only as a stability claim. */
export async function expectStable(name: string): Promise<void> {
	const before = (await fetchItem(name)).sourceText
	const r = await pushOps([{ op: "set", name: await pathOf(name), sourceText: before, ifVersion: await versionOf(name) }])
	expect(landed(r), `re-pushing '${name}' unchanged was refused: ${JSON.stringify(r.conflicts)}`).toBe(true)
	expect((await fetchItem(name)).sourceText, `'${name}' changed on a no-op push`).toBe(before)
}

// ── the operand oracle ────────────────────────────────────────────────────────

/** The network region of a source — the diagram, isolated from the declaration: from its first `%NETWORK` line to the
 *  item's outer END line (plain-ST network text, openspec network-text-st). */
export function bodyOf(src: string): string {
	const i = src.search(/^%NETWORK\b/m)
	const j = src.search(/^END_[A-Z_]+\s*$(?![\s\S]*^END_[A-Z_]+\s*$)/m)
	if (i < 0 || j < 0 || j < i) throw new Error(`no %NETWORK region in:\n${src}`)
	return src.slice(i, j)
}

/** Everything in a network line that is grammar rather than the engineer's program: ST's words, the text's own
 *  elements and `%` lines, a box's call head. */
const NETWORK_KEYWORDS = new Set([
	"NETWORK", "DISABLED", "VAR_TEMP", "END_VAR", "ANY", "UNSUPPORTED", "NOT", "AND", "OR", "XOR", "ADD", "SUB", "MUL", "DIV", "MOD",
	"GT", "GE", "EQ", "NE", "LE", "LT", "MOVE", "EN", "ENO", "OUT", "FEED", "BRANCH", "BRANCH_SHORTCIRCUIT", "JMP",
	"RETURN", "IF", "THEN", "END_IF", "EXECUTE", "RISING", "FALLING", "RAIL", "NOT", "TRUE", "FALSE",
])

/**
 * Every operand the engineer wrote is still in the body the repo shows back.
 *
 * <p>Byte equality is too strong for a graphical body, and MEASURED to be: TwinCAT's importer splits two
 * disconnected rungs into two networks (D25) and folds a fan-out wire into one multi-output assign (C25),
 * and a flat `a AND b AND c` can come back reparenthesised. None of that is loss — the same program runs.</p>
 *
 * <p>What survives every one of those rewrites is the SET OF OPERANDS, so that is what this asserts. It catches
 * the whole measured loss class — a dropped unconsumed block, a jump's discarded condition spine, an FB instance
 * written with `typeName=""`, a flattened accessor — while staying blind to reformatting, which is the IDE's
 * business. A wire name (`w<n>`) is excluded: it names a branch point, not an operand of the program, and an
 * importer that folds the wire away drops the name with nothing lost.</p>
 *
 * <p>It is loose by design, and loose assertions rot into vacuous ones — which is how the graphical evidence in
 * this repo once stayed green over a body it was destroying. `test/unit/oracle.test.ts` pins the three measured
 * loss shapes it MUST refuse and the rewrites it must accept, offline, so the looseness stays bounded.</p>
 */
export function expectNoOperandsLost(pushed: string, fetched: string): void {
	const idents = (s: string): string[] =>
		(s.match(/[A-Za-z_][A-Za-z0-9_.]*/g) ?? []).map((w) => w.replace(/_(EN|ENO)$/i, "")).filter((w) => !NETWORK_KEYWORDS.has(w.toUpperCase()))

	const body = bodyOf(pushed)
	const want = [...new Set(idents(body))].filter((w) => !/^w\d+$/i.test(w))
	const got = new Set(idents(bodyOf(fetched)))

	const lost = want.filter((w) => !got.has(w))
	expect(lost, `operands lost between push and fetch — pushed:\n${body}\n\nfetched:\n${bodyOf(fetched)}`).toEqual([])
}
