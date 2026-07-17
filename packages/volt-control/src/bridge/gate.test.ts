import { describe, test, expect } from "bun:test"
import { withGate, isMutationInFlight } from "./gate.js"

/**
 * The mutation gate must wrap ONLY the work, and must release even when the work fails — otherwise a
 * rejected push/pull would leave isMutationInFlight stuck true and wedge the next operation (the "push
 * keeps pending" symptom). doPush/doPull keep their outcome dialogs OUTSIDE withGate for the same reason.
 */
describe("withGate", () => {
	test("releases the gate after the work resolves", async () => {
		const ws = "/ws-resolve"
		let sawInFlight = false
		await withGate(ws, async () => { sawInFlight = isMutationInFlight(ws) })
		expect(sawInFlight).toBe(true)
		expect(isMutationInFlight(ws)).toBe(false)
	})

	test("releases the gate even when the work REJECTS (a failed push must not wedge the next)", async () => {
		const ws = "/ws-reject"
		await expect(withGate(ws, async () => { throw new Error("boom") })).rejects.toThrow("boom")
		expect(isMutationInFlight(ws)).toBe(false)
	})

	test("overlapping mutations refcount — the first to finish must NOT clear the gate", async () => {
		const ws = "/ws-overlap"
		let releaseA!: () => void
		let releaseB!: () => void
		const a = withGate(ws, () => new Promise<void>((r) => (releaseA = r)))
		const b = withGate(ws, () => new Promise<void>((r) => (releaseB = r)))
		expect(isMutationInFlight(ws)).toBe(true)
		releaseA()
		await a
		expect(isMutationInFlight(ws)).toBe(true) // B still running — a Set-based gate would report false here
		releaseB()
		await b
		expect(isMutationInFlight(ws)).toBe(false)
	})
})
