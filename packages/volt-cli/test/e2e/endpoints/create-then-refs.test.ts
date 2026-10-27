/**
 * A CREATE THE RECEIPT NAMES IS IN THE NEXT `refs` (wire-final-shape 4.3a, PLC Assist report 2026-10-24: on bridge
 * 0.1.17931, CODESYS SP21, twice, a push that created an item answered landed and the next refs had no entry for it —
 * both items carried a deliberate compile error). Measured on our own instances (CODESYS 3.5.22.40 and 3.5.21.40, 100
 * rounds each of both shapes below, refs at once and again after 1 s, and 50 rounds with a build in between): 0 misses.
 * 0.1.17931's walk skipped an object whose kind it could not map with a Debug line only (`ProjectSnapshot`); that skip
 * is gone — such an object's folder is in `unwalkedFolders`, on the receipt and on refs alike. This file keeps the
 * reported shapes, a few rounds each, on both vendors: a receipt naming an item that refs then omits is never right.
 */
import { describe, it, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { bridge, id, fid, at, cleanup, requireHealthy, pushOps, landed, BASE } from "../harness"

const SHAPES: [string, (n: string) => string][] = [
	["an FB with a type error", (n) => `FUNCTION_BLOCK ${n}\nVAR\n\tx : INT;\nEND_VAR\n%LANGUAGE ST\nx := TRUE;\nEND_FUNCTION_BLOCK\n`],
	["a PROGRAM naming a DUT no one created", (n) => `PROGRAM ${n}\nVAR\n\td : ${n}_NoSuchDut;\nEND_VAR\n%LANGUAGE ST\n;\nEND_PROGRAM\n`],
]
const ROUNDS = 5

describe(`endpoints / a created item is in the next refs (${BASE})`, () => {
	setDefaultTimeout(300_000)
	beforeAll(async () => { await requireHealthy(); await cleanup() })
	afterAll(cleanup)

	for (const [k, [label, text]] of SHAPES.entries())
		it(`${label}: the receipt names it, and refs at once holds it at that version`, async () => {
			for (let i = 0; i < ROUNDS; i++) {
				const key = `ctr_${k}_${i}`, bare = id(key), wire = await at(fid(key))
				const r = await pushOps([{ op: "set", name: wire, sourceText: text(bare) }])
				expect(landed(r) && r.conflicts.length === 0, JSON.stringify(r.conflicts)).toBe(true)
				const refs = await bridge.refs()
				expect(refs.items[wire], `round ${i}: the receipt named ${wire}; refs: unreadable ${JSON.stringify(refs.unreadable)}, unwalked ${JSON.stringify(refs.unwalkedFolders)}`)
					.toBe(r.newItems[wire])
				await pushOps([{ op: "deleteItem", name: wire }])
			}
		})
})
